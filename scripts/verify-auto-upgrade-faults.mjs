import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { build } from 'esbuild';

// TC-076: real DMGs and real app binaries, with faults injected into the production installer module.
// This does not exercise the packaged update-helper process or system Applications directories.
if (process.platform !== 'darwin') throw new Error('TC-076 故障复验需要 macOS 图形会话');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oldDmg = process.env.TOKEN_TC076_OLD_DMG;
const newDmg = process.env.TOKEN_TC076_NEW_DMG;
if (!oldDmg || !newDmg) {
  console.log('TC-076 真实制品故障子范围未运行：须提供旧/新 DMG 及已知 SHA-256；默认合成模式只验成功链路。');
  process.exit(0);
}
const oldHash = process.env.TOKEN_TC076_OLD_SHA256;
const newHash = process.env.TOKEN_TC076_NEW_SHA256;
for (const [file, hash] of [[oldDmg, oldHash], [newDmg, newHash]]) {
  assert.equal(path.isAbsolute(file), true, 'DMG 须使用绝对路径');
  assert.match(hash || '', /^[a-f0-9]{64}$/, 'DMG 须提供已知 SHA-256');
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false, 'DMG 不能是符号链接');
  assert.equal(fs.statSync(file).isFile(), true, 'DMG 不存在');
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), hash, 'DMG 摘要不符');
  execFileSync('/usr/bin/hdiutil', ['verify', file], { stdio: 'ignore', timeout: 240_000 });
}

const newVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const [major, minor, patch] = newVersion.split('.').map(Number);
assert.ok(Number.isSafeInteger(patch) && patch > 0);
const oldVersion = `${major}.${minor}.${patch - 1}`;
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'token-test-db-tc076-faults-'));
const userData = path.join(workspace, 'user-data');
const codexDir = path.join(workspace, 'codex');
const claudeDir = path.join(workspace, 'claude');
const installed = path.join(workspace, 'installed', 'Token.app');
const executable = path.join(installed, 'Contents', 'MacOS', 'Token');
const environment = { ...process.env, TOKEN_CODEX_SESSIONS_DIR: codexDir, TOKEN_CLAUDE_PROJECTS_DIR: claudeDir };
const run = (program, args) => {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 240_000 });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(program)} 执行失败`);
  return `${result.stdout || ''}${result.stderr || ''}`;
};
const version = bundle => execFileSync('/usr/libexec/PlistBuddy',
  ['-c', 'Print CFBundleShortVersionString', path.join(bundle, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
const appPids = () => execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  .filter(line => line.includes(`--token-user-data=${workspace}/`) && line.includes('Token.app/Contents/MacOS/Token'))
  .map(line => Number(line.trim().match(/^\d+/)?.[0])).filter(Number.isInteger);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (predicate()) return; } catch { /* process or file is changing */ }
    await sleep(100);
  }
  throw new Error(`${label}超时`);
}
async function stopApps() {
  for (const pid of appPids()) try { process.kill(pid, 'SIGTERM'); } catch { /* exited */ }
  await waitFor(() => appPids().length === 0, '隔离 App 退出').catch(() => {});
}
function launch(bundle, data, id) {
  const args = [`--token-user-data=${data}`];
  if (id) args.push(`--token-upgrade-id=${id}`);
  const { ELECTRON_RUN_AS_NODE: _nodeMode, ...env } = environment;
  const child = spawn(path.join(bundle, 'Contents', 'MacOS', 'Token'), args,
    { detached: true, stdio: 'ignore', cwd: data, env });
  child.on('error', () => {});
  child.unref();
}

let app;
let mounted = false;
const oldMount = path.join(workspace, 'old-mount');
let installer;
try {
  for (const directory of [userData, codexDir, claudeDir, path.dirname(installed), oldMount]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  run('/usr/bin/hdiutil', ['attach', oldDmg, '-readonly', '-nobrowse', '-mountpoint', oldMount]);
  mounted = true;
  const oldBundle = path.join(oldMount, 'Token.app');
  assert.equal(version(oldBundle), oldVersion);
  assert.equal(run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier',
    path.join(oldBundle, 'Contents', 'Info.plist')]).trim(), 'dev.lzhe72.token');
  const readonlyUserData = path.join(workspace, 'readonly-user-data');
  fs.mkdirSync(readonlyUserData, { mode: 0o700 });
  app = await electron.launch({ executablePath: path.join(oldBundle, 'Contents', 'MacOS', 'Token'),
    args: [`--token-user-data=${readonlyUserData}`], env: environment });
  assert.equal(await app.evaluate(({ app: electronApp }) => electronApp.getVersion()), oldVersion);
  await expect((await app.firstWindow()).getByPlaceholder('至少 10 位')).toBeVisible();
  await app.close();
  app = undefined;
  console.log('TC-076 真实旧版从只读 DMG 直接启动并使用隔离用户数据通过；未触发安装目标选择。');
  run('/usr/bin/ditto', [oldBundle, installed]);
  run('/usr/bin/hdiutil', ['detach', oldMount]);
  mounted = false;
  fs.rmdirSync(oldMount);

  const moduleFile = path.join(workspace, 'update-install.mjs');
  await build({ entryPoints: [path.join(root, 'src/main/update-install.ts')], outfile: moduleFile,
    bundle: true, platform: 'node', target: 'node24', format: 'esm' });
  installer = await import(pathToFileURL(moduleFile).href);

  const stamp = new Date().toISOString();
  const day = stamp.slice(0, 10);
  const facts = [
    { type: 'session_meta', payload: { session_id: 'tc076-fault-synthetic', cwd: '/work/tc076-fault-synthetic' } },
    { type: 'turn_context', payload: { turn_id: 'one', model: 'gpt-tc076-fault' } },
    { type: 'token_usage_record', timestamp: stamp,
      payload: { session_id: 'tc076-fault-synthetic', turn_id: 'one', response_id: 'one',
        usage: { input_tokens: 1024, output_tokens: 256, total_tokens: 1280 } } }
  ];
  fs.writeFileSync(path.join(codexDir, 'synthetic.jsonl'), facts.map(value => JSON.stringify(value)).join('\n') + '\n');
  async function openAndCheck(create = false) {
    app = await electron.launch({ executablePath: executable, args: [`--token-user-data=${userData}`], env: environment });
    const page = await app.firstWindow();
    if (create) {
      await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
      await page.getByRole('checkbox', { name: /信任此设备/ }).check();
      await page.getByRole('button', { name: '创建并进入' }).click();
      await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
      await page.getByRole('button', { name: /数据来源/ }).click();
      await page.getByRole('button', { name: '立即扫描' }).click();
    }
    await page.getByRole('complementary').getByRole('button', { name: /概览/ }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    assert.equal((await page.evaluate(() => window.tokenApi.getState())).user?.username, 'admin');
    const report = await page.evaluate(value => window.tokenApi.queryUsage({ from: value, to: value,
      timeZone: 'UTC', granularity: 'day', provider: 'all', model: '', projectKey: '', userId: 'all' }), day);
    assert.equal(report.totals.totalTokens, 1280, '合成报表未保留');
    await app.close();
    app = undefined;
    await waitFor(() => appPids().length === 0, 'Playwright App 完全退出');
  }
  await openAndCheck(true);
  assert.equal(version(installed), oldVersion);
  await openAndCheck();
  console.log('TC-076 未确认安装、未触发升级时，真实旧版可重启、受信登录和 1280 Token 保留。');

  const packageSize = fs.statSync(newDmg).size;
  const request = () => {
    const packageFile = path.join(workspace, `download-${randomUUID()}.dmg`);
    fs.copyFileSync(newDmg, packageFile);
    return { id: randomUUID(), oldPid: 0, packageFile, packageSize, packageSha256: newHash,
      version: newVersion, arch: process.arch === 'arm64' ? 'arm64' : 'x64',
      currentBundle: installed, targetBundle: installed, userData };
  };
  const faults = [
    ['mount', '模拟挂载失败', () => ({ run: (program, args) => {
      if (program.endsWith('hdiutil') && args[0] === 'attach') throw new Error('模拟挂载失败');
      return run(program, args);
    } })],
    ['space', 'ENOSPC 模拟空间不足', () => ({ run: (program, args) => {
      if (program.endsWith('ditto')) throw new Error('ENOSPC 模拟空间不足');
      return run(program, args);
    } })],
    ['replace', '模拟替换失败', () => ({ move: (from, to) => {
      if (from.endsWith('staged.app')) throw new Error('模拟替换失败');
      fs.renameSync(from, to);
    } })],
    ['launch', '模拟启动失败', () => ({ launch: (bundle, data, id) => {
      if (id) throw new Error('模拟启动失败');
      launch(bundle, data, null);
    } })],
    ['health', '新版应用未能启动', () => ({ launch: (bundle, data, id) => {
      if (!id) launch(bundle, data, null);
    }, readyTimeoutMs: 500 })]
  ];
  for (const [name, message, inject] of faults) {
    const current = request();
    const mounts = [];
    const hooks = inject();
    const originalRun = hooks.run || run;
    hooks.run = (program, args) => {
      if (program.endsWith('hdiutil') && args[0] === 'attach') mounts.push(args.at(-1));
      return originalRun(program, args);
    };
    await assert.rejects(installer.runAutomaticInstall(current, hooks), error => error.message.includes(message));
    assert.equal(version(installed), oldVersion, `${name}: 旧版未恢复`);
    assert.equal(fs.existsSync(current.packageFile), false, `${name}: 下载副本未清理`);
    assert.equal(fs.existsSync(path.join(path.dirname(installed), `.Token-update-${current.id}`)), false,
      `${name}: 备份或暂存未清理`);
    for (const mount of mounts) {
      assert.equal(fs.existsSync(mount), false, `${name}: 挂载目录未清理`);
      assert.equal(run('/usr/bin/hdiutil', ['info']).includes(mount), false, `${name}: 映像未卸载`);
    }
    const status = installer.readInstallStatus(userData);
    assert.equal(status?.status, 'rollback', `${name}: 缺少回滚状态`);
    await waitFor(() => appPids().length > 0, `${name}: 旧版自动重启`);
    await stopApps();
    await openAndCheck();
    console.log(`TC-076 ${name}：旧版回退、受信登录、1280 Token、挂载/备份/下载副本清理通过。`);
  }

  const retry = request();
  await installer.runAutomaticInstall(retry, { launch, readyTimeoutMs: 20_000 });
  assert.equal(version(installed), newVersion, '故障后重试未安装新版');
  assert.equal(installer.readInstallStatus(userData)?.status, 'success');
  assert.equal(fs.existsSync(path.join(path.dirname(installed), `.Token-update-${retry.id}`)), false);
  await waitFor(() => appPids().length > 0, '重试后新版启动');
  await stopApps();
  await openAndCheck();
  console.log('TC-076 五种注入故障后，真实 DMG 重试成功；新版受信登录与 1280 Token 保留。');
} finally {
  await app?.close().catch(() => {});
  await stopApps().catch(() => {});
  if (mounted) {
    try { run('/usr/bin/hdiutil', ['detach', oldMount]); mounted = false; }
    catch { /* preserve mounted image for inspection */ }
  }
  if (mounted || appPids().length > 0) throw new Error('隔离进程或只读挂载未清理，保留临时目录供检查');
  fs.rmSync(workspace, { recursive: true, force: true });
}
