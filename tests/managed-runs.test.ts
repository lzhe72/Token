import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AppDatabase } from '../src/main/database';
import { ManagedRunService } from '../src/main/managed-runs';
import { UsageScanner } from '../src/collectors/scanner';
import { ReportService } from '../src/main/report';
import type { PublicUser, ReportQuery } from '../src/shared/types';
import { createTestWorkspace } from './support/test-workspace';

function fakeCli(root: string, lines: string[]): string {
  const file = path.join(root, `fake-cli-${Math.random().toString(16).slice(2)}`);
  const output = lines.map(line => `printf '%s\\n' '${line.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(file, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo synthetic-1.0; exit 0; fi\ncat >/dev/null\n${output}\n`, { mode: 0o700 });
  return file;
}

async function waitForEnd(service: ManagedRunService, ownerId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (service.status(ownerId).runs[0]?.status !== 'running') return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('合成 CLI 未结束');
}

test('TC-077 受管入口持久记录启动事件水位且未知账号不进入报表', async () => {
  const workspace = createTestWorkspace('tc077-managed-ledger');
  const db = await AppDatabase.open(workspace.databasePath);
  new UsageScanner(db);
  const reply = 'SYNTHETIC_PRIVATE_REPLY_7123';
  const prompt = 'SYNTHETIC_PRIVATE_PROMPT_8451';
  const cli = fakeCli(workspace.root, [
    JSON.stringify({ type: 'thread.started', thread_id: 'synthetic' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: reply } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4 } })
  ]);
  const service = new ManagedRunService(db, { codex: cli, claude: cli });
  try {
    service.start();
    const directory = fs.realpathSync(workspace.root);
    expect(() => service.launch('admin', 'codex', prompt, directory)).toThrow('请先启用');
    service.setEnabled('admin', 'codex', true);
    const id = service.launch('admin', 'codex', prompt, directory);
    await waitForEnd(service, 'admin');
    expect(service.status('admin').runs[0]).toMatchObject({ id, status: 'completed', eventCount: 3,
      usageEventCount: 1, result: reply });
    expect(service.status('other').runs).toHaveLength(0);
    expect(db.one('SELECT initiator_user_id,cli_account_verified,mode,byte_watermark FROM managed_runs WHERE id=?', [id]))
      .toMatchObject({ initiator_user_id: 'admin', cli_account_verified: 0, mode: 'exec-json-ephemeral' });
    expect(db.all('SELECT sequence,input_tokens,output_tokens FROM managed_events WHERE run_id=? ORDER BY sequence', [id]))
      .toMatchObject([{ sequence: 1, input_tokens: null }, { sequence: 2, input_tokens: null },
        { sequence: 3, input_tokens: 12, output_tokens: 4 }]);
    expect(db.one('SELECT COUNT(*) AS n FROM usage_facts')?.n).toBe(0);
    service.stop();
    db.close();
    const bytes = fs.readFileSync(workspace.databasePath).toString('utf8');
    expect(bytes).not.toContain(prompt);
    expect(bytes).not.toContain(reply);
    const reopened = await AppDatabase.open(workspace.databasePath);
    try {
      const resumed = new ManagedRunService(reopened, { codex: cli, claude: cli });
      resumed.start();
      expect(resumed.status('admin').runs[0]).toMatchObject({ status: 'completed', result: null });
      expect(resumed.status('admin').coverage).toBe('unknown');
      resumed.stop();
    } finally { reopened.close(); }
  } finally {
    try { service.stop(); } catch { /* already closed */ }
    workspace.cleanup();
  }
});

