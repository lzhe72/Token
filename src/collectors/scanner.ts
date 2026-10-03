import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppDatabase } from '../main/database';
import type { CollectionDiagnostic, ScanProgress, SourceIdentity, SourceStatus } from '../shared/types';
import { parseCodexLine } from './codex';
import { parseClaudeLine } from './claude';
import type { LineContext, ParserState, Provider, UsageFact } from './types';

const CHUNK_SIZE = 128 * 1024;
const MAX_LINE_SIZE = 32 * 1024 * 1024;
export const SCAN_INTERVAL_MS = 10 * 60 * 1000;

interface Cursor {
  fileId: string;
  offset: number;
  tailHash: string;
  state: ParserState;
}

function sourceDirectories(): Record<Provider, string> {
  return {
    codex: process.env.TOKEN_CODEX_SESSIONS_DIR || path.join(os.homedir(), '.codex', 'sessions'),
    claude: process.env.TOKEN_CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects')
  };
}

async function walkJsonl(root: string, onDirectory?: () => void): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    onDirectory?.();
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(child);
    }
  }
  await visit(root);
  return result.sort();
}

async function readCompleteLines(
  file: string,
  start: number,
  initialSkipping: boolean,
  onLine: (line: string, offset: number) => void,
  onChunk?: () => void
): Promise<{ offset: number; oversized: number; skippingOversized: boolean }> {
  const handle = await fsp.open(file, 'r');
  let readPosition = start;
  let committed = start;
  let pending = Buffer.alloc(0);
  let oversized = 0;
  let skippingOversized = initialSkipping;
  const chunk = Buffer.allocUnsafe(CHUNK_SIZE);
  try {
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, CHUNK_SIZE, readPosition);
      if (!bytesRead) break;
      onChunk?.();
      readPosition += bytesRead;
      pending = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
      while (true) {
        const newline = pending.indexOf(10);
        if (newline < 0) break;
        const line = pending.subarray(0, newline);
        if (skippingOversized || line.length > MAX_LINE_SIZE) oversized++;
        else onLine(line.toString('utf8'), committed);
        committed += newline + 1;
        pending = pending.subarray(newline + 1);
        skippingOversized = false;
      }
      if (pending.length > MAX_LINE_SIZE) {
        committed += pending.length;
        pending = Buffer.alloc(0);
        skippingOversized = true;
      }
    }
    return { offset: committed, oversized, skippingOversized };
  } finally {
    await handle.close();
  }
}

function hashPath(file: string): string {
  return createHash('sha256').update(file).digest('hex').slice(0, 24);
}

async function tailHash(file: string, offset: number): Promise<string> {
  if (offset === 0) return '';
  const length = Math.min(4096, offset);
  const buffer = Buffer.alloc(length);
  const handle = await fsp.open(file, 'r');
  try { await handle.read(buffer, 0, length, offset - length); }
  finally { await handle.close(); }
  return createHash('sha256').update(buffer).digest('hex');
}

export class UsageScanner {
  private current: Promise<void> | null = null;
  private scanning = new Set<Provider>();
  private progress = new Map<Provider, NonNullable<CollectionDiagnostic['progress']>>();
  private timer: NodeJS.Timeout | null = null;
  private afterScan: (() => Promise<void>) | null = null;

