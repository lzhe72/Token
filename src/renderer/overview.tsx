import React from 'react';
import type { Provider, ReportQuery, ServerStatus, SourceStatus, UpdateStatus, UploadStatus, UsageReport } from '../shared/types';
import { formatTokens } from './format';

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function queryFor(days: number, provider: Provider | 'all', shift = 0): ReportQuery {
  const to = new Date();
  to.setDate(to.getDate() - shift);
  const from = new Date(to);
  from.setDate(from.getDate() - days + 1);
  return { from: localDate(from), to: localDate(to), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    granularity: 'day', provider, model: '', userId: 'all' };
}

export function statusLabel(source: SourceStatus): string {
  if (source.status === 'ready') return '采集正常';
  if (source.status === 'scanning') return '扫描中';
  if (source.status === 'no_records') return '已覆盖 · 暂无记录';
  if (source.status === 'not_found') return '未找到目录';
  if (source.status === 'error') return '需要检查';
  return '等待扫描';
}

export function comparisonLabel(current: number, previous: number | null, covered: boolean): string {
  if (!covered || previous === null) return '未知';
  if (previous === 0) return current === 0 ? '0%' : '新增';
  return `${current >= previous ? '+' : ''}${(((current - previous) / previous) * 100).toFixed(1)}%`;
}

export function OverviewPanel({ sources, server, upload, update, onCheckUpdate, onDownloadUpdate, onReport }: {
  sources: SourceStatus[];
  server: ServerStatus | null;
  upload: UploadStatus | null;
  update: UpdateStatus | null;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onReport: () => void;
}) {
  const [days, setDays] = React.useState(30);
  const [provider, setProvider] = React.useState<Provider | 'all'>('all');
  const [report, setReport] = React.useState<UsageReport | null>(null);
  const [previous, setPrevious] = React.useState<UsageReport | null>(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [current, prior] = await Promise.all([
          window.tokenApi.queryUsage(queryFor(days, provider)),
          window.tokenApi.queryUsage(queryFor(days, provider, days))
        ]);
        if (active) { setReport(current); setPrevious(prior); setError(''); }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : '概览加载失败');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [days, provider]);

  const coverage = sources.some(source => source.status === 'ready' || source.status === 'no_records');
  const currentTotal = report?.totals.totalTokens ?? 0;
  const priorTotal = previous?.totals.totalTokens ?? 0;
  const change = comparisonLabel(currentTotal, previous ? priorTotal : null, coverage);
  const max = Math.max(1, ...(report?.points.map(point => point.totalTokens) ?? []));
  const totalModels = report?.models.slice(0, 5) ?? [];

  return <div className="overview-page">
    <div className="overview-toolbar"><div><span className="eyebrow">YOUR USAGE</span><p>查看模型、趋势与数据覆盖情况。</p></div><div className="overview-controls"><select aria-label="概览时间范围" value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select><select aria-label="概览工具" value={provider} onChange={event => setProvider(event.target.value as Provider | 'all')}><option value="all">全部工具</option><option value="codex">Codex</option><option value="claude">Claude Code</option></select></div></div>
    {error && <div className="error" role="alert">{error}</div>}
    <div className="overview-metrics">
      <div className="overview-primary"><span>总 Token</span><strong title={`${currentTotal.toLocaleString('zh-CN')} Token`}>{!coverage ? '未覆盖' : formatTokens(currentTotal)}</strong><div className="overview-change"><b>{change}</b><span>对比上一个 {days} 天</span></div></div>
      <div className="overview-secondary"><div><span>用量记录</span><strong>{coverage ? report?.totals.requests.toLocaleString('zh-CN') ?? '—' : '未覆盖'}</strong></div><div><span>使用模型</span><strong>{coverage ? report?.models.length ?? '—' : '未覆盖'}</strong></div><div><span>输入 / 输出</span><strong>{coverage ? `${formatTokens(report?.totals.inputTokens ?? 0)} / ${formatTokens(report?.totals.outputTokens ?? 0)}` : '未覆盖'}</strong></div></div>
    </div>
    <div className="overview-grid">
      <section className="panel overview-trend"><div className="panel-head"><h2>用量走势</h2><button className="text-button" onClick={onReport}>详细报表 →</button></div>{report?.points.length ? <><div className="overview-bars">{report.points.map(point => <div key={point.period} title={`${point.period} · ${point.totalTokens.toLocaleString('zh-CN')} Token`} className="overview-bar-wrap"><div className="overview-bar" style={{ height: `${Math.max(3, point.totalTokens / max * 100)}%` }} /></div>)}</div><div className="overview-range"><span>{report.query.from}</span><span>{report.query.to}</span></div></> : <div className="empty-row">{coverage ? '此时间范围没有用量记录' : '等待数据来源完成扫描'}</div>}</section>
      <section className="panel overview-ranking"><div className="panel-head"><h2>模型排行</h2><span>按 Token</span></div>{totalModels.length ? totalModels.map((model, index) => <div className="ranking-row" key={`${model.provider}:${model.model}`}><span className="rank-number">{index + 1}</span><div><strong>{model.model}</strong><small>{model.provider === 'codex' ? 'Codex' : 'Claude Code'}</small></div><b title={`${model.totalTokens.toLocaleString('zh-CN')} Token`}>{formatTokens(model.totalTokens)}</b></div>) : <div className="empty-row">暂无模型用量</div>}</section>
    </div>
    <div className="section-heading"><h2>数据来源与同步</h2><span>每 10 分钟扫描并上报</span></div>
    <div className="source-grid">{(['codex', 'claude'] as const).map(name => {
      const source = sources.find(item => item.provider === name);
      return <div className="source-card" key={name}><div className={`source-icon ${name}`}>{name === 'codex' ? '◈' : '✳'}</div><div><h3>{name === 'codex' ? 'Codex' : 'Claude Code'}</h3><p>{source ? `${(source.factCount + source.telemetryFactCount).toLocaleString('zh-CN')} 条记录 · 最近扫描 ${source.lastScan ? new Date(source.lastScan).toLocaleString('zh-CN') : '尚无'}` : '等待扫描'}</p></div><span className="status-pill">{source ? statusLabel(source) : '等待扫描'}</span></div>;
    })}</div>
    <div className="overview-service"><div><strong>服务端</strong><span>{server?.online ? `已连接 ${server.url}` : server?.error || '检查连接中'}</span></div><div><strong>自动上报</strong><span>{upload?.pending ? `${upload.pending} 批待补传` : upload?.lastSuccess ? `最近成功 ${new Date(upload.lastSuccess).toLocaleString('zh-CN')}` : '等待首次上报'}</span></div><div><strong>应用更新</strong><span>{update?.available ? `发现 ${update.version}` : update?.error ? update.error : '可检查新版本'}</span><div className="update-buttons"><button className="text-button" onClick={onCheckUpdate}>检查更新</button>{update?.available && <button className="text-button" onClick={onDownloadUpdate}>下载并更新</button>}</div></div></div>
  </div>;
}
