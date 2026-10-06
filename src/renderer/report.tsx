import React from 'react';
import type { CollectionDiagnostic, Granularity, Provider, PublicUser, ReportQuery, SourceStatus, UsageDetailsPage, UsageReport } from '../shared/types';
import { formatPeriodLabel, formatTokens } from './format';
import { TokenValue } from './copy-token';
import { reportEmptyState } from './empty-state';
import type { ReportDestination } from './report-navigation';
import { cachedUsage, cachedUsageDetails, fetchUsage, markUsageDue, rememberUsageDetails,
  usageCacheKey, usageRefreshDelay, USAGE_REFRESH_MS } from './usage-cache';

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const today = new Date();
const monthAgo = new Date(today);
monthAgo.setDate(today.getDate() - 29);

function initialQuery(): ReportQuery {
  return {
    from: localDate(monthAgo),
    to: localDate(today),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    granularity: 'day',
    provider: 'all',
    model: '',
    projectKey: '',
    userId: 'all'
  };
}

const number = (value: number) => value.toLocaleString('zh-CN');

function coverageLabel(source: SourceStatus): string {
  if (source.status === 'cancelled') return '扫描已取消 · 覆盖未知';
  if (source.windowCoverage?.state === 'partial') return '部分覆盖';
  if (source.windowCoverage?.state === 'unknown') return '覆盖未知';
  if (source.detail?.includes('覆盖仍待诊断')) return '已采到记录 · 覆盖未知';
  if (source.status === 'ready') return '已采集';
  if (source.status === 'scanning') return '扫描中';
  if (source.status === 'no_records') return '暂无用量记录';
  if (source.status === 'not_found') return '未找到本地目录';
  if (source.status === 'error') return '需检查来源';
  return source.detail?.includes('未知') || source.detail?.includes('无法确认') ? '覆盖未知' : '等待扫描';
}

function displayError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function matchesQuery(report: UsageReport, query: ReportQuery, user: PublicUser): boolean {
  const effective = { ...query, projectKey: query.projectKey || '',
    userId: user.role === 'viewer' ? user.id : query.userId };
  return (Object.keys(effective) as Array<keyof ReportQuery>).every(key => report.query[key] === effective[key]);
}

