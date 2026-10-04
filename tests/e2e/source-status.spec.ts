import { test, expect, _electron as electron } from '@playwright/test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from '../support/test-workspace';

test('工具目录缺失、无权限和空目录有清晰状态', async () => {
  const workspace = createTestWorkspace('status');
  const userData = workspace.root;
  const codexDir = path.join(userData, 'codex-missing');
  const claudeDir = workspace.claudeDir;
  const unreadable = path.join(claudeDir, 'session.jsonl');
  writeFileSync(unreadable, '{}\n');
  chmodSync(unreadable, 0o000);
  const packaged = process.env.TOKEN_E2E_EXECUTABLE;
  const app = await electron.launch({
    executablePath: packaged || (require('electron') as string),
    args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${userData}`],
    env: { ...process.env, TOKEN_CODEX_SESSIONS_DIR: codexDir, TOKEN_CLAUDE_PROJECTS_DIR: claudeDir }
  }).catch(error => { workspace.cleanup(); throw error; });
  try {
    const page = await app.firstWindow();
        await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
    await page.getByRole('button', { name: '创建并进入' }).click();
    await page.getByRole('button', { name: '跳过引导' }).click();
    await page.getByRole('button', { name: /数据来源/ }).click();
    const sources = page.locator('.source-grid .source-card');
    await expect(sources.nth(0).locator('.status-pill')).toHaveText('未找到');
    await expect(sources.nth(1).locator('.status-pill')).toHaveText('需要检查');
    await expect(sources.nth(1)).toContainText('文件读取失败');
    mkdirSync(codexDir);
    await page.getByRole('button', { name: '立即扫描' }).click();
    await expect(sources.nth(0).locator('.status-pill')).toHaveText('暂无记录');
  } finally {
    await app.close().catch(() => {});
    chmodSync(unreadable, 0o600);
    workspace.cleanup();
  }
});
