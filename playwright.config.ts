import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/playwright',
  timeout: 45_000,
  workers: 1,
  use: { trace: 'retain-on-failure' }
});
