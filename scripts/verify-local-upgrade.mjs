import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [oldInput, newInput] = process.argv.slice(2);
if (!oldInput || !newInput || !path.isAbsolute(oldInput) || !path.isAbsolute(newInput) ||
  !fs.statSync(oldInput, { throwIfNoEntry: false })?.isFile() ||
  !fs.statSync(newInput, { throwIfNoEntry: false })?.isFile()) {
  console.error('用法: npm run test:upgrade:local -- /绝对路径/Token-0.2.0.dmg /绝对路径/Token-0.3.0.dmg');
  process.exit(2);
}

const oldDmg = path.resolve(oldInput);
const newDmg = path.resolve(newInput);
const versionMatch = path.basename(newDmg).match(/^Token-(\d+\.\d+\.\d+)\.dmg$/);
if (!versionMatch) throw new Error('新版 DMG 文件名必须为 Token-x.y.z.dmg');
const newVersion = versionMatch[1];
if (newVersion !== '0.3.0') throw new Error('当前脚本验收 0.2.0 → 0.3.0，请为其他版本更新测试步骤');
function versionGreater(newer, older) {
  const left = newer.split('.').map(Number);
  const right = older.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'token-local-upgrade-'));
const userData = path.join(root, 'user-data');
const codexDir = path.join(root, 'codex');
const claudeDir = path.join(root, 'claude');
const installedApp = path.join(root, 'installed', 'Token.app');
const executablePath = path.join(installedApp, 'Contents', 'MacOS', 'Token');
const mounted = new Set();
fs.mkdirSync(userData);
fs.mkdirSync(codexDir);
fs.mkdirSync(claudeDir);
fs.mkdirSync(path.dirname(installedApp));

function command(program, args) {
  return execFileSync(program, args, { encoding: 'utf8', timeout: 120_000 });
}

function installDmg(dmg) {
  const mount = fs.mkdtempSync(path.join(root, 'mount-'));
  let attached = false;
  try {
    command('hdiutil', ['verify', dmg]);
    command('hdiutil', ['attach', dmg, '-nobrowse', '-mountpoint', mount]);
    attached = true;
    mounted.add(mount);
    fs.rmSync(installedApp, { recursive: true, force: true });
    command('ditto', [path.join(mount, 'Token.app'), installedApp]);
  } finally {
    if (attached) {
      command('hdiutil', ['detach', mount]);
      mounted.delete(mount);
    }
    if (!mounted.has(mount)) fs.rmdirSync(mount);
  }
}

function sha256(file) {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}

function detachOpenedImage(download) {
  try {
    const plist = execFileSync('hdiutil', ['info', '-plist']);
    const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist });
    const info = JSON.parse(json.toString('utf8'));
    const canonical = fs.realpathSync.native(download);
    for (const image of info.images ?? []) {
      if (image['image-path'] !== download && image['image-path'] !== canonical) continue;
      const device = image['system-entities']?.find(entity => entity['dev-entry'])?.['dev-entry'];
      if (device) command('hdiutil', ['detach', device]);
    }
    return true;
  } catch (error) {
    console.warn(`检查自动打开的磁盘映像失败：${error instanceof Error ? error.message : error}`);
    return false;
  }
}

