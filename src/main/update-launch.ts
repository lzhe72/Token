import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateManifest } from '../server/server';
import { bundleFromExecutable, chooseUpdateTarget, type InstallRequest } from './update-install';

export async function launchAutomaticUpdate(packageFile: string, manifest: UpdateManifest,
  executable: string, userData: string): Promise<void> {
  const currentBundle = bundleFromExecutable(executable);
  const targetBundle = chooseUpdateTarget(currentBundle);
  if (fs.existsSync(targetBundle) && fs.lstatSync(targetBundle).isSymbolicLink()) {
    throw new Error('目标应用不能是符号链接');
  }
  const helper = path.join(__dirname, 'update-helper.cjs');
  if (!fs.statSync(helper, { throwIfNoEntry: false })?.isFile()) throw new Error('更新辅助程序缺失');
  const directory = path.join(userData, 'updates');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const request: InstallRequest = {
    id: randomUUID(), oldPid: process.pid, packageFile, packageSize: manifest.size,
    packageSha256: manifest.sha256, version: manifest.version, arch: manifest.arch,
    currentBundle, targetBundle, userData
  };
  const requestFile = path.join(directory, `request-${request.id}.json`);
  fs.writeFileSync(requestFile, JSON.stringify(request), { mode: 0o600 });
  try {
    const child = spawn(executable, [helper, requestFile], {
      detached: true, stdio: 'ignore', cwd: userData,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
  } catch (error) {
    try { fs.unlinkSync(requestFile); } catch { /* helper may already have read it */ }
    throw new Error(`无法启动自动更新：${error instanceof Error ? error.message : '未知错误'}`);
  }
}
