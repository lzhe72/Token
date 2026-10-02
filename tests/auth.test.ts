import { expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../src/main/database';
import { AuthService } from '../src/main/auth';

test('首次管理员、重启后的登录和失败尝试限速', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'token-auth-'));
  try {
    const file = path.join(root, 'token.sqlite');
    let db = await AppDatabase.open(file);
    let auth = new AuthService(db);
    await auth.setupAdmin('owner', 'safe-password-123');
    await expect(auth.setupAdmin('second', 'safe-password-123')).rejects.toThrow('管理员已创建');
    db.close();
    db = await AppDatabase.open(file);
    auth = new AuthService(db);
    expect((await auth.login('owner', 'safe-password-123')).role).toBe('admin');
    for (let index = 0; index < 5; index++) await expect(auth.login('owner', 'wrong')).rejects.toThrow('用户名或密码错误');
    await expect(auth.login('owner', 'safe-password-123')).rejects.toThrow('登录尝试过多');
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
