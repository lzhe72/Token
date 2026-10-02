import { expect, test } from '@playwright/test';
import { launchM6 } from './m6-support';

test('TC-054 项目模型筛选及趋势下钻保持同一用量范围', async () => {
  const context = await launchM6('tc054', { usage: true });
  try {
    const { page } = context;
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await page.getByLabel('开始日期').fill('2026-10-01');
    await page.getByLabel('结束日期').fill('2026-10-03');
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('42');
    await expect(page.locator('.project-panel .dimension-row')).toHaveCount(2);
    await page.locator('.project-panel .dimension-row').filter({ hasText: 'alpha' }).click();
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('12');
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(1);
    await expect(page.locator('.detail-panel tbody tr').first()).toContainText('gpt-alpha');
    await page.getByRole('button', { name: '查看 2026-10-02 用量明细' }).click();
    await expect(page.getByRole('navigation', { name: '当前位置' })).toContainText('明细');
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(1);
    await page.getByLabel('模型筛选').selectOption('gpt-beta');
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(0);
  } finally { await context.close(); }
});