test('TC-077 格式错误与进程重启使运行及连续区段失效', async () => {
  const workspace = createTestWorkspace('tc077-managed-failure');
  const db = await AppDatabase.open(workspace.databasePath);
  const cli = fakeCli(workspace.root, ['not-json']);
  const service = new ManagedRunService(db, { codex: cli, claude: cli });
  try {
    service.start(); service.setEnabled('admin', 'codex', true);
    service.launch('admin', 'codex', 'synthetic task', fs.realpathSync(workspace.root));
    await waitForEnd(service, 'admin');
    expect(service.status('admin').runs[0]).toMatchObject({ status: 'failed', error: 'invalid_json' });
    expect(service.status('admin').coverage).toBe('unknown');
    service.stop();
    db.run("INSERT INTO managed_segments VALUES ('orphan','2026-01-01T00:00:00Z','2026-01-01T00:00:30Z',NULL,'active',NULL)");
    db.run(`INSERT INTO managed_runs(id,initiator_user_id,provider,mode,cli_version,protocol_version,project_key,
      project_label,segment_id,started_at,status) VALUES ('orphan','admin','codex','exec-json-ephemeral',
      'synthetic-1.0',1,'project','project','orphan','2026-01-01T00:00:00Z','running')`);
    const restarted = new ManagedRunService(db, { codex: cli, claude: cli });
    restarted.start();
    expect(db.one("SELECT status,error FROM managed_runs WHERE id='orphan'"))
      .toMatchObject({ status: 'interrupted', error: 'process_restarted' });
    expect(db.one("SELECT status,error FROM managed_segments WHERE id='orphan'"))
      .toMatchObject({ status: 'interrupted', error: 'process_restarted' });
    restarted.stop();
  } finally { service.stop(); db.close(); workspace.cleanup(); }
});

test('TC-077 心跳缺口锁存且重启闭合失效区段', async () => {
  const workspace = createTestWorkspace('tc077-heartbeat-gap');
  const db = await AppDatabase.open(workspace.databasePath);
  let at = '2026-10-04T00:00:00.000Z';
  const clock = () => at;
  const service = new ManagedRunService(db, undefined, clock);
  try {
    service.start();
    at = '2026-10-04T00:01:01.000Z';
    (service as unknown as { heartbeat(): void }).heartbeat();
    expect(db.one("SELECT status,error FROM managed_segments WHERE started_at='2026-10-04T00:00:00.000Z'"))
      .toMatchObject({ status: 'gap', error: 'heartbeat_gap' });
    at = '2026-10-04T00:01:02.000Z';
    (service as unknown as { heartbeat(): void }).heartbeat();
    expect(db.one("SELECT status,error FROM managed_segments WHERE started_at='2026-10-04T00:00:00.000Z'"))
      .toMatchObject({ status: 'gap', error: 'heartbeat_gap' });
    const restarted = new ManagedRunService(db, undefined, clock);
    restarted.start();
    expect(db.one("SELECT status,ended_at FROM managed_segments WHERE started_at='2026-10-04T00:00:00.000Z'"))
      .toMatchObject({ status: 'gap', ended_at: '2026-10-04T00:01:02.000Z' });
    restarted.stop();
    at = '2026-10-04T02:00:00.000Z';
    const rollback = new ManagedRunService(db, undefined, clock);
    rollback.start();
    at = '2026-10-04T01:59:59.000Z';
    (rollback as unknown as { heartbeat(): void }).heartbeat();
    expect(db.one("SELECT status,error FROM managed_segments WHERE started_at='2026-10-04T02:00:00.000Z'"))
      .toMatchObject({ status: 'gap', error: 'clock_rollback' });
    rollback.stop();
  } finally { service.stop(); db.close(); workspace.cleanup(); }
});

