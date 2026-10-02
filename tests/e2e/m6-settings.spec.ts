import { expect, test } from '@playwright/test';
import { createViewer, launchM6, loginViewer } from './m6-support';

test('TC-060 设置分组完整且普通用户修改接口被拒绝', async () => {
  const context = await launchM6('tc060');
  try {
    const { page } = context;
    await page.getByRole('button', { name: /系统设置/ }).click();
    for (const heading of ['应用更新', '文件访问权限', '服务器与自动上报', '可选遥测接入', '数据备份与恢复']) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
    await createViewer(page);
    await loginViewer(page);
    await page.getByRole('button', { name: /系统设置/ }).click();
    await expect(page.getByRole('heading', { name: '应用更新' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '文件访问权限' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '服务器与自动上报' })).toHaveCount(0);
    const attempts = await page.evaluate(async () => Promise.allSettled([
      window.tokenApi.configureServer('http://127.0.0.1:1', '', ''), window.tokenApi.backupDatabase(), window.tokenApi.downloadUpdate()
    ]));
    expect(attempts.map(item => item.status)).toEqual(['rejected', 'rejected', 'rejected']);
  } finally { await context.close(); }
});

test('TC-061 缺少目录时诊断引导权限设置和重新扫描', async () => {
  const context = await launchM6('tc061', { missingCodex: true });
  try {
    const { page } = context;
    await page.getByRole('button', { name: /采集诊断/ }).click();
    await expect(page.getByText('目录未找到')).toBeVisible();
    await expect(page.getByRole('button', { name: '系统权限设置' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重新扫描并诊断' })).toBeVisible();
    await page.getByRole('button', { name: /系统设置/ }).click();
    await expect(page.getByText(/完全磁盘访问权限/)).toBeVisible();
    await expect(page.getByRole('button', { name: '打开系统权限设置' })).toBeVisible();
  } finally { await context.close(); }
});
