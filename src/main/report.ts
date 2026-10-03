import { createHash } from 'node:crypto';
import type { AppDatabase, Row } from './database';
import type { Granularity, ModelTotal, ProjectTotal, Provider, PublicUser, ReportPoint, ReportQuery, TokenTotals, UsageDetailsPage, UsageReport } from '../shared/types';
import type { UsageScanner } from '../collectors/scanner';

interface FactRow extends Row {
  source_key: string;
  source_label: string;
  provider: Provider;
  model: string;
  occurred_at: string;
  owner_user_id: string | null;
  project_key: string | null;
  project_label: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
}

const GRANULARITIES = new Set<Granularity>(['day', 'week', 'month', 'year']);

function emptyTotals(): TokenTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, requests: 0 };
}

function addFact(target: TokenTotals, fact: FactRow): void {
  target.inputTokens += Number(fact.input_tokens);
  target.outputTokens += Number(fact.output_tokens);
  target.cacheReadTokens += Number(fact.cache_read_tokens);
  target.cacheCreationTokens += Number(fact.cache_creation_tokens);
  target.totalTokens += Number(fact.total_tokens);
  target.requests++;
}

function isoWeek(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const weekYear = date.getUTCFullYear();
  const start = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((date.getTime() - start.getTime()) / 86_400_000) + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

function dateParts(date: Date, formatter: Intl.DateTimeFormat): { day: string; year: number; month: number; date: number } {
  const parts = formatter.formatToParts(date);
  const number = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0);
  const year = number('year');
  const month = number('month');
  const day = number('day');
  return { year, month, date: day, day: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

function bucket(parts: ReturnType<typeof dateParts>, granularity: Granularity): string {
  if (granularity === 'day') return parts.day;
  if (granularity === 'week') return isoWeek(parts.year, parts.month, parts.date);
  if (granularity === 'month') return parts.day.slice(0, 7);
  return String(parts.year);
}

function dateIsValid(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function safeQuery(input: unknown, actor: PublicUser): ReportQuery {
  if (!input || typeof input !== 'object') throw new Error('报表参数无效');
  const value = input as Record<string, unknown>;
  if (!dateIsValid(value.from) || !dateIsValid(value.to) || value.from > value.to) throw new Error('日期范围无效');
  const span = Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`);
  if (span > 3660 * 86_400_000) throw new Error('日期范围不能超过 10 年');
  if (!GRANULARITIES.has(value.granularity as Granularity)) throw new Error('统计维度无效');
  if (value.provider !== 'all' && value.provider !== 'codex' && value.provider !== 'claude') throw new Error('工具筛选无效');
  if (typeof value.timeZone !== 'string' || value.timeZone.length > 80) throw new Error('时区无效');
  try { new Intl.DateTimeFormat('en-US', { timeZone: value.timeZone }).format(); }
  catch { throw new Error('时区无效'); }
  if (typeof value.model !== 'string' || value.model.length > 160) throw new Error('模型筛选无效');
  const projectKey = value.projectKey ?? '';
  if (typeof projectKey !== 'string' || (projectKey && projectKey !== 'unknown' && !/^[a-f0-9]{24}$/.test(projectKey))) throw new Error('项目筛选无效');
  if (typeof value.userId !== 'string' || value.userId.length > 100) throw new Error('用户筛选无效');
  return {
    from: value.from,
    to: value.to,
    timeZone: value.timeZone,
    granularity: value.granularity as Granularity,
    provider: value.provider,
    model: value.model,
    projectKey,
    userId: actor.role === 'viewer' ? actor.id : value.userId
  };
}

function csvCell(value: string): string {
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export class ReportService {
  constructor(private readonly db: AppDatabase, private readonly scanner: UsageScanner) {}

  private snapshot(query: ReportQuery): { rows: Array<{ fact: FactRow; period: string }>; id: string } {
    const rows = [...this.filteredFacts(query, this.selectFacts(query))];
    const digest = createHash('sha256').update(JSON.stringify(query));
    const identities = rows.map(({ fact, period }) => [fact.source_key, fact.provider, fact.model,
      fact.occurred_at, fact.owner_user_id, fact.project_key, fact.project_label, fact.source_label,
      fact.input_tokens, fact.output_tokens, fact.cache_read_tokens, fact.cache_creation_tokens,
      fact.total_tokens, period]);
    identities.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    digest.update(JSON.stringify(identities));
    return { rows, id: digest.digest('hex') };
  }

  private assertSnapshot(expected: unknown, actual: string): void {
    if (expected === undefined) return; // Existing direct callers; renderer IPC requires an identity for export.
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('报表快照无效');
    if (expected !== actual) throw new Error('数据已变化，请刷新报表');
  }

  private selectFacts(query: ReportQuery): FactRow[] {
    const lower = new Date(Date.parse(`${query.from}T00:00:00Z`) - 2 * 86_400_000).toISOString();
    const upper = new Date(Date.parse(`${query.to}T00:00:00Z`) + 2 * 86_400_000).toISOString();
    return this.db.all(`SELECT f.*, s.owner_user_id, s.label AS source_label,
      p.project_key, p.project_label FROM usage_facts f
      LEFT JOIN source_identities s ON s.key = f.source_identity_key
      LEFT JOIN fact_projects p ON p.source_key = f.source_key
      WHERE f.occurred_at >= ? AND f.occurred_at < ?
        AND (f.source_key NOT LIKE 'otel:%' OR NOT EXISTS (
          SELECT 1 FROM usage_facts local
          WHERE local.provider = f.provider AND local.source_key NOT LIKE 'otel:%'
            AND substr(local.occurred_at, 1, 10) = substr(f.occurred_at, 1, 10)
        ))
      ORDER BY f.occurred_at`, [lower, upper]) as FactRow[];
  }

  private *filteredFacts(query: ReportQuery, facts: FactRow[]): Generator<{ fact: FactRow; period: string }> {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: query.timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    });
    for (const fact of facts) {
      const parts = dateParts(new Date(fact.occurred_at), formatter);
      if (parts.day < query.from || parts.day > query.to) continue;
      if (query.provider !== 'all' && fact.provider !== query.provider) continue;
      if (query.userId === 'unassigned') {
        if (fact.owner_user_id) continue;
      } else if (query.userId !== 'all' && fact.owner_user_id !== query.userId) continue;
      yield { fact, period: bucket(parts, query.granularity) };
    }
  }

  query(input: unknown, actor: PublicUser): UsageReport {
    const query = safeQuery(input, actor);
    const snapshot = this.snapshot(query);
    const totals = emptyTotals();
    const periods = new Map<string, ReportPoint>();
    const models = new Map<string, ModelTotal>();
    const projects = new Map<string, ProjectTotal>();
    const providers = new Map<Provider, TokenTotals & { provider: Provider }>();
    const availableModels = new Set<string>();
    const availableProjects = new Map<string, string>();
    for (const { fact, period } of snapshot.rows) {
      availableModels.add(fact.model);
      const projectKey = fact.project_key || 'unknown';
      const projectLabel = fact.project_label || '未识别项目';
      availableProjects.set(projectKey, projectLabel);
      if (query.projectKey && projectKey !== query.projectKey) continue;
      if (query.model && fact.model !== query.model) continue;
      addFact(totals, fact);
      if (!periods.has(period)) periods.set(period, { period, ...emptyTotals() });
      addFact(periods.get(period)!, fact);
      const modelKey = `${fact.provider}\0${fact.model}`;
      if (!models.has(modelKey)) models.set(modelKey, { provider: fact.provider, model: fact.model, ...emptyTotals() });
      addFact(models.get(modelKey)!, fact);
      if (!projects.has(projectKey)) projects.set(projectKey, { key: projectKey, label: projectLabel, ...emptyTotals() });
      addFact(projects.get(projectKey)!, fact);
      if (!providers.has(fact.provider)) providers.set(fact.provider, { provider: fact.provider, ...emptyTotals() });
      addFact(providers.get(fact.provider)!, fact);
    }
    return {
      query, snapshotId: snapshot.id, totals,
      points: [...periods.values()].sort((a, b) => a.period.localeCompare(b.period)),
      models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens ||
        a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)),
      projects: [...projects.values()].sort((a, b) => b.totalTokens - a.totalTokens || a.label.localeCompare(b.label) || a.key.localeCompare(b.key)),
      providers: [...providers.values()].sort((a, b) => b.totalTokens - a.totalTokens),
      availableModels: [...availableModels].sort(),
      availableProjects: [...availableProjects].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key)),
      coverage: this.scanner.statuses()
    };
  }

  details(input: unknown, pageInput: unknown, periodInput: unknown, actor: PublicUser,
    expectedSnapshot?: unknown): UsageDetailsPage {
    const query = safeQuery(input, actor);
    if (typeof pageInput !== 'number' || !Number.isSafeInteger(pageInput) || pageInput < 1) throw new Error('页码无效');
    if (typeof periodInput !== 'string' || periodInput.length > 20 || (periodInput && !/^[0-9]{4}(?:-(?:[0-9]{2}(?:-[0-9]{2})?|W[0-9]{2}))?$/.test(periodInput))) {
      throw new Error('时间分组无效');
    }
    const snapshot = this.snapshot(query);
    this.assertSnapshot(expectedSnapshot, snapshot.id);
    const facts = snapshot.rows
      .filter(({ fact, period }) => (!query.model || fact.model === query.model) &&
        (!query.projectKey || (fact.project_key || 'unknown') === query.projectKey) && (!periodInput || period === periodInput))
      .sort((a, b) => b.fact.occurred_at.localeCompare(a.fact.occurred_at));
    const pageSize = 50;
    return {
      total: facts.length,
      page: pageInput,
      pageSize,
      records: facts.slice((pageInput - 1) * pageSize, pageInput * pageSize).map(({ fact }) => ({
        id: createHash('sha256').update(fact.source_key).digest('hex').slice(0, 12),
        provider: fact.provider,
        model: fact.model,
        projectKey: fact.project_key || 'unknown',
        projectLabel: fact.project_label || '未识别项目',
        occurredAt: fact.occurred_at,
        source: fact.source_key.startsWith('otel:') ? 'telemetry' : 'local',
        sourceLabel: fact.source_label || '未知来源',
        inputTokens: Number(fact.input_tokens),
        outputTokens: Number(fact.output_tokens),
        cacheReadTokens: Number(fact.cache_read_tokens),
        cacheCreationTokens: Number(fact.cache_creation_tokens),
        totalTokens: Number(fact.total_tokens)
      }))
    };
  }

  csv(input: unknown, actor: PublicUser, expectedSnapshot?: unknown): string {
    const query = safeQuery(input, actor);
    const snapshot = this.snapshot(query);
    this.assertSnapshot(expectedSnapshot, snapshot.id);
    const groups = new Map<string, ModelTotal & { period: string; projectLabel: string }>();
    for (const { fact, period } of snapshot.rows) {
      if (query.model && fact.model !== query.model) continue;
      if (query.projectKey && (fact.project_key || 'unknown') !== query.projectKey) continue;
      const key = `${period}\0${fact.provider}\0${fact.model}\0${fact.project_key || 'unknown'}`;
      if (!groups.has(key)) groups.set(key, { period, provider: fact.provider, model: fact.model,
        projectLabel: fact.project_label || '未识别项目', ...emptyTotals() });
      addFact(groups.get(key)!, fact);
    }
    const header = ['时间', '工具', '项目', '模型', '输入 Token', '输出 Token', '缓存读取 Token', '缓存写入 Token', '总 Token', '用量记录数'];
    const rows = [...groups.values()].sort((a, b) => a.period.localeCompare(b.period)).map(row => [
      csvCell(row.period), csvCell(row.provider), csvCell(row.projectLabel), csvCell(row.model), row.inputTokens,
      row.outputTokens, row.cacheReadTokens, row.cacheCreationTokens, row.totalTokens, row.requests
    ].join(','));
    return `\uFEFF${header.join(',')}\r\n${rows.join('\r\n')}${rows.length ? '\r\n' : ''}`;
  }
}
