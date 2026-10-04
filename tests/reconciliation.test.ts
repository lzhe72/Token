import { createHash, randomUUID } from 'node:crypto';
import { promises as fsp, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expect, test, vi } from 'vitest';
import { AppDatabase } from '../src/main/database';
import { ReportService } from '../src/main/report';
import { UsageScanner } from '../src/collectors/scanner';
import { claudeFileKey, scopedLocalFactKey } from '../src/collectors/fact-key';
import { TelemetryReceiver } from '../src/main/telemetry';
import { SourceBindingService } from '../src/main/source-binding';
import { UsageSync, prepareUsageSync } from '../src/main/usage-sync';
import type { ServerConnection } from '../src/main/server-connection';
import type { PublicUser, ReportQuery } from '../src/shared/types';
import { createTestWorkspace } from './support/test-workspace';

test('TC-092 跨用户和不同会话遥测独立保留且同会话冲突不伪造总量', async () => {
  const workspace = createTestWorkspace('tc092-reconcile');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    const idA = randomUUID();
    const idB = randomUUID();
    const actor = (id: string, role: PublicUser['role']): PublicUser =>
      ({ id, username: id === idA ? 'owner-a' : 'owner-b', role, active: true, createdAt: '' });
    for (const [id, name] of [[idA, 'owner-a'], [idB, 'owner-b']]) {
      db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        [id, name, 'unused', 'viewer', '2026-10-02T00:00:00Z']);
    }
    const identities: Array<[string, string]> = [
      ['codex:local-a', idA], ['codex:otel-a', idA], ['codex:otel-b', idB]
    ];
    for (const [key, owner] of identities) db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [key, 'codex', 'synthetic', owner]);
    const add = (key: string, identity: string, session: string, tokens: number) => db.run(
      'INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [key, 'codex', identity, session, 'gpt-test', '2026-10-02T10:00:00Z', tokens, 0, 0, 0, tokens]);
    add('local-a', 'codex:local-a', 'session-a', 12);
    add('otel:b', 'codex:otel-b', 'session-b', 99);
    const report = new ReportService(db, scanner);
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
      provider: 'codex', model: '', projectKey: '', userId: 'all' };
    expect(report.query(query, actor(idA, 'admin')).totals.totalTokens).toBe(111);
    expect(report.query(query, actor(idB, 'viewer')).totals.totalTokens).toBe(99);
    add('otel:a-distinct', 'codex:otel-a', 'session-other', 7);
    expect(report.query(query, actor(idA, 'viewer')).totals.totalTokens).toBe(19);
    add('otel:a-same', 'codex:otel-a', 'session-a', 14);
    const affected = report.query(query, actor(idA, 'viewer'));
    expect(affected.accounting.status).toBe('uncertain');
    expect(affected.accounting.confirmedSubtotal.totalTokens).toBe(7);
    expect(affected.accounting.conflictCount).toBe(2);
    expect(affected.accounting.conflictSources).toEqual(['local', 'telemetry']);
    add('otel:a-unknown', 'codex:otel-a', 'unknown', 5);
    expect(report.query(query, actor(idA, 'viewer')).accounting).toMatchObject({
      status: 'uncertain', conflictCount: 3, confirmedSubtotal: { totalTokens: 7 }
    });
    expect(report.query(query, actor(idB, 'viewer')).accounting.status).toBe('confirmed');
    expect(report.query(query, actor(idB, 'viewer')).totals.totalTokens).toBe(99);
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-092 真实 Codex 遥测跨账户及同毫秒记录不碰撞且重送幂等', async () => {
  const workspace = createTestWorkspace('tc092-otel-key');
  const db = await AppDatabase.open(workspace.databasePath);
  const scanner = new UsageScanner(db);
  const receiver = new TelemetryReceiver(db, workspace.root, 0);
  await receiver.start();
  try {
    const config = receiver.configuration();
    const endpoint = config.codex.match(/endpoint = "([^\"]+)/)?.[1];
    const secret = config.codex.match(/Bearer ([a-f0-9]+)/)?.[1];
    expect(endpoint).toBeTruthy();
    expect(secret).toBeTruthy();
    const log = (account: string, timeUnixNano: string) => ({ timeUnixNano, attributes: [
      { key: 'event.name', value: { stringValue: 'codex.sse_event' } },
      { key: 'event.kind', value: { stringValue: 'response.completed' } },
      { key: 'user.account_id', value: { stringValue: account } },
      { key: 'conversation.id', value: { stringValue: 'same-session' } },
      { key: 'model', value: { stringValue: 'gpt-test' } },
      { key: 'input_token_count', value: { intValue: '10' } },
      { key: 'output_token_count', value: { intValue: '2' } },
      { key: 'cached_token_count', value: { intValue: '0' } }
    ] });
    const payload = { resourceLogs: [{ scopeLogs: [{ logRecords: [
      log('account-a', '1790928000000000000'), log('account-b', '1790928000000000000'),
      log('account-a', '1790928000000000001'), log('account-a', '1790928000000000001')
    ] }] }] };
    const post = () => fetch(endpoint!, { method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect((await post()).status).toBe(200);
    expect(db.all("SELECT source_identity_key FROM usage_facts WHERE source_key LIKE 'otel:codex:%'")).toHaveLength(4);
    expect(db.all('SELECT source_key FROM usage_uncertain_facts')).toHaveLength(3);
    expect((await post()).status).toBe(200);
    expect(db.all("SELECT source_identity_key FROM usage_facts WHERE source_key LIKE 'otel:codex:%'")).toHaveLength(4);
    expect(db.all('SELECT source_key FROM usage_uncertain_facts')).toHaveLength(4);
    const identities = db.all("SELECT source_identity_key FROM usage_facts WHERE source_key LIKE 'otel:codex:%'");
    expect(new Set(identities.map(row => row.source_identity_key)).size).toBe(2);
    const accountIdentity = (account: string) => `codex:otel:${createHash('sha256').update(account).digest('hex').slice(0, 20)}`;
    for (const [account, owner] of [['account-a', 'owner-a'], ['account-b', 'owner-b']]) {
      db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        [owner, owner, 'unused', 'viewer', '2026-10-02T00:00:00Z']);
      db.run('UPDATE source_identities SET owner_user_id = ? WHERE key = ?', [owner, accountIdentity(account)]);
    }
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC',
      granularity: 'day', provider: 'codex', model: '', projectKey: '', userId: 'all' };
    const service = new ReportService(db, scanner);
    const report = service.query(query, { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '' });
    expect(report.accounting.status).toBe('uncertain');
    expect(report.accounting.conflictCount).toBe(4);
    expect(report.accounting.conflictSources).toEqual(['telemetry']);
    expect(report.accounting.confirmedSubtotal.totalTokens).toBe(0);
    const viewerA: PublicUser = { id: 'owner-a', username: 'owner-a', role: 'viewer', active: true, createdAt: '' };
    const viewerB: PublicUser = { id: 'owner-b', username: 'owner-b', role: 'viewer', active: true, createdAt: '' };
    expect(service.query(query, viewerA).accounting).toMatchObject({ status: 'uncertain', conflictCount: 3,
      confirmedSubtotal: { totalTokens: 0 } });
    expect(service.query(query, viewerB).accounting).toMatchObject({ status: 'uncertain', conflictCount: 1,
      confirmedSubtotal: { totalTokens: 0 } });
    const csv = service.csv(query, viewerA);
    expect(csv.split('\r\n')[0].split(',')).toHaveLength(14);
    expect(csv).toContain('uncertain,0,"telemetry",3');
    expect(csv).not.toContain('owner-b');
  } finally { receiver.stop(); db.close(); workspace.cleanup(); }
});

