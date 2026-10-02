import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `${packageJson.build.productName}-${packageJson.version}.dmg`;
const source = path.join(root, packageJson.build.directories.output, name);
const destination = path.join(root, name);
fs.copyFileSync(source, destination);
console.log(`DMG ready: ${destination}`);
