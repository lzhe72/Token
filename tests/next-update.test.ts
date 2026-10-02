import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from './support/test-workspace';
import { LocalServer } from '../src/server/server';
import { UpdateClient } from '../src/main/update-client';
import type { ServerConnection } from '../src/main/server-connection';

function release(directory: string, version: string, hashOverride?: string) {
  const releases = path.join(directory, 'releases');
  fs.mkdirSync(releases, { recursive: true });
  const filename = 'Token-test-arm64.dmg';
  const bytes = Buffer.from('synthetic-installer');
  fs.writeFileSync(path.join(releases, filename), bytes);
  fs.writeFileSync(path.join(releases, 'latest.json'), JSON.stringify({
    version, arch: 'arm64', size: bytes.length,
    sha256: hashOverride ?? createHash('sha256').update(bytes).digest('hex'),
    filename, downloadPath: '/v1/update/package', publishedAt: '2026-10-02T00:00:00Z'
  }));
}

function connection(base: string, secret: string): ServerConnection {
  return { request: (endpoint: string) => fetch(`${base}${endpoint}`, { headers: { authorization: `Bearer ${secret}` } }) } as unknown as ServerConnection;
}

test('TC-034 只提示较新且架构匹配的版本并校验包摘要', async () => {
  const workspace = createTestWorkspace('update-version');
  const directory = path.join(workspace.root, 'server');
  release(directory, '1.0.0');
  const server = new LocalServer(directory);
  try {
    const port = await server.start();
    const secret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8');
    const downloads = path.join(workspace.root, 'downloads');
    let opened = 0;
    const client = new UpdateClient(connection(`http://127.0.0.1:${port}`, secret), downloads, '1.0.0', 'arm64', async () => { opened++; return ''; });
    expect((await client.check()).available).toBe(false);
    release(directory, '0.9.9');
    expect((await client.check()).available).toBe(false);
    release(directory, '1.1.0', '0'.repeat(64));
    expect((await client.check()).available).toBe(true);
    await expect(client.downloadAndOpen()).rejects.toThrow('完整性校验失败');
    expect(opened).toBe(0);
    expect(fs.existsSync(path.join(downloads, 'Token-test-arm64.dmg.download'))).toBe(false);
    const wrongArch = new UpdateClient(connection(`http://127.0.0.1:${port}`, secret), downloads, '1.0.0', 'x64', async () => '');
    expect((await wrongArch.check()).available).toBe(false);
  } finally { await server.stop(); workspace.cleanup(); }
});

test('TC-035 停服和下载失败可重试且不留临时包', async () => {
  const workspace = createTestWorkspace('update-failure');
  const directory = path.join(workspace.root, 'server');
  release(directory, '1.1.0');
  const server = new LocalServer(directory);
  try {
    const port = await server.start();
    const secret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8');
    const base = `http://127.0.0.1:${port}`;
    const client = new UpdateClient(connection(base, secret), path.join(workspace.root, 'downloads'), '1.0.0', 'arm64', async () => '');
    expect((await client.check()).available).toBe(true);
    await server.stop();
    await expect(client.downloadAndOpen()).rejects.toThrow();
    expect(fs.existsSync(path.join(workspace.root, 'downloads', 'Token-test-arm64.dmg.download'))).toBe(false);
    const restarted = new LocalServer(directory);
    try {
      const newPort = await restarted.start();
      const retry = new UpdateClient(connection(`http://127.0.0.1:${newPort}`, secret), path.join(workspace.root, 'downloads'), '1.0.0', 'arm64', async () => '');
      expect((await retry.check()).available).toBe(true);
      await retry.downloadAndOpen();
    } finally { await restarted.stop(); }
  } finally { workspace.cleanup(); }
});

test('TC-036 校验后只打开安装包而不替换现有应用', async () => {
  const workspace = createTestWorkspace('update-handoff');
  const directory = path.join(workspace.root, 'server');
  release(directory, '1.1.0');
  const server = new LocalServer(directory);
  try {
    const port = await server.start();
    const secret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8');
    const existing = path.join(workspace.root, 'existing-app.txt');
    fs.writeFileSync(existing, 'unchanged');
    let opened = '';
    const client = new UpdateClient(connection(`http://127.0.0.1:${port}`, secret), path.join(workspace.root, 'downloads'), '1.0.0', 'arm64', async file => { opened = file; return ''; });
    expect((await client.check()).available).toBe(true);
    const packageFile = await client.downloadAndOpen();
    expect(opened).toBe(packageFile);
    expect(fs.readFileSync(existing, 'utf8')).toBe('unchanged');
    expect(fs.existsSync(packageFile)).toBe(true);
    const openFailure = new UpdateClient(connection(`http://127.0.0.1:${port}`, secret), path.join(workspace.root, 'downloads'),
      '1.0.0', 'arm64', async () => 'synthetic open failure');
    expect((await openFailure.check()).available).toBe(true);
    await expect(openFailure.downloadAndOpen()).rejects.toThrow('无法打开安装包：synthetic open failure');
    expect(fs.readFileSync(existing, 'utf8')).toBe('unchanged');
  } finally { await server.stop(); workspace.cleanup(); }
});
