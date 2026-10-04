import { expect, test, _electron as electron } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from '../support/test-workspace';

async function launchWithFacts(name: string, facts: Array<{ date: string; tokens: number }>) {
  const workspace = createTestWorkspace(name);
  const lines = [{ type: 'session_meta', payload: { session_id: 'trend-session' } },
    { type: 'turn_context', payload: { turn_id: 'turn-1', model: 'gpt-trend' } },
    ...facts.map((fact, index) => ({ type: 'token_usage_record', timestamp: fact.date,
      payload: { session_id: 'trend-session', turn_id: 'turn-1', response_id: `response-${index}`,
        usage: { input_tokens: fact.tokens, output_tokens: 0, total_tokens: fact.tokens } } }))];
  writeFileSync(path.join(workspace.codexDir, 'trend.jsonl'), lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  const packaged = process.env.TOKEN_E2E_EXECUTABLE;
  const app = await electron.launch({ executablePath: packaged || (require('electron') as string),
    args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${workspace.root}`],
    env: { ...process.env, TOKEN_CODEX_SESSIONS_DIR: workspace.codexDir, TOKEN_CLAUDE_PROJECTS_DIR: workspace.claudeDir } });
  const page = await app.firstWindow();
    await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
  await page.getByRole('button', { name: '创建并进入' }).click();
    await page.getByRole('button', { name: '跳过引导' }).click();
  await page.getByRole('button', { name: /用量报表/ }).first().click();
  return { workspace, app, page };
}

test('TC-048 趋势图宽窄窗口自适应且数值日期不重叠', async () => {
  const context = await launchWithFacts('trend-layout', [
    { date: '2026-09-29T12:00:00Z', tokens: 40_189_102 },
    { date: '2026-09-30T12:00:00Z', tokens: 706_921_639 },
    { date: '2026-10-01T12:00:00Z', tokens: 567_390_453 },
    { date: '2026-10-02T12:00:00Z', tokens: 380_661_797 }
  ]);
  try {
    const { page, app } = context;
    await page.getByLabel('开始日期').fill('2026-09-29');
    await page.getByLabel('结束日期').fill('2026-10-02');
    await expect(page.locator('.bar-column')).toHaveCount(4);
    for (const width of [1180, 860]) {
      await app.evaluate(({ BrowserWindow }, requested) => BrowserWindow.getAllWindows()[0].setSize(requested, 760), width);
      await page.locator('.trend-panel').screenshot({ path: path.join('test-results', `trend-${width}.png`) });
      const boxes = await page.locator('.bar-item').evaluateAll(items => items.map(item => {
        const value = item.querySelector('.bar-value')!.getBoundingClientRect();
        const label = item.querySelector('.bar-label')!.getBoundingClientRect();
        return { value: { left: value.left, right: value.right, bottom: value.bottom },
          label: { left: label.left, right: label.right, top: label.top } };
      }));
      for (let index = 0; index < boxes.length; index++) {
        expect(boxes[index].value.bottom).toBeLessThan(boxes[index].label.top);
        if (index > 0) {
          expect(boxes[index - 1].value.right).toBeLessThanOrEqual(boxes[index].value.left + 1);
          expect(boxes[index - 1].label.right).toBeLessThanOrEqual(boxes[index].label.left + 1);
        }
      }
    }
  } finally { await context.app.close(); context.workspace.cleanup(); }
});

test('TC-049 周横轴显示周一日期月横轴显示年月且下钻一致', async () => {
  const context = await launchWithFacts('trend-periods', [
    { date: '2020-12-31T12:00:00Z', tokens: 10 },
    { date: '2021-01-01T12:00:00Z', tokens: 20 }
  ]);
  try {
    const { page } = context;
    await page.getByLabel('开始日期').fill('2020-12-28');
    await page.getByLabel('结束日期').fill('2021-01-03');
    await page.getByRole('group', { name: '统计维度' }).getByRole('button', { name: '周' }).click();
    await expect(page.locator('.bar-label')).toHaveText(['2020-12-28']);
    await expect(page.locator('.bar-column').first()).toHaveAttribute('aria-label', /2020-12-28/);
    await page.locator('.bar-column').first().click();
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(2);
    await page.getByRole('group', { name: '统计维度' }).getByRole('button', { name: '月' }).click();
    await expect(page.locator('.bar-label')).toHaveText(['2020-12', '2021-01']);
    await page.locator('.bar-column').last().click();
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(1);
    await expect(page.locator('.detail-panel tbody tr').first()).toContainText('20');
  } finally { await context.app.close(); context.workspace.cleanup(); }
});
