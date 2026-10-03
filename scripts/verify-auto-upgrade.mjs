import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

if (process.platform !== 'darwin') throw new Error('TC-076 需要 macOS 图形会话');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const newVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const versionParts = newVersion.split('.').map(Number);
if (versionParts.length !== 3 || versionParts.some(part => !Number.isInteger(part)) || versionParts[2] < 1) {
  throw new Error('TC-076 需要可构造前一修订版的版本号');
}
const oldVersion = `${versionParts[0]}.${versionParts[1]}.${versionParts[2] - 1}`;
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'token-test-db-tc076-'));
const userData = path.join(workspace, 'user-data');
const codexDir = path.join(workspace, 'codex');
const claudeDir = path.join(workspace, 'claude');
const installed = path.join(workspace, 'installed', 'Token.app');
const newFolder = path.join(workspace, 'new');
const newBundle = path.join(newFolder, 'Token.app');
const dmg = path.join(workspace, `Token-auto-${newVersion}.dmg`);
for (const directory of [userData, codexDir, claudeDir, path.dirname(installed), newFolder]) fs.mkdirSync(directory, { recursive: true });

function command(program, args, options = {}) {
  return execFileSync(program, args, { encoding: 'utf8', timeout: 240_000, ...options });
}
function version(bundle) {
  return command('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', path.join(bundle, 'Contents', 'Info.plist')]).trim();
}
function runningAppPid() {
  const output = command('/bin/ps', ['-axo', 'pid=,command=']);
  const matching = output.split('\n').filter(line => line.includes(`--token-user-data=${userData}`) &&
    line.includes(path.join(installed, 'Contents', 'MacOS', 'Token')));
  return matching.map(line => Number(line.trim().match(/^\d+/)?.[0])).find(Number.isInteger) || null;
}
function runningHelperPid() {
  const output = command('/bin/ps', ['-axo', 'pid=,command=']);
  const matching = output.split('\n').filter(line => line.includes(path.join(userData, 'updates', 'request-')) &&
    line.includes('update-helper.cjs'));
  return matching.map(line => Number(line.trim().match(/^\d+/)?.[0])).find(Number.isInteger) || null;
}
async function waitFor(predicate, label, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (predicate()) return; } catch { /* replacement is in progress */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${label}超时`);
}

let app;
try {
  if (process.env.TOKEN_TC076_SKIP_BUILD !== '1') {
    command('npm', ['run', 'pack:dir'], { cwd: root, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
      stdio: 'inherit', timeout: 600_000 });
  }
  const built = path.join(root, 'release', 'mac', 'Token.app');
  assert.equal(version(built), newVersion, '打包版本与源码版本不符');
  command('/usr/bin/ditto', [built, installed]);
  command('/usr/bin/ditto', [built, newBundle]);
  const oldAsar = path.join(installed, 'Contents', 'Resources', 'app.asar');
  const oldContents = path.join(workspace, 'old-app-contents');
  asar.extractAll(oldAsar, oldContents);
  const oldPackage = path.join(oldContents, 'package.json');
  const metadata = JSON.parse(fs.readFileSync(oldPackage, 'utf8'));
  metadata.version = oldVersion;
  fs.writeFileSync(oldPackage, JSON.stringify(metadata));
  await asar.createPackage(oldContents, `${oldAsar}.new`);
  fs.renameSync(`${oldAsar}.new`, oldAsar);
  fs.rmSync(oldContents, { recursive: true, force: true });
  command('/usr/libexec/PlistBuddy', ['-c', `Set CFBundleShortVersionString ${oldVersion}`, path.join(installed, 'Contents', 'Info.plist')]);
  assert.equal(version(installed), oldVersion);
  command('/usr/bin/hdiutil', ['create', '-volname', 'Token-auto-test', '-srcfolder', newFolder,
    '-ov', '-format', 'UDZO', dmg]);
  command('/usr/bin/hdiutil', ['verify', dmg]);
  const stamp = new Date().toISOString();
  const facts = [
    { type: 'session_meta', payload: { session_id: 'tc076-synthetic', cwd: '/work/tc076-synthetic' } },
    { type: 'turn_context', payload: { turn_id: 'one', model: 'gpt-tc076' } },
    { type: 'token_usage_record', timestamp: stamp,
      payload: { session_id: 'tc076-synthetic', turn_id: 'one', response_id: 'one',
        usage: { input_tokens: 1024, output_tokens: 256, total_tokens: 1280 } } }
  ];
  fs.writeFileSync(path.join(codexDir, 'synthetic.jsonl'), facts.map(value => JSON.stringify(value)).join('\n') + '\n');
  const executable = path.join(installed, 'Contents', 'MacOS', 'Token');
  const environment = { ...process.env, TOKEN_CODEX_SESSIONS_DIR: codexDir, TOKEN_CLAUDE_PROJECTS_DIR: claudeDir };
  app = await electron.launch({ executablePath: executable, args: [`--token-user-data=${userData}`], env: environment });
  let page = await app.firstWindow();
  assert.equal(await app.evaluate(({ app: electronApp }) => electronApp.getVersion()), oldVersion);
  await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
  await page.getByRole('checkbox', { name: /信任此设备/ }).check();
  await page.getByRole('button', { name: '创建并进入' }).click();
  await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
  await page.getByRole('button', { name: /数据来源/ }).click();
  await page.getByRole('button', { name: '立即扫描' }).click();
  const day = stamp.slice(0, 10);
  async function reportTotal() {
    const report = await page.evaluate(value => window.tokenApi.queryUsage({ from: value, to: value,
      timeZone: 'UTC', granularity: 'day', provider: 'all', model: '', projectKey: '', userId: 'all' }), day);
    return report.totals.totalTokens;
  }
  assert.equal(await reportTotal(), 1280);
  command(process.execPath, [path.join(root, 'scripts', 'publish-update.mjs'), dmg, newVersion, process.arch,
    path.join(userData, 'server')]);
  await page.getByRole('button', { name: /系统设置/ }).click();
  await page.getByRole('button', { name: '检查更新' }).click();
  await expect(page.getByRole('button', { name: `下载并更新到 ${newVersion}` })).toBeVisible();
  await page.getByRole('button', { name: `下载并更新到 ${newVersion}` }).click();
  await waitFor(() => version(installed) === newVersion, '自动替换新版');
  await waitFor(() => Boolean(runningAppPid()), '自动启动新版');
  const resultFile = path.join(userData, 'updates', 'last-install.json');
  await waitFor(() => JSON.parse(fs.readFileSync(resultFile, 'utf8')).status === 'success', '新版健康检查和更新成功状态');
  await waitFor(() => !runningHelperPid(), '更新辅助进程退出');
  console.log('TC-076 自动更新已退出旧版、替换应用并启动新版；无 Finder 拖拽。');
  await app.close().catch(() => {});
  app = undefined;
  const newPid = runningAppPid();
  if (newPid) {
    process.kill(newPid, 'SIGTERM');
    await waitFor(() => !runningAppPid(), '关闭自动启动的新版');
  }
  app = await electron.launch({ executablePath: executable, args: [`--token-user-data=${userData}`], env: environment });
  page = await app.firstWindow();
  assert.equal(await app.evaluate(({ app: electronApp }) => electronApp.getVersion()), newVersion);
  await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
  assert.equal((await page.evaluate(() => window.tokenApi.getState())).user?.username, 'admin', '受信登录未延续');
  assert.equal(await reportTotal(), 1280, '合成用量未延续');
  console.log(`TC-076 ${newVersion} 受信登录和 1280 Token 合成报表已验证。`);
} catch (error) {
  const resultFile = path.join(userData, 'updates', 'last-install.json');
  if (fs.existsSync(resultFile)) console.error(`隔离更新结果：${fs.readFileSync(resultFile, 'utf8').trim()}`);
  throw error;
} finally {
  await app?.close().catch(() => {});
  const newPid = runningAppPid();
  if (newPid) {
    try { process.kill(newPid, 'SIGTERM'); } catch { /* process already exited */ }
    await waitFor(() => !runningAppPid(), '清理隔离应用进程', 10_000).catch(() => {});
  }
  const helperPid = runningHelperPid();
  if (helperPid) {
    try { process.kill(helperPid, 'SIGTERM'); } catch { /* process already exited */ }
    await waitFor(() => !runningHelperPid(), '清理隔离更新辅助进程', 10_000).catch(() => {});
  }
  if (!runningAppPid() && !runningHelperPid()) fs.rmSync(workspace, { recursive: true, force: true });
  else console.warn('隔离应用仍在运行，保留临时目录以避免破坏进程。');
}
