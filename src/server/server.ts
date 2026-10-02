import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { AppDatabase } from '../main/database';

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

export interface UsageSnapshot {
  deviceId: string;
  revision: number;
  providers: Array<'codex' | 'claude'>;
  coverage: Array<{ provider: 'codex' | 'claude'; status: 'ready' | 'no_records' | 'not_found' | 'error' | 'idle'; lastScan: string | null }>;
  rows: UsageAggregate[];
}

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
  if (Object.keys(input).some(key => !['deviceId', 'revision', 'providers', 'coverage', 'rows'].includes(key))) throw new Error('包含未允许字段');
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
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => !['ownerUserId', 'day', 'provider', 'model', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens', 'requests'].includes(key))) throw new Error('包含未允许字段');
    const item = row as Record<string, unknown>;
    if (typeof item.ownerUserId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.ownerUserId) ||
      typeof item.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.day) ||
      (item.provider !== 'codex' && item.provider !== 'claude') || !input.providers.includes(item.provider) ||
      typeof item.model !== 'string' || item.model.length > 160 ||
      !['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens', 'requests'].every(key => safeInteger(item[key]))) throw new Error('聚合字段无效');
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
    this.db.run(`CREATE TABLE IF NOT EXISTS feedback_items (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, category TEXT NOT NULL,
      title TEXT NOT NULL, message TEXT NOT NULL, diagnostics TEXT,
      app_version TEXT NOT NULL, platform TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL
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

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.origin) { send(res, 403, { error: '浏览器跨源请求不可用' }); return; }
    if (req.method === 'GET' && req.url === '/health') {
      send(res, 200, { ok: true, serverId: createHash('sha256').update(this.secret).digest('hex').slice(0, 16) }); return;
    }
    if ((req.url === '/v1/auth/check' || req.url === '/v1/update/latest' || req.url === '/v1/update/package' ||
      req.url === '/v1/usage' || req.url === '/v1/feedback' || req.url === '/v1/admin/feedback' ||
      req.url === '/v1/admin/feedback/status') && !this.authorized(req)) {
      send(res, 401, { error: '未授权' }); return;
    }
    if ((req.url === '/v1/admin/feedback' || req.url === '/v1/admin/feedback/status') && !this.authorizedAdmin(req)) {
      send(res, 403, { error: '需要服务管理密钥' }); return;
    }
    if (req.method === 'GET' && req.url === '/v1/auth/check') { send(res, 200, { authorized: true }); return; }
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
      const db = this.getDatabase();
      const previous = Number(db.one('SELECT revision FROM device_revisions WHERE device_id = ?', [snapshot.deviceId])?.revision ?? -1);
      if (snapshot.revision < previous) { send(res, 409, { error: '旧版快照', currentRevision: previous }); return; }
      if (snapshot.revision === previous) { send(res, 200, { accepted: true, duplicate: true }); return; }
      db.transaction(() => {
        for (const provider of snapshot.providers) db.run('DELETE FROM aggregates WHERE device_id = ? AND provider = ?', [snapshot.deviceId, provider]);
        for (const coverage of snapshot.coverage) db.run(`INSERT INTO source_coverage VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(device_id, provider) DO UPDATE SET status=excluded.status, last_scan=excluded.last_scan, revision=excluded.revision`,
          [snapshot.deviceId, coverage.provider, coverage.status, coverage.lastScan, snapshot.revision]);
        for (const row of snapshot.rows) db.run('INSERT INTO aggregates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          snapshot.deviceId, row.ownerUserId, row.day, row.provider, row.model,
          row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheCreationTokens, row.totalTokens, row.requests
        ]);
        db.run('INSERT INTO device_revisions VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET revision=excluded.revision', [snapshot.deviceId, snapshot.revision]);
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
