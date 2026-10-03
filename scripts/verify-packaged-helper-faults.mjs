import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

// TC-076: real old UI -> its packaged update-helper -> real DMG, with faults limited
// to an isolated helper process by tc076-helper-fault.cjs. No system app path is used.
if (process.platform !== 'darwin') throw new Error('TC-076 打包辅助进程故障复验需要 macOS 图形会话');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oldDmg = process.env.TOKEN_TC076_OLD_DMG;
const newDmg = process.env.TOKEN_TC076_NEW_DMG;
if (!oldDmg || !newDmg) {
  console.log('TC-076 打包辅助进程故障子范围未运行：须提供真实旧/新 DMG 和已知 SHA-256。');
  process.exit(0);
}
const oldHash = process.env.TOKEN_TC076_OLD_SHA256;
const newHash = process.env.TOKEN_TC076_NEW_SHA256;
const command = (program, args, options = {}) => execFileSync(program, args,
  { encoding: 'utf8', timeout: 240_000, ...options });
const updateMounts = () => new Set(command('/usr/bin/hdiutil', ['info']).split('\n')
  .filter(line => line.includes('token-update-mount-')));
const mountBaseline = updateMounts();
for (const [file, hash] of [[oldDmg, oldHash], [newDmg, newHash]]) {
  assert.equal(path.isAbsolute(file), true);
  assert.match(hash || '', /^[a-f0-9]{64}$/);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), hash);
  command('/usr/bin/hdiutil', ['verify', file]);
}
const newVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const [major, minor, patch] = newVersion.split('.').map(Number);
assert.ok(Number.isSafeInteger(patch) && patch > 0);
const oldVersion = `${major}.${minor}.${patch - 1}`;
const workspace = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'token-test-db-tc076-helper-'));
const userData = path.join(workspace, 'user-data');
const codexDir = path.join(workspace, 'codex');
const claudeDir = path.join(workspace, 'claude');
const installed = path.join(workspace, 'installed', 'Token.app');
const executable = path.join(installed, 'Contents', 'MacOS', 'Token');
const mount = path.join(workspace, 'old-mount');
const preload = path.join(root, 'scripts', 'tc076-helper-fault.cjs');
const baseEnv = { ...process.env, TOKEN_TEST_TELEMETRY_PORT: '0',
  TOKEN_CODEX_SESSIONS_DIR: codexDir, TOKEN_CLAUDE_PROJECTS_DIR: claudeDir };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const version = bundle => command('/usr/libexec/PlistBuddy',
  ['-c', 'Print CFBundleShortVersionString', path.join(bundle, 'Contents', 'Info.plist')]).trim();
const ps = () => command('/bin/ps', ['-axo', 'pid=,command=']).split('\n');
const matchingPids = token => ps().filter(line => line.includes(workspace) && line.includes(token))
  .map(line => Number(line.trim().match(/^\d+/)?.[0])).filter(Number.isInteger);
const appPids = () => matchingPids('Token.app/Contents/MacOS/Token')
  .filter(pid => ps().some(line => line.trim().startsWith(`${pid} `) && line.includes(`--token-user-data=${userData}`)));
