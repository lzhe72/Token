import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [sourceInput, executableInput] = process.argv.slice(2);
if (!sourceInput || !path.isAbsolute(sourceInput)) {
  console.error('用法: npm run test:production-copy -- /绝对路径/token.sqlite [/绝对路径/Token.app]');
  process.exit(2);
}
const source = path.resolve(sourceInput);
const executable = executableInput
  ? path.join(path.resolve(executableInput), 'Contents', 'MacOS', 'Token')
  : path.join(root, 'release', 'mac', 'Token.app', 'Contents', 'MacOS', 'Token');
if (!existsSync(source) || !existsSync(executable)) throw new Error('数据库或打包应用不存在');

const workspace = mkdtempSync(path.join(os.tmpdir(), 'token-production-copy-'));
const database = path.join(workspace, 'token.sqlite');
const codex = path.join(workspace, 'empty-codex');
const claude = path.join(workspace, 'empty-claude');
mkdirSync(codex);
mkdirSync(claude);

function sqlite(file, statement) {
  const result = spawnSync('/usr/bin/sqlite3', [file, statement], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`数据库校验失败: ${result.error?.message || result.stderr}`);
  return result.stdout.trim();
}

function fingerprint() {
  const result = sqlite(database, `PRAGMA integrity_check;
    SELECT 'users', COUNT(*) FROM users
    UNION ALL SELECT 'facts', COUNT(*) FROM usage_facts
    UNION ALL SELECT 'identities', COUNT(*) FROM source_identities
    UNION ALL SELECT 'cursors', COUNT(*) FROM source_cursors;`);
  if (!result.startsWith('ok\n')) throw new Error('数据库完整性检查失败');
  return result;
}

let app;
try {
  sqlite(source, `.backup '${database}'`);
  const before = fingerprint();
  app = await electron.launch({ executablePath: executable, args: [`--token-user-data=${workspace}`],
    env: { ...process.env, TOKEN_CODEX_SESSIONS_DIR: codex, TOKEN_CLAUDE_PROJECTS_DIR: claude }, timeout: 30000 });
  const page = await app.firstWindow();
  await page.locator('body').waitFor({ timeout: 15000 });
  const locations = await app.evaluate(({ app, session }) => ({
    userData: app.getPath('userData'), storage: session.defaultSession.getStoragePath()
  }));
  if (locations.userData !== workspace || locations.storage !== workspace) throw new Error('测试应用未隔离用户数据目录');
  await app.close();
  app = undefined;
  if (fingerprint() !== before) throw new Error('新版启动改变了旧库账户、用量或游标数量');
  console.log('打包应用已在隔离生产库副本启动；数据库完整且账户、用量、来源、游标数量保留。');
} finally {
  if (app) await app.close().catch(() => {});
  rmSync(workspace, { recursive: true, force: true });
}