test('TC-092 Claude 安装级 user.id 不作为账号且累计点按已验证账号隔离', async () => {
  const workspace = createTestWorkspace('tc092-claude-account');
  const db = await AppDatabase.open(workspace.databasePath);
  const scanner = new UsageScanner(db);
  const receiver = new TelemetryReceiver(db, workspace.root, 0);
  await receiver.start();
  try {
    const config = receiver.configuration();
    const endpoint = config.claude.match(/OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=(\S+)/)?.[1];
    const secret = config.claude.match(/Bearer ([a-f0-9]+)/)?.[1];
    const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
    const metric = (account: string | null, value: number, end: string, extra: Array<ReturnType<typeof attr>> = []) =>
      ({ resourceMetrics: [{ resource: { attributes: [attr('user.id', 'same-install'),
        ...(account === null ? [] : [attr('user.account_uuid', account)]), ...extra] }, scopeMetrics: [{ metrics: [{
        name: 'claude_code.token.usage', sum: { aggregationTemporality: 2, dataPoints: [{
          attributes: [attr('type', 'input'), attr('model', 'claude-test'), attr('session.id', 'same-session')],
          startTimeUnixNano: '1790928000000000000', timeUnixNano: end, asInt: String(value)
        }] }
      }] }] }] });
    const post = (body: object) => fetch(endpoint!, { method: 'POST', headers: {
      authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post(metric('account-a', 5, '1790928001000000000'))).status).toBe(200);
    expect((await post(metric('account-b', 8, '1790928001000000000'))).status).toBe(200);
    expect((await post(metric('account-a', 9, '1790928002000000000'))).status).toBe(200);
    expect((await post(metric('account-a', 9, '1790928002000000000'))).status).toBe(200);
    expect((await post(metric(null, 11, '1790928001000000000'))).status).toBe(200);
    expect((await post(metric('', 11, '1790928001000000000'))).status).toBe(200);
    expect((await post(metric('unknown', 11, '1790928001000000000'))).status).toBe(200);
    const missingId = metric(null, 13, '1790928001000000000');
    missingId.resourceMetrics[0].resource.attributes = [];
    expect((await post(missingId)).status).toBe(200);
    expect((await post(metric(null, 14, '1790928001000000000', [attr('user.id', '')]))).status).toBe(200);
    expect((await post(metric(null, 15, '1790928001000000000', [attr('user.id', '   ') ]))).status).toBe(200);
    expect((await post(metric(null, 17, '1790928001000000000', [attr('user.id', 'x'.repeat(201))]))).status).toBe(200);
    const nonString = metric(null, 16, '1790928001000000000');
    (nonString.resourceMetrics[0].resource.attributes as unknown[]).push({ key: 'user.id', value: { intValue: 123 } });
    expect((await post(nonString)).status).toBe(200);
    expect((await post(metric(null, 21, '1790928001000000000'))).status).toBe(200);
    expect((await post(metric(null, 15, '1790928002000000000'))).status).toBe(200);
    expect((await post(metric(null, 27, '1790928002000000000'))).status).toBe(200);
    expect((await post(metric(null, 7, '1790928001000000000', [attr('user.account_id', 'account-c')]))).status).toBe(200);
    expect((await post(metric(null, 6, '1790928001000000000', [attr('identity.source', 'gateway-oidc'), attr('user.id', 'oidc-subject')]))).status).toBe(200);
    const knownA = `claude:otel:account:${createHash('sha256').update('account-a').digest('hex').slice(0, 20)}`;
    const knownB = `claude:otel:account:${createHash('sha256').update('account-b').digest('hex').slice(0, 20)}`;
    expect(Number(db.one('SELECT SUM(total_tokens) AS total FROM usage_facts WHERE source_identity_key = ?', [knownA])?.total)).toBe(9);
    expect(Number(db.one('SELECT SUM(total_tokens) AS total FROM usage_facts WHERE source_identity_key = ?', [knownB])?.total)).toBe(8);
    const unknown = String(db.one("SELECT key FROM source_identities WHERE key LIKE 'claude:otel:unknown:%'")?.key);
    expect(Number(db.one('SELECT COUNT(*) AS count FROM usage_facts WHERE source_identity_key = ?', [unknown])?.count)).toBe(11);
    expect(Number(db.one('SELECT COUNT(*) AS count FROM usage_facts f JOIN usage_uncertain_facts u ON u.source_key=f.source_key WHERE f.source_identity_key = ?', [unknown])?.count)).toBe(11);
    const knownC = `claude:otel:account:${createHash('sha256').update('account-c').digest('hex').slice(0, 20)}`;
    const gateway = `claude:otel:account:${createHash('sha256').update('oidc-subject').digest('hex').slice(0, 20)}`;
    expect(db.one('SELECT total_tokens FROM usage_facts WHERE source_identity_key = ?', [knownC])?.total_tokens).toBe(7);
    expect(db.one('SELECT total_tokens FROM usage_facts WHERE source_identity_key = ?', [gateway])?.total_tokens).toBe(6);
    for (const [owner, identity] of [['owner-a', knownA], ['owner-b', knownB]]) {
      db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        [owner, owner, 'unused', 'viewer', '2026-10-02T00:00:00Z']);
      db.run('UPDATE source_identities SET owner_user_id = ? WHERE key = ?', [owner, identity]);
    }
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
      provider: 'claude', model: '', projectKey: '', userId: 'all' };
    const report = new ReportService(db, scanner);
    const viewer = (id: string): PublicUser => ({ id, username: id, role: 'viewer', active: true, createdAt: '' });
    expect(report.query(query, viewer('owner-a')).totals.totalTokens).toBe(9);
    expect(report.query(query, viewer('owner-b')).totals.totalTokens).toBe(8);
    expect(report.csv(query, viewer('owner-a'))).not.toContain('owner-b');
    const binding = new SourceBindingService(db, scanner, report, new UsageSync(db, scanner,
      { getConnectionIdentity: () => 'test' } as ServerConnection));
    const admin: PublicUser = { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '' };
    db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      ['admin', 'admin', 'unused', 'admin', '2026-10-02T00:00:00Z']);
    expect(() => binding.preview(unknown, 'owner-a', query, admin)).toThrow('账户身份无法验证');
  } finally { receiver.stop(); db.close(); workspace.cleanup(); }
});

