import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TC-102/TC-103: repeatable, synthetic-only performance measurement.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.env.TOKEN_PERF_EXECUTABLE || path.join(project, 'release/mac/Token.app/Contents/MacOS/Token');
const scrollOnly = process.argv.includes('--scroll-only');
const warmOnly = process.argv.includes('--warm-only');
const coldOnly = process.argv.includes('--cold-only');
if (Number(warmOnly) + Number(coldOnly) + Number(scrollOnly) > 1) throw Error('性能测试模式不能组合');
const repetitions = Number(scrollOnly ? 1 : process.argv[2] || 20);
const coldRepetitions = Number(process.argv[3] || repetitions);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) throw Error('重复次数须为 1–100');
if (!Number.isInteger(coldRepetitions) || coldRepetitions < 1 || coldRepetitions > 100) throw Error('冷切换次数须为 1–100');
if (!process.env.TOKEN_PERF_SKIP_BUILD) {
  const built = spawnSync('npm', ['run', 'pack:dir'], { cwd: project, stdio: 'inherit', env: process.env });
  if (built.status !== 0) throw Error('性能测试专用打包失败');
}
if (!existsSync(packaged)) throw Error('缺少当前工作树的打包应用，请运行 npm run pack:dir');
const version = JSON.parse((await import('node:fs')).readFileSync(path.join(project, 'package.json'), 'utf8')).version;
const mode = scrollOnly ? 'scroll-' : warmOnly ? 'warm-' : coldOnly ? 'cold-' : '';
const outputFile = path.join(project, 'test-results', `performance-${mode}${version}.json`);
const require = createRequire(path.join(project, 'package.json'));
const { _electron: electron } = require('@playwright/test');
const root = mkdtempSync(path.join(os.tmpdir(), 'token-performance-'));
const codex = path.join(root, 'codex');
const claude = path.join(root, 'claude');
mkdirSync(codex);
mkdirSync(claude);
const environment = { ...process.env, TOKEN_TEST_TELEMETRY_PORT: '0',
  TOKEN_TEST_SINGLE_USER_DEFAULT: '0', TOKEN_CODEX_SESSIONS_DIR: codex,
  TOKEN_CLAUDE_PROJECTS_DIR: claude };
const metrics = [];
let app;
function record(metric) {
  metrics.push(metric);
  console.log(`[performance] ${metric.data} ${metric.width}px ${metric.cohort} ${metric.scenario}: ${metric.iterations ?? metric.frames} samples`);
}