const helperPids = () => matchingPids('update-helper.cjs');
async function waitFor(predicate, label, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (predicate()) return; } catch { /* app and helper are changing files */ }
    await sleep(150);
  }
  throw new Error(`${label}超时`);
}
async function stopApps() {
  for (const pid of appPids()) try { process.kill(pid, 'SIGTERM'); } catch { /* exited */ }
  await waitFor(() => appPids().length === 0, '隔离应用退出', 15_000);
}
function status() {
  const file = path.join(userData, 'updates', 'last-install.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}
function noInstallResidue() {
  const parent = path.dirname(installed);
  assert.deepEqual(fs.readdirSync(parent).filter(name => name.startsWith('.Token-update-')), []);
  const updates = path.join(userData, 'updates');
  if (fs.existsSync(updates)) {
    assert.deepEqual(fs.readdirSync(updates).filter(name => name.endsWith('.dmg') ||
      name.endsWith('.download') || name.startsWith('request-') || name.startsWith('ready-')), []);
  }
  for (const line of updateMounts()) {
    assert.equal(mountBaseline.has(line), true, '本次自动安装映像仍挂载');
  }
}

let app;
let mounted = false;
try {
  for (const directory of [userData, codexDir, claudeDir, path.dirname(installed), mount]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  command('/usr/bin/hdiutil', ['attach', oldDmg, '-readonly', '-nobrowse', '-mountpoint', mount]);
  mounted = true;
  const oldBundle = path.join(mount, 'Token.app');
  assert.equal(version(oldBundle), oldVersion);
  assert.equal(command('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier',
    path.join(oldBundle, 'Contents', 'Info.plist')]).trim(), 'dev.lzhe72.token');
  command('/usr/bin/ditto', [oldBundle, installed]);
  command('/usr/bin/hdiutil', ['detach', mount]);
  mounted = false;
  fs.rmdirSync(mount);
  const stamp = new Date().toISOString();
  const day = stamp.slice(0, 10);
  const facts = [
    { type: 'session_meta', payload: { session_id: 'tc076-helper-synthetic', cwd: '/work/tc076-helper' } },
    { type: 'turn_context', payload: { turn_id: 'one', model: 'gpt-tc076-helper' } },
    { type: 'token_usage_record', timestamp: stamp, payload: {
      session_id: 'tc076-helper-synthetic', turn_id: 'one', response_id: 'one',
      usage: { input_tokens: 1024, output_tokens: 256, total_tokens: 1280 }
    } }
  ];
  fs.writeFileSync(path.join(codexDir, 'synthetic.jsonl'), facts.map(value => JSON.stringify(value)).join('\n') + '\n');
  async function openOld(fault) {
    const env = { ...baseEnv };
    if (fault) Object.assign(env, { TOKEN_TC076_HELPER_FAULT: fault,
      TOKEN_TC076_HELPER_WORKSPACE: workspace });
    app = await electron.launch({ executablePath: executable, args: [`--token-user-data=${userData}`], env });
    if (fault && fault !== 'setup') {
      // Electron strips NODE_OPTIONS at app startup; set it only in this isolated
      // old main process so its subsequently spawned Node-mode helper inherits it.
      await app.evaluate((_, option) => { process.env.NODE_OPTIONS = option; }, `--require=${preload}`);
      assert.equal((await app.evaluate(() => process.env.NODE_OPTIONS))?.includes(preload), true);
    }
    const page = await app.firstWindow();
    if (fault === 'setup') {
      await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
      await page.getByRole('checkbox', { name: /信任此设备/ }).check();
      await page.getByRole('button', { name: '创建并进入' }).click();
      await page.getByRole('button', { name: /数据来源/ }).click();
      await page.getByRole('button', { name: '立即扫描' }).click();
    }
    await page.getByRole('complementary').getByRole('button', { name: /概览/ }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    assert.equal((await page.evaluate(() => window.tokenApi.getState())).user?.username, 'admin');
    const report = await page.evaluate(value => window.tokenApi.queryUsage({ from: value, to: value,
      timeZone: 'UTC', granularity: 'day', provider: 'all', model: '', projectKey: '', userId: 'all' }), day);
    assert.equal(report.totals.totalTokens, 1280);
    return page;
  }
  let page = await openOld('setup');
  await app.close();
  app = undefined;
  await waitFor(() => appPids().length === 0, '初始旧版退出');
  command(process.execPath, [path.join(root, 'scripts', 'publish-update.mjs'), newDmg, newVersion, process.arch,
    path.join(userData, 'server')]);

  for (const fault of ['mount', 'space', 'replace', 'launch', 'health']) {
    assert.equal(version(installed), oldVersion);
    page = await openOld(fault);
    await page.getByRole('button', { name: /系统设置/ }).click();
    await page.getByRole('button', { name: '检查更新' }).click();
    await expect(page.getByRole('button', { name: `下载并更新到 ${newVersion}` })).toBeVisible();
    await page.getByRole('button', { name: `下载并更新到 ${newVersion}` }).click();
    try {
      await waitFor(() => fs.readdirSync(workspace).some(name => name.startsWith(`fault-${fault}-`)),
        `${fault} 注入命中`, 45_000);
    } catch (error) {
      const attempts = fs.readdirSync(workspace).filter(name => name.startsWith('preload-'))
        .map(name => JSON.parse(fs.readFileSync(path.join(workspace, name), 'utf8')));
      console.error(`TC-076 ${fault} 诊断：preload=${JSON.stringify(attempts)} helper=${helperPids().join(',')} app=${appPids().join(',')} version=${version(installed)} status=${JSON.stringify(status())}`);
      throw error;
    }
    await waitFor(() => helperPids().length === 0 && version(installed) === oldVersion &&
      appPids().length > 0, `${fault} 打包辅助进程回滚并重启旧版`, 60_000);
    const result = status();
    if (result) assert.equal(result.status, 'rollback');
    noInstallResidue();
    await app.close().catch(() => {});
    app = undefined;
    await stopApps();
    const checked = await openOld(null);
    await expect(checked.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await app.close();
    app = undefined;
    await waitFor(() => appPids().length === 0, `${fault} 旧版复查退出`);
    console.log(`TC-076 打包 helper ${fault} 注入：旧版自动恢复、受信登录、1280 Token 与清理通过。`);
  }

  page = await openOld(null);
  await page.getByRole('button', { name: /系统设置/ }).click();
  await page.getByRole('button', { name: '检查更新' }).click();
  await expect(page.getByRole('button', { name: `下载并更新到 ${newVersion}` })).toBeVisible();
  await page.getByRole('button', { name: `下载并更新到 ${newVersion}` }).click();
  await waitFor(() => version(installed) === newVersion && helperPids().length === 0 && appPids().length > 0,
    '故障后旧 UI 打包 helper 自动重试', 120_000);
  const result = status();
  if (result) assert.equal(result.status, 'success');
  noInstallResidue();
  await app.close().catch(() => {});
  app = undefined;
  await stopApps();
  app = await electron.launch({ executablePath: executable, args: [`--token-user-data=${userData}`], env: baseEnv });
  page = await app.firstWindow();
  assert.equal(await app.evaluate(({ app: electronApp }) => electronApp.getVersion()), newVersion);
  await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
  assert.equal((await page.evaluate(() => window.tokenApi.getState())).user?.username, 'admin');
  const report = await page.evaluate(value => window.tokenApi.queryUsage({ from: value, to: value,
    timeZone: 'UTC', granularity: 'day', provider: 'all', model: '', projectKey: '', userId: 'all' }), day);
  assert.equal(report.totals.totalTokens, 1280);
  console.log('TC-076 打包 helper 五种故障后，旧 UI 重试成功，新版受信登录和 1280 Token 保留。');
} finally {
  await app?.close().catch(() => {});
  await stopApps().catch(() => {});
  for (const pid of helperPids()) try { process.kill(pid, 'SIGTERM'); } catch { /* exited */ }
  await waitFor(() => helperPids().length === 0, '隔离 helper 退出', 10_000).catch(() => {});
  if (mounted) {
    try { command('/usr/bin/hdiutil', ['detach', mount]); mounted = false; }
    catch { /* preserve mounted image for inspection */ }
  }
  if (mounted || appPids().length || helperPids().length) {
    throw new Error('TC-076 隔离进程或映像未清理，保留临时目录供检查');
  }
  fs.rmSync(workspace, { recursive: true, force: true });
}
