import type { Provider } from '../shared/types';
export type { Provider } from '../shared/types';

export interface UsageFact {
  sourceKey: string;
  provider: Provider;
  sourceIdentityKey: string;
  sourceIdentityLabel: string;
  sessionId: string;
  model: string;
  occurredAt: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  projectKey?: string;
  projectLabel?: string;
}

export interface ParserState {
  projectKey?: string;
  projectLabel?: string;
  sessionId?: string;
  identityKey?: string;
  identityLabel?: string;
  currentModel?: string;
  turnModels?: Record<string, string>;
  hasUsageRecords?: boolean;
  skippingOversized?: boolean;
  malformedRecords?: number;
  oversizedRecords?: number;
}

export interface ParsedLine {
  fact?: UsageFact;
  fallback?: UsageFact;
}

export interface LineContext {
  fileKey: string;
  lineOffset: number;
  fallbackIdentityKey: string;
}

export function tokenCount(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error('Token 用量字段无效');
}

export function validTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function nonempty(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
