import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [sourceInput, executableInput] = process.argv.slice(2);
if (!sourceInput || !path.isAbsolute(sourceInput)) {
  console.error('用法: npm run test:production-copy -- /绝对路径/备份副本/token.sqlite [/绝对路径/Token.app]');
  process.exit(2);
}
const source = realpathSync(sourceInput);
const productionData = path.join(os.homedir(), 'Library', 'Application Support', 'token-monitor');
if (source === productionData || source.startsWith(productionData + path.sep)) {
  throw new Error('拒绝将实际应用用户数据用作测试输入；请先在仓库外创建备份副本');
}
const executable = executableInput
  ? path.join(path.resolve(executableInput), 'Contents', 'MacOS', 'Token')
  : path.join(root, 'release', 'mac', 'Token.app', 'Contents', 'MacOS', 'Token');
if (!existsSync(source) || !existsSync(executable)) throw new Error('备份副本或打包应用不存在');

const workspace = mkdtempSync(path.join(os.tmpdir(), 'token-production-copy-'));
const database = path.join(workspace, 'token.sqlite');
const beforeDatabase = path.join(workspace, 'before.sqlite');
const codex = path.join(workspace, 'empty-codex');
const claude = path.join(workspace, 'empty-claude');
mkdirSync(codex);
mkdirSync(claude);

