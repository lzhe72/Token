import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build'], {
  stdio: 'inherit'
});

await Promise.all([
  build({
    entryPoints: ['src/main/index.ts'],
    outfile: 'dist/main.cjs',
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    external: ['electron', 'sql.js/dist/sql-asm.js']
  }),
  build({
    entryPoints: ['src/preload/index.ts'],
    outfile: 'dist/preload.cjs',
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    external: ['electron']
  })
]);
