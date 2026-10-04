import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';
import { ReportService } from '../src/main/report';
import { UsageSync } from '../src/main/usage-sync';
import { SourceBindingService } from '../src/main/source-binding';
import { LocalServer } from '../src/server/server';
import type { PublicUser, ReportQuery } from '../src/shared/types';
import type { ServerConnection } from '../src/main/server-connection';

async function fixture(label: string) {
  const workspace = createTestWorkspace(label);
  const db = await AppDatabase.open(workspace.databasePath);
  const scanner = new UsageScanner(db);
  const admin: PublicUser = { id: randomUUID(), username: 'admin', role: 'superadmin', active: true, createdAt: '' };
  const a: PublicUser = { id: randomUUID(), username: 'owner-a', role: 'viewer', active: true, createdAt: '' };
  const b: PublicUser = { id: randomUUID(), username: 'owner-b', role: 'viewer', active: true, createdAt: '' };
  for (const user of [admin, a, b]) db.run('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)',
    [user.id, user.username, 'unused', user.role === 'viewer' ? 'viewer' : 'admin', '2026-10-01T00:00:00Z']);
  const sourceKey = 'codex:private-source';
  db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [sourceKey, 'codex', 'synthetic-private-source', a.id]);
  db.run("INSERT INTO source_status(provider,status,file_count,fact_count,last_scan,detail) VALUES ('codex','ready',1,3,'2026-10-02T12:00:00Z',NULL)");
  const add = (key: string, session: string, day: string, tokens: number) =>
    db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [key, 'codex', sourceKey, session, 'gpt-test', `${day}T10:00:00Z`, tokens, 0, 0, 0, tokens]);
  add('local:confirmed', 'confirmed', '2026-10-02', 12);
  add('local:overlap', 'overlap', '2026-10-02', 9);
  add('otel:overlap', 'overlap', '2026-10-02', 11);
  add('local:outside', 'outside', '2026-09-01', 5);
  const reports = new ReportService(db, scanner);
  const filter: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC',
    granularity: 'day', provider: 'codex', model: '', projectKey: '', userId: 'all' };
  return { workspace, db, scanner, admin, a, b, sourceKey, reports, filter, add };
}

function localConnection(directory: string, getBase: () => string, scopes: string[][]): ServerConnection {
  const secret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8').trim();
  const adminSecret = fs.readFileSync(path.join(directory, 'server-admin.secret'), 'utf8').trim();
  return { getConnectionIdentity: () => getBase(), uploadUsage: async (payload: string, deviceId: string, ownerUserIds: string[]) => {
    scopes.push(ownerUserIds);
    const enrolled = await fetch(`${getBase()}/v1/admin/devices/enroll`, { method: 'POST', headers: {
      authorization: `Bearer ${secret}`, 'x-token-admin': adminSecret, 'content-type': 'application/json'
    }, body: JSON.stringify({ deviceId, ownerUserIds }) });
    if (!enrolled.ok) return enrolled;
    const token = (await enrolled.json() as { token: string }).token;
    return fetch(`${getBase()}/v1/usage`, { method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json'
    }, body: payload });
  } } as ServerConnection;
}

