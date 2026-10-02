import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTestWorkspace } from './support/test-workspace';
import { AppDatabase } from '../src/main/database';
import { FeedbackService } from '../src/main/feedback';
import type { ServerConnection } from '../src/main/server-connection';
import { LocalServer } from '../src/server/server';
import type { PublicUser } from '../src/shared/types';

const actor: PublicUser = { id: 'user-1', username: 'viewer', role: 'viewer', active: true, createdAt: '' };

test('TC-064 反馈仅显式提交且阻止路径密钥进入服务', async () => {
  const workspace = createTestWorkspace('tc064');
  const server = new LocalServer(path.join(workspace.root, 'server'));
  const db = await AppDatabase.open(workspace.databasePath);
  try {
    const port = await server.start();
    const secret = readFileSync(path.join(workspace.root, 'server', 'server.secret'), 'utf8').trim();
    const connection = { request: (endpoint: string, init: RequestInit) => fetch(`http://127.0.0.1:${port}${endpoint}`,
      { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), authorization: `Bearer ${secret}` } }) } as ServerConnection;
    const feedback = new FeedbackService(db, connection, '0.3.0', 'darwin');
    expect(Number(server.getDatabase().one('SELECT COUNT(*) AS count FROM feedback_items')?.count)).toBe(0);
    await expect(feedback.submit(actor, 'other', 'key', 'OPENAI_API_KEY=sk-secretsecretsecret', null)).rejects.toThrow('路径或密钥');
    await expect(feedback.submit(actor, 'other', 'path', 'See /Users/example/private', null)).rejects.toThrow('路径或密钥');
    const chosenId = '12345678-1234-4123-8123-123456789abc';
    const result = await feedback.submit(actor, 'missing_usage', '漏采', '扫描后无记录', JSON.stringify([
      { provider: 'codex', status: 'no_records', fileCount: 1, factCount: 0, reason: 'unrecognized_usage', malformedCount: 0, unreadableCount: 0 }
    ]), chosenId);
    expect(result.id).toBe(chosenId);
    expect(result.delivery).toBe('sent');
    const stored = server.getDatabase().one('SELECT * FROM feedback_items WHERE id = ?', [result.id]);
    expect(stored).toMatchObject({ username: 'viewer', title: '漏采', app_version: '0.3.0', platform: 'darwin' });
    expect(JSON.stringify(stored)).not.toContain('/Users/');
    expect(JSON.stringify(stored)).not.toContain('project_key');
  } finally { db.close(); await server.stop().catch(() => {}); workspace.cleanup(); }
});

test('TC-065 反馈离线持久化重试幂等且管理读取需独立密钥', async () => {
  const workspace = createTestWorkspace('tc065');
  const server = new LocalServer(path.join(workspace.root, 'server'));
  const db = await AppDatabase.open(workspace.databasePath);
  let online = false;
  try {
    const port = await server.start();
    const secret = readFileSync(path.join(workspace.root, 'server', 'server.secret'), 'utf8').trim();
    const adminSecret = readFileSync(path.join(workspace.root, 'server', 'server-admin.secret'), 'utf8').trim();
    const request = (endpoint: string, init: RequestInit = {}) => {
      if (!online) throw new Error('offline');
      return fetch(`http://127.0.0.1:${port}${endpoint}`, { ...init,
        headers: { ...Object.fromEntries(new Headers(init.headers).entries()), authorization: `Bearer ${secret}` } });
    };
    const feedback = new FeedbackService(db, { request } as unknown as ServerConnection, '0.3.0', 'darwin');
    const pending = await feedback.submit(actor, 'report', '总量问题', '期望 10，显示 9', null);
    expect(pending.delivery).toBe('queued');
    expect(feedback.pending(actor)).toEqual([pending]);
    expect(Number(server.getDatabase().one('SELECT COUNT(*) AS count FROM feedback_items')?.count)).toBe(0);
    online = true;
    await feedback.flush();
    expect(feedback.pending(actor)[0].delivery).toBe('sent');
    const payload = String(db.one('SELECT payload FROM feedback_outbox WHERE id = ?', [pending.id])?.payload);
    expect((await request('/v1/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload })).status).toBe(200);
    expect(Number(server.getDatabase().one('SELECT COUNT(*) AS count FROM feedback_items')?.count)).toBe(1);
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/v1/admin/feedback`, { headers: { authorization: `Bearer ${secret}` } })).status).toBe(403);
    const list = await fetch(`${base}/v1/admin/feedback`, { headers: { authorization: `Bearer ${secret}`, 'x-token-admin': adminSecret } });
    expect((await list.json()).items).toHaveLength(1);
  } finally { db.close(); await server.stop().catch(() => {}); workspace.cleanup(); }
});
