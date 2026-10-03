import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createViewer, launchM6, loginViewer, writeUsage } from './m6-support';

test('TC-093 真实本地和遥测事实经归属调和贯穿概览报表明细 CSV v2 且切换用户隔离', async () => {
  const context = await launchM6('tc093-real-chain');
  try {
    const { page, app, workspace } = context;
    await createViewer(page);
    await page.getByPlaceholder('3–32 位').fill('viewerB');
    await page.getByPlaceholder('至少 10 位').fill('viewer-b-password-123');
    await page.getByRole('button', { name: '创建用户' }).click();
    await expect(page.getByRole('cell', { name: 'viewerB' })).toBeVisible();
    const users = await page.evaluate(() => window.tokenApi.listUsers());
    const ownerA = users.find(user => user.username === 'viewer')!.id;
    const ownerB = users.find(user => user.username === 'viewerB')!.id;
    const now = new Date().toISOString();
    const day = now.slice(0, 10);
    const query = { from: day, to: day, timeZone: 'UTC', granularity: 'day' as const,
      provider: 'codex' as const, model: '', projectKey: '', userId: 'all' };
    writeUsage(workspace.codexDir, 'overlap', '/work/overlap', 'gpt-overlap', 12, now);
    writeUsage(workspace.codexDir, 'independent', '/work/independent', 'gpt-overlap', 5, now);
    await page.evaluate(() => window.tokenApi.scanSources());

    const bind = async (key: string, owner: string) => {
      const preview = await page.evaluate(({ key, owner, query }) =>
        window.tokenApi.previewSourceBinding(key, owner, query), { key, owner, query });
      expect(preview.sourceKey).toBe(key);
      expect((await page.evaluate(id => window.tokenApi.confirmSourceBinding(id), preview.id)).localCommitted).toBe(true);
    };
    const local = (await page.evaluate(() => window.tokenApi.getSourceIdentities()))
      .find(source => source.provider === 'codex' && source.key.startsWith('codex:') && !source.key.startsWith('codex:otel:'));
    expect(local?.factCount).toBe(2);
    await bind(local!.key, ownerA);

    const telemetry = await page.evaluate(() => window.tokenApi.getTelemetryConfiguration());
    const endpoint = telemetry.codex.match(/endpoint = "([^"]+)"/)?.[1];
    const secret = telemetry.codex.match(/Bearer ([a-f0-9]+)/)?.[1];
    expect(endpoint && secret).toBeTruthy();
    const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
    const send = async (session: string, account: string, tokens: number, occurredAt: string) => {
      const payload = { resourceLogs: [{ scopeLogs: [{ logRecords: [{
        timeUnixNano: String(BigInt(Date.parse(occurredAt)) * 1_000_000n), attributes: [
          attr('event.name', 'codex.sse_event'), attr('event.kind', 'response.completed'),
          attr('input_token_count', String(tokens)), attr('output_token_count', '0'),
          attr('conversation.id', session), attr('model', 'gpt-overlap'),
          attr('user.account_id', account)
        ]
      }] }] }] };
      expect((await fetch(endpoint!, { method: 'POST', headers: { authorization: `Bearer ${secret}`,
        'content-type': 'application/json' }, body: JSON.stringify(payload) })).status).toBe(200);
    };
    const before = new Set((await page.evaluate(() => window.tokenApi.getSourceIdentities())).map(source => source.key));
    await send('overlap', 'synthetic-owner-a', 14, now);
    const afterA = await page.evaluate(() => window.tokenApi.getSourceIdentities());
    const otelA = afterA.find(source => !before.has(source.key));
    expect(otelA).toMatchObject({ provider: 'codex', factCount: 1 });
    await bind(otelA!.key, ownerA);
    await send('other-owner', 'synthetic-owner-b', 99, now);
    const afterB = await page.evaluate(() => window.tokenApi.getSourceIdentities());
    const otelB = afterB.find(source => source.key !== otelA!.key && !before.has(source.key));
    expect(otelB).toMatchObject({ provider: 'codex', factCount: 1 });
    await bind(otelB!.key, ownerB);

    await loginViewer(page);
    const reportA = await page.evaluate(value => window.tokenApi.queryUsage(value), query);
    expect(reportA.query.userId).toBe(ownerA);
    expect(reportA.accounting).toMatchObject({ status: 'uncertain', conflictCount: 2,
      confirmedSubtotal: { totalTokens: 5 }, conflictSources: ['local', 'telemetry'] });
    expect(reportA.totals.totalTokens).toBe(5);
    const detailsA = await page.evaluate(({ query, snapshotId }) =>
      window.tokenApi.queryUsageDetails(query, 1, '', snapshotId), { query, snapshotId: reportA.snapshotId });
    expect(detailsA.total).toBe(3);
    expect(detailsA.records.filter(record => record.accountingStatus === 'pending')).toHaveLength(2);
    expect(detailsA.records.map(record => record.totalTokens).sort((a, b) => a - b)).toEqual([5, 12, 14]);
    expect(detailsA.records.every(record => record.totalTokens !== 99)).toBe(true);

    await expect(page.locator('.overview-primary')).toContainText('总量不可确认');
    await expect(page.locator('.overview-primary strong')).toHaveText('5');
    await page.locator('.sidebar').getByRole('button', { name: /用量报表/ }).click();
    await page.getByLabel('工具筛选').selectOption('codex');
    await expect(page.locator('.report-page')).toContainText('总量不可确认');
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('5');
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(3);
    await expect(page.locator('.detail-panel tbody')).toContainText('待核对');
    await expect(page.getByRole('button', { name: '导出含待核对用量 CSV v2' })).toBeVisible();
    const csvFile = path.join(workspace.root, 'tc093-real-v2.csv');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, csvFile);
    await page.getByRole('button', { name: '导出含待核对用量 CSV v2' }).click();
    await expect.poll(() => fs.existsSync(csvFile)).toBe(true);
    const csv = fs.readFileSync(csvFile, 'utf8').replace(/^\uFEFF/, '').trim().split('\r\n');
    const rows = csv.slice(1).map(line => line.split(','));
    expect(csv[0].split(',')).toHaveLength(14);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.length === 14)).toBe(true);
    const uncertain = rows.filter(row => row[10] === 'uncertain');
    const confirmed = rows.filter(row => row[10] === 'confirmed');
    expect(uncertain.length).toBeGreaterThan(0);
    expect(uncertain.every(row => row.slice(4, 10).every(cell => cell === ''))).toBe(true);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0][8]).toBe('5');
    expect(rows.reduce((sum, row) => sum + Number(row[11]), 0)).toBe(5);
    expect(rows.reduce((sum, row) => sum + Number(row[13]), 0)).toBe(2);
    expect(uncertain.map(row => row[12]).join('、')).toContain('local');
    expect(uncertain.map(row => row[12]).join('、')).toContain('telemetry');

    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByPlaceholder('用户名').fill('viewerB');
    await page.getByPlaceholder('输入密码').fill('viewer-b-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await expect(page.locator('.overview-primary strong')).toHaveText('99');
    await expect(page.locator('.overview-primary')).not.toContainText('总量不可确认');
    const reportB = await page.evaluate(value => window.tokenApi.queryUsage(value), query);
    expect(reportB.query.userId).toBe(ownerB);
    expect(reportB.accounting).toMatchObject({ status: 'confirmed', conflictCount: 0 });
    expect(reportB.totals.totalTokens).toBe(99);
    const detailsB = await page.evaluate(({ query, snapshotId }) =>
      window.tokenApi.queryUsageDetails(query, 1, '', snapshotId), { query, snapshotId: reportB.snapshotId });
    expect(detailsB.records.map(record => record.totalTokens)).toEqual([99]);
    expect(detailsB.records.every(record => record.totalTokens !== 12 && record.totalTokens !== 14)).toBe(true);
    await page.locator('.sidebar').getByRole('button', { name: /用量报表/ }).click();
    await page.getByLabel('工具筛选').selectOption('codex');
    await expect(page.locator('.metric-card').first().locator('strong')).toHaveText('99');
    await expect(page.locator('.report-page')).not.toContainText('总量不可确认');
    await expect(page.locator('.detail-panel tbody tr')).toHaveCount(1);
  } finally { await context.close(); }
});
