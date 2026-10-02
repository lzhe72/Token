import type { AppDatabase, Row } from './database';
import type { Granularity, ModelTotal, Provider, PublicUser, ReportPoint, ReportQuery, TokenTotals, UsageReport } from '../shared/types';
import type { UsageScanner } from '../collectors/scanner';

interface FactRow extends Row {
  provider: Provider;
  model: string;
  occurred_at: string;
  owner_user_id: string | null;
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
  if (typeof value.userId !== 'string' || value.userId.length > 100) throw new Error('用户筛选无效');
  return {
    from: value.from,
    to: value.to,
    timeZone: value.timeZone,
    granularity: value.granularity as Granularity,
    provider: value.provider,
    model: value.model,
    userId: actor.role === 'admin' ? value.userId : actor.id
  };
}

function csvCell(value: string): string {
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export class ReportService {
  constructor(private readonly db: AppDatabase, private readonly scanner: UsageScanner) {}

  private selectFacts(query: ReportQuery): FactRow[] {
    const lower = new Date(Date.parse(`${query.from}T00:00:00Z`) - 2 * 86_400_000).toISOString();
    const upper = new Date(Date.parse(`${query.to}T00:00:00Z`) + 2 * 86_400_000).toISOString();
    return this.db.all(`SELECT f.*, s.owner_user_id FROM usage_facts f
      LEFT JOIN source_identities s ON s.key = f.source_identity_key
      WHERE f.occurred_at >= ? AND f.occurred_at < ? ORDER BY f.occurred_at`, [lower, upper]) as FactRow[];
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
    const facts = this.selectFacts(query);
    const totals = emptyTotals();
    const periods = new Map<string, ReportPoint>();
    const models = new Map<string, ModelTotal>();
    const providers = new Map<Provider, TokenTotals & { provider: Provider }>();
    const availableModels = new Set<string>();
    for (const { fact, period } of this.filteredFacts(query, facts)) {
      availableModels.add(fact.model);
      if (query.model && fact.model !== query.model) continue;
      addFact(totals, fact);
      if (!periods.has(period)) periods.set(period, { period, ...emptyTotals() });
      addFact(periods.get(period)!, fact);
      const modelKey = `${fact.provider}\0${fact.model}`;
      if (!models.has(modelKey)) models.set(modelKey, { provider: fact.provider, model: fact.model, ...emptyTotals() });
      addFact(models.get(modelKey)!, fact);
      if (!providers.has(fact.provider)) providers.set(fact.provider, { provider: fact.provider, ...emptyTotals() });
      addFact(providers.get(fact.provider)!, fact);
    }
    return {
      query, totals,
      points: [...periods.values()].sort((a, b) => a.period.localeCompare(b.period)),
      models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens),
      providers: [...providers.values()].sort((a, b) => b.totalTokens - a.totalTokens),
      availableModels: [...availableModels].sort(),
      coverage: this.scanner.statuses()
    };
  }

  csv(input: unknown, actor: PublicUser): string {
    const query = safeQuery(input, actor);
    const groups = new Map<string, ModelTotal & { period: string }>();
    for (const { fact, period } of this.filteredFacts(query, this.selectFacts(query))) {
      if (query.model && fact.model !== query.model) continue;
      const key = `${period}\0${fact.provider}\0${fact.model}`;
      if (!groups.has(key)) groups.set(key, { period, provider: fact.provider, model: fact.model, ...emptyTotals() });
      addFact(groups.get(key)!, fact);
    }
    const header = ['时间', '工具', '模型', '输入 Token', '输出 Token', '缓存读取 Token', '缓存写入 Token', '总 Token', '请求数'];
    const rows = [...groups.values()].sort((a, b) => a.period.localeCompare(b.period)).map(row => [
      csvCell(row.period), csvCell(row.provider), csvCell(row.model), row.inputTokens,
      row.outputTokens, row.cacheReadTokens, row.cacheCreationTokens, row.totalTokens, row.requests
    ].join(','));
    return `\uFEFF${header.join(',')}\r\n${rows.join('\r\n')}${rows.length ? '\r\n' : ''}`;
  }
}