async function launch() {
  app = await electron.launch({ executablePath: packaged, args: [`--token-user-data=${root}`], env: environment });
  return app.firstWindow();
}
function sql(statement) {
  const result = spawnSync('/usr/bin/sqlite3', [path.join(root, 'token.sqlite'), statement],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw Error('synthetic database setup failed');
}
function seed(ownerId) {
  if (!/^[a-f0-9-]{36}$/.test(ownerId)) throw Error('invalid test identity');
  sql(`BEGIN;
    INSERT INTO source_identities(key,provider,label,owner_user_id)
      VALUES ('codex:synthetic-perf','codex','Synthetic performance source','${ownerId}');
    WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<35000)
      INSERT INTO usage_facts(source_key,provider,source_identity_key,session_id,model,occurred_at,
        input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens,total_tokens)
      SELECT 'synthetic-perf:'||n,'codex','codex:synthetic-perf','session-'||(n/5),
        'model-'||(n%200),'2026-10-02T12:00:00Z',12,3,0,0,15 FROM seq;
    WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<35000)
      INSERT INTO fact_projects(source_key,project_key,project_label)
      SELECT 'synthetic-perf:'||n,printf('%024x',n%200),'Synthetic project '||(n%200) FROM seq;
    COMMIT;`);
}
function percentile(items, p) {
  const values = [...items].sort((a,b)=>a-b);
  return values[Math.max(0,Math.ceil(p*values.length)-1)] ?? null;
}
async function nav(page, label, heading) {
  const result = await page.evaluate(async ({ label, heading }) => {
    const button = [...document.querySelectorAll('button.nav')].find(item => item.textContent?.includes(label));
    if (!button) throw Error('navigation button missing');
    const start = performance.now();
    button.click();
    const observe = predicate => new Promise((resolve,reject) => {
      const deadline = performance.now() + 30000;
      const tick = () => {
        if (predicate()) resolve(performance.now()-start);
        else if (performance.now() > deadline) reject(Error('navigation timeout'));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const feedback = await observe(() => button.classList.contains('active') &&
      document.querySelector('.main-content h1')?.textContent === heading);
    const content = await observe(() => {
      if (heading === '用量报表') return !!document.querySelector('.report-page .metric-grid .metric-card') &&
        !document.querySelector('.report-page [role="status"]')?.textContent?.includes('正在计算报表');
      if (heading === '数据来源') return !!document.querySelector('.main-content table tbody');
      if (heading === '管理中心') return !!document.querySelector('.main-content table tbody');
      const total = document.querySelector('.overview-page .overview-primary strong')?.textContent;
      return !!total && total !== '加载中';
    });
    return { feedback, content };
  }, { label, heading });
  return result;
}
async function scroll(page) {
  await page.waitForFunction(() => {
    const detail = document.querySelector('.report-page .detail-panel .panel-head span');
    return detail?.textContent !== '加载中' && !!detail?.textContent;
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => new Promise(resolve => {
    const container = document.querySelector('.main-content');
    const intervals = [];
    const longTasks = [];
    let observer;
    try {
      observer = new PerformanceObserver(list => {
        for (const item of list.getEntries()) longTasks.push(item.duration);
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {}
    const start = performance.now();
    let previous = start;
    const tick = now => {
      intervals.push(now-previous);
      previous = now;
      container.scrollTop += 12;
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) container.scrollTop = 0;
      if (now-start < 10000) requestAnimationFrame(tick);
      else { observer?.disconnect(); resolve({ p95: percentileInPage(intervals,.95), max: Math.max(...intervals),
        longTasks200: longTasks.filter(v=>v>=200).length, frames: intervals.length,
        frameIntervalsMs: intervals, longTaskDurationsMs: longTasks }); }
    };
    function percentileInPage(values,p) {
      const ordered = [...values].sort((a,b)=>a-b);
      return ordered[Math.max(0,Math.ceil(p*ordered.length)-1)] || 0;
    }
    requestAnimationFrame(tick);
  }));
}
async function measure(page, data, width) {
  await app.evaluate(({ BrowserWindow }, targetWidth) => BrowserWindow.getAllWindows()[0].setSize(targetWidth, 800), width);
  await page.getByRole('heading', { name: '用量概览' }).waitFor();
  for (const [scenario,label,heading] of [['overview-to-report','用量报表','用量报表'],
    ['report-to-overview','概览','用量概览'],['overview-to-sources','数据来源','数据来源'],
    ['sources-to-overview','概览','用量概览'],['overview-to-users','管理中心','管理中心'],
    ['users-to-overview','概览','用量概览']]) {
    const samples = [];
    for (let i=0;i<repetitions;i++) {
      if (heading !== '用量概览') {
        const current = await page.locator('.main-content h1').textContent();
        if (current !== '用量概览') await nav(page,'概览','用量概览');
      } else {
        const previous = scenario.split('-to-')[0];
        const source = previous === 'sources'
          ? ['数据来源', '数据来源']
          : previous === 'users'
            ? ['管理中心', '管理中心']
            : ['用量报表', '用量报表'];
        await nav(page, source[0], source[1]);
      }
      samples.push(await nav(page,label,heading));
    }
    record({data,width,scenario,cohort:'warm',iterations:repetitions,samples,
      feedbackP50:percentile(samples.map(x=>x.feedback),.5),
      feedbackP95:percentile(samples.map(x=>x.feedback),.95),
      contentP50:percentile(samples.map(x=>x.content),.5),
      contentP95:percentile(samples.map(x=>x.content),.95)});
  }
  await nav(page,'用量报表','用量报表');
  record({data,width,scenario:'report-scroll-10s',cohort:'warm',...await scroll(page)});
  if (data === '35000-facts') {
    for (const [panel,rows] of [['.project-panel','.dimension-item'],['.model-panel','tbody tr']]) {
      const section = page.locator(panel);
      if (await section.locator(rows).count() !== 20) throw Error(`${panel} 首屏应只渲染 20 项`);
      await section.locator('button.text-button[aria-expanded="false"]').click();
      if (await section.locator(rows).count() !== 200) throw Error(`${panel} 展开后应可查看全部 200 项`);
      await section.locator('button.text-button[aria-expanded="true"]').click();
      if (await section.locator(rows).count() !== 20) throw Error(`${panel} 收起后应恢复 20 项`);
    }
  }
  await nav(page,'概览','用量概览');
}
async function measureLongScroll(page, width) {
  await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setSize(value,800), width);
  await nav(page,'用量报表','用量报表');
  record({data:'35000-facts',width,scenario:'report-scroll-10s',cohort:'long-report',...await scroll(page)});
  await nav(page,'概览','用量概览');
}
async function signIn(page) {
  const login = page.getByPlaceholder('用户名');
  await login.waitFor();
  await login.fill('admin');
  await page.getByPlaceholder('输入密码').fill('safe-password-123');
  await page.getByRole('button', {name:'登录',exact:true}).click();
  await page.getByRole('heading',{name:'用量概览'}).waitFor();
}
async function measureCold(data,width) {
  const groups = {
    'overview-to-sources': [], 'sources-to-overview': [],
    'overview-to-users': [], 'users-to-overview': [],
    'overview-to-report': [], 'report-to-overview': []
  };
  for (let iteration=0;iteration<coldRepetitions;iteration++) {
    console.log(`[performance] ${data} ${width}px cold launch ${iteration + 1}/${coldRepetitions}`);
    const page = await launch();
    await signIn(page);
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setSize(value,800), width);
    groups['overview-to-sources'].push(await nav(page,'数据来源','数据来源'));
    groups['sources-to-overview'].push(await nav(page,'概览','用量概览'));
    groups['overview-to-users'].push(await nav(page,'管理中心','管理中心'));
    groups['users-to-overview'].push(await nav(page,'概览','用量概览'));
    groups['overview-to-report'].push(await nav(page,'用量报表','用量报表'));
    groups['report-to-overview'].push(await nav(page,'概览','用量概览'));
    await app.close();
    app=undefined;
  }
  for (const [scenario,samples] of Object.entries(groups)) record({
    data,width,scenario,cohort:'cold',iterations:coldRepetitions,samples,
    feedbackP50:percentile(samples.map(x=>x.feedback),.5),
    feedbackP95:percentile(samples.map(x=>x.feedback),.95),
    contentP50:percentile(samples.map(x=>x.content),.5),
    contentP95:percentile(samples.map(x=>x.content),.95)
  });
}
try {
  let page = await launch();
  await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
  await page.getByRole('button', { name:'创建并进入' }).click();
  await page.getByRole('heading', { name:'首次使用引导' }).waitFor();
  await page.getByRole('button', { name:/^(跳过引导|完成引导)$/ }).click();
  await page.getByRole('heading', { name:'用量概览' }).waitFor();
  const owner = (await page.evaluate(() => window.tokenApi.getState())).user.id;
  if (!scrollOnly && !coldOnly) {
    for (const width of [1180,700]) await measure(page,'empty',width);
    await app.close();
    app = undefined;
    if (!warmOnly) for (const width of [1180,700]) await measureCold('empty',width);
  } else {
    await app.close();
    app = undefined;
    if (coldOnly) for (const width of [1180,700]) await measureCold('empty',width);
  }
  seed(owner);
  if (coldOnly) {
    for (const width of [1180,700]) await measureCold('35000-facts',width);
  } else {
    page = await launch();
    await signIn(page);
    if (scrollOnly) {
      for (const width of [1180,700]) await measureLongScroll(page,width);
    } else {
      for (const width of [1180,700]) await measure(page,'35000-facts',width);
      await app.close();
      app=undefined;
      if (!warmOnly) for (const width of [1180,700]) await measureCold('35000-facts',width);
    }
  }
  const result = {version,syntheticFacts:35000,metrics};
  mkdirSync(path.dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(metrics.map(item => ({data:item.data,width:item.width,cohort:item.cohort,
    scenario:item.scenario,feedbackP95:item.feedbackP95,contentP95:item.contentP95,
    frameP95:item.p95,longTasks200:item.longTasks200}))));
  const failures = metrics.filter(item => item.scenario === 'report-scroll-10s'
    ? item.p95 > 32 || item.max >= 200 || item.longTasks200 > 0
    : item.feedbackP95 > 150);
  if (failures.length) throw Error(`性能验收失败：${failures.map(item => `${item.data}/${item.width}/${item.scenario}`).join(', ')}`);
} finally {
  await app?.close().catch(()=>{});
  rmSync(root,{recursive:true,force:true});
}
