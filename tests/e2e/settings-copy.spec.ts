import { expect, test } from '@playwright/test';
import { bindSource, launchM6 } from './m6-support';

test('TC-091 遥测说明与疑似重叠报表及 CSV v2 状态一致', async () => {
  const now = new Date().toISOString();
  const context = await launchM6('tc091-copy', { usage: true, usageDate: now });
  try {
    const { page } = context;
    await page.getByRole('button', { name: /系统设置/ }).click();
    const telemetry = page.locator('.telemetry-panel');
    await expect(telemetry).toContainText('按授权用户与会话保留可证独立事实');
    await expect(telemetry).toContainText('疑似重叠的记录标为待核对，完整总量不可确认');
    await expect(telemetry).not.toContainText('同一天有本地记录时，报表采用本地记录');
    const config = await page.evaluate(() => window.tokenApi.getTelemetryConfiguration());
    const endpoint = config.codex.match(/endpoint = "([^"]+)"/)?.[1];
    const secret = config.codex.match(/Bearer ([a-f0-9]+)/)?.[1];
    expect(endpoint && secret).toBeTruthy();
    const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
    const otel = { resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: String(BigInt(Date.parse(now)) * 1_000_000n), attributes: [
        attr('event.name', 'codex.sse_event'), attr('event.kind', 'response.completed'),
        attr('input_token_count', '14'), attr('output_token_count', '0'),
        attr('conversation.id', 'one'), attr('model', 'gpt-alpha'),
        attr('user.account_id', 'synthetic-same-owner')
      ]
    }] }] }] };
    expect((await fetch(endpoint!, { method: 'POST', headers: { authorization: `Bearer ${secret}`,
      'content-type': 'application/json' }, body: JSON.stringify(otel) })).status).toBe(200);
    await page.getByRole('button', { name: /数据来源/ }).click();
    await page.getByRole('button', { name: '立即扫描' }).click();
    await bindSource(page, /Codex · 本机账户/, 'admin');
    await bindSource(page, /Codex 遥测来源/, 'admin');
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await expect(page.locator('.report-page')).toContainText('总量不可确认');
    await expect(page.locator('.report-page')).toContainText('待核对');
    await expect(page.getByRole('button', { name: '导出含待核对用量 CSV v2' })).toBeVisible();
  } finally { await context.close(); }
});
