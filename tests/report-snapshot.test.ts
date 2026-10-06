import { expect, test, vi } from 'vitest';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';
import { ReportService } from '../src/main/report';
import type { PublicUser, ReportQuery } from '../src/shared/types';

test('TC-102 相同报表快照复用明细读取，事实变更后重新计算', async () => {
  const workspace = createTestWorkspace('tc102-snapshot-cache');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const reports = new ReportService(db, new UsageScanner(db));
    const admin: PublicUser = { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '' };
    const query: ReportQuery = { from: '2026-10-01', to: '2026-10-03', timeZone: 'Asia/Shanghai',
      granularity: 'day', provider: 'codex', model: '', projectKey: '', userId: 'all' };
    db.run("INSERT INTO source_identities VALUES ('codex:test', 'codex', '合成来源', NULL)");
    db.run("INSERT INTO usage_facts VALUES ('a', 'codex', 'codex:test', 'session-a', 'gpt-test', '2026-10-02T00:00:00Z', 12, 0, 0, 0, 12)");
    const reads = vi.spyOn(db, 'all');
    const factReadCount = () => reads.mock.calls.filter(([sql]) => String(sql).includes('LEFT JOIN fact_projects p')).length;
    const first = reports.query(query, admin);
    expect(reports.details(query, 1, '', admin, first.snapshotId).total).toBe(1);
    expect(reports.csv(query, admin, first.snapshotId)).toContain(',12,1');
    expect(factReadCount()).toBe(1);
    db.run("INSERT INTO usage_facts VALUES ('b', 'codex', 'codex:test', 'session-b', 'gpt-test', '2026-10-02T01:00:00Z', 3, 0, 0, 0, 3)");
    expect(reports.query(query, admin).totals.totalTokens).toBe(15);
    expect(factReadCount()).toBe(2);
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-079 查询后新增事实必须刷新快照才能导出相同事实集合', async () => {
  const workspace = createTestWorkspace('tc079-snapshot');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const reports = new ReportService(db, new UsageScanner(db));
    const admin: PublicUser = { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '' };
    const viewer: PublicUser = { id: 'viewer', username: 'viewer', role: 'viewer', active: true, createdAt: '' };
    const query: ReportQuery = { from: '2026-10-01', to: '2026-10-03', timeZone: 'Asia/Shanghai',
      granularity: 'day', provider: 'codex', model: '', projectKey: '', userId: 'all' };
    db.run("INSERT INTO source_identities VALUES ('codex:test', 'codex', '合成来源', 'viewer')");
    db.run("INSERT INTO usage_facts VALUES ('a', 'codex', 'codex:test', 'session-a', 'gpt-test', '2026-10-02T00:00:00Z', 12, 0, 0, 0, 12)");

    const first = reports.query(query, admin);
    expect(first.snapshotId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.totals.totalTokens).toBe(12);
    expect(reports.details(query, 1, '', admin, first.snapshotId).records).toHaveLength(1);
    const originalCsv = reports.csv(query, admin, first.snapshotId);
    expect(originalCsv.split('\r\n')[0]).toContain('时间,工具,项目,模型');
    expect(first.query).toMatchObject({ from: '2026-10-01', to: '2026-10-03', timeZone: 'Asia/Shanghai', provider: 'codex' });
    expect(originalCsv).toContain(',12,1');

    db.run("INSERT INTO usage_facts VALUES ('b', 'codex', 'codex:test', 'session-b', 'gpt-test', '2026-10-02T01:00:00Z', 99, 0, 0, 0, 99)");
    expect(() => reports.csv(query, admin, first.snapshotId)).toThrow('数据已变化');
    expect(() => reports.details(query, 1, '', admin, first.snapshotId)).toThrow('数据已变化');
    const refreshed = reports.query(query, admin);
    expect(refreshed.snapshotId).not.toBe(first.snapshotId);
    expect(refreshed.totals.totalTokens).toBe(111);
    expect(reports.csv(query, admin, refreshed.snapshotId)).toContain(',111,2');
    expect(() => reports.csv({ ...query, provider: 'claude' }, admin, refreshed.snapshotId)).toThrow('数据已变化');
    expect(() => reports.csv(query, viewer, refreshed.snapshotId)).toThrow('数据已变化');
    db.run("INSERT INTO source_identities VALUES ('codex:otel', 'codex', '合成遥测', 'viewer')");
    db.run("INSERT INTO usage_facts VALUES ('otel:overlap', 'codex', 'codex:otel', 'session-a', 'gpt-test', '2026-10-02T00:01:00Z', 14, 0, 0, 0, 14)");
    expect(() => reports.csv(query, admin, refreshed.snapshotId)).toThrow('数据已变化');
    const conflicted = reports.query(query, admin);
    expect(conflicted.accounting).toMatchObject({ status: 'uncertain', confirmedSubtotal: { totalTokens: 99 } });
    expect(reports.csv(query, admin, conflicted.snapshotId).split('\r\n')[0].split(',')).toHaveLength(14);
    db.run("INSERT INTO usage_facts VALUES ('otel:other', 'codex', 'codex:otel', 'session-c', 'gpt-test', '2026-10-02T02:00:00Z', 5, 0, 0, 0, 5)");
    expect(() => reports.csv(query, admin, conflicted.snapshotId)).toThrow('数据已变化');
    const final = reports.query(query, admin);
    expect(final.accounting.confirmedSubtotal.totalTokens).toBe(104);
    expect(reports.csv(query, admin, final.snapshotId)).toContain('uncertain,104,');
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-023 CSV v2 待核对行的模型和项目名称仍转义公式', async () => {
  const workspace = createTestWorkspace('tc023-v2-formula');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const reports = new ReportService(db, new UsageScanner(db));
    const actor: PublicUser = { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '' };
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC',
      granularity: 'day', provider: 'codex', model: '', projectKey: '', userId: 'all' };
    db.run("INSERT INTO source_identities VALUES ('local', 'codex', '合成来源', NULL)");
    db.run("INSERT INTO source_identities VALUES ('otel', 'codex', '合成遥测', NULL)");
    db.run("INSERT INTO usage_facts VALUES ('local:one', 'codex', 'local', 'session-a', '=SUM(1,2)', '2026-10-02T10:00:00Z', 1, 0, 0, 0, 1)");
    db.run("INSERT INTO usage_facts VALUES ('otel:one', 'codex', 'otel', 'session-a', '=SUM(1,2)', '2026-10-02T10:01:00Z', 2, 0, 0, 0, 2)");
    db.run("INSERT INTO fact_projects VALUES ('local:one', 'aaaaaaaaaaaaaaaaaaaaaaaa', '+unsafe-project')");
    db.run("INSERT INTO fact_projects VALUES ('otel:one', 'aaaaaaaaaaaaaaaaaaaaaaaa', '+unsafe-project')");
    const result = reports.query(query, actor);
    expect(result.accounting.status).toBe('uncertain');
    const csv = reports.csv(query, actor, result.snapshotId);
    expect(csv.split('\r\n')[0].split(',')).toHaveLength(14);
    expect(csv).toContain('"\'+unsafe-project"');
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).not.toContain('"+unsafe-project"');
    expect(csv).not.toContain('"=SUM(1,2)"');
  } finally { db.close(); workspace.cleanup(); }
});