const environment = { ...process.env, TOKEN_CODEX_SESSIONS_DIR: codexDir, TOKEN_CLAUDE_PROJECTS_DIR: claudeDir };
let application;
let downloaded = '';
try {
  const timestamp = new Date().toISOString();
  fs.writeFileSync(path.join(codexDir, 'synthetic.jsonl'), [
    { type: 'session_meta', payload: { session_id: 'upgrade-synthetic', cwd: '/work/upgrade-synthetic' } },
    { type: 'turn_context', payload: { turn_id: 'one', model: 'gpt-upgrade-synthetic' } },
    { type: 'token_usage_record', timestamp, payload: { session_id: 'upgrade-synthetic', turn_id: 'one', response_id: 'one',
      usage: { input_tokens: 1024, output_tokens: 256, total_tokens: 1280 } } }
  ].map(value => JSON.stringify(value)).join('\n') + '\n');

  installDmg(oldDmg);
  application = await electron.launch({ executablePath, args: [`--token-user-data=${userData}`], env: environment });
  let page = await application.firstWindow();
  const oldVersion = await application.evaluate(({ app }) => app.getVersion());
  assert.equal(oldVersion, '0.2.0', '旧版应用必须为 0.2.0');
  assert.ok(versionGreater(newVersion, oldVersion), '目标版本必须高于现有版本');
  await page.getByPlaceholder('例如 lzhe72').fill('admin');
  await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
  await page.getByRole('checkbox', { name: /信任此设备/ }).check();
  await page.getByRole('button', { name: '创建并进入' }).click();
  await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.tokenApi.getServerStatus())).online).toBe(true);
  await page.getByRole('button', { name: /数据来源/ }).click();
  await page.getByRole('button', { name: '立即扫描' }).click();
  const currentDay = timestamp.slice(0, 10);
  async function assertReport(windowPage, stage) {
    const report = await windowPage.evaluate(day => window.tokenApi.queryUsage({ from: day, to: day,
      timeZone: 'UTC', granularity: 'day', provider: 'all', model: '', projectKey: '', userId: 'all' }), currentDay);
    assert.equal(report.totals.totalTokens, 1280, `${stage}合成用量不符`);
  }
  await assertReport(page, '旧版扫描后');

  command(process.execPath, [path.join(projectRoot, 'scripts', 'publish-update.mjs'),
    newDmg, newVersion, process.arch === 'arm64' ? 'arm64' : 'x64', path.join(userData, 'server')]);
  await page.getByRole('button', { name: /概览/ }).click();
  await page.getByRole('button', { name: '检查更新' }).click();
  await expect(page.getByText(`发现 ${newVersion}`)).toBeVisible();
  await page.getByRole('button', { name: '下载安装包' }).click();
  await expect(page.getByRole('status')).toContainText('安装包已校验并打开');
  downloaded = path.join(userData, 'updates', `Token-${newVersion}-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dmg`);
  await expect.poll(() => fs.existsSync(downloaded)).toBe(true);
  assert.equal(sha256(downloaded), sha256(newDmg), '下载包与发布包 SHA-256 不一致');
  console.log(`下载并打开安装包：${oldVersion} → ${newVersion}，SHA-256 ${sha256(downloaded)}`);

  // 用户关闭安装包而不替换应用：旧版、受信登录及已采集数据应保持可用。
  assert.equal(await application.evaluate(({ app }) => app.getVersion()), oldVersion);
  await assertReport(page, '取消安装前');
  await application.close();
  application = undefined;
  assert.ok(detachOpenedImage(downloaded), '取消安装时卸载磁盘映像失败');
  application = await electron.launch({ executablePath, args: [`--token-user-data=${userData}`], env: environment });
  page = await application.firstWindow();
  assert.equal(await application.evaluate(({ app }) => app.getVersion()), oldVersion, '取消安装后旧版不可用');
  await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
  assert.equal((await page.evaluate(() => window.tokenApi.getState())).user?.username, 'admin', '取消安装后受信登录未恢复');
  await assertReport(page, '取消安装后');
  console.log(`取消安装后旧版 ${oldVersion}、受信登录及 1280 Token 已采集用量均保持可用。`);

  await application.close();
  application = undefined;
  installDmg(downloaded);
  application = await electron.launch({ executablePath, args: [`--token-user-data=${userData}`], env: environment });
  page = await application.firstWindow();
  assert.equal(await application.evaluate(({ app }) => app.getVersion()), newVersion, '替换后的应用版本不符');
  await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
  const state = await page.evaluate(() => window.tokenApi.getState());
  assert.equal(state.user?.username, 'admin', '升级后受信登录未恢复');
  await page.getByRole('button', { name: /数据来源/ }).click();
  await page.getByRole('button', { name: '立即扫描' }).click();
  await assertReport(page, '升级后');
  console.log(`升级后版本 ${newVersion}、受信登录及 1280 Token 合成用量均通过。`);
} finally {
  await application?.close().catch(() => {});
  const imageDetached = !downloaded || detachOpenedImage(downloaded);
  for (const mount of [...mounted]) {
    try { command('hdiutil', ['detach', mount]); mounted.delete(mount); }
    catch { console.warn(`挂载未能卸载，请手动检查：${mount}`); }
  }
  if (mounted.size === 0 && imageDetached) fs.rmSync(root, { recursive: true, force: true });
  else console.warn(`为避免删除仍挂载的磁盘，保留临时目录：${root}`);
}
