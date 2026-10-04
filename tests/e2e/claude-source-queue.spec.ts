import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { createTestWorkspace } from '../support/test-workspace';

test('TC-086 Claude 文件待归属分页、逐项预览与暂不归属不改授权', async () => {
  const workspace = createTestWorkspace('tc086-claude-queue');
  for (let index = 0; index < 25; index++) {
    writeFileSync(path.join(workspace.claudeDir, `session-${index}.jsonl`), JSON.stringify({
      type: 'assistant', cwd: index === 1 || index === 2 ? `/tenant-${index}/work/shared` : `/work/project-${index}`,
      timestamp: index === 0 ? '2026-09-20T08:00:00Z' :
        index === 1 ? '2026-10-01T08:00:00Z' : index === 2 ? '2026-10-03T08:00:00Z' : '2026-10-02T08:00:00Z',
      sessionId: `session-${index}`, requestId: 'request-1',
      message: { model: 'claude-test', usage: { input_tokens: index + 1, output_tokens: 0 } }
    }) + '\n');
  }
  const packaged = process.env.TOKEN_E2E_EXECUTABLE;
  const app = await electron.launch({ executablePath: packaged || (require('electron') as string),
    args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${workspace.root}`],
    env: { ...process.env, TOKEN_CODEX_SESSIONS_DIR: workspace.codexDir,
      TOKEN_CLAUDE_PROJECTS_DIR: workspace.claudeDir } });
  try {
    const page = await app.firstWindow();
    await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
    await page.getByRole('button', { name: '创建并进入' }).click();
    await page.getByRole('button', { name: '跳过引导' }).click();
    await page.getByRole('button', { name: /管理中心/ }).click();
    await page.getByPlaceholder('3–32 位').fill('viewer');
    await page.getByPlaceholder('至少 10 位').fill('viewer-password-123');
    await page.getByRole('button', { name: '创建用户' }).click();
    await expect(page.getByRole('row', { name: /viewer/ })).toContainText('普通用户');
    await page.getByPlaceholder('3–32 位').fill('manager');
    await page.getByPlaceholder('至少 10 位').fill('manager-password-123');
    await page.getByRole('combobox', { name: '角色' }).selectOption('admin');
    await page.getByRole('button', { name: '创建用户' }).click();
    await expect(page.getByRole('row', { name: /manager/ })).toContainText('管理员');
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await expect(page.getByText(/Claude 文件未归属总数 25 个 · 我的待办 25 个/)).toBeVisible();
    await expect(page.getByText('文件本身不能证明账号', { exact: false })).toBeVisible();
    const rows = page.getByRole('row').filter({ hasText: /Claude Code · 文件来源/ });
    await expect(rows).toHaveCount(20);
    await page.getByLabel('来源项目筛选').selectOption({ label: 'shared · work' });
    await expect(rows).toHaveCount(2);
    expect((await page.evaluate(() => window.tokenApi.getSourceIdentities()))
      .filter(item => item.projectLabel === 'shared · work').map(item => item.key)).toHaveLength(2);
    await expect(rows.first()).toContainText('项目 shared · work');
    await page.getByLabel('最近记录开始日期').fill('2026-09-01');
    await page.getByLabel('最近记录结束日期').fill('2026-09-02');
    await expect(rows).toHaveCount(0);
    await expect(page.locator('.empty-row')).toContainText('当前筛选下没有来源');
    await page.locator('.empty-row').getByRole('button', { name: '清除来源筛选' }).click();
    await expect(rows).toHaveCount(20);
    await page.getByLabel('最近记录开始日期').fill('2026-10-01');
    await page.getByLabel('最近记录结束日期').fill('2026-10-03');
    await expect(rows).toHaveCount(20);
    await page.getByLabel('来源项目筛选').selectOption({ label: 'shared · work' });
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('最近时间');
    await page.getByLabel('来源项目筛选').selectOption('');
    await page.getByRole('button', { name: '下一页' }).click();
    await expect(rows).toHaveCount(4);
    await page.getByLabel('最近记录开始日期').fill('2026-10-04');
    await expect(page.getByRole('alert')).toContainText('开始日期不能晚于结束日期');
    await expect(rows).toHaveCount(4);
    await expect(page.getByText(/筛选命中 24 个 · 最近时间未知 0 个/)).toBeVisible();
    await page.getByRole('button', { name: '清除日期条件' }).click();
    await expect(rows).toHaveCount(20);
    await expect(page.getByText(/筛选命中 25 个 · 最近时间未知 0 个/)).toBeVisible();
    await page.getByRole('button', { name: '下一页' }).click();
    await expect(rows).toHaveCount(5);
    await expect(page.getByText('第 2 / 2 页')).toBeVisible();
    const source = rows.first();
    await expect(source).toContainText('项目');
    await expect(source).toContainText('最近');
    await source.getByRole('combobox').selectOption({ label: 'viewer' });
    await source.getByRole('button', { name: '预览变更' }).click();
    await expect(page.getByRole('dialog')).toContainText('文件来源，不代表已验证 Claude 账号');
    await expect(page.getByRole('dialog')).toContainText('项目：');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('管理员人工核对记录');
    await dialog.getByRole('button', { name: '确认变更' }).click();
    await expect(dialog).toContainText('证据编号须为');
    await expect(dialog.getByRole('textbox', { name: '外部登记证据编号' })).toBeFocused();
    await expect(dialog.locator('#binding-evidence-ref-help')).toContainText('证据编号须为 evr_');
    const evidenceInput = dialog.getByLabel('外部登记证据编号');
    await evidenceInput.fill('evr_wrong');
    await expect(evidenceInput).toHaveAttribute('aria-invalid', 'true');
    await dialog.getByRole('button', { name: '确认变更' }).click();
    await expect(dialog).toContainText('证据编号须为');
    await expect(evidenceInput).toBeFocused();
    await expect(evidenceInput).toHaveValue('evr_wrong');
    await evidenceInput.fill(`evr_${'a'.repeat(32)}`);
    await dialog.getByRole('button', { name: '确认变更' }).click();
    await expect(dialog).toContainText('请确认已在外部受管登记中人工核对');
    await expect(dialog.getByLabel('我已在外部受管登记中人工核对账户与文件映射')).toBeFocused();
    await dialog.getByLabel('我已在外部受管登记中人工核对账户与文件映射').check();
    await expect(dialog.getByRole('button', { name: '确认变更' })).toBeEnabled();
    const rejected = await page.evaluate(async () => {
      const identity = (await window.tokenApi.getSourceIdentities()).find(item => item.key.startsWith('claude:local-file:'))!;
      const viewer = (await window.tokenApi.listUsers()).find(item => item.username === 'viewer')!;
      const preview = await window.tokenApi.previewSourceBinding(identity.key, viewer.id, {
        from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
        provider: 'claude', model: '', projectKey: '', userId: 'all'
      });
      const rejected = await window.tokenApi.confirmSourceBinding(preview.id, {
        evidenceCategory: 'controlled_account_file_mapping', evidenceSource: 'external_managed_registry',
        evidenceRef: '/private/work/secret', evidenceReviewed: true
      });
      await window.tokenApi.cancelSourceBinding(preview.id);
      return rejected;
    });
    expect(rejected).toMatchObject({ localCommitted: false, validationError: { field: 'evidenceRef' } });
    await expect(dialog.getByRole('button', { name: '确认变更' })).toBeEnabled();
    await dialog.getByRole('button', { name: '确认变更' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(/Claude 文件未归属总数 24 个 · 我的待办 24 个/)).toBeVisible();
    await rows.filter({ has: page.getByRole('button', { name: '暂不归属' }) }).first()
      .getByRole('button', { name: '暂不归属' }).click();
    await expect(page.getByText(/Claude 文件未归属总数 24 个 · 我的待办 23 个/)).toBeVisible();
    await expect(page.getByText('第 1 / 2 页')).toBeVisible();
    await page.getByLabel('来源状态筛选').selectOption('deferred');
    await expect(rows).toHaveCount(1);
    const deferredContext = await page.evaluate(async () => {
      const key = (await window.tokenApi.getDeferredSourceKeys())[0];
      const item = (await window.tokenApi.getSourceIdentities()).find(source => source.key === key)!;
      const date = new Date(item.lastRecordAt!);
      return { project: item.projectLabel!, day: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` };
    });
    await page.getByLabel('来源项目筛选').selectOption(deferredContext.project);
    await page.getByLabel('最近记录开始日期').fill(deferredContext.day);
    await page.getByLabel('最近记录结束日期').fill(deferredContext.day);
    await expect(rows).toHaveCount(1);
    await expect(page.getByText(/筛选命中 1 个/)).toBeVisible();
    await page.getByLabel('最近记录开始日期').fill('2026-11-01');
    await page.getByLabel('最近记录结束日期').fill('2026-11-30');
    await expect(rows).toHaveCount(0);
    await expect(page.getByText(/Claude 文件未归属总数 24 个 · 我的待办 23 个 · 筛选命中 0 个/)).toBeVisible();
    await page.getByRole('button', { name: '清除日期条件' }).click();
    await expect(rows).toHaveCount(1);
    const identities = await page.evaluate(() => window.tokenApi.getSourceIdentities());
    expect(identities.filter(item => item.key.startsWith('claude:local-file:') && item.ownerUserId)).toHaveLength(1);
    await page.reload();
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByLabel('来源状态筛选').selectOption('deferred');
    await expect(page.getByRole('row').filter({ hasText: /Claude Code · 文件来源/ })).toHaveCount(1);
    await page.getByLabel('来源状态筛选').selectOption('all');
    await page.getByRole('button', { name: '下一页' }).click();
    await expect(page.getByText('第 2 / 2 页')).toBeVisible();
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByPlaceholder('用户名').fill('manager');
    await page.getByPlaceholder('输入密码').fill('manager-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.sidebar-bottom')).toContainText('manager');
    await page.getByRole('button', { name: /数据来源/ }).click();
    await expect(page.getByText('第 1 / 2 页')).toBeVisible();
    await expect(page.getByText(/Claude 文件未归属总数 24 个 · 我的待办 24 个/)).toBeVisible();
    expect(await page.evaluate(() => window.tokenApi.getDeferredSourceKeys())).toHaveLength(0);
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByPlaceholder('用户名').fill('admin');
    await page.getByPlaceholder('输入密码').fill('safe-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: /数据来源/ }).click();
    await expect(page.getByText('第 1 / 2 页')).toBeVisible();
    await expect(page.getByText(/Claude 文件未归属总数 24 个 · 我的待办 23 个/)).toBeVisible();
  } finally { await app.close(); workspace.cleanup(); }
});
