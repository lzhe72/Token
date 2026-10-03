import { expect, test, vi } from 'vitest';
import fs from 'node:fs';
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

test('TC-085 取消等待当前文件提交且续扫不重复或上报残缺快照', async () => {
  const workspace = createTestWorkspace('tc085-cancel');
  const previousCodex = process.env.TOKEN_CODEX_SESSIONS_DIR;
  const previousClaude = process.env.TOKEN_CLAUDE_PROJECTS_DIR;
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    for (const name of ['a', 'b', 'c']) writeFileSync(path.join(workspace.codexDir, `${name}.jsonl`),
      codex().replaceAll('"session_id":"s"', `"session_id":"${name}"`)
        .replaceAll('"response_id":"r"', `"response_id":"${name}"`));
    const scanner = new UsageScanner(db);
    let uploads = 0;
    scanner.setAfterScan(async () => { uploads++; });
    const target = scanner as unknown as { scanFile: (provider: string, file: string, onChunk?: () => void) => Promise<unknown> };
    const original = target.scanFile.bind(scanner);
    let entered!: () => void;
    let release!: () => void;
    const paused = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    target.scanFile = async (provider, file, onChunk) => {
      if (file.endsWith('/b.jsonl')) { entered(); await blocked; }
      return original(provider, file, onChunk);
    };
    const scan = scanner.scan();
    await paused;
    expect(scanner.scan()).toBe(scan);
    expect(scanner.cancelScan()).toBe(true);
    expect(scanner.cancelScan()).toBe(true);
    expect(scanner.scanProgress()[0].progress.phase).toBe('cancelling');
    release();
    await scan;
    expect(scanner.cancelScan()).toBe(false);
    expect(uploads).toBe(0);
    expect(db.one('SELECT COUNT(*) AS count FROM source_cursors')?.count).toBe(2);
    expect(db.one('SELECT COUNT(*) AS count FROM usage_facts')?.count).toBe(2);
    expect(scanner.diagnostics()[0]).toMatchObject({ status: 'cancelled', reason: 'scan_cancelled', fileCount: 2,
      lastSuccess: null });
    expect(scanner.statuses()[1].status).toBe('idle');
    await scanner.scan();
    expect(uploads).toBe(1);
    expect(db.one('SELECT COUNT(*) AS count FROM source_cursors')?.count).toBe(3);
    expect(db.one('SELECT COUNT(*) AS count FROM usage_facts')?.count).toBe(3);
    expect(scanner.diagnostics()[0].reason).toBe('ok');
    expect(scanner.diagnostics()[0].lastSuccess).not.toBeNull();
  } finally {
    db.close(); workspace.cleanup();
    if (previousCodex === undefined) delete process.env.TOKEN_CODEX_SESSIONS_DIR; else process.env.TOKEN_CODEX_SESSIONS_DIR = previousCodex;
    if (previousClaude === undefined) delete process.env.TOKEN_CLAUDE_PROJECTS_DIR; else process.env.TOKEN_CLAUDE_PROJECTS_DIR = previousClaude;
  }
});

test('TC-085 第二个工具取消不把首个工具成功误作完整扫描', async () => {
  const workspace = createTestWorkspace('tc085-second');
  const previousCodex = process.env.TOKEN_CODEX_SESSIONS_DIR;
  const previousClaude = process.env.TOKEN_CLAUDE_PROJECTS_DIR;
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    writeFileSync(path.join(workspace.codexDir, 'a.jsonl'), codex());
    writeFileSync(path.join(workspace.claudeDir, 'a.jsonl'), JSON.stringify({ type: 'assistant', timestamp: '2026-10-02T00:00:00Z',
      sessionId: 'claude-a', requestId: 'r', message: { model: 'claude-test', usage: { input_tokens: 1, output_tokens: 1 } } }) + '\n');
    const scanner = new UsageScanner(db);
    let uploads = 0;
    scanner.setAfterScan(async () => { uploads++; });
    const target = scanner as unknown as { scanFile: (provider: string, file: string, onChunk?: () => void) => Promise<unknown> };
    const original = target.scanFile.bind(scanner);
    let entered!: () => void;
    let release!: () => void;
    const paused = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    target.scanFile = async (provider, file, onChunk) => {
      if (provider === 'claude') { entered(); await blocked; }
      return original(provider, file, onChunk);
    };
    const scan = scanner.scan();
    await paused;
    expect(scanner.statuses()[0].status).toBe('ready');
    expect(scanner.cancelScan()).toBe(true);
    release();
    await scan;
    expect(scanner.statuses()[0].status).toBe('ready');
    expect(scanner.statuses()[1].status).toBe('cancelled');
    expect(uploads).toBe(0);
  } finally {
    db.close(); workspace.cleanup();
    if (previousCodex === undefined) delete process.env.TOKEN_CODEX_SESSIONS_DIR; else process.env.TOKEN_CODEX_SESSIONS_DIR = previousCodex;
    if (previousClaude === undefined) delete process.env.TOKEN_CLAUDE_PROJECTS_DIR; else process.env.TOKEN_CLAUDE_PROJECTS_DIR = previousClaude;
  }
});

