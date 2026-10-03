import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { AppDatabase } from '../main/database';
import type { TokenTotals } from '../shared/types';

export interface UpdateManifest {
  version: string;
  arch: 'arm64' | 'x64';
  size: number;
  sha256: string;
  filename: string;
  downloadPath: '/v1/update/package';
  publishedAt: string;
}

export interface UsageAggregate {
  ownerUserId: string;
  day: string;
  provider: 'codex' | 'claude';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  requests: number;
}

interface UsageSnapshotBase {
  deviceId: string;
  revision: number;
  providers: Array<'codex' | 'claude'>;
  coverage: Array<{ provider: 'codex' | 'claude'; status: 'ready' | 'no_records' | 'not_found' | 'error' | 'idle'; lastScan: string | null }>;
}

export interface UsageSnapshotV1 extends UsageSnapshotBase {
  accountingVersion?: undefined;
  rows: UsageAggregate[];
}

export interface UsageAggregateV2 {
  ownerUserId: string;
  day: string;
  provider: 'codex' | 'claude';
  model: string;
  confirmedSubtotal: TokenTotals;
  totalStatus: 'confirmed' | 'uncertain';
  conflictCount: number;
  conflictSources: Array<'local' | 'telemetry'>;
  totalTokens?: number;
}

export interface UsageSnapshotV2 extends UsageSnapshotBase {
  accountingVersion: 2;
  rows: UsageAggregateV2[];
}

export type UsageSnapshot = UsageSnapshotV1 | UsageSnapshotV2;

export interface FeedbackRecord {
  id: string;
  username: string;
  category: 'missing_usage' | 'report' | 'update' | 'other';
  title: string;
  message: string;
  diagnostics: string | null;
  appVersion: string;
  platform: string;
  status: 'open' | 'resolved';
  createdAt: string;
}

const MAX_BODY = 16 * 1024 * 1024;
const MAX_PACKAGE = 2 * 1024 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': 'none' });
  res.end(JSON.stringify(body));
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
}

