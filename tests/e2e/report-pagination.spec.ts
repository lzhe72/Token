import { expect, test, _electron as electron } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from '../support/test-workspace';

test('TC-021 报表明细可翻到第二页且切换模型重置页码', async () => {
  const workspace = createTestWorkspace('tc021-e2e');
  const lines: unknown[] = [
    { type: 'session_meta', payload: { session_id: 'pagination-session' } },
    { type: 'turn_context', payload: { turn_id: 'pagination-turn', model: 'gpt-first' } }
  ];
  for (let index = 0; index < 61; index++) {
    if (index === 51) lines.push({ type: 'turn_context', payload: { turn_id: 'pagination-turn', model: 'gpt-second' } });
    lines.push({ type: 'token_usage_record', timestamp: new Date(Date.parse('2026-10-02T00:00:00Z') + index * 1000).toISOString(),
      payload: { session_id: 'pagination-session', turn_id: 'pagination-turn', response_id: `response-${index}`,
        usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } });
  }
  const packaged = process.env.TOKEN_E2E_EXECUTABLE;
  let app: Awaited<ReturnType<typeof electron.launch>> | null = null;
  try {
    writeFileSync(path.join(workspace.codexDir, 'pagination.jsonl'), lines.map(line => JSON.stringify(line)).join('\n') + '\n');
    app = await electron.launch({ executablePath: packaged || (require('electron') as string),
      args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${workspace.root}`],
      env: { ...process.env, TOKEN_CODEX_SESSIONS_DIR: workspace.codexDir, TOKEN_CLAUDE_PROJECTS_DIR: workspace.claudeDir } });
    const page = await app.firstWindow();
    await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
    await page.getByRole('button', { name: '创建并进入' }).click();
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await page.getByLabel('开始日期').fill('2026-10-02');
    await page.getByLabel('结束日期').fill('2026-10-02');
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('61');
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(50);
    await expect(page.locator('.detail-pager')).toContainText('1 / 2');
    await page.locator('.detail-pager').getByRole('button', { name: '下一页' }).click();
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(11);
    await expect(page.locator('.detail-pager')).toContainText('2 / 2');
    await page.getByLabel('模型筛选').selectOption({ label: 'Codex · gpt-second' });
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('10');
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(10);
    await expect(page.locator('.detail-pager')).toHaveCount(0);
  } finally {
    await app?.close().catch(() => {});
    workspace.cleanup();
  }
});