test('TC-092 Claude 旧安装身份和历史归属暂停，空来源不伪造历史缺失', async () => {
  const workspace = createTestWorkspace('tc092-claude-legacy');
  let db = await AppDatabase.open(workspace.databasePath);
  try {
    new UsageScanner(db);
    for (const id of ['owner-a', 'owner-b']) db.run(
      'INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      [id, id, 'unused', 'viewer', '2026-10-02T00:00:00Z']);
    db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', ['claude:otel:old-install', 'claude', 'legacy', 'owner-a']);
    db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', ['claude:otel:empty-install', 'claude', 'legacy-empty', 'owner-b']);
    db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['otel:claude:old-fact', 'claude', 'claude:otel:old-install', 'session', 'claude-test',
        '2026-10-02T08:00:00Z', 12, 0, 0, 0, 12]);
    db.close();
    db = await AppDatabase.open(workspace.databasePath);
    const receiver = new TelemetryReceiver(db, workspace.root, 0);
    expect(receiver.didQuarantineLegacyIdentity()).toBe(true);
    const old = db.one("SELECT source_key, source_identity_key FROM usage_facts WHERE provider='claude'");
    expect(String(old?.source_key)).toMatch(/^otel:claude:legacy:/);
    expect(String(old?.source_identity_key)).toMatch(/^claude:otel:legacy-unverified:/);
    expect(db.one('SELECT owner_user_id FROM source_identities WHERE key = ?', [String(old?.source_identity_key)])?.owner_user_id).toBeNull();
    expect(db.all('SELECT affected_user_id FROM identity_migration_events')).toEqual([{ affected_user_id: 'owner-a' }]);
    const reports = new ReportService(db, new UsageScanner(db));
    const viewer = (id: string): PublicUser => ({ id, username: id, role: 'viewer', active: true, createdAt: '' });
    expect(reports.coverage(viewer('owner-a'))[1].detail).toContain('历史用量归属已暂停');
    expect(reports.coverage(viewer('owner-b'))[1].detail ?? '').not.toContain('历史用量归属已暂停');
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
      provider: 'claude', model: '', projectKey: '', userId: 'all' };
    expect(reports.query(query, viewer('owner-a')).totals.totalTokens).toBe(0);
    expect(reports.csv(query, viewer('owner-a'))).not.toContain('12');
    expect(reports.query(query, viewer('owner-b')).totals.totalTokens).toBe(0);
    db.run('DELETE FROM usage_uncertain_facts WHERE source_key = ?', [String(old?.source_key)]);
    expect(reports.coverage(viewer('owner-a'))[1].detail ?? '').not.toContain('历史用量归属已暂停');
    const second = new TelemetryReceiver(db, workspace.root, 0);
    expect(second.didQuarantineLegacyIdentity()).toBe(false);
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-092 本地 Codex 同请求 ID 的跨账户事实不串户', async () => {
  const workspace = createTestWorkspace('tc092-local-key');
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  try {
    const event = (account: string, tokens: number) => [
      { type: 'session_meta', payload: { session_id: 'same-session', creator_account_id: account } },
      { type: 'turn_context', payload: { turn_id: 'one', model: 'gpt-test' } },
      { type: 'token_usage_record', timestamp: '2026-10-02T00:00:00Z', payload: {
        session_id: 'same-session', turn_id: 'one', response_id: 'same-response',
        usage: { input_tokens: tokens, output_tokens: 0, total_tokens: tokens } } }
    ].map(row => JSON.stringify(row)).join('\n') + '\n';
    writeFileSync(path.join(workspace.codexDir, 'a.jsonl'), event('account-a', 12));
    writeFileSync(path.join(workspace.codexDir, 'b.jsonl'), event('account-b', 99));
    const db = await AppDatabase.open(workspace.databasePath);
    try {
      const scanner = new UsageScanner(db);
      await scanner.scan();
      expect(db.all("SELECT source_identity_key, total_tokens FROM usage_facts WHERE provider='codex' ORDER BY total_tokens"))
        .toMatchObject([{ source_identity_key: 'codex:account:account-a', total_tokens: 12 },
          { source_identity_key: 'codex:account:account-b', total_tokens: 99 }]);
      await scanner.scan();
      expect(db.all("SELECT source_key FROM usage_facts WHERE provider='codex'")).toHaveLength(2);
    } finally { db.close(); }
  } finally {
    delete process.env.TOKEN_CODEX_SESSIONS_DIR;
    delete process.env.TOKEN_CLAUDE_PROJECTS_DIR;
    workspace.cleanup();
  }
});

test('TC-092 Claude 同 UID 两文件同请求保留未归属观测、项目与重扫移动幂等', async () => {
  const workspace = createTestWorkspace('tc092-claude-files');
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    const event = (tokens: number, cwd: string) => JSON.stringify({ type: 'assistant', cwd,
      timestamp: '2026-10-02T08:00:00Z', sessionId: 'same-session', requestId: 'same-request',
      message: { model: 'claude-test', usage: { input_tokens: tokens, output_tokens: 0 } } }) + '\n';
    const first = path.join(workspace.claudeDir, 'one.jsonl');
    const moved = path.join(workspace.claudeDir, 'renamed.jsonl');
    writeFileSync(first, event(12, '/work/alpha'));
    writeFileSync(path.join(workspace.claudeDir, 'two.jsonl'), event(99, '/work/beta'));
    await scanner.scan();
    const rows = db.all(`SELECT f.source_key, f.source_identity_key, f.total_tokens, p.project_key
      FROM usage_facts f JOIN fact_projects p ON p.source_key=f.source_key
      WHERE f.provider='claude' ORDER BY f.total_tokens`);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.total_tokens)).toEqual([12, 99]);
    expect(rows[0].source_key).not.toBe(rows[1].source_key);
    expect(rows[0].source_identity_key).not.toBe(rows[1].source_identity_key);
    expect(rows[0].project_key).not.toBe(rows[1].project_key);
    expect(db.all("SELECT owner_user_id FROM source_identities WHERE key LIKE 'claude:local-file:%'"))
      .toEqual([{ owner_user_id: null }, { owner_user_id: null }]);
    expect(Number(db.one("SELECT COUNT(*) AS count FROM usage_uncertain_facts WHERE reason='local_event_identity_ambiguous'")?.count)).toBe(2);
    const admin: PublicUser = { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '' };
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
      provider: 'claude', model: '', projectKey: '', userId: 'unassigned' };
    expect(new ReportService(db, scanner).query(query, admin).accounting).toMatchObject({
      status: 'uncertain', conflictCount: 2, confirmedSubtotal: { totalTokens: 0 } });
    await scanner.scan();
    renameSync(first, moved);
    await scanner.scan();
    expect(db.all("SELECT source_key FROM usage_facts WHERE provider='claude'")).toHaveLength(2);
    expect(db.all("SELECT key FROM source_identities WHERE key LIKE 'claude:local-file:%'")).toHaveLength(2);
  } finally {
    db.close(); delete process.env.TOKEN_CODEX_SESSIONS_DIR; delete process.env.TOKEN_CLAUDE_PROJECTS_DIR;
    workspace.cleanup();
  }
});

test('TC-092 Claude 文件 inode 复用以出生代次隔离，缺失代次不继承绑定', () => {
  const uid = 501;
  const fileId = '1:42';
  const original = claudeFileKey(uid, fileId, 1234.125);
  expect(original).toBe(claudeFileKey(uid, fileId, 1234.125));
  expect(original).not.toBe(claudeFileKey(uid, fileId, 1235.125));
  expect(claudeFileKey(uid, fileId, 0)).toBeNull();
});

