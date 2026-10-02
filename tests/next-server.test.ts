import { expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
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

function trustedTlsFixture(directory: string): { address: string; key: Buffer; cert: Buffer; ca: Buffer } {
  const address = Object.values(os.networkInterfaces()).flat()
    .find(item => item?.family === 'IPv4' && !item.internal)?.address;
  if (!address) throw new Error('严格 TLS 测试需要本机非回环 IPv4 地址');
  const caKey = path.join(directory, 'ca.key');
  const caCert = path.join(directory, 'ca.crt');
  const serverKey = path.join(directory, 'server.key');
  const request = path.join(directory, 'server.csr');
  const serverCert = path.join(directory, 'server.crt');
  const extensions = path.join(directory, 'server.ext');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey,
    '-out', caCert, '-subj', '/CN=Token Test CA', '-days', '1',
    '-addext', 'basicConstraints=critical,CA:TRUE'], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', serverKey,
    '-out', request, '-subj', '/CN=Token Test Server'], { stdio: 'ignore' });
  fs.writeFileSync(extensions, `basicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:${address}\n`);
  execFileSync('openssl', ['x509', '-req', '-in', request, '-CA', caCert, '-CAkey', caKey,
    '-CAcreateserial', '-out', serverCert, '-days', '1', '-extfile', extensions], { stdio: 'ignore' });
  execFileSync('openssl', ['verify', '-CAfile', caCert, serverCert], { stdio: 'ignore' });
  return { address, key: fs.readFileSync(serverKey), cert: fs.readFileSync(serverCert), ca: fs.readFileSync(caCert) };
}

function secureRequest(hostname: string, port: number, ca: Buffer | undefined, endpoint: string,
  token?: string, method = 'GET', body?: unknown, adminToken?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (adminToken) headers['x-token-admin'] = adminToken;
    const request = https.request({ hostname, port, path: endpoint, method, ca,
      rejectUnauthorized: true, headers, timeout: 3000 }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('timeout', () => request.destroy(new Error('TLS 请求超时')));
    request.on('error', reject);
    request.end(payload);
  });
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
    const adminSecret = fs.readFileSync(path.join(directory, 'server-admin.secret'), 'utf8');
    const snapshot: UsageSnapshot = { deviceId: randomUUID(), revision: 1, providers: ['codex'], coverage: [
      { provider: 'codex', status: 'ready', lastScan: '2026-10-02T00:00:00Z' },
      { provider: 'claude', status: 'not_found', lastScan: null }
    ], rows: [{
      ownerUserId: randomUUID(), day: '2026-10-02', provider: 'codex', model: 'gpt-test',
      inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 0, totalTokens: 12, requests: 1
    }] };
    const post = (token: string, body: unknown) => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('bad', snapshot)).status).toBe(401);
    expect((await post(secret, snapshot)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/v1/auth/check`, { headers: { authorization: 'Bearer bad' } })).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/v1/auth/check`, { headers: { authorization: `Bearer ${secret}` } })).status).toBe(200);
    const registration = await fetch(`http://127.0.0.1:${port}/v1/admin/devices/enroll`, { method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'x-token-admin': adminSecret, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: snapshot.deviceId, ownerUserIds: [snapshot.rows[0].ownerUserId] }) });
    expect(registration.ok).toBe(true);
    const token = (await registration.json() as { token: string }).token;
    expect((await post(token, { ...snapshot, rows: [{ ...snapshot.rows[0], prompt: 'secret' }] })).status).toBe(400);
    expect(Number(server.getDatabase().one('SELECT COUNT(*) AS count FROM aggregates')?.count)).toBe(0);
    expect((await post(token, snapshot)).status).toBe(200);
    expect(Number(server.getDatabase().one('SELECT COUNT(*) AS count FROM aggregates')?.count)).toBe(1);
    expect((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: 'https://example.com' }, body: JSON.stringify(snapshot) })).status).toBe(403);
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

