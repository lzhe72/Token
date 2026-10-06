import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateManifest } from '../server/server';
import type { UpdateStatus } from '../shared/types';
import type { ServerConnection } from './server-connection';

export type UpdateState = UpdateStatus;

export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => {
    if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error('版本号无效');
    return value.split('.').map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export class UpdateClient {
  private manifest: UpdateManifest | null = null;

  constructor(private readonly connection: ServerConnection, private readonly directory: string,
    private readonly currentVersion: string, private readonly arch: string,
    private readonly installPackage: (file: string, manifest: UpdateManifest) => Promise<void>) {}

  async check(): Promise<UpdateState> {
    try {
      const response = await this.connection.request('/v1/update/latest');
      if (response.status === 404) return { available: false, version: null, currentVersion: this.currentVersion,
        error: null, reason: 'no_package', packageArch: null };
      if (response.status === 401 || response.status === 403) throw new Error('更新服务拒绝访问，请检查服务器访问密钥');
      if (!response.ok) throw new Error(`更新服务不可用（HTTP ${response.status}）`);
      if (!response.body) throw new Error('更新清单为空');
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 16 * 1024) throw new Error('更新清单过大');
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as UpdateManifest;
      if (!value || !/^\d+\.\d+\.\d+$/.test(value.version) ||
        !['arm64', 'x64'].includes(value.arch) || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 2 * 1024 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(value.sha256) || !/^[A-Za-z0-9._-]+\.dmg$/.test(value.filename) ||
        value.downloadPath !== '/v1/update/package') throw new Error('更新清单无效');
      const compatible = value.arch === this.arch;
      const available = compatible && compareVersions(value.version, this.currentVersion) > 0;
      this.manifest = available ? value : null;
      return { available, version: value.version, currentVersion: this.currentVersion, error: null,
        reason: !compatible ? 'incompatible' : available ? 'available' : 'up_to_date', packageArch: value.arch };
    } catch (error) {
      this.manifest = null;
      return { available: false, version: null, currentVersion: this.currentVersion,
        error: error instanceof Error ? error.message : '检查更新失败', reason: 'error', packageArch: null };
    }
  }

  async downloadAndInstall(): Promise<string> {
    const manifest = this.manifest;
    if (!manifest) throw new Error('请先检查更新');
    const response = await this.connection.request('/v1/update/package', {}, 120000);
    if (!response.ok || !response.body) throw new Error('更新包下载失败');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const target = path.join(this.directory, manifest.filename);
    const temp = `${target}.${randomUUID()}.download`;
    const hash = createHash('sha256');
    let size = 0;
    let downloaded = false;
    try {
      const file = fs.openSync(temp, 'wx', 0o600);
      try {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const buffer = Buffer.from(value);
            size += buffer.length;
            if (size > manifest.size) throw new Error('更新包大小不符');
            hash.update(buffer);
            fs.writeSync(file, buffer);
          }
        } finally { reader.releaseLock(); }
      } finally { fs.closeSync(file); }
      if (size !== manifest.size || hash.digest('hex') !== manifest.sha256) throw new Error('更新包完整性校验失败');
      fs.renameSync(temp, target);
      downloaded = true;
      await this.installPackage(target, manifest);
      return target;
    } catch (error) {
      try { fs.unlinkSync(temp); } catch { /* no partial file */ }
      if (downloaded) try { fs.unlinkSync(target); } catch { /* helper may already own it */ }
      throw error;
    }
  }
}
