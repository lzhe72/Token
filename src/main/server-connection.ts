import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SecretCipher } from './trusted-device';

const DEFAULT_PORT = 47839;

function validUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('服务器地址无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash) throw new Error('服务器地址无效');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.protocol !== 'https:') {
    throw new Error('非本机服务器需要 HTTPS 地址');
  }
  return url.origin;
}

export interface ConnectionStatus {
  url: string;
  online: boolean;
  error: string | null;
  hasToken: boolean;
  serviceType: 'built_in' | 'configured';
  configurationSource: 'default' | 'explicit' | 'legacy';
  remoteConfigured: boolean;
  reachable: boolean;
  authorization: 'authorized' | 'missing' | 'rejected' | 'unknown';
  protocol: 'compatible' | 'incompatible' | 'unknown';
}

export class ServerConnection {
  private child: ChildProcess | null = null;
  private url: string;
  private error: string | null = null;
  private configurationSource: ConnectionStatus['configurationSource'] = 'default';
  private serviceType: ConnectionStatus['serviceType'] = 'built_in';
  private connectionId = 'default';
  private accessSecret: Buffer | null = null;
  private adminSecret: Buffer | null = null;
  private allowReactivation = false;
  private configurationRevision = 0;
  private readonly configFile: string;
  private readonly secretFile: string;
  private readonly adminSecretFile: string;
  private readonly usageCredentialFile: string;
  private readonly serverDirectory: string;

  constructor(private readonly userData: string, private readonly cipher: SecretCipher) {
    this.configFile = path.join(userData, 'server-connection.json');
    this.secretFile = path.join(userData, 'server-access.secret');
    this.adminSecretFile = path.join(userData, 'server-admin-access.secret');
    this.usageCredentialFile = path.join(userData, 'server-usage-device.json');
    this.serverDirectory = path.join(userData, 'server');
    try {
      const saved = JSON.parse(fs.readFileSync(this.configFile, 'utf8')) as {
        url: string; configurationSource?: string; serviceType?: string; connectionId?: string;
        accessSecret?: string; adminSecret?: string
      };
      this.url = validUrl(saved.url);
      this.configurationSource = saved.configurationSource === 'explicit' ? 'explicit' :
        saved.configurationSource === 'default' ? 'default' : 'legacy';
      this.serviceType = saved.serviceType === 'built_in' ||
        !saved.serviceType && this.url === `http://127.0.0.1:${DEFAULT_PORT}` ? 'built_in' : 'configured';
      this.connectionId = typeof saved.connectionId === 'string' && /^[a-f0-9-]{36}$/.test(saved.connectionId)
        ? saved.connectionId : `legacy:${this.url}`;
      const legacySecrets = !saved.connectionId;
      this.accessSecret = saved.accessSecret ? Buffer.from(saved.accessSecret, 'base64') :
        legacySecrets && fs.existsSync(this.secretFile) ? fs.readFileSync(this.secretFile) : null;
      this.adminSecret = saved.adminSecret ? Buffer.from(saved.adminSecret, 'base64') :
        legacySecrets && fs.existsSync(this.adminSecretFile) ? fs.readFileSync(this.adminSecretFile) : null;
    } catch {
      this.url = `http://127.0.0.1:${DEFAULT_PORT}`;
    }
  }

