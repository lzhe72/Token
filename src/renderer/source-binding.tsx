import React from 'react';
import { createPortal } from 'react-dom';
import type { BindingScopeSummary, SourceBindingPreview } from '../shared/types';

function Scope({ label, value }: { label: string; value: BindingScopeSummary }) {
  return <div className="binding-scope"><strong>{label}</strong><span>{value.observedFacts} 条已观测 · {value.confirmedFacts} 条已确认 · 已确认小计 {value.confirmedTokens.toLocaleString('zh-CN')} Token</span>
    <small>{value.pendingFacts} 条待核对 · 完整覆盖{value.coverage === 'complete' ? '已证实' : value.coverage === 'partial' ? '部分可证' : '未知'}</small></div>;
}

export function SourceBindingDialog({ preview, busy, error, onCancel, onConfirm }: {
  preview: SourceBindingPreview;
  busy: boolean;
  error: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const heading = React.useRef<HTMLHeadingElement>(null);
  const dialog = React.useRef<HTMLElement>(null);
  const cancelRef = React.useRef(onCancel);
  const busyRef = React.useRef(busy);
  cancelRef.current = onCancel;
  busyRef.current = busy;
  React.useLayoutEffect(() => {
    heading.current?.focus();
    const background = document.getElementById('root');
    const previousHidden = background?.getAttribute('aria-hidden') ?? null;
    const previousInert = background?.inert ?? false;
    if (background) { background.inert = true; background.setAttribute('aria-hidden', 'true'); }
    return () => {
      if (!background) return;
      background.inert = previousInert;
      if (previousHidden === null) background.removeAttribute('aria-hidden');
      else background.setAttribute('aria-hidden', previousHidden);
    };
  }, [preview.id]);
  React.useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); cancelRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])];
      if (!controls.length) { event.preventDefault(); heading.current?.focus(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!dialog.current?.contains(document.activeElement)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus(); return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === heading.current)) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [preview.id]);
  return createPortal(<div className="binding-backdrop"><section className="binding-dialog panel" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="binding-title">
    <h2 id="binding-title" ref={heading} tabIndex={-1}>确认来源归属变更</h2>
    <p className="hint"><strong>{preview.sourceLabel}</strong> · {preview.oldOwnerLabel} → {preview.newOwnerLabel} · 当前已观测 {preview.affectedFactCount} 条事实及今后该来源新增记录都会归属目标用户。</p>
    <p className="hint">预览筛选：{preview.filter.from} 至 {preview.filter.to} · {preview.filter.timeZone} · {preview.filter.provider === 'all' ? '全部工具' : preview.filter.provider} · 模型 {preview.filter.model || '全部'} · 项目 {preview.filter.projectKey || '全部'}</p>
    <p className="hint">此预览有效至 {new Date(preview.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}；过期后需重新预览。</p>
    <div className="binding-comparison"><div><h3>变更前</h3><Scope label={preview.oldOwnerLabel} value={preview.before.oldOwner} /><Scope label={preview.newOwnerLabel} value={preview.before.newOwner} /></div>
      <div><h3>变更后</h3><Scope label={preview.oldOwnerLabel} value={preview.after.oldOwner} /><Scope label={preview.newOwnerLabel} value={preview.after.newOwner} /></div></div>
    <p className="config-warning">本地可见范围在确认后立即改变；服务同步可能待传。预览过期或来源事实变化时须重新预览。</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="source-actions"><button type="button" className="export-button" onClick={onCancel} disabled={busy}>取消</button><button type="button" className="primary" onClick={onConfirm} disabled={busy}>{busy ? '确认中…' : '确认变更'}</button></div>
  </section></div>, document.body);
}
