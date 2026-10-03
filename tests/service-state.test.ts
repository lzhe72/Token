import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';
import { UsageSync } from '../src/main/usage-sync';
import { ServerConnection } from '../src/main/server-connection';
import { LocalServer } from '../src/server/server';
import { localLabels, serviceLabels, syncLabels } from '../src/renderer/service-state';

const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')),
  decryptString: (value: Buffer) => value.toString('utf8').split('').reverse().join('')
};

test('TC-088 内置默认与同地址显式配置重启仍保留来源并可切回', async () => {
  const workspace = createTestWorkspace('tc088-source');
  const directory = path.join(workspace.root, 'server');
  const server = new LocalServer(directory);
  try {
    const port = await server.start();
    const base = `http://127.0.0.1:${port}`;
    const client = new ServerConnection(workspace.root, cipher);
    await client.startLocalService();
    expect(await client.status()).toMatchObject({ serviceType: 'built_in', configurationSource: 'default',
      remoteConfigured: false, reachable: true, authorization: 'authorized', protocol: 'compatible' });
    const token = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8').trim();
    const admin = fs.readFileSync(path.join(directory, 'server-admin.secret'), 'utf8').trim();
    client.setConfiguration(base, token, admin);
    expect(await client.status()).toMatchObject({ serviceType: 'configured', configurationSource: 'explicit',
      remoteConfigured: true, reachable: true, authorization: 'authorized', protocol: 'compatible' });
    const configText = fs.readFileSync(path.join(workspace.root, 'server-connection.json'), 'utf8');
    expect(configText).not.toContain(token);
    expect(configText).not.toContain(admin);
    const restarted = new ServerConnection(workspace.root, cipher);
    await restarted.startLocalService();
    expect(restarted.getUrl()).toBe(base);
    expect(await restarted.status()).toMatchObject({ serviceType: 'configured', configurationSource: 'explicit',
      remoteConfigured: true, authorization: 'authorized' });
    await restarted.useBuiltIn();
    expect(await restarted.status()).toMatchObject({ serviceType: 'built_in', configurationSource: 'default',
      remoteConfigured: false, authorization: 'authorized' });
    const restored = new ServerConnection(workspace.root, cipher);
    await restored.startLocalService();
    expect(await restored.status()).toMatchObject({ serviceType: 'built_in', configurationSource: 'default',
      remoteConfigured: false, authorization: 'authorized' });
  } finally { await server.stop(); workspace.cleanup(); }
});

test('TC-088 离线拒权与旧协议独立于配置来源和本机覆盖', async () => {
  const workspace = createTestWorkspace('tc088-dimensions');
  const directory = path.join(workspace.root, 'server');
  const server = new LocalServer(directory);
  const old = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url === '/health' ? { ok: true, accountingVersion: 1 } : { authorized: true }));
  });
  try {
    const port = await server.start();
    const client = new ServerConnection(workspace.root, cipher);
    client.setConfiguration(`http://127.0.0.1:${port}`, 'a'.repeat(64), 'b'.repeat(64));
    expect(await client.status()).toMatchObject({ reachable: true, authorization: 'rejected',
      protocol: 'compatible', online: false });
    await new Promise<void>(resolve => old.listen(0, '127.0.0.1', resolve));
    const address = old.address();
    if (!address || typeof address === 'string') throw new Error('测试服务未启动');
    client.setConfiguration(`http://127.0.0.1:${address.port}`, 'a'.repeat(64));
    expect(await client.status()).toMatchObject({ reachable: true, authorization: 'authorized',
      protocol: 'incompatible', online: true });
    await new Promise<void>(resolve => old.close(() => resolve()));
    expect(await client.status()).toMatchObject({ reachable: false, authorization: 'unknown',
      protocol: 'unknown', online: false });
    const combined = syncLabels({ pending: 1, uncertainRows: 2, localRevision: 30,
      confirmedRevision: 29, currentConfirmed: false, lastSuccess: '2026-10-02T00:00:00Z',
      lastAttempt: null, lastError: '协议不兼容' });
    expect(combined.delivery).toContain('待传');
    expect(combined.review).toContain('待核对');
    expect(localLabels([{ provider: 'codex', status: 'ready', lastScan: '2026-10-02T00:00:00Z' }]))
      .toContain('不证明当前筛选完整覆盖');
    expect(serviceLabels(await client.status()).connection).toBe('服务离线');
  } finally {
    if (old.listening) await new Promise<void>(resolve => old.close(() => resolve()));
    await server.stop(); workspace.cleanup();
  }
});

