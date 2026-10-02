import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { UsageScanner } from '../src/collectors/scanner';
import { AppDatabase } from '../src/main/database';
import { ReportService } from '../src/main/report';
import type { PublicUser, ReportQuery } from '../src/shared/types';
import { createTestWorkspace } from './support/test-workspace';

const admin: PublicUser = { id: 'admin', username: 'admin', role: 'admin', active: true, createdAt: '2026-01-01T00:00:00Z' };
const query: ReportQuery = { from: '2026-01-01', to: '2026-01-01', timeZone: 'UTC', granularity: 'day',
  provider: 'all', model: '', projectKey: '', userId: 'all' };

function lines(...events: object[]): string {
  return events.map(event => JSON.stringify(event)).join('\n') + '\n';
}

test('TC-073 Codex fallback 跨扫描替换与旧库修复保持幂等', async () => {
  const incremental = createTestWorkspace('tc073-incremental');
  process.env.TOKEN_CODEX_SESSIONS_DIR = incremental.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = incremental.claudeDir;
  let db = await AppDatabase.open(incremental.databasePath);
  try {
    const file = path.join(incremental.codexDir, 'session.jsonl');
    writeFileSync(file, lines(
      { type: 'session_meta', payload: { session_id: 'codex-session', cwd: '/work/project-one' } },
      { type: 'turn_context', payload: { turn_id: 'turn-one', model: 'gpt-test' } },
      { type: 'event_msg', timestamp: '2026-01-01T12:00:00Z', payload: { type: 'token_count',
        info: { last_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } } }
    ));
    let scanner = new UsageScanner(db);
    await scanner.scan();
    expect(db.all("SELECT source_key, total_tokens FROM usage_facts WHERE provider='codex'"))
      .toMatchObject([{ source_key: expect.stringContaining('codex:fallback:'), total_tokens: 12 }]);

    appendFileSync(file, lines({ type: 'token_usage_record', timestamp: '2026-01-01T12:00:00Z',
      payload: { session_id: 'codex-session', turn_id: 'turn-one', response_id: 'response-one',
        usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2, total_tokens: 12 } } }));
    const originalRun = db.run.bind(db);
    const failedCursor = vi.spyOn(db, 'run').mockImplementation((sql, params) => {
      if (sql.includes('INSERT INTO source_cursors')) throw new Error('synthetic cursor write failure');
      originalRun(sql, params);
    });
    try { await scanner.scan(); }
    finally { failedCursor.mockRestore(); }
    expect(db.all("SELECT source_key FROM usage_facts WHERE provider='codex'")).toMatchObject([
      { source_key: expect.stringContaining('codex:fallback:') }
    ]);
    await scanner.scan();
    expect(db.all("SELECT source_key, total_tokens FROM usage_facts WHERE provider='codex'"))
      .toMatchObject([{ source_key: 'codex:codex-session:response-one', total_tokens: 12 }]);
    let report = new ReportService(db, scanner);
    expect(report.query(query, admin).totals.totalTokens).toBe(12);
    expect(report.details(query, 1, '', admin).total).toBe(1);
    expect(report.csv(query, admin).trim().split('\r\n')[1]).toMatch(/,12,1$/);
    writeFileSync(path.join(incremental.codexDir, 'later-copy.jsonl'), lines(
      { type: 'session_meta', payload: { session_id: 'codex-session' } },
      { type: 'event_msg', timestamp: '2026-01-01T12:00:00Z', payload: { type: 'token_count',
        info: { last_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } } }
    ));
    await scanner.scan();
    expect(db.all("SELECT source_key FROM usage_facts WHERE provider='codex'")).toHaveLength(1);
    db.close();
    db = await AppDatabase.open(incremental.databasePath);
    scanner = new UsageScanner(db);
    await scanner.scan();
    report = new ReportService(db, scanner);
    expect(report.query(query, admin).totals.totalTokens).toBe(12);
    expect(db.all("SELECT source_key FROM usage_facts WHERE provider='codex'")).toHaveLength(1);
  } finally {
    db.close();
    delete process.env.TOKEN_CODEX_SESSIONS_DIR;
    delete process.env.TOKEN_CLAUDE_PROJECTS_DIR;
    incremental.cleanup();
  }

  const legacy = createTestWorkspace('tc073-legacy');
  process.env.TOKEN_CODEX_SESSIONS_DIR = legacy.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = legacy.claudeDir;
  db = await AppDatabase.open(legacy.databasePath);
  try {
    new UsageScanner(db);
    db.run("INSERT INTO source_identities VALUES ('codex:local', 'codex', 'Codex', NULL)");
    db.run("INSERT INTO source_identities VALUES ('claude:local', 'claude', 'Claude', NULL)");
    const insert = (key: string, provider: string, identity: string, session: string, total: number) =>
      db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [key, provider, identity, session, 'model-test', '2026-01-01T12:00:00Z', total, 0, 0, 0, total]);
    insert('codex:target:response-one', 'codex', 'codex:local', 'target', 16);
    insert('codex:fallback:target:99', 'codex', 'codex:local', 'target', 12);
    insert('codex:fallback:other:100', 'codex', 'codex:local', 'other', 7);
    insert('claude:session:request', 'claude', 'claude:local', 'claude-session', 9);
    for (const key of ['codex:target:response-one', 'codex:fallback:target:99',
      'codex:fallback:other:100', 'claude:session:request']) {
      db.run('INSERT INTO fact_projects VALUES (?, ?, ?)', [key, `project-${key.length}`, `项目 ${key.length}`]);
    }
    db.run("INSERT INTO source_status(provider, status, file_count, fact_count) VALUES ('codex', 'ready', 1, 3)");
    db.close();
    db = await AppDatabase.open(legacy.databasePath);
    const legacyRun = db.run.bind(db);
    const failedRepair = vi.spyOn(db, 'run').mockImplementation((sql, params) => {
      if (sql.startsWith('DELETE FROM usage_facts')) throw new Error('synthetic repair failure');
      legacyRun(sql, params);
    });
    try { expect(() => new UsageScanner(db)).toThrow('synthetic repair failure'); }
    finally { failedRepair.mockRestore(); }
    expect(db.all('SELECT source_key FROM usage_facts')).toHaveLength(4);
    expect(db.all('SELECT source_key FROM fact_projects')).toHaveLength(4);
    let scanner = new UsageScanner(db);
    expect(db.all('SELECT source_key FROM usage_facts ORDER BY source_key').map(row => row.source_key)).toEqual([
      'claude:session:request', 'codex:fallback:other:100', 'codex:target:response-one'
    ]);
    expect(db.all('SELECT source_key FROM fact_projects ORDER BY source_key').map(row => row.source_key)).toEqual([
      'claude:session:request', 'codex:fallback:other:100', 'codex:target:response-one'
    ]);
    expect(db.all('SELECT key FROM source_identities ORDER BY key')).toHaveLength(2);
    expect(db.one("SELECT fact_count FROM source_status WHERE provider='codex'")?.fact_count).toBe(2);
    let report = new ReportService(db, scanner);
    expect(report.query(query, admin).totals.totalTokens).toBe(32);
    await scanner.scan();
    db.close();
    db = await AppDatabase.open(legacy.databasePath);
    scanner = new UsageScanner(db);
    report = new ReportService(db, scanner);
    expect(report.query(query, admin).totals.totalTokens).toBe(32);
    expect(db.all('SELECT source_key FROM usage_facts')).toHaveLength(3);
  } finally {
    db.close();
    delete process.env.TOKEN_CODEX_SESSIONS_DIR;
    delete process.env.TOKEN_CLAUDE_PROJECTS_DIR;
    legacy.cleanup();
  }
});

test('TC-073 大会话无 fallback 时启动修复保持线性耗时', async () => {
  const workspace = createTestWorkspace('tc073-large-session');
  let db = await AppDatabase.open(workspace.databasePath);
  try {
    new UsageScanner(db);
    db.run("INSERT INTO source_identities VALUES ('codex:local', 'codex', 'Codex', NULL)");
    db.transaction(() => {
      for (let index = 0; index < 6000; index++) {
        db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          `codex:large:${index}`, 'codex', 'codex:local', 'large-session', 'gpt-test',
          '2026-01-01T12:00:00Z', 1, 0, 0, 0, 1
        ]);
      }
    });
    db.close();
    db = await AppDatabase.open(workspace.databasePath);
    const started = performance.now();
    new UsageScanner(db);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(db.one('SELECT COUNT(*) AS count FROM usage_facts')?.count).toBe(6000);
  } finally {
    db.close();
    workspace.cleanup();
  }
}, 15000);