test('TC-092 Claude 游标同路径 inode 大小尾哈希但出生代次变化时重读且不继承旧 owner', async () => {
  const workspace = createTestWorkspace('tc092-claude-inode-reuse');
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const file = path.join(workspace.claudeDir, 'reused.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'assistant', cwd: '/work/new', timestamp: '2026-10-02T08:00:00Z',
    sessionId: 'same-session', requestId: 'same-request',
    message: { model: 'claude-test', usage: { input_tokens: 99, output_tokens: 0 } } }) + '\n');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    const stat = statSync(file);
    const fileId = `${stat.dev}:${stat.ino}`;
    const oldFileKey = claudeFileKey(os.userInfo().uid, fileId, stat.birthtimeMs - 1)!;
    const oldIdentity = `claude:local-file:${oldFileKey}`;
    const oldFactKey = scopedLocalFactKey('claude:same-session:same-request', oldIdentity);
    const bytes = readFileSync(file);
    const tail = createHash('sha256').update(bytes.subarray(Math.max(0, bytes.length - 4096))).digest('hex');
    db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      ['old-owner', 'old-owner', 'unused', 'viewer', '2026-10-02T00:00:00Z']);
    db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [oldIdentity, 'claude', 'old-file', 'old-owner']);
    db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [oldFactKey, 'claude', oldIdentity, 'same-session', 'claude-test', '2026-10-02T08:00:00Z', 12, 0, 0, 0, 12]);
    db.run('INSERT INTO source_cursors(file_path, provider, file_id, byte_offset, state_json, tail_hash, birthtime_ms, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [file, 'claude', fileId, bytes.length, JSON.stringify({ sessionId: 'same-session' }), tail,
        stat.birthtimeMs - 1, '2026-10-02T08:00:00Z']);
    await scanner.scan();
    const facts = db.all("SELECT source_identity_key, total_tokens FROM usage_facts WHERE provider='claude' ORDER BY total_tokens");
    expect(facts).toHaveLength(2);
    expect(facts.map(row => row.total_tokens)).toEqual([12, 99]);
    expect(facts[0].source_identity_key).toBe(oldIdentity);
    expect(facts[1].source_identity_key).not.toBe(oldIdentity);
    expect(db.one('SELECT owner_user_id FROM source_identities WHERE key = ?', [String(facts[1].source_identity_key)])?.owner_user_id).toBeNull();
    const viewer: PublicUser = { id: 'old-owner', username: 'old-owner', role: 'viewer', active: true, createdAt: '' };
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
      provider: 'claude', model: '', projectKey: '', userId: 'all' };
    const reports = new ReportService(db, scanner);
    expect(reports.query(query, viewer).totals.totalTokens).toBe(0);
    expect(reports.csv(query, viewer)).not.toContain('99');
    await scanner.scan();
    expect(db.all("SELECT source_key FROM usage_facts WHERE provider='claude'")).toHaveLength(2);
  } finally {
    db.close(); delete process.env.TOKEN_CODEX_SESSIONS_DIR; delete process.env.TOKEN_CLAUDE_PROJECTS_DIR;
    workspace.cleanup();
  }
});

test('TC-092 Claude 旧 UID 单文件多会话虽游标只记末会话仍逐条归档临时事实', async () => {
  const workspace = createTestWorkspace('tc092-claude-uid-migrate');
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const file = path.join(workspace.claudeDir, 'legacy.jsonl');
  writeFileSync(file, [
    { type: 'assistant', cwd: '/work/alpha', timestamp: '2026-10-02T08:00:00Z',
      sessionId: 'legacy-session-1', requestId: 'legacy-request-1',
      message: { model: 'claude-test', usage: { input_tokens: 12, output_tokens: 0 } } },
    { type: 'assistant', cwd: '/work/alpha', timestamp: '2026-10-02T09:00:00Z',
      sessionId: 'legacy-session-2', requestId: 'legacy-request-2',
      message: { model: 'claude-test', usage: { input_tokens: 13, output_tokens: 0 } } }
  ].map(line => JSON.stringify(line)).join('\n') + '\n');
  let db = await AppDatabase.open(workspace.databasePath);
  try {
    new UsageScanner(db);
    const legacyIdentity = `claude:macos:${os.userInfo().uid}`;
    const stat = statSync(file);
    const fileId = `${stat.dev}:${stat.ino}`;
    const bytes = readFileSync(file);
    const tail = createHash('sha256').update(bytes.subarray(Math.max(0, bytes.length - 4096))).digest('hex');
    db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      ['old-owner', 'old-owner', 'unused', 'viewer', '2026-10-02T00:00:00Z']);
    db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [legacyIdentity, 'claude', 'legacy', 'old-owner']);
    const project = createHash('sha256').update('/work/alpha').digest('hex').slice(0, 24);
    for (const index of [1, 2]) {
      const key = `claude:legacy-session-${index}:legacy-request-${index}`;
      const tokens = 11 + index;
      db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [key, 'claude', legacyIdentity, `legacy-session-${index}`, 'claude-test',
          `2026-10-02T0${7 + index}:00:00Z`, tokens, 0, 0, 0, tokens]);
      db.run('INSERT INTO fact_projects VALUES (?, ?, ?)', [key, project, 'alpha · work']);
    }
    db.run('INSERT INTO source_cursors(file_path, provider, file_id, byte_offset, state_json, tail_hash, birthtime_ms, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [file, 'claude', fileId, bytes.length, JSON.stringify({ sessionId: 'legacy-session-2' }), tail,
        stat.birthtimeMs, '2026-10-02T08:00:00Z']);
    db.close();
    db = await AppDatabase.open(workspace.databasePath);
    const scanner = new UsageScanner(db);
    expect(scanner.didQuarantineLegacyFacts()).toBe(true);
    expect(db.all('SELECT session_id FROM legacy_claude_cursor_evidence')).toEqual([{ session_id: 'legacy-session-2' }]);
    expect(db.one('SELECT key FROM source_identities WHERE key = ?', [legacyIdentity])).toBeNull();
    expect(db.one("SELECT COUNT(*) AS count FROM usage_uncertain_facts WHERE reason='legacy_unverified'")?.count).toBe(2);
    await scanner.scan();
    expect(db.all("SELECT source_identity_key, total_tokens FROM usage_facts WHERE provider='claude' ORDER BY total_tokens"))
      .toMatchObject([{ source_identity_key: expect.stringMatching(/^claude:local-file:/), total_tokens: 12 },
        { source_identity_key: expect.stringMatching(/^claude:local-file:/), total_tokens: 13 }]);
    expect(db.all("SELECT key FROM source_identities WHERE key LIKE 'claude:legacy-unverified:%'")).toHaveLength(0);
    expect(db.all('SELECT source_key FROM legacy_reconciled_facts')).toHaveLength(2);
    expect(db.all("SELECT actor_id FROM audit_events WHERE action='collector.legacy_fact_quarantined'"))
      .toEqual([{ actor_id: null }]);
    await scanner.scan();
    expect(db.all("SELECT source_key FROM usage_facts WHERE provider='claude'")).toHaveLength(2);
  } finally {
    db.close(); delete process.env.TOKEN_CODEX_SESSIONS_DIR; delete process.env.TOKEN_CLAUDE_PROJECTS_DIR;
    workspace.cleanup();
  }
});

