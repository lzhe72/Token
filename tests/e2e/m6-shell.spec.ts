import { expect, test } from '@playwright/test';
import { launchM6 } from './m6-support';

test('TC-056 长报表右侧滚动时左侧导航保持固定', async () => {
  const context = await launchM6('tc056', { usage: true });
  try {
    const { page } = context;
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    const before = await page.locator('.sidebar').boundingBox();
    await page.locator('.main-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
    const after = await page.locator('.sidebar').boundingBox();
    expect(after?.y).toBe(before?.y);
    expect(await page.locator('.main-content').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /系统设置/ })).toBeVisible();
  } finally { await context.close(); }
});

test('TC-057 窄窗口路径可见且下钻可从面包屑返回', async () => {
  const context = await launchM6('tc057', { usage: true });
  try {
    const { page, app } = context;
    const actualWidth = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(700, 700);
      return window.getSize()[0];
    });
    expect(actualWidth).toBe(700);
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await page.getByLabel('开始日期').fill('2026-10-01');
    await page.getByLabel('结束日期').fill('2026-10-03');
    await page.getByRole('button', { name: '查看 2026-10-02 用量明细' }).click();
    const trail = page.getByRole('navigation', { name: '当前位置' });
    await expect(trail).toContainText('工作台 / 用量报表 / 明细');
    await trail.getByRole('button', { name: '用量报表' }).click();
    await expect(trail).not.toContainText('明细');
    await trail.getByRole('button', { name: '工作台' }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});