  async startLocalService(): Promise<void> {
    if (this.serviceType !== 'built_in' || this.url !== `http://127.0.0.1:${DEFAULT_PORT}`) return;
    const revision = this.configurationRevision;
    const existing = await this.ownedEndpoint();
    if (this.configurationRevision !== revision || this.serviceType !== 'built_in') return;
    if (existing) { this.url = existing; return; }
    const serverScript = path.join(__dirname, 'server.cjs');
    const port = process.argv.some(arg => arg.startsWith('--token-user-data=')) || await this.ping() ? '0' : String(DEFAULT_PORT);
    if (this.configurationRevision !== revision || this.serviceType !== 'built_in') return;
    const child = spawn(process.execPath, [serverScript], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TOKEN_SERVER_DATA_DIR: this.serverDirectory,
        TOKEN_SERVER_PORT: process.env.TOKEN_SERVER_PORT || port,
        TOKEN_SERVER_HOST: process.env.TOKEN_SERVER_HOST || '127.0.0.1', TOKEN_SERVER_PARENT_PID: String(process.pid) },
      stdio: 'ignore'
    });
    this.child = child;
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (this.configurationRevision !== revision || this.serviceType !== 'built_in') {
        child.kill();
        if (this.child === child) this.child = null;
        return;
      }
      try {
        const info = JSON.parse(fs.readFileSync(path.join(this.serverDirectory, 'server-port.json'), 'utf8')) as { port: number };
        if (Number.isInteger(info.port) && info.port > 0 && info.port < 65536) {
          const owned = await this.ownedEndpoint();
          if (this.configurationRevision !== revision || this.serviceType !== 'built_in') {
            child.kill();
            if (this.child === child) this.child = null;
            return;
          }
          if (owned) { this.url = owned; return; }
        }
      } catch { /* server is starting */ }
      if (child.exitCode !== null) break;
    }
    this.error = '本机服务启动失败';
  }

  stop(): void { this.child?.kill(); this.child = null; }

  private writeConfiguration(value: Record<string, string>): void {
    const temp = `${this.configFile}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
      fs.renameSync(temp, this.configFile);
    } catch (error) {
      try { fs.unlinkSync(temp); } catch { /* no staged file */ }
      throw error;
    }
  }

  private clearOldCredentials(): void {
    for (const file of [this.secretFile, this.adminSecretFile, this.usageCredentialFile]) {
      try { fs.unlinkSync(file); } catch { /* old encrypted credentials are ignored by connectionId */ }
    }
  }

  private token(): string | null {
    if (this.serviceType === 'built_in') {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(this.serverDirectory, 'server-port.json'), 'utf8')) as { port: number };
        if (this.url === `http://127.0.0.1:${info.port}`) {
          return fs.readFileSync(path.join(this.serverDirectory, 'server.secret'), 'utf8').trim();
        }
      } catch { /* owned service is unavailable */ }
      return null;
    }
    if (!this.cipher.isEncryptionAvailable() || !this.accessSecret) return null;
    try { return this.cipher.decryptString(this.accessSecret); } catch { return null; }
  }

  validateConfiguration(inputUrl: unknown, inputToken: unknown, inputAdminToken: unknown = ''): string {
    if (typeof inputUrl !== 'string' || typeof inputToken !== 'string' || typeof inputAdminToken !== 'string') throw new Error('服务器配置无效');
    const url = validUrl(inputUrl);
    if (inputToken && (!/^[a-f0-9]{64}$/.test(inputToken) || !this.cipher.isEncryptionAvailable())) throw new Error('服务密钥无效或安全存储不可用');
    if (inputAdminToken && (!/^[a-f0-9]{64}$/.test(inputAdminToken) || !this.cipher.isEncryptionAvailable())) throw new Error('服务管理密钥无效或安全存储不可用');
    return url;
  }

  setConfiguration(inputUrl: unknown, inputToken: unknown, inputAdminToken: unknown = ''): void {
    const url = this.validateConfiguration(inputUrl, inputToken, inputAdminToken);
    const token = inputToken as string;
    const adminToken = inputAdminToken as string;
    const sameConfiguredService = this.serviceType === 'configured' && url === this.url;
    const accessSecret = token ? this.cipher.encryptString(token) :
      sameConfiguredService ? this.accessSecret : null;
    const adminSecret = adminToken ? this.cipher.encryptString(adminToken) :
      sameConfiguredService ? this.adminSecret : null;
    const connectionId = randomUUID();
    this.writeConfiguration({ url, configurationSource: 'explicit', serviceType: 'configured', connectionId,
      ...(accessSecret ? { accessSecret: accessSecret.toString('base64') } : {}),
      ...(adminSecret ? { adminSecret: adminSecret.toString('base64') } : {}) });
    // Saving the connection is an explicit administrator action. The next upload
    // must obtain a fresh credential for this service and its current user scope.
    this.clearOldCredentials();
    this.allowReactivation = true;
    this.url = url;
    this.configurationSource = 'explicit';
    this.serviceType = 'configured';
    this.connectionId = connectionId;
    this.accessSecret = accessSecret;
    this.adminSecret = adminSecret;
    this.configurationRevision++;
    this.error = null;
  }

  getUrl(): string { return this.url; }
  getToken(): string | null { return this.token(); }
  getConnectionIdentity(): string { return `${this.connectionId}:${this.url}`; }

  async useBuiltIn(): Promise<ConnectionStatus> {
    const connectionId = randomUUID();
    this.writeConfiguration({ url: `http://127.0.0.1:${DEFAULT_PORT}`, configurationSource: 'default',
      serviceType: 'built_in', connectionId });
    this.connectionId = connectionId;
    this.configurationSource = 'default';
    this.serviceType = 'built_in';
    this.url = `http://127.0.0.1:${DEFAULT_PORT}`;
    this.accessSecret = null;
    this.adminSecret = null;
    this.error = null;
    this.configurationRevision++;
    this.clearOldCredentials();
    await this.startLocalService();
    return this.status();
  }

  private adminToken(): string | null {
    if (this.serviceType === 'built_in') {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(this.serverDirectory, 'server-port.json'), 'utf8')) as { port: number };
        if (this.url === `http://127.0.0.1:${info.port}`) {
          return fs.readFileSync(path.join(this.serverDirectory, 'server-admin.secret'), 'utf8').trim();
        }
      } catch { /* owned service is unavailable */ }
      return null;
    }
    if (!this.cipher.isEncryptionAvailable() || !this.adminSecret) return null;
    try { return this.cipher.decryptString(this.adminSecret); } catch { return null; }
  }

  adminRequest(endpoint: string, init: RequestInit = {}, timeout = 5000): Promise<Response> {
    if (!endpoint.startsWith('/v1/admin/')) throw new Error('管理接口无效');
    const adminToken = this.adminToken();
    if (!adminToken) throw new Error('尚未配置服务管理密钥');
    const headers = new Headers(init.headers);
    headers.set('x-token-admin', adminToken);
    return this.request(endpoint, { ...init, headers }, timeout);
  }

  private async usageToken(deviceId: string, ownerUserIds: string[]): Promise<string> {
    if (!this.cipher.isEncryptionAvailable()) throw new Error('设备上报需要系统安全存储');
    const url = this.url;
    const revision = this.configurationRevision;
    const owners = [...new Set(ownerUserIds)].sort();
    const scope = JSON.stringify(owners);
    try {
      const stored = JSON.parse(fs.readFileSync(this.usageCredentialFile, 'utf8')) as {
        url: string; connectionId?: string; deviceId: string; scope: string; token: string
      };
      if (stored.url === this.url && stored.connectionId === this.connectionId &&
        stored.deviceId === deviceId && stored.scope === scope) {
        const token = this.cipher.decryptString(Buffer.from(stored.token, 'base64'));
        if (/^[a-f0-9]{64}$/.test(token)) return token;
      }
    } catch { /* missing or invalid credential requires administrator registration */ }
    const response = await this.adminRequest('/v1/admin/devices/enroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId, ownerUserIds: owners, reactivate: this.allowReactivation })
    });
    if (this.url !== url || this.configurationRevision !== revision) throw new Error('服务器连接已切换，请重试上报');
    if (!response.ok) throw new Error(`设备上报登记失败 (${response.status})`);
    const body = await response.json() as { token?: unknown; deviceId?: unknown; ownerUserIds?: unknown };
    if (this.url !== url || this.configurationRevision !== revision) throw new Error('服务器连接已切换，请重试上报');
    if (body.deviceId !== deviceId || !Array.isArray(body.ownerUserIds) ||
      JSON.stringify(body.ownerUserIds) !== scope || typeof body.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.token)) throw new Error('设备上报凭证无效');
    const encrypted = this.cipher.encryptString(body.token);
    const temp = `${this.usageCredentialFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ url, connectionId: this.connectionId, deviceId,
      scope, token: encrypted.toString('base64') }), { mode: 0o600 });
    fs.renameSync(temp, this.usageCredentialFile);
    this.allowReactivation = false;
    return body.token;
  }

  async uploadUsage(payload: string, deviceId: string, ownerUserIds: string[], timeout = 10000): Promise<Response> {
    if (this.serviceType === 'built_in') {
      const revision = this.configurationRevision;
      const owned = await this.ownedEndpoint();
      if (this.configurationRevision !== revision || this.serviceType !== 'built_in') throw new Error('服务器连接已切换，请重试上报');
      if (!owned) throw new Error('本机服务身份无法确认');
      this.url = owned;
    }
    const url = this.url;
    const revision = this.configurationRevision;
    const token = await this.usageToken(deviceId, ownerUserIds);
    if (this.url !== url || this.configurationRevision !== revision) throw new Error('服务器连接已切换，请重试上报');
    const response = await fetch(`${url}/v1/usage`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: payload, signal: AbortSignal.timeout(timeout) });
    if (this.url !== url || this.configurationRevision !== revision) throw new Error('服务器连接已切换，请重试上报');
    return response;
  }

  private async ownedEndpoint(): Promise<string | null> {
    try {
      const secret = fs.readFileSync(path.join(this.serverDirectory, 'server.secret'), 'utf8').trim();
      const info = JSON.parse(fs.readFileSync(path.join(this.serverDirectory, 'server-port.json'), 'utf8')) as { port: number };
      if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535) return null;
      const url = `http://127.0.0.1:${info.port}`;
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
      const body = await response.json() as { serverId?: string };
      const expected = createHash('sha256').update(secret).digest('hex').slice(0, 16);
      if (!response.ok || body.serverId !== expected) return null;
      return url;
    } catch { return null; }
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(1500) });
      return response.ok;
    } catch { return false; }
  }

  async status(): Promise<ConnectionStatus> {
    const statusRevision = this.configurationRevision;
    const statusUrl = this.url;
    const token = this.token();
    const serviceType = this.serviceType;
    let reachable = false;
    let protocol: ConnectionStatus['protocol'] = 'unknown';
    try {
      const response = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok && response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 4096) throw new Error('服务健康响应过大');
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const health = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { accountingVersion?: unknown; serverId?: unknown };
        if (serviceType === 'built_in') {
          const secret = fs.readFileSync(path.join(this.serverDirectory, 'server.secret'), 'utf8').trim();
          const expected = createHash('sha256').update(secret).digest('hex').slice(0, 16);
          if (health.serverId !== expected) throw new Error('本机服务身份不匹配');
        }
        reachable = true;
        protocol = health.accountingVersion === 2 ? 'compatible' : 'incompatible';
      }
    } catch { /* network or invalid health response */ }
    let authorization: ConnectionStatus['authorization'] = token ? 'unknown' : 'missing';
    if (reachable && token) {
      try { authorization = (await this.request('/v1/auth/check', {}, 2000)).ok ? 'authorized' : 'rejected'; }
      catch { authorization = 'unknown'; }
    }
    const online = reachable && authorization === 'authorized';
    const error = !reachable ? this.error || '服务器离线或健康检查失败'
      : authorization === 'missing' ? '缺少服务访问密钥'
      : authorization === 'rejected' ? '服务访问密钥未获授权'
      : protocol === 'incompatible' ? '服务端计量协议不兼容'
      : authorization === 'unknown' ? '服务授权状态未知' : null;
    if (this.configurationRevision !== statusRevision || this.url !== statusUrl) return this.status();
    return { url: this.url, online, error, hasToken: !!token, serviceType,
      configurationSource: this.configurationSource, remoteConfigured: this.serviceType === 'configured',
      reachable, authorization, protocol };
  }

  async request(endpoint: string, init: RequestInit = {}, timeout = 5000): Promise<Response> {
    if (!/^\/v1\/[a-z/-]+$/.test(endpoint)) throw new Error('接口无效');
    if (this.serviceType === 'built_in') {
      const revision = this.configurationRevision;
      const owned = await this.ownedEndpoint();
      if (this.configurationRevision !== revision || this.serviceType !== 'built_in') throw new Error('服务器连接已切换，请重试请求');
      if (!owned) throw new Error('本机服务身份无法确认');
      this.url = owned;
    }
    const url = this.url;
    const revision = this.configurationRevision;
    const headers = new Headers(init.headers);
    const token = this.token();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const response = await fetch(`${url}${endpoint}`, { ...init, headers, signal: AbortSignal.timeout(timeout) });
    if (this.url !== url || this.configurationRevision !== revision) throw new Error('服务器连接已切换，请重试请求');
    return response;
  }
}