test('TC-088 切换服务后旧成功修订版失效且新快照待传再确认', async () => {
  const workspace = createTestWorkspace('tc088-revision');
  const db = await AppDatabase.open(workspace.databasePath);
  const first = new LocalServer(path.join(workspace.root, 'first'));
  const second = new LocalServer(path.join(workspace.root, 'second'));
  try {
    const owner = randomUUID();
    db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      [owner, 'owner', 'unused', 'viewer', '2026-10-02T00:00:00Z']);
    const scanner = new UsageScanner(db);
    db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', ['codex:test', 'codex', 'synthetic', owner]);
    db.run("INSERT INTO source_status(provider, status, file_count, fact_count, last_scan, detail) VALUES ('codex', 'ready', 1, 1, '2026-10-02T00:00:00Z', NULL)");
    db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['fact-a', 'codex', 'codex:test', 'session-a', 'gpt-test', '2026-10-02T00:00:00Z', 12, 0, 0, 0, 12]);
    const firstPort = await first.start();
    const secondPort = await second.start();
    const client = new ServerConnection(workspace.root, cipher);
    const configure = (directory: string, port: number) => client.setConfiguration(`http://127.0.0.1:${port}`,
      fs.readFileSync(path.join(directory, 'server.secret'), 'utf8').trim(),
      fs.readFileSync(path.join(directory, 'server-admin.secret'), 'utf8').trim());
    configure(path.join(workspace.root, 'first'), firstPort);
    const sync = new UsageSync(db, scanner, client);
    await sync.afterScan();
    expect(sync.status()).toMatchObject({ pending: 0, currentConfirmed: true });
    const oldRevision = sync.status().localRevision;
    const oldSuccess = sync.status().lastSuccess;
    configure(path.join(workspace.root, 'second'), secondPort);
    expect(sync.status()).toMatchObject({ pending: 0, currentConfirmed: false, lastSuccess: oldSuccess });
    db.transactionDurable(() => sync.queueSnapshot(['codex', 'claude']));
    expect(sync.status()).toMatchObject({ pending: 1, currentConfirmed: false });
    expect(sync.status().localRevision).toBeGreaterThan(oldRevision!);
    await sync.retryNow();
    expect(sync.status()).toMatchObject({ pending: 0, currentConfirmed: true,
      confirmedRevision: sync.status().localRevision });
    expect(second.getDatabase().one('SELECT total_tokens FROM aggregates')?.total_tokens).toBe(12);
  } finally { await first.stop(); await second.stop(); db.close(); workspace.cleanup(); }
});

test('TC-088 配置落盘失败保留旧身份且新配置不会拾取旧密钥', async () => {
  const workspace = createTestWorkspace('tc088-atomic');
  try {
    const client = new ServerConnection(workspace.root, cipher);
    client.setConfiguration('https://old.example.test', 'a'.repeat(64), 'b'.repeat(64));
    const oldId = client.getConnectionIdentity();
    const config = path.join(workspace.root, 'server-connection.json');
    const oldText = fs.readFileSync(config, 'utf8');
    const rename = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === config) throw new Error('synthetic disk failure');
      return rename(from, to);
    });
    expect(() => client.setConfiguration('https://new.example.test', 'c'.repeat(64))).toThrow('synthetic disk failure');
    spy.mockRestore();
    expect(client.getConnectionIdentity()).toBe(oldId);
    expect(client.getUrl()).toBe('https://old.example.test');
    expect(fs.readFileSync(config, 'utf8')).toBe(oldText);
    fs.writeFileSync(path.join(workspace.root, 'server-access.secret'), cipher.encryptString('a'.repeat(64)));
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('cannot delete legacy secret'); });
    client.setConfiguration('https://new.example.test', '', '');
    vi.restoreAllMocks();
    expect(new ServerConnection(workspace.root, cipher).getToken()).toBeNull();
  } finally { vi.restoreAllMocks(); workspace.cleanup(); }
});

test('TC-088 内置服务身份不符时不发送访问密钥', async () => {
  const workspace = createTestWorkspace('tc088-owned-id');
  const directory = path.join(workspace.root, 'server');
  fs.mkdirSync(directory);
  let exposed = false;
  const impostor = createServer((request, response) => {
    if (request.headers.authorization) exposed = true;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true, accountingVersion: 2, serverId: 'wrong-service' }));
  });
  try {
    await new Promise<void>(resolve => impostor.listen(0, '127.0.0.1', resolve));
    const address = impostor.address();
    if (!address || typeof address === 'string') throw new Error('测试服务未启动');
    fs.writeFileSync(path.join(directory, 'server-port.json'), JSON.stringify({ port: address.port }));
    fs.writeFileSync(path.join(directory, 'server.secret'), 'a'.repeat(64));
    const client = new ServerConnection(workspace.root, cipher);
    // Point the default managed endpoint at the synthetic port through the
    // owned-service discovery path; a mismatched identity must still be rejected.
    expect(await client.status()).toMatchObject({ reachable: false, online: false });
    await expect(client.request('/v1/auth/check')).rejects.toThrow('本机服务身份无法确认');
    expect(exposed).toBe(false);
  } finally {
    if (impostor.listening) await new Promise<void>(resolve => impostor.close(() => resolve()));
    workspace.cleanup();
  }
});

test('TC-088 内置服务身份检查期间切换配置不覆盖新地址或发送旧密钥', async () => {
  const workspace = createTestWorkspace('tc088-race');
  const directory = path.join(workspace.root, 'server');
  fs.mkdirSync(directory);
  const secret = 'a'.repeat(64);
  let entered!: () => void;
  let release!: () => void;
  const paused = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let exposed = false;
  const owned = createServer(async (request, response) => {
    if (request.headers.authorization) exposed = true;
    if (request.url === '/health') { entered(); await blocked; }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true, accountingVersion: 2,
      serverId: createHash('sha256').update(secret).digest('hex').slice(0, 16) }));
  });
  try {
    await new Promise<void>(resolve => owned.listen(0, '127.0.0.1', resolve));
    const address = owned.address();
    if (!address || typeof address === 'string') throw new Error('测试服务未启动');
    fs.writeFileSync(path.join(directory, 'server-port.json'), JSON.stringify({ port: address.port }));
    fs.writeFileSync(path.join(directory, 'server.secret'), secret);
    const client = new ServerConnection(workspace.root, cipher);
    const request = client.request('/v1/auth/check');
    await paused;
    client.setConfiguration('https://remote.example.test', 'b'.repeat(64), 'c'.repeat(64));
    release();
    await expect(request).rejects.toThrow('服务器连接已切换');
    expect(client.getUrl()).toBe('https://remote.example.test');
    expect(exposed).toBe(false);
  } finally { release?.(); await new Promise<void>(resolve => owned.close(() => resolve())); workspace.cleanup(); }
});