function sqlite(file, statement, args = []) {
  const result = spawnSync('/usr/bin/sqlite3', [...args, file, statement],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('数据库命令失败；请核对备份副本完整性');
  return result.stdout.trim();
}

function rows(file, table, optional = false) {
  if (optional && !sqlite(file, `SELECT 1 FROM sqlite_master WHERE type='table' AND name='${table}'`)) return [];
  const output = sqlite(file, `SELECT * FROM ${table}`, ['-readonly', '-json']);
  return output ? JSON.parse(output) : [];
}

function snapshot(file) {
  assert.equal(sqlite(file, 'PRAGMA integrity_check', ['-readonly']), 'ok', '数据库完整性检查失败');
  return {
    users: rows(file, 'users'),
    facts: rows(file, 'usage_facts'),
    identities: rows(file, 'source_identities'),
    cursors: rows(file, 'source_cursors'),
    projects: rows(file, 'fact_projects', true),
    uncertain: rows(file, 'usage_uncertain_facts', true),
    projectBackfill: rows(file, 'scanner_meta', true).some(row => row.key === 'project_backfill')
  };
}

const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const keyed = (items, key) => {
  const map = new Map();
  for (const item of items) {
    assert(!map.has(item[key]), '快照存在重复主键');
    map.set(item[key], item);
  }
  return map;
};
// A failed comparison must never print private database rows in a test log.
const same = (actual, expected, message) => {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(message);
};
const sorted = items => [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const localLegacy = key => /^(codex|claude):/.test(key) &&
  !key.startsWith('codex:v2:') && !key.startsWith('codex:fallback:v2:') &&
  !key.startsWith('claude:v2:');

function scopedKey(key, identity) {
  const scope = hash(identity);
  if (key.startsWith('codex:fallback:')) return `codex:fallback:v2:${scope}:${key.slice(15)}`;
  if (key.startsWith('codex:')) return `codex:v2:${scope}:${key.slice(6)}`;
  if (key.startsWith('claude:')) return `claude:v2:${scope}:${key.slice(7)}`;
  throw new Error('旧键不在可核对迁移白名单内');
}

function compareRows(actual, expected, key, label) {
  same(keyed(actual, key), keyed(expected, key), `${label}出现未解释变化`);
}

function ownerTotals(snapshotValue) {
  const identities = keyed(snapshotValue.identities, 'key');
  const uncertain = new Set(snapshotValue.uncertain.map(row => row.source_key));
  const totals = new Map();
  for (const fact of snapshotValue.facts) {
    const owner = identities.get(fact.source_identity_key)?.owner_user_id;
    if (!owner || uncertain.has(fact.source_key)) continue;
    const previous = totals.get(owner) ?? { count: 0, tokens: 0 };
    previous.count++;
    previous.tokens += Number(fact.total_tokens);
    totals.set(owner, previous);
  }
  return totals;
}

function verifyMigration(before, after) {
  compareRows(after.users, before.users, 'id', '账户');
  same(after.facts.length, before.facts.length, '事实数量改变');
  same(after.cursors.length, before.cursors.length, '游标数量改变');
  same(after.projects.length, before.projects.length, '项目关联数量改变');

  const expectedFacts = keyed(before.facts.map(row => ({ ...row })), 'source_key');
  const expectedProjects = keyed(before.projects.map(row => ({ ...row })), 'source_key');
  const expectedIdentities = keyed(before.identities.map(row => ({ ...row })), 'key');
  const expectedUncertain = keyed(before.uncertain.map(row => ({ ...row })), 'source_key');
  const legacy = before.facts.filter(row => localLegacy(row.source_key));
  const oldClaude = before.identities.filter(row => row.key.startsWith('claude:macos:'));
  const ensureUnknown = (key, provider) => {
    const present = expectedIdentities.get(key);
    if (present) {
      assert.equal(present.provider, provider, '待核对身份提供方不匹配');
      if (present.owner_user_id !== null) throw new Error('待核对身份不能已有归属');
      return;
    }
    expectedIdentities.set(key, {
      key, provider, label: `${provider === 'codex' ? 'Codex' : 'Claude Code'} · 旧记录待重扫`,
      owner_user_id: null
    });
  };
  const mark = (key, reason) => {
    if (!expectedUncertain.has(key)) expectedUncertain.set(key, { source_key: key, reason });
  };

  for (const fact of legacy) {
    const oldKey = fact.source_key;
    const nextKey = scopedKey(oldKey, fact.source_identity_key);
    const provider = oldKey.startsWith('codex:') ? 'codex' : 'claude';
    assert.equal(fact.provider, provider, '旧键与提供方不一致');
    const unknown = `${provider}:legacy-unverified:${hash(fact.source_identity_key)}`;
    ensureUnknown(unknown, provider);
    const expected = expectedFacts.get(oldKey);
    expected.source_identity_key = unknown;
    if (expectedFacts.has(nextKey)) {
      mark(oldKey, 'legacy_key_collision');
      mark(nextKey, 'legacy_key_collision');
    } else {
      expectedFacts.delete(oldKey);
      expected.source_key = nextKey;
      expectedFacts.set(nextKey, expected);
      const project = expectedProjects.get(oldKey);
      if (project) {
        expectedProjects.delete(oldKey);
        project.source_key = nextKey;
        expectedProjects.set(nextKey, project);
      }
      mark(nextKey, 'legacy_unverified');
    }
  }
  for (const identity of oldClaude) {
    const unknown = `claude:legacy-unverified:${hash(identity.key)}`;
    const remaining = [...expectedFacts.values()].filter(row => row.source_identity_key === identity.key);
    if (remaining.length) ensureUnknown(unknown, 'claude');
    for (const fact of remaining) {
      fact.source_identity_key = unknown;
      mark(fact.source_key, 'legacy_unverified');
    }
    expectedIdentities.delete(identity.key);
  }

  compareRows(after.facts, [...expectedFacts.values()], 'source_key', '事实键、归属或计量字段');
  compareRows(after.projects, [...expectedProjects.values()], 'source_key', '项目关联');
  compareRows(after.identities, [...expectedIdentities.values()], 'key', '来源身份');
  compareRows(after.uncertain, [...expectedUncertain.values()], 'source_key', '待核对标记');
  const factKeys = new Set(after.facts.map(row => row.source_key));
  assert(after.projects.every(row => factKeys.has(row.source_key)), '项目关联存在孤儿键');

  const reset = legacy.length > 0 || oldClaude.length > 0 || !before.projectBackfill;
  const expectedCursors = before.cursors.map(row => ({
    ...row,
    byte_offset: reset ? 0 : row.byte_offset,
    state_json: reset ? '{}' : row.state_json,
    tail_hash: reset ? '' : row.tail_hash,
    birthtime_ms: row.birthtime_ms ?? 0
  }));
  compareRows(after.cursors, expectedCursors, 'file_path', '游标');
  const priorOwners = ownerTotals(before);
  for (const [owner, totals] of ownerTotals(after)) {
    const prior = priorOwners.get(owner) ?? { count: 0, tokens: 0 };
    assert(totals.count <= prior.count && totals.tokens <= prior.tokens, '用户已确认用量意外增加');
  }
}

async function launchIsolated() {
  const app = await electron.launch({
    executablePath: executable, args: [`--token-user-data=${workspace}`],
    env: { ...process.env, TOKEN_CODEX_SESSIONS_DIR: codex, TOKEN_CLAUDE_PROJECTS_DIR: claude },
    timeout: 30000
  });
  try {
    const page = await app.firstWindow();
    await page.locator('body').waitFor({ timeout: 15000 });
    const locations = await app.evaluate(({ app, session }) => ({
      userData: app.getPath('userData'), storage: session.defaultSession.getStoragePath()
    }));
    same(locations, { userData: workspace, storage: workspace }, '应用未隔离用户数据目录');
  } finally {
    await app.close();
  }
}

try {
  sqlite(source, `.backup '${beforeDatabase}'`);
  sqlite(source, `.backup '${database}'`);
  const before = snapshot(beforeDatabase);
  await launchIsolated();
  const first = snapshot(database);
  verifyMigration(before, first);
  await launchIsolated();
  const second = snapshot(database);
  for (const table of ['users', 'facts', 'identities', 'cursors', 'projects', 'uncertain']) {
    same(sorted(second[table]), sorted(first[table]), `再次启动改变了${table}`);
  }
  console.log('隔离旧库迁移校验通过：账户、事实、项目关联、身份白名单、待核对标记和游标均符合迁移规则；二次启动幂等。');
  console.log('本脚本仅验证副本数据守恒；界面授权、安装及回退仍按 TC-095 人工验收。');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
