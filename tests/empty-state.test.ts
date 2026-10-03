import { expect, test } from 'vitest';
import type { CollectionDiagnostic, PublicUser, ReportQuery, UsageReport } from '../src/shared/types';
import { reportEmptyState } from '../src/renderer/empty-state';

const admin = { id: 'admin', role: 'superadmin' } as PublicUser;
const viewer = { id: 'viewer', role: 'viewer' } as PublicUser;
const query = { provider: 'codex', model: '', projectKey: '' } as ReportQuery;
const report = { coverage: [{ provider: 'codex', windowCoverage: { state: 'unknown' } }],
  accounting: { status: 'confirmed' } } as unknown as UsageReport;
const diagnostic = (reason: string, status: CollectionDiagnostic['status'] = 'error') =>
  ({ provider: 'codex', reason, status } as CollectionDiagnostic);

test('TC-084 未扫描权限格式筛选无匹配及已观测未知各给出独立行动且不造真零', () => {
  const unscanned = reportEmptyState(report, query, admin, [diagnostic('not_scanned', 'idle')]);
  expect(unscanned.message).toContain('尚未扫描');
  expect(unscanned.action).toBe('diagnostics');
  const denied = reportEmptyState(report, query, admin, [diagnostic('permission_denied')]);
  expect(denied.message).toContain('权限不足');
  expect(denied.action).toBe('permissions');
  const format = reportEmptyState(report, query, admin, [diagnostic('invalid_record')]);
  expect(format.message).toContain('格式无法识别');
  expect(format.action).toBe('diagnostics');
  const filtered = reportEmptyState(report, { ...query, model: 'missing' }, admin, [diagnostic('ok', 'ready')]);
  expect(filtered.message).toContain('筛选没有已观测记录');
  expect(filtered.action).toBe('clear-filters');
  expect(reportEmptyState(report, { ...query, model: 'missing' }, admin,
    [diagnostic('permission_denied')]).action).toBe('permissions');
  const observed = reportEmptyState(report, query, admin, [diagnostic('ok', 'ready')]);
  expect(observed.message).toContain('完整覆盖未知');
  expect(observed.message).not.toContain('已确认没有');
  const privateViewer = reportEmptyState(report, query, viewer, [diagnostic('permission_denied')]);
  expect(privateViewer.message).toContain('联系管理员');
  expect(privateViewer.message).not.toContain('权限不足');
  const privateFiltered = reportEmptyState(report, { ...query, model: 'missing' }, viewer,
    [diagnostic('permission_denied')]);
  expect(privateFiltered.action).toBe('clear-filters');
  expect(privateFiltered.message).not.toContain('权限不足');
});
