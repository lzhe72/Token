import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authGroups = [
  { keys: ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'], required: ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'] },
  { keys: ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'], required: ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'] },
  { keys: ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'], required: ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'] }
];

export function validateSignedRelease({ platform, env, identities = [], certificateName = null }) {
  if (platform !== 'darwin') throw new Error('签名发布需要 macOS 构建环境');
  const active = authGroups.filter(group => group.keys.some(key => Boolean(env[key])));
  if (active.length !== 1) throw new Error('需要且只能配置一组公证凭据');
  if (active[0].required.some(key => !env[key])) throw new Error(`公证凭据不完整：${active[0].required.filter(key => !env[key]).join(', ')}`);

  let identity;
  if (env.CSC_LINK) {
    if (!env.CSC_KEY_PASSWORD) throw new Error('CSC_LINK 需要 CSC_KEY_PASSWORD');
    if (!certificateName?.startsWith('Developer ID Application:')) {
      throw new Error('签名证书必须是 Developer ID Application');
    }
    if (env.CSC_NAME && env.CSC_NAME !== certificateName) throw new Error('CSC_NAME 与证书身份不一致');
    identity = certificateName;
  } else {
    const candidates = identities.filter(name => name.startsWith('Developer ID Application:'));
    if (env.CSC_NAME) {
      if (!env.CSC_NAME.startsWith('Developer ID Application:') || !candidates.includes(env.CSC_NAME)) {
        throw new Error('钥匙串中没有指定的 Developer ID Application 身份');
      }
      identity = env.CSC_NAME;
    } else if (candidates.length === 1) {
      identity = candidates[0];
    } else {
      throw new Error(candidates.length ? '存在多个 Developer ID 身份，请设置 CSC_NAME' : '没有可用的 Developer ID Application 身份');
    }
  }
  return { identity, notarizationMethod: active[0].required[0] };
}

export function signedBuilderArgs(outputDir, version, arch, electronDist = null) {
  const args = ['--mac', 'dmg', `--${arch}`, `--config.directories.output=${outputDir}`,
    '--config.mac.forceCodeSigning=true', '--config.mac.notarize=true', '--config.mac.hardenedRuntime=true',
    '--config.mac.entitlements=build/entitlements.mac.plist',
    `--config.artifactName=Token-${version}-${arch}-signed.` + '${ext}'];
  if (electronDist) args.push(`--config.electronDist=${electronDist}`);
  return args;
}

