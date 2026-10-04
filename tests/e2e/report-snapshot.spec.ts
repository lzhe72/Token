import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReportQuery } from '../../src/shared/types';
import { launchM6 } from './m6-support';

test('TC-079 快速切换筛选时旧响应不覆盖且导出等待当前快照', async () => {
  const context = await launchM6('tc079-race');
  try {
    await context.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('usage:query');
      ipcMain.handle('usage:query', async (_event, input) => {
        const query = input as ReportQuery;
        await new Promise(resolve => setTimeout(resolve, query.provider === 'codex' ? 650 : 180));
        const total = query.provider === 'codex' ? 12 : query.provider === 'claude' ? 30 : 42;
        const totals = { inputTokens: total, outputTokens: 0, cacheReadTokens: 0,
          cacheCreationTokens: 0, totalTokens: total, requests: 1 };
        return { query: { ...query, projectKey: query.projectKey || '' },
          snapshotId: (query.provider === 'codex' ? 'c' : query.provider === 'claude' ? 'd' : 'a').repeat(64),
          totals, points: [{ period: '2026-10-02', ...totals }],
          models: [{ provider: query.provider === 'all' ? 'codex' : query.provider, model: 'gpt-test', ...totals }],
          projects: [], providers: [], availableModels: ['gpt-test'], availableProjects: [], coverage: [] };
      });
      ipcMain.removeHandler('usage:details');
      ipcMain.handle('usage:details', (_event, _query, page) => ({ records: [], total: 0, page, pageSize: 50 }));
      ipcMain.removeHandler('reports:export-csv');
      ipcMain.handle('reports:export-csv', (_event, query, snapshotId) => {
        (globalThis as typeof globalThis & { tc079Export?: { query: ReportQuery; snapshotId: string } }).tc079Export =
          { query: query as ReportQuery, snapshotId: String(snapshotId) };
        throw new Error('数据已变化，请刷新报表');
      });
    });
    const { page } = context;
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await page.getByLabel('工具筛选').selectOption('codex');
    await page.getByLabel('工具筛选').selectOption('claude');
    expect(await page.getByRole('button', { name: '导出 CSV' }).isDisabled()).toBe(true);
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('30');
    await expect(page.getByRole('button', { name: '导出 CSV' })).toBeEnabled();
    await page.waitForTimeout(700);
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('30');
    await page.getByRole('button', { name: '导出 CSV' }).click();
    const submitted = await context.app.evaluate(() =>
      (globalThis as typeof globalThis & { tc079Export?: { query: ReportQuery; snapshotId: string } }).tc079Export);
    expect(submitted).toMatchObject({ query: { provider: 'claude' }, snapshotId: 'd'.repeat(64) });
    await expect(page.getByRole('alert')).toContainText('数据已变化');
    await expect(page.getByRole('button', { name: '刷新报表' })).toBeVisible();
    await page.getByRole('button', { name: '刷新报表' }).click();
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('30');
  } finally { await context.close(); }
});

test('TC-079 连续修改双日期后保持最终范围并以同一快照导出', async () => {
  const context = await launchM6('tc079-dates', { usage: true, usageDate: '2026-01-01T12:00:00Z' });
  try {
    const { page } = context;
    await page.getByRole('button', { name: /数据来源/ }).click();
    await expect(page.getByRole('button', { name: '立即扫描', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '立即扫描', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.tokenApi.getScanProgress())).length).toBe(0);
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    const report = page.locator('.report-page');
    await expect(report).toBeVisible();
    const fromInput = report.getByLabel('开始日期', { exact: true });
    const toInput = report.getByLabel('结束日期', { exact: true });
    await fromInput.fill('2026-01-03');
    await toInput.fill('2026-01-02');
    await expect(page.getByRole('alert')).toContainText('日期范围无效');
    await expect(page.getByRole('button', { name: '导出 CSV' })).toBeDisabled();
    await fromInput.fill('2026-01-01');
    await expect(page.getByRole('alert')).toHaveCount(0);
    for (const [from, to] of [['2026-01-01', '2026-01-02'], ['2026-02-01', '2026-02-02'],
      ['2026-03-01', '2026-03-02'], ['2026-01-01', '2026-01-02']] as const) {
      await fromInput.fill(from);
      await toInput.fill(to);
      await expect(fromInput).toHaveValue(from);
      await expect(toInput).toHaveValue(to);
      await expect(page.locator('.export-summary')).toContainText(`${from} 至 ${to}`);
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('42');
    const csvFile = path.join(context.workspace.root, 'tc079-dates.csv');
    await context.app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, csvFile);
    await page.getByRole('button', { name: '导出 CSV' }).click();
    await expect.poll(() => existsSync(csvFile)).toBe(true);
    const csv = readFileSync(csvFile, 'utf8');
    expect(csv).toContain('2026-01-01');
    expect(csv).toContain('gpt-alpha');
    expect(csv).toContain('gpt-beta');
  } finally { await context.close(); }
});