test('TC-092 Claude 旧文件出生代次缺失或不符时同路径同内容新文件不归档旧事实', async () => {
  for (const birthtimeKind of ['missing', 'different'] as const) {
    const workspace = createTestWorkspace(`tc092-claude-old-${birthtimeKind}`);
    process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
    process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
    const file = path.join(workspace.claudeDir, 'replacement.jsonl');
    writeFileSync(file, JSON.stringify({ type: 'assistant', cwd: '/work/alpha',
      timestamp: '2026-10-02T08:00:00Z', sessionId: 'same-session', requestId: 'same-request',
      message: { model: 'claude-test', usage: { input_tokens: 17, output_tokens: 0 } } }) + '\n');
    let db = await AppDatabase.open(workspace.databasePath);
    try {
      new UsageScanner(db);
      const oldIdentity = `claude:macos:${os.userInfo().uid}`;
      const stat = statSync(file);
      const fileId = `${stat.dev}:${stat.ino}`;
      const bytes = readFileSync(file);
      const tail = createHash('sha256').update(bytes).digest('hex');
      db.run('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)',
        ['old-owner', 'old-owner', 'unused', 'viewer', '2026-10-02T00:00:00Z']);
      db.run('INSERT INTO source_identities VALUES (?,?,?,?)', [oldIdentity, 'claude', 'legacy', 'old-owner']);
      db.run('INSERT INTO usage_facts VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        ['claude:same-session:same-request', 'claude', oldIdentity, 'same-session', 'claude-test',
          '2026-10-02T08:00:00Z', 17, 0, 0, 0, 17]);
      db.run('INSERT INTO source_cursors(file_path,provider,file_id,byte_offset,state_json,tail_hash,birthtime_ms,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        [file, 'claude', fileId, bytes.length, JSON.stringify({ sessionId: 'same-session' }), tail,
          birthtimeKind === 'missing' ? 0 : stat.birthtimeMs - 1, '2026-10-02T08:00:00Z']);
      db.close(); db = await AppDatabase.open(workspace.databasePath);
      const scanner = new UsageScanner(db);
      expect(db.all('SELECT * FROM legacy_claude_cursor_evidence')).toHaveLength(0);
      await scanner.scan();
      expect(db.all("SELECT source_key FROM usage_facts WHERE provider='claude'")).toHaveLength(2);
      expect(db.all('SELECT * FROM legacy_reconciled_facts')).toHaveLength(0);
      expect(db.one("SELECT owner_user_id FROM source_identities WHERE key LIKE 'claude:local-file:%'")?.owner_user_id).toBeNull();
      const viewer: PublicUser = { id: 'old-owner', username: 'old-owner', role: 'viewer', active: true, createdAt: '' };
      const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
        provider: 'claude', model: '', projectKey: '', userId: 'all' };
      expect(new ReportService(db, scanner).query(query, viewer).accounting.confirmedSubtotal.totalTokens).toBe(0);
      const sync = prepareUsageSync(db, scanner, { getConnectionIdentity: () => 'synthetic' } as ServerConnection,
        scanner.didQuarantineLegacyFacts());
      expect(sync.status().pending).toBe(1);
      expect(String(db.one('SELECT payload FROM sync_outbox')?.payload)).not.toContain('old-owner');
      await scanner.scan();
      expect(db.all("SELECT source_key FROM usage_facts WHERE provider='claude'")).toHaveLength(2);
    } finally { db.close(); workspace.cleanup(); }
  }
  delete process.env.TOKEN_CODEX_SESSIONS_DIR;
  delete process.env.TOKEN_CLAUDE_PROJECTS_DIR;
});

test('TC-092 Claude 缺文件出生代次重扫保持一条待核对观测且换路径新建独立代次', async () => {
  const workspace = createTestWorkspace('tc092-claude-unknown-generation');
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const file = path.join(workspace.claudeDir, 'unknown.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'assistant', cwd: '/work/alpha',
    timestamp: '2026-10-02T08:00:00Z', sessionId: 'same-session', requestId: 'same-request',
    message: { model: 'claude-test', usage: { input_tokens: 17, output_tokens: 0 } } }) + '\n');
  const db = await AppDatabase.open(workspace.databasePath);
  const originalStat = fsp.stat.bind(fsp);
  const spy = vi.spyOn(fsp, 'stat').mockImplementation(async (...args) => {
    const stat = await originalStat(...args);
    return String(args[0]).endsWith('.jsonl') ? Object.assign(stat, { birthtimeMs: 0 }) : stat;
  });
  try {
    const scanner = new UsageScanner(db);
    await scanner.scan();
    const first = db.all("SELECT source_identity_key FROM usage_facts WHERE provider='claude'");
    expect(first).toHaveLength(1);
    expect(String(first[0].source_identity_key)).toMatch(/^claude:local-file-unknown:/);
    await scanner.scan();
    expect(db.all("SELECT source_key FROM usage_facts WHERE provider='claude'")).toHaveLength(1);
    renameSync(file, path.join(workspace.claudeDir, 'renamed.jsonl'));
    await scanner.scan();
    expect(db.all("SELECT source_identity_key FROM usage_facts WHERE provider='claude'")).toHaveLength(2);
    expect(db.all("SELECT owner_user_id FROM source_identities WHERE key LIKE 'claude:local-file-unknown:%'"))
      .toEqual([{ owner_user_id: null }, { owner_user_id: null }]);
  } finally {
    spy.mockRestore(); db.close(); workspace.cleanup();
    delete process.env.TOKEN_CODEX_SESSIONS_DIR; delete process.env.TOKEN_CLAUDE_PROJECTS_DIR;
  }
});

