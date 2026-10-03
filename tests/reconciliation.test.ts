import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { AppDatabase } from '../src/main/database';
import { ReportService } from '../src/main/report';
import { UsageScanner } from '../src/collectors/scanner';
import type { PublicUser, ReportQuery } from '../src/shared/types';
import { createTestWorkspace } from './support/test-workspace';

test('TC-092 跨用户和不同会话遥测独立保留且同会话冲突不伪造总量', async () => {
  const workspace = createTestWorkspace('tc092-reconcile');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    const idA = randomUUID();
    const idB = randomUUID();
    const actor = (id: string, role: PublicUser['role']): PublicUser =>
      ({ id, username: id === idA ? 'owner-a' : 'owner-b', role, active: true, createdAt: '' });
    for (const [id, name] of [[idA, 'owner-a'], [idB, 'owner-b']]) {
      db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        [id, name, 'unused', 'viewer', '2026-10-02T00:00:00Z']);
    }
    const identities: Array<[string, string]> = [
      ['codex:local-a', idA], ['codex:otel-a', idA], ['codex:otel-b', idB]
    ];
    for (const [key, owner] of identities) db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [key, 'codex', 'synthetic', owner]);
    const add = (key: string, identity: string, session: string, tokens: number) => db.run(
      'INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [key, 'codex', identity, session, 'gpt-test', '2026-10-02T10:00:00Z', tokens, 0, 0, 0, tokens]);
    add('local-a', 'codex:local-a', 'session-a', 12);
    add('otel:b', 'codex:otel-b', 'session-b', 99);
    const report = new ReportService(db, scanner);
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
      provider: 'codex', model: '', projectKey: '', userId: 'all' };
    expect(report.query(query, actor(idA, 'admin')).totals.totalTokens).toBe(111);
    expect(report.query(query, actor(idB, 'viewer')).totals.totalTokens).toBe(99);
    add('otel:a-distinct', 'codex:otel-a', 'session-other', 7);
    expect(report.query(query, actor(idA, 'viewer')).totals.totalTokens).toBe(19);
    add('otel:a-same', 'codex:otel-a', 'session-a', 14);
    const affected = report.query(query, actor(idA, 'viewer'));
    expect(affected.accounting.status).toBe('uncertain');
    expect(affected.accounting.confirmedSubtotal.totalTokens).toBe(7);
    expect(affected.accounting.conflictCount).toBe(2);
    expect(affected.accounting.conflictSources).toEqual(['local', 'telemetry']);
    add('otel:a-unknown', 'codex:otel-a', 'unknown', 5);
    expect(report.query(query, actor(idA, 'viewer')).accounting).toMatchObject({
      status: 'uncertain', conflictCount: 3, confirmedSubtotal: { totalTokens: 7 }
    });
    expect(report.query(query, actor(idB, 'viewer')).accounting.status).toBe('confirmed');
    expect(report.query(query, actor(idB, 'viewer')).totals.totalTokens).toBe(99);
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-093 报表明细和 CSV v2 同源逐组小计且时区边界不漏冲突', async () => {
  const workspace = createTestWorkspace('tc093-report');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const viewer: PublicUser = { id: ownerA, username: 'viewer-a', role: 'viewer', active: true, createdAt: '' };
    for (const [identity, owner] of [['codex:local', ownerA], ['codex:otel-a', ownerA], ['codex:otel-b', ownerB]]) {
      db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [identity, 'codex', 'synthetic', owner]);
    }
    const add = (key: string, identity: string, session: string, model: string, time: string, tokens: number) =>
      db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [key, 'codex', identity, session, model, time, tokens, 0, 0, 0, tokens]);
    add('local:a', 'codex:local', 'a', 'gpt-a', '2026-10-02T10:00:00Z', 12);
    add('otel:a', 'codex:otel-a', 'a', 'gpt-a', '2026-10-02T10:01:00Z', 14);
    add('local:a-confirmed', 'codex:local', 'independent-a', 'gpt-a', '2026-10-02T10:02:00Z', 5);
    add('local:b', 'codex:local', 'b', 'gpt-b', '2026-10-02T11:00:00Z', 3);
    add('otel:b', 'codex:otel-a', 'b', 'gpt-b', '2026-10-02T11:01:00Z', 4);
    add('local:b-confirmed', 'codex:local', 'independent-b', 'gpt-b', '2026-10-02T11:02:00Z', 7);
    add('local:boundary', 'codex:local', 'boundary', 'gpt-c', '2026-10-01T23:59:00Z', 9);
    add('otel:boundary', 'codex:otel-a', 'boundary', 'gpt-c', '2026-10-02T00:01:00Z', 10);
    add('otel:other-owner', 'codex:otel-b', 'other', 'gpt-a', '2026-10-02T12:00:00Z', 99);
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
      provider: 'codex', model: '', projectKey: '', userId: 'all' };
    const service = new ReportService(db, scanner);
    const summary = service.query(query, viewer);
    expect(summary.coverage.find(item => item.provider === 'codex')).toMatchObject({ fileCount: null,
      factCount: 4, telemetryFactCount: 3, lastScan: null, lastTelemetry: '2026-10-02T11:01:00Z',
      windowCoverage: { state: 'unknown', asOf: null } });
    expect(summary.coverage.find(item => item.provider === 'claude')).toBeUndefined();
    expect(summary.accounting).toMatchObject({ status: 'uncertain', conflictCount: 5,
      confirmedSubtotal: { totalTokens: 12 } });
    const details = service.details(query, 1, '', viewer, summary.snapshotId);
    expect(details.total).toBe(7);
    expect(details.records.filter(row => row.accountingStatus === 'pending')).toHaveLength(5);
    expect(details.records.every(row => row.totalTokens !== 99)).toBe(true);
    const csv = service.csv(query, viewer, summary.snapshotId).replace(/^\uFEFF/, '');
    const [header, ...body] = csv.trim().split('\r\n').map(line => line.split(','));
    expect(header).toHaveLength(14);
    expect(header.slice(10)).toEqual(['计量状态', '已确认小计 Token', '待核对来源', '待核对条数']);
    expect(body).toHaveLength(3);
    expect(body.every(row => row.length === 14 && row[10] === 'uncertain' && row.slice(4, 10).every(cell => cell === ''))).toBe(true);
    const byModel = new Map(body.map(row => [row[3].replaceAll('"', ''), row]));
    expect(byModel.get('gpt-a')?.[11]).toBe('5');
    expect(byModel.get('gpt-b')?.[11]).toBe('7');
    expect(byModel.get('gpt-c')?.[11]).toBe('0');
    expect(body.reduce((sum, row) => sum + Number(row[11]), 0)).toBe(12);
    expect(body.every(row => row[8] !== '99' && row[11] !== '99')).toBe(true);
    expect(csv).not.toContain(ownerB);
    expect(csv).not.toContain('boundary');
    const afterBoundary = service.query({ ...query, from: '2026-10-01' }, viewer);
    expect(afterBoundary.accounting.status).toBe('uncertain');
    expect(afterBoundary.accounting.confirmedSubtotal.totalTokens).toBe(12);
    add('local:far', 'codex:local', 'far-session', 'gpt-d', '2026-10-01T12:00:00Z', 9);
    add('otel:far', 'codex:otel-a', 'far-session', 'gpt-d', '2026-10-05T12:00:00Z', 10);
    const narrow = service.query({ ...query, from: '2026-10-01', to: '2026-10-01', model: 'gpt-d' }, viewer);
    expect(narrow.accounting).toMatchObject({ status: 'uncertain', conflictCount: 1,
      confirmedSubtotal: { totalTokens: 0 } });
    expect(service.csv({ ...query, from: '2026-10-01', to: '2026-10-01', model: 'gpt-d' }, viewer, narrow.snapshotId))
      .toContain('uncertain,0');
    add('local:unknown-edge', 'codex:local', 'known-edge', 'gpt-e', '2026-10-01T23:59:00Z', 1);
    add('otel:unknown-edge', 'codex:otel-a', 'unknown', 'gpt-e', '2026-10-02T00:01:00Z', 2);
    expect(service.query({ ...query, from: '2026-10-01', to: '2026-10-01', model: 'gpt-e' }, viewer).accounting)
      .toMatchObject({ status: 'uncertain', conflictCount: 1 });
  } finally { db.close(); workspace.cleanup(); }
});
