import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
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
}

export class ServerConnection {
  private child: ChildProcess | null = null;
  private url: string;
  private error: string | null = null;
  private readonly configFile: string;
  private readonly secretFile: string;
  private readonly serverDirectory: string;

  constructor(private readonly userData: string, private readonly cipher: SecretCipher) {
    this.configFile = path.join(userData, 'server-connection.json');
    this.secretFile = path.join(userData, 'server-access.secret');
    this.serverDirectory = path.join(userData, 'server');
    try {
      const saved = JSON.parse(fs.readFileSync(this.configFile, 'utf8')) as { url: string };
      this.url = validUrl(saved.url);
    } catch {
      this.url = `http://127.0.0.1:${DEFAULT_PORT}`;
    }
  }

  async startLocalService(): Promise<void> {
    if (this.url !== `http://127.0.0.1:${DEFAULT_PORT}`) return;
    if (await this.pingOwned()) return;
    const serverScript = path.join(__dirname, 'server.cjs');
    const port = process.argv.some(arg => arg.startsWith('--token-user-data=')) || await this.ping() ? '0' : String(DEFAULT_PORT);
    this.child = spawn(process.execPath, [serverScript], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TOKEN_SERVER_DATA_DIR: this.serverDirectory,
        TOKEN_SERVER_PORT: process.env.TOKEN_SERVER_PORT || port,
        TOKEN_SERVER_HOST: process.env.TOKEN_SERVER_HOST || '127.0.0.1', TOKEN_SERVER_PARENT_PID: String(process.pid) },
      stdio: 'ignore'
    });
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        const info = JSON.parse(fs.readFileSync(path.join(this.serverDirectory, 'server-port.json'), 'utf8')) as { port: number };
        if (Number.isInteger(info.port) && info.port > 0 && info.port < 65536) {
          this.url = `http://127.0.0.1:${info.port}`;
          if (await this.pingOwned()) return;
        }
      } catch { /* server is starting */ }
      if (this.child.exitCode !== null) break;
    }
    this.error = '本机服务启动失败';
  }

  stop(): void { this.child?.kill(); this.child = null; }

  private token(): string | null {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(this.serverDirectory, 'server-port.json'), 'utf8')) as { port: number };
      if (this.url === `http://127.0.0.1:${info.port}`) {
        return fs.readFileSync(path.join(this.serverDirectory, 'server.secret'), 'utf8').trim();
      }
    } catch { /* configured external server */ }
    if (!this.cipher.isEncryptionAvailable() || !fs.existsSync(this.secretFile)) return null;
    try { return this.cipher.decryptString(fs.readFileSync(this.secretFile)); } catch { return null; }
  }

  setConfiguration(inputUrl: unknown, inputToken: unknown): void {
    if (typeof inputUrl !== 'string' || typeof inputToken !== 'string') throw new Error('服务器配置无效');
    const url = validUrl(inputUrl);
    if (inputToken && (!/^[a-f0-9]{64}$/.test(inputToken) || !this.cipher.isEncryptionAvailable())) throw new Error('服务密钥无效或安全存储不可用');
    const savedUrl = url === this.url && this.child ? `http://127.0.0.1:${DEFAULT_PORT}` : url;
    fs.writeFileSync(this.configFile, JSON.stringify({ url: savedUrl }), { mode: 0o600 });
    if (inputToken) fs.writeFileSync(this.secretFile, this.cipher.encryptString(inputToken), { mode: 0o600 });
    this.url = url;
    this.error = null;
  }

  getUrl(): string { return this.url; }
  getToken(): string | null { return this.token(); }

  private async pingOwned(): Promise<boolean> {
    try {
      const secret = fs.readFileSync(path.join(this.serverDirectory, 'server.secret'), 'utf8').trim();
      const info = JSON.parse(fs.readFileSync(path.join(this.serverDirectory, 'server-port.json'), 'utf8')) as { port: number };
      if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535) return false;
      const url = `http://127.0.0.1:${info.port}`;
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
      const body = await response.json() as { serverId?: string };
      const expected = createHash('sha256').update(secret).digest('hex').slice(0, 16);
      if (!response.ok || body.serverId !== expected) return false;
      this.url = url;
      return true;
    } catch { return false; }
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(1500) });
      return response.ok;
    } catch { return false; }
  }

  async status(): Promise<ConnectionStatus> {
    const token = this.token();
    let online = false;
    if (token) {
      try { online = (await this.request('/v1/auth/check', {}, 2000)).ok; } catch { /* unavailable */ }
    }
    return { url: this.url, online, error: online ? null : this.error || (token ? '无法连接服务器或密钥无效' : '缺少服务访问密钥'), hasToken: !!token };
  }

  async request(endpoint: string, init: RequestInit = {}, timeout = 5000): Promise<Response> {
    if (!/^\/v1\/[a-z/-]+$/.test(endpoint)) throw new Error('接口无效');
    const headers = new Headers(init.headers);
    const token = this.token();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const response = await fetch(`${this.url}${endpoint}`, { ...init, headers, signal: AbortSignal.timeout(timeout) });
    return response;
  }
}
