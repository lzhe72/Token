import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from '../support/test-workspace';
import { launchM6 } from './m6-support';

test('TC-084 受管结果仅当前登录窗口暂存且不进入持久数据库', async () => {
  const binaryWorkspace = createTestWorkspace('tc084-managed-cli');
  const reply = 'SYNTHETIC_TRANSIENT_REPLY_9834';
  const lateReply = 'SYNTHETIC_LATE_REPLY_5150';
  const prompt = 'SYNTHETIC_TRANSIENT_PROMPT_4912';
  const binary = path.join(binaryWorkspace.root, 'synthetic-codex');
  fs.writeFileSync(binary, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo synthetic-1.0; exit 0; fi\ncat >/dev/null\nprintf '%s\\n' '${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: reply } })}'\nprintf '%s\\n' '${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 1 } })}'\n`, { mode: 0o700 });
  const context = await launchM6('tc084-managed-privacy', { managedBinary: binary });
  let reopened: Awaited<ReturnType<typeof electron.launch>> | null = null;
  try {
    const { page } = context;
    await page.getByRole('button', { name: /系统设置/ }).click();
    await page.getByRole('button', { name: 'Codex：未启用 · 点击开启' }).click();
    const selectedDirectory = fs.realpathSync(context.workspace.root);
    await context.app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, selectedDirectory);
    await page.getByRole('button', { name: '选择工作目录' }).click();
    await expect(page.getByLabel('受管工作目录')).toHaveValue(selectedDirectory);
    await page.getByLabel('受管任务').fill(prompt);
    await page.getByRole('button', { name: '启动受管命令' }).click();
    await page.getByText('查看本次结果（仅当前应用会话）').click();
    await expect(page.getByText(reply)).toBeVisible();
    await expect.poll(async () => (await page.evaluate(() => window.tokenApi.getManagedStatus())).runs[0]?.status).toBe('completed');
    const before = fs.readFileSync(context.workspace.databasePath).toString('utf8');
    expect(before).not.toContain(reply);
    expect(before).not.toContain(prompt);
    await page.evaluate(() => window.tokenApi.submitFeedback('other', '合成反馈', '不含命令结果', true,
      '00000000-0000-4000-8000-000000000084'));
    const allFiles = (directory: string): string[] => fs.readdirSync(directory).flatMap(name => {
      const item = path.join(directory, name);
      const entry = fs.lstatSync(item);
      return entry.isDirectory() ? allFiles(item) : entry.isFile() ? [item] : [];
    });
    for (const file of allFiles(context.workspace.root)) {
      const content = fs.readFileSync(file).toString('utf8');
      expect(content).not.toContain(reply);
      expect(content).not.toContain(prompt);
    }
    fs.writeFileSync(binary, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo synthetic-1.0; exit 0; fi\ncat >/dev/null\nsleep 2\nprintf '%s\\n' '${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: lateReply } })}'\nprintf '%s\\n' '${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 1 } })}'\n`, { mode: 0o700 });
    await page.getByLabel('受管任务').fill('synthetic late task');
    await page.getByRole('button', { name: '启动受管命令' }).click();
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByPlaceholder('用户名').fill('admin');
    await page.getByPlaceholder('输入密码').fill('safe-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await page.getByRole('button', { name: /系统设置/ }).click();
    await expect(page.getByText(reply)).toHaveCount(0);
    const status = await page.evaluate(() => window.tokenApi.getManagedStatus());
    await expect.poll(async () => (await page.evaluate(() => window.tokenApi.getManagedStatus())).runs[0]?.status).toBe('completed');
    const final = await page.evaluate(() => window.tokenApi.getManagedStatus());
    expect(final.runs[0]).toMatchObject({ status: 'completed', result: null });
    expect(final.runs[1]).toMatchObject({ status: 'completed', result: null });
    await expect(page.getByText(lateReply)).toHaveCount(0);
    expect(status.coverage).toBe('unknown');
    await context.app.close();
    const packaged = process.env.TOKEN_E2E_EXECUTABLE;
    reopened = await electron.launch({ executablePath: packaged || (require('electron') as string),
      args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${context.workspace.root}`],
      env: { ...process.env, TOKEN_TEST_TELEMETRY_PORT: '0', TOKEN_TEST_MANAGED_CODEX_BINARY: binary,
        TOKEN_CODEX_SESSIONS_DIR: context.workspace.codexDir, TOKEN_CLAUDE_PROJECTS_DIR: context.workspace.claudeDir } });
    const again = await reopened.firstWindow();
    await again.getByPlaceholder('用户名').fill('admin');
    await again.getByPlaceholder('输入密码').fill('safe-password-123');
    await again.getByRole('button', { name: '登录', exact: true }).click();
    await expect(again.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await again.getByRole('button', { name: /系统设置/ }).click();
    const afterRestart = await again.evaluate(() => window.tokenApi.getManagedStatus());
    expect(afterRestart.runs[0].result).toBeNull();
    expect(afterRestart.coverage).toBe('unknown');
  } finally { await reopened?.close().catch(() => {}); await context.close(); binaryWorkspace.cleanup(); }
});