test('TC-085 发现目录阶段取消后不读取任何记录文件', async () => {
  const workspace = createTestWorkspace('tc085-discovery');
  const previousCodex = process.env.TOKEN_CODEX_SESSIONS_DIR;
  const previousClaude = process.env.TOKEN_CLAUDE_PROJECTS_DIR;
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    writeFileSync(path.join(workspace.codexDir, 'a.jsonl'), codex());
    const scanner = new UsageScanner(db);
    const original = fs.promises.readdir.bind(fs.promises);
    let entered!: () => void;
    let release!: () => void;
    const paused = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(fs.promises, 'readdir').mockImplementation((async (dir: string, options?: object) => {
      if (dir === workspace.codexDir) { entered(); await blocked; }
      return original(dir, options);
    }) as typeof fs.promises.readdir);
    const scan = scanner.scan();
    await paused;
    expect(scanner.scanProgress()[0].progress.phase).toBe('discovering');
    expect(scanner.cancelScan()).toBe(true);
    release();
    await scan;
    expect(db.one('SELECT COUNT(*) AS count FROM source_cursors')?.count).toBe(0);
    expect(db.one('SELECT COUNT(*) AS count FROM usage_facts')?.count).toBe(0);
    expect(scanner.diagnostics()[0]).toMatchObject({ status: 'cancelled', reason: 'scan_cancelled', fileCount: 0 });
  } finally {
    vi.restoreAllMocks();
    db.close(); workspace.cleanup();
    if (previousCodex === undefined) delete process.env.TOKEN_CODEX_SESSIONS_DIR; else process.env.TOKEN_CODEX_SESSIONS_DIR = previousCodex;
    if (previousClaude === undefined) delete process.env.TOKEN_CLAUDE_PROJECTS_DIR; else process.env.TOKEN_CLAUDE_PROJECTS_DIR = previousClaude;
  }
});

test('TC-085 文件持久化失败后事实与游标一起回滚并可续扫', async () => {
  const workspace = createTestWorkspace('tc085-durable');
  const previousCodex = process.env.TOKEN_CODEX_SESSIONS_DIR;
  const previousClaude = process.env.TOKEN_CLAUDE_PROJECTS_DIR;
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    writeFileSync(path.join(workspace.codexDir, 'a.jsonl'), codex());
    const scanner = new UsageScanner(db);
    const rename = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === workspace.databasePath) {
        spy.mockRestore();
        throw new Error('synthetic disk failure');
      }
      return rename(from, to);
    });
    await scanner.scan();
    expect(db.one('SELECT COUNT(*) AS count FROM source_cursors')?.count).toBe(0);
    expect(db.one('SELECT COUNT(*) AS count FROM usage_facts')?.count).toBe(0);
    expect(scanner.diagnostics()[0].reason).toBe('unreadable_file');
    await scanner.scan();
    expect(db.one('SELECT COUNT(*) AS count FROM source_cursors')?.count).toBe(1);
    expect(db.one('SELECT COUNT(*) AS count FROM usage_facts')?.count).toBe(1);
  } finally {
    vi.restoreAllMocks();
    db.close(); workspace.cleanup();
    if (previousCodex === undefined) delete process.env.TOKEN_CODEX_SESSIONS_DIR; else process.env.TOKEN_CODEX_SESSIONS_DIR = previousCodex;
    if (previousClaude === undefined) delete process.env.TOKEN_CLAUDE_PROJECTS_DIR; else process.env.TOKEN_CLAUDE_PROJECTS_DIR = previousClaude;
  }
});
