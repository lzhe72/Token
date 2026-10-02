import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('管理员备份、恢复后账户回到备份状态', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'token-restore-'));
  const codexDir = path.join(userData, 'codex');
  const claudeDir = path.join(userData, 'claude');
  mkdirSync(codexDir);
  mkdirSync(claudeDir);
  const packaged = process.env.TOKEN_E2E_EXECUTABLE;
  const launch = () => electron.launch({
    executablePath: packaged || (require('electron') as string),
    args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${userData}`],
    env: { ...process.env, TOKEN_CODEX_SESSIONS_DIR: codexDir, TOKEN_CLAUDE_PROJECTS_DIR: claudeDir }
  });
  let app = await launch();
  try {
    const page = await app.firstWindow();
    await page.getByPlaceholder('例如 lzhe72').fill('owner');
    await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
    await page.getByRole('button', { name: '创建并进入' }).click();
    await page.getByRole('button', { name: /数据来源/ }).click();
    const backup = path.join(userData, 'snapshot.sqlite');
    await app.evaluate(({ dialog, app: electronApp }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      electronApp.relaunch = () => {};
    }, backup);
    await page.getByRole('button', { name: '保存备份' }).click();
    await expect.poll(() => existsSync(backup)).toBe(true);
    await page.getByRole('button', { name: /用户管理/ }).click();
    await page.getByPlaceholder('3–32 位').fill('temporary');
    await page.getByPlaceholder('至少 10 位').fill('temporary-password-123');
    await page.getByRole('button', { name: '创建用户' }).click();
    await expect(page.getByRole('cell', { name: 'temporary' })).toBeVisible();
    await page.getByRole('button', { name: /数据来源/ }).click();
    const closed = app.waitForEvent('close');
    await page.getByRole('button', { name: '从备份恢复' }).click();
    await closed;
    expect(existsSync(path.join(userData, 'token.sqlite.before-restore'))).toBe(true);
    app = await launch();
    const reopened = await app.firstWindow();
    await reopened.getByPlaceholder('例如 lzhe72').fill('owner');
    await reopened.getByPlaceholder('输入密码').fill('safe-password-123');
    await reopened.getByRole('button', { name: '登录', exact: true }).click();
    await reopened.getByRole('button', { name: /用户管理/ }).click();
    await expect(reopened.getByRole('cell', { name: 'temporary' })).toHaveCount(0);
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
  }
});
