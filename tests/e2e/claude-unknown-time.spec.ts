import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { AppDatabase } from '../../src/main/database';
import { launchM6 } from './m6-support';

test('TC-086 最近记录时间未知来源不被日期筛选误写为零且可清除日期', async () => {
  const context = await launchM6('tc086-unknown-time');
  let app = context.app;
  try {
    await app.close();
    const db = await AppDatabase.open(context.workspace.databasePath);
    try {
      db.run('INSERT INTO source_identities VALUES (?,?,?,?)',
        [`claude:local-file:${'b'.repeat(24)}`, 'claude', 'Claude Code · 文件来源 bbbbbbbb', null]);
    } finally { db.close(); }
    writeFileSync(path.join(context.workspace.claudeDir, 'known.jsonl'), JSON.stringify({
      type: 'assistant', cwd: '/work/known', timestamp: '2026-10-02T08:00:00Z',
      sessionId: 'known-session', requestId: 'known-request',
      message: { model: 'claude-test', usage: { input_tokens: 7, output_tokens: 0 } }
    }) + '\n');
    const packaged = process.env.TOKEN_E2E_EXECUTABLE;
    app = await electron.launch({ executablePath: packaged || (require('electron') as string),
      args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${context.workspace.root}`],
      env: { ...process.env, TOKEN_TEST_TELEMETRY_PORT: '0',
        TOKEN_CODEX_SESSIONS_DIR: context.workspace.codexDir,
        TOKEN_CLAUDE_PROJECTS_DIR: context.workspace.claudeDir } });
    const page = await app.firstWindow();
    await page.getByPlaceholder('用户名').fill('admin');
    await page.getByPlaceholder('输入密码').fill('safe-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await expect(page.getByText(/筛选命中 2 个 · 最近时间未知 1 个/)).toBeVisible();
    const unknown = page.getByRole('row').filter({ hasText: '文件来源 bbbbbbbb' });
    await expect(unknown).toContainText('时间未知');
    await page.getByLabel('最近记录开始日期').fill('2026-10-01');
    await expect(unknown).toHaveCount(0);
    await expect(page.getByText(/筛选命中 1 个 · 最近时间未知 1 个/)).toBeVisible();
    await expect(page.getByText(/Claude 文件未归属总数 2 个 · 我的待办 2 个/)).toBeVisible();
    await page.getByRole('button', { name: '清除日期条件' }).click();
    await expect(unknown).toBeVisible();
    await expect(page.getByText(/筛选命中 2 个 · 最近时间未知 1 个/)).toBeVisible();
  } finally { await app.close().catch(() => {}); context.workspace.cleanup(); }
});
