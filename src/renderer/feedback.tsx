import React from 'react';
import type { FeedbackItem, FeedbackSubmission } from '../shared/types';

export function FeedbackPanel({ username }: { username: string }) {
  const [category, setCategory] = React.useState<FeedbackItem['category']>('missing_usage');
  const [title, setTitle] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [attach, setAttach] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [previewId, setPreviewId] = React.useState('');
  const [info, setInfo] = React.useState<{ version: string; platform: string } | null>(null);
  const [diagnosticPreview, setDiagnosticPreview] = React.useState('');
  const [deliveries, setDeliveries] = React.useState<FeedbackSubmission[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [sent, setSent] = React.useState<FeedbackSubmission | null>(null);

  React.useEffect(() => {
    void window.tokenApi.getAppInfo().then(setInfo).catch(() => {});
    void window.tokenApi.getMyFeedback().then(setDeliveries).catch(() => {});
  }, []);

  async function showPreview(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (attach) {
      try {
        const items = await window.tokenApi.getCollectionDiagnostics();
        setDiagnosticPreview(JSON.stringify(items.map(item => ({
          provider: item.provider, status: item.status, fileCount: item.fileCount, factCount: item.factCount,
          reason: item.reason, malformedCount: item.malformedCount, unreadableCount: item.unreadableCount
        })), null, 2));
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return; }
    } else setDiagnosticPreview('');
    setPreviewId(crypto.randomUUID());
    setPreview(true);
  }

  async function send() {
    setBusy(true); setError(''); setSent(null);
    try {
      const result = await window.tokenApi.submitFeedback(category, title, message, attach, previewId);
      setSent(result); setPreview(false); setTitle(''); setMessage(''); setAttach(false);
      setDeliveries(await window.tokenApi.getMyFeedback());
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function retry() {
    setBusy(true); setError('');
    try { setDeliveries(await window.tokenApi.retryFeedback()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return <div className="feedback-page"><p className="page-lead">向当前配置的服务器提交问题。请勿粘贴提示词、回复、源码、完整路径或密钥。</p>
    <section className="panel"><div className="panel-head"><h2>提交问题反馈</h2><span>预览并确认后发送</span></div>
      {!preview ? <form className="feedback-form" onSubmit={showPreview}>
        <label>问题类型<select value={category} onChange={e => setCategory(e.target.value as FeedbackItem['category'])}><option value="missing_usage">漏采集</option><option value="report">报表数据</option><option value="update">软件更新</option><option value="other">其他</option></select></label>
        <label>标题<input aria-label="反馈标题" maxLength={120} required value={title} onChange={e => setTitle(e.target.value)} placeholder="简要描述问题" /></label>
        <label>详细说明<textarea aria-label="反馈说明" maxLength={4000} required rows={7} value={message} onChange={e => setMessage(e.target.value)} placeholder="发生时间、操作步骤、预期结果和实际结果" /></label>
        <label className="checkline"><input type="checkbox" checked={attach} onChange={e => setAttach(e.target.checked)} />附上脱敏采集状态（来源、数量、错误类型）</label>
        <button className="primary">预览反馈</button>
      </form> : <div className="feedback-preview" role="region" aria-label="反馈预览">
        <p><strong>提交账号：</strong>{username} · <strong>反馈编号：</strong><code>{previewId}</code></p>
        <p><strong>类型：</strong>{category}</p><p><strong>标题：</strong>{title}</p><p className="feedback-message"><strong>说明：</strong>{message}</p>
        <p><strong>应用版本：</strong>{info?.version || '读取中'} · <strong>平台：</strong>{info?.platform || '读取中'}</p>
        <p><strong>诊断摘要：</strong>{attach ? '仅含下列来源状态和计数' : '不附加'}</p>{attach && <pre>{diagnosticPreview}</pre>}
        <div className="source-actions"><button className="primary" disabled={busy} onClick={send}>{busy ? '提交中…' : '确认提交'}</button><button className="export-button" onClick={() => setPreview(false)}>返回修改</button></div>
      </div>}
      {error && <div className="error" role="alert">{error}</div>}
      {sent && <div className="notice" role="status">{sent.delivery === 'sent' ? '已提交到服务器' : '服务器暂不可用，已保存在本机待重试'}，反馈编号 {sent.id}</div>}
    </section>
    <section className="panel"><div className="panel-head"><h2>我的提交状态</h2><span>{deliveries.filter(item => item.delivery === 'queued').length} 条待发送</span></div>
      <div className="source-actions"><button className="export-button" disabled={busy || !deliveries.some(item => item.delivery === 'queued')} onClick={retry}>重试待发送</button></div>
      <div className="feedback-deliveries">{deliveries.map(item => <div key={item.id}><code>{item.id}</code><span>{item.delivery === 'sent' ? '已送达' : '待发送'}</span></div>)}</div>
    </section>
  </div>;
}