export function ReportPanel({ user, users, destination, rememberedQuery, onQueryChange, usageEpoch, backTick, onDrilldownChange, onDiagnostics, onPermissions }: { user: PublicUser; users: PublicUser[];
  rememberedQuery?: ReportQuery | null; onQueryChange?: (query: ReportQuery) => void; usageEpoch: number;
  destination?: ReportDestination | null; backTick?: number; onDrilldownChange?: (active: boolean) => void;
  onDiagnostics(): void; onPermissions(): void }) {
  const [query, setQuery] = React.useState<ReportQuery>(() => destination?.query || rememberedQuery || initialQuery());
  const key = usageCacheKey(user, query);
  const [loaded, setLoaded] = React.useState<{ key: string; report: UsageReport | null }>(() =>
    ({ key, report: cachedUsage(key)?.report ?? null }));
  const [loadedDetails, setLoadedDetails] = React.useState<{ key: string; value: UsageDetailsPage } | null>(null);
  const [detailPage, setDetailPage] = React.useState(1);
  const [detailPeriod, setDetailPeriod] = React.useState(destination?.period || '');
  const [error, setError] = React.useState<{ key: string; message: string } | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [loading, setLoading] = React.useState(() => !cachedUsage(key)?.report);
  const [refreshing, setRefreshing] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const previousKey = React.useRef(key);
  const [diagnostics, setDiagnostics] = React.useState<CollectionDiagnostic[]>([]);
  const loadedReport = loaded.key === key ? loaded.report : cachedUsage(key)?.report;
  const report = loadedReport && matchesQuery(loadedReport, query, user) ? loadedReport : null;
  const detailsKey = report ? JSON.stringify([key, report.snapshotId, detailPage, detailPeriod]) : '';
  const details = report ? loadedDetails?.key === detailsKey ? loadedDetails.value
    : cachedUsageDetails(key, report.snapshotId, detailPage, detailPeriod) : null;
  const detailRef = React.useRef<HTMLElement | null>(null);
  const lastBackTick = React.useRef(backTick);
  const focusedDestination = React.useRef(false);

  React.useEffect(() => { onQueryChange?.(query); }, [query, onQueryChange]);

  React.useEffect(() => {
    if (lastBackTick.current === backTick) return;
    lastBackTick.current = backTick;
    setQuery(current => ({ ...current, model: '', projectKey: '' }));
    setDetailPeriod('');
    setDetailPage(1);
  }, [backTick]);

  React.useEffect(() => {
    if (!details || !destination || focusedDestination.current || !(detailPeriod || query.model || query.projectKey)) return;
    focusedDestination.current = true;
    detailRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    detailRef.current?.focus();
  }, [details, destination, detailPeriod, query.model, query.projectKey]);

  React.useEffect(() => { onDrilldownChange?.(Boolean(detailPeriod || query.model || query.projectKey)); },
    [detailPeriod, query.model, query.projectKey, onDrilldownChange]);

  React.useEffect(() => {
    let active = true;
    let timer: number;
    if (previousKey.current !== key) markUsageDue(key);
    previousKey.current = key;
    const cached = cachedUsage(key);
    setLoaded({ key, report: cached?.report ?? null });
    setLoading(!cached?.report);
    setError(cached?.lastError ? { key, message: displayError(cached.lastError) } : null);
    const refresh = async (): Promise<void> => {
      if (!active) return;
      const previous = cachedUsage(key)?.report;
      setLoading(!previous);
      setRefreshing(Boolean(previous));
      try {
        const value = await fetchUsage(key, query);
        if (active) {
          setLoaded({ key, report: value });
          setError(null);
        }
      } catch (reason) {
        if (active) setError({ key, message: displayError(reason) });
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
          timer = window.setTimeout(() => void refresh(), USAGE_REFRESH_MS);
        }
      }
    };
    timer = window.setTimeout(() => void refresh(), usageRefreshDelay(key));
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, usageEpoch, reload]);

  React.useEffect(() => {
    let active = true;
    void window.tokenApi.getCollectionDiagnostics()
      .then(items => { if (active) setDiagnostics(items); }).catch(() => {});
    return () => { active = false; };
  }, [user.id, query.provider, reload]);

  React.useEffect(() => {
    let active = true;
    if (!report) { setLoadedDetails(null); return () => { active = false; }; }
    const snapshotId = report.snapshotId;
    const detailKey = JSON.stringify([key, snapshotId, detailPage, detailPeriod]);
    const cached = cachedUsageDetails(key, snapshotId, detailPage, detailPeriod);
    if (cached) { setLoadedDetails({ key: detailKey, value: cached }); return () => { active = false; }; }
    setLoadedDetails(null);
    void window.tokenApi.queryUsageDetails(query, detailPage, detailPeriod, snapshotId)
      .then(value => { if (active) {
        rememberUsageDetails(key, snapshotId, detailPage, detailPeriod, value);
        setLoadedDetails({ key: detailKey, value });
      } })
      .catch(e => { if (active) {
        const message = displayError(e);
        setError({ key, message });
        if (message.includes('数据已变化')) { markUsageDue(key); setReload(value => value + 1); }
      } });
    return () => { active = false; };
  }, [key, detailPage, detailPeriod, report?.snapshotId]);

  function update<K extends keyof ReportQuery>(key: K, value: ReportQuery[K]) {
    setQuery(current => ({ ...current, [key]: value }));
    setDetailPage(1);
    setDetailPeriod('');
  }

  function selectModel(provider: Provider, model: string) {
    setQuery(current => ({ ...current, provider, model }));
    setDetailPage(1);
    setDetailPeriod('');
  }

  async function exportCsv() {
    if (!report || loading) return;
    setExporting(true);
    setError(null);
    try { await window.tokenApi.exportCsv(query, report.snapshotId); }
    catch (e) {
      const message = displayError(e);
      setError({ key, message });
      if (message.includes('数据已变化')) markUsageDue(key);
    }
    finally { setExporting(false); }
  }

  const maxPoint = Math.max(1, ...(report?.points.map(point => point.totalTokens) ?? []));
  const hasCoverage = Boolean(report?.coverage.length) && report!.coverage.every(source => source.windowCoverage?.state === 'complete');
  const hasObserved = Boolean(report && (report.totals.requests > 0 || report.accounting?.conflictCount > 0));
  const metric = (value: number) => hasCoverage || hasObserved ? formatTokens(value) : '覆盖未知';
  const empty = report ? reportEmptyState(report, query, user, diagnostics) : null;
  const emptyAction = () => {
    if (empty?.action === 'clear-filters') {
      setQuery(current => ({ ...current, model: '', projectKey: '' }));
      setDetailPeriod(''); setDetailPage(1);
    } else if (empty?.action === 'permissions') onPermissions();
    else if (empty?.action === 'diagnostics') onDiagnostics();
  };

  return <div className="report-page">
    <div className="report-toolbar">
      <div className="segment" role="group" aria-label="统计维度">
        {([['day', '日'], ['week', '周'], ['month', '月'], ['year', '年']] as Array<[Granularity, string]>).map(([key, label]) =>
          <button key={key} className={query.granularity === key ? 'selected' : ''} onClick={() => update('granularity', key)}>{label}</button>
        )}
      </div>
      <div className="report-dates"><label>开始 <input aria-label="开始日期" type="date" value={query.from} onChange={e => update('from', e.target.value)} /></label><span>—</span><label>结束 <input aria-label="结束日期" type="date" value={query.to} onChange={e => update('to', e.target.value)} /></label></div>
      <button className="export-button" disabled={exporting || loading || refreshing || !report} onClick={exportCsv}>{exporting ? '导出中…' : report?.accounting?.status === 'uncertain' ? '导出含待核对用量 CSV v2' : '导出 CSV'}</button>
    </div>
    <div className="selected-filters" role="group" aria-label="当前报表筛选">
      <strong>当前筛选</strong><span>{query.from} 至 {query.to}</span><span>{query.timeZone}</span>
      <span>工具：{query.provider === 'all' ? '全部' : query.provider === 'codex' ? 'Codex' : 'Claude Code'}</span>
      <span>模型：{query.model || '全部'}</span><span>项目：{query.projectKey ? report?.availableProjects.find(item => item.key === query.projectKey)?.label || '指定项目' : '全部'}</span>
      <span>用户：{user.role === 'viewer' ? '当前用户' : query.userId === 'all' ? '全部与未归属' : query.userId === 'unassigned' ? '未归属' : users.find(item => item.id === query.userId)?.username || '指定用户'}</span>
    </div>
    <div className="report-filters">
      <label>工具<select aria-label="工具筛选" value={query.provider} onChange={e => { setQuery(current => ({ ...current, provider: e.target.value as Provider | 'all', model: '' })); setDetailPage(1); setDetailPeriod(''); }}><option value="all">全部工具</option><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
      <label>模型<select aria-label="模型筛选" value={query.model ? `${query.provider}\0${query.model}` : ''} onChange={e => {
        if (!e.target.value) update('model', '');
        else { const [selectedProvider, model] = e.target.value.split('\0'); selectModel(selectedProvider as Provider, model); }
      }}><option value="">全部模型</option>{report?.availableModelOptions?.map(item => <option key={`${item.provider}:${item.model}`} value={`${item.provider}\0${item.model}`}>{item.provider === 'codex' ? 'Codex' : 'Claude Code'} · {item.model}</option>)}</select></label>
      <label>项目<select aria-label="项目筛选" value={query.projectKey || ''} onChange={e => update('projectKey', e.target.value)}><option value="">全部项目</option>{report?.availableProjects.map(project => <option key={project.key} value={project.key}>{project.label}</option>)}</select></label>
      {user.role !== 'viewer' && <label>用户<select aria-label="用户筛选" value={query.userId} onChange={e => update('userId', e.target.value)}><option value="all">全部用户与未归属</option><option value="unassigned">未归属</option>{users.map(item => <option key={item.id} value={item.id}>{item.username}</option>)}</select></label>}
      <label>统计时区<select aria-label="统计时区" value={query.timeZone} onChange={e => update('timeZone', e.target.value)}>
        {[...new Set([query.timeZone, 'Asia/Shanghai', 'UTC', 'America/Los_Angeles', 'Europe/London'])].map(zone => <option key={zone} value={zone}>{zone}</option>)}
      </select></label>
    </div>
    {error?.key === key && <div className="error" role="alert">{report ? '显示上次结果，未更新：' : ''}{error.message}</div>}
    {report && <p className="hint usage-refresh-status" role="status">{cachedUsage(key)?.updatedAt ? `上次更新 ${new Date(cachedUsage(key)!.updatedAt!).toLocaleTimeString('zh-CN')}` : '正在读取报表'}{refreshing ? ' · 正在更新，导出暂不可用' : ''} <button type="button" className="text-button" onClick={() => { markUsageDue(key); setReload(value => value + 1); }}>刷新报表</button></p>}
    {!report ? <div className="panel empty-row" role="status">{loading || (loaded.key !== key && !cachedUsage(key)?.report) ? '正在计算报表…' : '报表暂不可用，请重试。'} <button type="button" className="text-button" onClick={() => { markUsageDue(key); setReload(value => value + 1); }}>刷新报表</button></div> : <>
      {report.accounting?.status === 'uncertain' && <div className="config-warning" role="status">总量不可确认。已确认小计 {number(report.accounting.confirmedSubtotal.totalTokens)} Token；当前授权范围有 {number(report.accounting.conflictCount)} 条待核对记录（{report.accounting.conflictSources.map(source => source === 'local' ? '本地' : '遥测').join('、')}）。下方指标、趋势和排行仅统计已确认部分；明细仍列出待核对原始记录。导出将使用 14 列 CSV v2，冲突组的总 Token 留空。</div>}
      <div className="coverage-strip">{report.coverage.map(source => <div key={source.provider}><strong>{source.provider === 'codex' ? 'Codex' : 'Claude Code'}</strong><span>{coverageLabel(source)} · {source.factCount === null ? '本地条数未知' : `${number(source.factCount)} 条本范围本地已观测`} · {source.telemetryFactCount === null ? '遥测条数未知' : `${number(source.telemetryFactCount)} 条本范围遥测已观测`} · {source.windowCoverage?.reason ?? source.detail}</span></div>)}</div>
      <div className="metric-grid">
        <div className="metric-card"><span>{report.accounting?.status === 'uncertain' ? '已确认小计 Token' : hasCoverage ? '总 Token' : '已观测 Token'}</span><strong>{(hasObserved || hasCoverage) ? <TokenValue value={report.totals.totalTokens} label={report.accounting?.status === 'uncertain' ? '报表已确认小计' : '报表已观测总量'} /> : metric(report.totals.totalTokens)}</strong><small>{report.accounting?.status === 'uncertain' ? '完整总量不可确认' : hasCoverage ? `${number(report.totals.requests)} 条用量记录` : '完整总量未知'}</small></div>
        <div className="metric-card"><span>{report.accounting?.status === 'uncertain' ? '已确认输入 Token' : '已观测输入 Token'}</span><strong>{(hasObserved || hasCoverage) ? <TokenValue value={report.totals.inputTokens} label={report.accounting?.status === 'uncertain' ? '报表已确认输入' : '报表已观测输入'} /> : metric(report.totals.inputTokens)}</strong><small>按工具原始口径</small></div>
        <div className="metric-card"><span>{report.accounting?.status === 'uncertain' ? '已确认输出 Token' : '已观测输出 Token'}</span><strong>{(hasObserved || hasCoverage) ? <TokenValue value={report.totals.outputTokens} label={report.accounting?.status === 'uncertain' ? '报表已确认输出' : '报表已观测输出'} /> : metric(report.totals.outputTokens)}</strong><small>包含推理输出</small></div>
        <div className="metric-card"><span>{report.accounting?.status === 'uncertain' ? '已确认缓存读取' : '已观测缓存读取'}</span><strong>{(hasObserved || hasCoverage) ? <TokenValue value={report.totals.cacheReadTokens} label={report.accounting?.status === 'uncertain' ? '报表已确认缓存读取' : '报表已观测缓存读取'} /> : metric(report.totals.cacheReadTokens)}</strong><small>Codex 中属于输入子集</small></div>
      </div>
      <section className="panel trend-panel"><div className="panel-head"><h2>用量趋势{report.accounting?.status === 'uncertain' ? ' · 仅已确认部分' : ''}</h2></div>
        {report.points.length ? <div className="chart-scroll"><div className="bar-chart" style={{ minWidth: `${report.points.length * 76}px` }}>{report.points.map(point => {
          const label = formatPeriodLabel(point.period, query.granularity);
          return <div className="bar-item" key={point.period}><TokenValue className="bar-value" value={point.totalTokens} label={`${label} ${report.accounting?.status === 'uncertain' ? '已确认小计' : '已观测用量'}`} /><button type="button" className={detailPeriod === point.period ? 'bar-column selected' : 'bar-column'} aria-label={`查看 ${label} 用量明细`} onClick={() => { setDetailPeriod(point.period); setDetailPage(1); }}><div className="bar-track"><div className="bar" style={{ height: `${Math.max(3, point.totalTokens / maxPoint * 100)}%` }} /></div><div className="bar-label">{label}</div></button></div>;
        })}</div></div> : <div className="empty-row" role="status">{empty?.message}{empty?.action && <div><button type="button" className="text-button" onClick={emptyAction}>{empty.actionLabel} →</button></div>}</div>}
      </section>
      <section className="panel project-panel"><div className="panel-head"><h2>项目统计{report.accounting?.status === 'uncertain' ? ' · 仅已确认部分' : ''}</h2><span>{hasObserved || hasCoverage ? `${report.projects.length} 个已确认项目` : '覆盖未知'}</span></div>
        <p className="hint">从本机会话工作目录识别项目；未提供工作目录的记录单列统计。项目路径不上传服务端。</p>
        <div className="dimension-list">{report.projects.map(item => <div className="dimension-item" key={item.key}><button type="button" className="dimension-row" onClick={() => update('projectKey', item.key)}>
          <span className="dimension-name" title={item.label}>{item.label}</span><span>{item.requests.toLocaleString('zh-CN')} 条</span>
          <span className="dimension-meter"><i style={{ width: `${report.totals.totalTokens ? item.totalTokens / report.totals.totalTokens * 100 : 0}%` }} /></span>
        </button><TokenValue value={item.totalTokens} label={`${item.label} 项目${report.accounting?.status === 'uncertain' ? '已确认小计' : '已观测用量'}`} /></div>)}{report.projects.length === 0 && <div className="empty-row">{report.accounting?.status === 'uncertain' ? '项目用量待核对。' : hasCoverage ? '已确认没有项目用量。' : '没有已观测项目，覆盖未知。'}</div>}</div>
      </section>
      <section className="panel model-panel"><div className="panel-head"><h2>模型用量{report.accounting?.status === 'uncertain' ? ' · 仅已确认部分' : ''}</h2><span>{hasObserved || hasCoverage ? `${report.models.length} 个已确认模型` : '覆盖未知'}</span></div><div className="table-wrap"><table><thead><tr><th>工具 / 模型</th><th>输入</th><th>输出</th><th>缓存读取</th><th>缓存写入</th><th>总 Token</th></tr></thead><tbody>{report.models.map(item => {
        const scope = `${item.provider === 'codex' ? 'Codex' : 'Claude Code'} ${item.model} ${report.accounting?.status === 'uncertain' ? '已确认' : '已观测'}`;
        return <tr key={`${item.provider}:${item.model}`}><td><button type="button" className="model-link" onClick={() => selectModel(item.provider, item.model)}>{item.model}</button><small className="model-provider">{item.provider === 'codex' ? 'Codex' : 'Claude Code'}</small></td><td><TokenValue value={item.inputTokens} label={`${scope}输入`} /></td><td><TokenValue value={item.outputTokens} label={`${scope}输出`} /></td><td><TokenValue value={item.cacheReadTokens} label={`${scope}缓存读取`} /></td><td><TokenValue value={item.cacheCreationTokens} label={`${scope}缓存写入`} /></td><td><TokenValue value={item.totalTokens} label={`${scope}总量`} /></td></tr>;
      })}</tbody></table>{report.models.length === 0 && <div className="empty-row">{report.accounting?.status === 'uncertain' ? '模型用量待核对。' : hasCoverage ? '已确认没有模型用量。' : '没有已观测模型，覆盖未知。'}</div>}</div></section>
      <section className="panel detail-panel" ref={detailRef} tabIndex={-1}><div className="panel-head"><h2>用量明细</h2><span>{details ? `${number(details.total)} 条记录` : '加载中'}</span></div>
        <p className="hint">选择趋势柱或模型名称可定位对应记录。时间按 {query.timeZone} 显示；悬停或聚焦数字可查看完整数值并复制。</p>
        {(detailPeriod || query.model || query.projectKey) && <div className="detail-filters">{detailPeriod && <button className="text-button" onClick={() => { setDetailPeriod(''); setDetailPage(1); }}>{detailPeriod} ×</button>}{query.model && <button className="text-button" onClick={() => update('model', '')}>{query.model} ×</button>}{query.projectKey && <button className="text-button" onClick={() => update('projectKey', '')}>项目筛选 ×</button>}</div>}
        <div className="table-wrap"><table><thead><tr><th>时间</th><th>工具 / 模型</th><th>项目</th><th>来源</th><th>计量状态</th><th>输入</th><th>输出</th><th>缓存读</th><th>缓存写</th><th>总 Token</th></tr></thead><tbody>{details?.records.map(item => {
          const scope = `${item.provider === 'codex' ? 'Codex' : 'Claude Code'} ${item.model} ${new Date(item.occurredAt).toLocaleString('zh-CN', { timeZone: query.timeZone })} ${item.accountingStatus === 'pending' ? '待核对原始' : '已确认'}`;
          return <tr key={item.id}><td>{new Date(item.occurredAt).toLocaleString('zh-CN', { timeZone: query.timeZone })}</td><td><strong>{item.model}</strong><small className="model-provider">{item.provider === 'codex' ? 'Codex' : 'Claude Code'}</small></td><td>{item.projectLabel}</td><td title={item.sourceLabel}>{item.source === 'local' ? '本地' : '遥测'}</td><td>{item.accountingStatus === 'pending' ? '待核对' : '已确认'}</td><td><TokenValue value={item.inputTokens} label={`${scope}输入`} /></td><td><TokenValue value={item.outputTokens} label={`${scope}输出`} /></td><td><TokenValue value={item.cacheReadTokens} label={`${scope}缓存读取`} /></td><td><TokenValue value={item.cacheCreationTokens} label={`${scope}缓存写入`} /></td><td><TokenValue value={item.totalTokens} label={`${scope}总量`} /></td></tr>;
        })}</tbody></table>{details?.records.length === 0 && <div className="empty-row">当前筛选没有明细。</div>}</div>
        {details && details.total > details.pageSize && <div className="detail-pager"><button disabled={detailPage === 1} onClick={() => setDetailPage(page => page - 1)}>上一页</button><span>{detailPage} / {Math.ceil(details.total / details.pageSize)}</span><button disabled={detailPage * details.pageSize >= details.total} onClick={() => setDetailPage(page => page + 1)}>下一页</button></div>}
      </section>
      <p className="report-footnote">显示单位按 1024 进位：1024 Token = 1 K、1024 K = 1 M、1024 M = 1 P；悬停或聚焦数字可查看完整数值并复制，CSV 也保留整数。Codex 的缓存读取包含在输入 Token 中；Claude Code 的缓存读取和写入单独计入总量。跨来源疑似重叠保留待核对，不把已确认小计冒充完整总量。</p>
    </>}
  </div>;
}
