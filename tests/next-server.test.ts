import { expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { createTestWorkspace } from './support/test-workspace';
import { LocalServer, type UsageSnapshot } from '../src/server/server';
import { ServerConnection } from '../src/main/server-connection';

function fixture(directory: string, version = '1.2.3') {
  const bytes = Buffer.from('synthetic-dmg-payload');
  const source = path.join(path.dirname(directory), 'synthetic.dmg');
  fs.writeFileSync(source, bytes);
  execFileSync(process.execPath, ['scripts/publish-update.mjs', source, version, 'arm64', directory], { cwd: path.resolve('.') });
  return JSON.parse(fs.readFileSync(path.join(directory, 'releases', 'latest.json'), 'utf8'));
}

test('TC-032 服务默认地址可配置且停服不影响本机数据库', async () => {
  const workspace = createTestWorkspace('server-bind');
  const directory = path.join(workspace.root, 'server');
  const server = new LocalServer(directory);
  try {
    const port = await server.start(0, '127.0.0.1');
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'server-port.json'), 'utf8'))).toMatchObject({ host: '127.0.0.1', port });
    await server.stop();
    expect(fs.existsSync(workspace.databasePath)).toBe(false);
    const configured = new LocalServer(path.join(workspace.root, 'alternate'));
    try {
      await expect(configured.start(0, '0.0.0.0')).rejects.toThrow('TLS');
      const anotherPort = await configured.start(0, 'localhost');
      expect((await fetch(`http://localhost:${anotherPort}/health`)).ok).toBe(true);
    } finally { await configured.stop(); }
    const key = path.join(workspace.root, 'test.key');
    const cert = path.join(workspace.root, 'test.crt');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
      '-out', cert, '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
    const network = new LocalServer(path.join(workspace.root, 'tls-server'), { key: fs.readFileSync(key), cert: fs.readFileSync(cert) });
    try {
      const tlsPort = await network.start(0, '0.0.0.0');
      const status = await new Promise<number>((resolve, reject) => {
        https.get(`https://127.0.0.1:${tlsPort}/health`, { rejectUnauthorized: false }, response => {
          response.resume(); resolve(response.statusCode ?? 0);
        }).on('error', reject);
      });
      expect(status).toBe(200);
    } finally { await network.stop(); }
  } finally { workspace.cleanup(); }
});

test('TC-033 更新清单与包哈希一致且拒绝路径穿越', async () => {
  const workspace = createTestWorkspace('server-package');
  const directory = path.join(workspace.root, 'server');
  fixture(directory);
  const server = new LocalServer(directory);
  try {
    const port = await server.start();
    const base = `http://127.0.0.1:${port}`;
    const secret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8');
    const headers = { authorization: `Bearer ${secret}` };
    expect((await fetch(`${base}/v1/update/latest`)).status).toBe(401);
    const manifest = await (await fetch(`${base}/v1/update/latest`, { headers })).json();
    const bytes = Buffer.from(await (await fetch(`${base}/v1/update/package`, { headers })).arrayBuffer());
    expect(bytes.length).toBe(manifest.size);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
    expect((await fetch(`${base}/v1/update/../server.secret`)).status).toBe(404);
    expect((await fetch(`${base}/v1/update/package?file=../server.secret`)).status).toBe(404);
  } finally { await server.stop(); workspace.cleanup(); }
});

test('TC-047 上报接口鉴权和字段白名单', async () => {
  const workspace = createTestWorkspace('server-auth');
  const directory = path.join(workspace.root, 'server');
  const server = new LocalServer(directory);
  try {
    const port = await server.start();
    const url = `http://127.0.0.1:${port}/v1/usage`;
    const secret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8');
    const snapshot: UsageSnapshot = { deviceId: randomUUID(), revision: 1, providers: ['codex'], coverage: [
      { provider: 'codex', status: 'ready', lastScan: '2026-10-02T00:00:00Z' },
      { provider: 'claude', status: 'not_found', lastScan: null }
    ], rows: [{
      ownerUserId: randomUUID(), day: '2026-10-02', provider: 'codex', model: 'gpt-test',
      inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 0, totalTokens: 12, requests: 1
    }] };
    const post = (token: string, body: unknown) => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('bad', snapshot)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/v1/auth/check`, { headers: { authorization: 'Bearer bad' } })).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/v1/auth/check`, { headers: { authorization: `Bearer ${secret}` } })).status).toBe(200);
    expect((await post(secret, { ...snapshot, rows: [{ ...snapshot.rows[0], prompt: 'secret' }] })).status).toBe(400);
    expect(Number(server.getDatabase().one('SELECT COUNT(*) AS count FROM aggregates')?.count)).toBe(0);
    expect((await post(secret, snapshot)).status).toBe(200);
    expect(Number(server.getDatabase().one('SELECT COUNT(*) AS count FROM aggregates')?.count)).toBe(1);
    expect((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${secret}`, origin: 'https://example.com' }, body: JSON.stringify(snapshot) })).status).toBe(403);
    const client = new ServerConnection(workspace.root, {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value),
      decryptString: value => value.toString('utf8')
    });
    expect(() => client.setConfiguration('http://192.168.1.12:47839', secret)).toThrow('HTTPS');
    client.setConfiguration('https://192.168.1.12:47839', secret);
    expect(client.getUrl()).toBe('https://192.168.1.12:47839');
  } finally { await server.stop(); workspace.cleanup(); }
});

export { fixture };
