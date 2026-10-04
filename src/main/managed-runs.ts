import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppDatabase } from './database';
import type { Provider } from '../shared/types';

const MAX_LINE_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 30_000;
type ManagedChild = ReturnType<typeof spawn>;

export interface ManagedRunSummary {
  id: string;
  provider: Provider;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  startedAt: string;
  endedAt: string | null;
  eventCount: number;
  usageEventCount: number;
  error: string | null;
  result: string | null;
}

/** The ledger records an observed CLI stream. It does not establish complete window coverage. */
export class ManagedRunService {
  private segmentId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private children = new Map<string, ManagedChild>();
  private transientResults = new Map<string, string>();
  private transientGeneration = 0;
  private runGenerations = new Map<string, number>();

  constructor(private readonly db: AppDatabase,
    private readonly binaries: Record<Provider, string> = { codex: 'codex', claude: 'claude' },
    private readonly now: () => string = () => new Date().toISOString()) {}

  start(): void {
    this.db.transactionDurable(() => {
      this.db.run(`CREATE TABLE IF NOT EXISTS managed_sources (
        initiator_user_id TEXT NOT NULL, provider TEXT NOT NULL, enabled INTEGER NOT NULL,
        enabled_at TEXT, changed_at TEXT NOT NULL, PRIMARY KEY(initiator_user_id, provider));
        CREATE TABLE IF NOT EXISTS managed_segments (
        id TEXT PRIMARY KEY, started_at TEXT NOT NULL, last_heartbeat TEXT NOT NULL,
        ended_at TEXT, status TEXT NOT NULL, error TEXT);
        CREATE TABLE IF NOT EXISTS managed_runs (
        id TEXT PRIMARY KEY, initiator_user_id TEXT NOT NULL, provider TEXT NOT NULL,
        cli_account_verified INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL, cli_version TEXT NOT NULL, protocol_version INTEGER NOT NULL,
        project_key TEXT NOT NULL, project_label TEXT NOT NULL,
        segment_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
        status TEXT NOT NULL, exit_code INTEGER, final_seen INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0, usage_event_count INTEGER NOT NULL DEFAULT 0,
        byte_watermark INTEGER NOT NULL DEFAULT 0, error TEXT);
        CREATE TABLE IF NOT EXISTS managed_events (
        run_id TEXT NOT NULL, sequence INTEGER NOT NULL, event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL, byte_watermark INTEGER NOT NULL,
        input_tokens INTEGER, output_tokens INTEGER, cached_input_tokens INTEGER,
        cache_creation_tokens INTEGER, model TEXT,
        PRIMARY KEY(run_id, sequence));
        CREATE INDEX IF NOT EXISTS managed_runs_scope ON managed_runs(initiator_user_id, provider, started_at);`);
      // A previous process cannot prove a continuous segment or a normal CLI end after a crash.
      this.db.run(`UPDATE managed_segments SET ended_at=last_heartbeat,
        status=CASE WHEN status='gap' THEN 'gap' ELSE 'interrupted' END,
        error=CASE WHEN status='gap' THEN error ELSE 'process_restarted' END WHERE ended_at IS NULL`);
      this.db.run("UPDATE managed_runs SET status='interrupted',error='process_restarted' WHERE status='running'");
      this.segmentId = randomUUID();
      const at = this.now();
      this.db.run('INSERT INTO managed_segments VALUES (?,?,?,?,?,?)', [this.segmentId, at, at, null, 'active', null]);
    });
    this.timer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.timer.unref();
  }

  private heartbeat(): void {
    if (!this.segmentId) return;
    try {
      const at = this.now();
      const prior = this.db.one('SELECT last_heartbeat,status,error FROM managed_segments WHERE id=?', [this.segmentId]);
      const elapsed = prior ? Date.parse(at) - Date.parse(String(prior.last_heartbeat)) : 0;
      const reason = prior?.status === 'gap' ? String(prior.error || 'heartbeat_gap')
        : elapsed < 0 ? 'clock_rollback' : elapsed > HEARTBEAT_MS * 2 ? 'heartbeat_gap' : null;
      this.db.transactionDurable(() => this.db.run(
        'UPDATE managed_segments SET last_heartbeat=?,status=?,error=? WHERE id=?',
        [at, reason ? 'gap' : 'active', reason, this.segmentId]
      ));
    } catch {
      // Failed writes invalidate any future coverage proof; never claim a healthy segment.
      this.segmentId = null;
      for (const child of this.children.values()) child.kill();
    }
  }

