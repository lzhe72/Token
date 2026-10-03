import React from 'react';
import type { CollectionDiagnostic } from '../shared/types';

export function DiagnosticsPanel({ items, busy, canScan, onScan, onPermissions, onFeedback }: {
  items: CollectionDiagnostic[];
  busy: boolean;
  canScan: boolean;
  onScan(): void;
  onPermissions(): void;
  onFeedback(): void;
}) {
  return <div className="diagnostics-page">
    <p className="page-lead">定位漏采时，先核对目录是否存在、最近扫描、异常记录和来源归属，再检查报表日期与时区。</p>
    <div className="source-actions">{canScan ? <button className="primary" disabled={busy} onClick={onScan}>{busy ? '扫描中…' : '重新扫描并诊断'}</button> : <span className="hint">需要管理员重新扫描并检查来源归属。</span>}<button className="export-button" onClick={onPermissions}>系统权限设置</button></div>
    <div className="diagnostic-grid">{items.map(item => <section className="panel diagnostic-card" key={item.provider}>
      <div className="panel-head"><h2>{item.provider === 'codex' ? 'Codex' : 'Claude Code'}</h2><span className={item.status === 'ready' ? 'status-good' : 'status-warn'}>{item.fileCount === null ? item.status === 'ready' ? '已采到归属记录 · 覆盖未知' : '覆盖未知' : item.status === 'ready' ? '采集正常' : item.status === 'no_records' ? '没有可识别用量' : item.status === 'not_found' ? '目录未找到' : item.status === 'error' ? '采集异常' : '等待扫描'}</span></div>
      <p className="hint">扫描位置：{item.location} · 最近扫描：{item.fileCount === null ? '仅管理员可确认' : item.lastScan ? new Date(item.lastScan).toLocaleString('zh-CN') : '尚无'}</p>
      <p className="hint">最近成功：{item.fileCount === null ? '仅管理员可确认' : item.lastSuccess ? new Date(item.lastSuccess).toLocaleString('zh-CN') : '尚无'} · 失败原因：{item.reason === 'none' ? '无' : item.reason}</p>
      <div className="diagnostic-metrics"><span>文件 <strong>{item.fileCount ?? '未知'}</strong></span><span>用量记录 <strong>{item.factCount ?? '未知'}</strong></span><span>未识别项目 <strong>{item.unknownProjectCount ?? '未知'}</strong></span><span>未归属用户 <strong>{item.unassignedFactCount ?? '未知'}</strong></span><span>待写完文件 <strong>{item.pendingTailCount ?? '未知'}</strong></span></div>
      <p className="hint">异常：{item.unreadableCount ?? '未知'} 个文件不可读 · {item.malformedCount ?? '未知'} 条格式异常 · {item.oversizedCount ?? '未知'} 条过大</p>
      <p className="diagnostic-suggestion">{item.suggestion}</p>
    </section>)}</div>
    <section className="panel"><h2>仍然漏采？</h2><p className="hint">可在问题反馈中附上脱敏采集状态。反馈不会自动包含会话正文、完整路径或密钥。</p><button className="text-button" onClick={onFeedback}>提交问题反馈 →</button></section>
  </div>;
}
