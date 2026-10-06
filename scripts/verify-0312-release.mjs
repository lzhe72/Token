import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TC-107: validate the actual update channel, then exercise old/new DMGs only
// inside isolated test userData and a writable temporary installation directory.
if (process.platform !== 'darwin') throw new Error('TC-107 需要 macOS');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oldDmg = process.env.TOKEN_TC107_OLD_DMG;
const newDmg = process.env.TOKEN_TC107_NEW_DMG;
const oldHash = process.env.TOKEN_TC107_OLD_SHA256;
const newHash = process.env.TOKEN_TC107_NEW_SHA256;
const serverDir = process.env.TOKEN_TC107_SERVER_DIR;
if (!oldDmg || !newDmg || !oldHash || !newHash || !serverDir ||
  ![oldDmg, newDmg, serverDir].every(path.isAbsolute) ||
  ![oldHash, newHash].every(value => /^[a-f0-9]{64}$/.test(value))) {
  throw new Error('TC-107 需设置真实旧/新 DMG 绝对路径及 SHA-256、实际服务数据目录');
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.version, '0.3.12');
assert.equal(process.arch, 'x64', '本轮只发布已验证的 x64 架构');
for (const [file, digest] of [[oldDmg, oldHash], [newDmg, newHash]]) {
  assert.equal(fs.statSync(file).isFile(), true);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
  assert.equal(hash(file), digest, '安装包 SHA-256 与冻结值不符');
  execFileSync('/usr/bin/hdiutil', ['verify', file], { stdio: 'ignore', timeout: 240_000 });
}
const product = '/Applications/Token.app';
const installedVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString',
  path.join(product, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
const userData = path.join(os.homedir(), 'Library', 'Application Support', 'token-monitor');
const configFile = path.join(userData, 'server-connection.json');
if (fs.existsSync(configFile)) {
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(config.serviceType, 'built_in', '当前 App 不是内置服务，不能发布到默认目录');
}
assert.equal(path.resolve(serverDir), path.join(userData, 'server'), '发布目录不是当前 App 的内置服务');
const manifest = JSON.parse(fs.readFileSync(path.join(serverDir, 'releases', 'latest.json'), 'utf8'));
assert.deepEqual({ version: manifest.version, arch: manifest.arch, sha256: manifest.sha256,
  size: manifest.size, filename: manifest.filename }, {
  version: '0.3.12', arch: 'x64', sha256: newHash, size: fs.statSync(newDmg).size,
  filename: 'Token-0.3.12-x64.dmg'
});
assert.equal(hash(path.join(serverDir, 'releases', manifest.filename)), newHash,
  '服务端已复制安装包的摘要不符');
const portInfo = JSON.parse(fs.readFileSync(path.join(serverDir, 'server-port.json'), 'utf8'));
assert.ok(Number.isSafeInteger(portInfo.port) && portInfo.port > 0 && portInfo.port < 65536);
const secret = fs.readFileSync(path.join(serverDir, 'server.secret'), 'utf8').trim();
const response = await fetch(`http://127.0.0.1:${portInfo.port}/v1/update/latest`,
  { headers: { authorization: `Bearer ${secret}` } });
assert.equal(response.status, 200, '当前 App 所连更新接口没有返回可用清单');
const online = await response.json();
assert.deepEqual({ version: online.version, arch: online.arch, sha256: online.sha256,
  size: online.size, filename: online.filename }, {
  version: manifest.version, arch: manifest.arch, sha256: manifest.sha256,
  size: manifest.size, filename: manifest.filename
});
const packageResponse = await fetch(`http://127.0.0.1:${portInfo.port}/v1/update/package`,
  { headers: { authorization: `Bearer ${secret}` } });
assert.equal(packageResponse.status, 200, '更新包在线下载接口不可用');
assert.ok(packageResponse.body, '更新包在线下载接口没有内容');
const downloaded = createHash('sha256');
let bytes = 0;
for await (const chunk of packageResponse.body) { downloaded.update(chunk); bytes += chunk.length; }
assert.equal(bytes, manifest.size, '在线包大小不符');
assert.equal(downloaded.digest('hex'), newHash, '在线包摘要不符');
console.log(`TC-107 当前内置服务在线清单与 x64 0.3.12 包校验通过，SHA-256 ${newHash}；生产 App 当前 ${installedVersion}，本脚本未修改。`);

const environment = { ...process.env, TOKEN_TC076_SKIP_BUILD: '1',
  TOKEN_TC076_OLD_DMG: oldDmg, TOKEN_TC076_OLD_SHA256: oldHash,
  TOKEN_TC076_NEW_DMG: newDmg, TOKEN_TC076_NEW_SHA256: newHash };
for (const script of ['verify-auto-upgrade.mjs', 'verify-packaged-helper-faults.mjs']) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script)],
    { cwd: root, env: environment, stdio: 'inherit', timeout: 1_200_000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${script} 隔离升级或故障回退失败`);
}
console.log('TC-107 自动子范围通过；生产 /Applications/Token.app 等待用户自行点击更新。');
