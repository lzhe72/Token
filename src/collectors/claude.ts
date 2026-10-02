import type { LineContext, ParsedLine, ParserState, UsageFact } from './types';
import { nonempty, record, tokenCount, validTimestamp } from './types';

export function parseClaudeLine(value: unknown, state: ParserState, context: LineContext): ParsedLine {
  const line = record(value);
  if (!line || line.type !== 'assistant') return {};
  const message = record(line.message);
  const usage = message && record(message.usage);
  const timestamp = validTimestamp(line.timestamp);
  if (!message || !usage || !timestamp) return {};
  const sessionId = nonempty(line.sessionId, context.fileKey);
  state.sessionId = sessionId;
  const model = nonempty(message.model, '未知模型');
  const requestId = nonempty(line.requestId, nonempty(message.id, nonempty(line.uuid, `${context.fileKey}:${context.lineOffset}`)));
  const inputTokens = tokenCount(usage.input_tokens);
  const outputTokens = tokenCount(usage.output_tokens);
  const cacheReadTokens = tokenCount(usage.cache_read_input_tokens);
  const cacheCreationTokens = tokenCount(usage.cache_creation_input_tokens);
  const fact: UsageFact = {
    sourceKey: `claude:${sessionId}:${requestId}`,
    provider: 'claude',
    sourceIdentityKey: context.fallbackIdentityKey,
    sourceIdentityLabel: 'Claude Code · 本机账户',
    sessionId,
    model,
    occurredAt: timestamp,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
  };
  return { fact };
}