test('TC-092 旧本地同键疑似污染先待核对，重放纠正数值与项目且再扫幂等', async () => {
  const workspace = createTestWorkspace('tc092-local-migration');
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  let db = await AppDatabase.open(workspace.databasePath);
  try {
    new UsageScanner(db);
    for (const [account, owner] of [['account-a', 'owner-a'], ['account-b', 'owner-b']]) {
      db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        [owner, owner, 'unused', 'viewer', '2026-10-02T00:00:00Z']);
      db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [`codex:account:${account}`, 'codex', 'synthetic', owner]);
    }
    const oldKey = 'codex:same-session:same-response';
    db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [oldKey, 'codex', 'codex:account:account-a', 'same-session', 'gpt-test',
        '2026-10-02T00:00:00Z', 99, 0, 0, 0, 99]);
    db.run('INSERT INTO fact_projects VALUES (?, ?, ?)', [oldKey, 'stale-project', '错误项目']);
    db.close();
    db = await AppDatabase.open(workspace.databasePath);
    let scanner = new UsageScanner(db);
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC',
      granularity: 'day', provider: 'codex', model: '', projectKey: '', userId: 'all' };
    const viewerA: PublicUser = { id: 'owner-a', username: 'owner-a', role: 'viewer', active: true, createdAt: '' };
    expect(new ReportService(db, scanner).query(query, viewerA).accounting).toMatchObject({
      status: 'confirmed', conflictCount: 0, confirmedSubtotal: { totalTokens: 0 }
    });
    expect(new ReportService(db, scanner).query(query, viewerA).coverage[0].detail).toContain('历史用量归属已暂停');
    expect(new ReportService(db, scanner).details(query, 1, '', viewerA).total).toBe(0);
    expect(new ReportService(db, scanner).csv(query, viewerA)).not.toContain('99');
    expect(new ReportService(db, scanner).query({ ...query, userId: 'unassigned' },
      { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '' }).accounting)
      .toMatchObject({ status: 'uncertain', conflictCount: 1, confirmedSubtotal: { totalTokens: 0 } });
    expect(db.all('SELECT source_key FROM fact_projects')).toHaveLength(1);
    const event = (account: string, tokens: number, cwd?: string) => [
      { type: 'session_meta', payload: { session_id: 'same-session', creator_account_id: account,
        ...(cwd ? { cwd } : {}) } },
      { type: 'turn_context', payload: { turn_id: 'one', model: 'gpt-test' } },
      { type: 'token_usage_record', timestamp: '2026-10-02T00:00:00Z', payload: {
        session_id: 'same-session', turn_id: 'one', response_id: 'same-response',
        usage: { input_tokens: tokens, output_tokens: 0, total_tokens: tokens } } }
    ].map(row => JSON.stringify(row)).join('\n') + '\n';
    writeFileSync(path.join(workspace.codexDir, 'a.jsonl'), event('account-a', 12));
    writeFileSync(path.join(workspace.codexDir, 'b.jsonl'), event('account-b', 99, '/work/beta'));
    await scanner.scan();
    const rows = db.all(`SELECT f.source_identity_key, f.total_tokens, p.project_label FROM usage_facts f
      LEFT JOIN fact_projects p ON p.source_key=f.source_key ORDER BY f.total_tokens`);
    expect(rows).toMatchObject([
      { source_identity_key: 'codex:account:account-a', total_tokens: 12, project_label: null },
      { source_identity_key: 'codex:account:account-b', total_tokens: 99, project_label: expect.stringContaining('beta') }
    ]);
    expect(db.all('SELECT source_key FROM usage_uncertain_facts')).toHaveLength(0);
    expect(scanner.identities().some(source => source.key.includes(':legacy-unverified:'))).toBe(false);
    expect(new ReportService(db, scanner).query(query, viewerA).accounting).toMatchObject({
      status: 'confirmed', confirmedSubtotal: { totalTokens: 12 }
    });
    expect(new ReportService(db, scanner).query(query, viewerA).coverage[0].detail).not.toContain('历史用量归属已暂停');
    await scanner.scan();
    expect(db.all('SELECT source_key FROM usage_facts')).toHaveLength(2);
  } finally {
    db.close();
    delete process.env.TOKEN_CODEX_SESSIONS_DIR;
    delete process.env.TOKEN_CLAUDE_PROJECTS_DIR;
    workspace.cleanup();
  }
});

test('TC-092 旧遥测键迁移保留项目与归属，重送不双计且历史精度未知', async () => {
  const workspace = createTestWorkspace('tc092-otel-migration');
  let db = await AppDatabase.open(workspace.databasePath);
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const identityA = `codex:otel:${digest('account-a').slice(0, 20)}`;
  const oldKey = `otel:codex:${digest(['same-session', '2026-10-02T08:00:00.000Z', 'gpt-test', 10, 2, 0].join('|'))}`;
  let receiver: TelemetryReceiver | undefined;
  try {
    new UsageScanner(db);
    db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [identityA, 'codex', 'synthetic', 'owner-a']);
    db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [oldKey, 'codex', identityA, 'same-session', 'gpt-test', '2026-10-02T08:00:00.000Z', 10, 2, 0, 0, 12]);
    db.run('INSERT INTO fact_projects VALUES (?, ?, ?)', [oldKey, 'project-legacy', '旧项目']);
    db.close();
    db = await AppDatabase.open(workspace.databasePath);
    const scanner = new UsageScanner(db);
    receiver = new TelemetryReceiver(db, workspace.root, 0);
    await receiver.start();
    const migrated = db.one("SELECT source_key FROM usage_facts WHERE source_key LIKE 'otel:codex:%'");
    expect(String(migrated?.source_key)).toMatch(/^otel:codex:legacy:/);
    expect(db.one('SELECT project_label FROM fact_projects WHERE source_key = ?', [String(migrated?.source_key)])?.project_label)
      .toBe('旧项目');
    expect(db.one('SELECT reason FROM usage_uncertain_facts WHERE source_key = ?', [String(migrated?.source_key)]))
      .toBeTruthy();
    const config = receiver.configuration();
    const endpoint = config.codex.match(/endpoint = "([^\"]+)/)?.[1];
    const secret = config.codex.match(/Bearer ([a-f0-9]+)/)?.[1];
    const payload = { resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: '1790928000000000000', attributes: [
        { key: 'event.name', value: { stringValue: 'codex.sse_event' } },
        { key: 'event.kind', value: { stringValue: 'response.completed' } },
        { key: 'user.account_id', value: { stringValue: 'account-a' } },
        { key: 'conversation.id', value: { stringValue: 'same-session' } },
        { key: 'model', value: { stringValue: 'gpt-test' } },
        { key: 'input_token_count', value: { intValue: '10' } },
        { key: 'output_token_count', value: { intValue: '2' } },
        { key: 'cached_token_count', value: { intValue: '0' } }
      ]
    }] }] }] };
    const post = () => fetch(endpoint!, { method: 'POST', headers: {
      authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    const rows = db.all("SELECT f.source_key, f.source_identity_key, p.project_label FROM usage_facts f LEFT JOIN fact_projects p ON p.source_key=f.source_key WHERE f.source_key LIKE 'otel:codex:%'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source_key: expect.stringMatching(/^otel:codex:v2:/),
      source_identity_key: identityA, project_label: '旧项目' });
    const admin: PublicUser = { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '' };
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC',
      granularity: 'day', provider: 'codex', model: '', projectKey: '', userId: 'all' };
    expect(new ReportService(db, scanner).query(query, admin).accounting).toMatchObject({
      status: 'uncertain', conflictCount: 1, confirmedSubtotal: { totalTokens: 0 }
    });
  } finally { receiver?.stop(); db.close(); workspace.cleanup(); }
});

