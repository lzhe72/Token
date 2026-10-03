'use strict';

// Loaded through NODE_OPTIONS only for TC-076's isolated packaged helper process.
// The application UI may inherit NODE_OPTIONS; it must remain untouched there.
const fault = process.env.TOKEN_TC076_HELPER_FAULT;
if (fault && process.env.ELECTRON_RUN_AS_NODE === '1' &&
    String(process.argv[1] || '').endsWith('/update-helper.cjs')) {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const childProcess = require('node:child_process');
  const { EventEmitter } = require('node:events');
  const allowed = new Set(['mount', 'space', 'replace', 'launch', 'health']);
  if (!allowed.has(fault)) throw new Error('TC-076 未知故障注入');
  const workspace = fs.realpathSync(process.env.TOKEN_TC076_HELPER_WORKSPACE || '');
  const temporary = fs.realpathSync(os.tmpdir());
  if (!workspace.startsWith(`${temporary}${path.sep}token-test-db-tc076-helper-`)) {
    throw new Error('TC-076 故障注入只允许专用临时工作区');
  }
  const inside = value => fs.realpathSync(value).startsWith(`${workspace}${path.sep}`);
  const requestFile = process.argv[2];
  if (!requestFile || !inside(requestFile)) throw new Error('TC-076 更新请求未隔离');
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  if (!inside(request.currentBundle) || !inside(path.dirname(request.targetBundle)) ||
      !inside(request.userData) || !inside(request.packageFile) ||
      !request.targetBundle.endsWith('/installed/Token.app') ||
      !request.userData.endsWith('/user-data')) {
    throw new Error('TC-076 更新路径越过隔离边界');
  }
  fs.writeFileSync(path.join(workspace, `preload-${fault}-${request.id}.json`),
    JSON.stringify({ fault, helper: true }) + '\n', { mode: 0o600 });
  const hit = stage => fs.writeFileSync(path.join(workspace, `fault-${fault}-${request.id}.json`),
    JSON.stringify({ fault, stage }) + '\n', { mode: 0o600 });
  if (fault === 'mount' || fault === 'space') {
    const original = childProcess.spawnSync;
    childProcess.spawnSync = function (program, args, options) {
      if (fault === 'mount' && program === '/usr/bin/hdiutil' && args[0] === 'attach') {
        hit('attach');
        return { status: 1, error: null, stdout: '', stderr: 'TC-076 isolated mount failure' };
      }
      if (fault === 'space' && program === '/usr/bin/ditto') {
        hit('ditto');
        return { status: 1, error: Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }), stdout: '', stderr: '' };
      }
      return original.call(this, program, args, options);
    };
  }
  if (fault === 'replace') {
    const original = fs.renameSync;
    fs.renameSync = function (source, target) {
      if (source === path.join(path.dirname(request.targetBundle), `.Token-update-${request.id}`, 'staged.app') &&
          target === request.targetBundle) {
        hit('replace');
        throw new Error('TC-076 isolated replace failure');
      }
      return original.call(this, source, target);
    };
  }
  if (fault === 'launch' || fault === 'health') {
    const original = childProcess.spawn;
    childProcess.spawn = function (program, args, options) {
      if (program === path.join(request.targetBundle, 'Contents', 'MacOS', 'Token') &&
          args.some(arg => arg === `--token-upgrade-id=${request.id}`)) {
        hit(fault === 'launch' ? 'launch' : 'health');
        if (fault === 'launch') throw new Error('TC-076 isolated launch failure');
        const fake = new EventEmitter();
        fake.unref = () => fake;
        let clock = Date.now();
        Date.now = () => { clock += 30_000; return clock; };
        return fake;
      }
      return original.call(this, program, args, options);
    };
  }
}
