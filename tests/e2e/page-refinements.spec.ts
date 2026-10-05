import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { bindSource, launchM6 } from './m6-support';

test('TC-097 顶部状态一行呈现且详细诊断按需展开', async () => {
  const context = await launchM6('tc097-header', { usage: true });
  try {
    const { page } = context;
    const status = page.locator('.header-status');
    await expect(status.locator('summary')).toContainText('覆盖未知');
    await expect(status.locator('summary')).not.toContainText('当前修订版');
    await expect(status.locator('.header-status-detail')).not.toBeVisible();
    await status.locator('summary').click();
    await expect(status.locator('.header-status-detail')).toBeVisible();
    await expect(status.locator('.header-status-detail')).toContainText('本地');
    await status.getByRole('button', { name: '采集诊断' }).click();
    await expect(page.getByRole('heading', { name: '采集诊断' })).toBeVisible();
  } finally { await context.close(); }
});

test('TC-098 输入输出在窄窗口完整显示且覆盖未知不写为零', async () => {
  const context = await launchM6('tc098-numbers');
  try {
    const { page, app, workspace } = context;
    const now = new Date().toISOString();
    writeFileSync(path.join(workspace.codexDir, 'large.jsonl'), [
      { type: 'session_meta', payload: { session_id: 'large', cwd: '/synthetic/large' } },
      { type: 'turn_context', payload: { turn_id: 't', model: 'gpt-large' } },
      { type: 'token_usage_record', timestamp: now, payload: { session_id: 'large', turn_id: 't', response_id: 'r',
        usage: { input_tokens: 1_234_567, output_tokens: 987_654, total_tokens: 2_222_221 } } }
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await page.locator('.sidebar').getByRole('button', { name: /概览/ }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 760));
    const values = page.locator('.overview-io-values .token-number');
    await expect(values).toHaveCount(2);
    await expect(values.nth(0)).toHaveAttribute('aria-label', /精确值 1234567 Token/);
    await expect(values.nth(1)).toHaveAttribute('aria-label', /精确值 987654 Token/);
    expect(await values.evaluateAll(elements => elements.every(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.left >= 0 && box.right <= innerWidth &&
        getComputedStyle(element.closest('strong')!).textOverflow !== 'ellipsis';
    }))).toBe(true);
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await expect(page.locator('.metric-card').nth(1).locator('.token-number')).toHaveAttribute('aria-label', /精确值 1234567 Token/);
    await expect(page.locator('.metric-card').nth(2).locator('.token-number')).toHaveAttribute('aria-label', /精确值 987654 Token/);
    await page.getByLabel('开始日期').fill('1990-01-01');
    await page.getByLabel('结束日期').fill('1990-01-31');
    await expect(page.locator('.metric-card').first()).toContainText('覆盖未知');
    await expect(page.locator('.metric-card').first().locator('.token-number')).toHaveCount(0);
  } finally { await context.close(); }
});

test('TC-099 报表集中展示已选筛选并随日期与工具更新', async () => {
  const context = await launchM6('tc099-filters', { usage: true });
  try {
    const { page } = context;
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    const selected = page.getByRole('group', { name: '当前报表筛选' });
    await expect(selected).toContainText('工具：全部');
    await page.getByLabel('开始日期').fill('2026-10-01');
    await page.getByLabel('结束日期').fill('2026-10-03');
    await page.getByLabel('工具筛选').selectOption('codex');
    await expect(selected).toContainText('2026-10-01 至 2026-10-03');
    await expect(selected).toContainText('工具：Codex');
    await expect(selected).toContainText('模型：全部');
    await expect(page.locator('.trend-panel .panel-head')).not.toContainText('2026-10-01 至 2026-10-03');
  } finally { await context.close(); }
});

test('TC-100 单用户来源先显示汇总与异常并可按需管理正常归属', async () => {
  const context = await launchM6('tc100-source', { sameModel: true, singleUserDefault: true });
  try {
    const { page } = context;
    await expect.poll(async () => (await page.evaluate(() => window.tokenApi.getSourceIdentities()))
      .filter(item => item.provider === 'claude' && item.ownerUserId).length).toBeGreaterThan(0);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await expect(page.locator('.source-card').filter({ hasText: 'Claude Code' })).toContainText('已归属 1 个来源');
    await expect(page.getByRole('row', { name: /Claude Code · 文件来源/ })).toHaveCount(0);
    await page.getByRole('button', { name: '查看全部已归属来源' }).click();
    const row = page.getByRole('row', { name: /Claude Code · 文件来源/ }).first();
    await expect(row).toContainText('admin');
    await expect(row.getByRole('combobox')).toHaveCount(0);
    await row.getByRole('button', { name: '管理归属' }).click();
    await expect(row.getByRole('combobox')).toBeVisible();
    await row.getByRole('button', { name: '取消编辑' }).click();
    await expect(row.getByRole('combobox')).toHaveCount(0);
  } finally { await context.close(); }
});

test('TC-101 引导只突出下一步且扫描归属后进度立即刷新', async () => {
  const context = await launchM6('tc101-guide', { usage: true, usageDate: new Date().toISOString(), stayOnboarding: true });
  try {
    const { page } = context;
    await expect(page.locator('.onboarding-step .primary')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '跳过引导' })).toBeVisible();
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await expect.poll(async () => (await page.evaluate(() => window.tokenApi.getOnboardingStatus())).steps[1].state).toBe('complete');
    await page.getByRole('button', { name: '返回引导' }).click();
    await expect(page.locator('.onboarding-progress')).toHaveAttribute('value', /[2-4]/);
    await expect(page.locator('.onboarding-step .primary')).toHaveCount(1);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await bindSource(page, /Codex · 本机账户/, 'admin');
    await expect.poll(async () => (await page.evaluate(() => window.tokenApi.getOnboardingStatus())).steps[2].state).toBe('complete');
    await page.getByRole('button', { name: '返回引导' }).click();
    await expect(page.locator('.onboarding-progress')).toHaveAttribute('value', /[3-4]/);
    expect(await page.locator('.onboarding-step .primary').count()).toBeLessThanOrEqual(1);
  } finally { await context.close(); }
});
