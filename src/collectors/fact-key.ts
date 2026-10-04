import { createHash } from 'node:crypto';

// Keep the source class prefix for report/reconciliation queries, but scope the
// event identity to the source that produced it. Never put raw account IDs in a
// fact key exposed to diagnostic queries.
export function scopedLocalFactKey(legacyKey: string, identity: string): string {
  if (legacyKey.startsWith('codex:v2:') || legacyKey.startsWith('codex:fallback:v2:') ||
      legacyKey.startsWith('claude:v2:')) return legacyKey;
  const scope = createHash('sha256').update(identity).digest('hex').slice(0, 24);
  if (legacyKey.startsWith('codex:fallback:')) return `codex:fallback:v2:${scope}:${legacyKey.slice(15)}`;
  if (legacyKey.startsWith('codex:')) return `codex:v2:${scope}:${legacyKey.slice(6)}`;
  if (legacyKey.startsWith('claude:')) return `claude:v2:${scope}:${legacyKey.slice(7)}`;
  throw new Error('无法识别本机事实键');
}

// Birth time distinguishes a newly created file that reuses a deleted file's
// inode; unlike the path it remains stable when the same file is renamed.
export function claudeFileKey(uid: number, fileId: string, birthtimeMs: number): string | null {
  if (!Number.isFinite(birthtimeMs) || birthtimeMs <= 0) return null;
  return createHash('sha256').update(JSON.stringify([uid, fileId, birthtimeMs])).digest('hex').slice(0, 24);
}
