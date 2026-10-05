import { defineConfig, devices } from '@playwright/test';

/**
 * One headless Chromium worker: the spec boots its own page server and a
 * vitrinka stub per run (see e2e/recorder.spec.ts), so nothing external is
 * needed. `bun run test:e2e:web` from the repo root.
 */
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], headless: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
