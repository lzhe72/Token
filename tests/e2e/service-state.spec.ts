import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { bindSource, createViewer, launchM6, loginViewer } from './m6-support';

test('TC-088 服务配置认证协议待传和本机覆盖在界面并列且可重试', async () => {
  let mode: 'rejected' | 'old' = 'rejected';
  const remote = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/health') response.end(JSON.stringify({ ok: true, accountingVersion: mode === 'old' ? 1 : 2 }));
    else if (request.url === '/v1/auth/check') {
      response.statusCode = mode === 'rejected' ? 401 : 200;
      response.end(JSON.stringify({ authorized: mode === 'old' }));
    } else { response.statusCode = 400; response.end(JSON.stringify({ error: 'synthetic old service' })); }
  });
  await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve));
  const address = remote.address();
  if (!address || typeof address === 'string') throw new Error('测试服务未启动');
  const context = await launchM6('tc088-ui', { usage: true });
  try {
    const { page } = context;
    await expect.poll(async () => (await page.evaluate(() => window.tokenApi.getServerStatus())).online).toBe(true);
    await expect(page.locator('.header-status')).toContainText('内置本地服务');
    const config = await page.evaluate(() => window.tokenApi.getTelemetryConfiguration());
    const endpoint = config.codex.match(/endpoint = "([^"]+)"/)?.[1];
    const secret = config.codex.match(/Bearer ([a-f0-9]+)/)?.[1];
    expect(endpoint && secret).toBeTruthy();
    const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
    const now = new Date().toISOString();
    const otel = { resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: String(BigInt(Date.parse(now)) * 1_000_000n), attributes: [
        attr('event.name', 'codex.sse_event'), attr('event.kind', 'response.completed'),
        attr('input_token_count', '14'), attr('output_token_count', '0'),
        attr('conversation.id', 'one'), attr('model', 'gpt-alpha'),
        attr('user.account_id', 'synthetic-tc088-owner')
      ]
    }] }] }] };
    expect((await fetch(endpoint!, { method: 'POST', headers: { authorization: `Bearer ${secret}`,
      'content-type': 'application/json' }, body: JSON.stringify(otel) })).status).toBe(200);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await bindSource(page, /Codex · 本机账户/, 'admin');
    await bindSource(page, /Codex 遥测来源/, 'admin');
    await expect.poll(async () => (await page.evaluate(() => window.tokenApi.getUploadStatus())).uncertainRows)
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: /系统设置/ }).click();
    const states = page.locator('.service-state-grid');
    await expect(states).toContainText('服务可达');
    await expect(states).toContainText('不证明当前筛选完整覆盖');
    await expect(states).toContainText('待核对');

    await page.getByLabel('服务器地址').fill('http://127.0.0.1:1');
    await page.getByRole('button', { name: '保存连接' }).click();
    await expect(states).toContainText('服务离线');
    await expect(states).toContainText('待传');
    await expect(states).toContainText('待核对');
    await expect(page.locator('.header-status')).toContainText('已配置服务器');
    await expect(page.locator('.header-status')).toContainText('服务离线');
    await page.getByRole('button', { name: '立即重试上报' }).click();
    await expect(states).toContainText('待传');

    await page.getByLabel('服务器地址').fill(`http://127.0.0.1:${address.port}`);
    await page.getByLabel('服务器访问密钥').fill('a'.repeat(64));
    await page.getByLabel('服务器管理密钥').fill('b'.repeat(64));
    await page.getByRole('button', { name: '保存连接' }).click();
    await expect(states).toContainText('访问密钥被拒绝');
    await expect(states).toContainText('待传');
    mode = 'old';
    await page.getByRole('button', { name: '保存连接' }).click();
    await expect(states).toContainText('计量协议不兼容');
    await expect(states).toContainText('待传');
    await page.getByRole('button', { name: '使用内置本机服务' }).click();
    await expect(page.locator('.header-status')).toContainText('内置本地服务');
    await expect(states).toContainText('当前修订版');
    await expect(states).toContainText('已由当前服务确认');
    await expect(states).toContainText('待核对');

    await createViewer(page);
    await loginViewer(page);
    expect(await page.evaluate(() => window.tokenApi.getUploadStatus())).toMatchObject({
      pending: null, uncertainRows: null, localRevision: null, currentConfirmed: null
    });
    const access = await page.evaluate(async () => Promise.allSettled([
      window.tokenApi.retryUpload(), window.tokenApi.useBuiltInServer()
    ]));
    expect(access.map(item => item.status)).toEqual(['rejected', 'rejected']);
  } finally {
    await context.close();
    await new Promise<void>(resolve => remote.close(() => resolve()));
  }
});

test('TC-088 快照落盘失败时不切换服务配置', async () => {
  const context = await launchM6('tc088-disk-failure', { usage: true });
  try {
    const { page, app } = context;
    const before = await page.evaluate(async () => ({
      server: await window.tokenApi.getServerStatus(), upload: await window.tokenApi.getUploadStatus()
    }));
    await app.evaluate(({ app }) => {
      const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs');
      const path = process.getBuiltinModule('node:path') as typeof import('node:path');
      const target = path.join(app.getPath('userData'), 'token.sqlite');
      const rename = fs.renameSync;
      fs.renameSync = ((from: string, to: string) => {
        if (String(to) === target) {
          fs.renameSync = rename;
          throw new Error('synthetic snapshot disk failure');
        }
        return rename(from, to);
      }) as typeof fs.renameSync;
    });
    const outcome = await page.evaluate(() => window.tokenApi.configureServer('http://127.0.0.1:1', '', '')
      .then(() => 'saved', () => 'rejected'));
    expect(outcome).toBe('rejected');
    const after = await page.evaluate(async () => ({
      server: await window.tokenApi.getServerStatus(), upload: await window.tokenApi.getUploadStatus()
    }));
    expect(after.server.url).toBe(before.server.url);
    expect(after.server.serviceType).toBe('built_in');
    expect(after.upload.localRevision).toBe(before.upload.localRevision);
    expect(after.upload.pending).toBe(before.upload.pending);
  } finally { await context.close(); }
});
