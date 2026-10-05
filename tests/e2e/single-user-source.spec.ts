import { expect, test } from '@playwright/test';
import { launchM6 } from './m6-support';

test('TC-096 单用户客户端 Claude 文件默认显示归属当前使用者', async () => {
  const context = await launchM6('tc096-single-user-ui', { sameModel: true, singleUserDefault: true });
  try {
    const { page } = context;
    await expect.poll(async () => (await page.evaluate(() => window.tokenApi.getSourceIdentities()))
      .find(item => item.key.startsWith('claude:local-file:'))?.ownerUserId).not.toBeNull();
    await page.getByRole('button', { name: /数据来源/ }).click();
    await expect(page.getByText('本机单用户模式：', { exact: false })).toContainText('默认归属 admin');
    await expect(page.locator('.source-card').filter({ hasText: 'Claude Code' })).toContainText('已归属 1 个来源');
    await expect(page.getByRole('row', { name: /Claude Code · 文件来源/ })).toHaveCount(0);
    await page.getByRole('button', { name: '查看全部已归属来源' }).click();
    const row = page.getByRole('row', { name: /Claude Code · 文件来源/ }).first();
    await expect(row).toContainText('admin');
    await expect(row.getByRole('combobox')).toHaveCount(0);
    await row.getByRole('button', { name: '管理归属' }).click();
    await expect(row.getByRole('combobox')).toHaveValue(
      (await page.evaluate(() => window.tokenApi.listUsers())).find(item => item.username === 'admin')!.id);
    await expect(page.getByText(/Claude 文件未归属总数 0 个 · 我的待办 0 个/)).toBeVisible();
  } finally { await context.close(); }
});
