import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createViewer, launchM6, loginViewer } from './m6-support';

test('TC-093 普通用户来源状态诊断和反馈附件不含其他账户数据', async () => {
  const context = await launchM6('tc093-ipc-privacy', { sameModel: true, usageDate: new Date().toISOString() });
  try {
    const { page } = context;
    await createViewer(page);
    await page.getByPlaceholder('3–32 位').fill('viewerB');
    await page.getByPlaceholder('至少 10 位').fill('viewer-b-password-123');
    await page.getByRole('button', { name: '创建用户' }).click();
    const telemetry = await page.evaluate(() => window.tokenApi.getTelemetryConfiguration());
    expect(telemetry.running).toBe(true);
    const endpoint = telemetry.codex.match(/endpoint = "([^"]+)"/)?.[1];
    const secret = telemetry.codex.match(/Bearer ([a-f0-9]+)/)?.[1];
    expect(endpoint && secret).toBeTruthy();
    const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
    const otherOwnerTime = new Date().toISOString();
    const otel = { resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: String(BigInt(Date.parse(otherOwnerTime)) * 1_000_000n), attributes: [
        attr('event.name', 'codex.sse_event'), attr('event.kind', 'response.completed'),
        attr('input_token_count', '99'), attr('output_token_count', '0'),
        attr('conversation.id', 'other-owner-session'), attr('model', 'shared-model'),
        attr('user.account_id', 'synthetic-owner-b')
      ]
    }] }] }] };
    expect((await fetch(endpoint!, { method: 'POST', headers: { authorization: `Bearer ${secret}`,
      'content-type': 'application/json' }, body: JSON.stringify(otel) })).status).toBe(200);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await page.getByRole('row', { name: /Codex · 本机账户/ }).getByRole('combobox').selectOption({ label: 'viewer' });
    await page.getByRole('row', { name: /Codex 遥测来源/ }).getByRole('combobox').selectOption({ label: 'viewerB' });
    const global = await page.evaluate(() => window.tokenApi.getSourceStatuses());
    expect(global.find(item => item.provider === 'codex')).toMatchObject({ factCount: 1,
      telemetryFactCount: 1, lastTelemetry: otherOwnerTime });
    await loginViewer(page);
    const scoped = await page.evaluate(async () => ({
      statuses: await window.tokenApi.getSourceStatuses(),
      diagnostics: await window.tokenApi.getCollectionDiagnostics()
    }));
    expect(scoped.statuses.find(item => item.provider === 'codex')).toMatchObject({ factCount: 1,
      telemetryFactCount: 0, fileCount: null, lastScan: null, lastTelemetry: null });
    expect(scoped.statuses.find(item => item.provider === 'claude')).toMatchObject({ factCount: null,
      telemetryFactCount: null, fileCount: null, lastTelemetry: null, lastScan: null });
    expect(scoped.diagnostics.find(item => item.provider === 'claude')).toMatchObject({
      fileCount: null, factCount: null, lastSuccess: null, lastScan: null, malformedCount: null });
    expect(scoped.diagnostics.find(item => item.provider === 'codex')).toMatchObject({
      fileCount: null, factCount: 1, lastSuccess: null, lastScan: null, malformedCount: null });
    expect(await page.evaluate(() => window.tokenApi.scanSources().then(() => 'allowed', () => 'denied')))
      .toBe('denied');
    await page.getByRole('button', { name: '概览' }).click();
    const sourceCard = page.locator('.source-card').filter({ hasText: 'Codex' });
    await expect(sourceCard).toContainText('1 条已归属记录');
    await expect(sourceCard).not.toContainText('2 条已归属记录');
    await expect(sourceCard).not.toContainText(otherOwnerTime);
    await page.getByRole('button', { name: /采集诊断/ }).click();
    await expect(page.locator('.diagnostic-card').filter({ hasText: 'Claude Code' })).toContainText('覆盖未知');
    await expect(page.getByRole('button', { name: '重新扫描并诊断' })).toHaveCount(0);
    await expect(page.locator('.diagnostics-page')).not.toContainText('scope_unknown');
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('12');
    await expect(page.locator('.coverage-strip')).toContainText('遥测条数未知');
    const viewerId = (await page.evaluate(() => window.tokenApi.getState())).user!.id;
    await context.app.evaluate(({ ipcMain }, id) => {
      ipcMain.removeHandler('usage:query');
      ipcMain.handle('usage:query', (_event, input) => {
        const query = input as { from: string; to: string; provider: string };
        const totals = { inputTokens: 5, outputTokens: 0, cacheReadTokens: 0,
          cacheCreationTokens: 0, totalTokens: 5, requests: 1 };
        return { query: { ...query, userId: id, projectKey: '' }, snapshotId: 'a'.repeat(64), totals,
          accounting: { status: 'uncertain', confirmedSubtotal: totals, conflictCount: 2,
            conflictSources: ['local', 'telemetry'] },
          points: [{ period: query.to, ...totals }],
          models: [{ provider: 'codex', model: 'gpt-test', ...totals }], projects: [], providers: [],
          availableModels: ['gpt-test'], availableModelOptions: [{ provider: 'codex', model: 'gpt-test' }],
          availableProjects: [], coverage: [] };
      });
      ipcMain.removeHandler('usage:details');
      ipcMain.handle('usage:details', () => ({ total: 1, page: 1, pageSize: 50, records: [{
        id: 'synthetic', provider: 'codex', model: 'gpt-test', projectKey: 'unknown',
        projectLabel: '未识别项目', occurredAt: new Date().toISOString(), source: 'local',
        sourceLabel: '合成来源', accountingStatus: 'pending', inputTokens: 8, outputTokens: 0,
        cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 8
      }] }));
    }, viewerId);
    await page.getByLabel('工具筛选').selectOption('codex');
    await expect(page.locator('.report-page')).toContainText('总量不可确认');
    await expect(page.locator('.metric-card').first()).toContainText('已确认小计 Token');
    await expect(page.locator('.trend-panel')).toContainText('仅已确认部分');
    await expect(page.locator('.detail-panel tbody')).toContainText('待核对');
    await expect(page.getByRole('button', { name: '导出含待核对用量 CSV v2' })).toBeVisible();
    await page.getByRole('button', { name: /问题反馈/ }).click();
    await page.getByLabel('反馈标题').fill('隔离测试反馈');
    await page.getByLabel('反馈说明').fill('人工构造的来源统计授权边界检查。');
    await page.getByLabel('附上脱敏采集状态（来源、数量、错误类型）').check();
    await page.getByRole('button', { name: '预览反馈' }).click();
    const preview = page.locator('.feedback-preview pre');
    await expect(preview).toContainText('"factCount": null');
    await expect(preview).not.toContainText('"factCount": 30');
    await page.getByRole('button', { name: '确认提交' }).click();
    await expect(page.getByRole('status')).toContainText('已提交到服务器');
    const serverDir = path.join(context.workspace.root, 'server');
    const port = (JSON.parse(fs.readFileSync(path.join(serverDir, 'server-port.json'), 'utf8')) as { port: number }).port;
    const token = fs.readFileSync(path.join(serverDir, 'server.secret'), 'utf8').trim();
    const admin = fs.readFileSync(path.join(serverDir, 'server-admin.secret'), 'utf8').trim();
    const response = await fetch(`http://127.0.0.1:${port}/v1/admin/feedback`, { headers: {
      authorization: `Bearer ${token}`, 'x-token-admin': admin
    } });
    expect(response.status).toBe(200);
    const feedback = await response.json() as { items: Array<{ diagnostics: string | null }> };
    const attached = JSON.parse(feedback.items[0].diagnostics || '[]') as Array<{ provider: string; factCount: number | null }>;
    expect(attached.find(item => item.provider === 'codex')?.factCount).toBe(1);
    expect(attached.find(item => item.provider === 'claude')?.factCount).toBeNull();
  } finally { await context.close(); }
});
