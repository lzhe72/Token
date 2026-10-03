import { expect, test } from '@playwright/test';
import { createViewer, launchM6, writeUsage } from './m6-support';

test('TC-089 标准与窄窗口键盘路径和来源重绑弹窗背景隔离', async () => {
  const context = await launchM6('tc089-keyboard', { usage: true, usageDate: new Date().toISOString() });
  try {
    const { app, page, workspace } = context;
    await createViewer(page);
    for (const width of [1180, 760, 700]) {
      const actualWidth = await app.evaluate(({ BrowserWindow }, value) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setSize(value, 760);
        return window.getSize()[0];
      }, width);
      expect(actualWidth).toBe(width);
      const sourceNav = page.getByRole('button', { name: /数据来源/ });
      await sourceNav.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: '数据来源' })).toBeVisible();
      if (width === 1180) await page.getByRole('button', { name: '立即扫描' }).click();
      const row = page.getByRole('row', { name: /Codex · 本机账户/ });
      await row.getByRole('combobox').selectOption({ label: 'viewer' });
      const trigger = row.getByRole('button', { name: '预览变更' });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: '确认来源归属变更' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: '确认来源归属变更' })).toBeFocused();
      await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');
      expect(await page.locator('#root').evaluate(element => (element as HTMLElement).inert)).toBe(true);
      await expect(page.getByRole('button', { name: /概览/ })).toHaveCount(0);
      const backgroundFocus = await page.evaluate(() => {
        const nav = document.querySelector('#root .nav') as HTMLElement;
        nav.focus();
        return document.activeElement === nav;
      });
      expect(backgroundFocus).toBe(false);
      for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
      }
      const bounds = await dialog.boundingBox();
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden', 'true');
      await expect(trigger).toBeFocused();
      if (width !== 700) continue;
      await trigger.focus();
      await page.keyboard.press('Space');
      await expect(dialog).toBeVisible();
      writeUsage(workspace.codexDir, 'changed-after-preview', '/work/alpha', 'gpt-alpha', 7, new Date().toISOString());
      await page.evaluate(() => window.tokenApi.scanSources());
      const confirm = dialog.getByRole('button', { name: '确认变更' });
      await confirm.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toHaveCount(0);
      const alert = page.getByRole('alert').filter({ hasText: '已变化' });
      await expect(alert).toBeVisible();
      await expect(alert).toBeFocused();
      await sourceNav.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: '数据来源' })).toBeVisible();
    }
  } finally { await context.close(); }
});
