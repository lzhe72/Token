import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ParserState } from './types';

// Only a stable digest and a display name leave the parser. Raw paths never enter facts or uploads.
export function rememberProject(state: ParserState, value: unknown): void {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 4096) return;
  const normalized = path.normalize(value).replace(/\/$/, '') || '/';
  state.projectKey = createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  const name = path.basename(normalized) || '/';
  const parent = path.basename(path.dirname(normalized)) || '/';
  state.projectLabel = `${name} · ${parent}`;
}
