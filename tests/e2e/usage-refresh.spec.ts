import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeUsage, bindSource, createViewer, launchM6, loginViewer } from './m6-support';

test('TC-105 切页复用报表且五分钟到期才重查，筛选和手动刷新即时查询', async () => {
  const context = await launchM6('tc105-five-minute', { usage: true, usageDate: new Date().toISOString() });
  try {
    const { app, page } = context;
    await page.locator('.sidebar').getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描', exact: true }).click();
    await page.locator('.sidebar').getByRole('button', { name: /概览/ }).click();
    await expect(page.locator('.overview-primary strong')).toHaveText('42');
    await app.evaluate(() => {
      process.env.TOKEN_E2E_TRACE_USAGE_QUERY = '1';
      (globalThis as typeof globalThis & { tokenE2eUsageQueryCount?: number }).tokenE2eUsageQueryCount = 0;
    });
    const count = () => app.evaluate(() =>
      (globalThis as typeof globalThis & { tokenE2eUsageQueryCount?: number }).tokenE2eUsageQueryCount ?? 0);
    await page.locator('.sidebar').getByRole('button', { name: /用量报表/ }).click();
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('42');
    await expect(page.locator('.detail-panel .panel-head span')).not.toHaveText('加载中');
    expect(await count()).toBe(0);
    for (let index = 0; index < 3; index++) {
      await page.locator('.sidebar').getByRole('button', { name: /概览/ }).click();
      await expect(page.locator('.overview-primary strong')).toHaveText('42');
      await page.locator('.sidebar').getByRole('button', { name: /用量报表/ }).click();
      await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('42');
      await expect(page.getByText('正在计算报表…')).toHaveCount(0);
      await expect(page.locator('.detail-panel .panel-head span')).not.toHaveText('加载中');
    }
    expect(await count()).toBe(0);

    await page.clock.install();
    await page.getByRole('button', { name: '刷新报表' }).click();
    await expect.poll(count).toBe(1);
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('42');
    await page.clock.fastForward(299_000);
    expect(await count()).toBe(1);
    await page.clock.fastForward(1000);
    await expect.poll(count).toBe(2);
    await page.getByLabel('工具筛选').selectOption('codex');
    await expect.poll(count).toBe(3);
    await page.getByLabel('工具筛选').selectOption('all');
    await expect.poll(count).toBe(4);
    await page.getByLabel('工具筛选').selectOption('codex');
    await expect.poll(count).toBe(5);
    await page.getByLabel('统计时区').selectOption('UTC');
    await expect.poll(count).toBe(6);
    const adminId = (await page.evaluate(() => window.tokenApi.getState())).user!.id;
    await page.getByLabel('用户筛选').selectOption(adminId);
    await expect.poll(count).toBe(7);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.getByLabel('结束日期').fill(yesterday);
    await expect.poll(count).toBe(8);
  } finally { await context.close(); }
});

