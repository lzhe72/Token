import { createHash, randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { AppDatabase, Row } from './database';
import type { PublicUser, Role } from '../shared/types';

const HASH_SIZE = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

type UserRow = Row & {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  active: number;
  created_at: string;
};

function derive(password: string, salt: Buffer, options = SCRYPT_OPTIONS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, HASH_SIZE, options, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

function normalizeUsername(value: unknown): string {
  if (typeof value !== 'string') throw new Error('用户名格式错误');
  const username = value.trim();
  if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) throw new Error('用户名需为 3–32 位字母、数字或 _.-');
  return username;
}

function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) {
    throw new Error('密码长度需为 10–128 位');
  }
  return value;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(32);
  const hash = await derive(password, salt);
  return `scrypt$16384$8$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== HASH_SIZE) return false;
  const actual = await derive(password, Buffer.from(saltHex, 'hex'), {
    N: Number(n), r: Number(r), p: Number(p)
  });
  return timingSafeEqual(actual, expected);
}

function publicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    active: row.active === 1,
    createdAt: row.created_at
  };
}

export class AuthService {
  private failures = new Map<string, { count: number; until: number }>();

  constructor(private readonly db: AppDatabase) {
    db.run(`CREATE TABLE IF NOT EXISTS trusted_devices (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    )`);
  }

  issueTrustedDevice(userId: string): string {
    const user = this.getUser(userId);
    if (!user?.active) throw new Error('账户不可用');
    const token = randomBytes(32).toString('base64url');
    this.db.run('INSERT INTO trusted_devices VALUES (?, ?, ?)', [this.trustedHash(token), userId, new Date().toISOString()]);
    return token;
  }

  authenticateTrustedDevice(token: string): PublicUser | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = this.db.one('SELECT user_id FROM trusted_devices WHERE token_hash = ?', [this.trustedHash(token)]);
    if (!row) return null;
    const user = this.getUser(String(row.user_id));
    return user?.active ? user : null;
  }

  revokeTrustedDevice(token: string): void {
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
      this.db.run('DELETE FROM trusted_devices WHERE token_hash = ?', [this.trustedHash(token)]);
    }
  }

  private trustedHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  needsSetup(): boolean {
    return Number(this.db.one('SELECT COUNT(*) AS count FROM users')?.count ?? 0) === 0;
  }

  async setupAdmin(usernameInput: unknown, passwordInput: unknown): Promise<PublicUser> {
    if (!this.needsSetup()) throw new Error('管理员已创建');
    return this.insertUser(normalizeUsername(usernameInput), validatePassword(passwordInput), 'admin', null);
  }

  async login(usernameInput: unknown, passwordInput: unknown): Promise<PublicUser> {
    const username = normalizeUsername(usernameInput);
    const password = typeof passwordInput === 'string' ? passwordInput : '';
    const key = username.toLowerCase();
    const failure = this.failures.get(key);
    if (failure && failure.count >= MAX_ATTEMPTS && failure.until > Date.now()) {
      throw new Error('登录尝试过多，请稍后重试');
    }
    const row = this.db.one('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]) as UserRow | null;
    if (!row || row.active !== 1 || !(await verifyPassword(password, row.password_hash))) {
      const count = (failure?.until && failure.until > Date.now() ? failure.count : 0) + 1;
      this.failures.set(key, { count, until: Date.now() + LOCK_MS });
      throw new Error('用户名或密码错误');
    }
    this.failures.delete(key);
    return publicUser(row);
  }

  listUsers(): PublicUser[] {
    return this.db.all('SELECT * FROM users ORDER BY created_at ASC').map(row => publicUser(row as UserRow));
  }

  getUser(id: string): PublicUser | null {
    const row = this.db.one('SELECT * FROM users WHERE id = ?', [id]) as UserRow | null;
    return row ? publicUser(row) : null;
  }

  async createUser(usernameInput: unknown, passwordInput: unknown, roleInput: unknown, actorId: string): Promise<PublicUser> {
    if (roleInput !== 'admin' && roleInput !== 'viewer') throw new Error('角色无效');
    return this.insertUser(normalizeUsername(usernameInput), validatePassword(passwordInput), roleInput, actorId);
  }

  private async insertUser(username: string, password: string, role: Role, actorId: string | null): Promise<PublicUser> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const hash = await hashPassword(password);
    try {
      this.db.transaction(() => {
        if (actorId === null && !this.needsSetup()) throw new Error('管理员已创建');
        this.db.run('INSERT INTO users (id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)', [id, username, hash, role, createdAt]);
        this.audit(actorId, 'user.created', id);
      });
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('用户名已存在');
      throw error;
    }
    return { id, username, role, active: true, createdAt };
  }

  setActive(userId: unknown, active: unknown, actorId: string): void {
    if (typeof userId !== 'string' || typeof active !== 'boolean') throw new Error('参数无效');
    const target = this.getUser(userId);
    if (!target) throw new Error('用户不存在');
    if (target.id === actorId && !active) throw new Error('不能停用自己的账户');
    if (target.role === 'admin' && !active && this.activeAdminCount() <= 1) throw new Error('必须保留至少一位管理员');
    this.db.transaction(() => {
      this.db.run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, userId]);
      if (!active) this.db.run('DELETE FROM trusted_devices WHERE user_id = ?', [userId]);
      this.audit(actorId, active ? 'user.enabled' : 'user.disabled', userId);
    });
  }

  async changePassword(userId: unknown, passwordInput: unknown, actorId: string): Promise<void> {
    if (typeof userId !== 'string' || !this.getUser(userId)) throw new Error('用户不存在');
    const hash = await hashPassword(validatePassword(passwordInput));
    this.db.transaction(() => {
      this.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
      this.db.run('DELETE FROM trusted_devices WHERE user_id = ?', [userId]);
      this.audit(actorId, 'user.password_changed', userId);
    });
  }

  private activeAdminCount(): number {
    return Number(this.db.one("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1")?.count ?? 0);
  }

  private audit(actorId: string | null, action: string, targetId: string): void {
    this.db.run('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)', [randomUUID(), actorId, action, targetId, new Date().toISOString()]);
  }
}