test('TC-047 非回环 HTTPS 监听仍执行清单与上报鉴权', async () => {
  const workspace = createTestWorkspace('tc047-https-auth');
  const directory = path.join(workspace.root, 'server');
  const key = path.join(workspace.root, 'test.key');
  const cert = path.join(workspace.root, 'test.crt');
  let server: LocalServer | null = null;
  let started = false;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
      '-out', cert, '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
    fixture(directory);
    server = new LocalServer(directory, { key: fs.readFileSync(key), cert: fs.readFileSync(cert) });
    const port = await server.start(0, '0.0.0.0');
    started = true;
    const secret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8').trim();
    const adminSecret = fs.readFileSync(path.join(directory, 'server-admin.secret'), 'utf8').trim();
    const request = (endpoint: string, token: string, method = 'GET', body?: unknown, adminToken?: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const payload = body === undefined ? '' : JSON.stringify(body);
        const headers: Record<string, string> = { authorization: `Bearer ${token}` };
        if (body !== undefined) headers['content-type'] = 'application/json';
        if (adminToken) headers['x-token-admin'] = adminToken;
        const client = https.request({ hostname: '127.0.0.1', port, path: endpoint, method,
          rejectUnauthorized: false, headers }, response => {
          const chunks: Buffer[] = [];
          response.on('data', chunk => chunks.push(Buffer.from(chunk)));
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        });
        client.on('error', reject);
        client.end(payload);
      });
    expect((await request('/v1/update/latest', 'bad')).status).toBe(401);
    expect((await request('/v1/update/package', 'bad')).status).toBe(401);
    expect((await request('/v1/update/latest', secret)).status).toBe(200);
    expect((await request('/v1/update/package', secret)).status).toBe(200);
    const deviceId = randomUUID();
    const ownerUserId = randomUUID();
    const body = { deviceId, revision: 1, providers: ['codex'], coverage: [
      { provider: 'codex', status: 'ready', lastScan: '2026-10-02T00:00:00Z' },
      { provider: 'claude', status: 'not_found', lastScan: null }
    ], rows: [{ ownerUserId, day: '2026-10-02', provider: 'codex', model: 'gpt-test',
      inputTokens: 12, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 12, requests: 1 }] };
    expect((await request('/v1/admin/devices/enroll', secret, 'POST', { deviceId, ownerUserIds: [ownerUserId] }, 'bad')).status).toBe(403);
    const registered = await request('/v1/admin/devices/enroll', secret, 'POST', { deviceId, ownerUserIds: [ownerUserId] }, adminSecret);
    expect(registered.status).toBe(200);
    const token = (JSON.parse(registered.body) as { token: string }).token;
    expect((await request('/v1/usage', secret, 'POST', body)).status).toBe(401);
    expect((await request('/v1/usage', token, 'POST', body)).status).toBe(200);
    const original = server.getDatabase().all('SELECT * FROM aggregates');
    expect((await request('/v1/usage', token, 'POST', { ...body, revision: 2,
      rows: [{ ...body.rows[0], ownerUserId: randomUUID(), totalTokens: 99 }] })).status).toBe(403);
    expect(server.getDatabase().all('SELECT * FROM aggregates')).toEqual(original);
  } finally {
    try { if (started) await server?.stop(); }
    finally { workspace.cleanup(); }
  }
});

