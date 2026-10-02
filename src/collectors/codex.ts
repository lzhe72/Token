import type { LineContext, ParsedLine, ParserState, UsageFact } from './types';
import { nonempty, record, tokenCount, validTimestamp } from './types';

function trimTurnModels(state: ParserState): void {
  const map = state.turnModels ?? {};
  const keys = Object.keys(map);
  for (const key of keys.slice(0, Math.max(0, keys.length - 200))) delete map[key];
  state.turnModels = map;
}

function usageFact(
  usage: Record<string, unknown>,
  sourceKey: string,
  timestamp: string,
  sessionId: string,
  model: string,
  state: ParserState,
  context: LineContext
): UsageFact {
  if (usage.input_tokens === undefined || usage.output_tokens === undefined) throw new Error('Codex 用量字段缺失');
  const inputTokens = tokenCount(usage.input_tokens);
  const outputTokens = tokenCount(usage.output_tokens);
  return {
    sourceKey,
    provider: 'codex',
    sourceIdentityKey: state.identityKey ?? context.fallbackIdentityKey,
    sourceIdentityLabel: state.identityLabel ?? 'Codex · 本机账户',
    sessionId,
    model,
    occurredAt: timestamp,
    inputTokens,
    outputTokens,
    cacheReadTokens: tokenCount(usage.cached_input_tokens),
    cacheCreationTokens: tokenCount(usage.cache_write_input_tokens),
    totalTokens: tokenCount(usage.total_tokens) || inputTokens + outputTokens
  };
}

export function parseCodexLine(value: unknown, state: ParserState, context: LineContext): ParsedLine {
  const line = record(value);
  if (!line) return {};
  const payload = record(line.payload);
  if (!payload) return {};
  const type = line.type;
  if (type === 'session_meta') {
    state.sessionId = nonempty(payload.session_id, nonempty(payload.id, context.fileKey));
    const accountId = typeof payload.creator_account_id === 'string' ? payload.creator_account_id : '';
    if (accountId) {
      state.identityKey = `codex:account:${accountId}`;
      state.identityLabel = `Codex 账户 · ${accountId.slice(-6)}`;
    }
    return {};
  }
  if (type === 'turn_context') {
    const turnId = typeof payload.turn_id === 'string' ? payload.turn_id : '';
    const model = typeof payload.model === 'string' ? payload.model : '';
    if (model) {
      state.currentModel = model;
      if (turnId) {
        state.turnModels ??= {};
        state.turnModels[turnId] = model;
        trimTurnModels(state);
      }
    }
    return {};
  }
  const timestamp = validTimestamp(line.timestamp);
  if (!timestamp) return {};
  if (type === 'token_usage_record') {
    const usage = record(payload.usage);
    if (!usage) return {};
    state.hasUsageRecords = true;
    const sessionId = nonempty(payload.session_id, state.sessionId ?? context.fileKey);
    const responseId = nonempty(payload.response_id, `${context.fileKey}:${context.lineOffset}`);
    const turnId = typeof payload.turn_id === 'string' ? payload.turn_id : '';
    const model = (turnId && state.turnModels?.[turnId]) || state.currentModel || '未知模型';
    return { fact: usageFact(usage, `codex:${sessionId}:${responseId}`, timestamp, sessionId, model, state, context) };
  }
  if (type === 'event_msg' && payload.type === 'token_count') {
    const info = record(payload.info);
    const usage = info && record(info.last_token_usage);
    if (!usage) return {};
    const sessionId = state.sessionId ?? context.fileKey;
    return {
      fallback: usageFact(
        usage,
        `codex:fallback:${sessionId}:${context.lineOffset}`,
        timestamp,
        sessionId,
        state.currentModel ?? '未知模型',
        state,
        context
      )
    };
  }
  return {};
}
