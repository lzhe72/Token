import React from 'react';
import type { Provider, PublicUser, ReportQuery, ServerStatus, SourceStatus, UpdateStatus, UploadStatus, UsageReport } from '../shared/types';
import { formatTokens } from './format';
import type { ReportDestination } from './report-navigation';

function queryFor(days: number, provider: Provider | 'all', userId: string, timeZone: string): ReportQuery {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (name: string) => Number(parts.find(part => part.type === name)?.value);
  const to = new Date(Date.UTC(value('year'), value('month') - 1, value('day'), 12));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days + 1);
  return { from: toIsoDate(from), to: toIsoDate(to), timeZone, granularity: 'day', provider, model: '', projectKey: '', userId };
}

function toIsoDate(date: Date): string { return date.toISOString().slice(0, 10); }

export function statusLabel(source: SourceStatus): string {
  if (source.status === 'cancelled') return '扫描已取消 · 覆盖未知';
  if (source.windowCoverage?.state === 'partial') return '部分覆盖';
  if (source.windowCoverage?.state === 'unknown') return '覆盖未知';
  if (source.detail?.includes('覆盖仍待诊断')) return '已采到记录 · 覆盖未知';
  if (source.status === 'ready') return '采集正常';
  if (source.status === 'scanning') return '扫描中';
  if (source.status === 'no_records') return '已覆盖 · 暂无记录';
  if (source.status === 'not_found') return '未找到目录';
  if (source.status === 'error') return '需要检查';
  return source.detail?.includes('覆盖未知') || source.detail?.includes('无法确认') ? '覆盖未知' : '等待扫描';
}

export function comparisonLabel(current: number, previous: number | null, covered: boolean): string {
  if (!covered || previous === null) return '未知';
  if (previous === 0) return current === 0 ? '0%' : '新增';
  return `${current >= previous ? '+' : ''}${(((current - previous) / previous) * 100).toFixed(1)}%`;
}

