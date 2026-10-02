import { expect, test } from 'vitest';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';
import { ReportService } from '../src/main/report';
import { comparisonLabel, statusLabel } from '../src/renderer/overview';
import { formatPeriodLabel, formatTokens } from '../src/renderer/format';
import type { PublicUser, ReportQuery, SourceStatus } from '../src/shared/types';

const admin: PublicUser = { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '2026-01-01T00:00:00Z' };
const query: ReportQuery = { from: '2020-12-28', to: '2021-01-04', timeZone: 'UTC', granularity: 'day', provider: 'all', model: '', userId: 'all' };

async function reportFixture(name: string) {
  const workspace = createTestWorkspace(name);
  const db = await AppDatabase.open(workspace.databasePath);
  const scanner = new UsageScanner(db);
  db.run("INSERT INTO source_identities VALUES ('codex:local', 'codex', 'Codex', NULL)");
  const report = new ReportService(db, scanner);
  return { workspace, db, scanner, report };
}

function insert(db: AppDatabase, key: string, model: string, date: string, tokens: number) {
  db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [key, 'codex', 'codex:local', 'session', model, date, tokens, 0, 0, 0, tokens]);
}

test('TC-029 CSV 表头和数据列对齐', async () => {
  const { workspace, db, report } = await reportFixture('csv-columns');
  try {
    insert(db, 'csv', 'gpt-test', '2021-01-01T00:00:00Z', 12);
    const [header, row] = report.csv(query, admin).replace(/^\uFEFF/, '').trim().split('\r\n').map(line => line.split(','));
    expect(header).toHaveLength(9);
    expect(row).toHaveLength(9);
    expect(header[7]).toBe('总 Token');
    expect(row[7]).toBe('12');
    expect(row[8]).toBe('1');
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-041 K M P 1024 进位且原值保留在 CSV', async () => {
  expect(formatTokens(1023)).toBe('1,023');
  expect(formatTokens(1024)).toBe('1 K');
  expect(formatTokens(1024 ** 2)).toBe('1 M');
  expect(formatTokens(1024 ** 3)).toBe('1 P');
  expect(formatTokens(-1)).toBe('未知');
  const { workspace, db, report } = await reportFixture('unit-display');
  try {
    insert(db, 'large', 'gpt-test', '2021-01-01T00:00:00Z', 1024 ** 3);
    const csv = report.csv(query, admin);
    expect(csv).toContain(String(1024 ** 3));
    expect(csv).not.toContain('1 P');
    expect(csv.split('\r\n')[0].split(',')).toHaveLength(9);
    expect(csv.split('\r\n')[1].split(',')).toHaveLength(9);
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-042 概览等长区间比较与未知基期', async () => {
  const { workspace, db, report } = await reportFixture('unit-compare');
  try {
    insert(db, 'prior', 'gpt-test', '2020-12-30T00:00:00Z', 100);
    insert(db, 'current', 'gpt-test', '2021-01-03T00:00:00Z', 125);
    const prior = report.query({ ...query, from: '2020-12-28', to: '2020-12-31' }, admin);
    const current = report.query({ ...query, from: '2021-01-01', to: '2021-01-04' }, admin);
    expect(comparisonLabel(current.totals.totalTokens, prior.totals.totalTokens, true)).toBe('+25.0%');
    expect(comparisonLabel(125, null, true)).toBe('未知');
    expect(comparisonLabel(125, 0, true)).toBe('新增');
    expect(comparisonLabel(0, 0, true)).toBe('0%');
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-043 日周月趋势点击下钻保持同一时间桶', async () => {
  const { workspace, db, report } = await reportFixture('unit-drill');
  try {
    insert(db, 'a', 'gpt-test', '2020-12-31T00:00:00Z', 10);
    insert(db, 'b', 'gpt-test', '2021-01-01T00:00:00Z', 20);
    for (const granularity of ['day', 'week', 'month'] as const) {
      const result = report.query({ ...query, granularity }, admin);
      for (const point of result.points) {
        const details = report.details({ ...query, granularity }, 1, point.period, admin);
        expect(details.records.reduce((sum, row) => sum + row.totalTokens, 0)).toBe(point.totalTokens);
      }
    }
    expect(formatPeriodLabel('2020-W53', 'week')).toBe('2020-12-28');
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-044 模型排行总量降序且同值稳定', async () => {
  const { workspace, db, report } = await reportFixture('unit-ranking');
  try {
    insert(db, 'z', 'z-model', '2021-01-01T00:00:00Z', 30);
    insert(db, 'b', 'b-model', '2021-01-01T01:00:00Z', 50);
    insert(db, 'a', 'a-model', '2021-01-01T02:00:00Z', 50);
    expect(report.query(query, admin).models.map(row => row.model)).toEqual(['a-model', 'b-model', 'z-model']);
    expect(report.details({ ...query, model: 'a-model' }, 1, '', admin).records).toHaveLength(1);
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-045 已覆盖零与未覆盖错误状态分开显示', async () => {
  const { workspace, db, scanner, report } = await reportFixture('unit-coverage');
  try {
    db.run("INSERT INTO source_status VALUES ('codex', 'no_records', 0, 0, '2026-10-02T00:00:00Z', NULL)");
    db.run("INSERT INTO source_status VALUES ('claude', 'error', 0, 0, '2026-10-02T00:00:00Z', '无法读取')");
    const statuses = scanner.statuses();
    expect(statusLabel(statuses[0])).toContain('暂无记录');
    expect(statusLabel(statuses[1])).toBe('需要检查');
    expect(report.query(query, admin).totals.totalTokens).toBe(0);
    expect(comparisonLabel(0, 0, false)).toBe('未知');
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-046 来源状态和最近扫描时间一致', async () => {
  const { workspace, db, scanner } = await reportFixture('unit-source-state');
  try {
    db.run("INSERT INTO source_status VALUES ('codex', 'ready', 1, 2, '2026-10-02T00:00:00Z', NULL)");
    db.run("INSERT INTO source_status VALUES ('claude', 'not_found', 0, 0, '2026-10-02T01:00:00Z', '未找到本机会话目录')");
    const statuses = scanner.statuses();
    expect(statuses.find(row => row.provider === 'codex')).toMatchObject({ factCount: 2, lastScan: '2026-10-02T00:00:00Z' });
    expect(statusLabel(statuses.find(row => row.provider === 'claude') as SourceStatus)).toBe('未找到目录');
    expect(statuses.find(row => row.provider === 'claude')?.detail).toBe('未找到本机会话目录');
  } finally { db.close(); workspace.cleanup(); }
});
