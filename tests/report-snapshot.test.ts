import { expect, test } from 'vitest';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';
import { ReportService } from '../src/main/report';
import type { PublicUser, ReportQuery } from '../src/shared/types';

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
  } finally { db.close(); workspace.cleanup(); }
});