test('TC-086 预览双侧授权范围取消过期和在线确认清除旧归属', async () => {
  const f = await fixture('tc086-binding');
  const directory = path.join(f.workspace.root, 'server');
  const server = new LocalServer(directory);
  let started = false;
  try {
    let base = `http://127.0.0.1:${await server.start()}`; started = true;
    const scopes: string[][] = [];
    const sync = new UsageSync(f.db, f.scanner, localConnection(directory, () => base, scopes));
    const service = new SourceBindingService(f.db, f.scanner, f.reports, sync);
    await sync.afterScan();
    expect(server.getDatabase().one('SELECT owner_user_id FROM aggregate_status')?.owner_user_id).toBe(f.a.id);
    const preview = service.preview(f.sourceKey, f.b.id, f.filter, f.admin);
    expect(preview.affectedFactCount).toBe(4);
    expect(preview.before.oldOwner).toMatchObject({ observedFacts: 3, confirmedFacts: 1,
      confirmedTokens: 12, pendingFacts: 2, coverage: 'unknown' });
    expect(preview.after.oldOwner.observedFacts).toBe(0);
    expect(preview.after.newOwner).toMatchObject({ observedFacts: 3, confirmedFacts: 1,
      confirmedTokens: 12, pendingFacts: 2 });
    expect(f.db.one('SELECT owner_user_id FROM source_identities')?.owner_user_id).toBe(f.a.id);
    expect(f.db.all('SELECT * FROM source_binding_audit')).toHaveLength(0);
    await expect(service.confirm(preview.id, f.b)).rejects.toThrow('需要管理员权限');
    service.cancel(preview.id, f.admin);
    await expect(service.confirm(preview.id, f.admin)).rejects.toThrow('预览已过期');
    const scanning = vi.spyOn(f.scanner, 'scanProgress').mockReturnValue([{ provider: 'codex', progress: {
      phase: 'reading', processedFiles: 1, discoveredFiles: 3, lastProgressAt: new Date().toISOString()
    } }]);
    expect(() => service.preview(f.sourceKey, f.b.id, f.filter, f.admin)).toThrow('正在扫描');
    scanning.mockRestore();
    const stale = service.preview(f.sourceKey, f.b.id, f.filter, f.admin);
    f.add('local:new', 'new', '2026-10-02', 3);
    await expect(service.confirm(stale.id, f.admin)).rejects.toThrow('已变化');
    expect(f.db.one('SELECT owner_user_id FROM source_identities')?.owner_user_id).toBe(f.a.id);
    const refreshed = service.preview(f.sourceKey, f.b.id, f.filter, f.admin);
    const result = await service.confirm(refreshed.id, f.admin);
    expect(result).toMatchObject({ localCommitted: true, service: 'synced' });
    expect(f.reports.query({ ...f.filter, userId: f.a.id }, f.admin).coverage[0].factCount).toBe(0);
    expect(f.reports.query({ ...f.filter, userId: f.b.id }, f.admin).totals.totalTokens).toBe(15);
    expect(server.getDatabase().all('SELECT DISTINCT owner_user_id FROM aggregate_status')).toMatchObject([{ owner_user_id: f.b.id }]);
    expect(scopes.at(-1)).toEqual([f.b.id]);
    expect(f.db.all('SELECT actor_id, source_ref, old_owner_id, new_owner_id, affected_count, result_code FROM source_binding_audit'))
      .toMatchObject([{ actor_id: f.admin.id, old_owner_id: f.a.id, new_owner_id: f.b.id,
        affected_count: 5, result_code: 'success' }]);
    const audit = JSON.stringify(f.db.all('SELECT * FROM source_binding_audit'));
    expect(audit).not.toContain(f.sourceKey);
    expect(audit).not.toContain('synthetic-private-source');
    expect(audit).not.toContain('local:confirmed');
    expect(f.db.one('SELECT audit_ref FROM source_audit_refs')?.audit_ref).toMatch(/^[a-f0-9-]{36}$/);
    base = '';
  } finally { if (started) await server.stop(); f.db.close(); f.workspace.cleanup(); }
});

