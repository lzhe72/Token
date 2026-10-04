import { expect, test } from 'vitest';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';
import { UsageSync } from '../src/main/usage-sync';
import type { ServerConnection } from '../src/main/server-connection';
import { createTestWorkspace } from './support/test-workspace';

test('TC-086 暂缓只归当前管理员且来源归属或消失后旧引用不进入待办', async () => {
  const workspace = createTestWorkspace('tc086-deferral-storage');
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const scanner = new UsageScanner(db);
    new UsageSync(db, scanner, { getConnectionIdentity: () => 'synthetic' } as ServerConnection);
    const key = `claude:local-file:${'a'.repeat(24)}`;
    db.run('INSERT INTO source_identities VALUES (?,?,?,?)', [key, 'claude', 'synthetic-file', null]);
    db.run('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)',
      ['viewer', 'viewer', 'unused', 'viewer', '2026-10-02T00:00:00Z']);
    expect(scanner.setSourceDeferred('admin-a', key, true)).toEqual([key]);
    expect(scanner.deferredSourceKeys('admin-b')).toEqual([]);
    expect(db.all('SELECT actor_id, source_ref FROM source_deferrals')).toEqual([{ actor_id: 'admin-a', source_ref: key }]);
    expect(db.all('SELECT * FROM source_binding_audit')).toHaveLength(0);
    expect(db.all('SELECT * FROM sync_outbox')).toHaveLength(0);
    await expect(() => scanner.setSourceDeferred('admin-a', '/private/work/secret', true)).toThrow('暂缓来源无效');
    db.run('UPDATE source_identities SET owner_user_id=? WHERE key=?', ['viewer', key]);
    expect(scanner.deferredSourceKeys('admin-a')).toEqual([]);
    await expect(() => scanner.setSourceDeferred('admin-a', key, true)).toThrow('来源已变化');
    db.run('DELETE FROM source_identities WHERE key=?', [key]);
    expect(scanner.deferredSourceKeys('admin-a')).toEqual([]);
    expect(db.all('SELECT * FROM source_binding_audit')).toHaveLength(0);
    expect(db.all('SELECT * FROM sync_outbox')).toHaveLength(0);
  } finally { db.close(); workspace.cleanup(); }
});
