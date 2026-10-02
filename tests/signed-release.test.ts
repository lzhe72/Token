import { expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The release script is plain ESM so that Node can run it before the TypeScript build.
// @ts-ignore no declaration file is needed for this script-only module
import { certificateNameFromP12, signedBuilderArgs, signedVerificationSteps, validateSignedRelease } from '../scripts/package-signed-dmg.mjs';

const api = { APPLE_API_KEY: '/tmp/test-key.p8', APPLE_API_KEY_ID: 'TESTKEY', APPLE_API_ISSUER: 'test-issuer' };
const developer = 'Developer ID Application: Example (TESTTEAM01)';

test('TC-075 签名发布预检与命令构造', () => {
  const valid = validateSignedRelease({ platform: 'darwin', env: api, identities: [developer] });
  expect(valid).toEqual({ identity: developer, notarizationMethod: 'APPLE_API_KEY' });
  expect(() => validateSignedRelease({ platform: 'linux', env: api, identities: [developer] })).toThrow('macOS');
  expect(() => validateSignedRelease({ platform: 'darwin', env: {}, identities: [developer] })).toThrow('公证凭据');
  expect(() => validateSignedRelease({ platform: 'darwin', env: { APPLE_ID: 'user@example.test' }, identities: [developer] })).toThrow('不完整');
  expect(validateSignedRelease({ platform: 'darwin', env: { APPLE_KEYCHAIN: '/tmp/test.keychain', APPLE_KEYCHAIN_PROFILE: 'test-profile' },
    identities: [developer] }).notarizationMethod).toBe('APPLE_KEYCHAIN');
  expect(() => validateSignedRelease({ platform: 'darwin', env: { APPLE_KEYCHAIN: '/tmp/test.keychain' },
    identities: [developer] })).toThrow('不完整');
  expect(() => validateSignedRelease({ platform: 'darwin', env: { ...api, APPLE_ID: 'user@example.test' }, identities: [developer] })).toThrow('只能配置一组');
  expect(() => validateSignedRelease({ platform: 'darwin', env: api, identities: ['Apple Distribution: Example'] })).toThrow('Developer ID');
  expect(() => validateSignedRelease({ platform: 'darwin', env: api, identities: [developer, 'Developer ID Application: Other (TEAM00002)'] })).toThrow('CSC_NAME');
  expect(validateSignedRelease({ platform: 'darwin', env: { ...api, CSC_NAME: developer }, identities: [developer] }).identity).toBe(developer);
  expect(() => validateSignedRelease({ platform: 'darwin', env: { ...api, CSC_LINK: 'synthetic-p12', CSC_KEY_PASSWORD: 'secret' },
    certificateName: 'Apple Distribution: Example' })).toThrow('Developer ID');
  expect(validateSignedRelease({ platform: 'darwin', env: { ...api, CSC_LINK: 'synthetic-p12', CSC_KEY_PASSWORD: 'secret' },
    certificateName: developer }).identity).toBe(developer);
  expect(() => validateSignedRelease({ platform: 'darwin', env: { ...api, CSC_LINK: 'synthetic-p12' },
    certificateName: developer })).toThrow('CSC_KEY_PASSWORD');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'token-tc075-p12-'));
  try {
    const key = path.join(directory, 'test.key');
    const cert = path.join(directory, 'test.crt');
    const p12 = path.join(directory, 'test.p12');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
      '-out', cert, '-subj', '/CN=Developer ID Application: Synthetic (TESTTEAM01)', '-days', '1'], { stdio: 'ignore' });
    execFileSync('openssl', ['pkcs12', '-export', '-inkey', key, '-in', cert, '-out', p12,
      '-passout', 'pass:synthetic-password'], { stdio: 'ignore' });
    expect(certificateNameFromP12({ CSC_LINK: p12, CSC_KEY_PASSWORD: 'synthetic-password' }))
      .toBe('Developer ID Application: Synthetic (TESTTEAM01)');
    expect(certificateNameFromP12({ CSC_LINK: fs.readFileSync(p12).toString('base64'),
      CSC_KEY_PASSWORD: 'synthetic-password' })).toBe('Developer ID Application: Synthetic (TESTTEAM01)');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }

  const args = signedBuilderArgs('/tmp/token-signed-test', '0.3.4', 'x64', '/tmp/electron.zip');
  expect(args).toContain('--config.mac.forceCodeSigning=true');
  expect(args).toContain('--config.mac.notarize=true');
  expect(args).toContain('--config.mac.hardenedRuntime=true');
  expect(args).toContain('--config.directories.output=/tmp/token-signed-test');
  expect(args).toContain('--config.artifactName=Token-0.3.4-x64-signed.${ext}');
  expect(args).toContain('--config.electronDist=/tmp/electron.zip');
  expect(args).toContain('--config.mac.entitlements=build/entitlements.mac.plist');
  expect(signedVerificationSteps('/tmp/Token.app', '/tmp/Token.dmg').map(([command]: [string]) => command))
    .toEqual(['codesign', 'spctl', 'xcrun', 'hdiutil']);

  const release = path.join(process.cwd(), 'release');
  const before = fs.existsSync(release) ? fs.readdirSync(release) : [];
  const env = { ...process.env };
  for (const key of [...Object.keys(api), 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID',
    'APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME']) delete env[key];
  const result = spawnSync(process.execPath, ['scripts/package-signed-dmg.mjs'], { cwd: process.cwd(), env,
    encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('需要且只能配置一组公证凭据');
  expect(result.stderr).not.toContain('secret');
  expect(fs.existsSync(release) ? fs.readdirSync(release) : []).toEqual(before);
  expect(execFileSync(process.execPath, ['--check', 'scripts/package-signed-dmg.mjs'], { cwd: process.cwd() })).toHaveLength(0);
});