export function signedVerificationSteps(appPath, dmgPath) {
  return [
    ['codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]],
    ['spctl', ['--assess', '--type', 'execute', '--verbose', appPath]],
    ['xcrun', ['stapler', 'validate', appPath]],
    ['hdiutil', ['verify', dmgPath]]
  ];
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} 执行失败（退出码 ${result.status ?? '未知'}）`);
  return `${result.stdout || ''}${result.stderr || ''}`;
}

export function certificateNameFromP12(env) {
  const link = env.CSC_LINK;
  if (!env.CSC_KEY_PASSWORD) throw new Error('CSC_LINK 需要 CSC_KEY_PASSWORD');
  if (link.startsWith('https://') || link.startsWith('http://')) {
    throw new Error('签名预检要求 CSC_LINK 为本地 p12 路径或 base64 内容');
  }
  let bytes;
  if (link.startsWith('file://')) bytes = fs.readFileSync(fileURLToPath(link));
  else if (fs.existsSync(link)) bytes = fs.readFileSync(link);
  else if (/^[A-Za-z0-9+/=\s]+$/.test(link) && link.length < 2_000_000) bytes = Buffer.from(link, 'base64');
  else throw new Error('CSC_LINK 不是可读取的本地 p12 或 base64 内容');
  const result = spawnSync('openssl', ['pkcs12', '-in', '/dev/stdin', '-clcerts', '-nokeys',
    '-passin', 'env:CSC_KEY_PASSWORD'], { input: bytes, env, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0 || !result.stdout?.length) throw new Error('无法读取 p12 签名证书');
  const subject = spawnSync('openssl', ['x509', '-noout', '-subject', '-nameopt', 'RFC2253'],
    { input: result.stdout, encoding: 'utf8' });
  if (subject.status !== 0) throw new Error('无法核对 p12 证书身份');
  return /\bCN=([^,\n]+)/.exec(subject.stdout)?.[1] || null;
}

function keychainIdentities() {
  const output = run('security', ['find-identity', '-v', '-p', 'codesigning']);
  return [...output.matchAll(/"([^"]+)"/g)].map(match => match[1]);
}

function requireTools() {
  for (const tool of ['codesign', 'spctl', 'hdiutil', 'openssl', 'security']) {
    const result = spawnSync('which', [tool], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`缺少发布工具：${tool}`);
  }
  for (const tool of ['notarytool', 'stapler']) {
    const result = spawnSync('xcrun', ['--find', tool], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`缺少发布工具：${tool}`);
  }
}

function cachedElectronArchive(arch) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'electron');
  if (!fs.existsSync(cache)) return null;
  const filename = `electron-v${version}-darwin-${arch}.zip`;
  for (const entry of fs.readdirSync(cache)) {
    const candidate = path.join(cache, entry, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function main() {
  const env = process.env;
  if (process.platform !== 'darwin') throw new Error('签名发布需要 macOS 构建环境');
  const certificateName = env.CSC_LINK ? certificateNameFromP12(env) : null;
  const checked = validateSignedRelease({ platform: process.platform, env,
    identities: env.CSC_LINK ? [] : keychainIdentities(), certificateName });
  requireTools();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const arch = process.arch;
  if (!['x64', 'arm64'].includes(arch)) throw new Error('不支持的 macOS 架构');
  if (run('git', ['status', '--porcelain']).trim()) throw new Error('工作区存在未提交改动，不能冻结签名候选');
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  const temp = fs.mkdtempSync(path.join(root, 'release', 'token-signed-'));
  let published = false;
  try {
    run('npm', ['run', 'build']);
    const builder = path.join(root, 'node_modules', '.bin', 'electron-builder');
    run(builder, signedBuilderArgs(temp, pkg.version, arch, cachedElectronArchive(arch)),
      { ...env, CSC_IDENTITY_AUTO_DISCOVERY: 'true', CSC_NAME: checked.identity });
    const appPath = path.join(temp, arch === 'arm64' ? 'mac-arm64' : 'mac', 'Token.app');
    const dmgPath = path.join(temp, `Token-${pkg.version}-${arch}-signed.dmg`);
    if (!fs.existsSync(appPath) || !fs.existsSync(dmgPath)) throw new Error('签名构建未生成预期 App 和 DMG');
    for (const [command, args] of signedVerificationSteps(appPath, dmgPath)) run(command, args);
    const signature = run('codesign', ['-dv', '--verbose=2', appPath]);
    if (!signature.includes('Authority=Developer ID Application:')) throw new Error('App 不是 Developer ID Application 签名');
    const stat = fs.statSync(dmgPath);
    const sha256 = createHash('sha256').update(fs.readFileSync(dmgPath)).digest('hex');
    const commit = run('git', ['rev-parse', 'HEAD']).trim();
    const destination = path.join(root, 'release', 'signed', `${pkg.version}-${arch}-${commit.slice(0, 8)}-${randomUUID().slice(0, 8)}`);
    const evidence = { version: pkg.version, arch, commit, certificate: 'Developer ID Application (verified)',
      notarizationMethod: checked.notarizationMethod, app: path.relative(temp, appPath),
      dmg: path.relative(temp, dmgPath), dmgBytes: stat.size, sha256,
      checks: ['codesign', 'spctl', 'stapler', 'hdiutil'] };
    fs.writeFileSync(path.join(temp, 'release-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(temp, destination);
    published = true;
    console.log(`签名公证候选已核验：${destination}\nDMG SHA-256: ${sha256}`);
  } finally {
    if (!published) fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(`签名发布失败：${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
