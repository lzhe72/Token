import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';
import { ReportService } from '../src/main/report';
import { createTestWorkspace } from './support/test-workspace';

test('TC-096 Claude 单用户本地来源自动归属、手动解除及异常隔离', async () => {
  const workspace = createTestWorkspace('tc096-single-user');
  const previousCodex = process.env.TOKEN_CODEX_SESSIONS_DIR;
  const previousClaude = process.env.TOKEN_CLAUDE_PROJECTS_DIR;
  process.env.TOKEN_CODEX_SESSIONS_DIR = workspace.codexDir;
  process.env.TOKEN_CLAUDE_PROJECTS_DIR = workspace.claudeDir;
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db, true);
    const writeClaude = (name: string, tokens: number) => writeFileSync(path.join(workspace.claudeDir, `${name}.jsonl`),
      JSON.stringify({ type: 'assistant', timestamp: '2026-10-02T08:00:00Z',
        sessionId: name, requestId: 'r', message: { model: 'claude-test',
          usage: { input_tokens: tokens, output_tokens: 0 } } }) + '\n');
    writeClaude('before-setup', 12);
    await scanner.scan();
    const first = scanner.identities().find(item => item.key.startsWith('claude:local-file:'))!;
    expect(first.ownerUserId).toBeNull();

    const adminId = randomUUID();
    db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      [adminId, 'admin', 'unused', 'admin', '2026-10-02T00:00:00Z']);
    expect(scanner.assignKnownLocalSources()).toBe(1);
    expect(scanner.identities().find(item => item.key === first.key)?.ownerUserId).toBe(adminId);
    expect(db.all('SELECT actor_id, evidence_category, evidence_source, verification_status FROM source_binding_audit'))
      .toEqual([{ actor_id: 'system:local-single-user', evidence_category: 'local_profile_single_user',
        evidence_source: 'macos_user_home', verification_status: 'device_scope_assumed' }]);
    const report = new ReportService(db, scanner);
    const admin = { id: adminId, username: 'admin', role: 'superadmin' as const, active: true, createdAt: '' };
    expect(report.query({ from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day',
      provider: 'claude', model: '', projectKey: '', userId: adminId }, admin).totals.totalTokens).toBe(12);
    expect(scanner.assignKnownLocalSources()).toBe(0);
    await scanner.scan();
    expect(db.all('SELECT id FROM source_binding_audit')).toHaveLength(1);

    scanner.bindIdentity(first.key, null, adminId);
    expect(scanner.assignKnownLocalSources()).toBe(0);
    await scanner.scan();
    expect(scanner.identities().find(item => item.key === first.key)?.ownerUserId).toBeNull();

    writeClaude('new-file', 7);
    await scanner.scan();
    const second = scanner.identities().find(item => item.key.startsWith('claude:local-file:') && item.key !== first.key)!;
    expect(second.ownerUserId).toBe(adminId);
    expect(db.all('SELECT id FROM source_binding_audit')).toHaveLength(3);

    const viewerId = randomUUID();
    db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      [viewerId, 'viewer', 'unused', 'viewer', '2026-10-02T00:00:00Z']);
    writeClaude('multi-user', 9);
    await scanner.scan();
    expect(scanner.identities().filter(item => item.key.startsWith('claude:local-file:') && !item.ownerUserId)).toHaveLength(2);
    expect(scanner.assignKnownLocalSources()).toBe(0);

    db.run('INSERT INTO source_identities VALUES (?, ?, ?, NULL)',
      ['claude:local-file-unknown:synthetic', 'claude', 'unknown']);
    db.run('INSERT INTO source_identities VALUES (?, ?, ?, NULL)', ['claude:macos:legacy', 'claude', 'legacy']);
    rmSync(path.join(workspace.claudeDir, 'new-file.jsonl'));
    expect(scanner.assignKnownLocalSources()).toBe(0);
    expect(db.all("SELECT owner_user_id FROM source_identities WHERE key IN ('claude:local-file-unknown:synthetic', 'claude:macos:legacy')"))
      .toEqual([{ owner_user_id: null }, { owner_user_id: null }]);
  } finally {
    db.close();
    if (previousCodex === undefined) delete process.env.TOKEN_CODEX_SESSIONS_DIR;
    else process.env.TOKEN_CODEX_SESSIONS_DIR = previousCodex;
    if (previousClaude === undefined) delete process.env.TOKEN_CLAUDE_PROJECTS_DIR;
    else process.env.TOKEN_CLAUDE_PROJECTS_DIR = previousClaude;
    workspace.cleanup();
  }
});
