import { expect, test, _electron as electron } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from '../support/test-workspace';
import { bindSource } from './m6-support';

test('TC-038 应用扫描后自动上报到独立本机服务', async () => {
  const workspace = createTestWorkspace('upload-e2e');
  writeFileSync(path.join(workspace.codexDir, 'session.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 'upload-session' } }),
    JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-1', model: 'gpt-upload' } }),
    JSON.stringify({ type: 'token_usage_record', timestamp: '2026-10-02T12:00:00Z', payload: {
      session_id: 'upload-session', turn_id: 'turn-1', response_id: 'response-1',
      usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 }
    } })
  ].join('\n') + '\n');
  const packaged = process.env.TOKEN_E2E_EXECUTABLE;
  const app = await electron.launch({ executablePath: packaged || (require('electron') as string),
    args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${workspace.root}`],
    env: { ...process.env, TOKEN_CODEX_SESSIONS_DIR: workspace.codexDir, TOKEN_CLAUDE_PROJECTS_DIR: workspace.claudeDir } });
  try {
    const page = await app.firstWindow();
    await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
    await page.getByRole('button', { name: '创建并进入' }).click();
    await page.getByRole('button', { name: '跳过引导' }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await page.screenshot({ path: path.join('test-results', 'overview.png'), fullPage: true });
    await page.getByRole('button', { name: /系统设置/ }).click();
    await expect(page.getByRole('heading', { name: '服务器与自动上报' })).toBeVisible();
    const status = await page.evaluate(() => window.tokenApi.getServerStatus());
    expect(status.online).toBe(true);
    expect(status.url).toContain('127.0.0.1');
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await bindSource(page, /Codex · 本机账户/, 'admin');
    await page.getByRole('button', { name: '立即扫描' }).click();
    await expect.poll(() => readFileSync(path.join(workspace.root, 'server', 'server.sqlite')).includes(Buffer.from('gpt-upload'))).toBe(true);
    await expect.poll(async () => (await page.evaluate(() => window.tokenApi.getUploadStatus())).lastSuccess).not.toBeNull();
    const info = JSON.parse(readFileSync(path.join(workspace.root, 'server', 'server-port.json'), 'utf8')) as { port: number };
    const response = await fetch(`http://127.0.0.1:${info.port}/health`);
    expect(response.ok).toBe(true);
    const bytes = readFileSync(path.join(workspace.root, 'server', 'server.sqlite'));
    expect(bytes.includes(Buffer.from('upload-session'))).toBe(false);
  } finally { await app.close(); workspace.cleanup(); }
});
