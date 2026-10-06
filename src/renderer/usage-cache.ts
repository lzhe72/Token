import type { PublicUser, ReportQuery, UsageDetailsPage, UsageReport } from '../shared/types';

export const USAGE_REFRESH_MS = 5 * 60 * 1000;

interface CachedReport {
  report: UsageReport | null;
  attemptedAt: number | null;
  updatedAt: number | null;
  lastError: string | null;
}

const reports = new Map<string, CachedReport>();
const details = new Map<string, UsageDetailsPage>();
const pending = new Map<string, Promise<UsageReport>>();
let generation = 0;

export function usageCacheKey(user: PublicUser, query: ReportQuery): string {
  return JSON.stringify([user.id, user.role, query]);
}

export function cachedUsage(key: string): CachedReport | null {
  return reports.get(key) ?? null;
}

export function usageRefreshDelay(key: string, now = Date.now()): number {
  const attemptedAt = reports.get(key)?.attemptedAt;
  return attemptedAt === null || attemptedAt === undefined ? 0
    : Math.max(0, attemptedAt + USAGE_REFRESH_MS - now);
}

function remember<K, V>(store: Map<K, V>, key: K, value: V, limit: number): void {
  store.delete(key);
  store.set(key, value);
  if (store.size > limit) store.delete(store.keys().next().value!);
}

export function fetchUsage(key: string, query: ReportQuery): Promise<UsageReport> {
  const existing = pending.get(key);
  if (existing) return existing;
  const currentGeneration = generation;
  const previous = reports.get(key);
  remember(reports, key, { report: previous?.report ?? null, updatedAt: previous?.updatedAt ?? null,
    attemptedAt: Date.now(), lastError: previous?.lastError ?? null }, 24);
  const request = window.tokenApi.queryUsage(query).then(report => {
    if (generation === currentGeneration) {
      remember(reports, key, { report, attemptedAt: Date.now(), updatedAt: Date.now(), lastError: null }, 24);
    }
    return report;
  }).catch(error => {
    if (generation === currentGeneration) {
      const current = reports.get(key);
      if (current) remember(reports, key, { ...current,
        lastError: error instanceof Error ? error.message : String(error) }, 24);
    }
    throw error;
  }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
  pending.set(key, request);
  return request;
}

export function cachedUsageDetails(key: string, snapshotId: string, page: number, period: string): UsageDetailsPage | null {
  return details.get(JSON.stringify([key, snapshotId, page, period])) ?? null;
}

export function rememberUsageDetails(key: string, snapshotId: string, page: number, period: string,
  value: UsageDetailsPage): void {
  remember(details, JSON.stringify([key, snapshotId, page, period]), value, 48);
}

export function invalidateUsageCache(revision?: number): boolean {
  let changed = false;
  for (const [key, value] of reports) {
    if (revision !== undefined && value.report?.dataRevision !== undefined &&
      value.report.dataRevision >= revision) continue;
    reports.set(key, { ...value, attemptedAt: null });
    changed = true;
  }
  if (!changed) return false;
  generation++;
  pending.clear();
  return true;
}

export function markUsageDue(key: string): void {
  const entry = reports.get(key);
  if (entry) reports.set(key, { ...entry, attemptedAt: null });
}

export function clearUsageCache(): void {
  generation++;
  pending.clear();
  reports.clear();
  details.clear();
}
