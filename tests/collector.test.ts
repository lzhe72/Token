import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';

const tempPaths: string[] = [];

afterEach(() => {
  delete process.env.TOKEN_CODEX_SESSIONS_DIR;
  delete process.env.TOKEN_CLAUDE_PROJECTS_DIR;
  for (const dir of tempPaths.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function jsonl(...events: object[]): string {
  return events.map(event => JSON.stringify(event)).join('\n') + '\n';
}

test('两个采集器按请求去重，重扫和增量扫描不重复计数', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'token-collector-'));
  tempPaths.push(root);
  const codexDir = path.join(root, 'codex');
  const claudeDir = path.join(root, 'claude');
  mkdirSync(codexDir);
  mkdirSync(claudeDir);
  process.env.TOKEN_CODEX_SESSIONS_DIR = codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = claudeDir;
  const codexFile = path.join(codexDir, 'session.jsonl');
  const claudeFile = path.join(claudeDir, 'session.jsonl');
  writeFileSync(codexFile, jsonl(
    { type: 'session_meta', payload: { session_id: 'c1', creator_account_id: 'account123456' } },
    { type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-test' } },
    { type: 'event_msg', timestamp: '2026-01-01T12:00:00Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } } },
    { type: 'token_usage_record', timestamp: '2026-01-01T12:00:00Z', payload: { session_id: 'c1', turn_id: 't1', response_id: 'r1', usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2, total_tokens: 12 } } }
  ));
  const claudeEvent = (output: number) => ({
    type: 'assistant', timestamp: '2026-01-01T13:00:00Z', sessionId: 'a1', requestId: 'req1',
    message: { id: 'msg1', model: 'claude-test', usage: { input_tokens: 1, output_tokens: output, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 } }
  });
  writeFileSync(claudeFile, jsonl(claudeEvent(3), claudeEvent(4), claudeEvent(4)));
  const db = await AppDatabase.open(path.join(root, 'token.sqlite'));
  const scanner = new UsageScanner(db);
  await scanner.scan();
  expect(scanner.statuses().map(status => status.factCount)).toEqual([1, 1]);
  expect(db.one("SELECT total_tokens, cache_read_tokens, model FROM usage_facts WHERE provider = 'codex'")).toMatchObject({ total_tokens: 12, cache_read_tokens: 4, model: 'gpt-test' });
  expect(db.one("SELECT total_tokens, cache_read_tokens, cache_creation_tokens FROM usage_facts WHERE provider = 'claude'")).toMatchObject({ total_tokens: 30, cache_read_tokens: 20, cache_creation_tokens: 5 });
  await scanner.scan();
  expect(Number(db.one('SELECT COUNT(*) AS count FROM usage_facts')?.count)).toBe(2);
  appendFileSync(codexFile, jsonl({ type: 'token_usage_record', timestamp: '2026-01-02T12:00:00Z', payload: { session_id: 'c1', turn_id: 't1', response_id: 'r2', usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 } } }));
  appendFileSync(claudeFile, jsonl(claudeEvent(6)));
  await scanner.scan();
  expect(scanner.statuses().map(status => status.factCount)).toEqual([2, 1]);
  expect(db.one("SELECT total_tokens FROM usage_facts WHERE provider = 'claude'")?.total_tokens).toBe(32);
  const identity = scanner.identities().find(value => value.provider === 'codex');
  expect(identity?.key).toBe('codex:account:account123456');
  db.close();
});

test('未写完的末行等待补齐，截断重写后不重复统计', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'token-rotation-'));
  tempPaths.push(root);
  const codexDir = path.join(root, 'codex');
  const claudeDir = path.join(root, 'claude');
  mkdirSync(codexDir);
  mkdirSync(claudeDir);
  process.env.TOKEN_CODEX_SESSIONS_DIR = codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = claudeDir;
  const file = path.join(codexDir, 'session.jsonl');
  const event = (response: string) => ({ type: 'token_usage_record', timestamp: '2026-01-01T12:00:00Z',
    payload: { session_id: 's1', response_id: response, usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } });
  writeFileSync(file, jsonl(event('r1')));
  const db = await AppDatabase.open(path.join(root, 'token.sqlite'));
  const scanner = new UsageScanner(db);
  await scanner.scan();
  expect(scanner.statuses()[0].factCount).toBe(1);
  const second = JSON.stringify(event('r2'));
  appendFileSync(file, second.slice(0, 30));
  await scanner.scan();
  expect(scanner.statuses()[0].factCount).toBe(1);
  appendFileSync(file, second.slice(30) + '\n');
  await scanner.scan();
  expect(scanner.statuses()[0].factCount).toBe(2);
  writeFileSync(file, jsonl(event('r1'), event('r3')));
  await scanner.scan();
  expect(scanner.statuses()[0].factCount).toBe(3);
  db.close();
});