test('TC-087 停用旧归属仍可迁出事务故障回滚离线新快照覆盖旧队列', async () => {
  const f = await fixture('tc087-binding');
  const directory = path.join(f.workspace.root, 'server');
  let server = new LocalServer(directory);
  let started = false;
  try {
    f.db.run('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)', [randomUUID(), f.admin.id,
      'source.identity_bound', f.sourceKey, '2026-10-02T00:00:00Z']);
    new UsageScanner(f.db);
    expect(JSON.stringify(f.db.all("SELECT * FROM audit_events WHERE action='source.identity_bound'"))).not.toContain(f.sourceKey);
    let base = `http://127.0.0.1:${await server.start()}`; started = true;
    const scopes: string[][] = [];
    const sync = new UsageSync(f.db, f.scanner, localConnection(directory, () => base, scopes));
    const service = new SourceBindingService(f.db, f.scanner, f.reports, sync);
    await sync.afterScan();
    await expect(() => service.preview(f.sourceKey, 'missing', f.filter, f.admin)).toThrow('目标用户不存在');
    const stale = service.preview(f.sourceKey, f.b.id, f.filter, f.admin);
    f.db.run('UPDATE users SET active=0 WHERE id=?', [f.b.id]);
    await expect(service.confirm(stale.id, f.admin)).rejects.toThrow('目标用户不存在或已停用');
    f.db.run('UPDATE users SET active=1 WHERE id=?', [f.b.id]);
    const auditFailure = service.preview(f.sourceKey, f.b.id, f.filter, f.admin);
    const originalRun = f.db.run.bind(f.db);
    const spy = vi.spyOn(f.db, 'run').mockImplementation((sql, params) => {
      if (sql.startsWith('INSERT INTO source_binding_audit')) throw new Error('synthetic audit failure');
      return originalRun(sql, params);
    });
    await expect(service.confirm(auditFailure.id, f.admin)).rejects.toThrow('synthetic audit failure');
    spy.mockRestore();
    expect(f.db.one('SELECT owner_user_id FROM source_identities')?.owner_user_id).toBe(f.a.id);
    expect(f.db.all('SELECT * FROM source_binding_audit')).toHaveLength(0);
    expect(sync.status().pending).toBe(0);
    const writeFailure = service.preview(f.sourceKey, f.b.id, f.filter, f.admin);
    const originalRename = fs.renameSync.bind(fs);
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === f.workspace.databasePath) throw new Error('synthetic disk failure');
      return originalRename(from, to);
    });
    await expect(service.confirm(writeFailure.id, f.admin)).rejects.toThrow('synthetic disk failure');
    rename.mockRestore();
    expect(f.db.one('SELECT owner_user_id FROM source_identities')?.owner_user_id).toBe(f.a.id);
    expect(f.db.all('SELECT * FROM source_binding_audit')).toHaveLength(0);
    expect(sync.status().pending).toBe(0);
    await server.stop(); started = false;
    await sync.afterScan();
    expect(sync.status().pending).toBe(1);
    const oldPayload = JSON.parse(String(f.db.one('SELECT payload FROM sync_outbox')?.payload));
    expect(oldPayload.rows.some((row: { ownerUserId: string }) => row.ownerUserId === f.a.id)).toBe(true);
    // A disabled former owner must not prevent an administrator from repairing the assignment.
    f.db.run('UPDATE users SET active=0 WHERE id=?', [f.a.id]);
    const off = service.preview(f.sourceKey, f.b.id, f.filter, f.admin);
    expect(off.oldOwnerLabel).toContain('已停用');
    const result = await service.confirm(off.id, f.admin);
    expect(result).toMatchObject({ localCommitted: true, service: 'pending' });
    const queued = JSON.parse(String(f.db.one('SELECT payload FROM sync_outbox')?.payload));
    expect(queued.accountingVersion).toBe(2);
    expect(queued.rows.some((row: { ownerUserId: string }) => row.ownerUserId === f.b.id)).toBe(true);
    expect(queued.rows.some((row: { ownerUserId: string }) => row.ownerUserId === f.a.id)).toBe(false);
    expect(queued.revision).toBeGreaterThan(oldPayload.revision);
    server = new LocalServer(directory);
    base = `http://127.0.0.1:${await server.start()}`; started = true;
    await sync.retryNow();
    expect(sync.status().pending).toBe(0);
    expect(server.getDatabase().all('SELECT DISTINCT owner_user_id FROM aggregate_status')).toMatchObject([{ owner_user_id: f.b.id }]);
    expect(scopes.at(-1)).toEqual([f.b.id]);
  } finally { vi.restoreAllMocks(); if (started) await server.stop(); f.db.close(); f.workspace.cleanup(); }
});

test('TC-091 重绑确认后待传为零但连接身份已变化不得提示服务同步', async () => {
  const f = await fixture('tc091-binding-status');
  try {
    let identity = 'server-a';
    const connection = { getConnectionIdentity: () => identity,
      uploadUsage: async () => new Response('', { status: 200 }) } as unknown as ServerConnection;
    const sync = new UsageSync(f.db, f.scanner, connection);
    const originalFlush = sync.flush.bind(sync);
    vi.spyOn(sync, 'flush').mockImplementation(async () => {
      await originalFlush();
      identity = 'server-b';
    });
    const service = new SourceBindingService(f.db, f.scanner, f.reports, sync);
    const preview = service.preview(f.sourceKey, f.b.id, f.filter, f.admin);
    const result = await service.confirm(preview.id, f.admin);
    expect(sync.status()).toMatchObject({ pending: 0, currentConfirmed: false });
    expect(result).toMatchObject({ localCommitted: true, service: 'pending' });
    expect(f.db.one('SELECT owner_user_id FROM source_identities')?.owner_user_id).toBe(f.b.id);
  } finally { vi.restoreAllMocks(); f.db.close(); f.workspace.cleanup(); }
});