test('TC-032 临时 CA 严格验证非回环服务与证书失败路径', async () => {
  const workspace = createTestWorkspace('tc032-trusted-tls');
  let server: LocalServer | null = null;
  let started = false;
  try {
    const tls = trustedTlsFixture(workspace.root);
    const directory = path.join(workspace.root, 'server');
    server = new LocalServer(directory, { key: tls.key, cert: tls.cert });
    const port = await server.start(0, '0.0.0.0');
    started = true;
    expect((await secureRequest(tls.address, port, tls.ca, '/health')).status).toBe(200);
    await expect(secureRequest(tls.address, port, undefined, '/health')).rejects.toMatchObject({
      code: expect.stringMatching(/CERT|VERIFY|SELF_SIGNED/)
    });
    await expect(secureRequest('127.0.0.1', port, tls.ca, '/health')).rejects.toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID'
    });

    const moduleFile = path.join(workspace.root, 'server-connection.cjs');
    const source = fs.readFileSync(path.join(process.cwd(), 'src/main/server-connection.ts'), 'utf8');
    fs.writeFileSync(moduleFile, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText);
    const secret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8').trim();
    const child = `const { ServerConnection } = require(process.argv[1]);
      const cipher = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value),
        decryptString: value => value.toString('utf8') };
      const client = new ServerConnection(process.argv[2], cipher);
      client.setConfiguration(process.argv[3], process.env.TOKEN_TEST_SECRET);
      client.status().then(status => {
        if (!status.online) throw new Error(status.error || '连接失败');
        process.stdout.write('trusted-connection-ok');
      }).catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });`;
    const result = await new Promise<string>((resolve, reject) => {
      execFile(process.execPath, ['-e', child, moduleFile, workspace.root,
        `https://${tls.address}:${port}`], { encoding: 'utf8', timeout: 10000,
        env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(workspace.root, 'ca.crt'),
          TOKEN_TEST_SECRET: secret } }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout);
      });
    });
    expect(result).toBe('trusted-connection-ok');
  } finally {
    try { if (started) await server?.stop(); }
    finally { workspace.cleanup(); }
  }
}, 15000);

test('TC-047 严格 TLS 下保护接口维持鉴权', async () => {
  const workspace = createTestWorkspace('tc047-trusted-tls');
  let server: LocalServer | null = null;
  let started = false;
  try {
    const tls = trustedTlsFixture(workspace.root);
    const directory = path.join(workspace.root, 'server');
    fixture(directory);
    server = new LocalServer(directory, { key: tls.key, cert: tls.cert });
    const port = await server.start(0, '0.0.0.0');
    started = true;
    const secret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8').trim();
    const adminSecret = fs.readFileSync(path.join(directory, 'server-admin.secret'), 'utf8').trim();
    const request = (endpoint: string, token?: string, method = 'GET', body?: unknown, adminToken?: string) =>
      secureRequest(tls.address, port, tls.ca, endpoint, token, method, body, adminToken);
    expect((await request('/v1/update/latest')).status).toBe(401);
    expect((await request('/v1/update/latest', 'bad')).status).toBe(401);
    expect((await request('/v1/update/package', 'bad')).status).toBe(401);
    expect((await request('/v1/update/latest', secret)).status).toBe(200);
    expect((await request('/v1/update/package', secret)).status).toBe(200);
    const deviceId = randomUUID();
    const ownerUserId = randomUUID();
    const snapshot: UsageSnapshot = { deviceId, revision: 1, providers: ['codex'], coverage: [
      { provider: 'codex', status: 'ready', lastScan: '2026-10-02T00:00:00Z' },
      { provider: 'claude', status: 'not_found', lastScan: null }
    ], rows: [{ ownerUserId, day: '2026-10-02', provider: 'codex', model: 'gpt-test',
      inputTokens: 12, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 12, requests: 1 }] };
    expect((await request('/v1/admin/devices/enroll', secret, 'POST',
      { deviceId, ownerUserIds: [ownerUserId] }, 'bad')).status).toBe(403);
    const enrolled = await request('/v1/admin/devices/enroll', secret, 'POST',
      { deviceId, ownerUserIds: [ownerUserId] }, adminSecret);
    expect(enrolled.status).toBe(200);
    const token = (JSON.parse(enrolled.body) as { token: string }).token;
    expect((await request('/v1/usage', secret, 'POST', snapshot)).status).toBe(401);
    expect((await request('/v1/usage', token, 'POST', snapshot)).status).toBe(200);
    const original = server.getDatabase().all('SELECT * FROM aggregates');
    expect((await request('/v1/usage', token, 'POST', { ...snapshot, revision: 2,
      rows: [{ ...snapshot.rows[0], ownerUserId: randomUUID() }] })).status).toBe(403);
    expect(server.getDatabase().all('SELECT * FROM aggregates')).toEqual(original);
  } finally {
    try { if (started) await server?.stop(); }
    finally { workspace.cleanup(); }
  }
});

export { fixture };
