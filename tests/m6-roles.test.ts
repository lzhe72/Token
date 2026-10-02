import { expect, test } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { AuthService } from '../src/main/auth';

test('TC-068 首建固定 admin 且库内角色兼容旧约束', async () => {
  const workspace = createTestWorkspace('tc068');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const auth = new AuthService(db);
    await expect(auth.setupAdmin('owner', 'safe-password-123')).rejects.toThrow('必须是 admin');
    const root = await auth.setupAdmin('admin', 'safe-password-123');
    expect(root.role).toBe('superadmin');
    expect(db.one('SELECT role FROM users WHERE id = ?', [root.id])?.role).toBe('admin');
    await expect(auth.setupAdmin('admin', 'safe-password-456')).rejects.toThrow('管理员已创建');
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-069 普通管理员保留建户权限但不能改动固定 admin', async () => {
  const workspace = createTestWorkspace('tc069');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const auth = new AuthService(db);
    const root = await auth.setupAdmin('admin', 'safe-password-123');
    const manager = await auth.createUser('manager', 'manager-password-123', 'admin', root.id);
    expect(manager.role).toBe('admin');
    expect((await auth.createUser('viewer', 'viewer-password-123', 'viewer', manager.id)).role).toBe('viewer');
    expect((await auth.createUser('manager2', 'manager-password-456', 'admin', manager.id)).role).toBe('admin');
    expect(() => auth.setActive(root.id, false, manager.id)).toThrow('只有 admin');
    await expect(auth.changePassword(root.id, 'new-password-123', manager.id)).rejects.toThrow('只有 admin');
    expect((await auth.login('admin', 'safe-password-123')).role).toBe('superadmin');
  } finally { db.close(); workspace.cleanup(); }
});

test('TC-070 旧库 admin 冲突显式处理且保留账号 ID 和哈希', async () => {
  const workspace = createTestWorkspace('tc070');
  const initSqlJs = require('sql.js/dist/sql-asm.js') as typeof import('sql.js');
  const SQL = await initSqlJs();
  const legacy = new SQL.Database();
  legacy.run(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE,
    password_hash TEXT, role TEXT CHECK(role IN ('admin','viewer')), active INTEGER, created_at TEXT);
    INSERT INTO users VALUES ('legacy-owner', 'owner', 'hash-owner', 'admin', 1, '2025-01-01T00:00:00Z');
    INSERT INTO users VALUES ('legacy-conflict', 'admin', 'hash-viewer', 'viewer', 1, '2025-01-02T00:00:00Z');`);
  writeFileSync(workspace.databasePath, Buffer.from(legacy.export()));
  legacy.close();
  const before = readFileSync(workspace.databasePath);
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const auth = new AuthService(db);
    expect(auth.superadminIssue()).toContain('占用');
    expect(auth.getUser('legacy-owner')?.role).toBe('admin');
    expect(auth.getUser('legacy-conflict')?.role).toBe('viewer');
    await expect(auth.createUser('admin', 'safe-password-123', 'admin', 'legacy-owner')).rejects.toThrow('冲突');
    expect(() => auth.renameConflictingAdminViewer('owner', 'legacy-owner')).toThrow('已存在');
    expect(db.one("SELECT username, password_hash FROM users WHERE id='legacy-conflict'")).toMatchObject({
      username: 'admin', password_hash: 'hash-viewer'
    });
    auth.renameConflictingAdminViewer('renamedViewer', 'legacy-owner');
    expect(db.one("SELECT id, password_hash FROM users WHERE username='renamedViewer'")).toMatchObject({ id: 'legacy-conflict', password_hash: 'hash-viewer' });
    const root = await auth.createUser('admin', 'safe-password-123', 'admin', 'legacy-owner');
    expect(root.role).toBe('superadmin');
    expect(auth.superadminIssue()).toBeNull();
    expect(db.one("SELECT password_hash FROM users WHERE id='legacy-owner'")?.password_hash).toBe('hash-owner');
    expect(db.all('PRAGMA table_info(users)').some(row => row.name === 'last_login_at')).toBe(true);
  } finally { db.close(); workspace.cleanup(); }
  expect(before.length).toBeGreaterThan(100);

  for (const variant of ['existing-admin', 'missing-admin'] as const) {
    const legacyWorkspace = createTestWorkspace(`tc070-${variant}`);
    const old = new SQL.Database();
    old.run(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE,
      password_hash TEXT, role TEXT CHECK(role IN ('admin','viewer')), active INTEGER, created_at TEXT);
      INSERT INTO users VALUES ('legacy-manager', '${variant === 'existing-admin' ? 'admin' : 'owner'}',
        'unchanged-hash', 'admin', 1, '2025-01-01T00:00:00Z');`);
    writeFileSync(legacyWorkspace.databasePath, Buffer.from(old.export()));
    old.close();
    const migrated = await AppDatabase.open(legacyWorkspace.databasePath);
    try {
      const auth = new AuthService(migrated);
      if (variant === 'existing-admin') {
        expect(auth.superadminIssue()).toBeNull();
        expect(auth.getUser('legacy-manager')?.role).toBe('superadmin');
      } else {
        expect(auth.superadminIssue()).toContain('尚无固定 admin');
        expect((await auth.createUser('admin', 'safe-password-123', 'admin', 'legacy-manager')).role).toBe('superadmin');
        expect(auth.getUser('legacy-manager')?.role).toBe('admin');
      }
      expect(migrated.one("SELECT password_hash FROM users WHERE id='legacy-manager'")?.password_hash).toBe('unchanged-hash');
    } finally { migrated.close(); legacyWorkspace.cleanup(); }
  }
});
