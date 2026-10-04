import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppDatabase } from '../main/database';
import type { CollectionDiagnostic, ScanProgress, SourceIdentity, SourceStatus } from '../shared/types';
import { parseCodexLine } from './codex';
import { parseClaudeLine } from './claude';
import { claudeFileKey, scopedLocalFactKey } from './fact-key';
import type { LineContext, ParserState, Provider, UsageFact } from './types';

const CHUNK_SIZE = 128 * 1024;
const MAX_LINE_SIZE = 32 * 1024 * 1024;
export const SCAN_INTERVAL_MS = 10 * 60 * 1000;
const LOCAL_DEFAULT_ACTOR = 'system:local-single-user';

interface Cursor {
  fileId: string;
  birthtimeMs: number;
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

async function walkJsonl(root: string, onDirectory?: () => void, shouldStop?: () => boolean): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string): Promise<void> {
    if (shouldStop?.()) return;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    if (shouldStop?.()) return;
    onDirectory?.();
    for (const entry of entries) {
      if (shouldStop?.()) break;
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
  private historicalFactsChanged = false;
  private current: Promise<void> | null = null;
  private scanning = new Set<Provider>();
  private progress = new Map<Provider, NonNullable<CollectionDiagnostic['progress']>>();
  private timer: NodeJS.Timeout | null = null;
  private afterScan: (() => Promise<void>) | null = null;
  private cancelRequested = false;

  constructor(private readonly db: AppDatabase,
    private readonly singleUserClaudeDefault = false) {
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
        birthtime_ms REAL NOT NULL DEFAULT 0,
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
      CREATE TABLE IF NOT EXISTS source_deferrals (
        actor_id TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        PRIMARY KEY(actor_id, source_ref)
      );
      CREATE TABLE IF NOT EXISTS source_binding_audit (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        old_owner_id TEXT,
        new_owner_id TEXT,
        affected_count INTEGER NOT NULL,
        result_code TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        evidence_category TEXT NOT NULL DEFAULT '',
        evidence_source TEXT NOT NULL DEFAULT '',
        evidence_ref TEXT NOT NULL DEFAULT '',
        verification_status TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS usage_uncertain_facts (
        source_key TEXT PRIMARY KEY,
        reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS identity_migration_events (
        id TEXT PRIMARY KEY, affected_user_id TEXT, reason_code TEXT NOT NULL,
        source_ref TEXT NOT NULL, occurred_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS legacy_claude_cursor_evidence (
        file_path TEXT PRIMARY KEY, file_id TEXT NOT NULL, birthtime_ms REAL NOT NULL,
        session_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS legacy_reconciled_facts (
        source_key TEXT PRIMARY KEY, archived_fact TEXT NOT NULL,
        replacement_key TEXT NOT NULL, archived_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS unknown_claude_file_generations (
        file_path TEXT PRIMARY KEY, file_id TEXT NOT NULL, generation TEXT NOT NULL
      );
    `);
    if (!db.all('PRAGMA table_info(source_cursors)').some(row => row.name === 'tail_hash')) {
      db.run("ALTER TABLE source_cursors ADD COLUMN tail_hash TEXT NOT NULL DEFAULT ''");
    }
    if (!db.all('PRAGMA table_info(source_cursors)').some(row => row.name === 'birthtime_ms')) {
      db.run('ALTER TABLE source_cursors ADD COLUMN birthtime_ms REAL NOT NULL DEFAULT 0');
    }
    for (const column of ['evidence_category', 'evidence_source', 'evidence_ref', 'verification_status']) {
      if (!db.all('PRAGMA table_info(source_binding_audit)').some(row => row.name === column)) {
        db.run(`ALTER TABLE source_binding_audit ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
      }
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
    this.migrateLocalFactKeys();
    this.repairSupersededCodexFallbacks();
    this.redactLegacyBindingAudit();
  }

  didQuarantineLegacyFacts(): boolean { return this.historicalFactsChanged; }

  private migrateLocalFactKeys(): void {
    // Recheck on every open: an older app may have written legacy keys after a
    // rollback. The query is indexed by source_key and is read-only when empty.
    const legacy = this.db.all(`SELECT source_key, source_identity_key FROM usage_facts
      WHERE (source_key LIKE 'codex:%' OR source_key LIKE 'claude:%')
        AND source_key NOT LIKE 'codex:v2:%'
        AND source_key NOT LIKE 'codex:fallback:v2:%'
        AND source_key NOT LIKE 'claude:v2:%'`);
    if (legacy.length) this.historicalFactsChanged = true;
    this.db.transaction(() => {
      const audited = new Set<string>();
      const needsClaudeEvidence = legacy.some(row => String(row.source_key).startsWith('claude:')) ||
        !!this.db.one("SELECT 1 FROM source_identities WHERE key LIKE 'claude:macos:%' LIMIT 1");
      const priorClaude = needsClaudeEvidence
        ? this.db.all("SELECT file_path, file_id, birthtime_ms, state_json FROM source_cursors WHERE provider = 'claude'") : [];
      for (const cursor of priorClaude) {
        try {
          const file = String(cursor.file_path);
          const state = JSON.parse(String(cursor.state_json)) as ParserState;
          const stat = fs.statSync(file);
          if (state.sessionId && Number(cursor.birthtime_ms) > 0 &&
            Number(cursor.birthtime_ms) === stat.birthtimeMs &&
            `${stat.dev}:${stat.ino}` === String(cursor.file_id)) {
            this.db.run('INSERT OR IGNORE INTO legacy_claude_cursor_evidence VALUES (?, ?, ?, ?)',
              [file, String(cursor.file_id), stat.birthtimeMs, state.sessionId]);
          }
        } catch { /* a missing or unreadable file cannot prove its old facts */ }
      }
      for (const row of legacy) {
        const oldKey = String(row.source_key);
        const originalIdentity = String(row.source_identity_key);
        const nextKey = scopedLocalFactKey(oldKey, originalIdentity);
        const provider = oldKey.startsWith('codex:') ? 'codex' : 'claude';
        const unknownIdentity = `${provider}:legacy-unverified:${createHash('sha256')
          .update(originalIdentity).digest('hex').slice(0, 24)}`;
        this.db.run('INSERT OR IGNORE INTO source_identities(key, provider, label) VALUES (?, ?, ?)',
          [unknownIdentity, provider, `${provider === 'codex' ? 'Codex' : 'Claude Code'} · 旧记录待重扫`]);
        if (!audited.has(originalIdentity)) {
          audited.add(originalIdentity);
          const owner = this.db.one('SELECT owner_user_id FROM source_identities WHERE key = ?', [originalIdentity])?.owner_user_id;
          if (owner) {
            const reference = createHash('sha256').update(originalIdentity).digest('hex').slice(0, 24);
            const occurredAt = new Date().toISOString();
            this.db.run('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)',
              [randomUUID(), null, 'collector.legacy_fact_quarantined', reference, occurredAt]);
            this.db.run('INSERT INTO identity_migration_events VALUES (?, ?, ?, ?, ?)',
              [randomUUID(), String(owner), 'legacy_local_key_unverified', reference, occurredAt]);
          }
        }
        if (this.db.one('SELECT 1 FROM usage_facts WHERE source_key = ?', [nextKey])) {
          this.db.run('UPDATE usage_facts SET source_identity_key = ? WHERE source_key = ?', [unknownIdentity, oldKey]);
          this.db.run('INSERT OR IGNORE INTO usage_uncertain_facts VALUES (?, ?)', [oldKey, 'legacy_key_collision']);
          this.db.run('INSERT OR IGNORE INTO usage_uncertain_facts VALUES (?, ?)', [nextKey, 'legacy_key_collision']);
          continue;
        }
        this.db.run('UPDATE usage_facts SET source_key = ?, source_identity_key = ? WHERE source_key = ?',
          [nextKey, unknownIdentity, oldKey]);
        this.db.run('UPDATE fact_projects SET source_key = ? WHERE source_key = ?', [nextKey, oldKey]);
        // Historical collisions may already have overwritten another source's
        // numbers. A replay of the actual file clears this marker; missing files
        // remain visible only as pending, never as a confirmed zero or total.
        this.db.run('INSERT OR IGNORE INTO usage_uncertain_facts VALUES (?, ?)', [nextKey, 'legacy_unverified']);
      }
      // A macOS UID cannot prove a Claude account. Retire the old mixed source
      // even if its fact keys had already been upgraded by an earlier build.
      const oldClaude = this.db.all("SELECT key, owner_user_id FROM source_identities WHERE key LIKE 'claude:macos:%'");
      for (const source of oldClaude) {
        const identity = String(source.key);
        const reference = createHash('sha256').update(identity).digest('hex').slice(0, 24);
        const unknownIdentity = `claude:legacy-unverified:${reference}`;
        const remaining = this.db.all('SELECT source_key FROM usage_facts WHERE source_identity_key = ?', [identity]);
        if (remaining.length) this.db.run('INSERT OR IGNORE INTO source_identities(key, provider, label) VALUES (?, ?, ?)',
          [unknownIdentity, 'claude', 'Claude Code · 旧记录待重扫']);
        for (const fact of remaining) {
          const key = String(fact.source_key);
          this.db.run('UPDATE usage_facts SET source_identity_key = ? WHERE source_key = ?', [unknownIdentity, key]);
          this.db.run('INSERT OR IGNORE INTO usage_uncertain_facts VALUES (?, ?)', [key, 'legacy_unverified']);
        }
        if (source.owner_user_id && remaining.length && !audited.has(identity)) {
          const occurredAt = new Date().toISOString();
          this.db.run('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)',
            [randomUUID(), null, 'collector.legacy_fact_quarantined', reference, occurredAt]);
          this.db.run('INSERT INTO identity_migration_events VALUES (?, ?, ?, ?, ?)',
            [randomUUID(), String(source.owner_user_id), 'legacy_local_key_unverified', reference, occurredAt]);
        }
        this.db.run('DELETE FROM source_identities WHERE key = ?', [identity]);
      }
      if (oldClaude.length) this.historicalFactsChanged = true;
      if (legacy.length || oldClaude.length) this.db.run("UPDATE source_cursors SET byte_offset = 0, state_json = '{}', tail_hash = ''");
      if (legacy.length) this.db.run("INSERT OR IGNORE INTO scanner_meta VALUES ('local_fact_key_v2', '1')");
    });
  }

  private sourceAuditRef(key: string): string {
    const existing = this.db.one('SELECT audit_ref FROM source_audit_refs WHERE source_key = ?', [key]);
    if (existing) return String(existing.audit_ref);
    const reference = randomUUID();
    this.db.run('INSERT INTO source_audit_refs VALUES (?, ?)', [key, reference]);
    return reference;
  }

  deferredSourceKeys(actorId: string): string[] {
    return this.db.all(`SELECT d.source_ref FROM source_deferrals d
      JOIN source_identities i ON i.key=d.source_ref
      WHERE d.actor_id=? AND i.owner_user_id IS NULL AND i.key LIKE 'claude:local-file:%'
      ORDER BY d.source_ref`, [actorId]).map(row => String(row.source_ref));
  }

  setSourceDeferred(actorId: string, key: unknown, deferred: unknown): string[] {
    if (typeof key !== 'string' || !/^claude:local-file:[a-f0-9]{24}$/.test(key) || typeof deferred !== 'boolean') {
      throw new Error('暂缓来源无效');
    }
    this.db.transactionDurable(() => {
      const source = this.db.one('SELECT owner_user_id FROM source_identities WHERE key=?', [key]);
      if (!source || source.owner_user_id !== null) throw new Error('来源已变化，请刷新列表');
      if (deferred) this.db.run('INSERT OR IGNORE INTO source_deferrals VALUES (?, ?)', [actorId, key]);
      else this.db.run('DELETE FROM source_deferrals WHERE actor_id=? AND source_ref=?', [actorId, key]);
    });
    return this.deferredSourceKeys(actorId);
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
    newOwnerId: string | null, affectedCount: number, evidence?: {
      evidenceCategory: string; evidenceSource: string; evidenceRef: string; verificationStatus?: string
    }): void {
    const reference = this.sourceAuditRef(key);
    this.db.run(`INSERT INTO source_binding_audit
      (id, actor_id, source_ref, old_owner_id, new_owner_id, affected_count, result_code, occurred_at,
       evidence_category, evidence_source, evidence_ref, verification_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      randomUUID(), actorId, reference, oldOwnerId, newOwnerId, affectedCount, 'success', new Date().toISOString(),
      evidence?.evidenceCategory ?? '', evidence?.evidenceSource ?? '', evidence?.evidenceRef ?? '',
      evidence?.verificationStatus ?? (evidence ? 'admin_manual_confirmed' : '')
    ]);
  }

  private soleLocalOwnerId(): string | null {
    if (!this.singleUserClaudeDefault) return null;
    const users = this.db.all('SELECT id, role, active FROM users LIMIT 2');
    return users.length === 1 && users[0].role === 'admin' && Number(users[0].active) === 1
      ? String(users[0].id) : null;
  }

  private autoBindLocalSource(key: string, ownerId: string): boolean {
    if (!/^claude:local-file:[a-f0-9]{24}$/.test(key)) return false;
    const source = this.db.one('SELECT owner_user_id FROM source_identities WHERE key = ?', [key]);
    if (!source || source.owner_user_id !== null) return false;
    // A manual unbind is an explicit exception to the single-user default.
    if (this.db.one(`SELECT 1 FROM source_binding_audit a
      JOIN source_audit_refs r ON r.audit_ref = a.source_ref
      WHERE r.source_key = ? AND a.actor_id <> ? LIMIT 1`, [key, LOCAL_DEFAULT_ACTOR])) return false;
    const affected = Number(this.db.one('SELECT COUNT(*) AS count FROM usage_facts WHERE source_identity_key = ?', [key])?.count ?? 0);
    if (affected === 0) return false;
    this.db.run('UPDATE source_identities SET owner_user_id = ? WHERE key = ? AND owner_user_id IS NULL', [ownerId, key]);
    this.recordBindingAudit(key, LOCAL_DEFAULT_ACTOR, null, ownerId, affected, {
      evidenceCategory: 'local_profile_single_user', evidenceSource: 'macos_user_home',
      evidenceRef: '', verificationStatus: 'device_scope_assumed'
    });
    return true;
  }

  /** Bind only still-present files whose stored cursor proves the same file generation. */
  assignKnownLocalSources(): number {
    const ownerId = this.soleLocalOwnerId();
    if (!ownerId) return 0;
    let root: string;
    try { root = fs.realpathSync(sourceDirectories().claude); }
    catch { return 0; }
    const candidates = new Set<string>();
    for (const row of this.db.all("SELECT file_path, file_id, birthtime_ms FROM source_cursors WHERE provider = 'claude'")) {
      const file = String(row.file_path);
      try {
        const actual = fs.realpathSync(file);
        const relative = path.relative(root, actual);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
        fs.accessSync(actual, fs.constants.R_OK);
        const stat = fs.statSync(actual);
        if (!stat.isFile() || `${stat.dev}:${stat.ino}` !== String(row.file_id) ||
          stat.birthtimeMs !== Number(row.birthtime_ms)) continue;
        const fileKey = claudeFileKey(os.userInfo().uid, String(row.file_id), stat.birthtimeMs);
        if (fileKey) candidates.add(`claude:local-file:${fileKey}`);
      } catch { /* missing, inaccessible or changed file remains unassigned */ }
    }
    const pending = [...candidates].filter(key => this.db.one(
      'SELECT 1 FROM source_identities WHERE key = ? AND owner_user_id IS NULL', [key]));
    let changed = 0;
    if (pending.length) this.db.transactionDurable(() => {
      for (const key of pending) if (this.autoBindLocalSource(key, ownerId)) changed++;
    });
    return changed;
  }

  private pruneCodexFallbacks(sessionId: string, identity: string): void {
    const condition = "provider = 'codex' AND session_id = ? AND source_identity_key = ? AND source_key LIKE 'codex:fallback:%'";
    this.db.run(`DELETE FROM fact_projects WHERE source_key IN
      (SELECT source_key FROM usage_facts WHERE ${condition})`, [sessionId, identity]);
    this.db.run(`DELETE FROM usage_uncertain_facts WHERE source_key IN
      (SELECT source_key FROM usage_facts WHERE ${condition})`, [sessionId, identity]);
    this.db.run(`DELETE FROM usage_facts WHERE ${condition}`, [sessionId, identity]);
  }

  private repairSupersededCodexFallbacks(): void {
    // Start with fallback sessions. Checking every official fact against the same
    // long session makes startup quadratic even when no fallback exists.
    const sessions = this.db.all(`SELECT DISTINCT session_id, source_identity_key FROM usage_facts
      WHERE provider = 'codex' AND source_key LIKE 'codex:fallback:%'`)
      .filter(row => this.db.one(`SELECT 1 FROM usage_facts
        WHERE provider = 'codex' AND session_id = ? AND source_identity_key = ? AND source_key LIKE 'codex:%'
          AND source_key NOT LIKE 'codex:fallback:%' LIMIT 1`, [String(row.session_id), String(row.source_identity_key)]));
    if (sessions.length === 0) return;
    this.db.transaction(() => {
      for (const row of sessions) this.pruneCodexFallbacks(String(row.session_id), String(row.source_identity_key));
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
    this.cancelRequested = false;
    this.current = this.scanAll().then(completed => completed ? this.afterScan?.() : undefined)
      .then(() => {}).finally(() => { this.current = null; });
    return this.current;
  }

  cancelScan(): boolean {
    if (!this.current || this.scanning.size === 0) return false;
    this.cancelRequested = true;
    for (const provider of this.scanning) {
      const previous = this.progress.get(provider);
      if (previous) this.progress.set(provider, { ...previous, phase: 'cancelling', lastProgressAt: new Date().toISOString() });
    }
    return true;
  }

  private async scanAll(): Promise<boolean> {
    const directories = sourceDirectories();
    for (const provider of ['codex', 'claude'] as const) {
      if (this.cancelRequested) break;
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
    return !this.cancelRequested;
  }

  private async scanProvider(provider: Provider, root: string): Promise<void> {
    const updateProgress = (phase: 'discovering' | 'reading' | 'finalizing', processedFiles: number, discoveredFiles: number | null) => {
      this.progress.set(provider, { phase: this.cancelRequested ? 'cancelling' : phase,
        processedFiles, discoveredFiles, lastProgressAt: new Date().toISOString() });
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
    const files = await walkJsonl(root, () => updateProgress('discovering', 0, null), () => this.cancelRequested);
    updateProgress('reading', 0, files.length);
    let malformed = 0;
    let oversized = 0;
    let unreadable = 0;
    let processedFiles = 0;
    for (const [index, file] of files.entries()) {
      if (this.cancelRequested) break;
      let attempted = false;
      try {
        const syntheticDelay = Number(process.env.TOKEN_E2E_SCAN_DELAY_MS || 0);
        if (root.startsWith(path.join(os.tmpdir(), 'token-test-db-')) &&
          Number.isInteger(syntheticDelay) && syntheticDelay > 0 && syntheticDelay <= 1000) {
          await new Promise(resolve => setTimeout(resolve, syntheticDelay));
        }
        if (this.cancelRequested) break;
        attempted = true;
        const result = await this.scanFile(provider, file, () => updateProgress('reading', index, files.length));
        malformed += result.malformed;
        oversized += result.oversized;
      } catch (error) {
        unreadable++;
        // A single unreadable or rotated file does not stop other sessions.
      } finally {
        if (attempted) processedFiles = index + 1;
        updateProgress('reading', processedFiles, files.length);
      }
    }
    if (this.cancelRequested) {
      this.saveStatus(provider, 'cancelled', processedFiles,
        '扫描已取消；已处理文件保留为已观测，完整覆盖未知，可重新扫描续扫。', { reason: 'scan_cancelled' });
      return;
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
    const row = this.db.one('SELECT file_id, byte_offset, state_json, tail_hash, birthtime_ms FROM source_cursors WHERE file_path = ?', [file]);
    const cursor: Cursor | null = row ? {
      fileId: String(row.file_id),
      birthtimeMs: Number(row.birthtime_ms),
      offset: Number(row.byte_offset),
      tailHash: String(row.tail_hash),
      state: JSON.parse(String(row.state_json)) as ParserState
    } : null;
    const reset = !cursor || cursor.fileId !== fileId ||
      (provider === 'claude' && cursor.birthtimeMs !== stat.birthtimeMs) || stat.size < cursor.offset ||
      (cursor.offset > 0 && cursor.tailHash !== await tailHash(file, cursor.offset));
    const state: ParserState = reset ? {} : cursor.state;
    const start = reset ? 0 : cursor.offset;
    if (stat.size === start) return { malformed: state.malformedRecords ?? 0, oversized: state.oversizedRecords ?? 0 };
    const verifiedClaudeFileKey = provider === 'claude'
      ? claudeFileKey(os.userInfo().uid, fileId, stat.birthtimeMs) : null;
    const storedUnknown = provider === 'claude' && !verifiedClaudeFileKey
      ? this.db.one('SELECT file_id, generation FROM unknown_claude_file_generations WHERE file_path = ?', [file]) : null;
    const unknownGeneration = provider === 'claude' && !verifiedClaudeFileKey
      ? !reset && storedUnknown?.file_id === fileId ? String(storedUnknown.generation) : randomUUID() : null;
    const fileKey = provider === 'claude' ? verifiedClaudeFileKey ?? unknownGeneration!.replaceAll('-', '').slice(0, 24)
      : hashPath(file);
    const context: LineContext = {
      fileKey,
      lineOffset: 0,
      fallbackIdentityKey: provider === 'claude' ? `${verifiedClaudeFileKey ? 'claude:local-file' : 'claude:local-file-unknown'}:${fileKey}` :
        `${provider}:macos:${os.userInfo().uid}`
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
      ? new Map([...facts.values()].map(fact => [`${fact.sessionId}\0${fact.sourceIdentityKey}`, fact]))
      : new Map<string, UsageFact>();
    this.db.transactionDurable(() => {
      for (const fact of facts.values()) {
        this.upsertFact(fact);
        if (provider === 'claude') this.reconcileLegacyClaudeFact(fact, file, fileId, stat.birthtimeMs);
      }
      for (const fact of codexSessions.values()) {
        if (this.db.one(`SELECT 1 FROM usage_facts WHERE provider = 'codex' AND session_id = ?
          AND source_identity_key = ? AND source_key LIKE 'codex:%'
          AND source_key NOT LIKE 'codex:fallback:%' LIMIT 1`, [fact.sessionId, fact.sourceIdentityKey])) {
          this.pruneCodexFallbacks(fact.sessionId, fact.sourceIdentityKey);
        }
      }
      this.db.run(`INSERT INTO source_cursors(file_path, provider, file_id, byte_offset, state_json, tail_hash, birthtime_ms, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET provider=excluded.provider, file_id=excluded.file_id,
        byte_offset=excluded.byte_offset, state_json=excluded.state_json, tail_hash=excluded.tail_hash,
        birthtime_ms=excluded.birthtime_ms, updated_at=excluded.updated_at`,
        [file, provider, fileId, result.offset, JSON.stringify(state), committedTailHash, stat.birthtimeMs, new Date().toISOString()]);
      if (unknownGeneration) this.db.run(`INSERT INTO unknown_claude_file_generations VALUES (?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET file_id=excluded.file_id, generation=excluded.generation`,
        [file, fileId, unknownGeneration]);
      const ownerId = verifiedClaudeFileKey ? this.soleLocalOwnerId() : null;
      if (ownerId) this.autoBindLocalSource(`claude:local-file:${verifiedClaudeFileKey}`, ownerId);
    });
    return { malformed: state.malformedRecords, oversized: state.oversizedRecords };
  }

  private upsertFact(fact: UsageFact): void {
    const legacyUnverified = !!this.db.one(`SELECT 1 FROM usage_uncertain_facts
      WHERE source_key = ? AND reason = 'legacy_unverified'`, [fact.sourceKey]);
    this.db.run('INSERT OR IGNORE INTO source_identities(key, provider, label) VALUES (?, ?, ?)',
      [fact.sourceIdentityKey, fact.provider, fact.sourceIdentityLabel]);
    this.db.run(`INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
      source_identity_key=CASE WHEN EXISTS (SELECT 1 FROM usage_uncertain_facts u
        WHERE u.source_key=usage_facts.source_key AND u.reason='legacy_unverified')
        THEN excluded.source_identity_key ELSE usage_facts.source_identity_key END,
      model=excluded.model, occurred_at=excluded.occurred_at,
      input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
      cache_read_tokens=excluded.cache_read_tokens, cache_creation_tokens=excluded.cache_creation_tokens,
      total_tokens=excluded.total_tokens
      WHERE excluded.total_tokens >= usage_facts.total_tokens OR EXISTS
        (SELECT 1 FROM usage_uncertain_facts u WHERE u.source_key = usage_facts.source_key
          AND u.reason = 'legacy_unverified')`, [
      fact.sourceKey, fact.provider, fact.sourceIdentityKey, fact.sessionId, fact.model, fact.occurredAt,
      fact.inputTokens, fact.outputTokens, fact.cacheReadTokens, fact.cacheCreationTokens, fact.totalTokens
    ]);
    this.db.run("DELETE FROM usage_uncertain_facts WHERE source_key = ? AND reason = 'legacy_unverified'", [fact.sourceKey]);
    if (fact.sourceIdentityKey.startsWith('claude:local-file-unknown:')) {
      this.db.run('INSERT OR IGNORE INTO usage_uncertain_facts VALUES (?, ?)', [fact.sourceKey, 'file_generation_unknown']);
    }
    if (fact.projectKey && fact.projectLabel) {
      this.db.run(`INSERT INTO fact_projects(source_key, project_key, project_label) VALUES (?, ?, ?)
        ON CONFLICT(source_key) DO UPDATE SET project_key=excluded.project_key, project_label=excluded.project_label`,
        [fact.sourceKey, fact.projectKey, fact.projectLabel]);
    } else if (legacyUnverified) {
      this.db.run('DELETE FROM fact_projects WHERE source_key = ?', [fact.sourceKey]);
    }
    if (fact.provider === 'claude' && fact.sourceKey.startsWith('claude:v2:')) {
      const marker = 'claude:v2:';
      const eventPart = fact.sourceKey.slice(marker.length + 25);
      const siblings = this.db.all("SELECT source_key FROM usage_facts WHERE provider = 'claude' AND session_id = ? AND source_key <> ?",
        [fact.sessionId, fact.sourceKey]);
      for (const sibling of siblings) {
        const key = String(sibling.source_key);
        if (key.startsWith(marker) && key.slice(marker.length + 25) === eventPart) {
          this.db.run('INSERT OR IGNORE INTO usage_uncertain_facts VALUES (?, ?)',
            [key, 'local_event_identity_ambiguous']);
          this.db.run('INSERT OR IGNORE INTO usage_uncertain_facts VALUES (?, ?)',
            [fact.sourceKey, 'local_event_identity_ambiguous']);
        }
      }
    }
  }

  private reconcileLegacyClaudeFact(fact: UsageFact, file: string, fileId: string, birthtimeMs: number): void {
    const evidence = this.db.one(`SELECT 1 FROM legacy_claude_cursor_evidence
      WHERE file_path = ? AND file_id = ? AND birthtime_ms = ?`,
      [file, fileId, birthtimeMs]);
    if (!evidence) return;
    const marker = 'claude:v2:';
    const eventPart = fact.sourceKey.slice(marker.length + 25);
    const candidates = this.db.all(`SELECT f.*, p.project_key, p.project_label FROM usage_facts f
      JOIN usage_uncertain_facts u ON u.source_key=f.source_key AND u.reason='legacy_unverified'
      LEFT JOIN fact_projects p ON p.source_key=f.source_key
      WHERE f.provider='claude' AND f.source_identity_key LIKE 'claude:legacy-unverified:%'
        AND f.session_id = ? AND f.model = ?
        AND f.input_tokens = ? AND f.output_tokens = ? AND f.cache_read_tokens = ?
        AND f.cache_creation_tokens = ? AND f.total_tokens = ?`,
      [fact.sessionId, fact.model, fact.inputTokens, fact.outputTokens,
        fact.cacheReadTokens, fact.cacheCreationTokens, fact.totalTokens]).filter(row => {
      const key = String(row.source_key);
      return key.startsWith(marker) && key.slice(marker.length + 25) === eventPart &&
        Date.parse(String(row.occurred_at)) === Date.parse(fact.occurredAt) &&
        (row.project_key ?? null) === (fact.projectKey ?? null);
    });
    if (candidates.length !== 1) return;
    const old = candidates[0];
    const oldKey = String(old.source_key);
    this.db.run('INSERT OR IGNORE INTO legacy_reconciled_facts VALUES (?, ?, ?, ?)',
      [oldKey, JSON.stringify(old), fact.sourceKey, new Date().toISOString()]);
    this.db.run('DELETE FROM usage_uncertain_facts WHERE source_key = ?', [oldKey]);
    this.db.run('DELETE FROM fact_projects WHERE source_key = ?', [oldKey]);
    this.db.run('DELETE FROM usage_facts WHERE source_key = ?', [oldKey]);
    this.db.run(`DELETE FROM source_identities WHERE key = ? AND NOT EXISTS
      (SELECT 1 FROM usage_facts WHERE source_identity_key = ?)`,
      [String(old.source_identity_key), String(old.source_identity_key)]);
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
      scan_error: '检查来源目录及磁盘状态后重新扫描。',
      scan_cancelled: '扫描已取消，已处理文件仅算已观测；重新扫描会从已保存的文件游标续扫。'
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
    return this.db.all(`SELECT s.key, s.provider, s.label, s.owner_user_id, COUNT(f.source_key) AS fact_count,
        MAX(f.occurred_at) AS last_record_at,
        (SELECT p.project_label FROM usage_facts latest JOIN fact_projects p ON p.source_key=latest.source_key
          WHERE latest.source_identity_key=s.key ORDER BY latest.occurred_at DESC LIMIT 1) AS project_label
      FROM source_identities s LEFT JOIN usage_facts f ON f.source_identity_key = s.key
      GROUP BY s.key HAVING COUNT(f.source_key) > 0 OR
        (s.key NOT LIKE 'codex:legacy-unverified:%' AND s.key NOT LIKE 'claude:legacy-unverified:%'
          AND s.key NOT LIKE 'codex:otel:legacy-ambiguous:%' AND s.key NOT LIKE 'codex:otel:unknown:%')
      ORDER BY s.provider, s.label`).map(row => ({
      key: String(row.key),
      provider: row.provider as Provider,
      label: String(row.label),
      ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
      factCount: Number(row.fact_count),
      lastRecordAt: row.last_record_at ? String(row.last_record_at) : null,
      projectLabel: row.project_label ? String(row.project_label) : null
    }));
  }

  bindIdentity(key: unknown, userId: unknown, actorId: string): void {
    if (typeof key !== 'string' || (userId !== null && typeof userId !== 'string')) throw new Error('归属参数无效');
    if (key.startsWith('codex:legacy-unverified:') || key.startsWith('claude:legacy-unverified:') ||
        key.startsWith('codex:otel:unknown:') || key.startsWith('codex:otel:legacy-ambiguous:') ||
        key.startsWith('claude:otel:unknown:') || key.startsWith('claude:otel:legacy-unverified:') ||
        key.startsWith('claude:macos:') || key.startsWith('claude:local-file-unknown:')) {
      throw new Error('账户身份或旧记录归属无法验证，请先重新采集并核对');
    }
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
