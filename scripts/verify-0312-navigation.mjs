import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TC-108: run the repeatable 20-iteration and long-scroll performance matrix
// against a copy of the frozen 0.3.12 packaged app, never production userData.
if (process.platform !== 'darwin') throw new Error('TC-108 需要 macOS 图形会话');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'release', 'mac', 'Token.app');
const expected = process.env.TOKEN_TC108_ASAR_SHA256;
if (!/^[a-f0-9]{64}$/.test(expected || '')) throw new Error('TC-108 需提供冻结 app.asar 的 SHA-256');
const asar = path.join(app, 'Contents', 'Resources', 'app.asar');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(hash(asar), expected, '打包应用内容与冻结摘要不符');
const version = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString',
  path.join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
assert.equal(version, '0.3.12');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'token-test-db-tc108-'));
try {
  const installed = path.join(workspace, 'installed', 'Token.app');
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  execFileSync('/usr/bin/ditto', [app, installed], { stdio: 'ignore', timeout: 240_000 });
  assert.equal(hash(path.join(installed, 'Contents', 'Resources', 'app.asar')), expected);
  const executable = path.join(installed, 'Contents', 'MacOS', 'Token');
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'measure-navigation.mjs')],
    { cwd: root, stdio: 'inherit', timeout: 1_200_000,
      env: { ...process.env, TOKEN_PERF_SKIP_BUILD: '1', TOKEN_PERF_EXECUTABLE: executable } });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'TC-108 隔离副本切页性能或滚动门槛未通过');
  console.log(`TC-108 x64 0.3.12 隔离副本性能通过，app.asar SHA-256 ${expected}。`);
} finally { fs.rmSync(workspace, { recursive: true, force: true }); }
