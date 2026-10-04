import { expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';

async function fixture(label: string, run: (db: AppDatabase, scanner: UsageScanner, dirs: { codex: string; claude: string }) => Promise<void>) {
  const workspace = createTestWorkspace(label);
  const oldCodex = process.env.TOKEN_CODEX_SESSIONS_DIR;
  const oldClaude = process.env.TOKEN_CLAUDE_PROJECTS_DIR;
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const db = await AppDatabase.open(workspace.databasePath);
  try { await run(db, new UsageScanner(db), { codex: workspace.codexDir, claude: workspace.claudeDir }); }
  finally {
    db.close(); workspace.cleanup();
    if (oldCodex === undefined) delete process.env.TOKEN_CODEX_SESSIONS_DIR; else process.env.TOKEN_CODEX_SESSIONS_DIR = oldCodex;
    if (oldClaude === undefined) delete process.env.TOKEN_CLAUDE_PROJECTS_DIR; else process.env.TOKEN_CLAUDE_PROJECTS_DIR = oldClaude;
  }
}

function codex(session: string, cwd?: string) {
  return [
    { type: 'session_meta', payload: { session_id: session, ...(cwd ? { cwd } : {}) } },
    { type: 'turn_context', payload: { turn_id: 't', model: 'gpt-test' } },
    { type: 'token_usage_record', timestamp: '2026-10-02T00:00:00Z', payload: {
      session_id: session, turn_id: 't', response_id: 'r', usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 }
    } }
  ].map(value => JSON.stringify(value)).join('\n') + '\n';
}

function claude(session: string, cwd?: string) {
  return [
    { type: 'user', ...(cwd ? { cwd } : {}), timestamp: '2026-10-02T00:00:00Z' },
    { type: 'assistant', timestamp: '2026-10-02T00:01:00Z', sessionId: session, requestId: 'r',
      message: { model: 'claude-test', usage: { input_tokens: 2, output_tokens: 3 } } }
  ].map(value => JSON.stringify(value)).join('\n') + '\n';
}

test('TC-050 Codex cwd 归属与缺失项目保持未知', async () => {
  await fixture('tc050', async (db, scanner, dirs) => {
    writeFileSync(path.join(dirs.codex, 'known.jsonl'), codex('known', '/work/alpha'));
    writeFileSync(path.join(dirs.codex, 'unknown.jsonl'), codex('unknown'));
    await scanner.scan();
    const known = db.one("SELECT p.project_key, p.project_label FROM fact_projects p JOIN usage_facts f ON f.source_key=p.source_key WHERE f.session_id='known'");
    expect(String(known?.project_key)).toMatch(/^[a-f0-9]{24}$/);
    expect(String(known?.project_label)).toContain('alpha');
    expect(db.one("SELECT p.* FROM fact_projects p JOIN usage_facts f ON f.source_key=p.source_key WHERE f.session_id='unknown'")).toBeNull();
    expect(scanner.diagnostics().find(row => row.provider === 'codex')?.unknownProjectCount).toBe(1);
  });
});

test('TC-051 Claude cwd 和子代理文件独立归属', async () => {
  await fixture('tc051', async (db, scanner, dirs) => {
    writeFileSync(path.join(dirs.claude, 'parent.jsonl'), claude('parent', '/work/alpha'));
    writeFileSync(path.join(dirs.claude, 'subagent.jsonl'), claude('subagent', '/work/beta'));
    writeFileSync(path.join(dirs.claude, 'unknown.jsonl'), claude('unknown'));
    await scanner.scan();
    const rows = db.all("SELECT f.session_id, p.project_key FROM usage_facts f LEFT JOIN fact_projects p ON p.source_key=f.source_key WHERE f.provider='claude' ORDER BY f.session_id");
    expect(rows.map(row => row.session_id)).toEqual(['parent', 'subagent', 'unknown']);
    expect(rows[0].project_key).not.toBe(rows[1].project_key);
    expect(rows[2].project_key).toBeNull();
  });
});

test('TC-052 同名路径不合并且外发摘要无项目标识', async () => {
  await fixture('tc052', async (db, scanner, dirs) => {
    writeFileSync(path.join(dirs.codex, 'one.jsonl'), codex('one', '/work/acme/Token'));
    writeFileSync(path.join(dirs.codex, 'two.jsonl'), codex('two', '/work/other/Token'));
    await scanner.scan();
    const rows = db.all('SELECT project_key, project_label FROM fact_projects ORDER BY project_key');
    expect(rows).toHaveLength(2);
    expect(rows[0].project_key).not.toBe(rows[1].project_key);
    expect(rows[0].project_label).not.toBe(rows[1].project_label);
    db.run("INSERT INTO usage_facts VALUES ('legacy', 'codex', 'codex:local', 'legacy', 'gpt-test', '2026-10-02T00:00:00Z', 1, 0, 0, 0, 1)");
    const diagnostic = JSON.stringify(scanner.diagnostics());
    expect(diagnostic).not.toContain('/work/');
    for (const row of rows) expect(diagnostic).not.toContain(String(row.project_key));
    expect(scanner.diagnostics().find(item => item.provider === 'codex')?.unknownProjectCount).toBe(1);
  });
});
