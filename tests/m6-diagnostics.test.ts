import { expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';

function codex() {
  return [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 's', cwd: '/private/work/Token' } }),
    JSON.stringify({ type: 'turn_context', payload: { turn_id: 't', model: 'gpt-test' } }),
    JSON.stringify({ type: 'token_usage_record', timestamp: '2026-10-02T00:00:00Z', payload: {
      session_id: 's', turn_id: 't', response_id: 'r', usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 }
    } })
  ].join('\n') + '\n';
}

test('TC-062 缺目录解析错待写完记录及未归属有独立诊断', async () => {
  const workspace = createTestWorkspace('tc062');
  const oldCodex = process.env.TOKEN_CODEX_SESSIONS_DIR;
  const oldClaude = process.env.TOKEN_CLAUDE_PROJECTS_DIR;
  process.env.TOKEN_CODEX_SESSIONS_DIR = path.join(workspace.root, 'missing-codex');
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    writeFileSync(path.join(workspace.claudeDir, 'broken.jsonl'), '{broken}\n');
    await scanner.scan();
    expect(scanner.diagnostics().find(item => item.provider === 'codex')?.reason).toBe('directory_missing');
    expect(scanner.diagnostics().find(item => item.provider === 'claude')?.reason).toBe('invalid_record');
    process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
    writeFileSync(path.join(workspace.codexDir, 'session.jsonl'), codex() + codex().split('\n')[2] + '\n' + '{unfinished');
    await scanner.scan();
    const diagnostic = scanner.diagnostics().find(item => item.provider === 'codex')!;
    expect(diagnostic.factCount).toBe(1);
    expect(diagnostic.unassignedFactCount).toBe(1);
    expect(diagnostic.pendingTailCount).toBe(1);
    expect(diagnostic.lastSuccess).not.toBeNull();
    expect(diagnostic.suggestion).toContain('待工具写完');
    expect(scanner.statuses().find(item => item.provider === 'claude')?.status).toBe('error');
  } finally {
    db.close(); workspace.cleanup();
    if (oldCodex === undefined) delete process.env.TOKEN_CODEX_SESSIONS_DIR; else process.env.TOKEN_CODEX_SESSIONS_DIR = oldCodex;
    if (oldClaude === undefined) delete process.env.TOKEN_CLAUDE_PROJECTS_DIR; else process.env.TOKEN_CLAUDE_PROJECTS_DIR = oldClaude;
  }
});

test('TC-063 诊断摘要不包含原始路径正文与项目标识', async () => {
  const workspace = createTestWorkspace('tc063');
  const oldCodex = process.env.TOKEN_CODEX_SESSIONS_DIR;
  const oldClaude = process.env.TOKEN_CLAUDE_PROJECTS_DIR;
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    writeFileSync(path.join(workspace.codexDir, 's.jsonl'), codex());
    await scanner.scan();
    const key = String(db.one('SELECT project_key FROM fact_projects')?.project_key);
    const serialized = JSON.stringify(scanner.diagnostics());
    expect(serialized).not.toContain(workspace.root);
    expect(serialized).not.toContain('/private/work/Token');
    expect(serialized).not.toContain(key);
    expect(serialized).not.toContain('prompt');
    expect(scanner.diagnostics()[0].location).toBe('~/.codex/sessions');
  } finally {
    db.close(); workspace.cleanup();
    if (oldCodex === undefined) delete process.env.TOKEN_CODEX_SESSIONS_DIR; else process.env.TOKEN_CODEX_SESSIONS_DIR = oldCodex;
    if (oldClaude === undefined) delete process.env.TOKEN_CLAUDE_PROJECTS_DIR; else process.env.TOKEN_CLAUDE_PROJECTS_DIR = oldClaude;
  }
});

test('TC-085 慢扫描真实处理数及解析失败修复重试', async () => {
  const workspace = createTestWorkspace('tc085');
  const oldCodex = process.env.TOKEN_CODEX_SESSIONS_DIR;
  const oldClaude = process.env.TOKEN_CLAUDE_PROJECTS_DIR;
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    writeFileSync(path.join(workspace.codexDir, 'a.jsonl'), '{bad}\n');
    writeFileSync(path.join(workspace.codexDir, 'b.jsonl'), codex());
    const target = scanner as unknown as { scanFile: (provider: string, file: string, onChunk?: () => void) => Promise<unknown> };
    const original = target.scanFile.bind(scanner);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const paused = new Promise<void>(resolve => { entered = resolve; });
    target.scanFile = async (provider, file, onChunk) => {
      if (file.endsWith('/b.jsonl')) { entered(); await blocked; }
      return original(provider, file, onChunk);
    };
    const scan = scanner.scan();
    await paused;
    const during = scanner.diagnostics().find(item => item.provider === 'codex')!;
    expect(during.status).toBe('scanning');
    expect(during.progress).toMatchObject({ phase: 'reading', processedFiles: 1, discoveredFiles: 2 });
    expect(Number.isNaN(Date.parse(during.progress!.lastProgressAt))).toBe(false);
    expect(JSON.stringify(during)).not.toContain(workspace.root);
    release();
    await scan;
    expect(scanner.diagnostics().find(item => item.provider === 'codex')?.reason).toBe('invalid_record');
    writeFileSync(path.join(workspace.codexDir, 'a.jsonl'), codex());
    await scanner.scan();
    const repaired = scanner.diagnostics().find(item => item.provider === 'codex')!;
    expect(repaired.progress).toBeUndefined();
    expect(repaired.reason).toBe('ok');
    expect(repaired.factCount).toBe(1);
  } finally {
    db.close(); workspace.cleanup();
    if (oldCodex === undefined) delete process.env.TOKEN_CODEX_SESSIONS_DIR; else process.env.TOKEN_CODEX_SESSIONS_DIR = oldCodex;
    if (oldClaude === undefined) delete process.env.TOKEN_CLAUDE_PROJECTS_DIR; else process.env.TOKEN_CLAUDE_PROJECTS_DIR = oldClaude;
  }
});
