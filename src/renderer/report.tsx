import React from 'react';
import type { Granularity, Provider, PublicUser, ReportQuery, UsageReport } from '../shared/types';

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
    userId: 'all'
  };
}

const number = (value: number) => value.toLocaleString('zh-CN');

function displayError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '');
}

export function ReportPanel({ user, users }: { user: PublicUser; users: PublicUser[] }) {
  const [query, setQuery] = React.useState<ReportQuery>(initialQuery);
  const [report, setReport] = React.useState<UsageReport | null>(null);
  const [error, setError] = React.useState('');
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    window.tokenApi.queryUsage(query).then(value => {
      if (active) { setReport(value); setError(''); }
    }).catch(e => { if (active) setError(displayError(e)); });
    return () => { active = false; };
  }, [query]);

  function update<K extends keyof ReportQuery>(key: K, value: ReportQuery[K]) {
    setQuery(current => ({ ...current, [key]: value }));
  }

  async function exportCsv() {
    setExporting(true);
    setError('');
    try { await window.tokenApi.exportCsv(query); }
    catch (e) { setError(displayError(e)); }
    finally { setExporting(false); }
  }

  const maxPoint = Math.max(1, ...(report?.points.map(point => point.totalTokens) ?? []));
  const hasCoverage = report?.coverage.some(source => source.status === 'ready' || source.factCount > 0);

  return <div className="report-page">
    <div className="report-toolbar">
      <div className="segment" role="group" aria-label="统计维度">
        {([['day', '日'], ['week', '周'], ['month', '月'], ['year', '年']] as Array<[Granularity, string]>).map(([key, label]) =>
          <button key={key} className={query.granularity === key ? 'selected' : ''} onClick={() => update('granularity', key)}>{label}</button>
        )}
      </div>
      <div className="report-dates"><label>开始 <input aria-label="开始日期" type="date" value={query.from} onChange={e => update('from', e.target.value)} /></label><span>—</span><label>结束 <input aria-label="结束日期" type="date" value={query.to} onChange={e => update('to', e.target.value)} /></label></div>
      <button className="export-button" disabled={exporting || !report} onClick={exportCsv}>{exporting ? '导出中…' : '导出 CSV'}</button>
    </div>
    <div className="report-filters">
      <label>工具<select aria-label="工具筛选" value={query.provider} onChange={e => setQuery(current => ({ ...current, provider: e.target.value as Provider | 'all', model: '' }))}><option value="all">全部工具</option><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
      <label>模型<select aria-label="模型筛选" value={query.model} onChange={e => update('model', e.target.value)}><option value="">全部模型</option>{report?.availableModels.map(model => <option key={model} value={model}>{model}</option>)}</select></label>
      {user.role === 'admin' && <label>用户<select aria-label="用户筛选" value={query.userId} onChange={e => update('userId', e.target.value)}><option value="all">全部用户与未归属</option><option value="unassigned">未归属</option>{users.map(item => <option key={item.id} value={item.id}>{item.username}</option>)}</select></label>}
      <div className="timezone-note">统计时区：{query.timeZone}</div>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    {!report ? <div className="panel empty-row">正在计算报表…</div> : <>
      <div className="metric-grid">
        <div className="metric-card"><span>总 Token</span><strong>{number(report.totals.totalTokens)}</strong><small>{number(report.totals.requests)} 次请求</small></div>
        <div className="metric-card"><span>输入 Token</span><strong>{number(report.totals.inputTokens)}</strong><small>按工具原始口径</small></div>
        <div className="metric-card"><span>输出 Token</span><strong>{number(report.totals.outputTokens)}</strong><small>包含推理输出</small></div>
        <div className="metric-card"><span>缓存读取</span><strong>{number(report.totals.cacheReadTokens)}</strong><small>Codex 中属于输入子集</small></div>
      </div>
      <section className="panel trend-panel"><div className="panel-head"><h2>用量趋势</h2><span>{query.from} 至 {query.to}</span></div>
        {report.points.length ? <div className="chart-scroll"><div className="bar-chart">{report.points.map(point => <div className="bar-column" key={point.period} title={`${point.period} · ${number(point.totalTokens)} Token`}><div className="bar-value">{number(point.totalTokens)}</div><div className="bar-track"><div className="bar" style={{ height: `${Math.max(3, point.totalTokens / maxPoint * 100)}%` }} /></div><div className="bar-label">{point.period}</div></div>)}</div></div> : <div className="empty-row">{hasCoverage ? '该时间范围没有匹配的用量记录。' : '尚未采集到可用记录，请检查数据来源。'}</div>}
      </section>
      <section className="panel"><div className="panel-head"><h2>模型用量</h2><span>{report.models.length} 个模型</span></div><div className="table-wrap"><table><thead><tr><th>工具 / 模型</th><th>输入</th><th>输出</th><th>缓存读取</th><th>缓存写入</th><th>总 Token</th></tr></thead><tbody>{report.models.map(item => <tr key={`${item.provider}:${item.model}`}><td><strong>{item.model}</strong><small className="model-provider">{item.provider === 'codex' ? 'Codex' : 'Claude Code'}</small></td><td>{number(item.inputTokens)}</td><td>{number(item.outputTokens)}</td><td>{number(item.cacheReadTokens)}</td><td>{number(item.cacheCreationTokens)}</td><td><strong>{number(item.totalTokens)}</strong></td></tr>)}</tbody></table>{report.models.length === 0 && <div className="empty-row">暂无模型用量。</div>}</div></section>
      <p className="report-footnote">总 Token 按各工具原始计量规则计算。Codex 的缓存读取包含在输入 Token 中；Claude Code 的缓存读取和写入单独计入总量。本报表仅覆盖本机已采集的记录。</p>
    </>}
  </div>;
}
