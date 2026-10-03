import { expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from './support/test-workspace';
import { chooseUpdateTarget, markUpdatedAppReady, readInstallStatus,
  runAutomaticInstall, type InstallHooks, type InstallRequest } from '../src/main/update-install';

function makeBundle(directory: string, version: string): string {
  const bundle = path.join(directory, 'Token.app');
  fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'Contents', 'Info.plist'), 'synthetic');
  fs.writeFileSync(path.join(bundle, 'Contents', 'MacOS', 'Token'), 'synthetic');
  fs.writeFileSync(path.join(bundle, 'version.txt'), version);
  return bundle;
}

test('TC-036 自动安装目标选择、退出后替换和失败回滚', async () => {
  const workspace = createTestWorkspace('tc036-install');
  try {
    const system = path.join(workspace.root, 'Applications');
    const home = path.join(workspace.root, 'home');
    const installed = makeBundle(path.join(workspace.root, 'installed'), '1.0.0');
    expect(chooseUpdateTarget(installed)).toBe(installed);
    expect(chooseUpdateTarget('/Volumes/Token/Token.app', {
      home, applications: system, writable: directory => directory === system
    })).toBe(path.join(system, 'Token.app'));
    expect(chooseUpdateTarget('/Volumes/Token/Token.app', {
      home, applications: system, writable: directory => directory === path.join(home, 'Applications'),
      makeDirectory: directory => fs.mkdirSync(directory, { recursive: true })
    })).toBe(path.join(home, 'Applications', 'Token.app'));
    expect(() => chooseUpdateTarget('/Applications/Token.app', {
      home, applications: system, writable: () => false
    })).toThrow('当前安装位置不可写');

    const source = makeBundle(path.join(workspace.root, 'release'), '1.1.0');
    const bytes = Buffer.from('synthetic-package');
    const packageFile = path.join(workspace.root, 'update.dmg');
    const request = (): InstallRequest => ({ id: randomUUID(), oldPid: 0, packageFile,
      packageSize: bytes.length, packageSha256: createHash('sha256').update(bytes).digest('hex'),
      version: '1.1.0', arch: 'x64', currentBundle: installed, targetBundle: installed,
      userData: workspace.root });
    const command: NonNullable<InstallHooks['run']> = (program, args) => {
      if (program.endsWith('hdiutil')) {
        if (args[0] === 'attach') fs.cpSync(source, path.join(args[args.length - 1], 'Token.app'), { recursive: true });
        if (args[0] === 'detach') fs.rmSync(path.join(args[1], 'Token.app'), { recursive: true, force: true });
        return '';
      }
      if (program.endsWith('ditto')) { fs.cpSync(args[0], args[1], { recursive: true }); return ''; }
      if (program.endsWith('PlistBuddy')) {
        const bundle = path.dirname(path.dirname(args[2]));
        if (args[1].endsWith('CFBundleIdentifier')) return 'dev.lzhe72.token';
        if (args[1].endsWith('CFBundleExecutable')) return 'Token';
        return fs.readFileSync(path.join(bundle, 'version.txt'), 'utf8');
      }
      if (program.endsWith('lipo')) return 'x86_64';
      if (program.endsWith('codesign')) return '';
      throw new Error(`unexpected command ${program}`);
    };
    fs.writeFileSync(packageFile, bytes);
    const success = request();
    await runAutomaticInstall(success, { run: command, alive: () => true,
      launch: (bundle, userData, id) => { if (id) markUpdatedAppReady(userData, id, '1.1.0', bundle); } });
    expect(fs.readFileSync(path.join(installed, 'version.txt'), 'utf8')).toBe('1.1.0');
    expect(readInstallStatus(workspace.root)?.status).toBe('success');
    expect(fs.existsSync(packageFile)).toBe(false);
    expect(fs.readdirSync(path.dirname(installed)).filter(name => name.startsWith('.Token-update-'))).toEqual([]);

    fs.writeFileSync(path.join(installed, 'version.txt'), '1.0.0');
    fs.writeFileSync(packageFile, bytes);
    const failure = request();
    let reopenedOld = false;
    await expect(runAutomaticInstall(failure, { run: command,
      launch: (_bundle, _userData, id) => {
        if (id) throw new Error('synthetic relaunch failure');
        reopenedOld = true;
      } })).rejects.toThrow('synthetic relaunch failure');
    expect(reopenedOld).toBe(true);
    expect(fs.readFileSync(path.join(installed, 'version.txt'), 'utf8')).toBe('1.0.0');
    expect(readInstallStatus(workspace.root)?.status).toBe('rollback');
    expect(fs.existsSync(packageFile)).toBe(false);

    fs.writeFileSync(packageFile, bytes);
    const replaceFailure = request();
    await expect(runAutomaticInstall(replaceFailure, { run: command,
      move: (from, to) => {
        if (from.endsWith('staged.app')) throw new Error('synthetic replace failure');
        fs.renameSync(from, to);
      },
      launch: () => {}
    })).rejects.toThrow('synthetic replace failure');
    expect(fs.readFileSync(path.join(installed, 'version.txt'), 'utf8')).toBe('1.0.0');
    expect(readInstallStatus(workspace.root)?.status).toBe('rollback');

    fs.writeFileSync(packageFile, bytes);
    await expect(runAutomaticInstall(request(), {
      run: (program, args) => {
        if (program.endsWith('hdiutil') && args[0] === 'attach') throw new Error('synthetic mount failure');
        return command(program, args);
      },
      launch: () => {}
    })).rejects.toThrow('synthetic mount failure');
    expect(fs.readFileSync(path.join(installed, 'version.txt'), 'utf8')).toBe('1.0.0');
    expect(readInstallStatus(workspace.root)?.status).toBe('rollback');

    fs.writeFileSync(packageFile, bytes);
    await expect(runAutomaticInstall(request(), {
      run: (program, args) => {
        if (program.endsWith('ditto')) throw new Error('synthetic copy failure');
        return command(program, args);
      },
      launch: () => {}
    })).rejects.toThrow('synthetic copy failure');
    expect(fs.readFileSync(path.join(installed, 'version.txt'), 'utf8')).toBe('1.0.0');
    expect(readInstallStatus(workspace.root)?.status).toBe('rollback');

    fs.writeFileSync(packageFile, bytes);
    await expect(runAutomaticInstall(request(), {
      run: command, launch: () => {}, readyTimeoutMs: 20
    })).rejects.toThrow('新版应用未能启动');
    expect(fs.readFileSync(path.join(installed, 'version.txt'), 'utf8')).toBe('1.0.0');
    expect(readInstallStatus(workspace.root)?.status).toBe('rollback');

    fs.writeFileSync(packageFile, Buffer.from('tampered-package'));
    await expect(runAutomaticInstall(request(), { run: command, launch: () => {} })).rejects.toThrow('更新包大小不符');
    expect(fs.readFileSync(path.join(installed, 'version.txt'), 'utf8')).toBe('1.0.0');
  } finally { workspace.cleanup(); }
});