  private executable(provider: Provider): string {
    const configured = this.binaries[provider];
    const candidates = path.isAbsolute(configured) ? [configured] : provider === 'codex'
      ? ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
        '/usr/local/bin/codex', '/opt/homebrew/bin/codex']
      : ['/usr/local/bin/claude', '/opt/homebrew/bin/claude', path.join(os.homedir(), '.local/bin/claude')];
    const found = candidates.find(candidate => fs.existsSync(candidate));
    if (!found) throw new Error('未找到可用的 CLI');
    const resolved = fs.realpathSync(found);
    if (!fs.statSync(resolved).isFile()) throw new Error('CLI 文件无效');
    return resolved;
  }

  private canonicalDirectory(directory: string): string {
    if (typeof directory !== 'string' || directory.length > 4096 || !path.isAbsolute(directory)) throw new Error('工作目录无效');
    const resolved = path.resolve(directory);
    const canonical = fs.realpathSync(resolved);
    if (resolved !== canonical || !fs.statSync(canonical).isDirectory()) throw new Error('工作目录包含符号链接或已变化');
    let current = path.parse(canonical).root;
    for (const part of canonical.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('工作目录包含符号链接');
    }
    return canonical;
  }

  setEnabled(initiatorId: string, provider: Provider, enabled: boolean): void {
    if (!this.segmentId) throw new Error('受管采集服务未就绪');
    const at = this.now();
    this.db.transactionDurable(() => this.db.run(`INSERT INTO managed_sources(initiator_user_id,provider,enabled,enabled_at,changed_at)
      VALUES (?,?,?,?,?) ON CONFLICT(initiator_user_id,provider) DO UPDATE SET
      enabled=excluded.enabled, enabled_at=excluded.enabled_at, changed_at=excluded.changed_at`,
    [initiatorId, provider, enabled ? 1 : 0, enabled ? at : null, at]));
  }

  status(initiatorId: string): { enabled: Record<Provider, boolean>; runs: ManagedRunSummary[]; coverage: 'unknown' } {
    const enabled = { codex: false, claude: false };
    for (const row of this.db.all('SELECT provider,enabled FROM managed_sources WHERE initiator_user_id=?', [initiatorId])) {
      if (row.provider === 'codex' || row.provider === 'claude') enabled[row.provider] = row.enabled === 1;
    }
    const runs = this.db.all(`SELECT id,provider,status,started_at,ended_at,event_count,usage_event_count,error
      FROM managed_runs WHERE initiator_user_id=? ORDER BY started_at DESC LIMIT 20`, [initiatorId]).map(row => ({
      id: String(row.id), provider: row.provider as Provider, status: row.status as ManagedRunSummary['status'],
      startedAt: String(row.started_at), endedAt: row.ended_at ? String(row.ended_at) : null,
      eventCount: Number(row.event_count), usageEventCount: Number(row.usage_event_count),
      error: row.error ? String(row.error) : null,
      result: this.transientResults.get(String(row.id)) ?? null
    }));
    return { enabled, runs, coverage: 'unknown' };
  }

  launch(initiatorId: string, provider: Provider, prompt: string, directory: string): string {
    if (!this.segmentId) throw new Error('受管采集服务未就绪');
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt, 'utf8') > 32_000) throw new Error('任务内容无效');
    const canonical = this.canonicalDirectory(directory);
    if (this.db.one('SELECT enabled FROM managed_sources WHERE initiator_user_id=? AND provider=?', [initiatorId, provider])?.enabled !== 1) {
      throw new Error('请先启用此受管来源');
    }
    const command = this.executable(provider);
    const childEnv: NodeJS.ProcessEnv = { HOME: os.homedir(), USER: os.userInfo().username,
      LOGNAME: os.userInfo().username, TMPDIR: os.tmpdir(), LANG: 'en_US.UTF-8',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin' };
    const version = execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 5_000,
      maxBuffer: 1024, env: childEnv }).trim();
    if (!version || version.length > 100) throw new Error('无法识别 CLI 版本');
    const mode = provider === 'codex' ? 'exec-json-ephemeral' : 'print-stream-json-no-persistence';
    const args = provider === 'codex'
      ? ['exec', '--json', '--ephemeral', '--sandbox', 'read-only', '-C', canonical, '-']
      : ['-p', '--output-format', 'stream-json', '--no-session-persistence', '--permission-mode', 'plan'];
    const id = randomUUID();
    this.runGenerations.set(id, this.transientGeneration);
    const at = this.now();
    const projectKey = createHash('sha256').update(canonical).digest('hex');
    this.db.transactionDurable(() => this.db.run(`INSERT INTO managed_runs
      (id,initiator_user_id,provider,mode,cli_version,protocol_version,project_key,project_label,segment_id,started_at,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,'running')`,
    [id, initiatorId, provider, mode, version, 1, projectKey, path.basename(canonical), this.segmentId, at]));
    let child: ManagedChild;
    try {
      child = spawn(command, args, { cwd: canonical, stdio: ['pipe', 'pipe', 'ignore'], env: childEnv });
    } catch {
      this.fail(id, 'spawn_failed');
      return id;
    }
    this.children.set(id, child);
    let pending = Buffer.alloc(0);
    let byteWatermark = 0;
    let parseFailed = false;
    let finalSeen = false;
    child.stdout!.on('data', (chunk: Buffer) => {
      if (parseFailed || !this.segmentId) return;
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > MAX_LINE_BYTES && !pending.includes(10)) {
        parseFailed = true; this.fail(id, 'stream_line_too_large'); child.kill(); return;
      }
      while (true) {
        const end = pending.indexOf(10);
        if (end < 0) break;
        const line = pending.subarray(0, end);
        pending = pending.subarray(end + 1);
        byteWatermark += end + 1;
        if (line.length > MAX_LINE_BYTES) {
          parseFailed = true; this.fail(id, 'stream_line_too_large'); child.kill(); break;
        }
        try { finalSeen = this.recordLine(id, line, byteWatermark, provider) || finalSeen; }
        catch (error) {
          parseFailed = true;
          const candidate = error instanceof Error ? error.message : '';
          const reason = ['invalid_json', 'unknown_event', 'invalid_usage'].includes(candidate)
            ? candidate : 'ledger_write_error';
          this.fail(id, reason); child.kill(); break;
        }
      }
    });
    child.on('error', () => { parseFailed = true; this.fail(id, 'spawn_failed'); });
    child.on('close', code => {
      this.children.delete(id);
      this.runGenerations.delete(id);
      if (parseFailed || !this.segmentId) return;
      if (pending.length) { this.fail(id, 'incomplete_stream_line'); return; }
      const okay = code === 0 && finalSeen;
      this.db.transactionDurable(() => this.db.run(`UPDATE managed_runs SET ended_at=?,status=?,exit_code=?,
        final_seen=?,error=? WHERE id=? AND status='running'`,
      [this.now(), okay ? 'completed' : 'failed', code, finalSeen ? 1 : 0,
        okay ? null : (code !== 0 ? 'cli_exit_nonzero' : 'missing_final_event'), id]));
    });
    child.stdin!.on('error', () => { /* process exit is recorded by close */ });
    child.stdin!.end(prompt);
    return id;
  }

  private recordLine(id: string, line: Buffer, byteWatermark: number, provider: Provider): boolean {
    let event: Record<string, unknown>;
    try { event = JSON.parse(line.toString('utf8')) as Record<string, unknown>; }
    catch { throw new Error('invalid_json'); }
    if (!event || typeof event.type !== 'string') throw new Error('unknown_event');
    const eventType = event.type;
    const allowed = provider === 'codex'
      ? ['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error']
      : ['system', 'assistant', 'user', 'result', 'stream_event'];
    if (!allowed.includes(eventType)) throw new Error('unknown_event');
    const final = provider === 'codex' ? eventType === 'turn.completed' : eventType === 'result';
    const item = event.item && typeof event.item === 'object' ? event.item as Record<string, unknown> : null;
    const resultText = provider === 'codex' && eventType === 'item.completed' && item?.type === 'agent_message'
      ? item.text : provider === 'claude' && eventType === 'result' ? event.result : null;
    if (typeof resultText === 'string' && this.runGenerations.get(id) === this.transientGeneration) {
      this.transientResults.set(id, resultText.slice(0, 16_000));
    }
    const usage = provider === 'codex' && final && event.usage && typeof event.usage === 'object'
      ? event.usage as Record<string, unknown>
      : provider === 'claude' && final && event.usage && typeof event.usage === 'object'
        ? event.usage as Record<string, unknown> : null;
    const number = (value: unknown): number | null =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    const input = usage ? number(usage.input_tokens) : null;
    const output = usage ? number(usage.output_tokens) : null;
    if (usage && (input === null || output === null)) throw new Error('invalid_usage');
    const row = this.db.one('SELECT event_count FROM managed_runs WHERE id=?', [id]);
    const sequence = Number(row?.event_count ?? 0) + 1;
    this.db.transactionDurable(() => {
      this.db.run(`INSERT INTO managed_events VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, sequence, eventType,
        this.now(), byteWatermark, input, output, usage ? number(usage.cached_input_tokens ?? usage.cache_read_input_tokens) : null,
        usage ? number(usage.cache_creation_input_tokens) : null, null]);
      this.db.run(`UPDATE managed_runs SET event_count=?,usage_event_count=usage_event_count+?,
        byte_watermark=?,final_seen=MAX(final_seen,?) WHERE id=?`,
      [sequence, usage ? 1 : 0, byteWatermark, final ? 1 : 0, id]);
    });
    return final;
  }

  private fail(id: string, reason: string): void {
    try { this.db.transactionDurable(() => this.db.run(
      "UPDATE managed_runs SET status='failed',ended_at=?,error=? WHERE id=? AND status='running'",
      [this.now(), reason, id])); } catch { /* durable store unavailable; coverage remains unknown */ }
  }

  clearTransient(): void {
    this.transientGeneration++;
    this.transientResults.clear();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const [id, child] of this.children) { this.fail(id, 'service_stopped'); child.kill(); }
    this.children.clear();
    this.clearTransient();
    this.runGenerations.clear();
    if (this.segmentId) {
      try { this.db.transactionDurable(() => this.db.run(
        "UPDATE managed_segments SET ended_at=?,status=CASE WHEN status='gap' THEN 'gap' ELSE 'stopped' END WHERE id=? AND ended_at IS NULL",
        [this.now(), this.segmentId])); } catch { /* no healthy continuity can be inferred */ }
    }
    this.segmentId = null;
  }
}
