import { expect, test } from 'vitest';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';
import { ReportService } from '../src/main/report';
import type { PublicUser, ReportQuery } from '../src/shared/types';

test('TC-021 明细翻页不漏记录且筛选和用户权限贯穿每页', async () => {
  const workspace = createTestWorkspace('tc021-pagination');
  let db: AppDatabase | null = null;
  try {
    const database = await AppDatabase.open(workspace.databasePath);
    db = database;
    const report = new ReportService(database, new UsageScanner(database));
    const admin: PublicUser = { id: 'admin-id', username: 'admin', role: 'admin', active: true, createdAt: '' };
    const viewer: PublicUser = { id: 'viewer-id', username: 'viewer', role: 'viewer', active: true, createdAt: '' };
    const projectKey = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    database.transaction(() => {
      database.run("INSERT INTO source_identities VALUES ('codex:viewer', 'codex', 'Codex', 'viewer-id')");
      database.run("INSERT INTO source_identities VALUES ('claude:admin', 'claude', 'Claude', 'admin-id')");
      for (let index = 0; index < 123; index++) {
        const ownedByViewer = index < 61;
        const sourceKey = `tc021-fact-${String(index).padStart(3, '0')}`;
        const occurredAt = new Date(Date.parse('2026-10-02T00:00:00Z') + index * 1000).toISOString();
        database.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          sourceKey, ownedByViewer ? 'codex' : 'claude', ownedByViewer ? 'codex:viewer' : 'claude:admin',
          `session-${index}`, ownedByViewer ? 'gpt-test' : 'claude-test', occurredAt, 1, 0, 0, 0, 1
        ]);
        if (ownedByViewer) database.run('INSERT INTO fact_projects VALUES (?, ?, ?)', [sourceKey, projectKey, 'Token']);
      }
    });

    const query: ReportQuery = {
      from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
      provider: 'all', model: '', projectKey: '', userId: 'all'
    };
    const pages = [1, 2, 3].map(page => report.details(query, page, '', admin));
    expect(pages.map(page => page.records.length)).toEqual([50, 50, 23]);
    expect(pages.every(page => page.total === 123 && page.pageSize === 50)).toBe(true);
    expect(new Set(pages.flatMap(page => page.records.map(record => record.id))).size).toBe(123);
    expect(pages.flatMap(page => page.records).reduce((sum, record) => sum + record.totalTokens, 0))
      .toBe(report.query(query, admin).totals.totalTokens);
    expect(report.details(query, 4, '', admin).records).toEqual([]);

    const viewerPages = [1, 2].map(page => report.details(query, page, '2026-10-02', viewer));
    expect(viewerPages.map(page => page.records.length)).toEqual([50, 11]);
    expect(viewerPages.every(page => page.total === 61 && page.records.every(record =>
      record.provider === 'codex' && record.projectKey === projectKey))).toBe(true);
    expect(report.details({ ...query, userId: 'admin-id' }, 2, '', viewer).total).toBe(61);
    expect(report.details({ ...query, provider: 'claude', model: 'claude-test' }, 2, '', viewer).total).toBe(0);
    expect(report.details({ ...query, provider: 'codex', model: 'gpt-test', projectKey }, 2, '2026-10-02', admin)
      .records).toHaveLength(11);
  } finally {
    try { db?.close(); }
    finally { workspace.cleanup(); }
  }
});