test('TC-092 缺账户 ID 的旧绑定隔离与新 unknown 不可绑定且旧上报待传被替换', async () => {
  const workspace = createTestWorkspace('tc092-unknown-owner');
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const macName = os.userInfo().username;
  const oldIdentity = `codex:otel:${digest(macName).slice(0, 20)}`;
  const oldKey = `otel:codex:${digest(['legacy-session', '2026-10-02T08:00:00.000Z', 'gpt-test', 10, 2, 0].join('|'))}`;
  const uploaded: string[] = [];
  const connection = { getConnectionIdentity: () => 'offline-test', uploadUsage: async (payload: string) => {
    uploaded.push(payload);
    throw new Error('offline');
  } } as unknown as ServerConnection;
  let db = await AppDatabase.open(workspace.databasePath);
  let receiver: TelemetryReceiver | undefined;
  try {
    let scanner = new UsageScanner(db);
    for (const [id, role] of [['admin', 'admin'], ['owner-a', 'viewer'], ['owner-b', 'viewer']]) {
      db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        [id, id, 'unused', role, '2026-10-02T00:00:00Z']);
    }
    db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [oldIdentity, 'codex', 'legacy-source', 'owner-a']);
    db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [oldKey, 'codex', oldIdentity, 'legacy-session', 'gpt-test', '2026-10-02T08:00:00.000Z', 10, 2, 0, 0, 12]);
    const oldSync = new UsageSync(db, scanner, connection);
    db.transactionDurable(() => oldSync.queueSnapshot(['codex']));
    expect(String(db.one('SELECT payload FROM sync_outbox WHERE id = 1')?.payload)).toContain('"ownerUserId":"owner-a"');
    db.close();
    db = await AppDatabase.open(workspace.databasePath);
    scanner = new UsageScanner(db);
    receiver = new TelemetryReceiver(db, workspace.root, 0);
    expect(receiver.didQuarantineLegacyIdentity()).toBe(true);
    expect(db.one('SELECT owner_user_id FROM source_identities WHERE key = ?', [oldIdentity])?.owner_user_id).toBeNull();
    expect(db.one('SELECT source_identity_key FROM usage_facts')?.source_identity_key)
      .toMatch(/^codex:otel:legacy-ambiguous:/);
    expect(db.one("SELECT actor_id FROM audit_events WHERE action='telemetry.legacy_identity_quarantined'")?.actor_id).toBeNull();
    expect(db.one('SELECT affected_user_id FROM identity_migration_events')?.affected_user_id).toBe('owner-a');
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC',
      granularity: 'day', provider: 'codex', model: '', projectKey: '', userId: 'all' };
    const viewerA: PublicUser = { id: 'owner-a', username: 'owner-a', role: 'viewer', active: true, createdAt: '' };
    const viewerB: PublicUser = { id: 'owner-b', username: 'owner-b', role: 'viewer', active: true, createdAt: '' };
    const admin: PublicUser = { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '' };
    const reports = new ReportService(db, scanner);
    expect(reports.query(query, viewerA).totals.totalTokens).toBe(0);
    expect(reports.query(query, viewerA).coverage[0].detail).toContain('历史用量归属已暂停');
    expect(reports.query(query, viewerB).totals.totalTokens).toBe(0);
    expect(reports.query({ ...query, userId: 'unassigned' }, admin).accounting).toMatchObject({
      status: 'uncertain', conflictCount: 1, confirmedSubtotal: { totalTokens: 0 }
    });
    const sync = prepareUsageSync(db, scanner, connection,
      scanner.didQuarantineLegacyFacts() || receiver.didQuarantineLegacyIdentity());
    sync.start();
    await sync.waitIdle();
    sync.stop();
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).not.toContain('"ownerUserId":"owner-a"');
    const refreshed = String(db.one('SELECT payload FROM sync_outbox WHERE id = 1')?.payload);
    expect(refreshed).not.toContain('"ownerUserId":"owner-a"');
    expect(refreshed).toContain('"accountingVersion":2');
    const binding = new SourceBindingService(db, scanner, reports, sync);
    const ambiguous = String(db.one('SELECT source_identity_key FROM usage_facts')?.source_identity_key);
    expect(() => binding.preview(ambiguous, 'owner-a', query, admin)).toThrow('账户身份无法验证');
    await receiver.start();
    const config = receiver.configuration();
    const endpoint = config.codex.match(/endpoint = "([^\"]+)/)?.[1];
    const secret = config.codex.match(/Bearer ([a-f0-9]+)/)?.[1];
    const log = (account: string | null, timeUnixNano: string, tokens: number) => ({ timeUnixNano, attributes: [
      { key: 'event.name', value: { stringValue: 'codex.sse_event' } },
      { key: 'event.kind', value: { stringValue: 'response.completed' } },
      ...(account ? [{ key: 'user.account_id', value: { stringValue: account } }] : []),
      { key: 'conversation.id', value: { stringValue: `session-${tokens}` } },
      { key: 'model', value: { stringValue: 'gpt-test' } },
      { key: 'input_token_count', value: { intValue: String(tokens) } },
      { key: 'output_token_count', value: { intValue: '0' } }
    ] });
    const body = { resourceLogs: [{ scopeLogs: [{ logRecords: [
      log(null, '1790928000000000001', 11),
      log(macName, '1790928000000000002', 5),
      log('account-b', '1790928000000000003', 99)
    ] }] }] };
    expect((await fetch(endpoint!, { method: 'POST', headers: { authorization: `Bearer ${secret}`,
      'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    const unknownOnly = { resourceLogs: [{ scopeLogs: [{ logRecords: [log(null, '1790928000000000001', 11)] }] }] };
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await fetch(endpoint!, { method: 'POST', headers: { authorization: `Bearer ${secret}`,
        'content-type': 'application/json' }, body: JSON.stringify(unknownOnly) })).status).toBe(200);
    }
    const invalidAccounts = { resourceLogs: [{ scopeLogs: [{ logRecords: [
      log('   ', '1790928000000000004', 12), log('unknown', '1790928000000000005', 13),
      log('x'.repeat(201), '1790928000000000006', 14)
    ] }] }] };
    expect((await fetch(endpoint!, { method: 'POST', headers: { authorization: `Bearer ${secret}`,
      'content-type': 'application/json' }, body: JSON.stringify(invalidAccounts) })).status).toBe(200);
    const unknown = String(db.one("SELECT key FROM source_identities WHERE key LIKE 'codex:otel:unknown:%'")?.key);
    expect(db.one('SELECT owner_user_id FROM source_identities WHERE key = ?', [unknown])?.owner_user_id).toBeNull();
    expect(Number(db.one('SELECT COUNT(*) AS count FROM usage_facts WHERE source_identity_key = ?', [unknown])?.count)).toBe(6);
    expect(() => binding.preview(unknown, 'owner-a', query, admin)).toThrow('账户身份无法验证');
    expect(db.one('SELECT owner_user_id FROM source_identities WHERE key = ?', [oldIdentity])?.owner_user_id).toBeNull();
    db.run('UPDATE source_identities SET owner_user_id = ? WHERE key = ?',
      ['owner-b', `codex:otel:${digest('account-b').slice(0, 20)}`]);
    expect(reports.query(query, viewerA).totals.totalTokens).toBe(0);
    expect(reports.query(query, viewerB).totals.totalTokens).toBe(99);
    expect(reports.csv(query, viewerA)).not.toContain('99');
  } finally { receiver?.stop(); db.close(); workspace.cleanup(); }
});

