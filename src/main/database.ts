import fs from 'node:fs';
import path from 'node:path';
import type { Database as SqlDatabase, SqlValue } from 'sql.js';

const initSqlJs = require('sql.js/dist/sql-asm.js') as typeof import('sql.js');

export type Row = Record<string, SqlValue>;

export class AppDatabase {
  private inTransaction = false;
  private lastPersisted: Uint8Array | null = null;
  private constructor(private db: SqlDatabase, private readonly file: string,
    private readonly reopen: (bytes: Uint8Array) => SqlDatabase) {}

  static async open(file: string): Promise<AppDatabase> {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const SQL = await initSqlJs();
    const bytes = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
    const instance = new AppDatabase(new SQL.Database(bytes), file, saved => new SQL.Database(saved));
    instance.migrate();
    return instance;
  }

  static async validateBackup(file: string): Promise<void> {
    const SQL = await initSqlJs();
    const bytes = fs.readFileSync(file);
    if (bytes.length < 100 || bytes.subarray(0, 16).toString('utf8') !== 'SQLite format 3\0') throw new Error('不是有效的 Token 数据库');
    const candidate = new SQL.Database(bytes);
    try {
      const integrity = candidate.exec('PRAGMA integrity_check');
      if (integrity[0]?.values[0]?.[0] !== 'ok') throw new Error('备份数据库完整性检查失败');
      const tables = new Set(candidate.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.map(row => String(row[0])) ?? []);
      for (const name of ['users', 'usage_facts', 'source_identities', 'source_cursors']) {
        if (!tables.has(name)) throw new Error('备份文件缺少 Token 数据表');
      }
      if (candidate.exec("SELECT COUNT(*) FROM users WHERE role = 'admin'")[0]?.values[0]?.[0] === 0) {
        throw new Error('备份文件没有管理员账户');
      }
    } finally {
      candidate.close();
    }
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor_id TEXT,
        action TEXT NOT NULL,
        target_id TEXT,
        occurred_at TEXT NOT NULL
      );
    `);
    if (!this.db.exec('PRAGMA table_info(users)')[0]?.values.some(row => row[1] === 'last_login_at')) {
      this.db.run('ALTER TABLE users ADD COLUMN last_login_at TEXT');
    }
    this.persist();
  }

  one(sql: string, params: SqlValue[] = []): Row | null {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      return stmt.step() ? (stmt.getAsObject() as Row) : null;
    } finally {
      stmt.free();
    }
  }

  all(sql: string, params: SqlValue[] = []): Row[] {
    const stmt = this.db.prepare(sql);
    const rows: Row[] = [];
    try {
      stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject() as Row);
      return rows;
    } finally {
      stmt.free();
    }
  }

  run(sql: string, params: SqlValue[] = []): void {
    if (params.length === 0) this.db.run(sql);
    else this.db.run(sql, params);
    if (!this.inTransaction) this.persist();
  }

  transaction(fn: () => void): void {
    if (this.inTransaction) throw new Error('不支持嵌套事务');
    this.db.run('BEGIN TRANSACTION');
    this.inTransaction = true;
    try {
      fn();
    } catch (error) {
      this.db.run('ROLLBACK');
      this.inTransaction = false;
      throw error;
    }
    this.db.run('COMMIT');
    this.inTransaction = false;
    this.persist();
  }

  transactionDurable(fn: () => void): void {
    if (this.inTransaction) throw new Error('不支持嵌套事务');
    // persist() keeps an immutable SQL.js export after each successful rename.
    // Reuse it instead of exporting the entire growing database twice per file.
    const previous = this.lastPersisted ?? this.db.export();
    try {
      this.transaction(fn);
    } catch (error) {
      // The SQL transaction may have committed before the file replacement failed.
      // Restore the in-memory database to the last durable state in that case.
      this.db.close();
      this.db = this.reopen(previous);
      try { fs.unlinkSync(`${this.file}.tmp`); } catch { /* no temporary file */ }
      throw error;
    }
  }

  private persist(): void {
    const temp = `${this.file}.tmp`;
    const bytes = this.db.export();
    fs.writeFileSync(temp, Buffer.from(bytes), { mode: 0o600 });
    fs.renameSync(temp, this.file);
    this.lastPersisted = bytes;
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  backupTo(file: string): void {
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, Buffer.from(this.db.export()), { mode: 0o600 });
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  }
}
