import { expect, test } from '@playwright/test';
import { createViewer, launchM6 } from './m6-support';

test('TC-077 管理员切换用户和未归属时概览报表不显示假零', async () => {
  const context = await launchM6('tc077-scope-ui', { usage: true, usageDate: new Date().toISOString() });
  try {
    const { page } = context;
    await createViewer(page);
    await page.getByPlaceholder('3–32 位').fill('viewerB');
    await page.getByPlaceholder('至少 10 位').fill('viewer-b-password-123');
    await page.getByRole('button', { name: '创建用户' }).click();
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await page.getByRole('row', { name: /Codex · 本机账户/ }).getByRole('combobox').selectOption({ label: 'viewer' });
    await page.getByRole('button', { name: /概览/ }).click();
    await page.getByLabel('概览工具').selectOption('codex');
    await page.getByLabel('概览用户').selectOption({ label: 'viewer' });
    await expect(page.locator('.overview-primary strong')).toHaveText('42');
    await expect(page.locator('.source-card').filter({ hasText: 'Codex' })).toContainText('2 条本范围已观测记录');
    for (const selected of [{ label: 'viewerB' }, { label: '未归属' }]) {
      await page.getByLabel('概览用户').selectOption(selected);
      await expect(page.locator('.overview-primary strong')).toHaveText('覆盖未知');
      const source = page.locator('.source-card').filter({ hasText: 'Codex' });
      await expect(source).toContainText('0 条本范围已观测记录');
      await expect(source).toContainText('覆盖未知');
      await expect(source).not.toContainText('2 条本范围已观测记录');
      await expect(page.locator('.overview-change')).toContainText('不可比较');
      await page.getByRole('button', { name: /用量报表/ }).first().click();
      await page.getByLabel('工具筛选').selectOption('codex');
      await page.getByLabel('用户筛选').selectOption(selected);
      await expect(page.locator('.coverage-strip')).toContainText('覆盖未知');
      await expect(page.locator('.metric-grid .metric-card strong').first()).toHaveText('覆盖未知');
      await expect(page.locator('.metric-grid .metric-card strong').nth(1)).toHaveText('覆盖未知');
      await expect(page.locator('.metric-grid .metric-card strong').nth(2)).toHaveText('覆盖未知');
      await expect(page.locator('.metric-grid .metric-card strong').nth(3)).toHaveText('覆盖未知');
      await page.getByRole('button', { name: /概览/ }).click();
    }
  } finally { await context.close(); }
});

test('TC-078 只有待核对记录时保留已确认小计零而完整总量未知', async () => {
  const context = await launchM6('tc078-pending-ui', { sameModel: true, usageDate: new Date().toISOString() });
  try {
    const { page } = context;
    await createViewer(page);
    const telemetry = await page.evaluate(() => window.tokenApi.getTelemetryConfiguration());
    const endpoint = telemetry.codex.match(/endpoint = "([^"]+)"/)?.[1];
    const secret = telemetry.codex.match(/Bearer ([a-f0-9]+)/)?.[1];
    expect(endpoint && secret).toBeTruthy();
    const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
    const now = new Date().toISOString();
    const payload = { resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: String(BigInt(Date.parse(now)) * 1_000_000n), attributes: [
        attr('event.name', 'codex.sse_event'), attr('event.kind', 'response.completed'),
        attr('input_token_count', '14'), attr('output_token_count', '0'),
        attr('conversation.id', 'one'), attr('model', 'shared-model'),
        attr('user.account_id', 'synthetic-owner-a')
      ]
    }] }] }] };
    expect((await fetch(endpoint!, { method: 'POST', headers: { authorization: `Bearer ${secret}`,
      'content-type': 'application/json' }, body: JSON.stringify(payload) })).status).toBe(200);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await page.getByRole('row', { name: /Codex · 本机账户/ }).getByRole('combobox').selectOption({ label: 'viewer' });
    await page.getByRole('row', { name: /Codex 遥测来源/ }).getByRole('combobox').selectOption({ label: 'viewer' });
    await page.getByRole('button', { name: /概览/ }).click();
    await page.getByLabel('概览工具').selectOption('codex');
    await page.getByLabel('概览用户').selectOption({ label: 'viewer' });
    await expect(page.locator('.overview-primary')).toContainText('已确认小计 Token');
    await expect(page.locator('.overview-primary strong')).toHaveText('0');
    await expect(page.locator('.overview-primary')).toContainText('总量不可确认');
    await expect(page.locator('.overview-change')).toContainText('不可比较');
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await page.getByLabel('工具筛选').selectOption('codex');
    await page.getByLabel('用户筛选').selectOption({ label: 'viewer' });
    await expect(page.locator('.coverage-strip')).toContainText('部分覆盖');
    await expect(page.locator('.metric-card').first()).toContainText('完整总量不可确认');
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('0');
    await expect(page.locator('.metric-card').nth(1).locator('strong')).toHaveText('0');
    await expect(page.locator('.trend-panel')).toContainText('完整趋势不可确认');
  } finally { await context.close(); }
});
