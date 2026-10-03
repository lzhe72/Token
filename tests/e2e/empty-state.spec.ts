import { expect, test } from '@playwright/test';
import { writeUsage, launchM6, createViewer, loginViewer } from './m6-support';

test('TC-084 报表筛选无匹配保持覆盖未知并可清除筛选进入诊断', async () => {
  const context = await launchM6('tc084-empty-ui', { usage: true, usageDate: new Date().toISOString() });
  try {
    const { page } = context;
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await page.getByLabel('工具筛选').selectOption('codex');
    await expect(page.getByLabel('模型筛选')).toContainText('gpt-alpha');
    await page.getByLabel('模型筛选').selectOption({ label: 'Codex · gpt-alpha' });
    await page.getByLabel('开始日期').fill('2020-01-01');
    await page.getByLabel('结束日期').fill('2020-01-02');
    await expect(page.locator('.trend-panel .empty-row')).toContainText('筛选没有已观测记录');
    await expect(page.locator('.trend-panel .empty-row')).toContainText('覆盖仍未知');
    await page.getByRole('button', { name: '清除模型与项目筛选' }).click();
    await expect(page.locator('.trend-panel .empty-row')).toContainText('完整覆盖未知');
    await page.getByRole('button', { name: '查看采集诊断' }).click();
    await expect(page.getByRole('heading', { name: '采集诊断' })).toBeVisible();
  } finally { await context.close(); }
});

test('TC-085 慢速合成扫描在诊断页显示中间进展且完成后清除', async () => {
  const context = await launchM6('tc085-progress-ui', { scanDelayMs: 350 });
  try {
    const { page, workspace } = context;
    for (let index = 0; index < 8; index++) {
      writeUsage(workspace.codexDir, `slow-${index}`, '/synthetic/project', 'gpt-test', 1, new Date().toISOString());
    }
    await page.getByRole('button', { name: /采集诊断/ }).click();
    await page.getByRole('button', { name: '重新扫描并诊断' }).click();
    const progress = page.locator('.diagnostic-card').first().locator('.scan-progress');
    await expect(progress).toContainText('全局扫描进展');
    await expect(progress).toContainText('已处理');
    await expect(progress).not.toContainText('%');
    await expect(page.locator('.diagnostic-card').first().locator('.status-warn')).toHaveText('正在扫描');
    await expect(progress).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('.diagnostic-card').first()).toContainText('采集正常');
    await createViewer(page);
    await loginViewer(page);
    expect(await page.evaluate(() => window.tokenApi.getScanProgress().then(() => 'allowed', () => 'denied'))).toBe('denied');
  } finally { await context.close(); }
});