function validFeedback(value: unknown): Omit<FeedbackRecord, 'status' | 'createdAt'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('反馈格式无效');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !['id', 'username', 'category', 'title', 'message', 'diagnostics', 'appVersion', 'platform'].includes(key)) ||
    typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id) ||
    typeof item.username !== 'string' || !/^[\p{L}\p{N}_.-]{3,32}$/u.test(item.username) ||
    !['missing_usage', 'report', 'update', 'other'].includes(String(item.category)) ||
    typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120 ||
    typeof item.message !== 'string' || !item.message.trim() || item.message.length > 4000 ||
    typeof item.appVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(item.appVersion) ||
    item.platform !== 'darwin' ||
    (item.diagnostics !== null && item.diagnostics !== undefined &&
      (typeof item.diagnostics !== 'string' || item.diagnostics.length > 2000))) throw new Error('反馈格式无效');
  const text = `${item.title}\n${item.message}\n${item.diagnostics ?? ''}`;
  if (/(?:\/(?:[^/\s]+\/)+[^/\s]+|[A-Z]:\\Users\\|-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}|(?:OPENAI|ANTHROPIC)_API_KEY\s*[=:])/i.test(text)) {
    throw new Error('反馈包含敏感路径或密钥');
  }
  if (item.diagnostics) {
    let parsed: unknown;
    try { parsed = JSON.parse(item.diagnostics); } catch { throw new Error('诊断摘要无效'); }
    if (!Array.isArray(parsed) || parsed.length > 2 || parsed.some(entry => !entry || typeof entry !== 'object' ||
      Object.keys(entry).some(key => !['provider', 'status', 'fileCount', 'factCount', 'reason', 'malformedCount', 'unreadableCount'].includes(key)))) {
      throw new Error('诊断摘要无效');
    }
  }
  return { id: item.id, username: item.username, category: item.category as FeedbackRecord['category'],
    title: item.title.trim(), message: item.message.trim(), diagnostics: item.diagnostics ? String(item.diagnostics) : null,
    appVersion: item.appVersion, platform: item.platform };
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('请求过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function validateSnapshot(value: unknown): UsageSnapshot {
  if (!value || typeof value !== 'object') throw new Error('快照格式无效');
  const input = value as Record<string, unknown>;
  const v2 = input.accountingVersion === 2;
  if (input.accountingVersion !== undefined && !v2) throw new Error('不支持的计量协议');
  if (Object.keys(input).some(key => !['deviceId', 'revision', 'providers', 'coverage', 'rows', ...(v2 ? ['accountingVersion'] : [])].includes(key))) throw new Error('包含未允许字段');
  if (typeof input.deviceId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.deviceId) || !safeInteger(input.revision)) throw new Error('设备或版本无效');
  if (!Array.isArray(input.providers) || input.providers.some(provider => provider !== 'codex' && provider !== 'claude') || new Set(input.providers).size !== input.providers.length) throw new Error('来源无效');
  if (!Array.isArray(input.coverage) || input.coverage.length !== 2 ||
    input.coverage.some((item: unknown) => {
      if (!item || typeof item !== 'object') return true;
      const row = item as Record<string, unknown>;
      return Object.keys(row).some(key => !['provider', 'status', 'lastScan'].includes(key)) ||
        !['codex', 'claude'].includes(String(row.provider)) ||
        !['ready', 'no_records', 'not_found', 'error', 'idle'].includes(String(row.status)) ||
        (row.lastScan !== null && (typeof row.lastScan !== 'string' || !Number.isFinite(Date.parse(row.lastScan))));
    }) || new Set(input.coverage.map((item: { provider: string }) => item.provider)).size !== 2) throw new Error('覆盖状态无效');
  if (!Array.isArray(input.rows) || input.rows.length > 50000) throw new Error('聚合记录过多');
  for (const row of input.rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => !['ownerUserId', 'day', 'provider', 'model', ...(v2
      ? ['confirmedSubtotal', 'totalStatus', 'conflictCount', 'conflictSources', 'totalTokens']
      : ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens', 'requests'])].includes(key))) throw new Error('包含未允许字段');
    const item = row as Record<string, unknown>;
    if (typeof item.ownerUserId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.ownerUserId) ||
      typeof item.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.day) ||
      (item.provider !== 'codex' && item.provider !== 'claude') || !input.providers.includes(item.provider) ||
      typeof item.model !== 'string' || item.model.length > 160) throw new Error('聚合字段无效');
    if (v2) {
      const subtotal = item.confirmedSubtotal as Record<string, unknown> | null;
      if (!subtotal || typeof subtotal !== 'object' || Array.isArray(subtotal) ||
        Object.keys(subtotal).sort().join(',') !== 'cacheCreationTokens,cacheReadTokens,inputTokens,outputTokens,requests,totalTokens' ||
        !Object.values(subtotal).every(safeInteger) ||
        !['confirmed', 'uncertain'].includes(String(item.totalStatus)) || !safeInteger(item.conflictCount) ||
        !Array.isArray(item.conflictSources) || item.conflictSources.length > 2 ||
        item.conflictSources.some(source => source !== 'local' && source !== 'telemetry') ||
        new Set(item.conflictSources).size !== item.conflictSources.length ||
        (item.totalStatus === 'confirmed' && (item.conflictCount !== 0 || item.conflictSources.length !== 0 || item.totalTokens !== subtotal.totalTokens)) ||
        (item.totalStatus === 'uncertain' && (item.conflictCount === 0 || item.conflictSources.length === 0 || item.totalTokens !== undefined))) {
        throw new Error('聚合状态无效');
      }
    } else if (!['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens', 'requests'].every(key => safeInteger(item[key]))) {
      throw new Error('聚合字段无效');
    }
  }
  return value as UsageSnapshot;
}

