import fs from 'node:fs';
import path from 'node:path';
import type { Database as SqlDatabase, SqlValue } from 'sql.js';

const initSqlJs = require('sql.js/dist/sql-asm.js') as typeof import('sql.js');

export type Row = Record<string, SqlValue>;

export class AppDatabase {
  private inTransaction = false;
  private constructor(private readonly db: SqlDatabase, private readonly file: string) {}

  static async open(file: string): Promise<AppDatabase> {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const SQL = await initSqlJs();
    const bytes = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
    const instance = new AppDatabase(new SQL.Database(bytes), file);
    instance.migrate();
    return instance;
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor_id TEXT,
        action TEXT NOT NULL,
        target_id TEXT,
        occurred_at TEXT NOT NULL
      );
    `);
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
    this.db.run(sql, params);
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

  private persist(): void {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, Buffer.from(this.db.export()), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  close(): void {
    this.persist();
    this.db.close();
  }
}
