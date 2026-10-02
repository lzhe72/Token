import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from './support/test-workspace';
import { LocalServer, type UsageSnapshot } from '../src/server/server';
import { ServerConnection } from '../src/main/server-connection';

test('TC-074 聚合上报拒绝跨设备跨用户覆盖并保留原快照', async () => {
  const workspace = createTestWorkspace('tc074-ownership');
  const directory = path.join(workspace.root, 'server');
  const server = new LocalServer(directory);
  let started = false;
  try {
    const port = await server.start();
    started = true;
    const base = `http://127.0.0.1:${port}`;
    const globalToken = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8').trim();
    const adminToken = fs.readFileSync(path.join(directory, 'server-admin.secret'), 'utf8').trim();
    const deviceA = randomUUID();
    const deviceB = randomUUID();
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const coverage: UsageSnapshot['coverage'] = [
      { provider: 'codex', status: 'ready', lastScan: '2026-10-02T00:00:00Z' },
      { provider: 'claude', status: 'not_found', lastScan: null }
    ];
    const snapshot = (deviceId: string, revision: number, owners: Array<[string, number]>): UsageSnapshot => ({
      deviceId, revision, providers: ['codex'], coverage,
      rows: owners.map(([ownerUserId, totalTokens]) => ({ ownerUserId, day: '2026-10-02', provider: 'codex',
        model: 'gpt-test', inputTokens: totalTokens, outputTokens: 0, cacheReadTokens: 0,
        cacheCreationTokens: 0, totalTokens, requests: 1 }))
    });
    const enroll = async (deviceId: string, ownerUserIds: string[], managementKey = adminToken, reactivate = false) => fetch(`${base}/v1/admin/devices/enroll`, {
      method: 'POST', headers: { authorization: `Bearer ${globalToken}`, 'x-token-admin': managementKey,
        'content-type': 'application/json' }, body: JSON.stringify({ deviceId, ownerUserIds, reactivate })
    });
    const upload = (token: string, body: UsageSnapshot) => fetch(`${base}/v1/usage`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const state = () => ({
      aggregates: server.getDatabase().all('SELECT * FROM aggregates ORDER BY device_id, owner_user_id'),
      revisions: server.getDatabase().all('SELECT * FROM device_revisions ORDER BY device_id'),
      coverage: server.getDatabase().all('SELECT * FROM source_coverage ORDER BY device_id, provider')
    });

    expect((await enroll(deviceA, [ownerA], 'bad')).status).toBe(403);
    const registrationA = await enroll(deviceA, [ownerA]);
    expect(registrationA.ok).toBe(true);
    const tokenA = (await registrationA.json() as { token: string }).token;
    expect(tokenA).toMatch(/^[a-f0-9]{64}$/);
    expect((await upload(globalToken, snapshot(deviceA, 1, [[ownerA, 12]]))).status).toBe(401);
    expect(state()).toEqual({ aggregates: [], revisions: [], coverage: [] });

    expect((await upload(tokenA, snapshot(deviceA, 1, [[ownerA, 12]]))).status).toBe(200);
    const original = state();
    expect(original.aggregates).toMatchObject([{ device_id: deviceA, owner_user_id: ownerA, total_tokens: 12 }]);
    expect((await upload(tokenA, snapshot(deviceA, 2, [[ownerB, 99]]))).status).toBe(403);
    expect((await upload(tokenA, snapshot(deviceB, 2, [[ownerA, 99]]))).status).toBe(403);
    expect(state()).toEqual(original);

    const registrationB = await enroll(deviceB, [ownerB]);
    expect(registrationB.ok).toBe(true);
    const tokenB = (await registrationB.json() as { token: string }).token;
    expect((await upload(tokenB, snapshot(deviceA, 2, [[ownerA, 99]]))).status).toBe(403);
    expect(state()).toEqual(original);
    await expect((await upload(tokenA, snapshot(deviceA, 1, [[ownerA, 12]]))).json()).resolves.toMatchObject({ duplicate: true });
    expect((await upload(tokenA, snapshot(deviceA, 2, [[ownerA, 20]]))).status).toBe(200);
    expect(server.getDatabase().one('SELECT total_tokens FROM aggregates WHERE device_id = ?', [deviceA])?.total_tokens).toBe(20);

    const expanded = await enroll(deviceA, [ownerA, ownerB]);
    expect(expanded.ok).toBe(true);
    const rotatedToken = (await expanded.json() as { token: string }).token;
    expect(rotatedToken).not.toBe(tokenA);
    expect((await upload(tokenA, snapshot(deviceA, 3, [[ownerA, 20]]))).status).toBe(401);
    expect((await upload(rotatedToken, snapshot(deviceA, 3, [[ownerA, 20], [ownerB, 99]]))).status).toBe(200);
    expect(server.getDatabase().all('SELECT owner_user_id, total_tokens FROM aggregates WHERE device_id = ? ORDER BY owner_user_id', [deviceA]))
      .toHaveLength(2);
    const beforeRevoke = state();
    const revoked = await fetch(`${base}/v1/admin/devices/revoke`, { method: 'POST',
      headers: { authorization: `Bearer ${globalToken}`, 'x-token-admin': adminToken, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceA }) });
    expect(revoked.status).toBe(200);
    expect((await upload(rotatedToken, snapshot(deviceA, 4, [[ownerA, 50]]))).status).toBe(401);
    expect(state()).toEqual(beforeRevoke);
    expect((await enroll(deviceA, [ownerA, ownerB])).status).toBe(409);
    expect(state()).toEqual(beforeRevoke);
    expect((await enroll(deviceA, [ownerA, ownerB], adminToken, true)).status).toBe(200);
    expect(state()).toEqual(beforeRevoke);

    const legacyDevice = randomUUID();
    const legacyOwner = randomUUID();
    server.getDatabase().transaction(() => {
      server.getDatabase().run('INSERT INTO device_revisions VALUES (?, ?)', [legacyDevice, 5]);
      server.getDatabase().run('INSERT INTO aggregates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [legacyDevice, legacyOwner, '2026-10-02', 'codex', 'gpt-legacy', 7, 0, 0, 0, 7, 1]);
      server.getDatabase().run('INSERT INTO source_coverage VALUES (?, ?, ?, ?, ?)',
        [legacyDevice, 'codex', 'ready', '2026-10-02T00:00:00Z', 5]);
    });
    const legacyBefore = state();
    const legacyRegistration = await enroll(legacyDevice, [ownerA]);
    expect(legacyRegistration.ok).toBe(true);
    expect(state()).toEqual(legacyBefore);
    const legacyToken = (await legacyRegistration.json() as { token: string }).token;
    expect((await upload(legacyToken, snapshot(legacyDevice, 6, [[ownerA, 20]]))).status).toBe(200);
    expect(server.getDatabase().all('SELECT owner_user_id, total_tokens FROM aggregates WHERE device_id = ? ORDER BY owner_user_id', [legacyDevice]))
      .toMatchObject([{ owner_user_id: legacyOwner, total_tokens: 7 }, { owner_user_id: ownerA, total_tokens: 20 }]
        .sort((a, b) => a.owner_user_id.localeCompare(b.owner_user_id)));
  } finally {
    try { if (started) await server.stop(); }
    finally { workspace.cleanup(); }
  }
});

test('TC-074 客户端加密保存设备令牌且撤销后须显式重新登记', async () => {
  const workspace = createTestWorkspace('tc074-client');
  const directory = path.join(workspace.root, 'server');
  const server = new LocalServer(directory);
  let started = false;
  try {
    const port = await server.start();
    started = true;
    const base = `http://127.0.0.1:${port}`;
    const globalToken = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8').trim();
    const adminToken = fs.readFileSync(path.join(directory, 'server-admin.secret'), 'utf8').trim();
    const cipher = { isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')),
      decryptString: (value: Buffer) => value.toString('utf8').split('').reverse().join('') };
    const client = new ServerConnection(workspace.root, cipher);
    client.setConfiguration(base, globalToken, adminToken);
    const deviceId = randomUUID();
    const ownerUserId = randomUUID();
    const payload = (revision: number) => JSON.stringify({ deviceId, revision, providers: ['codex'],
      coverage: [{ provider: 'codex', status: 'ready', lastScan: '2026-10-02T00:00:00Z' },
        { provider: 'claude', status: 'not_found', lastScan: null }],
      rows: [{ ownerUserId, day: '2026-10-02', provider: 'codex', model: 'gpt-test',
        inputTokens: revision, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
        totalTokens: revision, requests: 1 }] });

    expect((await client.uploadUsage(payload(1), deviceId, [ownerUserId])).status).toBe(200);
    const credentialFile = path.join(workspace.root, 'server-usage-device.json');
    const stored = JSON.parse(fs.readFileSync(credentialFile, 'utf8')) as { token: string };
    const rawToken = cipher.decryptString(Buffer.from(stored.token, 'base64'));
    expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.readFileSync(credentialFile, 'utf8')).not.toContain(rawToken);
    expect(fs.statSync(credentialFile).mode & 0o777).toBe(0o600);
    const unavailableStorage = new ServerConnection(workspace.root, {
      ...cipher, isEncryptionAvailable: () => false
    });
    await expect(unavailableStorage.uploadUsage(payload(9), deviceId, [ownerUserId]))
      .rejects.toThrow('设备上报需要系统安全存储');
    const originalHash = server.getDatabase().one('SELECT token_hash FROM upload_devices WHERE device_id = ?', [deviceId])?.token_hash;
    expect((await client.uploadUsage(payload(2), deviceId, [ownerUserId])).status).toBe(200);
    expect(server.getDatabase().one('SELECT token_hash FROM upload_devices WHERE device_id = ?', [deviceId])?.token_hash).toBe(originalHash);

    const revoke = await fetch(`${base}/v1/admin/devices/revoke`, { method: 'POST',
      headers: { authorization: `Bearer ${globalToken}`, 'x-token-admin': adminToken, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId }) });
    expect(revoke.status).toBe(200);
    expect((await client.uploadUsage(payload(3), deviceId, [ownerUserId])).status).toBe(401);
    expect(Number(server.getDatabase().one('SELECT active FROM upload_devices WHERE device_id = ?', [deviceId])?.active)).toBe(0);
    expect(server.getDatabase().one('SELECT total_tokens FROM aggregates WHERE device_id = ?', [deviceId])?.total_tokens).toBe(2);
    await expect(client.uploadUsage(payload(3), deviceId, [ownerUserId, randomUUID()]))
      .rejects.toThrow('设备上报登记失败 (409)');
    expect(Number(server.getDatabase().one('SELECT active FROM upload_devices WHERE device_id = ?', [deviceId])?.active)).toBe(0);

    client.setConfiguration(base, '', '');
    expect(fs.existsSync(credentialFile)).toBe(false);
    expect((await client.uploadUsage(payload(3), deviceId, [ownerUserId])).status).toBe(200);
    expect(server.getDatabase().one('SELECT total_tokens FROM aggregates WHERE device_id = ?', [deviceId])?.total_tokens).toBe(3);

    client.setConfiguration('https://example.invalid:47839', '', '');
    expect(client.getToken()).toBeNull();
    expect(fs.existsSync(credentialFile)).toBe(false);
    await expect(client.uploadUsage(payload(4), deviceId, [ownerUserId])).rejects.toThrow('尚未配置服务管理密钥');
  } finally {
    try { if (started) await server.stop(); }
    finally { workspace.cleanup(); }
  }
});
