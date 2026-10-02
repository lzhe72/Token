import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from '../support/test-workspace';

test('管理员创建、用户管理与普通用户权限', async () => {
  const workspace = createTestWorkspace('app');
  const userData = workspace.root;
  const { codexDir, claudeDir } = workspace;
  writeFileSync(path.join(codexDir, 'session.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 'test-session' } }),
    JSON.stringify({ type: 'turn_context', payload: { turn_id: 'turn-1', model: 'gpt-test' } }),
    JSON.stringify({ type: 'token_usage_record', timestamp: '2026-01-01T12:00:00Z', payload: { session_id: 'test-session', turn_id: 'turn-1', response_id: 'response-1', usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } })
  ].join('\n') + '\n');
  writeFileSync(path.join(claudeDir, 'session.jsonl'), JSON.stringify({
    type: 'assistant', timestamp: '2026-01-01T13:00:00Z', sessionId: 'claude-session', requestId: 'request-1',
    message: { id: 'message-1', model: 'claude-test', usage: { input_tokens: 1, output_tokens: 3, cache_read_input_tokens: 8, cache_creation_input_tokens: 2 } }
  }) + '\n');
  const packaged = process.env.TOKEN_E2E_EXECUTABLE;
  const executablePath = packaged || (require('electron') as string);
  const launch = () => electron.launch({
    executablePath,
    args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${userData}`],
    env: { ...process.env, TOKEN_CODEX_SESSIONS_DIR: codexDir, TOKEN_CLAUDE_PROJECTS_DIR: claudeDir }
  });
  let app = await launch().catch(error => { workspace.cleanup(); throw error; });
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
    await page.getByRole('button', { name: /数据来源/ }).click();
    await expect(page.getByRole('heading', { name: '数据来源' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '可选遥测接入' })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存备份' })).toBeVisible();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await expect(page.getByRole('cell', { name: 'Codex · 本机账户' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Claude Code · 本机账户' })).toBeVisible();
    const viewerId = await page.evaluate(async () => (await window.tokenApi.listUsers()).find(user => user.username === 'viewer')?.id);
    await page.getByRole('row', { name: /Codex · 本机账户/ }).getByRole('combobox').selectOption({ label: 'viewer' });
    await expect(page.getByRole('row', { name: /Codex · 本机账户/ }).getByRole('combobox')).toHaveValue(viewerId || '');
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await page.getByLabel('开始日期').fill('2026-01-01');
    await page.getByLabel('结束日期').fill('2026-01-02');
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('26');
    await expect(page.locator('.model-panel').getByText('claude-test')).toBeVisible();
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(2);
    await page.getByRole('button', { name: '查看 2026-01-01 用量明细' }).click();
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(2);
    const csvFile = path.join(userData, 'usage.csv');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, csvFile);
    await page.getByRole('button', { name: '导出 CSV' }).click();
    await expect.poll(() => existsSync(csvFile)).toBe(true);
    const csv = readFileSync(csvFile, 'utf8');
    expect(csv).toContain('gpt-test');
    expect(csv).toContain('claude-test');
    expect(csv).toContain(',12,1');
    expect(csv).toContain(',14,1');
    await page.locator('.model-panel').getByRole('button', { name: 'claude-test' }).click();
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(1);
    await expect(page.locator('.detail-panel tbody tr').first()).toContainText('14');
    await page.getByRole('button', { name: /用户管理/ }).click();
    await page.getByRole('button', { name: '重设密码' }).last().click();
    await page.getByPlaceholder('新密码至少 10 位').fill('viewer-new-password-123');
    await page.getByRole('button', { name: '保存密码' }).click();
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByPlaceholder('例如 lzhe72').fill('viewer');
    await page.getByPlaceholder('输入密码').fill('viewer-new-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await expect(page.getByRole('button', { name: /用户管理/ })).toHaveCount(0);
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await page.getByLabel('开始日期').fill('2026-01-01');
    await page.getByLabel('结束日期').fill('2026-01-02');
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('12');
    await expect(page.locator('.model-panel').getByText('gpt-test')).toBeVisible();
    await expect(page.locator('.model-panel').getByText('claude-test')).toHaveCount(0);
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(1);
    const results = await page.evaluate(async () => Promise.allSettled([
      window.tokenApi.listUsers(), window.tokenApi.getTelemetryConfiguration(), window.tokenApi.backupDatabase()
    ]));
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
    await app.close();
    app = await launch();
    const reopened = await app.firstWindow();
    await expect(reopened.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
    await reopened.getByPlaceholder('例如 lzhe72').fill('owner');
    await reopened.getByPlaceholder('输入密码').fill('safe-password-123');
    await reopened.getByRole('button', { name: '登录', exact: true }).click();
    await reopened.getByRole('button', { name: /数据来源/ }).click();
    await reopened.getByRole('button', { name: '立即扫描' }).click();
    await reopened.getByRole('button', { name: /用量报表/ }).first().click();
    await reopened.getByLabel('开始日期').fill('2026-01-01');
    await reopened.getByLabel('结束日期').fill('2026-01-02');
    await expect(reopened.locator('.metric-card').first().locator('strong')).toHaveText('26');
  } finally {
    await app.close().catch(() => {});
    workspace.cleanup();
  }
});
