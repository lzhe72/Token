import { afterEach, expect, test } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AppDatabase } from '../src/main/database';
import { createTestWorkspace } from './support/test-workspace';
import { UsageScanner } from '../src/collectors/scanner';
import { ReportService } from '../src/main/report';
import { inspectConfig, TelemetryReceiver } from '../src/main/telemetry';
import type { PublicUser, ReportQuery } from '../src/shared/types';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });

test('本机遥测只接受密钥，Codex 去重，Claude 累计点计算增量，报表避免双来源相加', async () => {
  const workspace = createTestWorkspace('otel');
  const root = workspace.root;
  roots.push(root);
  const db = await AppDatabase.open(workspace.databasePath);
  const scanner = new UsageScanner(db);
  const receiver = new TelemetryReceiver(db, root, 0);
  await receiver.start();
  const config = receiver.configuration();
  expect(config.running).toBe(true);
  const endpoint = config.claude.match(/OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=(\S+)/)?.[1];
  const secret = config.claude.match(/Bearer ([a-f0-9]+)/)?.[1];
  expect(endpoint).toBeTruthy();
  expect(secret).toBeTruthy();
  const post = (route: string, body: object, authorization = `Bearer ${secret}`) => fetch(endpoint!.replace('/v1/metrics', route), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization }, body: JSON.stringify(body)
  });

  try {
    const codex = { resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: '1767225600000000000', attributes: [
        attr('event.name', 'codex.sse_event'), attr('event.kind', 'response.completed'),
        attr('input_token_count', '10'), attr('output_token_count', '2'), attr('cached_token_count', '4'),
        attr('conversation.id', 'c1'), attr('model', 'gpt-test'), attr('user.account_id', 'account-test')
      ]
    }] }] }] };
    expect((await post('/v1/logs', codex, 'Bearer wrong')).status).toBe(401);
    expect((await post('/v1/logs', codex)).status).toBe(200);
    expect((await post('/v1/logs', codex)).status).toBe(200);

    const claude = (value: number, end: string) => ({ resourceMetrics: [{ resource: { attributes: [attr('user.id', 'u1'), attr('user.account_uuid', 'account-u1')] }, scopeMetrics: [{ metrics: [{
      name: 'claude_code.token.usage', sum: { aggregationTemporality: 2, dataPoints: [{
        attributes: [attr('type', 'input'), attr('model', 'claude-test'), attr('session.id', 's1')],
        startTimeUnixNano: '1767225600000000000', timeUnixNano: end, asInt: String(value)
      }] }
    }] }] }] });
    expect((await post('/v1/metrics', claude(5, '1767225601000000000'))).status).toBe(200);
    expect((await post('/v1/metrics', claude(8, '1767225602000000000'))).status).toBe(200);
    expect((await post('/v1/metrics', claude(8, '1767225602000000000'))).status).toBe(200);
    expect(Number(db.one("SELECT SUM(total_tokens) AS total FROM usage_facts WHERE provider = 'codex'")?.total)).toBe(12);
    expect(Number(db.one("SELECT SUM(total_tokens) AS total FROM usage_facts WHERE provider = 'claude'")?.total)).toBe(8);

    const admin: PublicUser = { id: 'a', username: 'a', role: 'admin', active: true, createdAt: '' };
    const query: ReportQuery = { from: '2026-01-01', to: '2026-01-01', timeZone: 'UTC', granularity: 'day', provider: 'all', model: '', userId: 'all' };
    const report = new ReportService(db, scanner);
    expect(report.query(query, admin).totals.totalTokens).toBe(8);
    expect(report.query(query, admin).accounting).toMatchObject({ status: 'uncertain', conflictCount: 1,
      confirmedSubtotal: { totalTokens: 8 } });
    db.run("INSERT INTO source_identities VALUES ('codex:local', 'codex', 'Codex', NULL)");
    db.run("INSERT INTO usage_facts VALUES ('local:1', 'codex', 'codex:local', 'c1', 'gpt-test', '2026-01-01T00:00:00Z', 10, 2, 4, 0, 12)");
    expect(report.query(query, admin).totals.totalTokens).toBe(8);
    expect(report.query(query, admin).accounting).toMatchObject({ status: 'uncertain', conflictCount: 2,
      confirmedSubtotal: { totalTokens: 8 } });
    const delta = { resourceMetrics: [{ resource: { attributes: [attr('user.account_uuid', 'account-u1')] }, scopeMetrics: [{ metrics: [{ name: 'claude_code.token.usage',
      sum: { aggregationTemporality: 1, dataPoints: [{
        attributes: [attr('type', 'output'), attr('model', 'claude-test'), attr('session.id', 's1')],
        startTimeUnixNano: '1767225602000000000', timeUnixNano: '1767225603000000000', asInt: '7'
      }] }
    }] }] }] };
    expect((await post('/v1/metrics', delta)).status).toBe(200);
    expect((await post('/v1/metrics', delta)).status).toBe(200);
    expect(Number(db.one("SELECT SUM(total_tokens) AS total FROM usage_facts WHERE provider = 'claude'")?.total)).toBe(15);
    expect(report.query(query, admin).totals.totalTokens).toBe(15);
    expect(report.query(query, admin).accounting.status).toBe('uncertain');
  } finally {
    receiver.stop();
    db.close();
  }
});

test('遥测配置提示现有用户设置而不修改文件', () => {
  const root = createTestWorkspace('settings').root;
  roots.push(root);
  const codex = path.join(root, 'config.toml');
  const claude = path.join(root, 'settings.json');
  writeFileSync(codex, '[otel]\nexporter = "none"\n');
  writeFileSync(claude, JSON.stringify({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.example' } }));
  expect(inspectConfig(codex, 'codex')).toContain('已发现');
  expect(inspectConfig(claude, 'claude')).toContain('已发现');
  expect(inspectConfig(path.join(root, 'missing'), 'codex')).toBeNull();
});
