import { expect, test } from '@playwright/test';
import { createViewer, launchM6, loginViewer } from './m6-support';

test('TC-082 管理员可跳过重开且四步随真实采集归属更新', async () => {
  const context = await launchM6('tc082-guide', { usage: true, usageDate: new Date().toISOString() });
  try {
    const { page } = context;
    await expect(page.locator('.onboarding-hint')).toBeVisible();
    const before = await page.evaluate(() => window.tokenApi.getSourceIdentities());
    await page.locator('.onboarding-hint').getByRole('button', { name: '跳过引导' }).click();
    await expect(page.locator('.onboarding-hint')).toHaveCount(0);
    expect(await page.evaluate(() => window.tokenApi.getSourceIdentities())).toEqual(before);
    await page.reload();
    await expect(page.locator('.onboarding-hint')).toHaveCount(0);
    await page.getByRole('button', { name: /首次引导/ }).click();
    await expect(page.getByRole('heading', { name: '首次使用引导' })).toBeVisible();
    await expect(page.locator('.onboarding-step')).toHaveCount(4);
    await expect(page.locator('.onboarding-step').last()).toContainText('尚未观测到归属范围内的用量');
    await createViewer(page);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await page.getByRole('row', { name: /Codex · 本机账户/ }).getByRole('combobox').selectOption({ label: 'viewer' });
    await page.getByRole('button', { name: /首次引导/ }).click();
    await expect(page.locator('.onboarding-step')).toHaveCount(4);
    await expect(page.locator('.onboarding-step').nth(0)).toContainText('已完成');
    await expect(page.locator('.onboarding-step').nth(1)).toContainText('已完成');
    await expect(page.locator('.onboarding-step').nth(2)).toContainText('已完成');
    await expect(page.locator('.onboarding-step').nth(3)).toContainText('已完成');
    await expect(page.locator('.onboarding-step').nth(3)).toContainText('第一笔已确认用量');
  } finally { await context.close(); }
});

test('TC-083 普通用户引导不显示他人进度且无权扫描归属', async () => {
  const context = await launchM6('tc083-guide-scope', { usage: true, usageDate: new Date().toISOString() });
  try {
    const { page } = context;
    await createViewer(page);
    await page.getByPlaceholder('3–32 位').fill('viewerB');
    await page.getByPlaceholder('至少 10 位').fill('viewer-b-password-123');
    await page.getByRole('button', { name: '创建用户' }).click();
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    const identity = await page.evaluate(() => window.tokenApi.getSourceIdentities());
    await page.getByRole('row', { name: /Codex · 本机账户/ }).getByRole('combobox').selectOption({ label: 'viewerB' });
    await loginViewer(page);
    await page.getByRole('button', { name: /首次引导/ }).click();
    const scoped = await page.evaluate(() => window.tokenApi.getOnboardingStatus());
    expect(scoped.steps.map(step => step.state)).toEqual(['unknown', 'unknown', 'pending', 'pending']);
    await expect(page.locator('.onboarding-step').nth(2)).toContainText('请联系管理员');
    await expect(page.getByRole('button', { name: /数据来源/ })).toHaveCount(0);
    await page.locator('.onboarding-step').nth(2).getByRole('button', { name: '查看本人采集状态' }).click();
    await expect(page.getByRole('heading', { name: '采集诊断' })).toBeVisible();
    const denied = await page.evaluate(async key => Promise.allSettled([
      window.tokenApi.scanSources(), window.tokenApi.bindSourceIdentity(key, null)
    ]), identity[0].key);
    expect(denied.map(item => item.status)).toEqual(['rejected', 'rejected']);
    await page.getByRole('button', { name: /概览/ }).click();
    await expect(page.locator('.onboarding-hint')).toBeVisible();
    await page.locator('.onboarding-hint').getByRole('button', { name: '跳过引导' }).click();
    await expect(page.locator('.onboarding-hint')).toHaveCount(0);
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByPlaceholder('用户名').fill('viewerB');
    await page.getByPlaceholder('输入密码').fill('viewer-b-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await expect(page.locator('.onboarding-hint')).toHaveCount(0);
    const other = await page.evaluate(() => window.tokenApi.getOnboardingStatus());
    expect(other.steps[2].state).toBe('complete');
    expect(other.steps[3].state).toBe('complete');
    expect(other.steps[1].state).toBe('unknown');
    const ownSkipped = await page.evaluate(async () => {
      const id = (await window.tokenApi.getState()).user!.id;
      return localStorage.getItem(`token:onboarding:skipped:${id}`);
    });
    expect(ownSkipped).toBeNull();
    await page.getByRole('button', { name: /首次引导/ }).click();
    await expect(page.locator('.onboarding-step').nth(1)).toContainText('待管理员确认');
  } finally { await context.close(); }
});