  constructor(private readonly db: AppDatabase) {
    db.run(`
      CREATE TABLE IF NOT EXISTS source_identities (
        key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        owner_user_id TEXT REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS usage_facts (
        source_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        source_identity_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        cache_creation_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS usage_facts_time ON usage_facts(occurred_at);
      CREATE INDEX IF NOT EXISTS usage_facts_provider_model ON usage_facts(provider, model);
      CREATE INDEX IF NOT EXISTS usage_facts_identity ON usage_facts(source_identity_key);
      CREATE INDEX IF NOT EXISTS usage_facts_provider_session ON usage_facts(provider, session_id);
      CREATE TABLE IF NOT EXISTS source_cursors (
        file_path TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        file_id TEXT NOT NULL,
        byte_offset INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        tail_hash TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_status (
        provider TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        file_count INTEGER NOT NULL DEFAULT 0,
        fact_count INTEGER NOT NULL DEFAULT 0,
        last_scan TEXT,
        detail TEXT
      );
      CREATE TABLE IF NOT EXISTS fact_projects (
        source_key TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        project_label TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS fact_projects_key ON fact_projects(project_key);
      CREATE TABLE IF NOT EXISTS scanner_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_audit_refs (
        source_key TEXT PRIMARY KEY,
        audit_ref TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS source_binding_audit (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        old_owner_id TEXT,
        new_owner_id TEXT,
        affected_count INTEGER NOT NULL,
        result_code TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
    `);
    if (!db.all('PRAGMA table_info(source_cursors)').some(row => row.name === 'tail_hash')) {
      db.run("ALTER TABLE source_cursors ADD COLUMN tail_hash TEXT NOT NULL DEFAULT ''");
    }
    if (!db.all('PRAGMA table_info(source_status)').some(row => row.name === 'diagnostic_json')) {
      db.run("ALTER TABLE source_status ADD COLUMN diagnostic_json TEXT NOT NULL DEFAULT '{}'");
    }
    if (!db.all('PRAGMA table_info(source_status)').some(row => row.name === 'last_success')) {
      db.run('ALTER TABLE source_status ADD COLUMN last_success TEXT');
    }
    // A preexisting database has already consumed its cursors. Replay once to attribute historical facts.
    if (!db.one("SELECT value FROM scanner_meta WHERE key = 'project_backfill'")) {
      db.run("UPDATE source_cursors SET byte_offset = 0, state_json = '{}', tail_hash = ''");
      db.run("INSERT INTO scanner_meta VALUES ('project_backfill', '1')");
    }
    this.repairSupersededCodexFallbacks();
    this.redactLegacyBindingAudit();
  }

  private sourceAuditRef(key: string): string {
    const existing = this.db.one('SELECT audit_ref FROM source_audit_refs WHERE source_key = ?', [key]);
    if (existing) return String(existing.audit_ref);
    const reference = randomUUID();
    this.db.run('INSERT INTO source_audit_refs VALUES (?, ?)', [key, reference]);
    return reference;
  }

  private redactLegacyBindingAudit(): void {
    const legacy = this.db.all(`SELECT id, target_id FROM audit_events WHERE action = 'source.identity_bound'
      AND target_id IS NOT NULL AND target_id NOT IN (SELECT audit_ref FROM source_audit_refs)`);
    if (!legacy.length) return;
    this.db.transaction(() => {
      for (const row of legacy) {
        const reference = this.sourceAuditRef(String(row.target_id));
        this.db.run('UPDATE audit_events SET target_id = ? WHERE id = ?', [reference, String(row.id)]);
      }
    });
  }