export function readManifest(directory: string): UpdateManifest | null {
  const file = path.join(directory, 'releases', 'latest.json');
  if (!fs.existsSync(file)) return null;
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as UpdateManifest;
  if (!/^\d+\.\d+\.\d+$/.test(value.version) || !['arm64', 'x64'].includes(value.arch) ||
    !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_PACKAGE ||
    !/^[a-f0-9]{64}$/.test(value.sha256) || !/^[A-Za-z0-9._-]+\.dmg$/.test(value.filename) ||
    path.basename(value.filename) !== value.filename || value.downloadPath !== '/v1/update/package' ||
    !Number.isFinite(Date.parse(value.publishedAt))) throw new Error('更新清单无效');
  const packageFile = path.join(directory, 'releases', value.filename);
  if (!fs.existsSync(packageFile) || fs.statSync(packageFile).size !== value.size) throw new Error('更新包不可用');
  return value;
}

export class LocalServer {
  private readonly server: http.Server | https.Server;
  private db: AppDatabase | null = null;
  private secret = '';
  private adminSecret = '';
  private port = 0;

  constructor(private readonly directory: string, private readonly tls?: { key: string | Buffer; cert: string | Buffer }) {
    const handler = (req: IncomingMessage, res: ServerResponse) => { void this.handle(req, res).catch(() => send(res, 500, { error: '服务内部错误' })); };
    this.server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  }

