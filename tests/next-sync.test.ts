import { expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { UsageScanner, SCAN_INTERVAL_MS } from '../src/collectors/scanner';
import { UsageSync } from '../src/main/usage-sync';
import { LocalServer } from '../src/server/server';
import type { ServerConnection } from '../src/main/server-connection';

async function setup(name: string) {
  const workspace = createTestWorkspace(name);
  const db = await AppDatabase.open(workspace.databasePath);
  const scanner = new UsageScanner(db);
  const owner = randomUUID();
  db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)', [owner, 'owner', 'unused', 'admin', '2026-01-01T00:00:00Z']);
  db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', ['codex:local', 'codex', 'private-path-placeholder', owner]);
  db.run('INSERT INTO source_status(provider, status, file_count, fact_count, last_scan, detail) VALUES (?, ?, ?, ?, ?, ?)', ['codex', 'ready', 1, 1, '2026-10-02T00:00:00Z', null]);
  db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    'private-source-key', 'codex', 'codex:local', 'private-session', 'gpt-test', '2026-10-02T00:00:00Z', 10, 2, 3, 0, 12
  ]);
  return { workspace, db, scanner, owner };
}

function connection(base: string, secret: string): ServerConnection {
  return { request: (endpoint: string, init: RequestInit = {}) => fetch(`${base}${endpoint}`, {
    ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), authorization: `Bearer ${secret}` }
  }) } as unknown as ServerConnection;
}

test('TC-037 启动及十分钟定时扫描并串行执行', async () => {
  const { workspace, db, scanner } = await setup('scan-interval');
  vi.useFakeTimers();
  try {
    let calls = 0;
    vi.spyOn(scanner, 'scan').mockImplementation(async () => { calls++; });
    scanner.start();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS - 1);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await scanner.scan();
    expect(calls).toBe(3);
    scanner.stop();
    await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
    expect(calls).toBe(3);
  } finally { vi.useRealTimers(); db.close(); workspace.cleanup(); }
});

test('TC-038 聚合上报只含授权用量字段不含正文路径密钥', async () => {
  const { workspace, db, scanner } = await setup('sync-privacy');
  const directory = path.join(workspace.root, 'server');
  const server = new LocalServer(directory);
  try {
    const port = await server.start();
    const secret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8');
    const sync = new UsageSync(db, scanner, connection(`http://127.0.0.1:${port}`, secret));
    await sync.afterScan();
    const rows = server.getDatabase().all('SELECT * FROM aggregates');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner_user_id: db.one('SELECT id FROM users')?.id, total_tokens: 12, cache_read_tokens: 3 });
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain('private-source-key');
    expect(stored).not.toContain('private-session');
    expect(stored).not.toContain('private-path-placeholder');
    expect(sync.status().pending).toBe(0);
  } finally { await server.stop(); db.close(); workspace.cleanup(); }
});

test('TC-039 重复上报幂等且修订快照替换旧值', async () => {
  const { workspace, db, scanner } = await setup('sync-revision');
  const directory = path.join(workspace.root, 'server');
  const server = new LocalServer(directory);
  try {
    const port = await server.start();
    const secret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8');
    const sync = new UsageSync(db, scanner, connection(`http://127.0.0.1:${port}`, secret));
    await sync.afterScan();
    expect(Number(server.getDatabase().one('SELECT total_tokens FROM aggregates')?.total_tokens)).toBe(12);
    await sync.afterScan();
    expect(Number(server.getDatabase().one('SELECT COUNT(*) AS count FROM aggregates')?.count)).toBe(1);
    db.run("UPDATE usage_facts SET total_tokens = 20, output_tokens = 10 WHERE source_key = 'private-source-key'");
    await sync.afterScan();
    expect(Number(server.getDatabase().one('SELECT total_tokens FROM aggregates')?.total_tokens)).toBe(20);
    expect(Number(server.getDatabase().one('SELECT COUNT(*) AS count FROM aggregates')?.count)).toBe(1);
  } finally { await server.stop(); db.close(); workspace.cleanup(); }
});

test('TC-040 停服后待传快照持久化并恢复补传', async () => {
  const { workspace, db, scanner } = await setup('sync-offline');
  const directory = path.join(workspace.root, 'server');
  const server = new LocalServer(directory);
  try {
    const port = await server.start();
    const secret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8');
    const base = `http://127.0.0.1:${port}`;
    await server.stop();
    const offline = new UsageSync(db, scanner, connection(base, secret));
    await offline.afterScan();
    expect(offline.status().pending).toBe(1);
    expect(offline.status().lastError).toBeTruthy();
    db.close();
    const reopened = await AppDatabase.open(workspace.databasePath);
    const restarted = new LocalServer(directory);
    try {
      const newPort = await restarted.start();
      const recovered = new UsageSync(reopened, new UsageScanner(reopened), connection(`http://127.0.0.1:${newPort}`, secret));
      reopened.run("UPDATE sync_meta SET value = '2000-01-01T00:00:00Z' WHERE key = 'last_attempt'");
      await recovered.flush();
      expect(recovered.status().pending).toBe(0);
      expect(Number(restarted.getDatabase().one('SELECT total_tokens FROM aggregates')?.total_tokens)).toBe(12);
    } finally { await restarted.stop(); reopened.close(); }
  } finally { workspace.cleanup(); }
});