test('TC-106 事实变更即时刷新，失败保留旧值且账号切换隔离', async () => {
  const context = await launchM6('tc106-five-minute', { usage: true, usageDate: new Date().toISOString() });
  try {
    const { app, page, workspace } = context;
    await page.locator('.sidebar').getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描', exact: true }).click();
    await page.locator('.sidebar').getByRole('button', { name: /用量报表/ }).click();
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('42');
    await app.evaluate(() => {
      process.env.TOKEN_E2E_TRACE_USAGE_QUERY = '1';
      (globalThis as typeof globalThis & { tokenE2eUsageQueryCount?: number }).tokenE2eUsageQueryCount = 0;
    });
    writeUsage(workspace.codexDir, 'later', '/work/alpha', 'gpt-alpha', 5, new Date().toISOString());
    await page.locator('.sidebar').getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描', exact: true }).click();
    await page.locator('.sidebar').getByRole('button', { name: /用量报表/ }).click();
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('47');
    expect(await app.evaluate(() =>
      (globalThis as typeof globalThis & { tokenE2eUsageQueryCount?: number }).tokenE2eUsageQueryCount ?? 0)).toBeGreaterThan(0);
    const currentReport = await page.evaluate(() => window.tokenApi.queryUsage({
      from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      granularity: 'day', provider: 'all', model: '', projectKey: '', userId: 'all'
    }));
    const currentDetails = await page.evaluate(({ query, snapshotId }) =>
      window.tokenApi.queryUsageDetails(query, 1, '', snapshotId), currentReport);
    expect(currentDetails.records.reduce((sum, row) => sum + row.totalTokens, 0)).toBe(47);
    const csvFile = path.join(workspace.root, 'usage-after-refresh.csv');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, csvFile);
    await page.getByRole('button', { name: '导出 CSV' }).click();
    await expect.poll(() => existsSync(csvFile)).toBe(true);
    const csv = readFileSync(csvFile, 'utf8');
    expect(csv).toContain('gpt-alpha');
    expect(csv).toContain('gpt-beta');
    expect(csv).toContain('"gpt-alpha",17,0,0,0,17,2');

    await app.evaluate(() => { process.env.TOKEN_E2E_NAV_FAIL_ONCE = 'usage:query'; });
    await page.getByRole('button', { name: '刷新报表' }).click();
    await expect(page.getByRole('alert')).toContainText('显示上次结果，未更新');
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('47');
    const afterFailure = await app.evaluate(() =>
      (globalThis as typeof globalThis & { tokenE2eUsageQueryCount?: number }).tokenE2eUsageQueryCount ?? 0);
    await page.locator('.sidebar').getByRole('button', { name: /数据来源/ }).click();
    await page.locator('.sidebar').getByRole('button', { name: /用量报表/ }).click();
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('47');
    await expect(page.getByRole('alert')).toContainText('未更新');
    expect(await app.evaluate(() =>
      (globalThis as typeof globalThis & { tokenE2eUsageQueryCount?: number }).tokenE2eUsageQueryCount ?? 0)).toBe(afterFailure);
    await page.getByRole('button', { name: '刷新报表' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);

    await createViewer(page);
    await page.getByPlaceholder('3–32 位').fill('viewerB');
    await page.getByPlaceholder('至少 10 位').fill('viewer-b-password-123');
    await page.getByRole('button', { name: '创建用户' }).click();
    await page.locator('.sidebar').getByRole('button', { name: /数据来源/ }).click();
    await bindSource(page, /Codex · 本机账户/, 'viewer');
    await loginViewer(page);
    await expect(page.locator('.overview-primary strong')).toHaveText('47');
    await page.locator('.sidebar').getByRole('button', { name: /用量报表/ }).click();
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('47');
    const beforeSwitch = await app.evaluate(() =>
      (globalThis as typeof globalThis & { tokenE2eUsageQueryCount?: number }).tokenE2eUsageQueryCount ?? 0);
    await app.evaluate(() => { process.env.TOKEN_E2E_NAV_DELAY_MS = '400'; });
    await page.getByRole('button', { name: '刷新报表' }).click();
    await expect.poll(() => app.evaluate(() =>
      (globalThis as typeof globalThis & { tokenE2eUsageQueryCount?: number }).tokenE2eUsageQueryCount ?? 0))
      .toBeGreaterThan(beforeSwitch);
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByPlaceholder('用户名').fill('viewerB');
    await page.getByPlaceholder('输入密码').fill('viewer-b-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.overview-primary strong')).toHaveText('覆盖未知');
    await page.waitForTimeout(500);
    await expect(page.locator('.overview-primary strong')).toHaveText('覆盖未知');
    await app.evaluate(() => { delete process.env.TOKEN_E2E_NAV_DELAY_MS; });
    await page.locator('.sidebar').getByRole('button', { name: /用量报表/ }).click();
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('覆盖未知');
    const scoped = await page.evaluate(() => window.tokenApi.queryUsage({ from: '2026-10-06', to: '2026-10-06',
      timeZone: 'Asia/Shanghai', granularity: 'day', provider: 'all', model: '', projectKey: '', userId: 'all' }));
    expect(scoped.totals.totalTokens).toBe(0);
    expect(scoped.coverage.every(source => source.windowCoverage?.state === 'unknown')).toBe(true);
  } finally { await context.close(); }
});