test('TC-092 旧混合身份有可证 v2 事实时保留绑定并仅隔离旧事实', async () => {
  const workspace = createTestWorkspace('tc092-mixed-owner');
  const scope = createHash('sha256').update(os.userInfo().username).digest('hex').slice(0, 20);
  const identity = `codex:otel:${scope}`;
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [identity, 'codex', 'synthetic', 'owner-a']);
    db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['otel:codex:old-sample', 'codex', identity, 'old-session', 'gpt-test', '2026-10-02T08:00:00Z', 12, 0, 0, 0, 12]);
    db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['otel:codex:v2:known:0', 'codex', identity, 'known-session', 'gpt-test', '2026-10-02T09:00:00Z', 5, 0, 0, 0, 5]);
    const receiver = new TelemetryReceiver(db, workspace.root, 0);
    expect(receiver.didQuarantineLegacyIdentity()).toBe(true);
    expect(db.one('SELECT owner_user_id FROM source_identities WHERE key = ?', [identity])?.owner_user_id).toBe('owner-a');
    const rows = db.all('SELECT source_key, source_identity_key FROM usage_facts ORDER BY occurred_at');
    expect(String(rows[0].source_identity_key)).toMatch(/^codex:otel:legacy-ambiguous:/);
    expect(rows[1]).toMatchObject({ source_key: 'otel:codex:v2:known:0', source_identity_key: identity });
    expect(db.one('SELECT affected_user_id FROM identity_migration_events')?.affected_user_id).toBe('owner-a');
    const report = new ReportService(db, scanner);
    const viewer: PublicUser = { id: 'owner-a', username: 'owner-a', role: 'viewer', active: true, createdAt: '' };
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC',
      granularity: 'day', provider: 'codex', model: '', projectKey: '', userId: 'all' };
    expect(report.query(query, viewer).totals.totalTokens).toBe(5);
    expect(report.query(query, viewer).coverage[0].detail).toContain('历史用量归属已暂停');
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-093 报表明细和 CSV v2 同源逐组小计且时区边界不漏冲突', async () => {
  const workspace = createTestWorkspace('tc093-report');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const viewer: PublicUser = { id: ownerA, username: 'viewer-a', role: 'viewer', active: true, createdAt: '' };
    for (const [identity, owner] of [['codex:local', ownerA], ['codex:otel-a', ownerA], ['codex:otel-b', ownerB]]) {
      db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [identity, 'codex', 'synthetic', owner]);
    }
    const add = (key: string, identity: string, session: string, model: string, time: string, tokens: number) =>
      db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [key, 'codex', identity, session, model, time, tokens, 0, 0, 0, tokens]);
    add('local:a', 'codex:local', 'a', 'gpt-a', '2026-10-02T10:00:00Z', 12);
    add('otel:a', 'codex:otel-a', 'a', 'gpt-a', '2026-10-02T10:01:00Z', 14);
    add('local:a-confirmed', 'codex:local', 'independent-a', 'gpt-a', '2026-10-02T10:02:00Z', 5);
    add('local:b', 'codex:local', 'b', 'gpt-b', '2026-10-02T11:00:00Z', 3);
    add('otel:b', 'codex:otel-a', 'b', 'gpt-b', '2026-10-02T11:01:00Z', 4);
    add('local:b-confirmed', 'codex:local', 'independent-b', 'gpt-b', '2026-10-02T11:02:00Z', 7);
    add('local:boundary', 'codex:local', 'boundary', 'gpt-c', '2026-10-01T23:59:00Z', 9);
    add('otel:boundary', 'codex:otel-a', 'boundary', 'gpt-c', '2026-10-02T00:01:00Z', 10);
    add('otel:other-owner', 'codex:otel-b', 'other', 'gpt-a', '2026-10-02T12:00:00Z', 99);
    const query: ReportQuery = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
      provider: 'codex', model: '', projectKey: '', userId: 'all' };
    const service = new ReportService(db, scanner);
    const summary = service.query(query, viewer);
    expect(summary.coverage.find(item => item.provider === 'codex')).toMatchObject({ fileCount: null,
      factCount: 4, telemetryFactCount: 3, lastScan: null, lastTelemetry: '2026-10-02T11:01:00Z',
      windowCoverage: { state: 'unknown', asOf: null } });
    expect(summary.coverage.find(item => item.provider === 'claude')).toBeUndefined();
    expect(summary.accounting).toMatchObject({ status: 'uncertain', conflictCount: 5,
      confirmedSubtotal: { totalTokens: 12 } });
    const details = service.details(query, 1, '', viewer, summary.snapshotId);
    expect(details.total).toBe(7);
    expect(details.records.filter(row => row.accountingStatus === 'pending')).toHaveLength(5);
    expect(details.records.every(row => row.totalTokens !== 99)).toBe(true);
    const csv = service.csv(query, viewer, summary.snapshotId).replace(/^\uFEFF/, '');
    const [header, ...body] = csv.trim().split('\r\n').map(line => line.split(','));
    expect(header).toHaveLength(14);
    expect(header.slice(10)).toEqual(['计量状态', '已确认小计 Token', '待核对来源', '待核对条数']);
    expect(body).toHaveLength(3);
    expect(body.every(row => row.length === 14 && row[10] === 'uncertain' && row.slice(4, 10).every(cell => cell === ''))).toBe(true);
    const byModel = new Map(body.map(row => [row[3].replaceAll('"', ''), row]));
    expect(byModel.get('gpt-a')?.[11]).toBe('5');
    expect(byModel.get('gpt-b')?.[11]).toBe('7');
    expect(byModel.get('gpt-c')?.[11]).toBe('0');
    expect(body.reduce((sum, row) => sum + Number(row[11]), 0)).toBe(12);
    expect(body.every(row => row[8] !== '99' && row[11] !== '99')).toBe(true);
    expect(csv).not.toContain(ownerB);
    expect(csv).not.toContain('boundary');
    const afterBoundary = service.query({ ...query, from: '2026-10-01' }, viewer);
    expect(afterBoundary.accounting.status).toBe('uncertain');
    expect(afterBoundary.accounting.confirmedSubtotal.totalTokens).toBe(12);
    add('local:far', 'codex:local', 'far-session', 'gpt-d', '2026-10-01T12:00:00Z', 9);
    add('otel:far', 'codex:otel-a', 'far-session', 'gpt-d', '2026-10-05T12:00:00Z', 10);
    const narrow = service.query({ ...query, from: '2026-10-01', to: '2026-10-01', model: 'gpt-d' }, viewer);
    expect(narrow.accounting).toMatchObject({ status: 'uncertain', conflictCount: 1,
      confirmedSubtotal: { totalTokens: 0 } });
    expect(service.csv({ ...query, from: '2026-10-01', to: '2026-10-01', model: 'gpt-d' }, viewer, narrow.snapshotId))
      .toContain('uncertain,0');
    add('local:unknown-edge', 'codex:local', 'known-edge', 'gpt-e', '2026-10-01T23:59:00Z', 1);
    add('otel:unknown-edge', 'codex:otel-a', 'unknown', 'gpt-e', '2026-10-02T00:01:00Z', 2);
    expect(service.query({ ...query, from: '2026-10-01', to: '2026-10-01', model: 'gpt-e' }, viewer).accounting)
      .toMatchObject({ status: 'uncertain', conflictCount: 1 });
  } finally { db.close(); workspace.cleanup(); }
});
