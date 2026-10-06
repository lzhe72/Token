import { expect, test, type Page } from '@playwright/test';
import { createViewer, launchM6, loginViewer } from './m6-support';

async function navigate(page: Page, label: string, heading: string): Promise<number> {
  return page.evaluate(async ({ label, heading }) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('.sidebar button.nav')]
      .find(item => item.textContent?.includes(label));
    if (!button) throw new Error(`找不到导航：${label}`);
    const start = performance.now();
    button.click();
    return new Promise<number>((resolve, reject) => {
      const tick = () => {
        if (button.classList.contains('active') && document.querySelector('.main-content h1')?.textContent === heading) {
          resolve(performance.now() - start);
        } else if (performance.now() - start > 3000) reject(new Error(`页面未切换：${heading}`));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { label, heading });
}

test('TC-102 标准与窄窗口导航先反馈并显示加载或内容', async () => {
  const context = await launchM6('tc102-navigation', { usage: true });
  try {
    const { app, page } = context;
    for (const width of [1180, 700]) {
      await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setSize(value, 800), width);
      for (const [label, heading] of [
        ['用量报表', '用量报表'], ['概览', '用量概览'], ['数据来源', '数据来源'],
        ['概览', '用量概览'], ['管理中心', '管理中心'], ['概览', '用量概览']
      ]) {
        expect(await navigate(page, label, heading), `${width}px ${heading} 首屏反馈`).toBeLessThan(150);
        if (heading === '数据来源') {
          await expect(page.locator('.source-card').first()).toBeVisible();
        } else if (heading === '管理中心') {
          await expect(page.getByRole('heading', { name: '账号与采集状态' })).toBeVisible();
        }
      }
    }
    await app.evaluate(() => { process.env.TOKEN_E2E_NAV_DELAY_MS = '400'; });
    expect(await navigate(page, '数据来源', '数据来源')).toBeLessThan(150);
    await expect(page.getByRole('status', { name: '正在加载数据来源…' })).toBeVisible();
    await expect(page.locator('.source-card').first()).toBeVisible();
    await navigate(page, '概览', '用量概览');
    expect(await navigate(page, '管理中心', '管理中心')).toBeLessThan(150);
    await expect(page.getByRole('status', { name: '正在加载管理中心…' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '账号与采集状态' })).toBeVisible();
    await app.evaluate(() => { delete process.env.TOKEN_E2E_NAV_DELAY_MS; });
  } finally { await context.close(); }
});

test('TC-103 窄窗口右栏滚动保持响应且左栏固定', async () => {
  const context = await launchM6('tc103-scroll', { usage: true });
  try {
    const { app, page } = context;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 700));
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await expect(page.locator('.metric-card').first()).toBeVisible();
    const metrics = await page.evaluate(async () => {
      const panel = document.querySelector<HTMLElement>('.main-content')!;
      const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
      if (panel.scrollHeight <= panel.clientHeight) throw new Error('测试页面不可滚动');
      const originalTop = sidebar.getBoundingClientRect().top;
      const intervals: number[] = [];
      const longTasks: number[] = [];
      const observer = new PerformanceObserver(list => {
        for (const item of list.getEntries()) longTasks.push(item.duration);
      });
      observer.observe({ entryTypes: ['longtask'] });
      await new Promise<void>(resolve => {
        const start = performance.now();
        let last = start;
        const frame = (now: number) => {
          intervals.push(now - last);
          last = now;
          panel.scrollTop += 12;
          if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2) panel.scrollTop = 0;
          if (now - start < 10_000) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      observer.disconnect();
      intervals.sort((a, b) => a - b);
      return { p95: intervals[Math.ceil(intervals.length * 0.95) - 1],
        frozen: longTasks.some(duration => duration >= 200),
        sidebarMovement: Math.abs(sidebar.getBoundingClientRect().top - originalTop) };
    });
    expect(metrics.p95).toBeLessThanOrEqual(32);
    expect(metrics.frozen).toBe(false);
    expect(metrics.sidebarMovement).toBeLessThan(1);
  } finally { await context.close(); }
});

test('TC-104 过期导航结果不覆盖新页面且普通用户不出现管理入口', async () => {
  const context = await launchM6('tc104-stale', { usage: true });
  try {
    const { page, app } = context;
    await createViewer(page);
    await app.evaluate(() => {
      process.env.TOKEN_E2E_NAV_DELAY_MS = '400';
      process.env.TOKEN_E2E_NAV_FAIL_ONCE = 'sources:identities';
    });
    await page.locator('.sidebar').getByRole('button', { name: /数据来源/ }).click();
    await expect(page.getByRole('status', { name: '正在加载数据来源…' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重试加载' })).toBeVisible();
    await page.getByRole('button', { name: '重试加载' }).click();
    await expect(page.locator('.source-card').first()).toBeVisible();
    await app.evaluate(() => { delete process.env.TOKEN_E2E_NAV_FAIL_ONCE; });
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('.sidebar button.nav')];
      buttons.find(item => item.textContent?.includes('管理中心'))!.click();
      buttons.find(item => item.textContent?.includes('概览'))!.click();
    });
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('.sidebar button.nav')];
      buttons.find(item => item.textContent?.includes('数据来源'))!.click();
      buttons.find(item => item.textContent?.includes('概览'))!.click();
    });
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await page.locator('.sidebar').getByRole('button', { name: /管理中心/ }).click();
    await expect(page.getByRole('status', { name: '正在加载管理中心…' })).toBeVisible();
    await loginViewer(page);
    await page.waitForTimeout(500);
    await expect(page.locator('.sidebar').getByRole('button', { name: /数据来源|管理中心/ })).toHaveCount(0);
    await page.getByRole('button', { name: /用量报表/ }).first().click();
    await expect(page.getByRole('group', { name: '当前报表筛选' })).not.toContainText('admin');
  } finally { await context.close(); }
});
