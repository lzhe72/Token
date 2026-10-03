import { expect, test } from 'vitest';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';
import { onboardingStatus } from '../src/main/onboarding';
import type { PublicUser } from '../src/shared/types';
import { createTestWorkspace } from './support/test-workspace';

const admin: PublicUser = { id: 'admin', username: 'admin', role: 'superadmin', active: true, createdAt: '' };
const viewer: PublicUser = { id: 'viewer', username: 'viewer', role: 'viewer', active: true, createdAt: '' };

function addUser(db: AppDatabase, user: PublicUser): void {
  db.run('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)',
    [user.id, user.username, 'unused', user.role === 'viewer' ? 'viewer' : 'admin', '2026-10-01T00:00:00Z']);
}

test('TC-082 四步按检测扫描归属和已确认首笔事实推进', async () => {
  const workspace = createTestWorkspace('tc082-onboarding');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    addUser(db, admin);
    addUser(db, viewer);
    expect(onboardingStatus(db, scanner, admin).steps.map(step => step.state)).toEqual([
      'pending', 'pending', 'pending', 'pending'
    ]);
    db.run(`INSERT INTO source_status(provider,status,file_count,fact_count,last_scan,detail,diagnostic_json,last_success)
      VALUES ('codex','no_records',0,0,'2026-10-03T00:00:00Z','成功空扫描','{"reason":"empty_directory"}','2026-10-03T00:00:00Z')`);
    expect(onboardingStatus(db, scanner, admin).steps.map(step => step.state)).toEqual([
      'complete', 'complete', 'pending', 'pending'
    ]);
    db.run("UPDATE source_status SET status='scanning' WHERE provider='codex'");
    expect(onboardingStatus(db, scanner, admin).steps[1]).toMatchObject({ state: 'complete' });
    db.run("UPDATE source_status SET status='no_records' WHERE provider='codex'");
    db.run("INSERT INTO source_identities VALUES ('local', 'codex', 'synthetic', NULL)");
    db.run("INSERT INTO usage_facts VALUES ('local:zero', 'codex', 'local', 'zero', 'gpt-test', '2026-10-03T09:00:00Z', 0, 0, 0, 0, 0)");
    expect(onboardingStatus(db, scanner, admin).steps[3].state).toBe('pending');
    scanner.bindIdentity('local', viewer.id, admin.id);
    expect(onboardingStatus(db, scanner, admin).steps[3].state).toBe('pending');
    expect(onboardingStatus(db, scanner, admin).steps[3].detail).not.toContain('待核对记录');
    db.run("INSERT INTO usage_facts VALUES ('local:one', 'codex', 'local', 'one', 'gpt-test', '2026-10-03T10:00:00Z', 12, 0, 0, 0, 12)");
    expect(onboardingStatus(db, scanner, admin).steps.map(step => step.state)).toEqual([
      'complete', 'complete', 'complete', 'complete'
    ]);
    expect(onboardingStatus(db, scanner, viewer).steps[3].state).toBe('complete');
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-083 普通用户只看本人状态且待核对事实不算首笔确认用量', async () => {
  const workspace = createTestWorkspace('tc083-onboarding');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    addUser(db, admin);
    addUser(db, viewer);
    db.run("INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES ('other','other','unused','viewer',1,'2026-10-01T00:00:00Z')");
    db.run("INSERT INTO source_identities VALUES ('other-local', 'codex', 'synthetic', 'other')");
    db.run("INSERT INTO usage_facts VALUES ('local:other', 'codex', 'other-local', 'other', 'gpt-test', '2026-10-03T10:00:00Z', 99, 0, 0, 0, 99)");
    db.run(`INSERT INTO source_status(provider,status,file_count,fact_count,last_scan,detail,diagnostic_json,last_success)
      VALUES ('codex','ready',1,1,'2026-10-03T11:00:00Z','其他用户成功扫描','{"reason":"ok"}','2026-10-03T11:00:00Z')`);
    const before = onboardingStatus(db, scanner, viewer);
    expect(before.steps.map(step => step.state)).toEqual(['unknown', 'unknown', 'pending', 'pending']);
    expect(JSON.stringify(before)).not.toContain('other');
    db.run("INSERT INTO source_identities VALUES ('own-local', 'codex', 'synthetic', 'viewer')");
    db.run("INSERT INTO source_identities VALUES ('own-otel', 'codex', 'synthetic', 'viewer')");
    db.run("INSERT INTO usage_facts VALUES ('local:own', 'codex', 'own-local', 'overlap', 'gpt-test', '2026-10-03T10:00:00Z', 12, 0, 0, 0, 12)");
    db.run("INSERT INTO usage_facts VALUES ('otel:own', 'codex', 'own-otel', 'overlap', 'gpt-test', '2026-10-03T10:01:00Z', 14, 0, 0, 0, 14)");
    const pending = onboardingStatus(db, scanner, viewer);
    expect(pending.steps.map(step => step.state)).toEqual(['complete', 'unknown', 'complete', 'pending']);
    expect(pending.steps[3].detail).toContain('待核对');
    db.run("INSERT INTO usage_facts VALUES ('local:confirmed', 'codex', 'own-local', 'independent', 'gpt-test', '2026-10-03T10:02:00Z', 5, 0, 0, 0, 5)");
    expect(onboardingStatus(db, scanner, viewer).steps[3].state).toBe('complete');
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-082 大量合成历史记录的引导状态响应保持可用', async () => {
  const workspace = createTestWorkspace('tc082-onboarding-volume');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    addUser(db, admin);
    db.run("INSERT INTO source_identities VALUES ('local', 'codex', 'synthetic', 'admin')");
    db.transaction(() => {
      for (let index = 0; index < 2500; index++) db.run(
        'INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [`local:${index}`, 'codex', 'local', `session-${index}`, 'gpt-test',
          new Date(Date.parse('2026-10-01T00:00:00Z') + index * 1000).toISOString(), 1, 0, 0, 0, 1]);
    });
    const start = performance.now();
    const status = onboardingStatus(db, scanner, admin);
    expect(status.steps[3].state).toBe('complete');
    expect(performance.now() - start).toBeLessThan(2000);
  } finally { db.close(); workspace.cleanup(); }
});
