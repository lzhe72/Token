import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_ID = 'dev.lzhe72.token';
const APP_NAME = 'Token.app';

export interface InstallRequest {
  id: string;
  oldPid: number;
  packageFile: string;
  packageSize: number;
  packageSha256: string;
  version: string;
  arch: 'arm64' | 'x64';
  currentBundle: string;
  targetBundle: string;
  userData: string;
}

export interface InstallHooks {
  run?: (program: string, args: string[]) => string;
  launch?: (bundle: string, userData: string, id: string | null) => void;
  move?: (source: string, target: string) => void;
  alive?: (pid: number) => boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  readyTimeoutMs?: number;
}

function run(program: string, args: string[]): string {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(program)} 执行失败`);
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function launch(bundle: string, userData: string, id: string | null): void {
  const args = [`--token-user-data=${userData}`];
  if (id) args.push(`--token-upgrade-id=${id}`);
  const { ELECTRON_RUN_AS_NODE: _nodeMode, ...environment } = process.env;
  const child = spawn(path.join(bundle, 'Contents', 'MacOS', 'Token'), args, {
    detached: true, stdio: 'ignore', cwd: userData, env: environment
  });
  child.on('error', () => { /* the health check will detect a failed start */ });
  child.unref();
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function isWritable(directory: string): boolean {
  try { fs.accessSync(directory, fs.constants.W_OK); return true; }
  catch { return false; }
}

export function bundleFromExecutable(executable: string): string {
  const bundle = path.dirname(path.dirname(path.dirname(path.resolve(executable))));
  if (path.basename(bundle) !== APP_NAME || path.basename(path.dirname(executable)) !== 'MacOS') {
    throw new Error('当前应用不是可更新的 Token.app');
  }
  return bundle;
}

export function chooseUpdateTarget(currentBundle: string, options: {
  home?: string; applications?: string; writable?: (directory: string) => boolean;
  makeDirectory?: (directory: string) => void
} = {}): string {
  const current = path.resolve(currentBundle);
  const writable = options.writable ?? isWritable;
  const applications = options.applications ?? '/Applications';
  const home = options.home ?? os.homedir();
  if (path.basename(current) !== APP_NAME) throw new Error('当前应用路径无效');
  if (writable(path.dirname(current))) return current;
  if (!current.startsWith('/Volumes/')) throw new Error('当前安装位置不可写，请检查应用文件权限');
  if (writable(applications)) return path.join(applications, APP_NAME);
  const personalApplications = path.join(home, 'Applications');
  if (options.makeDirectory) options.makeDirectory(personalApplications);
  else fs.mkdirSync(personalApplications, { recursive: true, mode: 0o700 });
  if (!writable(personalApplications)) throw new Error('没有可写的应用安装位置');
  return path.join(personalApplications, APP_NAME);
}

function validateRequest(value: InstallRequest): void {
  if (!value || !/^[a-f0-9-]{36}$/.test(value.id) ||
    !Number.isSafeInteger(value.oldPid) || value.oldPid < 0 ||
    !path.isAbsolute(value.packageFile) || !path.isAbsolute(value.currentBundle) ||
    !path.isAbsolute(value.targetBundle) || !path.isAbsolute(value.userData) ||
    path.basename(value.currentBundle) !== APP_NAME || path.basename(value.targetBundle) !== APP_NAME ||
    !/^\d+\.\d+\.\d+$/.test(value.version) || !['x64', 'arm64'].includes(value.arch) ||
    !Number.isSafeInteger(value.packageSize) || value.packageSize < 1 ||
    !/^[a-f0-9]{64}$/.test(value.packageSha256)) throw new Error('更新请求无效');
  if (!isWritable(path.dirname(value.targetBundle))) throw new Error('目标安装位置不可写');
  if (fs.existsSync(value.targetBundle) && fs.lstatSync(value.targetBundle).isSymbolicLink()) {
    throw new Error('目标应用不能是符号链接');
  }
}

function bundleValue(bundle: string, key: string, command: (program: string, args: string[]) => string): string {
  return command('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, path.join(bundle, 'Contents', 'Info.plist')]).trim();
}

function bundleTeam(bundle: string, command: (program: string, args: string[]) => string): string | null {
  try {
    const details = command('/usr/bin/codesign', ['-dv', '--verbose=4', bundle]);
    return details.match(/TeamIdentifier=([A-Z0-9]+)/)?.[1] ?? null;
  } catch { return null; }
}

function validateBundle(bundle: string, version: string | null, arch: string | null,
  command: (program: string, args: string[]) => string): void {
  if (!fs.statSync(bundle, { throwIfNoEntry: false })?.isDirectory() ||
    fs.lstatSync(bundle).isSymbolicLink() ||
    bundleValue(bundle, 'CFBundleIdentifier', command) !== APP_ID ||
    bundleValue(bundle, 'CFBundleExecutable', command) !== 'Token') throw new Error('更新包应用身份不符');
  if (version && bundleValue(bundle, 'CFBundleShortVersionString', command) !== version) {
    throw new Error('更新包版本与清单不符');
  }
  const macArch = arch === 'x64' ? 'x86_64' : arch;
  if (macArch && !command('/usr/bin/lipo', ['-archs', path.join(bundle, 'Contents', 'MacOS', 'Token')]).trim().split(/\s+/).includes(macArch)) {
    throw new Error('更新包架构不符');
  }
}

function verifyPackage(request: InstallRequest): void {
  if (!fs.statSync(request.packageFile, { throwIfNoEntry: false })?.isFile() ||
    fs.lstatSync(request.packageFile).isSymbolicLink() ||
    fs.statSync(request.packageFile).size !== request.packageSize) throw new Error('更新包大小不符');
  const hash = createHash('sha256');
  const file = fs.openSync(request.packageFile, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const count = fs.readSync(file, chunk, 0, chunk.length, null);
      if (!count) break;
      hash.update(chunk.subarray(0, count));
    }
  } finally { fs.closeSync(file); }
  if (hash.digest('hex') !== request.packageSha256) throw new Error('更新包摘要不符');
}

function statusFile(userData: string): string { return path.join(userData, 'updates', 'last-install.json'); }
function readyFile(userData: string, id: string): string { return path.join(userData, 'updates', `ready-${id}.json`); }

function sameBundlePath(candidate: string, target: string): boolean {
  return path.isAbsolute(candidate) && !fs.lstatSync(candidate).isSymbolicLink() &&
    fs.realpathSync(candidate) === fs.realpathSync(target);
}

function writeStatus(request: InstallRequest, status: 'success' | 'rollback', message: string): void {
  const file = statusFile(request.userData);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ status, version: request.version, message }) + '\n', { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

export function readInstallStatus(userData: string): { status: 'success' | 'rollback'; version: string; message: string } | null {
  try {
    const file = statusFile(userData);
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (!['success', 'rollback'].includes(String(value.status)) ||
      typeof value.version !== 'string' || typeof value.message !== 'string') return null;
    fs.unlinkSync(file);
    return value as { status: 'success' | 'rollback'; version: string; message: string };
  } catch { return null; }
}

export function markUpdatedAppReady(userData: string, id: string, version: string, bundle: string): void {
  if (!/^[a-f0-9-]{36}$/.test(id)) return;
  const file = readyFile(userData, id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ id, version, bundle: path.resolve(bundle), pid: process.pid }) + '\n', { mode: 0o600 });
}

export async function runAutomaticInstall(request: InstallRequest, hooks: InstallHooks = {}): Promise<void> {
  const command = hooks.run ?? run;
  const start = hooks.launch ?? launch;
  const move = hooks.move ?? fs.renameSync;
  const isAlive = hooks.alive ?? alive;
  const sleep = hooks.sleep ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  const parent = path.dirname(request.targetBundle);
  const privateDirectory = path.join(parent, `.Token-update-${request.id}`);
  const stage = path.join(privateDirectory, 'staged.app');
  const backup = path.join(privateDirectory, 'previous.app');
  let mount = '';
  let attached = false;
  let oldMoved = false;
  let newPlaced = false;
  let succeeded = false;
  try {
    validateRequest(request);
    fs.mkdirSync(privateDirectory, { mode: 0o700 });
    mount = fs.mkdtempSync(path.join(os.tmpdir(), 'token-update-mount-'));
    for (let attempt = 0; request.oldPid && isAlive(request.oldPid); attempt++) {
      if (attempt >= 300) throw new Error('旧版应用未能退出');
      await sleep(200);
    }
    verifyPackage(request);
    command('/usr/bin/hdiutil', ['verify', request.packageFile]);
    command('/usr/bin/hdiutil', ['attach', request.packageFile, '-readonly', '-nobrowse', '-mountpoint', mount]);
    attached = true;
    const source = path.join(mount, APP_NAME);
    validateBundle(source, request.version, request.arch, command);
    if (fs.existsSync(request.targetBundle)) validateBundle(request.targetBundle, null, null, command);
    command('/usr/bin/ditto', [source, stage]);
    validateBundle(stage, request.version, request.arch, command);
    const oldTeam = bundleTeam(request.currentBundle, command);
    if (oldTeam) {
      command('/usr/bin/codesign', ['--verify', '--deep', '--strict', stage]);
      if (bundleTeam(stage, command) !== oldTeam) throw new Error('更新包签名团队不符');
    }
    command('/usr/bin/hdiutil', ['detach', mount]);
    attached = false;
    if (fs.existsSync(request.targetBundle)) {
      move(request.targetBundle, backup);
      oldMoved = true;
    }
    move(stage, request.targetBundle);
    newPlaced = true;
    start(request.targetBundle, request.userData, request.id);
    const marker = readyFile(request.userData, request.id);
    const timeout = hooks.readyTimeoutMs ?? 120_000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const ready = JSON.parse(fs.readFileSync(marker, 'utf8')) as Record<string, unknown>;
        if (ready.id === request.id && ready.version === request.version &&
          typeof ready.bundle === 'string' && sameBundlePath(ready.bundle, request.targetBundle) &&
          typeof ready.pid === 'number' && ready.pid > 0 && isAlive(ready.pid)) {
          succeeded = true;
          break;
        }
      } catch { /* new app is still starting */ }
      await sleep(200);
    }
    if (!succeeded) throw new Error('新版应用未能启动');
    try { writeStatus(request, 'success', `已更新到 ${request.version}`); }
    catch { /* the installed app is already running; a failed notice must not roll it back */ }
  } catch (error) {
    let restored = !oldMoved;
    if (newPlaced) {
      const failed = path.join(privateDirectory, `failed-${randomUUID()}.app`);
      try {
        move(request.targetBundle, failed);
        try { fs.rmSync(failed, { recursive: true, force: true }); } catch { /* still in use */ }
      } catch { /* preserve the failed candidate for inspection */ }
    }
    if (oldMoved) {
      try {
        if (!fs.existsSync(request.targetBundle)) move(backup, request.targetBundle);
        restored = !fs.existsSync(backup);
      } catch { restored = false; }
    }
    const reason = error instanceof Error ? error.message : '未知错误';
    const safeReason = reason.replaceAll(request.userData, '<数据目录>')
      .replaceAll(request.currentBundle, '<原应用>').replaceAll(request.targetBundle, '<目标应用>').slice(0, 180);
    try { writeStatus(request, 'rollback', `${restored ? '更新失败，旧版已保留或恢复' : '更新失败，旧版备份仍保留'}：${safeReason}`); }
    catch { /* a full disk must not prevent relaunch */ }
    try { start(restored && oldMoved ? request.targetBundle : oldMoved ? backup : request.currentBundle, request.userData, null); }
    catch { /* status remains available on next manual launch */ }
    throw error;
  } finally {
    if (attached) {
      try { command('/usr/bin/hdiutil', ['detach', mount]); }
      catch { /* leave mounted image for manual inspection */ }
    }
    if (mount) try { fs.rmdirSync(mount); } catch { /* mounted or nonempty */ }
    if (succeeded && oldMoved) {
      try { fs.rmSync(backup, { recursive: true, force: true }); } catch { /* executable may still be mapped */ }
    }
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* cleanup later */ }
    try { if (!fs.existsSync(backup)) fs.rmSync(privateDirectory, { recursive: true, force: true }); }
    catch { /* preserve a recoverable backup */ }
    try { fs.unlinkSync(readyFile(request.userData, request.id)); } catch { /* no marker */ }
    try { fs.unlinkSync(request.packageFile); } catch { /* retain for diagnosis */ }
  }
}
