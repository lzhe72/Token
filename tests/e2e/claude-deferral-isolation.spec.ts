import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { AppDatabase } from '../../src/main/database';
import { launchM6 } from './m6-support';

test('TC-086 Claude 暂缓按管理员隔离并在切换重启后保留且不修改归属上报', async () => {
  const context = await launchM6('tc086-deferral-isolation');
  let app = context.app;
  const { workspace } = context;
  try {
    let page = context.page;
    const login = async (name: string, password: string) => {
      await page.getByRole('button', { name: '退出登录' }).click();
      await page.getByPlaceholder('用户名').fill(name);
      await page.getByPlaceholder('输入密码').fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    };
    for (const [name, role] of [['manager', 'admin'], ['viewer-a', 'viewer'], ['viewer-b', 'viewer']] as const) {
      await page.getByRole('button', { name: /管理中心/ }).click();
      await page.getByPlaceholder('3–32 位').fill(name);
      await page.getByPlaceholder('至少 10 位').fill(`${name}-password-123`);
      await page.getByRole('combobox', { name: '角色' }).selectOption(role);
      await page.getByRole('button', { name: '创建用户' }).click();
      await expect(page.getByRole('row', { name: new RegExp(name) }))
        .toContainText(role === 'admin' ? '管理员' : '普通用户');
    }
    for (const name of ['alpha', 'beta']) writeFileSync(path.join(workspace.claudeDir, `${name}.jsonl`),
      JSON.stringify({ type: 'assistant', cwd: `/work/${name}`, timestamp: '2026-10-02T08:00:00Z',
        sessionId: `session-${name}`, requestId: 'request-1',
        message: { model: 'claude-test', usage: { input_tokens: 11, output_tokens: 0 } } }) + '\n');
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await expect(page.getByText(/Claude 文件未归属总数 2 个 · 我的待办 2 个/)).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '项目 alpha' })).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.tokenApi.getUploadStatus().then(status => status.currentConfirmed))).toBe(true);
    const baselineRevision = (await page.evaluate(() => window.tokenApi.getUploadStatus())).localRevision;
    const baseline = await readState();
    await login('viewer-a', 'viewer-a-password-123');
    const viewerStatuses = await page.evaluate(() => window.tokenApi.getSourceStatuses());
    await login('admin', 'safe-password-123');
    await page.getByRole('button', { name: /数据来源/ }).click();
    await expect(page.getByText(/Claude 文件未归属总数 2 个 · 我的待办 2 个/)).toBeVisible();
    const alpha = page.getByRole('row').filter({ hasText: '项目 alpha' });
    await alpha.getByRole('button', { name: '暂不归属' }).click();
    await expect(page.getByText(/Claude 文件未归属总数 2 个 · 我的待办 1 个/)).toBeVisible();
    await page.getByLabel('来源状态筛选').selectOption('deferred');
    await expect(page.getByRole('row').filter({ hasText: '项目 alpha' })).toHaveCount(1);
    await expect(page.getByRole('row').filter({ hasText: '项目 beta' })).toHaveCount(0);
    expect(await page.evaluate(() => window.tokenApi.getDeferredSourceKeys())).toHaveLength(1);
    expect((await page.evaluate(() => window.tokenApi.getUploadStatus())).localRevision).toBe(baselineRevision);
    expect(await readState()).toEqual(baseline);
    await login('viewer-a', 'viewer-a-password-123');
    expect(await page.evaluate(() => window.tokenApi.getSourceStatuses())).toEqual(viewerStatuses);
    await login('manager', 'manager-password-123');
    await page.getByRole('button', { name: /数据来源/ }).click();
    await expect(page.getByText(/Claude 文件未归属总数 2 个 · 我的待办 2 个/)).toBeVisible();
    await page.getByLabel('来源状态筛选').selectOption('pending');
    await expect(page.getByRole('row').filter({ hasText: '项目 alpha' })).toHaveCount(1);
    expect(await page.evaluate(() => window.tokenApi.getDeferredSourceKeys())).toHaveLength(0);
    await login('admin', 'safe-password-123');
    await page.getByRole('button', { name: /数据来源/ }).click();
    await expect(page.getByText(/Claude 文件未归属总数 2 个 · 我的待办 1 个/)).toBeVisible();
    await page.getByLabel('来源状态筛选').selectOption('deferred');
    await expect(page.getByRole('row').filter({ hasText: '项目 alpha' })).toHaveCount(1);
    expect(await readState()).toEqual(baseline);

    await app.close();
    const packaged = process.env.TOKEN_E2E_EXECUTABLE;
    app = await electron.launch({ executablePath: packaged || (require('electron') as string),
      args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${workspace.root}`],
      env: { ...process.env, TOKEN_TEST_TELEMETRY_PORT: '0',
        TOKEN_CODEX_SESSIONS_DIR: workspace.codexDir, TOKEN_CLAUDE_PROJECTS_DIR: workspace.claudeDir } });
    page = await app.firstWindow();
    await page.getByPlaceholder('用户名').fill('admin');
    await page.getByPlaceholder('输入密码').fill('safe-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: /数据来源/ }).click();
    await expect(page.getByText(/Claude 文件未归属总数 2 个 · 我的待办 1 个/)).toBeVisible();
    await page.getByLabel('来源状态筛选').selectOption('deferred');
    await page.getByRole('row').filter({ hasText: '项目 alpha' })
      .getByRole('button', { name: '重新纳入待归属' }).click();
    await expect(page.getByText(/Claude 文件未归属总数 2 个 · 我的待办 2 个/)).toBeVisible();
    await page.getByLabel('来源状态筛选').selectOption('pending');
    await expect(page.getByRole('row').filter({ hasText: '项目 alpha' })).toHaveCount(1);
    expect(await readState()).toEqual(baseline);

    for (const viewer of ['viewer-a', 'viewer-b']) {
      await login(viewer, `${viewer}-password-123`);
      const report = await page.evaluate(() => window.tokenApi.queryUsage({ from: '2026-10-02', to: '2026-10-02',
        timeZone: 'UTC', granularity: 'day', provider: 'claude', model: '', projectKey: '', userId: 'all' }));
      expect(report.accounting.confirmedSubtotal.totalTokens).toBe(0);
    }
  } finally { await app.close().catch(() => {}); workspace.cleanup(); }

  async function readState() {
    const localCopy = path.join(workspace.root, 'test-local-read-copy.sqlite');
    copyFileSync(workspace.databasePath, localCopy);
    const db = await AppDatabase.open(localCopy);
    try {
      return {
        owners: db.all("SELECT key, owner_user_id FROM source_identities WHERE key LIKE 'claude:local-file:%' ORDER BY key"),
        facts: db.all("SELECT source_key, total_tokens FROM usage_facts WHERE provider='claude' ORDER BY source_key"),
        audits: Number(db.one('SELECT COUNT(*) AS n FROM source_binding_audit')?.n),
        sourceAudits: Number(db.one("SELECT COUNT(*) AS n FROM audit_events WHERE action LIKE 'source.%'")?.n),
        service: await (async () => {
          const file = path.join(workspace.root, 'server', 'server.sqlite');
          if (!existsSync(file)) return null;
          const serviceCopy = path.join(workspace.root, 'test-service-read-copy.sqlite');
          copyFileSync(file, serviceCopy);
          const serverDb = await AppDatabase.open(serviceCopy);
          try { return { aggregates: serverDb.all('SELECT * FROM aggregates ORDER BY owner_user_id, day, provider, model'),
            status: serverDb.all('SELECT * FROM aggregate_status ORDER BY owner_user_id, provider') }; }
          finally { serverDb.close(); }
        })()
      };
    } finally { db.close(); }
  }
});