test('空目录、错误字段及不可读文件显示可辨认的状态', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'token-errors-'));
  tempPaths.push(root);
  const codexDir = path.join(root, 'codex');
  const claudeDir = path.join(root, 'claude');
  mkdirSync(codexDir);
  mkdirSync(claudeDir);
  process.env.TOKEN_CODEX_SESSIONS_DIR = codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = claudeDir;
  const db = await AppDatabase.open(path.join(root, 'token.sqlite'));
  const scanner = new UsageScanner(db);
  await scanner.scan();
  expect(scanner.statuses().map(status => status.status)).toEqual(['no_records', 'no_records']);
  const bad = path.join(codexDir, 'bad.jsonl');
  writeFileSync(bad, jsonl({ type: 'token_usage_record', timestamp: '2026-01-01T00:00:00Z',
    payload: { usage: { input_tokens: 'unknown', output_tokens: 2 } } }));
  await scanner.scan();
  expect(scanner.statuses()[0]).toMatchObject({ status: 'error', factCount: 0 });
  expect(scanner.statuses()[0].detail).toContain('无法解析');
  const unreadable = path.join(claudeDir, 'private.jsonl');
  writeFileSync(unreadable, jsonl({ type: 'assistant' }));
  chmodSync(unreadable, 0o000);
  try {
    await scanner.scan();
    expect(scanner.statuses()[0].status).toBe('error');
    expect(scanner.statuses()[1].status).toBe('error');
    expect(scanner.statuses()[1].detail).toContain('文件读取失败');
  } finally {
    chmodSync(unreadable, 0o600);
    db.close();
  }
});

test('模型切换与 Claude 子代理记录按实际模型归档', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'token-model-switch-'));
  tempPaths.push(root);
  const codexDir = path.join(root, 'codex');
  const claudeDir = path.join(root, 'claude');
  mkdirSync(codexDir);
  mkdirSync(claudeDir);
  process.env.TOKEN_CODEX_SESSIONS_DIR = codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = claudeDir;
  writeFileSync(path.join(codexDir, 'session.jsonl'), jsonl(
    { type: 'session_meta', payload: { session_id: 's1' } },
    { type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-a' } },
    { type: 'token_usage_record', timestamp: '2026-01-01T00:00:00Z', payload: { session_id: 's1', turn_id: 't1', response_id: 'r1', usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2, total_tokens: 12 } } },
    { type: 'turn_context', payload: { turn_id: 't2', model: 'gpt-b' } },
    { type: 'token_usage_record', timestamp: '2026-01-01T01:00:00Z', payload: { session_id: 's1', turn_id: 't2', response_id: 'r2', usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } } }
  ));
  writeFileSync(path.join(claudeDir, 'session.jsonl'), jsonl(
    { type: 'assistant', timestamp: '2026-01-01T02:00:00Z', sessionId: 's2', requestId: 'r1', message: { model: 'claude-a', usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } } },
    { type: 'assistant', isSidechain: true, agentId: 'agent-1', timestamp: '2026-01-01T03:00:00Z', sessionId: 's2', requestId: 'r2', message: { model: 'claude-b', usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 5 } } }
  ));
  const db = await AppDatabase.open(path.join(root, 'token.sqlite'));
  const scanner = new UsageScanner(db);
  await scanner.scan();
  expect(db.all('SELECT provider, model, total_tokens FROM usage_facts ORDER BY provider, model'))
    .toMatchObject([
      { provider: 'claude', model: 'claude-a', total_tokens: 10 },
      { provider: 'claude', model: 'claude-b', total_tokens: 14 },
      { provider: 'codex', model: 'gpt-a', total_tokens: 12 },
      { provider: 'codex', model: 'gpt-b', total_tokens: 8 }
    ]);
  db.close();
});
