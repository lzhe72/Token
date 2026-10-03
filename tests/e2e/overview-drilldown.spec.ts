import { expect, test } from '@playwright/test';
import { bindSource, createViewer, launchM6, loginViewer } from './m6-support';

test('TC-080 概览趋势继承时间工具并在面包屑返回后保留筛选与焦点', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const context = await launchM6('tc080-drill', { usage: true, usageDate: new Date().toISOString(), extraRecords: 55 });
  try {
    const { page } = context;
    await createViewer(page);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await bindSource(page, /Codex · 本机账户/, 'viewer');
    await page.getByRole('button', { name: /概览/ }).click();
    await expect(page.getByLabel('概览用户').getByRole('option', { name: 'viewer' })).toHaveCount(1);
    await page.getByLabel('概览用户').selectOption({ label: 'viewer' });
    const viewerId = await page.getByLabel('概览用户').inputValue();
    await page.getByLabel('概览时区').selectOption('UTC');
    await page.getByLabel('概览工具').selectOption('codex');
    for (const days of [90, 30, 7]) {
      await page.getByLabel('概览时间范围').selectOption(String(days));
      const from = new Date(Date.parse(`${day}T12:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
      await expect(page.locator('.overview-range span').first()).toHaveText(from);
      await expect(page.locator('.overview-range span').last()).toHaveText(day);
      await page.getByRole('button', { name: `查看 ${day} 用量明细` }).click();
      await expect(page.getByLabel('开始日期')).toHaveValue(from);
      await expect(page.getByLabel('结束日期')).toHaveValue(day);
      await expect(page.getByLabel('工具筛选')).toHaveValue('codex');
      await expect(page.getByLabel('用户筛选')).toHaveValue(viewerId);
      await expect(page.getByLabel('统计时区')).toHaveValue('UTC');
      await expect(page.locator('.detail-filters')).toContainText(day);
      const trail = page.getByRole('navigation', { name: '当前位置' });
      await trail.getByRole('button', { name: '用量报表' }).click();
      await expect(page.getByLabel('开始日期')).toHaveValue(from);
      await expect(page.locator('.detail-filters')).toHaveCount(0);
      await trail.getByRole('button', { name: '工作台' }).click();
      await expect(page.getByLabel('概览时间范围')).toHaveValue(String(days));
      await expect(page.locator(`#overview-trend-${day}`)).toBeFocused();
    }
    await expect(page.locator('.overview-primary')).toContainText('今日进行中');
    await expect(page.locator('.overview-primary')).toContainText('不可比较');
    const trend = page.getByRole('button', { name: `查看 ${day} 用量明细` });
    await expect(trend).toBeVisible();
    await trend.click();
    await expect(page.getByRole('heading', { name: '用量报表' })).toBeVisible();
    await expect(page.getByLabel('结束日期')).toHaveValue(day);
    await expect(page.getByLabel('工具筛选')).toHaveValue('codex');
    await expect(page.getByLabel('统计时区')).toHaveValue('UTC');
    await expect(page.getByLabel('用户筛选')).toHaveValue(viewerId);
    await expect(page.locator('.detail-filters')).toContainText(day);
    await expect(page.locator('.detail-panel')).toBeFocused();
    await expect(page.locator('.detail-panel .detail-pager')).toBeVisible();
    await page.locator('.detail-panel').getByRole('button', { name: '下一页' }).click();
    await expect(page.locator('.detail-panel .detail-pager')).toContainText('2 / 2');
    const trail = page.getByRole('navigation', { name: '当前位置' });
    await trail.getByRole('button', { name: '用量报表' }).click();
    await expect(page.getByLabel('工具筛选')).toHaveValue('codex');
    await expect(page.getByLabel('结束日期')).toHaveValue(day);
    await expect(page.getByLabel('统计时区')).toHaveValue('UTC');
    await expect(page.locator('.detail-filters')).toHaveCount(0);
    await trail.getByRole('button', { name: '工作台' }).click();
    await expect(page.getByLabel('概览时间范围')).toHaveValue('7');
    await expect(page.getByLabel('概览工具')).toHaveValue('codex');
    await expect(page.getByLabel('概览用户')).toHaveValue(viewerId);
    await expect(page.getByLabel('概览时区')).toHaveValue('UTC');
    await expect(page.locator(`#overview-trend-${day}`)).toBeFocused();
    await loginViewer(page);
    await expect(page.getByLabel('概览用户')).toHaveCount(0);
    await expect(page.locator('.overview-primary')).toContainText('97');
  } finally { await context.close(); }
});

test('TC-081 同名模型按提供方下钻且筛选选项不混合', async () => {
  const context = await launchM6('tc081-model', { sameModel: true, usageDate: new Date().toISOString() });
  try {
    const { page } = context;
    const ranking = page.getByRole('button', { name: '查看 Claude Code shared-model 用量明细' });
    await expect(ranking).toBeVisible();
    await ranking.click();
    await expect(page.getByLabel('工具筛选')).toHaveValue('claude');
    await expect(page.getByLabel('模型筛选')).toHaveValue('claude\0shared-model');
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('30');
    await page.getByRole('navigation', { name: '当前位置' }).getByRole('button', { name: '用量报表' }).click();
    await page.getByLabel('工具筛选').selectOption('all');
    await expect(page.getByLabel('模型筛选').getByRole('option', { name: 'Codex · shared-model' })).toHaveCount(1);
    await expect(page.getByLabel('模型筛选').getByRole('option', { name: 'Claude Code · shared-model' })).toHaveCount(1);
    await page.getByLabel('模型筛选').selectOption({ label: 'Claude Code · shared-model' });
    await expect(page.getByLabel('工具筛选')).toHaveValue('claude');
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('30');
    await page.getByRole('navigation', { name: '当前位置' }).getByRole('button', { name: '工作台' }).click();
    await expect(page.getByRole('button', { name: '查看 Claude Code shared-model 用量明细' })).toBeFocused();
  } finally { await context.close(); }
});
