import type { Granularity } from '../shared/types';

const units = ['', 'K', 'M', 'P'] as const;

export function formatTokens(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return '未知';
  let amount = value;
  let level = 0;
  while (amount >= 1024 && level < units.length - 1) {
    amount /= 1024;
    level++;
  }
  if (level === 0) return amount.toLocaleString('zh-CN');
  return `${amount.toLocaleString('zh-CN', { maximumFractionDigits: amount < 10 ? 2 : 1 })} ${units[level]}`;
}

export function formatPeriodLabel(period: string, granularity: Granularity): string {
  if (granularity !== 'week') return period;
  const match = /^(\d{4})-W(\d{2})$/.exec(period);
  if (!match) return period;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return period;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() || 7) + 1 + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}
