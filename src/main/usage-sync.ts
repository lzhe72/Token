import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './database';
import type { UsageScanner } from '../collectors/scanner';
import type { UsageAggregate, UsageSnapshot } from '../server/server';
import type { ServerConnection } from './server-connection';

export interface SyncStatus {
  pending: number;
  lastSuccess: string | null;
  lastError: string | null;
  lastAttempt: string | null;
}

function exact(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Token 数值超出安全范围');
  return number;
}

export class UsageSync {
  private timer: NodeJS.Timeout | null = null;
  private sending: Promise<void> | null = null;
  private readonly deviceId: string;

  constructor(private readonly db: AppDatabase, private readonly scanner: UsageScanner,
    private readonly connection: ServerConnection) {
    db.run(`CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_outbox (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);`);
    const stored = db.one("SELECT value FROM sync_meta WHERE key = 'device_id'");
    this.deviceId = stored ? String(stored.value) : randomUUID();
    if (!stored) db.run("INSERT INTO sync_meta VALUES ('device_id', ?)", [this.deviceId]);
  }

  start(): void {
    this.timer = setInterval(() => void this.flush().catch(() => {}), 60_000);
    void this.flush().catch(() => {});
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async waitIdle(): Promise<void> { if (this.sending) await this.sending; }

  status(): SyncStatus {
    const get = (key: string) => this.db.one('SELECT value FROM sync_meta WHERE key = ?', [key])?.value;
    return {
      pending: Number(this.db.one('SELECT COUNT(*) AS count FROM sync_outbox')?.count ?? 0),
      lastSuccess: get('last_success') ? String(get('last_success')) : null,
      lastError: get('last_error') ? String(get('last_error')) : null,
      lastAttempt: get('last_attempt') ? String(get('last_attempt')) : null
    };
  }

  private setMeta(key: string, value: string): void {
    this.db.run('INSERT INTO sync_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
  }

  private aggregate(providers: Array<'codex' | 'claude'>): UsageAggregate[] {
    if (!providers.length) return [];
    const facts = this.db.all(`SELECT f.provider, f.model, substr(f.occurred_at, 1, 10) AS day,
        s.owner_user_id, f.input_tokens, f.output_tokens, f.cache_read_tokens,
        f.cache_creation_tokens, f.total_tokens
      FROM usage_facts f JOIN source_identities s ON s.key = f.source_identity_key
      JOIN users u ON u.id = s.owner_user_id AND u.active = 1
      WHERE
        (f.source_key NOT LIKE 'otel:%' OR NOT EXISTS (
          SELECT 1 FROM usage_facts local WHERE local.provider = f.provider
          AND local.source_key NOT LIKE 'otel:%'
          AND substr(local.occurred_at, 1, 10) = substr(f.occurred_at, 1, 10)
        ))`);
    const grouped = new Map<string, UsageAggregate>();
    for (const fact of facts) {
      const provider = String(fact.provider) as 'codex' | 'claude';
      if (!providers.includes(provider)) continue;
      const ownerUserId = String(fact.owner_user_id);
      const day = String(fact.day);
      const model = String(fact.model);
      const key = JSON.stringify([ownerUserId, day, provider, model]);
      let row = grouped.get(key);
      if (!row) {
        row = { ownerUserId, day, provider, model, inputTokens: 0, outputTokens: 0,
          cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, requests: 0 };
        grouped.set(key, row);
      }
      row.inputTokens = exact(row.inputTokens + exact(fact.input_tokens));
      row.outputTokens = exact(row.outputTokens + exact(fact.output_tokens));
      row.cacheReadTokens = exact(row.cacheReadTokens + exact(fact.cache_read_tokens));
      row.cacheCreationTokens = exact(row.cacheCreationTokens + exact(fact.cache_creation_tokens));
      row.totalTokens = exact(row.totalTokens + exact(fact.total_tokens));
      row.requests = exact(row.requests + 1);
    }
    return [...grouped.values()].sort((a, b) => JSON.stringify([a.ownerUserId, a.day, a.provider, a.model]).localeCompare(JSON.stringify([b.ownerUserId, b.day, b.provider, b.model])));
  }

  async afterScan(): Promise<void> {
    const statuses = this.scanner.statuses();
    const providers = statuses.filter(status => status.status === 'ready' || status.status === 'no_records')
      .map(status => status.provider);
    try {
      const prior = this.db.one('SELECT payload FROM sync_outbox WHERE id = 1');
      const previous = prior ? JSON.parse(String(prior.payload)) as UsageSnapshot : null;
      const mergedProviders = [...new Set([...(previous?.providers ?? []), ...providers])];
      const currentRows = this.aggregate(providers);
      const activeOwners = new Set(this.db.all('SELECT id FROM users WHERE active = 1').map(user => String(user.id)));
      const retainedRows = previous?.rows.filter(row => !providers.includes(row.provider) && activeOwners.has(row.ownerUserId)) ?? [];
      const revision = exact(Math.max(Number(this.db.one("SELECT value FROM sync_meta WHERE key = 'revision'")?.value ?? 0) + 1, Date.now()));
      const coverage: UsageSnapshot['coverage'] = statuses.map(status => ({
        provider: status.provider, status: status.status === 'scanning' ? 'idle' : status.status,
        lastScan: status.lastScan
      }));
      const payload: UsageSnapshot = { deviceId: this.deviceId, revision, providers: mergedProviders, coverage, rows: [...currentRows, ...retainedRows] };
      const serialized = JSON.stringify(payload);
      if (Buffer.byteLength(serialized, 'utf8') > 16 * 1024 * 1024) throw new Error('上报快照超过 16 MB，需缩小同步范围');
      this.db.transaction(() => {
        this.setMeta('revision', String(revision));
        this.db.run('INSERT INTO sync_outbox VALUES (1, ?, 0) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, attempts=0', [serialized]);
      });
      await this.flush();
    } catch (error) {
      this.setMeta('last_error', error instanceof Error ? error.message : '上报准备失败');
    }
  }

  flush(): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = this.sendPending().finally(() => { this.sending = null; });
    return this.sending;
  }

  async retryNow(): Promise<void> {
    if (this.sending) await this.sending;
    this.db.run('UPDATE sync_outbox SET attempts = 0 WHERE id = 1');
    await this.flush();
  }

  private async sendPending(): Promise<void> {
    const row = this.db.one('SELECT payload, attempts FROM sync_outbox WHERE id = 1');
    if (!row) return;
    const attempts = Number(row.attempts);
    const lastAttempt = this.db.one("SELECT value FROM sync_meta WHERE key = 'last_attempt'")?.value;
    const delay = Math.min(10 * 60_000, 30_000 * 2 ** Math.min(attempts, 5));
    if (attempts > 0 && lastAttempt && Date.now() - Date.parse(String(lastAttempt)) < delay) return;
    const payload = String(row.payload);
    const snapshot = JSON.parse(payload) as UsageSnapshot;
    const revision = snapshot.revision;
    const ownerUserIds = this.db.all('SELECT id FROM users WHERE active = 1').map(user => String(user.id));
    this.setMeta('last_attempt', new Date().toISOString());
    try {
      const response = await this.connection.uploadUsage(payload, this.deviceId, ownerUserIds);
      if (response.status === 409) {
        const body = await response.json() as { currentRevision?: number };
        if (Number.isSafeInteger(body.currentRevision) && Number(body.currentRevision) >= revision) {
          const bumped = { ...(JSON.parse(payload) as UsageSnapshot), revision: Number(body.currentRevision) + 1 };
          this.db.run('UPDATE sync_outbox SET payload = ?, attempts = 0 WHERE id = 1', [JSON.stringify(bumped)]);
          this.setMeta('revision', String(bumped.revision));
          return;
        }
      }
      if (!response.ok) throw new Error(response.status === 401
        ? '设备上报凭证失效；请由管理员在系统设置中重新保存服务器连接'
        : `服务端拒绝上报 (${response.status})`);
      this.db.transaction(() => {
        const current = this.db.one('SELECT payload FROM sync_outbox WHERE id = 1');
        if (current && (JSON.parse(String(current.payload)) as UsageSnapshot).revision === revision) this.db.run('DELETE FROM sync_outbox WHERE id = 1');
        this.setMeta('last_success', new Date().toISOString());
        this.setMeta('last_error', '');
      });
    } catch (error) {
      this.db.run('UPDATE sync_outbox SET attempts = attempts + 1 WHERE id = 1');
      this.setMeta('last_error', error instanceof Error ? error.message : '上报失败');
    }
  }
}
