import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function createTestWorkspace(label: string) {
  const safeLabel = label.replace(/[^a-z0-9-]/gi, '-').slice(0, 32);
  const root = mkdtempSync(path.join(tmpdir(), `token-test-db-${safeLabel}-`));
  const databasePath = path.join(root, 'token.sqlite');
  const codexDir = path.join(root, 'codex');
  const claudeDir = path.join(root, 'claude');
  mkdirSync(codexDir);
  mkdirSync(claudeDir);
  return {
    root,
    databasePath,
    codexDir,
    claudeDir,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}
