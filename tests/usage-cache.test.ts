import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PublicUser, ReportQuery, UsageReport } from '../src/shared/types';
import { cachedUsage, clearUsageCache, fetchUsage, invalidateUsageCache, markUsageDue,
  usageCacheKey, usageRefreshDelay, USAGE_REFRESH_MS } from '../src/renderer/usage-cache';

const actor = { id: 'actor-a', role: 'viewer' } as PublicUser;
const query: ReportQuery = { from: '2026-10-01', to: '2026-10-06', timeZone: 'Asia/Shanghai',
  granularity: 'day', provider: 'all', model: '', projectKey: '', userId: actor.id };
const report = { query, snapshotId: 'a'.repeat(64), dataRevision: 2 } as UsageReport;

describe('用量页面五分钟查询缓存', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    clearUsageCache();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); clearUsageCache(); });

  test('TC-105 同一账号筛选复用结果，4 分 59 秒不触发而五分钟到期', async () => {
    const queryUsage = vi.fn().mockResolvedValue(report);
    vi.stubGlobal('window', { tokenApi: { queryUsage } });
    const key = usageCacheKey(actor, query);
    await fetchUsage(key, query);
    expect(queryUsage).toHaveBeenCalledTimes(1);
    expect(cachedUsage(key)?.report).toBe(report);
    expect(invalidateUsageCache(2)).toBe(false);
    vi.advanceTimersByTime(USAGE_REFRESH_MS - 1000);
    expect(usageRefreshDelay(key)).toBe(1000);
    vi.advanceTimersByTime(1000);
    expect(usageRefreshDelay(key)).toBe(0);
    markUsageDue(key);
    expect(usageRefreshDelay(key)).toBe(0);
    await fetchUsage(key, query);
    expect(queryUsage).toHaveBeenCalledTimes(2);
    expect(invalidateUsageCache(3)).toBe(true);
    expect(usageRefreshDelay(key)).toBe(0);
  });

  test('TC-106 账号与授权变化隔离缓存，旧请求不能回填', async () => {
    let finish!: (value: UsageReport) => void;
    const queryUsage = vi.fn().mockImplementation(() => new Promise<UsageReport>(resolve => { finish = resolve; }));
    vi.stubGlobal('window', { tokenApi: { queryUsage } });
    const firstKey = usageCacheKey(actor, query);
    const secondKey = usageCacheKey({ ...actor, id: 'actor-b' }, { ...query, userId: 'actor-b' });
    expect(secondKey).not.toBe(firstKey);
    const request = fetchUsage(firstKey, query);
    invalidateUsageCache();
    finish(report);
    await request;
    expect(cachedUsage(firstKey)?.report).toBeNull();
    expect(usageRefreshDelay(firstKey)).toBe(0);
    clearUsageCache();
    expect(cachedUsage(firstKey)).toBeNull();
    expect(cachedUsage(secondKey)).toBeNull();
  });
});
