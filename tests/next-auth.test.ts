import { expect, test } from 'vitest';
import fs from 'node:fs';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { AuthService } from '../src/main/auth';
import { TrustedDeviceStore } from '../src/main/trusted-device';

const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value.split('').reverse().join(''), 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8').split('').reverse().join('')
};

test('TC-030 勾选信任后重启恢复且未勾选不恢复', async () => {
  const workspace = createTestWorkspace('trust-restore');
  try {
    let db = await AppDatabase.open(workspace.databasePath);
    let auth = new AuthService(db);
    const user = await auth.setupAdmin('admin', 'safe-password-123');
    const store = new TrustedDeviceStore(workspace.root, cipher);
    expect(store.read()).toBeNull();
    const token = auth.issueTrustedDevice(user.id);
    store.write(token);
    expect(fs.readFileSync(`${workspace.root}/trusted-device.secret`, 'utf8')).not.toContain(token);
    expect(fs.readFileSync(workspace.databasePath).includes(Buffer.from(token))).toBe(false);
    db.close();
    db = await AppDatabase.open(workspace.databasePath);
    auth = new AuthService(db);
    expect(auth.authenticateTrustedDevice(store.read()!)).toMatchObject({ id: user.id, username: 'admin' });
    store.clear();
    expect(store.read()).toBeNull();
    db.close();
  } finally { workspace.cleanup(); }
});

test('TC-031 退出停用重置密码撤销受信凭证', async () => {
  const workspace = createTestWorkspace('trust-revoke');
  try {
    const db = await AppDatabase.open(workspace.databasePath);
    const auth = new AuthService(db);
    const admin = await auth.setupAdmin('admin', 'safe-password-123');
    const user = await auth.createUser('viewer', 'viewer-password-123', 'viewer', admin.id);
    const token = auth.issueTrustedDevice(user.id);
    db.run("UPDATE trusted_devices SET created_at = '2000-01-01T00:00:00Z'");
    expect(auth.authenticateTrustedDevice(token)?.id).toBe(user.id);
    auth.revokeTrustedDevice(token);
    expect(auth.authenticateTrustedDevice(token)).toBeNull();
    const second = auth.issueTrustedDevice(user.id);
    await auth.changePassword(user.id, 'viewer-password-456', admin.id);
    expect(auth.authenticateTrustedDevice(second)).toBeNull();
    const third = auth.issueTrustedDevice(user.id);
    auth.setActive(user.id, false, admin.id);
    expect(auth.authenticateTrustedDevice(third)).toBeNull();
    const store = new TrustedDeviceStore(workspace.root, cipher);
    store.write(third);
    fs.writeFileSync(`${workspace.root}/trusted-device.secret`, 'broken');
    expect(store.read()).toBeNull();
    db.close();
  } finally { workspace.cleanup(); }
});
