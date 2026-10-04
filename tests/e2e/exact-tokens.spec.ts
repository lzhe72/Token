import { expect, test, type Locator } from '@playwright/test';
import { bindSource, launchM6, writeUsage } from './m6-support';

test('TC-090 仅用键盘复制概览趋势排行报表和明细原始整数', async () => {
  const context = await launchM6('tc090-exact');
  const { app, page, workspace } = context;
  const originalClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  const now = new Date().toISOString();
  const values = [0, 1023, 1024, 1_050_000];
  const total = values.reduce((sum, value) => sum + value, 0);
  async function copyAndCheck(number: Locator, value: number) {
    await number.focus();
    await expect(number).toBeFocused();
    expect(await number.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.left >= 0 && box.right <= innerWidth;
    })).toBe(true);
    await expect(number).toHaveAttribute('aria-label', new RegExp(`精确值 ${value} Token`));
    const popover = page.locator('.token-popover');
    await expect(popover).toContainText(`${value.toLocaleString('zh-CN')} Token`);
    expect(await popover.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
    })).toBe(true);
    await page.keyboard.press('Tab');
    const button = popover.locator('.token-copy');
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(String(value));
    await expect(button).toBeFocused();
  }
  try {
    for (const value of values) writeUsage(workspace.codexDir, `exact-${value}`, '/synthetic/exact',
      `gpt-${value}`, value, now);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await page.locator('.sidebar').getByRole('button', { name: /概览/ }).click();
    await expect(page.locator('.overview-primary strong')).toHaveText(/1.*M/);
    await copyAndCheck(page.locator('.overview-primary .token-number'), total);
    const inputs = page.locator('.overview-secondary .token-number');
    await copyAndCheck(inputs.nth(0), total);
    await copyAndCheck(inputs.nth(1), 0);
    await copyAndCheck(page.locator('.overview-bar-item .token-number').first(), total);
    await copyAndCheck(page.locator('.ranking-item').filter({ hasText: 'gpt-1024' }).locator('.token-number'), 1024);
    await copyAndCheck(page.locator('.ranking-item').filter({ hasText: 'gpt-0' }).locator('.token-number'), 0);
    const narrowWidth = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(700, 760);
      return window.getSize()[0];
    });
    expect(narrowWidth).toBe(700);
    await page.screenshot({ path: 'test-results/tc090-overview-narrow.png' });
    const trendCopy = page.locator('.overview-bar-item .token-number').first();
    await expect(trendCopy).toBeVisible();
    expect(await trendCopy.evaluate(element => {
      const button = element.getBoundingClientRect();
      const container = element.closest('.overview-bar-item')!.getBoundingClientRect();
      return button.left >= container.left && button.right <= container.right;
    })).toBe(true);
    await copyAndCheck(trendCopy, total);
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await expect(page.locator('.metric-card').first()).toContainText('已观测 Token');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/tc090-report-narrow.png' });
    await page.locator('.metric-grid').screenshot({ path: 'test-results/tc090-metrics-narrow.png' });
    const metrics = page.locator('.metric-card .token-number');
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await metrics.first().hover();
    await expect(page.locator('.token-popover')).toContainText('复制完整数值');
    await page.screenshot({ path: 'test-results/tc090-hover-menu-narrow.png' });
    await page.mouse.move(0, 0);
    await expect(page.locator('.token-popover')).toHaveCount(0);
    for (const [index, value] of [total, total, 0, 0].entries()) await copyAndCheck(metrics.nth(index), value);
    await metrics.first().focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await expect(metrics.first()).toBeFocused();
    await expect(page.locator('.token-popover')).toHaveCount(0);
    await copyAndCheck(page.locator('.bar-item .token-number').first(), total);
    await copyAndCheck(page.locator('.dimension-item .token-number').first(), total);
    const model = page.locator('.model-panel tbody tr').filter({ hasText: 'gpt-1024' });
    const modelCopies = model.locator('.token-number');
    for (const [index, value] of [1024, 0, 0, 0, 1024].entries()) await copyAndCheck(modelCopies.nth(index), value);
    const detail = page.locator('.detail-panel tbody tr').filter({ hasText: 'gpt-1024' });
    const detailCopies = detail.locator('.token-number');
    for (const [index, value] of [1024, 0, 0, 0, 1024].entries()) await copyAndCheck(detailCopies.nth(index), value);
    await page.getByLabel('开始日期').fill('1990-01-01');
    await page.getByLabel('结束日期').fill('1990-01-31');
    await expect(page.locator('.metric-card').first()).toContainText('覆盖未知');
    await expect(page.locator('.metric-card').first().locator('.token-number')).toHaveCount(0);
  } finally {
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), originalClipboard).catch(() => {});
    await context.close();
  }
});

test('TC-090 待核对事实只复制已确认小计与带状态的原始整数', async () => {
  const context = await launchM6('tc090-conflict');
  const { app, page, workspace } = context;
  const originalClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    const now = new Date().toISOString();
    writeUsage(workspace.codexDir, 'same-session', '/synthetic/overlap', 'gpt-overlap', 1024, now);
    const config = await page.evaluate(() => window.tokenApi.getTelemetryConfiguration());
    const endpoint = config.codex.match(/endpoint = "([^"]+)"/)?.[1];
    const secret = config.codex.match(/Bearer ([a-f0-9]+)/)?.[1];
    expect(endpoint && secret).toBeTruthy();
    const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
    const otel = { resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: String(BigInt(Date.parse(now)) * 1_000_000n), attributes: [
        attr('event.name', 'codex.sse_event'), attr('event.kind', 'response.completed'),
        attr('input_token_count', '1023'), attr('output_token_count', '0'),
        attr('conversation.id', 'same-session'), attr('model', 'gpt-overlap'),
        attr('user.account_id', 'synthetic-owner')
      ]
    }] }] }] };
    expect((await fetch(endpoint!, { method: 'POST', headers: {
      authorization: `Bearer ${secret}`, 'content-type': 'application/json'
    }, body: JSON.stringify(otel) })).status).toBe(200);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await bindSource(page, /Codex · 本机账户/, 'admin');
    await bindSource(page, /Codex 遥测来源/, 'admin');
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await expect(page.locator('.report-page')).toContainText('总量不可确认');
    const subtotal = page.locator('.metric-card').first().locator('.token-number');
    await expect(subtotal).toHaveAttribute('aria-label', /已确认小计精确值 0 Token/);
    await subtotal.focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('.token-popover .token-copy')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('0');
    await expect(page.getByRole('button', { name: /报表已观测总量精确值/ })).toHaveCount(0);
    const pending = page.locator('.detail-panel tbody tr').filter({ hasText: '待核对' });
    await expect(pending).toHaveCount(2);
    for (const value of [1023, 1024]) {
      const raw = pending.getByRole('button', { name: new RegExp(`待核对原始总量精确值 ${value} Token`) });
      await raw.focus();
      await page.keyboard.press('Tab');
      await expect(page.locator('.token-popover .token-copy')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(String(value));
    }
  } finally {
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), originalClipboard).catch(() => {});
    await context.close();
  }
});
