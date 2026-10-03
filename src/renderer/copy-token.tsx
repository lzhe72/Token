import React from 'react';
import { formatTokens } from './format';

export function CopyTokenButton({ value, label, buttonText = '复制原值' }: { value: number; label: string; buttonText?: string }) {
  const [feedback, setFeedback] = React.useState('');
  async function copy() {
    try {
      await window.tokenApi.copyToken(value);
      setFeedback(`${label}精确值 ${value} Token 已复制`);
    } catch {
      setFeedback(`${label}精确值复制失败`);
    }
  }
  return <span className="token-copy-wrap"><button type="button" className="token-copy"
    aria-label={`复制${label}精确值 ${value} Token`} onClick={() => void copy()}>{buttonText}</button>
    {feedback && <span className="sr-only" role="status">{feedback}</span>}</span>;
}

export function TokenValue({ value, label, emphasis = false }: { value: number; label: string; emphasis?: boolean }) {
  return <span className="token-cell">{emphasis ? <strong>{formatTokens(value)}</strong> : <span>{formatTokens(value)}</span>}
    <CopyTokenButton value={value} label={label} /></span>;
}
