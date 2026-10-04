import { _electron as electron, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from '../support/test-workspace';

export function writeUsage(dir: string, session: string, cwd: string, model: string, tokens: number,
  timestamp = '2026-10-02T00:00:00Z') {
  writeFileSync(path.join(dir, `${session}.jsonl`), [
    { type: 'session_meta', payload: { session_id: session, cwd } },
    { type: 'turn_context', payload: { turn_id: 't', model } },
    { type: 'token_usage_record', timestamp, payload: {
      session_id: session, turn_id: 't', response_id: 'r', usage: { input_tokens: tokens, output_tokens: 0, total_tokens: tokens }
    } }
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
}

export async function launchM6(label: string, options: { usage?: boolean; missingCodex?: boolean;
  usageDate?: string; sameModel?: boolean; extraRecords?: number; scanDelayMs?: number;
  managedBinary?: string; singleUserDefault?: boolean; stayOnboarding?: boolean } = {}) {
  const workspace = createTestWorkspace(label);
  if (options.sameModel) {
    const timestamp = options.usageDate || '2026-10-02T00:00:00Z';
    writeUsage(workspace.codexDir, 'one', '/work/alpha', 'shared-model', 12, timestamp);
    writeFileSync(path.join(workspace.claudeDir, 'shared.jsonl'), JSON.stringify({ type: 'assistant', timestamp,
      sessionId: 'claude-shared', requestId: 'response', message: { model: 'shared-model',
        usage: { input_tokens: 30, output_tokens: 0 } } }) + '\n');
  } else if (options.usage) {
    writeUsage(workspace.codexDir, 'one', '/work/alpha', 'gpt-alpha', 12, options.usageDate);
    writeUsage(workspace.codexDir, 'two', '/work/beta', 'gpt-beta', 30, options.usageDate);
    for (let index = 0; index < (options.extraRecords || 0); index++) {
      writeUsage(workspace.codexDir, `extra-${index}`, '/work/alpha', 'gpt-alpha', 1, options.usageDate);
    }
  }
  const packaged = process.env.TOKEN_E2E_EXECUTABLE;
  const app = await electron.launch({ executablePath: packaged || (require('electron') as string),
    args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${workspace.root}`],
    env: { ...process.env, TOKEN_TEST_TELEMETRY_PORT: '0',
      TOKEN_TEST_SINGLE_USER_DEFAULT: options.singleUserDefault ? '1' : '0',
      TOKEN_E2E_SCAN_DELAY_MS: String(options.scanDelayMs || 0),
      TOKEN_TEST_MANAGED_CODEX_BINARY: options.managedBinary || '',
      TOKEN_CODEX_SESSIONS_DIR: options.missingCodex ? path.join(workspace.root, 'missing-codex') : workspace.codexDir,
      TOKEN_CLAUDE_PROJECTS_DIR: workspace.claudeDir } });
  const page = await app.firstWindow();
  await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
  await page.getByRole('button', { name: '创建并进入' }).click();
  await expect(page.getByRole('heading', { name: '首次使用引导' })).toBeVisible();
  if (!options.stayOnboarding) await page.getByRole('button', { name: /^(跳过引导|完成引导)$/ }).click();
  if (!options.stayOnboarding) await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
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

export async function bindSource(page: Page, source: RegExp, userLabel: string): Promise<void> {
  await expect(page.getByRole('button', { name: '立即扫描', exact: true })).toBeEnabled();
  await expect.poll(async () => (await page.evaluate(() => window.tokenApi.getScanProgress())).length).toBe(0);
  const row = page.getByRole('row', { name: source });
  await row.getByRole('combobox').selectOption({ label: userLabel });
  await row.getByRole('button', { name: '预览变更' }).click();
  const dialog = page.getByRole('dialog', { name: '确认来源归属变更' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '确认变更' }).click();
  await expect(dialog).toHaveCount(0);
}
