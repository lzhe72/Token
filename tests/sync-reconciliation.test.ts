import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';
import { UsageSync } from '../src/main/usage-sync';
import { LocalServer, type UsageSnapshotV1, type UsageSnapshotV2 } from '../src/server/server';
import type { ServerConnection } from '../src/main/server-connection';
import { createTestWorkspace } from './support/test-workspace';

test('TC-094 服务 v2 清除旧聚合并保留冲突状态旧队列重算和权限边界', async () => {
  const workspace = createTestWorkspace('tc094-sync');
  const db = await AppDatabase.open(workspace.databasePath);
  const directory = path.join(workspace.root, 'server');
  let server = new LocalServer(directory);
  let started = false;
  try {
    const scanner = new UsageScanner(db);
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const outsider = randomUUID();
    for (const [id, name] of [[ownerA, 'owner-a'], [ownerB, 'owner-b']]) {
      db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        [id, name, 'unused', 'viewer', '2026-10-02T00:00:00Z']);
    }
    for (const [key, owner] of [['codex:local', ownerA], ['codex:otel-a', ownerA], ['codex:otel-b', ownerB]]) {
      db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [key, 'codex', 'synthetic-private-source', owner]);
    }
    db.run("INSERT INTO source_status(provider, status, file_count, fact_count, last_scan, detail) VALUES ('codex', 'ready', 1, 1, '2026-10-02T12:00:00Z', NULL)");
    const add = (key: string, identity: string, session: string, tokens: number) =>
      db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [key, 'codex', identity, session, 'gpt-test', '2026-10-02T10:00:00Z', tokens, 0, 0, 0, tokens]);
    add('local:a', 'codex:local', 'session-a', 12);
    add('otel:b', 'codex:otel-b', 'session-b', 99);
    let port = await server.start();
    started = true;
    let base = `http://127.0.0.1:${port}`;
    const globalSecret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8').trim();
    const adminSecret = fs.readFileSync(path.join(directory, 'server-admin.secret'), 'utf8').trim();
    let token = '';
    const uploaded: string[] = [];
    const connection = { getConnectionIdentity: () => base, uploadUsage: async (payload: string, deviceId: string, ownerUserIds: string[]) => {
      uploaded.push(payload);
      const registration = await fetch(`${base}/v1/admin/devices/enroll`, { method: 'POST', headers: {
        authorization: `Bearer ${globalSecret}`, 'x-token-admin': adminSecret, 'content-type': 'application/json'
      }, body: JSON.stringify({ deviceId, ownerUserIds }) });
      if (!registration.ok) return registration;
      token = (await registration.json() as { token: string }).token;
      return fetch(`${base}/v1/usage`, { method: 'POST', headers: {
        authorization: `Bearer ${token}`, 'content-type': 'application/json'
      }, body: payload });
    } } as ServerConnection;
    const sync = new UsageSync(db, scanner, connection);
    const deviceId = String(db.one("SELECT value FROM sync_meta WHERE key='device_id'")?.value);
    const coverage: UsageSnapshotV1['coverage'] = [
      { provider: 'codex', status: 'ready', lastScan: '2026-10-02T12:00:00Z' },
      { provider: 'claude', status: 'idle', lastScan: null }
    ];
    const legacy: UsageSnapshotV1 = { deviceId, revision: 1, providers: ['codex'], coverage,
      rows: [{ ownerUserId: ownerA, provider: 'codex', day: '2026-10-02', model: 'gpt-test',
        inputTokens: 12, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 12, requests: 1 }] };
    expect((await connection.uploadUsage(JSON.stringify(legacy), deviceId, [ownerA, ownerB])).status).toBe(200);
    expect(server.getDatabase().one('SELECT total_status FROM aggregate_status')?.total_status).toBe('legacy_unknown');
    const legacyRead = await fetch(`${base}/v1/usage`, { headers: { authorization: `Bearer ${token}` } });
    expect((await legacyRead.json() as { rows: Array<{ confirmedSubtotal: unknown }> }).rows[0].confirmedSubtotal).toBeNull();
    await server.stop(); started = false;
    const legacyServerDb = await AppDatabase.open(path.join(directory, 'server.sqlite'));
    legacyServerDb.run('DROP TABLE aggregate_status');
    legacyServerDb.run('CREATE TABLE device_revisions_legacy (device_id TEXT PRIMARY KEY, revision INTEGER NOT NULL)');
    legacyServerDb.run('INSERT INTO device_revisions_legacy SELECT device_id, revision FROM device_revisions');
    legacyServerDb.run('DROP TABLE device_revisions');
    legacyServerDb.run('ALTER TABLE device_revisions_legacy RENAME TO device_revisions');
    legacyServerDb.close();
    server = new LocalServer(directory);
    port = await server.start(); started = true; base = `http://127.0.0.1:${port}`;
    expect(server.getDatabase().all('PRAGMA table_info(device_revisions)').some(row => row.name === 'accounting_version')).toBe(true);
    expect(server.getDatabase().one('SELECT total_status FROM aggregate_status')?.total_status).toBe('legacy_unknown');
    const oldRetry = await fetch(`${base}/v1/usage`, { method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json'
    }, body: JSON.stringify({ ...legacy, revision: 2 }) });
    expect(oldRetry.status).toBe(200);
    const oldRetryRead = await fetch(`${base}/v1/usage`, { headers: { authorization: `Bearer ${token}` } });
    expect((await oldRetryRead.json() as { rows: Array<{ totalStatus: string; confirmedSubtotal: unknown }> }).rows[0])
      .toMatchObject({ totalStatus: 'legacy_unknown', confirmedSubtotal: null });
    await sync.afterScan();
    expect(sync.status().pending).toBe(0);
    expect(JSON.parse(uploaded.at(-1)!).accountingVersion).toBe(2);
    expect(uploaded.at(-1)).not.toContain('session-a');
    expect(uploaded.at(-1)).not.toContain('synthetic-private-source');
    expect(server.getDatabase().all('SELECT owner_user_id, total_tokens FROM aggregates ORDER BY owner_user_id'))
      .toMatchObject([{ owner_user_id: ownerA, total_tokens: 12 }, { owner_user_id: ownerB, total_tokens: 99 }].sort((a, b) => a.owner_user_id.localeCompare(b.owner_user_id)));
    add('otel:a', 'codex:otel-a', 'session-a', 14);
    await sync.afterScan();
    expect(server.getDatabase().all('SELECT owner_user_id, total_tokens FROM aggregates')).toMatchObject([
      { owner_user_id: ownerB, total_tokens: 99 }
    ]);
    const statuses = server.getDatabase().all('SELECT owner_user_id, total_status, conflict_count FROM aggregate_status ORDER BY owner_user_id');
    expect(statuses.find(row => row.owner_user_id === ownerA)).toMatchObject({ total_status: 'uncertain', conflict_count: 2 });
    expect(statuses.find(row => row.owner_user_id === ownerB)).toMatchObject({ total_status: 'confirmed', conflict_count: 0 });
    const query = await fetch(`${base}/v1/usage`, { headers: { authorization: `Bearer ${token}` } });
    expect(query.status).toBe(200);
    const body = await query.json() as { rows: Array<{ ownerUserId: string; totalStatus: string; confirmedSubtotal: { totalTokens: number } }> };
    expect(body.rows.find(row => row.ownerUserId === ownerA)).toMatchObject({ totalStatus: 'uncertain', confirmedSubtotal: { totalTokens: 0 } });
    expect(JSON.stringify(body)).not.toContain('session-a');
    expect(JSON.stringify(body)).not.toContain('synthetic-private-source');
    const revision = Number(server.getDatabase().one('SELECT revision FROM device_revisions')?.revision);
    const forged: UsageSnapshotV2 = { accountingVersion: 2, deviceId, revision: revision + 1,
      providers: ['codex'], coverage, rows: [{ ownerUserId: outsider, day: '2026-10-02', provider: 'codex',
        model: 'gpt-test', confirmedSubtotal: { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0,
          cacheCreationTokens: 0, totalTokens: 1, requests: 1 }, totalStatus: 'confirmed',
        conflictCount: 0, conflictSources: [], totalTokens: 1 }] };
    const post = (value: unknown) => fetch(`${base}/v1/usage`, { method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json'
    }, body: JSON.stringify(value) });
    const savedState = () => ({
      aggregates: server.getDatabase().all('SELECT * FROM aggregates ORDER BY device_id, owner_user_id, day, provider, model'),
      statuses: server.getDatabase().all('SELECT * FROM aggregate_status ORDER BY device_id, owner_user_id, day, provider, model'),
      coverage: server.getDatabase().all('SELECT * FROM source_coverage ORDER BY device_id, provider'),
      revisions: server.getDatabase().all('SELECT * FROM device_revisions ORDER BY device_id')
    });
    const beforeReject = savedState();
    expect((await post(forged)).status).toBe(403);
    expect(savedState()).toEqual(beforeReject);
    expect((await post({ ...forged, rows: [{ ...forged.rows[0], ownerUserId: ownerA, sessionId: 'private' }] })).status).toBe(400);
    expect(savedState()).toEqual(beforeReject);
    expect((await post({ ...legacy, revision: revision + 1 })).status).toBe(409);
    expect(savedState()).toEqual(beforeReject);
    const sent: string[] = [];
    const incompatible = { getConnectionIdentity: () => 'old-service', uploadUsage: async (payload: string) => {
      sent.push(payload);
      return new Response(JSON.stringify({ error: 'old service' }), { status: 400 });
    } } as unknown as ServerConnection;
    db.run('INSERT INTO sync_outbox VALUES (1, ?, 0) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, attempts=0',
      [JSON.stringify({ ...legacy, revision: revision + 2 })]);
    const oldQueue = new UsageSync(db, scanner, incompatible);
    await oldQueue.flush();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]).accountingVersion).toBe(2);
    expect(oldQueue.status()).toMatchObject({ pending: 1 });
    expect(oldQueue.status().lastError).toContain('协议不兼容');
    expect(JSON.stringify(db.one('SELECT payload FROM sync_outbox'))).not.toContain('session-a');
    const recovered = new UsageSync(db, scanner, connection);
    await recovered.retryNow();
    expect(recovered.status().pending).toBe(0);
    expect(server.getDatabase().one('SELECT total_status FROM aggregate_status WHERE owner_user_id = ?', [ownerA])?.total_status).toBe('uncertain');
  } finally {
    if (started) await server.stop();
    db.close(); workspace.cleanup();
  }
});
