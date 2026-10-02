import { _electron as electron, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from '../support/test-workspace';

export function writeUsage(dir: string, session: string, cwd: string, model: string, tokens: number) {
  writeFileSync(path.join(dir, `${session}.jsonl`), [
    { type: 'session_meta', payload: { session_id: session, cwd } },
    { type: 'turn_context', payload: { turn_id: 't', model } },
    { type: 'token_usage_record', timestamp: '2026-10-02T00:00:00Z', payload: {
      session_id: session, turn_id: 't', response_id: 'r', usage: { input_tokens: tokens, output_tokens: 0, total_tokens: tokens }
    } }
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
}

export async function launchM6(label: string, options: { usage?: boolean; missingCodex?: boolean } = {}) {
  const workspace = createTestWorkspace(label);
  if (options.usage) {
    writeUsage(workspace.codexDir, 'one', '/work/alpha', 'gpt-alpha', 12);
    writeUsage(workspace.codexDir, 'two', '/work/beta', 'gpt-beta', 30);
  }
  const packaged = process.env.TOKEN_E2E_EXECUTABLE;
  const app = await electron.launch({ executablePath: packaged || (require('electron') as string),
    args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${workspace.root}`],
    env: { ...process.env,
      TOKEN_CODEX_SESSIONS_DIR: options.missingCodex ? path.join(workspace.root, 'missing-codex') : workspace.codexDir,
      TOKEN_CLAUDE_PROJECTS_DIR: workspace.claudeDir } });
  const page = await app.firstWindow();
  await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
  await page.getByRole('button', { name: '创建并进入' }).click();
  await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
  return { workspace, app, page, close: async () => { await app.close().catch(() => {}); workspace.cleanup(); } };
}

export async function createViewer(page: Awaited<ReturnType<typeof launchM6>>['page']) {
  await page.getByRole('button', { name: /管理中心/ }).click();
  await page.getByPlaceholder('3–32 位').fill('viewer');
  await page.getByPlaceholder('至少 10 位').fill('viewer-password-123');
  await page.getByRole('button', { name: '创建用户' }).click();
  await expect(page.getByRole('cell', { name: 'viewer' })).toBeVisible();
}

export async function loginViewer(page: Awaited<ReturnType<typeof launchM6>>['page']) {
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByPlaceholder('用户名').fill('viewer');
  await page.getByPlaceholder('输入密码').fill('viewer-password-123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
}
