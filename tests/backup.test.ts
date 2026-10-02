import { expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createTestWorkspace } from './support/test-workspace';
import path from 'node:path';
import { AppDatabase } from '../src/main/database';
import { UsageScanner } from '../src/collectors/scanner';

test('数据库备份完整性校验并保留账户与用量', async () => {
  const workspace = createTestWorkspace('backup');
  const root = workspace.root;
  try {
    const db = await AppDatabase.open(workspace.databasePath);
    new UsageScanner(db);
    db.run("INSERT INTO users VALUES ('a', 'admin', 'unused', 'admin', 1, '2026-01-01T00:00:00Z')");
    db.run("INSERT INTO source_identities VALUES ('test', 'codex', 'Test', 'a')");
    db.run("INSERT INTO usage_facts VALUES ('fact', 'codex', 'test', 's', 'gpt-test', '2026-01-01T00:00:00Z', 4, 2, 1, 0, 6)");
    const backup = path.join(root, 'backup.sqlite');
    db.backupTo(backup);
    await expect(AppDatabase.validateBackup(backup)).resolves.toBeUndefined();
    const restored = await AppDatabase.open(backup);
    expect(restored.one("SELECT total_tokens FROM usage_facts WHERE source_key='fact'")?.total_tokens).toBe(6);
    restored.close();
    writeFileSync(path.join(root, 'broken.sqlite'), 'not a database');
    await expect(AppDatabase.validateBackup(path.join(root, 'broken.sqlite'))).rejects.toThrow();
    db.close();
  } finally {
    workspace.cleanup();
  }
});
