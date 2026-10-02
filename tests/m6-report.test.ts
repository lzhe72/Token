import { expect, test } from 'vitest';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';
import { ReportService } from '../src/main/report';
import type { PublicUser, ReportQuery } from '../src/shared/types';

const admin: PublicUser = { id: 'a', username: 'admin', role: 'superadmin', active: true, createdAt: '' };
const viewer: PublicUser = { id: 'v', username: 'viewer', role: 'viewer', active: true, createdAt: '' };
const query: ReportQuery = { from: '2020-12-28', to: '2021-01-04', timeZone: 'UTC', granularity: 'week', provider: 'all', model: '', projectKey: '', userId: 'all' };

async function fixture(label: string, run: (db: AppDatabase, report: ReportService) => void) {
  const workspace = createTestWorkspace(label);
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    db.run("INSERT INTO source_identities VALUES ('s1', 'codex', 'Codex', 'v'), ('s2', 'claude', 'Claude', 'a')");
    db.run("INSERT INTO usage_facts VALUES ('f1', 'codex', 's1', 'one', 'gpt-test', '2020-12-31T23:30:00Z', 8, 2, 1, 0, 10)");
    db.run("INSERT INTO usage_facts VALUES ('f2', 'codex', 's1', 'two', 'gpt-test', '2021-01-01T00:30:00Z', 4, 1, 0, 0, 5)");
    db.run("INSERT INTO usage_facts VALUES ('f3', 'claude', 's2', 'three', 'claude-test', '2021-01-01T01:00:00Z', 2, 3, 5, 0, 10)");
    db.run("INSERT INTO fact_projects VALUES ('f1', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'Token · alpha')");
    db.run("INSERT INTO fact_projects VALUES ('f3', 'bbbbbbbbbbbbbbbbbbbbbbbb', '=SUM(1,2)')");
    run(db, new ReportService(db, scanner));
  } finally { db.close(); workspace.cleanup(); }
}

test('TC-053 项目模型聚合沿用授权范围和未知项目', async () => {
  await fixture('tc053', (_db, report) => {
    const result = report.query(query, admin);
    expect(result.totals.totalTokens).toBe(25);
    expect(result.projects.map(item => [item.label, item.totalTokens])).toEqual([
      ['=SUM(1,2)', 10], ['Token · alpha', 10], ['未识别项目', 5]
    ]);
    expect(result.models.map(item => item.totalTokens)).toEqual([15, 10]);
    expect(report.query(query, viewer).totals.totalTokens).toBe(15);
    expect(report.query({ ...query, projectKey: 'bbbbbbbbbbbbbbbbbbbbbbbb' }, viewer).totals.totalTokens).toBe(0);
    expect(report.query({ ...query, projectKey: 'unknown' }, viewer).totals.totalTokens).toBe(5);
    expect(report.query({ ...query, projectKey: 'aaaaaaaaaaaaaaaaaaaaaaaa', model: 'gpt-test' }, admin).totals.totalTokens).toBe(10);
    expect(() => report.query({ ...query, projectKey: '../../secret' }, admin)).toThrow('项目筛选无效');
  });
});

test('TC-055 项目筛选 CSV 与页面同口径且文本安全', async () => {
  await fixture('tc055', (_db, report) => {
    const selected = { ...query, projectKey: 'bbbbbbbbbbbbbbbbbbbbbbbb' };
    const result = report.query(selected, admin);
    const csv = report.csv(selected, admin);
    expect(result.totals.totalTokens).toBe(10);
    expect(csv).toContain('2020-W53');
    expect(csv).toContain("\"'=SUM(1,2)\"");
    expect(csv).toContain(',10,1');
    expect(csv).not.toContain('/work/');
    expect(report.details(selected, 1, '2020-W53', admin).records).toMatchObject([{ projectLabel: '=SUM(1,2)', totalTokens: 10 }]);
  });
});
