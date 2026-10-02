import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchM6 } from './m6-support';

test('TC-058 登录后可直接发现检查更新入口', async () => {
  const context = await launchM6('tc058');
  try {
    const { page } = context;
    await expect(page.getByRole('button', { name: /系统设置/ })).toBeVisible();
    await page.getByRole('button', { name: /系统设置/ }).click();
    await expect(page.getByRole('heading', { name: '应用更新' })).toBeVisible();
    await expect(page.getByRole('button', { name: '检查更新' })).toBeVisible();
  } finally { await context.close(); }
});

test('TC-059 新版坏包提示错误且重试后可重新检查', async () => {
  const context = await launchM6('tc059');
  try {
    const { page, workspace } = context;
    const releases = path.join(workspace.root, 'server', 'releases');
    mkdirSync(releases, { recursive: true });
    const bytes = Buffer.from('synthetic-not-a-real-installer');
    const filename = `Token-test-${process.arch}.dmg`;
    writeFileSync(path.join(releases, filename), bytes);
    const manifest = { version: '9.0.0', arch: process.arch, size: bytes.length,
      sha256: '0'.repeat(64), filename, downloadPath: '/v1/update/package', publishedAt: new Date().toISOString() };
    writeFileSync(path.join(releases, 'latest.json'), JSON.stringify(manifest));
    await page.getByRole('button', { name: /系统设置/ }).click();
    await page.getByRole('button', { name: '检查更新' }).click();
    await expect(page.getByText('发现新版本 9.0.0')).toBeVisible();
    await page.getByRole('button', { name: /下载并打开/ }).click();
    await expect(page.getByRole('alert')).toContainText('完整性校验失败');
    manifest.sha256 = createHash('sha256').update(bytes).digest('hex');
    manifest.version = '0.1.0';
    writeFileSync(path.join(releases, 'latest.json'), JSON.stringify(manifest));
    await page.getByRole('button', { name: '检查更新' }).click();
    await expect(page.getByText('当前已是最新版本，或服务器尚未发布安装包。')).toBeVisible();
    await expect(page.getByRole('button', { name: /下载并打开/ })).toHaveCount(0);
  } finally { await context.close(); }
});
