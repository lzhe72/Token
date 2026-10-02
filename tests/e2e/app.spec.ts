import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('管理员创建、用户管理与普通用户权限', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'token-e2e-'));
  const packaged = process.env.TOKEN_E2E_EXECUTABLE;
  const executablePath = packaged || (require('electron') as string);
  const app = await electron.launch({
    executablePath,
    args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${userData}`]
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '创建管理员账户' })).toBeVisible();
    await page.getByPlaceholder('例如 lzhe72').fill('owner');
    await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
    await page.getByRole('button', { name: '创建并进入' }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await page.getByRole('button', { name: /用户管理/ }).click();
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
    await page.getByPlaceholder('3–32 位').fill('viewer');
    await page.getByPlaceholder('至少 10 位').fill('viewer-password-123');
    await page.getByRole('button', { name: '创建用户' }).click();
    await expect(page.getByRole('cell', { name: 'viewer' })).toBeVisible();
    await page.getByRole('button', { name: '重设密码' }).last().click();
    await page.getByPlaceholder('新密码至少 10 位').fill('viewer-new-password-123');
    await page.getByRole('button', { name: '保存密码' }).click();
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByPlaceholder('例如 lzhe72').fill('viewer');
    await page.getByPlaceholder('输入密码').fill('viewer-new-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await expect(page.getByRole('button', { name: /用户管理/ })).toHaveCount(0);
    const result = await page.evaluate(async () => {
      try {
        await window.tokenApi.listUsers();
        return 'allowed';
      } catch {
        return 'denied';
      }
    });
    expect(result).toBe('denied');
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});
