import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
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

function accountId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && id.length <= 200 && !['null', 'undefined', 'unknown'].includes(id.toLowerCase()) ? id : null;
}

export function inspectConfig(file: string, kind: 'codex' | 'claude'): string | null {
  try {
    if (!fs.existsSync(file)) return null;
    if (fs.statSync(file).size > 1024 * 1024) return '现有设置文件较大，请手动检查已有遥测目标。';
    const content = fs.readFileSync(file, 'utf8');
    if (kind === 'codex') {
      return /^\s*\[otel\]\s*$/m.test(content) ? '已发现 [otel] 设置段。请编辑现有段，不要添加第二个同名段。' : null;
    }
    const settings = record(JSON.parse(content) as unknown);
    const env = record(settings.env);
    return Object.keys(env).some(key => key === 'CLAUDE_CODE_ENABLE_TELEMETRY' || key.startsWith('OTEL_'))
      ? '已发现 Claude Code 遥测环境变量。请核对当前目标和组织设置，避免覆盖。' : null;
  } catch {
    return '无法检查现有用户设置，请手动核对遥测目标。';
  }
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
  legacySignature?: string;
  uncertain?: boolean;
}

export class TelemetryReceiver {
  private server: http.Server | null = null;
  private secret: string;
  private error: string | null = null;
  private identityMigrationChanged = false;

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
    db.run(`CREATE TABLE IF NOT EXISTS usage_uncertain_facts (
      source_key TEXT PRIMARY KEY, reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS otel_codex_legacy_alias (
      signature TEXT PRIMARY KEY, source_key TEXT NOT NULL, adopted_key TEXT
    );
    CREATE TABLE IF NOT EXISTS otel_codex_observations (
      source_key TEXT PRIMARY KEY, signature TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS identity_migration_events (
      id TEXT PRIMARY KEY, affected_user_id TEXT, reason_code TEXT NOT NULL,
      source_ref TEXT NOT NULL, occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS otel_codex_observations_signature ON otel_codex_observations(signature);`);
    this.migrateUnknownCodexIdentity();
    this.migrateCodexKeys();
    this.migrateClaudeIdentities();
  }

  didQuarantineLegacyIdentity(): boolean { return this.identityMigrationChanged; }

  private migrateUnknownCodexIdentity(): void {
    const scope = hash(os.userInfo().username).slice(0, 20);
    const oldIdentity = `codex:otel:${scope}`;
    const uncertainIdentity = `codex:otel:legacy-ambiguous:${scope}`;
    const oldRows = this.db.all(`SELECT source_key FROM usage_facts
      WHERE source_identity_key = ? AND source_key LIKE 'otel:codex:%'
        AND source_key NOT LIKE 'otel:codex:v2:%'
        AND source_key NOT LIKE 'otel:codex:legacy:%'`, [oldIdentity]);
    const source = this.db.one('SELECT owner_user_id FROM source_identities WHERE key = ?', [oldIdentity]);
    const knownV2 = this.db.one("SELECT 1 FROM usage_facts WHERE source_identity_key = ? AND source_key LIKE 'otel:codex:v2:%'",
      [oldIdentity]);
    // The old key cannot tell a missing account ID from a real account ID equal
    // to the macOS username. Quarantine only old-format facts; leave proven v2
    // events on their own source. A preexisting binding without v2 evidence is
    // paused, and must be explicitly reviewed after verified telemetry arrives.
    const pauseBinding = !!source?.owner_user_id && !knownV2;
    if (!oldRows.length && !pauseBinding) return;
    this.db.transaction(() => {
      this.db.run('INSERT OR IGNORE INTO source_identities(key, provider, label) VALUES (?, ?, ?)',
        [uncertainIdentity, 'codex', 'Codex 遥测 · 账户身份无法验证，历史归属已暂停']);
      this.db.run('UPDATE source_identities SET owner_user_id = NULL WHERE key = ?', [uncertainIdentity]);
      for (const row of oldRows) {
        const key = String(row.source_key);
        this.db.run('UPDATE usage_facts SET source_identity_key = ? WHERE source_key = ?', [uncertainIdentity, key]);
        this.markUncertain(key, 'legacy_account_ambiguous');
      }
      if (pauseBinding) {
        this.db.run('UPDATE source_identities SET owner_user_id = NULL, label = ? WHERE key = ?',
          ['Codex 遥测 · 账户身份尚未验证，请重新采集', oldIdentity]);
      }
      if (source?.owner_user_id && (oldRows.length || pauseBinding)) {
        const sourceRef = scope;
        const occurredAt = new Date().toISOString();
        this.db.run('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)', [randomUUID(), null,
          'telemetry.legacy_identity_quarantined', sourceRef, occurredAt]);
        this.db.run('INSERT INTO identity_migration_events VALUES (?, ?, ?, ?, ?)', [randomUUID(),
          String(source.owner_user_id), 'legacy_account_ambiguous', sourceRef, occurredAt]);
      }
    });
    this.identityMigrationChanged = true;
  }

  private migrateCodexKeys(): void {
    const legacy = this.db.all(`SELECT source_key, source_identity_key FROM usage_facts
      WHERE source_key LIKE 'otel:codex:%' AND source_key NOT LIKE 'otel:codex:v2:%'
        AND source_key NOT LIKE 'otel:codex:legacy:%'`);
    if (!legacy.length) return;
    this.identityMigrationChanged = true;
    this.db.transaction(() => {
      for (const row of legacy) {
        const oldKey = String(row.source_key);
        const identity = String(row.source_identity_key);
        const signature = hash(JSON.stringify([identity, oldKey]));
        const nextKey = `otel:codex:legacy:${signature}`;
        this.db.run('UPDATE usage_facts SET source_key = ? WHERE source_key = ?', [nextKey, oldKey]);
        this.db.run('UPDATE fact_projects SET source_key = ? WHERE source_key = ?', [nextKey, oldKey]);
        this.db.run('INSERT OR IGNORE INTO usage_uncertain_facts VALUES (?, ?)', [nextKey, 'legacy_otel_identity_unknown']);
        this.db.run('INSERT OR IGNORE INTO otel_codex_legacy_alias VALUES (?, ?, NULL)', [signature, nextKey]);
      }
    });
  }

  private migrateClaudeIdentities(): void {
    const oldSources = this.db.all(`SELECT key, owner_user_id FROM source_identities
      WHERE key LIKE 'claude:otel:%' AND key NOT LIKE 'claude:otel:account:%'
        AND key NOT LIKE 'claude:otel:unknown:%' AND key NOT LIKE 'claude:otel:legacy-unverified:%'`);
    if (!oldSources.length) return;
    this.db.transaction(() => {
      for (const source of oldSources) {
        const oldIdentity = String(source.key);
        const uncertainIdentity = `claude:otel:legacy-unverified:${hash(oldIdentity).slice(0, 20)}`;
        const facts = this.db.all('SELECT source_key FROM usage_facts WHERE source_identity_key = ?', [oldIdentity]);
        this.db.run('INSERT OR IGNORE INTO source_identities(key, provider, label) VALUES (?, ?, ?)',
          [uncertainIdentity, 'claude', 'Claude Code 遥测 · 账户身份无法验证，历史归属已暂停']);
        this.db.run('UPDATE source_identities SET owner_user_id = NULL WHERE key = ?', [uncertainIdentity]);
        for (const fact of facts) {
          const oldKey = String(fact.source_key);
          const nextKey = `otel:claude:legacy:${hash(JSON.stringify([oldIdentity, oldKey]))}`;
          this.db.run('UPDATE usage_facts SET source_key = ?, source_identity_key = ? WHERE source_key = ?',
            [nextKey, uncertainIdentity, oldKey]);
          this.db.run('UPDATE fact_projects SET source_key = ? WHERE source_key = ?', [nextKey, oldKey]);
          this.markUncertain(nextKey, 'legacy_account_ambiguous');
        }
        if (source.owner_user_id && facts.length) {
          const sourceRef = hash(oldIdentity).slice(0, 20);
          const occurredAt = new Date().toISOString();
          this.db.run('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)', [randomUUID(), null,
            'telemetry.legacy_identity_quarantined', sourceRef, occurredAt]);
          this.db.run('INSERT INTO identity_migration_events VALUES (?, ?, ?, ?, ?)', [randomUUID(),
            String(source.owner_user_id), 'legacy_account_ambiguous', sourceRef, occurredAt]);
        }
        this.db.run('DELETE FROM source_identities WHERE key = ?', [oldIdentity]);
      }
    });
    this.identityMigrationChanged = true;
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

  configuration(): { running: boolean; error: string | null; codex: string; claude: string; codexWarning: string | null; claudeWarning: string | null } {
    const address = this.server?.address();
    const endpoint = `http://127.0.0.1:${address && typeof address !== 'string' ? address.port : this.port}`;
    return {
      running: !!this.server,
      error: this.error,
      codexWarning: inspectConfig(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml'), 'codex'),
      claudeWarning: inspectConfig(path.join(os.homedir(), '.claude', 'settings.json'), 'claude'),
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
    const ordinals = new Map<string, number>();
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
          const account = accountId(attrs['user.account_id']);
          const identity = account
            ? `codex:otel:${hash(account).slice(0, 20)}`
            : `codex:otel:unknown:${hash(os.userInfo().username).slice(0, 20)}`;
          const model = string(attrs.model, '未知模型');
          const legacyKey = `otel:codex:${hash([session, occurredAt, model, input, output, cached].join('|'))}`;
          const signature = hash(JSON.stringify([identity, legacyKey]));
          const rawTime = string(log.timeUnixNano);
          const base = `otel:codex:v2:${hash(JSON.stringify([identity, session, rawTime, model, input, output, cached]))}`;
          const ordinal = ordinals.get(base) ?? 0;
          ordinals.set(base, ordinal + 1);
          // Without an account or stable event ID, identical posts may be a
          // retry or two real observations. Keep each raw observation under an
          // opaque key and mark the whole group pending instead of dropping one.
          observations.push({ key: account ? `${base}:${ordinal}` : `${base}:${randomUUID()}`,
            provider: 'codex', identity, session, model,
            occurredAt, category: 'codex', tokens: input, output, cached, legacySignature: signature,
            uncertain: !account });
        }
      }
    }
    if (observations.length > 0) this.db.transaction(() => observations.forEach(item => this.saveCodex(item)));
  }

  private markUncertain(key: string, reason: string): void {
    this.db.run('INSERT OR IGNORE INTO usage_uncertain_facts VALUES (?, ?)', [key, reason]);
  }

  private saveCodex(item: Observation): void {
    if (item.uncertain) {
      this.db.run('INSERT OR IGNORE INTO source_identities(key, provider, label) VALUES (?, ?, ?)',
        [item.identity, 'codex', 'Codex 遥测 · 账户身份无法验证']);
      this.db.run('UPDATE source_identities SET owner_user_id = NULL WHERE key = ?', [item.identity]);
    }
    const signature = item.legacySignature!;
    const alias = this.db.one('SELECT source_key, adopted_key FROM otel_codex_legacy_alias WHERE signature = ?', [signature]);
    const observedBefore = !!this.db.one('SELECT 1 FROM otel_codex_observations WHERE source_key = ?', [item.key]);
    if (alias && !alias.adopted_key) {
      const oldKey = String(alias.source_key);
      this.db.run('UPDATE usage_facts SET source_key = ? WHERE source_key = ?', [item.key, oldKey]);
      this.db.run('UPDATE fact_projects SET source_key = ? WHERE source_key = ?', [item.key, oldKey]);
      this.db.run('UPDATE usage_uncertain_facts SET source_key = ? WHERE source_key = ?', [item.key, oldKey]);
      this.db.run('UPDATE otel_codex_legacy_alias SET adopted_key = ? WHERE signature = ?', [item.key, signature]);
    } else {
      this.save(item);
    }
    const others = this.db.all('SELECT source_key FROM otel_codex_observations WHERE signature = ? AND source_key <> ?', [signature, item.key]);
    for (const row of others) this.markUncertain(String(row.source_key), 'otel_event_identity_ambiguous');
    if (others.length || item.uncertain || observedBefore) this.markUncertain(item.key,
      item.uncertain ? 'otel_account_unknown' : 'otel_event_identity_ambiguous');
    this.db.run('INSERT OR IGNORE INTO otel_codex_observations VALUES (?, ?)', [item.key, signature]);
  }

  private ingestClaude(payload: unknown): void {
    this.db.transaction(() => {
      const ordinals = new Map<string, number>();
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
              const verifiedAccount = accountId(attrs['user.account_uuid']) ?? accountId(attrs['user.account_id']) ??
                (attrs['identity.source'] === 'gateway-oidc' ? accountId(attrs['user.id']) : null);
              const identity = verifiedAccount
                ? `claude:otel:account:${hash(verifiedAccount).slice(0, 20)}`
                : `claude:otel:unknown:${hash(os.userInfo().username).slice(0, 20)}`;
              const start = string(point.startTimeUnixNano);
              const stream = hash(JSON.stringify([identity, attrs['session.id'], attrs.model, category, start]));
              const baseKey = `otel:claude:v2:${hash(JSON.stringify([stream, point.timeUnixNano, value]))}`;
              const ordinal = ordinals.get(baseKey) ?? 0;
              ordinals.set(baseKey, ordinal + 1);
              const key = verifiedAccount ? `${baseKey}:${ordinal}` : `${baseKey}:${randomUUID()}`;
              let tokens = value;
              if (temporality === 2 && verifiedAccount) {
                const previous = this.db.one('SELECT end_time, cumulative_value FROM otel_metric_cursors WHERE stream_key = ?', [stream]);
                if (previous && String(previous.end_time) >= String(point.timeUnixNano)) continue;
                tokens = previous ? value - Number(previous.cumulative_value) : value;
                if (tokens < 0) tokens = value;
                this.db.run(`INSERT INTO otel_metric_cursors VALUES (?, ?, ?)
                  ON CONFLICT(stream_key) DO UPDATE SET end_time=excluded.end_time, cumulative_value=excluded.cumulative_value`,
                  [stream, String(point.timeUnixNano), value]);
              }
              if (!verifiedAccount) {
                this.db.run('INSERT OR IGNORE INTO source_identities(key, provider, label) VALUES (?, ?, ?)',
                  [identity, 'claude', 'Claude Code 遥测 · 账户身份无法验证']);
                this.db.run('UPDATE source_identities SET owner_user_id = NULL WHERE key = ?', [identity]);
              }
              this.save({ key, provider: 'claude', identity, session: string(attrs['session.id'], 'unknown'),
                model: string(attrs.model, '未知模型'), occurredAt, category, tokens });
              if (!verifiedAccount) this.markUncertain(key, 'otel_account_unknown');
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