  async start(port = 0, host = '127.0.0.1'): Promise<number> {
    if (!this.tls && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('非本机监听必须配置 TLS 证书与私钥');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const secretFile = path.join(this.directory, 'server.secret');
    if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    this.secret = fs.readFileSync(secretFile, 'utf8').trim();
    const adminSecretFile = path.join(this.directory, 'server-admin.secret');
    if (!fs.existsSync(adminSecretFile)) fs.writeFileSync(adminSecretFile, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    this.adminSecret = fs.readFileSync(adminSecretFile, 'utf8').trim();
    this.db = await AppDatabase.open(path.join(this.directory, 'server.sqlite'));
    this.db.run(`CREATE TABLE IF NOT EXISTS device_revisions (device_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS aggregates (
        device_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, day TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL,
        cache_creation_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL, requests INTEGER NOT NULL,
        PRIMARY KEY (device_id, owner_user_id, day, provider, model)
      );`);
    this.db.run(`CREATE TABLE IF NOT EXISTS source_coverage (
      device_id TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, last_scan TEXT,
      revision INTEGER NOT NULL, PRIMARY KEY (device_id, provider)
    )`);
    if (!this.db.all('PRAGMA table_info(device_revisions)').some(row => row.name === 'accounting_version')) {
      this.db.run('ALTER TABLE device_revisions ADD COLUMN accounting_version INTEGER NOT NULL DEFAULT 1');
    }
    this.db.run(`CREATE TABLE IF NOT EXISTS aggregate_status (
      device_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, day TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, total_status TEXT NOT NULL,
      confirmed_subtotal TEXT NOT NULL, conflict_count INTEGER NOT NULL,
      conflict_sources TEXT NOT NULL,
      PRIMARY KEY (device_id, owner_user_id, day, provider, model)
    )`);
    const legacySubtotal = JSON.stringify({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      cacheCreationTokens: 0, totalTokens: 0, requests: 0 });
    this.db.run(`INSERT INTO aggregate_status
      SELECT a.device_id, a.owner_user_id, a.day, a.provider, a.model,
        'legacy_unknown', ?, 0, '[]' FROM aggregates a
      WHERE NOT EXISTS (SELECT 1 FROM aggregate_status s WHERE s.device_id=a.device_id
        AND s.owner_user_id=a.owner_user_id AND s.day=a.day AND s.provider=a.provider AND s.model=a.model)`, [legacySubtotal]);
    this.db.run(`CREATE TABLE IF NOT EXISTS feedback_items (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, category TEXT NOT NULL,
      title TEXT NOT NULL, message TEXT NOT NULL, diagnostics TEXT,
      app_version TEXT NOT NULL, platform TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS upload_devices (
      device_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
      owner_user_ids TEXT NOT NULL, active INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS upload_device_owner_history (
      device_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
      PRIMARY KEY (device_id, owner_user_id)
    )`);
    for (const device of this.db.all('SELECT device_id, owner_user_ids FROM upload_devices')) {
      try {
        for (const ownerId of JSON.parse(String(device.owner_user_ids)) as string[]) {
          this.db.run('INSERT OR IGNORE INTO upload_device_owner_history VALUES (?, ?)', [String(device.device_id), ownerId]);
        }
      } catch { /* malformed legacy scope remains unavailable for uploads */ }
    }
    this.db.run(`CREATE TABLE IF NOT EXISTS upload_device_audit (
      id TEXT PRIMARY KEY, device_id TEXT NOT NULL, action TEXT NOT NULL,
      owner_count INTEGER NOT NULL, occurred_at TEXT NOT NULL
    )`);
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => { this.server.off('error', reject); resolve(); });
    });
    const address = this.server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
    const portFile = path.join(this.directory, 'server-port.json');
    fs.writeFileSync(`${portFile}.tmp`, JSON.stringify({ host, port: this.port, pid: process.pid }), { mode: 0o600 });
    fs.renameSync(`${portFile}.tmp`, portFile);
    return this.port;
  }

  async stop(): Promise<void> {
    await new Promise<void>(resolve => this.server.close(() => resolve()));
    this.db?.close();
    this.db = null;
    try { fs.unlinkSync(path.join(this.directory, 'server-port.json')); } catch { /* stale file is harmless */ }
  }

  getPort(): number { return this.port; }
  getDatabase(): AppDatabase { if (!this.db) throw new Error('服务尚未启动'); return this.db; }

  private authorized(req: IncomingMessage): boolean {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const actual = Buffer.from(bearer);
    const expected = Buffer.from(this.secret);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private authorizedAdmin(req: IncomingMessage): boolean {
    const actual = Buffer.from(String(req.headers['x-token-admin'] ?? ''));
    const expected = Buffer.from(this.adminSecret);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private uploadDevice(req: IncomingMessage): { deviceId: string; ownerUserIds: string[] } | null {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (!/^[a-f0-9]{64}$/.test(bearer)) return null;
    const hash = createHash('sha256').update(bearer).digest('hex');
    const row = this.getDatabase().one('SELECT device_id, owner_user_ids FROM upload_devices WHERE token_hash = ? AND active = 1', [hash]);
    if (!row) return null;
    return { deviceId: String(row.device_id), ownerUserIds: JSON.parse(String(row.owner_user_ids)) as string[] };
  }

  private auditDevice(deviceId: string, action: string, ownerCount: number): void {
    this.getDatabase().run('INSERT INTO upload_device_audit VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), deviceId, action, ownerCount, new Date().toISOString()]);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.origin) { send(res, 403, { error: '浏览器跨源请求不可用' }); return; }
    if (req.method === 'GET' && req.url === '/health') {
      send(res, 200, { ok: true, accountingVersion: 2,
        serverId: createHash('sha256').update(this.secret).digest('hex').slice(0, 16) }); return;
    }
    if ((req.url === '/v1/auth/check' || req.url === '/v1/update/latest' || req.url === '/v1/update/package' ||
      req.url === '/v1/feedback' || req.url === '/v1/admin/feedback' ||
      req.url === '/v1/admin/feedback/status' || req.url === '/v1/admin/devices/enroll' ||
      req.url === '/v1/admin/devices/revoke') && !this.authorized(req)) {
      send(res, 401, { error: '未授权' }); return;
    }
    if ((req.url === '/v1/admin/feedback' || req.url === '/v1/admin/feedback/status' ||
      req.url === '/v1/admin/devices/enroll' || req.url === '/v1/admin/devices/revoke') && !this.authorizedAdmin(req)) {
      send(res, 403, { error: '需要服务管理密钥' }); return;
    }
    if (req.method === 'GET' && req.url === '/v1/auth/check') { send(res, 200, { authorized: true }); return; }
    if (req.method === 'GET' && req.url === '/v1/usage') {
      const device = this.uploadDevice(req);
      if (!device) { send(res, 401, { error: '设备上报凭证无效' }); return; }
      const rows = this.getDatabase().all('SELECT owner_user_id, day, provider, model, total_status, confirmed_subtotal, conflict_count, conflict_sources FROM aggregate_status WHERE device_id = ? ORDER BY owner_user_id, day, provider, model', [device.deviceId])
        .filter(row => device.ownerUserIds.includes(String(row.owner_user_id)))
        .map(row => ({ ownerUserId: row.owner_user_id, day: row.day, provider: row.provider, model: row.model,
          totalStatus: row.total_status,
          confirmedSubtotal: row.total_status === 'legacy_unknown' ? null : JSON.parse(String(row.confirmed_subtotal)),
          conflictCount: row.conflict_count, conflictSources: JSON.parse(String(row.conflict_sources)) }));
      send(res, 200, { accountingVersion: 2, rows }); return;
    }
    if (req.method === 'POST' && req.url === '/v1/admin/devices/enroll') {
      try {
        const value = await readJson(req, 64 * 1024) as Record<string, unknown>;
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).some(key => !['deviceId', 'ownerUserIds', 'reactivate'].includes(key)) ||
          !validId(value.deviceId) || !Array.isArray(value.ownerUserIds) || value.ownerUserIds.length > 1000 ||
          value.ownerUserIds.some(id => !validId(id)) || new Set(value.ownerUserIds).size !== value.ownerUserIds.length ||
          (value.reactivate !== undefined && typeof value.reactivate !== 'boolean')) {
          throw new Error('invalid');
        }
        const deviceId = value.deviceId;
        const ownerUserIds = [...value.ownerUserIds].sort() as string[];
        const existing = this.getDatabase().one('SELECT active, owner_user_ids FROM upload_devices WHERE device_id = ?', [deviceId]);
        if (existing && Number(existing.active) === 0 && value.reactivate !== true) {
          send(res, 409, { error: '设备已撤销；需要管理员显式重新授权' }); return;
        }
        const token = randomBytes(32).toString('hex');
        const hash = createHash('sha256').update(token).digest('hex');
        this.getDatabase().transaction(() => {
          let priorOwners: string[] = [];
          try { priorOwners = JSON.parse(String(existing?.owner_user_ids ?? '[]')) as string[]; } catch { /* no trusted prior scope */ }
          for (const ownerId of ownerUserIds.filter(id => !priorOwners.includes(id))) {
            // A newly authorized owner must not reveal stale rows that predate
            // this authorization, even before the next replacement snapshot.
            this.getDatabase().run('DELETE FROM aggregates WHERE device_id = ? AND owner_user_id = ?', [deviceId, ownerId]);
            this.getDatabase().run('DELETE FROM aggregate_status WHERE device_id = ? AND owner_user_id = ?', [deviceId, ownerId]);
          }
          this.getDatabase().run(`INSERT INTO upload_devices VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(device_id) DO UPDATE SET token_hash=excluded.token_hash,
            owner_user_ids=excluded.owner_user_ids, active=1, updated_at=excluded.updated_at`,
            [deviceId, hash, JSON.stringify(ownerUserIds), new Date().toISOString()]);
          this.auditDevice(deviceId, existing && Number(existing.active) === 0 ? 'reactivate' : 'enroll', ownerUserIds.length);
          for (const ownerId of ownerUserIds) this.getDatabase().run(
            'INSERT OR IGNORE INTO upload_device_owner_history VALUES (?, ?)', [deviceId, ownerId]);
        });
        send(res, 200, { token, deviceId, ownerUserIds });
      } catch { send(res, 400, { error: '设备登记无效' }); }
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/admin/devices/revoke') {
      try {
        const value = await readJson(req, 1024) as Record<string, unknown>;
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).some(key => key !== 'deviceId') || !validId(value.deviceId)) throw new Error('invalid');
        const row = this.getDatabase().one('SELECT owner_user_ids FROM upload_devices WHERE device_id = ?', [value.deviceId]);
        if (!row) { send(res, 404, { error: '设备不存在' }); return; }
        this.getDatabase().transaction(() => {
          this.getDatabase().run('UPDATE upload_devices SET active = 0, updated_at = ? WHERE device_id = ?',
            [new Date().toISOString(), value.deviceId as string]);
          this.auditDevice(value.deviceId as string, 'revoke', (JSON.parse(String(row.owner_user_ids)) as string[]).length);
        });
        send(res, 200, { revoked: true });
      } catch { send(res, 400, { error: '设备撤销无效' }); }
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/update/latest') {
      try {
        const manifest = readManifest(this.directory);
        send(res, manifest ? 200 : 404, manifest ?? { error: '暂无更新包' });
      } catch { send(res, 503, { error: '更新包不可用' }); }
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/update/package') {
      let manifest: UpdateManifest | null;
      try { manifest = readManifest(this.directory); } catch { manifest = null; }
      if (!manifest) { send(res, 404, { error: '更新包不可用' }); return; }
      const file = path.join(this.directory, 'releases', manifest.filename);
      res.writeHead(200, { 'content-type': 'application/x-apple-diskimage', 'content-length': manifest.size, 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/feedback') {
      try {
        const input = validFeedback(await readJson(req, 16 * 1024));
        const item: FeedbackRecord = { ...input, status: 'open', createdAt: new Date().toISOString() };
        const db = this.getDatabase();
        const existing = db.one('SELECT * FROM feedback_items WHERE id = ?', [item.id]);
        if (existing) {
          if (existing.username !== item.username || existing.category !== item.category ||
            existing.title !== item.title || existing.message !== item.message ||
            existing.diagnostics !== item.diagnostics || existing.app_version !== item.appVersion ||
            existing.platform !== item.platform) {
            send(res, 409, { error: '反馈编号冲突' }); return;
          }
          send(res, 200, { ...item, status: existing.status, createdAt: existing.created_at }); return;
        }
        db.run('INSERT INTO feedback_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          item.id, item.username, item.category, item.title, item.message, item.diagnostics,
          item.appVersion, item.platform, item.status, item.createdAt
        ]);
        send(res, 201, item);
      } catch { send(res, 400, { error: '反馈格式无效或超过大小限制' }); }
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/admin/feedback') {
      const items = this.getDatabase().all('SELECT * FROM feedback_items ORDER BY created_at DESC LIMIT 200').map(row => ({
        id: String(row.id), username: String(row.username), category: row.category,
        title: String(row.title), message: String(row.message), diagnostics: row.diagnostics ? String(row.diagnostics) : null,
        appVersion: String(row.app_version), platform: String(row.platform),
        status: row.status, createdAt: String(row.created_at)
      }));
      send(res, 200, { items });
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/admin/feedback/status') {
      try {
        const value = await readJson(req, 1024) as Record<string, unknown>;
        if (!value || Object.keys(value).some(key => !['id', 'status'].includes(key)) ||
          typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) ||
          !['open', 'resolved'].includes(String(value.status))) throw new Error('invalid');
        this.getDatabase().run('UPDATE feedback_items SET status = ? WHERE id = ?', [String(value.status), value.id]);
        send(res, 200, { updated: true });
      } catch { send(res, 400, { error: '反馈状态无效' }); }
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/usage') {
      const uploadDevice = this.uploadDevice(req);
      if (!uploadDevice) { send(res, 401, { error: '设备上报凭证无效' }); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BODY) { send(res, 413, { error: '请求过大' }); return; }
        chunks.push(chunk);
      }
      let snapshot: UsageSnapshot;
      try { snapshot = validateSnapshot(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { send(res, 400, { error: '快照格式无效' }); return; }
      const allowedOwners = new Set(uploadDevice.ownerUserIds);
      if (snapshot.deviceId !== uploadDevice.deviceId || snapshot.rows.some(row => !allowedOwners.has(row.ownerUserId))) {
        send(res, 403, { error: '设备或用户归属超出授权范围' }); return;
      }
      const db = this.getDatabase();
      const previousRow = db.one('SELECT revision, accounting_version FROM device_revisions WHERE device_id = ?', [snapshot.deviceId]);
      const previous = Number(previousRow?.revision ?? -1);
      if (Number(previousRow?.accounting_version ?? 1) === 2 && snapshot.accountingVersion !== 2) {
        send(res, 409, { error: '不允许降级计量协议', currentRevision: previous }); return;
      }
      if (snapshot.revision < previous) { send(res, 409, { error: '旧版快照', currentRevision: previous }); return; }
      if (snapshot.revision === previous) { send(res, 200, { accepted: true, duplicate: true }); return; }
      db.transaction(() => {
        for (const provider of snapshot.providers) {
          // Clear only owners that this device was explicitly authorized to upload.
          // Legacy rows outside that history remain untouched.
          db.run(`DELETE FROM aggregates WHERE device_id = ? AND provider = ? AND owner_user_id IN
            (SELECT owner_user_id FROM upload_device_owner_history WHERE device_id = ?)`,
          [snapshot.deviceId, provider, snapshot.deviceId]);
          db.run(`DELETE FROM aggregate_status WHERE device_id = ? AND provider = ? AND owner_user_id IN
            (SELECT owner_user_id FROM upload_device_owner_history WHERE device_id = ?)`,
          [snapshot.deviceId, provider, snapshot.deviceId]);
        }
        for (const coverage of snapshot.coverage) db.run(`INSERT INTO source_coverage VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(device_id, provider) DO UPDATE SET status=excluded.status, last_scan=excluded.last_scan, revision=excluded.revision`,
          [snapshot.deviceId, coverage.provider, coverage.status, coverage.lastScan, snapshot.revision]);
        for (const row of snapshot.rows) {
          const subtotal = 'confirmedSubtotal' in row ? row.confirmedSubtotal : {
            inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheReadTokens,
            cacheCreationTokens: row.cacheCreationTokens, totalTokens: row.totalTokens, requests: row.requests
          };
          const status = 'totalStatus' in row ? row.totalStatus : 'legacy_unknown';
          const conflictCount = 'conflictCount' in row ? row.conflictCount : 0;
          const conflictSources = 'conflictSources' in row ? row.conflictSources : [];
          const recordedSubtotal = status === 'legacy_unknown' ? { inputTokens: 0, outputTokens: 0,
            cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, requests: 0 } : subtotal;
          db.run('INSERT INTO aggregate_status VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [snapshot.deviceId,
            row.ownerUserId, row.day, row.provider, row.model, status, JSON.stringify(recordedSubtotal), conflictCount,
            JSON.stringify(conflictSources)]);
          if (status === 'confirmed' || status === 'legacy_unknown') db.run('INSERT INTO aggregates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            snapshot.deviceId, row.ownerUserId, row.day, row.provider, row.model,
            'confirmedSubtotal' in row ? subtotal.inputTokens : row.inputTokens,
            'confirmedSubtotal' in row ? subtotal.outputTokens : row.outputTokens,
            'confirmedSubtotal' in row ? subtotal.cacheReadTokens : row.cacheReadTokens,
            'confirmedSubtotal' in row ? subtotal.cacheCreationTokens : row.cacheCreationTokens,
            'confirmedSubtotal' in row ? subtotal.totalTokens : row.totalTokens,
            'confirmedSubtotal' in row ? subtotal.requests : row.requests
          ]);
        }
        db.run('INSERT INTO device_revisions(device_id, revision, accounting_version) VALUES (?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET revision=excluded.revision, accounting_version=excluded.accounting_version',
          [snapshot.deviceId, snapshot.revision, snapshot.accountingVersion === 2 ? 2 : 1]);
      });
      send(res, 200, { accepted: true, duplicate: false });
      return;
    }
    send(res, 404, { error: '接口不存在' });
  }
}

export function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
