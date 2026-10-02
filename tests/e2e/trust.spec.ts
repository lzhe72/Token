import { expect, test, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { createTestWorkspace } from '../support/test-workspace';

test('TC-030 应用重启自动登录并在退出后撤销', async () => {
  const workspace = createTestWorkspace('trust-e2e');
  const packaged = process.env.TOKEN_E2E_EXECUTABLE;
  const launch = () => electron.launch({ executablePath: packaged || (require('electron') as string),
    args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${workspace.root}`],
    env: { ...process.env, TOKEN_CODEX_SESSIONS_DIR: workspace.codexDir, TOKEN_CLAUDE_PROJECTS_DIR: workspace.claudeDir } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
        await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
    await page.getByRole('checkbox', { name: /信任此设备/ }).check();
    await page.getByRole('button', { name: '创建并进入' }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  } finally { await app.close().catch(() => {}); workspace.cleanup(); }
});