test('TC-086 Claude 文件归属证据经主进程校验，错误可在同一预览修正且审计仅记人工确认', async () => {
  const f = await fixture('tc086-claude-evidence');
  try {
    const key = `claude:local-file:${'a'.repeat(40)}`;
    f.db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [key, 'claude', 'Claude Code · 文件来源 aaaaaaaa', null]);
    f.db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['claude:synthetic-fact', 'claude', key, 'session', 'claude-test', '2026-10-02T10:00:00Z', 3, 0, 0, 0, 3]);
    const connection = { getConnectionIdentity: () => 'synthetic-server',
      uploadUsage: async () => new Response('', { status: 200 }) } as unknown as ServerConnection;
    const service = new SourceBindingService(f.db, f.scanner, f.reports, new UsageSync(f.db, f.scanner, connection));
    const filter = { ...f.filter, provider: 'claude' as const };
    const preview = service.preview(key, f.b.id, filter, f.admin);
    const valid = { evidenceCategory: 'controlled_account_file_mapping', evidenceSource: 'external_managed_registry',
      evidenceRef: `evr_${'a'.repeat(32)}`, evidenceReviewed: true };
    const invalid: Array<[unknown, string]> = [[undefined, 'evidenceCategory'],
      [{ ...valid, evidenceCategory: 'local_file' }, 'evidenceCategory'],
      [{ ...valid, evidenceSource: 'file_path' }, 'evidenceSource'],
      [{ ...valid, evidenceRef: '' }, 'evidenceRef'],
      [{ ...valid, evidenceRef: '/private/work/account-map.json' }, 'evidenceRef'],
      [{ ...valid, evidenceRef: `evr_${'a'.repeat(31)}` }, 'evidenceRef'],
      [{ ...valid, evidenceRef: `evr_${'a'.repeat(33)}` }, 'evidenceRef'],
      [{ ...valid, evidenceReviewed: false }, 'evidenceReviewed'],
      [{ ...valid, extra: 'unreviewed' }, 'evidenceCategory']];
    for (const [evidence, field] of invalid) {
      await expect(service.confirm(preview.id, f.admin, evidence)).rejects.toMatchObject({ field });
      expect(f.db.one('SELECT owner_user_id FROM source_identities WHERE key=?', [key])?.owner_user_id).toBeNull();
      expect(f.db.all('SELECT * FROM source_binding_audit')).toHaveLength(0);
      expect(f.db.all('SELECT * FROM sync_outbox')).toHaveLength(0);
    }
    const expired = service.preview(key, f.b.id, filter, f.admin);
    await expect(service.confirm(expired.id, f.admin, { ...valid, evidenceRef: '' })).rejects.toMatchObject({ field: 'evidenceRef' });
    const now = vi.spyOn(Date, 'now').mockReturnValue(new Date(expired.expiresAt).getTime() + 1);
    await expect(service.confirm(expired.id, f.admin, valid)).rejects.toThrow('预览已过期');
    now.mockRestore();
    const result = await service.confirm(preview.id, f.admin, valid);
    expect(result.localCommitted).toBe(true);
    expect(f.db.one('SELECT owner_user_id FROM source_identities WHERE key=?', [key])?.owner_user_id).toBe(f.b.id);
    const audit = f.db.one('SELECT * FROM source_binding_audit');
    expect(audit).toMatchObject({ evidence_category: valid.evidenceCategory, evidence_source: valid.evidenceSource,
      evidence_ref: valid.evidenceRef, verification_status: 'admin_manual_confirmed' });
    expect(JSON.stringify(audit)).not.toContain(key);
    await expect(service.confirm(preview.id, f.admin, valid)).rejects.toThrow('预览已过期');
  } finally { f.db.close(); f.workspace.cleanup(); }
});
