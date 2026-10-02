import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppDatabase } from '../main/database';
import type { SourceIdentity, SourceStatus } from '../shared/types';
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

async function walkJsonl(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
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
  onLine: (line: string, offset: number) => void
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
    `);
    if (!db.all('PRAGMA table_info(source_cursors)').some(row => row.name === 'tail_hash')) {
      db.run("ALTER TABLE source_cursors ADD COLUMN tail_hash TEXT NOT NULL DEFAULT ''");
    }
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
          code === 'EACCES' || code === 'EPERM' ? '无法读取会话目录，请检查文件权限' : '扫描失败，请检查来源目录');
      } finally {
        this.scanning.delete(provider);
      }
    }
  }

  private async scanProvider(provider: Provider, root: string): Promise<void> {
    if (!fs.existsSync(root)) {
      this.saveStatus(provider, 'not_found', 0, '未找到本机会话目录');
      return;
    }
    const files = await walkJsonl(root);
    let malformed = 0;
    let oversized = 0;
    let unreadable = 0;
    for (const file of files) {
      try {
        const result = await this.scanFile(provider, file);
        malformed += result.malformed;
        oversized += result.oversized;
      } catch (error) {
        unreadable++;
        // A single unreadable or rotated file does not stop other sessions.
      }
    }
    const detail = unreadable || malformed || oversized
      ? `${unreadable} 个文件读取失败，${malformed} 条记录无法解析，${oversized} 条记录超过大小限制`
      : files.length === 0 ? '会话目录中没有记录文件' : null;
    const localCount = Number(this.db.one("SELECT COUNT(*) AS count FROM usage_facts WHERE provider = ? AND source_key NOT LIKE 'otel:%'", [provider])?.count ?? 0);
    this.saveStatus(provider, unreadable || malformed || oversized ? 'error' : localCount === 0 ? 'no_records' : 'ready', files.length,
      detail ?? (localCount === 0 ? '尚未找到可识别的 Token 用量记录' : null));
  }

  private async scanFile(provider: Provider, file: string): Promise<{ malformed: number; oversized: number }> {
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
    });
    state.skippingOversized = result.skippingOversized;
    state.malformedRecords = (state.malformedRecords ?? 0) + malformed;
    state.oversizedRecords = (state.oversizedRecords ?? 0) + result.oversized;
    if (provider === 'codex' && !state.hasUsageRecords) {
      for (const fact of fallback) facts.set(fact.sourceKey, fact);
    }
    const committedTailHash = await tailHash(file, result.offset);
    this.db.transaction(() => {
      for (const fact of facts.values()) this.upsertFact(fact);
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
  }

  private saveStatus(provider: Provider, status: SourceStatus['status'], fileCount: number, detail: string | null): void {
    const factCount = Number(this.db.one("SELECT COUNT(*) AS count FROM usage_facts WHERE provider = ? AND source_key NOT LIKE 'otel:%'", [provider])?.count ?? 0);
    this.db.run(`INSERT INTO source_status VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET status=excluded.status, file_count=excluded.file_count,
      fact_count=excluded.fact_count, last_scan=excluded.last_scan, detail=excluded.detail`,
      [provider, status, fileCount, factCount, new Date().toISOString(), detail]);
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
    this.db.transaction(() => {
      this.db.run('UPDATE source_identities SET owner_user_id = ? WHERE key = ?', [userId, key]);
      this.db.run('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)',
        [randomUUID(), actorId, 'source.identity_bound', key, new Date().toISOString()]);
    });
  }
}
