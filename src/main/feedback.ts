import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './database';
import type { ServerConnection } from './server-connection';
import type { FeedbackSubmission, PublicUser } from '../shared/types';

const SENSITIVE = /(?:\/(?:[^/\s]+\/)+[^/\s]+|[A-Z]:\\Users\\|-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}|(?:OPENAI|ANTHROPIC)_API_KEY\s*[=:])/i;

export class FeedbackService {
  private timer: NodeJS.Timeout | null = null;
  private sending: Promise<void> | null = null;

  constructor(private readonly db: AppDatabase, private readonly connection: ServerConnection,
    private readonly version: string, private readonly platform: string) {
    db.run(`CREATE TABLE IF NOT EXISTS feedback_outbox (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, created_at TEXT NOT NULL
    )`);
  }

  start(): void {
    this.timer = setInterval(() => { void this.flush(); }, 60_000);
    void this.flush();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async submit(actor: PublicUser, category: unknown, title: unknown, message: unknown,
    diagnostics: string | null, proposedId?: string): Promise<FeedbackSubmission> {
    if (!['missing_usage', 'report', 'update', 'other'].includes(String(category)) ||
      typeof title !== 'string' || !title.trim() || title.length > 120 ||
      typeof message !== 'string' || !message.trim() || message.length > 4000 ||
      (diagnostics !== null && diagnostics.length > 2000)) throw new Error('反馈内容无效');
    if (SENSITIVE.test(`${title}\n${message}\n${diagnostics ?? ''}`)) throw new Error('反馈包含可能的路径或密钥，请删除后重试');
    if (proposedId !== undefined && !/^[a-f0-9-]{36}$/.test(proposedId)) throw new Error('反馈编号无效');
    const id = proposedId ?? randomUUID();
    const payload = { id, username: actor.username, category, title: title.trim(), message: message.trim(),
      diagnostics, appVersion: this.version, platform: this.platform };
    this.db.run('INSERT INTO feedback_outbox VALUES (?, ?, ?, 0, 0, NULL, ?)', [
      id, actor.id, JSON.stringify(payload), new Date().toISOString()
    ]);
    await this.flush();
    const row = this.db.one('SELECT sent FROM feedback_outbox WHERE id = ?', [id]);
    return { id, delivery: Number(row?.sent ?? 0) === 1 ? 'sent' : 'queued' };
  }

  pending(actor: PublicUser): FeedbackSubmission[] {
    return this.db.all('SELECT id, sent FROM feedback_outbox WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [actor.id])
      .map(row => ({ id: String(row.id), delivery: Number(row.sent) === 1 ? 'sent' : 'queued' }));
  }

  flush(): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = this.sendPending().finally(() => { this.sending = null; });
    return this.sending;
  }

  private async sendPending(): Promise<void> {
    for (const row of this.db.all('SELECT id, payload FROM feedback_outbox WHERE sent = 0 ORDER BY created_at LIMIT 50')) {
      try {
        const response = await this.connection.request('/v1/feedback', { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: String(row.payload) }, 10000);
        if (!response.ok) throw new Error(`服务端拒绝反馈 (${response.status})`);
        this.db.run('UPDATE feedback_outbox SET sent = 1, last_error = NULL WHERE id = ?', [String(row.id)]);
      } catch (error) {
        this.db.run('UPDATE feedback_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?', [
          error instanceof Error ? error.message : '提交失败', String(row.id)
        ]);
      }
    }
  }
}