  recordBindingAudit(key: string, actorId: string, oldOwnerId: string | null,
    newOwnerId: string | null, affectedCount: number): void {
    const reference = this.sourceAuditRef(key);
    this.db.run('INSERT INTO source_binding_audit VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      randomUUID(), actorId, reference, oldOwnerId, newOwnerId, affectedCount, 'success', new Date().toISOString()
    ]);
  }

  private pruneCodexFallbacks(sessionId: string): void {
    const condition = "provider = 'codex' AND session_id = ? AND source_key LIKE 'codex:fallback:%'";
    this.db.run(`DELETE FROM fact_projects WHERE source_key IN
      (SELECT source_key FROM usage_facts WHERE ${condition})`, [sessionId]);
    this.db.run(`DELETE FROM usage_facts WHERE ${condition}`, [sessionId]);
  }

  private repairSupersededCodexFallbacks(): void {
    // Start with fallback sessions. Checking every official fact against the same
    // long session makes startup quadratic even when no fallback exists.
    const sessions = this.db.all(`SELECT DISTINCT session_id FROM usage_facts
      WHERE provider = 'codex' AND source_key LIKE 'codex:fallback:%'`)
      .filter(row => this.db.one(`SELECT 1 FROM usage_facts
        WHERE provider = 'codex' AND session_id = ? AND source_key LIKE 'codex:%'
          AND source_key NOT LIKE 'codex:fallback:%' LIMIT 1`, [String(row.session_id)]));
    if (sessions.length === 0) return;
    this.db.transaction(() => {
      for (const row of sessions) this.pruneCodexFallbacks(String(row.session_id));
      this.db.run(`UPDATE source_status SET fact_count =
        (SELECT COUNT(*) FROM usage_facts WHERE provider = 'codex' AND source_key NOT LIKE 'otel:%')
        WHERE provider = 'codex'`);
    });
  }

  start(): void {
    void this.scan().catch(() => {});
    this.timer = setInterval(() => void this.scan().catch(() => {}), SCAN_INTERVAL_MS);
  }

  setAfterScan(callback: () => Promise<void>): void {
    this.afterScan = callback;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async waitIdle(): Promise<void> {
    if (this.current) await this.current;
  }

  scan(): Promise<void> {
    if (this.current) return this.current;
    this.current = this.scanAll().then(() => this.afterScan?.()).then(() => {}).finally(() => { this.current = null; });
    return this.current;
  }

  private async scanAll(): Promise<void> {
    const directories = sourceDirectories();
    for (const provider of ['codex', 'claude'] as const) {
      this.scanning.add(provider);
      try {
        await this.scanProvider(provider, directories[provider]);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        this.saveStatus(provider, 'error', 0,
          code === 'EACCES' || code === 'EPERM' ? '无法读取会话目录，请检查文件权限' : '扫描失败，请检查来源目录',
          { reason: code === 'EACCES' || code === 'EPERM' ? 'permission_denied' : 'scan_error' });
      } finally {
        this.scanning.delete(provider);
        this.progress.delete(provider);
      }
    }
  }

  private async scanProvider(provider: Provider, root: string): Promise<void> {
    const updateProgress = (phase: 'discovering' | 'reading' | 'finalizing', processedFiles: number, discoveredFiles: number | null) => {
      this.progress.set(provider, { phase, processedFiles, discoveredFiles, lastProgressAt: new Date().toISOString() });
    };
    updateProgress('discovering', 0, null);
    try { await fsp.stat(root); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        this.saveStatus(provider, 'not_found', 0, '未找到本机会话目录', { reason: 'directory_missing' });
        return;
      }
      throw error;
    }
    const files = await walkJsonl(root, () => updateProgress('discovering', 0, null));
    updateProgress('reading', 0, files.length);
    let malformed = 0;
    let oversized = 0;
    let unreadable = 0;
    for (const [index, file] of files.entries()) {
      try {
        const syntheticDelay = Number(process.env.TOKEN_E2E_SCAN_DELAY_MS || 0);
        if (root.startsWith(path.join(os.tmpdir(), 'token-test-db-')) &&
          Number.isInteger(syntheticDelay) && syntheticDelay > 0 && syntheticDelay <= 1000) {
          await new Promise(resolve => setTimeout(resolve, syntheticDelay));
        }
        const result = await this.scanFile(provider, file, () => updateProgress('reading', index, files.length));
        malformed += result.malformed;
        oversized += result.oversized;
      } catch (error) {
        unreadable++;
        // A single unreadable or rotated file does not stop other sessions.
      } finally {
        updateProgress('reading', index + 1, files.length);
      }
    }
    updateProgress('finalizing', files.length, files.length);
    const detail = unreadable || malformed || oversized
      ? `${unreadable} 个文件读取失败，${malformed} 条记录无法解析，${oversized} 条记录超过大小限制`
      : files.length === 0 ? '会话目录中没有记录文件' : null;
    const localCount = Number(this.db.one("SELECT COUNT(*) AS count FROM usage_facts WHERE provider = ? AND source_key NOT LIKE 'otel:%'", [provider])?.count ?? 0);
    this.saveStatus(provider, unreadable || malformed || oversized ? 'error' : localCount === 0 ? 'no_records' : 'ready', files.length,
      detail ?? (localCount === 0 ? '尚未找到可识别的 Token 用量记录' : null),
      { reason: unreadable ? 'unreadable_file' : malformed ? 'invalid_record' : oversized ? 'oversized_record' :
        files.length === 0 ? 'empty_directory' : localCount === 0 ? 'unrecognized_usage' : 'ok',
        malformed, oversized, unreadable });
  }

  private async scanFile(provider: Provider, file: string, onChunk?: () => void): Promise<{ malformed: number; oversized: number }> {
    const stat = await fsp.stat(file);
    const fileId = `${stat.dev}:${stat.ino}`;
    const row = this.db.one('SELECT file_id, byte_offset, state_json, tail_hash FROM source_cursors WHERE file_path = ?', [file]);
    const cursor: Cursor | null = row ? {
      fileId: String(row.file_id),
      offset: Number(row.byte_offset),
      tailHash: String(row.tail_hash),
      state: JSON.parse(String(row.state_json)) as ParserState
    } : null;
    const reset = !cursor || cursor.fileId !== fileId || stat.size < cursor.offset ||
      (cursor.offset > 0 && cursor.tailHash !== await tailHash(file, cursor.offset));
    const state: ParserState = reset ? {} : cursor.state;
    const start = reset ? 0 : cursor.offset;
    if (stat.size === start) return { malformed: state.malformedRecords ?? 0, oversized: state.oversizedRecords ?? 0 };
    const fileKey = hashPath(file);
    const context: LineContext = {
      fileKey,
      lineOffset: 0,
      fallbackIdentityKey: `${provider}:macos:${os.userInfo().uid}`
    };
    const facts = new Map<string, UsageFact>();
    const fallback: UsageFact[] = [];
    let malformed = 0;
    const result = await readCompleteLines(file, start, !!state.skippingOversized, (raw, offset) => {
      if (!raw.trim()) return;
      try {
        context.lineOffset = offset;
        const parsed = JSON.parse(raw) as unknown;
        const outcome = provider === 'codex'
          ? parseCodexLine(parsed, state, context)
          : parseClaudeLine(parsed, state, context);
        if (outcome.fact) {
          const previous = facts.get(outcome.fact.sourceKey);
          if (!previous || outcome.fact.totalTokens >= previous.totalTokens) facts.set(outcome.fact.sourceKey, outcome.fact);
        }
        if (outcome.fallback) fallback.push(outcome.fallback);
      } catch {
        malformed++;
      }
    }, onChunk);
    state.skippingOversized = result.skippingOversized;
    state.malformedRecords = (state.malformedRecords ?? 0) + malformed;
    state.oversizedRecords = (state.oversizedRecords ?? 0) + result.oversized;
    if (provider === 'codex' && !state.hasUsageRecords) {
      for (const fact of fallback) facts.set(fact.sourceKey, fact);
    }
    const committedTailHash = await tailHash(file, result.offset);
    const codexSessions = provider === 'codex'
      ? new Set([...facts.values()].map(fact => fact.sessionId))
      : new Set<string>();
    this.db.transaction(() => {
      for (const fact of facts.values()) this.upsertFact(fact);
      for (const sessionId of codexSessions) {
        if (this.db.one(`SELECT 1 FROM usage_facts WHERE provider = 'codex' AND session_id = ?
          AND source_key LIKE 'codex:%' AND source_key NOT LIKE 'codex:fallback:%' LIMIT 1`, [sessionId])) {
          this.pruneCodexFallbacks(sessionId);
        }
      }
      this.db.run(`INSERT INTO source_cursors(file_path, provider, file_id, byte_offset, state_json, tail_hash, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET provider=excluded.provider, file_id=excluded.file_id,
        byte_offset=excluded.byte_offset, state_json=excluded.state_json, tail_hash=excluded.tail_hash, updated_at=excluded.updated_at`,
        [file, provider, fileId, result.offset, JSON.stringify(state), committedTailHash, new Date().toISOString()]);
    });
    return { malformed: state.malformedRecords, oversized: state.oversizedRecords };
  }

  private upsertFact(fact: UsageFact): void {
    this.db.run('INSERT OR IGNORE INTO source_identities(key, provider, label) VALUES (?, ?, ?)',
      [fact.sourceIdentityKey, fact.provider, fact.sourceIdentityLabel]);
    this.db.run(`INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET model=excluded.model, occurred_at=excluded.occurred_at,
      input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
      cache_read_tokens=excluded.cache_read_tokens, cache_creation_tokens=excluded.cache_creation_tokens,
      total_tokens=excluded.total_tokens
      WHERE excluded.total_tokens >= usage_facts.total_tokens`, [
      fact.sourceKey, fact.provider, fact.sourceIdentityKey, fact.sessionId, fact.model, fact.occurredAt,
      fact.inputTokens, fact.outputTokens, fact.cacheReadTokens, fact.cacheCreationTokens, fact.totalTokens
    ]);
    if (fact.projectKey && fact.projectLabel) {
      this.db.run(`INSERT INTO fact_projects(source_key, project_key, project_label) VALUES (?, ?, ?)
        ON CONFLICT(source_key) DO UPDATE SET project_key=excluded.project_key, project_label=excluded.project_label`,
        [fact.sourceKey, fact.projectKey, fact.projectLabel]);
    }
  }

  private saveStatus(provider: Provider, status: SourceStatus['status'], fileCount: number, detail: string | null,
    diagnostic: { reason: string; malformed?: number; oversized?: number; unreadable?: number } = { reason: 'unknown' }): void {
    const factCount = Number(this.db.one("SELECT COUNT(*) AS count FROM usage_facts WHERE provider = ? AND source_key NOT LIKE 'otel:%'", [provider])?.count ?? 0);
    const now = new Date().toISOString();
    this.db.run(`INSERT INTO source_status(provider, status, file_count, fact_count, last_scan, detail, diagnostic_json, last_success)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET status=excluded.status, file_count=excluded.file_count,
      fact_count=excluded.fact_count, last_scan=excluded.last_scan, detail=excluded.detail,
      diagnostic_json=excluded.diagnostic_json, last_success=COALESCE(excluded.last_success, source_status.last_success)`,
      [provider, status, fileCount, factCount, now, detail, JSON.stringify(diagnostic),
        status === 'ready' || status === 'no_records' ? now : null]);
  }

  diagnostics(): CollectionDiagnostic[] {
    const labels = { codex: '~/.codex/sessions', claude: '~/.claude/projects' };
    const suggestions: Record<string, string> = {
      directory_missing: '确认工具已产生本机会话记录，然后重新扫描。',
      permission_denied: '在系统设置中检查文件访问权限，授权后重新打开应用并扫描。',
      unreadable_file: '检查会话文件权限和磁盘状态，修复后重新扫描。',
      invalid_record: '部分记录格式无法识别，可通过问题反馈提交脱敏诊断。',
      oversized_record: '部分记录超过安全大小限制，可通过问题反馈报告。',
      empty_directory: '目录存在但没有会话文件，请先使用对应工具。',
      unrecognized_usage: '发现会话文件但没有可识别的用量；检查工具版本或启用可选遥测。',
      ok: '采集正常；如仍有缺口，请核对来源归属和报表时间范围。',
      scan_error: '检查来源目录及磁盘状态后重新扫描。'
    };
    return this.statuses().map(status => {
      const row = this.db.one('SELECT diagnostic_json, last_success FROM source_status WHERE provider = ?', [status.provider]);
      let diagnostic: { reason?: string; malformed?: number; oversized?: number; unreadable?: number } = {};
      try { diagnostic = JSON.parse(String(row?.diagnostic_json ?? '{}')); } catch { /* old database */ }
      const reason = diagnostic.reason || (status.status === 'idle' ? 'not_scanned' : 'scan_error');
      const unknownProjectCount = Number(this.db.one(`SELECT COUNT(*) AS count FROM usage_facts f
        LEFT JOIN fact_projects p ON p.source_key=f.source_key WHERE f.provider=? AND f.source_key NOT LIKE 'otel:%'
        AND p.source_key IS NULL`, [status.provider])?.count ?? 0);
      const unassignedFactCount = Number(this.db.one(`SELECT COUNT(*) AS count FROM usage_facts f
        LEFT JOIN source_identities s ON s.key=f.source_identity_key
        WHERE f.provider=? AND s.owner_user_id IS NULL`, [status.provider])?.count ?? 0);
      let pendingTailCount = 0;
      for (const cursor of this.db.all('SELECT file_path, byte_offset FROM source_cursors WHERE provider = ?', [status.provider])) {
        try { if (fs.statSync(String(cursor.file_path)).size > Number(cursor.byte_offset)) pendingTailCount++; }
        catch { /* a rotated file is handled by the next scan */ }
      }
      return {
        provider: status.provider, status: status.status, location: labels[status.provider],
        fileCount: status.fileCount ?? 0, factCount: status.factCount ?? 0, unknownProjectCount,
        unassignedFactCount, pendingTailCount,
        malformedCount: diagnostic.malformed ?? 0, oversizedCount: diagnostic.oversized ?? 0,
        unreadableCount: diagnostic.unreadable ?? 0, lastScan: status.lastScan,
        lastSuccess: row?.last_success ? String(row.last_success) : null, reason,
        suggestion: pendingTailCount && reason === 'ok' ? '部分文件有尚未结束的记录行；待工具写完后再次扫描。' :
          suggestions[reason] || '运行一次扫描并查看来源状态。',
        progress: this.progress.get(status.provider)
      };
    });
  }

  scanProgress(): ScanProgress[] {
    return [...this.progress.entries()].map(([provider, progress]) => ({ provider, progress }));
  }

  statuses(): SourceStatus[] {
    return (['codex', 'claude'] as const).map(provider => {
      const row = this.db.one('SELECT * FROM source_status WHERE provider = ?', [provider]);
      const telemetry = this.db.one("SELECT COUNT(*) AS count, MAX(occurred_at) AS latest FROM usage_facts WHERE provider = ? AND source_key LIKE 'otel:%'", [provider]);
      const telemetryFactCount = Number(telemetry?.count ?? 0);
      const localStatus = row?.status as SourceStatus['status'] ?? 'idle';
      return {
        provider,
        status: this.scanning.has(provider) ? 'scanning' : telemetryFactCount > 0 && (localStatus === 'not_found' || localStatus === 'no_records') ? 'ready' : localStatus,
        fileCount: Number(row?.file_count ?? 0),
        factCount: Number(row?.fact_count ?? 0),
        telemetryFactCount,
        lastTelemetry: telemetry?.latest ? String(telemetry.latest) : null,
        lastScan: row?.last_scan ? String(row.last_scan) : null,
        detail: telemetryFactCount > 0 && (localStatus === 'not_found' || localStatus === 'no_records')
          ? '本地暂无可用记录；已收到遥测数据'
          : row?.detail ? String(row.detail) : null
      };
    });
  }

  identities(): SourceIdentity[] {
    return this.db.all(`SELECT s.key, s.provider, s.label, s.owner_user_id, COUNT(f.source_key) AS fact_count
      FROM source_identities s LEFT JOIN usage_facts f ON f.source_identity_key = s.key
      GROUP BY s.key ORDER BY s.provider, s.label`).map(row => ({
      key: String(row.key),
      provider: row.provider as Provider,
      label: String(row.label),
      ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
      factCount: Number(row.fact_count)
    }));
  }

  bindIdentity(key: unknown, userId: unknown, actorId: string): void {
    if (typeof key !== 'string' || (userId !== null && typeof userId !== 'string')) throw new Error('归属参数无效');
    if (!this.db.one('SELECT key FROM source_identities WHERE key = ?', [key])) throw new Error('来源不存在');
    if (userId !== null && !this.db.one('SELECT id FROM users WHERE id = ? AND active = 1', [userId])) {
      throw new Error('目标用户不存在或已停用');
    }
    this.db.transactionDurable(() => {
      const oldOwnerId = this.db.one('SELECT owner_user_id FROM source_identities WHERE key = ?', [key])?.owner_user_id;
      const affectedCount = Number(this.db.one('SELECT COUNT(*) AS count FROM usage_facts WHERE source_identity_key = ?', [key])?.count ?? 0);
      this.db.run('UPDATE source_identities SET owner_user_id = ? WHERE key = ?', [userId, key]);
      this.recordBindingAudit(key, actorId, oldOwnerId ? String(oldOwnerId) : null, userId, affectedCount);
    });
  }
}