export function OverviewPanel({ server, upload, update, user, users, days, provider, userId, timeZone,
  setDays, setProvider, setUserId, setTimeZone, focusId, onFocusRestored, onCheckUpdate, onDownloadUpdate, onReport }: {
  sources: SourceStatus[];
  server: ServerStatus | null;
  upload: UploadStatus | null;
  update: UpdateStatus | null;
  user: PublicUser;
  users: PublicUser[];
  days: number;
  provider: Provider | 'all';
  userId: string;
  timeZone: string;
  setDays: (days: number) => void;
  setProvider: (provider: Provider | 'all') => void;
  setUserId: (userId: string) => void;
  setTimeZone: (timeZone: string) => void;
  focusId: string;
  onFocusRestored: () => void;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onReport: (destination: ReportDestination) => void;
}) {
  const [loadedReport, setLoadedReport] = React.useState<UsageReport | null>(null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    setLoadedReport(null);
    setLoading(true);
    const refresh = async () => {
      try {
        const current = await window.tokenApi.queryUsage(queryFor(days, provider, userId, timeZone));
        if (active) { setLoadedReport(current); setError(''); setLoading(false); }
      } catch (reason) {
        if (active) { setError(reason instanceof Error ? reason.message : '概览加载失败'); setLoading(false); }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [days, provider, userId, timeZone]);

  const currentQuery = queryFor(days, provider, userId, timeZone);
  const report = loadedReport && loadedReport.query.from === currentQuery.from && loadedReport.query.to === currentQuery.to &&
    loadedReport.query.provider === provider && loadedReport.query.userId === (user.role === 'viewer' ? user.id : userId) &&
    loadedReport.query.timeZone === timeZone ? loadedReport : null;
  const loadingCurrent = loading || Boolean(loadedReport && !report);
  const selectedSources = report?.coverage ?? [];
  const coverage = selectedSources.length > 0 && selectedSources.every(source => source.windowCoverage?.state === 'complete');
  const observed = Boolean(report && (report.totals.requests > 0 || report.accounting?.conflictCount > 0));
  const currentTotal = report?.totals.totalTokens ?? 0;
  const scanEvidence = selectedSources.map(source => `${source.provider === 'codex' ? 'Codex' : 'Claude Code'}：${source.windowCoverage?.lastObserved
    ? `最近观测用量 ${new Date(source.windowCoverage.lastObserved).toLocaleString('zh-CN', { timeZone })}，扫描截至时间未知`
    : '本范围最近观测与扫描截至时间未知'}`).join('；');
  const max = Math.max(1, ...(report?.points.map(point => point.totalTokens) ?? []));
  const totalModels = report?.models.slice(0, 5) ?? [];

  React.useEffect(() => {
    if (!focusId || !report) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(focusId) || document.getElementById('overview-ranking-heading');
      target?.focus();
      onFocusRestored();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId, report, onFocusRestored]);

  return <div className="overview-page">
    <div className="overview-toolbar"><div><span className="eyebrow">YOUR USAGE</span><p>查看模型、趋势与数据覆盖情况。</p></div><div className="overview-controls"><select aria-label="概览时间范围" value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select><select aria-label="概览工具" value={provider} onChange={event => setProvider(event.target.value as Provider | 'all')}><option value="all">全部工具</option><option value="codex">Codex</option><option value="claude">Claude Code</option></select>{user.role !== 'viewer' && <select aria-label="概览用户" value={userId} onChange={event => setUserId(event.target.value)}><option value="all">全部用户与未归属</option><option value="unassigned">未归属</option>{users.map(item => <option value={item.id} key={item.id}>{item.username}</option>)}</select>}<select aria-label="概览时区" value={timeZone} onChange={event => setTimeZone(event.target.value)}>{[...new Set([timeZone, 'Asia/Shanghai', 'UTC', 'America/Los_Angeles', 'Europe/London'])].map(zone => <option value={zone} key={zone}>{zone}</option>)}</select></div></div>
    {error && <div className="error" role="alert">{error}</div>}
    <div className="overview-metrics">
      <div className="overview-primary"><span>{report?.accounting?.status === 'uncertain' ? '已确认小计 Token' : coverage ? '总 Token' : '已观测 Token'}</span><strong title={observed ? `${currentTotal.toLocaleString('zh-CN')} Token` : ''}>{loadingCurrent ? '加载中' : !report || !observed && !coverage ? '覆盖未知' : formatTokens(currentTotal)}</strong><div className="overview-change"><b>{loadingCurrent ? '—' : '不可比较'}</b><span>本期含进行中的今天，缺少同截止覆盖证据</span></div>{report?.accounting?.status === 'uncertain' && <small className="overview-asof">总量不可确认 · {report.accounting.conflictCount} 条跨来源记录待核对</small>}<small className="overview-asof">今日进行中 · {scanEvidence || '本范围采集证据未知'}</small></div>
      <div className="overview-secondary"><div><span>{report?.accounting?.status === 'uncertain' ? '已确认用量记录' : '已观测用量记录'}</span><strong>{loadingCurrent ? '—' : observed ? report?.totals.requests.toLocaleString('zh-CN') : '覆盖未知'}</strong></div><div><span>{report?.accounting?.status === 'uncertain' ? '已确认模型' : '已观测模型'}</span><strong>{loadingCurrent ? '—' : observed ? report?.models.length : '覆盖未知'}</strong></div><div><span>{report?.accounting?.status === 'uncertain' ? '已确认输入 / 输出' : '已观测输入 / 输出'}</span><strong>{loadingCurrent ? '—' : observed && report ? `${formatTokens(report.totals.inputTokens)} / ${formatTokens(report.totals.outputTokens)}` : '覆盖未知'}</strong></div></div>
    </div>
    <div className="overview-grid">
      <section className="panel overview-trend"><div className="panel-head"><h2>用量走势{report?.accounting?.status === 'uncertain' ? ' · 仅已确认部分' : ''}</h2><button className="text-button" disabled={!report || loadingCurrent} onClick={() => report && onReport({ query: report.query })}>详细报表 →</button></div>{report?.points.length ? <><div className="overview-bars">{report.points.map(point => <button type="button" id={`overview-trend-${point.period}`} key={point.period} title={`${point.period} · ${point.totalTokens.toLocaleString('zh-CN')} Token`} aria-label={`查看 ${point.period} 用量明细`} className="overview-bar-wrap" onClick={() => onReport({ query: report.query, period: point.period, originId: `overview-trend-${point.period}` })}><div className="overview-bar" style={{ height: `${Math.max(3, point.totalTokens / max * 100)}%` }} /></button>)}</div><div className="overview-range"><span>{report.query.from}</span><span>{report.query.to}</span></div></> : <div className="empty-row">{loadingCurrent ? '正在加载用量…' : !report ? '用量暂不可用' : report.accounting?.status === 'uncertain' ? '此范围存在待核对记录，请打开详细报表' : coverage ? '此时间范围已确认零用量' : '此范围没有已观测用量；覆盖未知'}</div>}</section>
      <section className="panel overview-ranking"><div className="panel-head"><h2 id="overview-ranking-heading" tabIndex={-1}>模型排行{report?.accounting?.status === 'uncertain' ? ' · 仅已确认部分' : ''}</h2><span>按 Token</span></div>{totalModels.length ? totalModels.map((model, index) => {
        const originId = `overview-model-${encodeURIComponent(`${model.provider}:${model.model}`)}`;
        return <button type="button" className="ranking-row" key={`${model.provider}:${model.model}`} aria-label={`查看 ${model.provider === 'codex' ? 'Codex' : 'Claude Code'} ${model.model} 用量明细`} onClick={() => onReport({ query: { ...report!.query, provider: model.provider, model: model.model }, originId })} id={originId}><span className="rank-number">{index + 1}</span><div><strong>{model.model}</strong><small>{model.provider === 'codex' ? 'Codex' : 'Claude Code'}</small></div><b title={`${model.totalTokens.toLocaleString('zh-CN')} Token`}>{formatTokens(model.totalTokens)}</b></button>;
      }) : <div className="empty-row">{loadingCurrent ? '正在加载模型…' : !report ? '模型用量暂不可用' : report.accounting?.status === 'uncertain' ? '模型用量待核对' : coverage ? '已确认没有模型用量' : '当前筛选没有已观测模型，覆盖未知'}</div>}</section>
    </div>
    <div className="section-heading"><h2>数据来源与同步</h2><span>每 10 分钟扫描并上报</span></div>
    <div className="source-grid">{(['codex', 'claude'] as const).map(name => {
      const source = selectedSources.find(item => item.provider === name);
      return <div className="source-card" key={name}><div className={`source-icon ${name}`}>{name === 'codex' ? '◈' : '✳'}</div><div><h3>{name === 'codex' ? 'Codex' : 'Claude Code'}</h3><p>{source ? `${((source.factCount ?? 0) + (source.telemetryFactCount ?? 0)).toLocaleString('zh-CN')} 条本范围已观测记录 · ${source.windowCoverage?.reason ?? '覆盖未知'}` : provider !== 'all' && provider !== name ? '当前筛选未包含此工具' : loadingCurrent ? '正在核对本范围来源' : '本范围覆盖未知'}</p></div><span className="status-pill">{source ? statusLabel(source) : '未选中'}</span></div>;
    })}</div>
    <div className="overview-service"><div><strong>服务端</strong><span>{server?.online ? `已连接 ${server.url}` : server?.error || '检查连接中'}</span></div><div><strong>自动上报</strong><span>{upload?.lastError?.includes('协议不兼容') ? `协议不兼容 · ${upload.pending} 批待传，需更新服务端` : upload?.pending ? `${upload.pending} 批待补传` : upload?.uncertainRows ? `${upload.uncertainRows} 个范围已同步待核对状态` : upload?.lastSuccess ? `最近成功 ${new Date(upload.lastSuccess).toLocaleString('zh-CN')}` : '等待首次上报'}</span></div><div><strong>应用更新</strong><span>{update?.available ? `发现 ${update.version}` : update?.error ? update.error : '可检查新版本'}</span><div className="update-buttons"><button className="text-button" onClick={onCheckUpdate}>检查更新</button>{update?.available && <button className="text-button" onClick={onDownloadUpdate}>下载并更新</button>}</div></div></div>
  </div>;
}
