import React from 'react';
import { createPortal } from 'react-dom';
import { formatTokens } from './format';

export function TokenValue({ value, label, className = '' }: { value: number; label: string; className?: string }) {
  const trigger = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<number | undefined>(undefined);
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 0, top: 0 });
  const [feedback, setFeedback] = React.useState('');
  const id = React.useId();

  function show() {
    window.clearTimeout(closeTimer.current);
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({ left: Math.max(8, Math.min(box.left, window.innerWidth - 230)),
      top: box.bottom + 6 > window.innerHeight - 110 ? box.top - 100 : box.bottom + 6 });
    setOpen(true);
  }

  function closeSoon() {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      if (document.activeElement === trigger.current || menu.current?.contains(document.activeElement)) return;
      setOpen(false);
    }, 120);
  }

  function close() {
    window.clearTimeout(closeTimer.current);
    setOpen(false);
  }

  React.useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  React.useEffect(() => {
    if (!open) return;
    const onScroll = () => {
      const box = trigger.current?.getBoundingClientRect();
      if (!box || box.bottom < 0 || box.top > window.innerHeight) { setOpen(false); return; }
      setPosition({ left: Math.max(8, Math.min(box.left, window.innerWidth - 230)),
        top: box.bottom + 6 > window.innerHeight - 110 ? box.top - 100 : box.bottom + 6 });
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
  }, [open]);

  async function copy() {
    try {
      await window.tokenApi.copyToken(value);
      setFeedback(`${label}完整数值 ${value} Token 已复制`);
    } catch {
      setFeedback(`${label}完整数值复制失败`);
    }
  }

  function leaveMenu(backwards: boolean) {
    const focusable = [...document.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
      .filter(element => element !== menu.current?.querySelector('button') && element.getClientRects().length > 0);
    const index = focusable.indexOf(trigger.current!);
    close();
    focusable[index + (backwards ? 0 : 1)]?.focus();
  }

  return <span className={`token-value ${className}`}>
    <button ref={trigger} type="button" className="token-number"
      aria-label={`${label}精确值 ${value} Token，查看完整数值`} aria-expanded={open} aria-controls={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={closeSoon} onFocus={show}
      onBlur={event => { if (!menu.current?.contains(event.relatedTarget as Node)) close(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'Tab' && !event.shiftKey && open) {
          event.preventDefault(); menu.current?.querySelector('button')?.focus();
        }
      }}>
      {formatTokens(value)}
    </button>
    {open && createPortal(<div ref={menu} id={id} className="token-popover" role="group"
      aria-label={`${label}完整数值`} style={position}
      onMouseEnter={() => window.clearTimeout(closeTimer.current)} onMouseLeave={closeSoon}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); trigger.current?.focus(); close(); } }}>
      <span className="token-exact">{value.toLocaleString('zh-CN')} Token</span>
      <button type="button" className="token-copy" aria-label={`复制${label}精确值 ${value} Token`}
        onClick={() => void copy()} onBlur={event => { if (event.relatedTarget !== trigger.current) close(); }}
        onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); leaveMenu(event.shiftKey); } }}>
        复制完整数值
      </button>
    </div>, document.body)}
    {feedback && <span className="sr-only" role="status">{feedback}</span>}
  </span>;
}
