import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { AppDatabase } from '../../src/main/database';
import { UsageScanner } from '../../src/collectors/scanner';
import { UsageSync } from '../../src/main/usage-sync';
import { ReportService } from '../../src/main/report';
import { LocalServer } from '../../src/server/server';
import type { ServerConnection } from '../../src/main/server-connection';
import { createTestWorkspace } from '../support/test-workspace';

test('TC-094 真实 Electron 启动先迁移旧绑定并只发送清理后的首个快照', async () => {
  const workspace = createTestWorkspace('tc094-real-startup');
  const packaged = process.env.TOKEN_E2E_EXECUTABLE;
  const launch = () => electron.launch({ executablePath: packaged || (require('electron') as string),
    args: [...(packaged ? [] : [path.resolve('.')]), `--token-user-data=${workspace.root}`],
    env: { ...process.env, TOKEN_TEST_TELEMETRY_PORT: '0',
      TOKEN_CODEX_SESSIONS_DIR: workspace.codexDir, TOKEN_CLAUDE_PROJECTS_DIR: workspace.claudeDir } });
  let app = await launch();
  let service: LocalServer | undefined;
  try {
    let page = await app.firstWindow();
    await page.getByPlaceholder('至少 10 位').fill('safe-password-123');
    await page.getByRole('button', { name: '创建并进入' }).click();
    await page.getByRole('button', { name: '跳过引导' }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    await app.close();
    const owner = randomUUID();
    const fallback = `codex:otel:${createHash('sha256').update(os.userInfo().username).digest('hex').slice(0, 20)}`;
    const legacyClaude = `claude:macos:${os.userInfo().uid}`;
    const db = await AppDatabase.open(workspace.databasePath);
    let oldSnapshot = '';
    let deviceId = '';
    try {
      const scanner = new UsageScanner(db);
      db.run('INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        [owner, 'affected-viewer', 'unused', 'viewer', '2026-10-02T00:00:00Z']);
      db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [fallback, 'codex', 'legacy', owner]);
      db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['otel:codex:startup-legacy', 'codex', fallback, 'legacy-session', 'gpt-test',
          '2026-10-02T08:00:00Z', 12, 0, 0, 0, 12]);
      db.run('INSERT INTO source_identities VALUES (?, ?, ?, ?)', [legacyClaude, 'claude', 'legacy-file', owner]);
      db.run('INSERT INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['claude:legacy-session:legacy-request', 'claude', legacyClaude, 'legacy-session', 'claude-test',
          '2026-10-02T09:00:00Z', 13, 0, 0, 0, 13]);
      db.run("INSERT INTO source_status(provider,status,file_count,fact_count,last_scan) VALUES ('codex','ready',0,0,'2026-10-02T08:00:00Z') ON CONFLICT(provider) DO UPDATE SET status='ready'");
      const connection = { getConnectionIdentity: () => 'test-seed' } as ServerConnection;
      const sync = new UsageSync(db, scanner, connection);
      db.transactionDurable(() => sync.queueSnapshot(['codex', 'claude']));
      oldSnapshot = String(db.one('SELECT payload FROM sync_outbox WHERE id = 1')?.payload);
      deviceId = String(db.one("SELECT value FROM sync_meta WHERE key='device_id'")?.value);
      expect(oldSnapshot).toContain(owner);
    } finally { db.close(); }

    const directory = path.join(workspace.root, 'server');
    service = new LocalServer(directory);
    const port = await service.start();
    const base = `http://127.0.0.1:${port}`;
    const globalSecret = fs.readFileSync(path.join(directory, 'server.secret'), 'utf8').trim();
    const adminSecret = fs.readFileSync(path.join(directory, 'server-admin.secret'), 'utf8').trim();
    const enrolled = await fetch(`${base}/v1/admin/devices/enroll`, { method: 'POST', headers: {
      authorization: `Bearer ${globalSecret}`, 'x-token-admin': adminSecret,
      'content-type': 'application/json' }, body: JSON.stringify({ deviceId, ownerUserIds: [owner] }) });
    expect(enrolled.status).toBe(200);
    const token = (await enrolled.json() as { token: string }).token;
    expect((await fetch(`${base}/v1/usage`, { method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: oldSnapshot })).status).toBe(200);
    expect(service.getDatabase().one('SELECT owner_user_id, SUM(total_tokens) AS total_tokens FROM aggregates'))
      .toMatchObject({ owner_user_id: owner, total_tokens: 25 });
    const auditBefore = Number(service.getDatabase().one('SELECT COUNT(*) AS count FROM upload_device_audit')?.count);
    await service.stop(); service = undefined;

    // The isolated service DB records what its first accepted startup upload
    // actually left behind, before any later revision can hide a bad first one.
    const captureDb = await AppDatabase.open(path.join(directory, 'server.sqlite'));
    try {
      captureDb.run(`CREATE TABLE test_capture_target(owner_id TEXT NOT NULL);
        CREATE TABLE test_received_revisions(revision INTEGER, accounting_version INTEGER,
          old_aggregates INTEGER, old_status INTEGER);
        CREATE TRIGGER test_capture_revision AFTER UPDATE ON device_revisions BEGIN
          INSERT INTO test_received_revisions SELECT NEW.revision, NEW.accounting_version,
            (SELECT COUNT(*) FROM aggregates WHERE device_id = NEW.device_id
              AND owner_user_id = (SELECT owner_id FROM test_capture_target LIMIT 1)),
            (SELECT COUNT(*) FROM aggregate_status WHERE device_id = NEW.device_id
              AND owner_user_id = (SELECT owner_id FROM test_capture_target LIMIT 1));
        END;`);
      captureDb.run('INSERT INTO test_capture_target VALUES (?)', [owner]);
    } finally { captureDb.close(); }

    app = await launch();
    page = await app.firstWindow();
    await page.getByPlaceholder('用户名').fill('admin');
    await page.getByPlaceholder('输入密码').fill('safe-password-123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
    try {
      await expect.poll(async () => page.evaluate(() => window.tokenApi.getUploadStatus()),
        { timeout: 20_000 }).toMatchObject({ currentConfirmed: true });
    } catch {
      throw new Error(JSON.stringify({ upload: await page.evaluate(() => window.tokenApi.getUploadStatus()),
        server: await page.evaluate(() => window.tokenApi.getServerStatus()) }));
    }
    expect(await page.evaluate(() => window.tokenApi.getSourceIdentities())).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: expect.stringMatching(/^codex:otel:legacy-ambiguous:/), ownerUserId: null })]));
    const ownerReport = await page.evaluate(ownerId => window.tokenApi.queryUsage({ from: '2026-10-02', to: '2026-10-02',
      timeZone: 'UTC', granularity: 'day', provider: 'claude', model: '', projectKey: '', userId: ownerId }), owner);
    expect(ownerReport.accounting.confirmedSubtotal.totalTokens).toBe(0);
    await page.getByRole('button', { name: /数据来源/ }).click();
    const quarantined = page.getByRole('row').filter({ hasText: 'Codex 遥测 · 账户身份无法验证' });
    await expect(quarantined.locator('select')).toBeDisabled();
    await expect(page.getByText('Codex 账户身份无法验证，历史归属已暂停。')).toBeVisible();
    await app.close();
    const localDb = await AppDatabase.open(workspace.databasePath);
    try {
      const localScanner = new UsageScanner(localDb);
      const ownerActor = { id: owner, username: 'affected-viewer', role: 'viewer' as const,
        active: true, createdAt: '2026-10-02T00:00:00Z' };
      const query = { from: '2026-10-02', to: '2026-10-02', timeZone: 'UTC', granularity: 'day' as const,
        provider: 'claude' as const, model: '', projectKey: '', userId: 'all' };
      expect(new ReportService(localDb, localScanner).csv(query, ownerActor)).not.toContain('claude-test');
    } finally { localDb.close(); }
    const serverDb = await AppDatabase.open(path.join(directory, 'server.sqlite'));
    try {
      const accepted = serverDb.all('SELECT * FROM test_received_revisions ORDER BY rowid');
      expect(accepted.length).toBeGreaterThanOrEqual(1);
      expect(accepted[0]).toMatchObject({ accounting_version: 2, old_aggregates: 0, old_status: 0 });
      expect(serverDb.all('SELECT * FROM aggregates')).toHaveLength(0);
      expect(serverDb.all('SELECT * FROM aggregate_status')).toHaveLength(0);
      expect(Number(serverDb.one('SELECT COUNT(*) AS count FROM upload_device_audit')?.count)).toBe(auditBefore + 1);
    } finally { serverDb.close(); }
  } finally {
    await app.close().catch(() => {});
    if (service) await service.stop();
    workspace.cleanup();
  }
});
