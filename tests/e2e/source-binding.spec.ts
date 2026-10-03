import { expect, test } from '@playwright/test';
import { createViewer, launchM6, loginViewer, writeUsage } from './m6-support';

test('TC-086 草稿预览键盘取消与确认后权限转移', async () => {
  const context = await launchM6('tc086-binding-ui', { usage: true, usageDate: new Date().toISOString() });
  try {
    const { page } = context;
    await createViewer(page);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    const row = page.getByRole('row', { name: /Codex · 本机账户/ });
    const key = (await page.evaluate(() => window.tokenApi.getSourceIdentities())).find(item => item.provider === 'codex')!.key;
    await row.getByRole('combobox').selectOption({ label: 'viewer' });
    await expect(row).toContainText('未保存草稿');
    expect((await page.evaluate(() => window.tokenApi.getSourceIdentities())).find(item => item.key === key)?.ownerUserId).toBeNull();
    await row.getByRole('button', { name: '预览变更' }).click();
    const dialog = page.getByRole('dialog', { name: '确认来源归属变更' });
    await expect(dialog).toContainText('本地可见范围在确认后立即改变');
    await expect(dialog).toContainText('今后该来源新增记录都会归属目标用户');
    await expect(dialog).toContainText('变更前');
    await expect(dialog).toContainText('变更后');
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(row.getByRole('button', { name: '预览变更' })).toBeFocused();
    expect((await page.evaluate(() => window.tokenApi.getSourceIdentities())).find(item => item.key === key)?.ownerUserId).toBeNull();
    await row.getByRole('button', { name: '预览变更' }).click();
    await dialog.getByRole('button', { name: '确认变更' }).click();
    await expect(dialog).toHaveCount(0);
    const viewerId = (await page.evaluate(() => window.tokenApi.listUsers())).find(user => user.username === 'viewer')!.id;
    expect((await page.evaluate(() => window.tokenApi.getSourceIdentities())).find(item => item.key === key)?.ownerUserId).toBe(viewerId);
    await loginViewer(page);
    expect(await page.evaluate(key => window.tokenApi.previewSourceBinding(key, null, {
      from: '2026-10-01', to: '2026-10-03', timeZone: 'UTC', granularity: 'day',
      provider: 'codex', model: '', projectKey: '', userId: 'all'
    }).then(() => 'allowed', () => 'denied'), key)).toBe('denied');
    expect(await page.evaluate(() => window.tokenApi.confirmSourceBinding('00000000-0000-4000-8000-000000000000')
      .then(() => 'allowed', () => 'denied'))).toBe('denied');
  } finally { await context.close(); }
});

test('TC-087 预览后重扫变化确认拒绝且界面恢复旧归属', async () => {
  const context = await launchM6('tc087-stale-ui', { usage: true, usageDate: new Date().toISOString() });
  try {
    const { page, workspace } = context;
    await createViewer(page);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    const row = page.getByRole('row', { name: /Codex · 本机账户/ });
    const original = await row.getByRole('combobox').inputValue();
    await row.getByRole('combobox').selectOption({ label: 'viewer' });
    await row.getByRole('button', { name: '预览变更' }).click();
    const dialog = page.getByRole('dialog', { name: '确认来源归属变更' });
    await expect(dialog).toBeVisible();
    writeUsage(workspace.codexDir, 'new-after-preview', '/synthetic/project', 'gpt-test', 7, new Date().toISOString());
    await page.evaluate(() => window.tokenApi.scanSources());
    await dialog.getByRole('button', { name: '确认变更' }).click();
    await expect(dialog).toHaveCount(0);
    const alert = page.getByRole('alert').filter({ hasText: '已变化' });
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await expect(row.getByRole('combobox')).toHaveValue(original);
    expect((await page.evaluate(() => window.tokenApi.getSourceIdentities())).find(item => item.provider === 'codex')?.ownerUserId).toBeNull();
  } finally { await context.close(); }
});
