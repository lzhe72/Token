import { expect, test } from 'vitest';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';
import { ReportService } from '../src/main/report';
import type { PublicUser, ReportQuery } from '../src/shared/types';

test('报表按本地时区与 ISO 周汇总，并限制普通用户归属', async () => {
  const workspace = createTestWorkspace('report');
  try {
    const db = await AppDatabase.open(workspace.databasePath);
    const scanner = new UsageScanner(db);
    const report = new ReportService(db, scanner);
    const admin: PublicUser = { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '2020-01-01T00:00:00Z' };
    const viewer: PublicUser = { id: 'viewer', username: 'viewer', role: 'viewer', active: true, createdAt: '2020-01-01T00:00:00Z' };
    db.run("INSERT INTO users VALUES ('viewer', 'viewer', 'unused', 'viewer', 1, '2020-01-01T00:00:00Z')");
    db.run("INSERT INTO source_identities VALUES ('codex:local', 'codex', 'Codex', NULL)");
    db.run("INSERT INTO source_identities VALUES ('claude:local', 'claude', 'Claude', NULL)");
    db.run("INSERT INTO usage_facts VALUES ('c1', 'codex', 'codex:local', 's1', '=2+2', '2020-12-31T16:30:00Z', 10, 2, 4, 0, 12)");
    db.run("INSERT INTO usage_facts VALUES ('a1', 'claude', 'claude:local', 's2', 'claude-test', '2021-01-01T03:00:00Z', 1, 3, 8, 2, 14)");
    const query: ReportQuery = { from: '2021-01-01', to: '2021-01-01', timeZone: 'Asia/Shanghai', granularity: 'week', provider: 'all', model: '', userId: 'all' };
    const adminResult = report.query(query, admin);
    expect(adminResult.totals.totalTokens).toBe(26);
    expect(adminResult.points).toMatchObject([{ period: '2020-W53', totalTokens: 26 }]);
    expect(adminResult.models).toHaveLength(2);
    const detail = report.details(query, 1, '2020-W53', admin);
    expect(detail.total).toBe(2);
    expect(detail.records.reduce((sum, item) => sum + item.totalTokens, 0)).toBe(26);
    expect(report.query({ ...query, granularity: 'day' }, admin).points[0].period).toBe('2021-01-01');
    expect(report.query({ ...query, granularity: 'month' }, admin).points[0].period).toBe('2021-01');
    expect(report.query({ ...query, granularity: 'year' }, admin).points[0].period).toBe('2021');
    expect(report.query({ ...query, provider: 'codex' }, admin).totals.totalTokens).toBe(12);
    const csv = report.csv(query, admin);
    expect(csv).toContain("\"'=2+2\"");
    expect(csv).not.toContain("\"=2+2\"");
    expect(report.query(query, viewer).totals.totalTokens).toBe(0);
    expect(report.details(query, 1, '', viewer).total).toBe(0);
    scanner.bindIdentity('codex:local', 'viewer', 'admin');
    expect(report.query(query, viewer).totals.totalTokens).toBe(12);
    expect(report.details(query, 1, '', viewer).records).toMatchObject([{ provider: 'codex', totalTokens: 12 }]);
    expect(report.details({ ...query, model: 'claude-test' }, 1, '', viewer).total).toBe(0);
    expect(report.query({ ...query, userId: 'unassigned' }, admin).totals.totalTokens).toBe(14);
    expect(() => report.query({ ...query, from: '2021-02-30' }, admin)).toThrow('日期范围无效');
    expect(() => report.details(query, 0, '', admin)).toThrow('页码无效');
    db.close();
  } finally {
    workspace.cleanup();
  }
});