test('TC-077 符号链接目录拒绝且子进程仅接收固定参数和环境白名单', async () => {
  const workspace = createTestWorkspace('tc077-cli-boundary');
  const db = await AppDatabase.open(workspace.databasePath);
  const argsFile = path.join(workspace.root, 'observed-args');
  const envFile = path.join(workspace.root, 'observed-env');
  const cli = path.join(workspace.root, 'fake-cli');
  fs.writeFileSync(cli, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo synthetic-1.0; exit 0; fi\nprintf '%s\\n' "$@" > '${argsFile}'\nenv > '${envFile}'\ncat >/dev/null\nprintf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'\n`, { mode: 0o700 });
  const service = new ManagedRunService(db, { codex: cli, claude: cli });
  const original = process.env.TOKEN_UNAPPROVED_INJECTION;
  try {
    process.env.TOKEN_UNAPPROVED_INJECTION = 'synthetic-only';
    service.start(); service.setEnabled('admin', 'codex', true);
    const canonical = fs.realpathSync(workspace.root);
    const alias = path.join(workspace.root, 'outside-alias');
    fs.symlinkSync(canonical, alias);
    expect(() => service.launch('admin', 'codex', 'synthetic prompt', alias)).toThrow('符号链接');
    expect(service.status('admin').runs).toHaveLength(0);
    service.launch('admin', 'codex', 'synthetic prompt', canonical);
    await waitForEnd(service, 'admin');
    expect(fs.readFileSync(argsFile, 'utf8').trim().split('\n')).toEqual([
      'exec', '--json', '--ephemeral', '--sandbox', 'read-only', '-C', canonical, '-'
    ]);
    expect(fs.readFileSync(envFile, 'utf8')).not.toContain('TOKEN_UNAPPROVED_INJECTION');
    expect(service.status('admin').coverage).toBe('unknown');
  } finally {
    if (original === undefined) delete process.env.TOKEN_UNAPPROVED_INJECTION;
    else process.env.TOKEN_UNAPPROVED_INJECTION = original;
    service.stop(); db.close(); workspace.cleanup();
  }
});

test('TC-077 未识别事件类型携带正文时不写入账本', async () => {
  const workspace = createTestWorkspace('tc077-unknown-event');
  const db = await AppDatabase.open(workspace.databasePath);
  const secret = 'SYNTHETIC_EVENT_BODY_2618';
  const cli = fakeCli(workspace.root, [JSON.stringify({ type: secret, usage: { input_tokens: 99, output_tokens: 99 } })]);
  const service = new ManagedRunService(db, { codex: cli, claude: cli });
  try {
    service.start(); service.setEnabled('admin', 'codex', true);
    service.launch('admin', 'codex', 'synthetic task', fs.realpathSync(workspace.root));
    await waitForEnd(service, 'admin');
    expect(service.status('admin').runs[0]).toMatchObject({ status: 'failed', error: 'unknown_event', usageEventCount: 0 });
    expect(db.all('SELECT * FROM managed_events')).toHaveLength(0);
    service.stop(); db.close();
    expect(fs.readFileSync(workspace.databasePath).toString('utf8')).not.toContain(secret);
  } finally { service.stop(); workspace.cleanup(); }
});

test('TC-078 未验证账号与心跳缺口不使两个受管窗口可比', async () => {
  const workspace = createTestWorkspace('tc078-managed-unknown');
  const db = await AppDatabase.open(workspace.databasePath);
  const scanner = new UsageScanner(db);
  const report = new ReportService(db, scanner);
  const cli = fakeCli(workspace.root, [JSON.stringify({ type: 'turn.completed',
    usage: { input_tokens: 12, output_tokens: 3 } })]);
  let at = '2026-01-01T00:00:00.000Z';
  const service = new ManagedRunService(db, { codex: cli, claude: cli }, () => at);
  const actor: PublicUser = { id: 'admin', username: 'admin', role: 'superadmin', active: true, createdAt: '' };
  const query: ReportQuery = { from: '2026-01-01', to: '2026-01-01', timeZone: 'UTC',
    granularity: 'day', provider: 'codex', model: '', projectKey: '', userId: 'all' };
  try {
    service.start(); service.setEnabled('admin', 'codex', true);
    service.launch('admin', 'codex', 'synthetic first', fs.realpathSync(workspace.root));
    await waitForEnd(service, 'admin');
    at = '2026-01-02T00:00:00.000Z';
    (service as unknown as { heartbeat(): void }).heartbeat();
    service.launch('admin', 'codex', 'synthetic second', fs.realpathSync(workspace.root));
    for (let i = 0; i < 100; i++) {
      const runs = service.status('admin').runs;
      if (runs.length === 2 && runs.every(run => run.status !== 'running')) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(db.all('SELECT cli_account_verified FROM managed_runs')).toMatchObject([
      { cli_account_verified: 0 }, { cli_account_verified: 0 }
    ]);
    expect(db.one("SELECT status FROM managed_segments WHERE status='gap'")?.status).toBe('gap');
    for (const day of ['2026-01-01', '2026-01-02']) {
      const result = report.query({ ...query, from: day, to: day }, actor);
      expect(result.coverage[0].windowCoverage).toMatchObject({ state: 'unknown', asOf: null });
      expect(result.totals.totalTokens).toBe(0);
    }
    expect(service.status('admin').coverage).toBe('unknown');
  } finally { service.stop(); db.close(); workspace.cleanup(); }
});
