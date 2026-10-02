import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [file, version, arch, dataDirectory] = process.argv.slice(2);
if (!file || !/^\d+\.\d+\.\d+$/.test(version || '') || !['arm64', 'x64'].includes(arch) || !dataDirectory) {
  console.error('用法: npm run publish:update -- /绝对路径/Token.dmg 1.2.3 arm64 /服务数据目录');
  process.exit(2);
}
const source = path.resolve(file);
const releases = path.join(path.resolve(dataDirectory), 'releases');
const filename = `Token-${version}-${arch}.dmg`;
mkdirSync(releases, { recursive: true, mode: 0o700 });
const destination = path.join(releases, filename);
copyFileSync(source, `${destination}.tmp`);
renameSync(`${destination}.tmp`, destination);
const manifest = {
  version,
  arch,
  size: statSync(destination).size,
  sha256: createHash('sha256').update(readFileSync(destination)).digest('hex'),
  filename,
  downloadPath: '/v1/update/package',
  publishedAt: new Date().toISOString()
};
const manifestFile = path.join(releases, 'latest.json');
writeFileSync(`${manifestFile}.tmp`, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
renameSync(`${manifestFile}.tmp`, manifestFile);
console.log(`已发布 ${filename} (${manifest.sha256})`);
