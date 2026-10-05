import { expect, test } from '@playwright/test';
import { bindSource, createViewer, launchM6, loginViewer } from './m6-support';

test('TC-082 首次建账自动引导且跳过后不常驻，四步随真实采集归属更新', async () => {
  const context = await launchM6('tc082-guide', { usage: true, usageDate: new Date().toISOString(), stayOnboarding: true });
  try {
    const { page } = context;
    await expect(page.locator('.onboarding-step')).toHaveCount(4);
    await expect(page.getByRole('button', { name: /首次引导/ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: '首次使用引导' })).toBeVisible();
    await page.locator('.onboarding-step .primary').click();
    await expect(page.locator('.onboarding-hint')).toBeVisible();
    await page.getByRole('button', { name: '返回引导' }).click();
    const before = await page.evaluate(() => window.tokenApi.getSourceIdentities());
    await page.getByRole('button', { name: '跳过引导' }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await expect(page.locator('.onboarding-hint')).toHaveCount(0);
    expect(await page.evaluate(() => window.tokenApi.getSourceIdentities())).toEqual(before);
    await page.reload();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await expect(page.getByRole('button', { name: /首次引导/ })).toHaveCount(0);
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByPlaceholder('用户名').fill('admin');
    await page.getByPlaceholder('输入密码').fill('safe-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await createViewer(page);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await bindSource(page, /Codex · 本机账户/, 'viewer');
    const status = await page.evaluate(() => window.tokenApi.getOnboardingStatus());
    expect(status.steps.map(step => step.state)).toEqual(['complete', 'complete', 'complete', 'complete']);
    await expect(page.getByRole('button', { name: /首次引导/ })).toHaveCount(0);
  } finally { await context.close(); }
});

test('TC-083 后建普通用户不弹引导且只能读取本人状态，不能扫描归属', async () => {
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
    await bindSource(page, /Codex · 本机账户/, 'viewerB');
    await loginViewer(page);
    await expect(page.getByRole('button', { name: /首次引导/ })).toHaveCount(0);
    await expect(page.locator('.onboarding-hint')).toHaveCount(0);
    const scoped = await page.evaluate(() => window.tokenApi.getOnboardingStatus());
    expect(scoped.steps.map(step => step.state)).toEqual(['unknown', 'unknown', 'pending', 'pending']);
    expect(scoped.steps[2].detail).toContain('请联系管理员');
    await expect(page.getByRole('button', { name: /数据来源/ })).toHaveCount(0);
    const denied = await page.evaluate(async key => Promise.allSettled([
      window.tokenApi.scanSources(), window.tokenApi.previewSourceBinding(key, null, {
        from: '2026-10-01', to: '2026-10-03', timeZone: 'UTC', granularity: 'day',
        provider: 'codex', model: '', projectKey: '', userId: 'all'
      })
    ]), identity[0].key);
    expect(denied.map(item => item.status)).toEqual(['rejected', 'rejected']);
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByPlaceholder('用户名').fill('viewerB');
    await page.getByPlaceholder('输入密码').fill('viewer-b-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    const other = await page.evaluate(() => window.tokenApi.getOnboardingStatus());
    expect(other.steps[2].state).toBe('complete');
    expect(other.steps[3].state).toBe('complete');
    expect(other.steps[1].state).toBe('unknown');
  } finally { await context.close(); }
});
