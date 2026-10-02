import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AppDatabase } from './database';
import type { Provider } from '../shared/types';

const PORT = 43188;
const MAX_BODY = 2 * 1024 * 1024;
type Json = Record<string, unknown>;
type Category = 'input' | 'output' | 'cacheRead' | 'cacheCreation';

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function attributeMap(value: unknown): Json {
  const result: Json = {};
  for (const entry of array(value)) {
    const item = record(entry);
    const name = item.key;
    if (typeof name !== 'string') continue;
    const field = record(item.value);
    result[name] = field.stringValue ?? field.intValue ?? field.doubleValue ?? field.boolValue;
  }
  return result;
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length <= 200 ? value : fallback;
}

function count(value: unknown): number | null {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function time(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) return null;
  const milliseconds = Number(BigInt(value) / 1_000_000n);
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface Observation {
  key: string;
  provider: Provider;
  identity: string;
  session: string;
  model: string;
  occurredAt: string;
  category: Category | 'codex';
  tokens: number;
  cached?: number;
  output?: number;
}

export class TelemetryReceiver {
  private server: http.Server | null = null;
  private secret: string;
  private error: string | null = null;

  constructor(private readonly db: AppDatabase, userData: string, private readonly port = PORT) {
    const secretFile = path.join(userData, 'telemetry-secret');
    if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    this.secret = fs.readFileSync(secretFile, 'utf8').trim();
    fs.chmodSync(secretFile, 0o600);
    db.run(`CREATE TABLE IF NOT EXISTS otel_metric_cursors (
      stream_key TEXT PRIMARY KEY,
      end_time TEXT NOT NULL,
      cumulative_value INTEGER NOT NULL
    )`);
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((request, response) => void this.handle(request, response));
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      this.server = server;
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : '端口不可用';
      server.close();
    }
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  configuration(): { running: boolean; error: string | null; codex: string; claude: string } {
    const address = this.server?.address();
    const endpoint = `http://127.0.0.1:${address && typeof address !== 'string' ? address.port : this.port}`;
    return {
      running: !!this.server,
      error: this.error,
      codex: `[otel]\nlog_user_prompt = false\nexporter = { otlp-http = { endpoint = "${endpoint}/v1/logs", protocol = "json", headers = { "Authorization" = "Bearer ${this.secret}" } } }`,
      claude: `export CLAUDE_CODE_ENABLE_TELEMETRY=1\nexport OTEL_METRICS_EXPORTER=otlp\nexport OTEL_LOGS_EXPORTER=none\nexport OTEL_EXPORTER_OTLP_METRICS_PROTOCOL=http/json\nexport OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=${endpoint}/v1/metrics\nexport OTEL_EXPORTER_OTLP_METRICS_HEADERS="Authorization=Bearer ${this.secret}"`
    };
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const reject = (status: number) => { response.writeHead(status); response.end(); };
    const route = request.url === '/v1/logs' ? 'logs' : request.url === '/v1/metrics' ? 'metrics' : null;
    if (request.method !== 'POST' || !route) return reject(404);
    const supplied = request.headers.authorization;
    const expected = `Bearer ${this.secret}`;
    if (!supplied || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return reject(401);
    if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) return reject(415);
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk as Buffer);
        size += bytes.length;
        if (size > MAX_BODY) return reject(413);
        chunks.push(bytes);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      if (route === 'logs') this.ingestCodex(payload);
      else this.ingestClaude(payload);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    } catch {
      reject(400);
    }
  }

  private ingestCodex(payload: unknown): void {
    const observations: Observation[] = [];
    for (const resource of array(record(payload).resourceLogs)) {
      for (const scope of array(record(resource).scopeLogs)) {
        for (const raw of array(record(scope).logRecords)) {
          const log = record(raw);
          const attrs = attributeMap(log.attributes);
          if (attrs['event.name'] !== 'codex.sse_event' || attrs['event.kind'] !== 'response.completed') continue;
          const input = count(attrs.input_token_count);
          const output = count(attrs.output_token_count);
          const cached = count(attrs.cached_token_count) ?? 0;
          if (input === null || output === null || cached > input) continue;
          const occurredAt = time(log.timeUnixNano) ?? string(attrs['event.timestamp']);
          if (!Number.isFinite(Date.parse(occurredAt))) continue;
          const session = string(attrs['conversation.id'], 'unknown');
          const identity = `codex:otel:${hash(string(attrs['user.account_id'], os.userInfo().username)).slice(0, 20)}`;
          const model = string(attrs.model, '未知模型');
          const key = `otel:codex:${hash([session, occurredAt, model, input, output, cached].join('|'))}`;
          observations.push({ key, provider: 'codex', identity, session, model, occurredAt, category: 'codex', tokens: input, output, cached });
        }
      }
    }
    if (observations.length > 0) this.db.transaction(() => observations.forEach(item => this.save(item)));
  }

  private ingestClaude(payload: unknown): void {
    this.db.transaction(() => {
      for (const resource of array(record(payload).resourceMetrics)) {
        const resourceAttrs = attributeMap(record(resource).resource && record(record(resource).resource).attributes);
        for (const scope of array(record(resource).scopeMetrics)) {
          for (const rawMetric of array(record(scope).metrics)) {
            const metric = record(rawMetric);
            if (metric.name !== 'claude_code.token.usage') continue;
            const sum = record(metric.sum);
            const temporality = Number(sum.aggregationTemporality);
            if (temporality !== 1 && temporality !== 2) continue;
            for (const rawPoint of array(sum.dataPoints)) {
              const point = record(rawPoint);
              const attrs = { ...resourceAttrs, ...attributeMap(point.attributes) };
              const category = attrs.type;
              if (category !== 'input' && category !== 'output' && category !== 'cacheRead' && category !== 'cacheCreation') continue;
              const value = count(point.asInt ?? point.asDouble);
              const occurredAt = time(point.timeUnixNano);
              if (value === null || !occurredAt) continue;
              const start = string(point.startTimeUnixNano);
              const stream = hash(JSON.stringify([attrs['user.id'], attrs['session.id'], attrs.model, category, start]));
              const key = `otel:claude:${hash([stream, point.timeUnixNano].join('|'))}`;
              let tokens = value;
              if (temporality === 2) {
                const previous = this.db.one('SELECT end_time, cumulative_value FROM otel_metric_cursors WHERE stream_key = ?', [stream]);
                if (previous && String(previous.end_time) >= String(point.timeUnixNano)) continue;
                tokens = previous ? value - Number(previous.cumulative_value) : value;
                if (tokens < 0) tokens = value;
                this.db.run(`INSERT INTO otel_metric_cursors VALUES (?, ?, ?)
                  ON CONFLICT(stream_key) DO UPDATE SET end_time=excluded.end_time, cumulative_value=excluded.cumulative_value`,
                  [stream, String(point.timeUnixNano), value]);
              }
              const identity = `claude:otel:${hash(string(attrs['user.id'], os.userInfo().username)).slice(0, 20)}`;
              this.save({ key, provider: 'claude', identity, session: string(attrs['session.id'], 'unknown'),
                model: string(attrs.model, '未知模型'), occurredAt, category, tokens });
            }
          }
        }
      }
    });
  }

  private save(item: Observation): void {
    this.db.run('INSERT OR IGNORE INTO source_identities(key, provider, label) VALUES (?, ?, ?)',
      [item.identity, item.provider, `${item.provider === 'codex' ? 'Codex' : 'Claude Code'} 遥测来源`]);
    const input = item.category === 'codex' || item.category === 'input' ? item.tokens : 0;
    const output = item.category === 'codex' ? item.output ?? 0 : item.category === 'output' ? item.tokens : 0;
    const cacheRead = item.category === 'codex' ? item.cached ?? 0 : item.category === 'cacheRead' ? item.tokens : 0;
    const cacheCreation = item.category === 'cacheCreation' ? item.tokens : 0;
    const total = item.category === 'codex' ? input + output : item.tokens;
    this.db.run('INSERT OR IGNORE INTO usage_facts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      item.key, item.provider, item.identity, item.session, item.model, item.occurredAt,
      input, output, cacheRead, cacheCreation, total
    ]);
  }
}
