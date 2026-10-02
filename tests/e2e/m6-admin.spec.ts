import { expect, test } from '@playwright/test';
import { createViewer, launchM6, loginViewer } from './m6-support';

test('TC-066 管理员可看反馈列表而普通用户接口拒绝', async () => {
  const context = await launchM6('tc066');
  try {
    const { page } = context;
    await page.getByRole('button', { name: /问题反馈/ }).click();
    await page.getByLabel('反馈标题').fill('报表说明');
    await page.getByLabel('反馈说明').fill('合成反馈：计数需要检查。');
    await page.getByRole('button', { name: '预览反馈' }).click();
    await expect(page.getByRole('region', { name: '反馈预览' })).toContainText('报表说明');
    await expect(page.getByRole('region', { name: '反馈预览' })).toContainText('提交账号：admin');
    const previewId = await page.locator('.feedback-preview code').textContent();
    expect(previewId).toMatch(/^[a-f0-9-]{36}$/);
    await page.getByRole('button', { name: '确认提交' }).click();
    await expect(page.getByRole('status')).toContainText(`已提交到服务器，反馈编号 ${previewId}`);
    await page.getByRole('button', { name: /管理中心/ }).click();
    await expect(page.getByRole('heading', { name: '管理中心', exact: true })).toBeVisible();
    await expect(page.locator('.panel').getByRole('heading', { name: '问题反馈', exact: true })).toBeVisible();
    await expect(page.getByText('报表说明')).toBeVisible();
    await createViewer(page);
    await loginViewer(page);
    await expect(page.getByRole('button', { name: /管理中心/ })).toHaveCount(0);
    const result = await page.evaluate(() => window.tokenApi.listFeedback().then(() => 'allowed', () => 'denied'));
    expect(result).toBe('denied');
  } finally { await context.close(); }
});

test('TC-067 账号启停归属和采集状态随操作更新', async () => {
  const context = await launchM6('tc067', { usage: true });
  try {
    const { page } = context;
    await createViewer(page);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await page.getByRole('row', { name: /Codex · 本机账户/ }).getByRole('combobox').selectOption({ label: 'viewer' });
    await page.getByRole('button', { name: /管理中心/ }).click();
    const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'viewer' }) });
    await expect(row).toContainText('1 / 2');
    await expect(row).toContainText('Codex: 已采集');
    await row.getByRole('button', { name: '停用' }).click();
    await expect(row).toContainText('停用');
    await row.getByRole('button', { name: '启用' }).click();
    await expect(row).toContainText('启用');
  } finally { await context.close(); }
});

test('TC-071 固定 admin 创建管理员与普通用户且角色边界生效', async () => {
  const context = await launchM6('tc071');
  try {
    const { page } = context;
    await page.getByRole('button', { name: /管理中心/ }).click();
    await expect(page.locator('.sidebar-bottom')).toContainText('超级管理员');
    await page.getByPlaceholder('3–32 位').fill('manager');
    await page.getByPlaceholder('至少 10 位').fill('manager-password-123');
    await page.getByRole('combobox', { name: '角色' }).selectOption('admin');
    await page.getByRole('button', { name: '创建用户' }).click();
    await expect(page.getByRole('row', { name: /manager/ })).toContainText('管理员');
    await page.getByPlaceholder('3–32 位').fill('viewer');
    await page.getByPlaceholder('至少 10 位').fill('viewer-password-123');
    await page.getByRole('combobox', { name: '角色' }).selectOption('viewer');
    await page.getByRole('button', { name: '创建用户' }).click();
    await expect(page.getByRole('row', { name: /viewer/ })).toContainText('普通用户');
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByPlaceholder('用户名').fill('manager');
    await page.getByPlaceholder('输入密码').fill('manager-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: /管理中心/ }).click();
    const fixed = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'admin' }) });
    await expect(fixed.getByRole('button', { name: '停用' })).toBeDisabled();
    await expect(fixed.getByRole('button', { name: '重设密码' })).toBeDisabled();
    const users = await page.evaluate(() => window.tokenApi.listUsers());
    expect(users.find(user => user.username === 'admin')?.role).toBe('superadmin');
  } finally { await context.close(); }
});
