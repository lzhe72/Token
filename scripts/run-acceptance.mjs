import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const from = Number(process.argv[2] || 29);
const to = Number(process.argv[3] || 49);
if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to > 999) {
  console.error('用法: npm run test:acceptance -- [起始编号] [结束编号]');
  process.exit(2);
}

const directory = path.join('test-results', 'acceptance');
mkdirSync(directory, { recursive: true });
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const results = [];
for (let number = from; number <= to; number++) {
  const id = `TC-${String(number).padStart(3, '0')}`;
  const startedAt = new Date().toISOString();
  const run = spawnSync(process.execPath, ['scripts/run-test-case.mjs', id], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024
  });
  const exitCode = run.status ?? 1;
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, `${id}.log`), `${run.stdout || ''}${run.stderr || ''}`);
  results.push({ id, startedAt, exitCode, log: `${id}.log` });
  process.stdout.write(`${id} ${exitCode === 0 ? 'PASS' : 'FAIL'}\n`);
}
writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ revision, testedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`, node: process.version, os: os.release(), results }, null, 2) + '\n');
if (results.some(result => result.exitCode !== 0)) process.exitCode = 1;
