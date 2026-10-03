import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './database';
import type { UsageScanner } from '../collectors/scanner';
import type { UsageAggregateV2, UsageSnapshot, UsageSnapshotV2 } from '../server/server';
import type { ServerConnection } from './server-connection';
import { reconcileFacts } from './reconcile';

export interface SyncStatus {
  pending: number;
  uncertainRows: number;
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
      uncertainRows: Number(get('uncertain_rows') ?? 0),
      lastSuccess: get('last_success') ? String(get('last_success')) : null,
      lastError: get('last_error') ? String(get('last_error')) : null,
      lastAttempt: get('last_attempt') ? String(get('last_attempt')) : null
    };
  }

  private setMeta(key: string, value: string): void {
    this.db.run('INSERT INTO sync_meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
  }

  private aggregate(providers: Array<'codex' | 'claude'>): UsageAggregateV2[] {
    if (!providers.length) return [];
    const facts = this.db.all(`SELECT f.source_key, f.session_id, f.occurred_at, f.provider, f.model, substr(f.occurred_at, 1, 10) AS day,
        s.owner_user_id, f.input_tokens, f.output_tokens, f.cache_read_tokens,
        f.cache_creation_tokens, f.total_tokens
      FROM usage_facts f JOIN source_identities s ON s.key = f.source_identity_key
      JOIN users u ON u.id = s.owner_user_id AND u.active = 1
      WHERE f.provider IN ('codex', 'claude')`) as Array<{
        source_key: string; session_id: string; occurred_at: string; provider: 'codex' | 'claude';
        model: string; day: string; owner_user_id: string; input_tokens: number; output_tokens: number;
        cache_read_tokens: number; cache_creation_tokens: number; total_tokens: number;
      }>;
    const pendingKeys = reconcileFacts(facts.filter(fact => providers.includes(fact.provider))).pendingKeys;
    const grouped = new Map<string, UsageAggregateV2>();
    for (const fact of facts) {
      const provider = String(fact.provider) as 'codex' | 'claude';
      if (!providers.includes(provider)) continue;
      const ownerUserId = String(fact.owner_user_id);
      const day = String(fact.day);
      const model = String(fact.model);
      const key = JSON.stringify([ownerUserId, day, provider, model]);
      let row = grouped.get(key);
      if (!row) {
        row = { ownerUserId, day, provider, model, confirmedSubtotal: { inputTokens: 0, outputTokens: 0,
          cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, requests: 0 },
          totalStatus: 'confirmed', conflictCount: 0, conflictSources: [] };
        grouped.set(key, row);
      }
      if (pendingKeys.has(fact.source_key)) {
        row.totalStatus = 'uncertain';
        row.conflictCount = exact(row.conflictCount + 1);
        const source = fact.source_key.startsWith('otel:') ? 'telemetry' : 'local';
        if (!row.conflictSources.includes(source)) row.conflictSources.push(source);
      } else {
        const subtotal = row.confirmedSubtotal;
        subtotal.inputTokens = exact(subtotal.inputTokens + exact(fact.input_tokens));
        subtotal.outputTokens = exact(subtotal.outputTokens + exact(fact.output_tokens));
        subtotal.cacheReadTokens = exact(subtotal.cacheReadTokens + exact(fact.cache_read_tokens));
        subtotal.cacheCreationTokens = exact(subtotal.cacheCreationTokens + exact(fact.cache_creation_tokens));
        subtotal.totalTokens = exact(subtotal.totalTokens + exact(fact.total_tokens));
        subtotal.requests = exact(subtotal.requests + 1);
      }
    }
    return [...grouped.values()].map(row => row.totalStatus === 'confirmed'
      ? { ...row, conflictSources: [], totalTokens: row.confirmedSubtotal.totalTokens } : row)
      .sort((a, b) => JSON.stringify([a.ownerUserId, a.day, a.provider, a.model]).localeCompare(JSON.stringify([b.ownerUserId, b.day, b.provider, b.model])));
  }

  async afterScan(): Promise<void> {
    try {
      this.db.transaction(() => this.queueSnapshot());
      await this.flush();
    } catch (error) {
      this.setMeta('last_error', error instanceof Error ? error.message : '上报准备失败');
    }
  }

  // Called inside the source-binding transaction as well as after a scan.
  // The new authorization snapshot must exist durably before the UI reports success.
  queueSnapshot(extraProviders: Array<'codex' | 'claude'> = []): void {
    const statuses = this.scanner.statuses();
    const providers = statuses.filter(status => status.status === 'ready' || status.status === 'no_records')
      .map(status => status.provider);
      const prior = this.db.one('SELECT payload FROM sync_outbox WHERE id = 1');
      const previous = prior ? JSON.parse(String(prior.payload)) as UsageSnapshot : null;
      const mergedProviders = [...new Set([...(previous?.providers ?? []), ...providers, ...extraProviders])];
      const currentRows = this.aggregate(mergedProviders);
      const revision = exact(Math.max(Number(this.db.one("SELECT value FROM sync_meta WHERE key = 'revision'")?.value ?? 0) + 1, Date.now()));
      const coverage: UsageSnapshot['coverage'] = statuses.map(status => ({
        provider: status.provider, status: status.status === 'scanning' ? 'idle' : status.status,
        lastScan: status.lastScan
      }));
      const payload: UsageSnapshotV2 = { accountingVersion: 2, deviceId: this.deviceId, revision,
        providers: mergedProviders, coverage, rows: currentRows };
      const serialized = JSON.stringify(payload);
      if (Buffer.byteLength(serialized, 'utf8') > 16 * 1024 * 1024) throw new Error('上报快照超过 16 MB，需缩小同步范围');
      this.setMeta('revision', String(revision));
      this.setMeta('uncertain_rows', String(currentRows.filter(row => row.totalStatus === 'uncertain').length));
      this.setMeta('last_error', '');
      this.db.run('INSERT INTO sync_outbox VALUES (1, ?, 0) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, attempts=0', [serialized]);
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
    let payload = String(row.payload);
    let snapshot = JSON.parse(payload) as UsageSnapshot;
    if (snapshot.accountingVersion !== 2) {
      const upgraded: UsageSnapshotV2 = { accountingVersion: 2, deviceId: this.deviceId,
        revision: exact(Math.max(snapshot.revision + 1, Date.now())), providers: snapshot.providers,
        coverage: snapshot.coverage, rows: this.aggregate(snapshot.providers) };
      payload = JSON.stringify(upgraded);
      snapshot = upgraded;
      this.db.transaction(() => {
        this.db.run('UPDATE sync_outbox SET payload = ?, attempts = 0 WHERE id = 1', [payload]);
        this.setMeta('revision', String(upgraded.revision));
        this.setMeta('uncertain_rows', String(upgraded.rows.filter(item => item.totalStatus === 'uncertain').length));
      });
    }
    const revision = snapshot.revision;
    const ownerUserIds = this.db.all(`SELECT DISTINCT u.id FROM source_identities s
      JOIN users u ON u.id=s.owner_user_id AND u.active=1 ORDER BY u.id`).map(user => String(user.id));
    this.setMeta('last_attempt', new Date().toISOString());
    try {
      const response = await this.connection.uploadUsage(payload, this.deviceId, ownerUserIds);
      if (response.status === 409) {
        const body = await response.json() as { currentRevision?: number };
        if (Number.isSafeInteger(body.currentRevision) && Number(body.currentRevision) >= revision) {
          const bumped = { ...(JSON.parse(payload) as UsageSnapshot), revision: Number(body.currentRevision) + 1 };
          const current = this.db.one('SELECT payload FROM sync_outbox WHERE id = 1');
          if (current && (JSON.parse(String(current.payload)) as UsageSnapshot).revision === revision) {
            this.db.transaction(() => {
              this.db.run('UPDATE sync_outbox SET payload = ?, attempts = 0 WHERE id = 1', [JSON.stringify(bumped)]);
              this.setMeta('revision', String(bumped.revision));
            });
          }
          return;
        }
      }
      if (!response.ok) throw new Error(response.status === 401
        ? '设备上报凭证失效；请由管理员在系统设置中重新保存服务器连接'
        : response.status === 400 ? '服务端计量协议不兼容；需更新服务端后重试，待传数据已保留'
        : `服务端拒绝上报 (${response.status})`);
      this.db.transaction(() => {
        const current = this.db.one('SELECT payload FROM sync_outbox WHERE id = 1');
        if (current && (JSON.parse(String(current.payload)) as UsageSnapshot).revision === revision) this.db.run('DELETE FROM sync_outbox WHERE id = 1');
        this.setMeta('last_success', new Date().toISOString());
        this.setMeta('last_error', '');
      });
    } catch (error) {
      const current = this.db.one('SELECT payload FROM sync_outbox WHERE id = 1');
      if (current && (JSON.parse(String(current.payload)) as UsageSnapshot).revision === revision) {
        this.db.run('UPDATE sync_outbox SET attempts = attempts + 1 WHERE id = 1');
        this.setMeta('last_error', error instanceof Error ? error.message : '上报失败');
      }
    }
  }
}
