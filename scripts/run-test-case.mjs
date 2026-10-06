import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cases from './test-cases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const chosen = cases.find(item => item.id === args[0]);
if (args[0] === '--list') {
  for (const item of cases) console.log(`${item.id}\t${item.kind}\t${item.title}`);
  process.exit(0);
}
if (args[0] === '--check') {
  const ids = new Set();
  const linkedTests = new Set();
  let previousNumber = 0;
  for (const item of cases) {
    const number = Number(item.id.slice(3));
    if (!/^TC-\d{3}$/.test(item.id) || number <= previousNumber || ids.has(item.id)) throw new Error(`测试编号无效、重复或未排序: ${item.id}`);
    previousNumber = number;
    ids.add(item.id);
    if (item.kind === 'manual') {
      if (!item.steps) throw new Error(`${item.id} 缺少操作步骤`);
    } else {
      if (!item.runs?.length) throw new Error(`${item.id} 缺少自动测试`);
      for (const run of item.runs) {
        const source = readFileSync(path.join(root, run.file), 'utf8');
        if (run.kind === 'integration') {
          if (!source.includes(item.id)) throw new Error(`${item.id} 找不到集成脚本: ${run.file}`);
        } else {
          if (!source.includes(`test('${run.testName}'`)) throw new Error(`${item.id} 找不到对应测试: ${run.file}`);
          linkedTests.add(`${run.file}\0${run.testName}`);
        }
      }
    }
  }
  for (const directory of ['tests', 'tests/e2e']) {
    for (const file of readdirSync(path.join(root, directory)).filter(name => /\.(test|spec)\.ts$/.test(name))) {
      const relative = `${directory}/${file}`;
      const source = readFileSync(path.join(root, relative), 'utf8');
      for (const match of source.matchAll(/\btest\('([^']+)'/g)) {
        if (!linkedTests.has(`${relative}\0${match[1]}`)) throw new Error(`自动测试没有 TC 入口: ${relative} ${match[1]}`);
      }
    }
  }
  const pending = Array.from({ length: previousNumber }, (_, index) => `TC-${String(index + 1).padStart(3, '0')}`)
    .filter(id => !ids.has(id));
  console.log(`已核对 ${cases.length} 个已注册 TC 编号及其可执行入口。`);
  if (pending.length) console.log(`尚未注册的计划编号：${pending.join('、')}；验收状态以追溯工作簿为准。`);
  process.exit(0);
}
if (!chosen) {
  console.error('用法: npm run test:case -- TC-001 | --list | --check');
  process.exit(2);
}
if (chosen.kind === 'manual') {
  console.log(`${chosen.id} ${chosen.title}\n操作: ${chosen.steps}`);
  const status = args[1];
  const evidence = args[2];
  if (!status) {
    console.log('人工执行后记录结果: npm run test:case -- ' + chosen.id + ' pass|fail /绝对路径/脱敏证据文件');
    process.exit(2);
  }
  if (!['pass', 'fail'].includes(status) || !evidence || !path.isAbsolute(evidence) || !existsSync(evidence)) {
    console.error('需要 pass 或 fail，以及已经存在的绝对路径证据文件。');
    process.exit(2);
  }
  if (chosen.id === 'TC-029' && status === 'pass') {
    console.error('TC-029 是当前已知缺陷；修复并改为自动测试后才能标记通过。');
    process.exit(2);
  }
  const resultDir = path.join(root, 'test-results', 'manual');
  mkdirSync(resultDir, { recursive: true });
  const resultPath = path.join(resultDir, `${chosen.id}.json`);
  writeFileSync(resultPath, JSON.stringify({ id: chosen.id, status, evidence, timestamp: new Date().toISOString() }, null, 2) + '\n');
  console.log(`已记录: ${resultPath}`);
  process.exit(status === 'pass' ? 0 : 1);
}
const run = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
if (chosen.runs.some(item => item.kind === 'e2e') && !process.env.TOKEN_E2E_EXECUTABLE) run('npm', ['run', 'build']);
for (const item of chosen.runs) {
  if (item.kind === 'integration') { run(process.execPath, [path.join(root, item.file), ...(item.args || [])]); continue; }
  run(path.join(root, 'node_modules', '.bin', item.kind === 'e2e' ? 'playwright' : 'vitest'),
    item.kind === 'e2e'
      ? ['test', item.file, '--grep', item.testName]
      : ['run', item.file, '-t', item.testName]);
}
