import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const archive = `electron-v${electronVersion}-darwin-${process.arch}.zip`;
const cache = path.join(os.homedir(), 'Library', 'Caches', 'electron');
let electronDist = null;
if (fs.existsSync(cache)) {
  for (const entry of fs.readdirSync(cache)) {
    const candidate = path.join(cache, entry, archive);
    if (fs.existsSync(candidate)) { electronDist = candidate; break; }
  }
}
const args = ['--mac', 'dmg'];
if (electronDist) args.push(`--config.electronDist=${electronDist}`);
const builder = path.join(root, 'node_modules', '.bin', 'electron-builder');
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false' };
const result = spawnSync(builder, args, { cwd: root, stdio: 'inherit', env });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const copied = spawnSync(process.execPath, [path.join(root, 'scripts', 'copy-dmg.mjs')], { cwd: root, stdio: 'inherit' });
if (copied.error) throw copied.error;
if (copied.status !== 0) process.exit(copied.status || 1);
