import { expect, test } from 'vitest';
import { AppDatabase } from '../src/main/database';
import { ReportService } from '../src/main/report';
import { UsageScanner } from '../src/collectors/scanner';
import type { PublicUser, ReportQuery } from '../src/shared/types';
import { createTestWorkspace } from './support/test-workspace';

test('TC-077 管理员筛选覆盖不借用其他 owner 或全局 ready', async () => {
  const workspace = createTestWorkspace('tc077-coverage-scope');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    const report = new ReportService(db, scanner);
    const admin: PublicUser = { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '' };
    const viewer: PublicUser = { id: 'a', username: 'a', role: 'viewer', active: true, createdAt: '' };
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
      provider: 'codex', model: '', projectKey: '', userId: 'all' };
    for (const id of ['a', 'b']) db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, id, 'unused', 'viewer', 1, '2026-10-01T00:00:00Z']);
    for (const [key, owner] of [['local-a', 'a'], ['local-b', 'b'], ['local-none', null]]) {
      db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [key, 'codex', 'synthetic', owner]);
    }
    db.run("INSERT INTO usage_facts VALUES ('fact-a', 'codex', 'local-a', 'session-a', 'gpt-test', '2026-10-02T10:00:00Z', 12, 0, 0, 0, 12)");
    db.run("INSERT INTO usage_facts VALUES ('fact-none', 'codex', 'local-none', 'session-none', 'gpt-test', '2026-10-01T10:00:00Z', 7, 0, 0, 0, 7)");
    db.run("INSERT INTO source_status(provider,status,file_count,fact_count,last_scan,detail,diagnostic_json,last_success) VALUES ('codex','ready',3,2,'2026-10-03T00:00:00Z','global ready','{}','2026-10-03T00:00:00Z')");
    const scopedA = report.query({ ...query, userId: 'a' }, admin);
    expect(scopedA.coverage[0]).toMatchObject({ factCount: 1, telemetryFactCount: 0, lastScan: null,
      windowCoverage: { state: 'unknown', asOf: null, lastObserved: '2026-10-02T10:00:00Z' } });
    expect(scopedA.coverage[0].windowCoverage?.reason).toContain('尚无可证的连续采集子区间');
    for (const userId of ['b', 'unassigned']) {
      const result = report.query({ ...query, userId }, admin);
      expect(result.totals.totalTokens).toBe(0);
      expect(result.coverage[0]).toMatchObject({ factCount: 0, telemetryFactCount: 0, lastScan: null,
        windowCoverage: { state: 'unknown', asOf: null, lastObserved: null } });
      expect(result.coverage[0].detail).not.toContain('global ready');
      expect(result.coverage[0].detail).toContain('没有已观测记录');
    }
    expect(report.query(query, viewer).coverage).toMatchObject(scopedA.coverage);
    expect(report.query({ ...query, provider: 'claude' }, admin).coverage).toHaveLength(1);
    expect(report.query({ ...query, userId: 'a', model: 'other-model' }, admin).coverage[0].windowCoverage)
      .toMatchObject({ state: 'unknown', lastObserved: null });
    expect(report.query({ ...query, userId: 'a', projectKey: 'unknown' }, admin).coverage[0].windowCoverage)
      .toMatchObject({ state: 'unknown', lastObserved: '2026-10-02T10:00:00Z' });
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-078 时区边界和待核对窗口不伪造完整覆盖或同比', async () => {
  const workspace = createTestWorkspace('tc078-coverage-time');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const report = new ReportService(db, new UsageScanner(db));
    const admin: PublicUser = { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '' };
    db.run("INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES ('a', 'a', 'unused', 'viewer', 1, '2026-10-01T00:00:00Z')");
    db.run("INSERT INTO source_identities VALUES ('local-a', 'codex', 'synthetic', 'a')");
    db.run("INSERT INTO source_identities VALUES ('otel-a', 'codex', 'synthetic', 'a')");
    db.run("INSERT INTO usage_facts VALUES ('local:fact', 'codex', 'local-a', 'session-a', 'gpt-test', '2026-10-02T23:30:00Z', 12, 0, 0, 0, 12)");
    db.run("INSERT INTO usage_facts VALUES ('otel:fact', 'codex', 'otel-a', 'session-a', 'gpt-test', '2026-10-02T23:31:00Z', 14, 0, 0, 0, 14)");
    const query: ReportQuery = { from: '2026-10-03', to: '2026-10-03', timeZone: 'Asia/Shanghai',
      granularity: 'day', provider: 'codex', model: '', projectKey: '', userId: 'a' };
    const current = report.query(query, admin);
    const previous = report.query({ ...query, from: '2026-10-02', to: '2026-10-02' }, admin);
    expect(current.accounting).toMatchObject({ status: 'uncertain', confirmedSubtotal: { totalTokens: 0 }, conflictCount: 2 });
    expect(current.coverage[0].windowCoverage).toMatchObject({ state: 'unknown', asOf: null });
    expect(previous.totals.totalTokens).toBe(0);
    expect(previous.coverage[0].windowCoverage).toMatchObject({ state: 'unknown', asOf: null });
    const utc = report.query({ ...query, timeZone: 'UTC' }, admin);
    expect(utc.coverage[0].windowCoverage?.state).toBe('unknown');
  } finally { db.close(); workspace.cleanup(); }
});
