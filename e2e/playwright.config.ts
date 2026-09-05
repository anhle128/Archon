import { defineConfig, devices } from '@playwright/test';

/**
 * Functional UI e2e config.
 *
 * No `webServer` block: the app under test is booted per worker by the `archon`
 * fixture (lib/playwright/archon-runtime.ts), which stands up a fully isolated
 * Archon instance (own ARCHON_HOME, own SQLite DB, own port, the env-gated
 * fake AI provider) and injects its URL as `baseURL`. This mirrors the
 * fixture-owns-the-runtime pattern used by the open-design e2e suite.
 */
export default defineConfig({
  testDir: './ui',
  outputDir: './ui/reports/test-results',
  timeout: Number(process.env.ARCHON_PW_TIMEOUT) || 60_000,
  retries: process.env.CI ? 1 : 0,
  // Each worker boots its OWN isolated Archon instance on its own port, so the
  // suite is safe to parallelize; default 1 keeps the first scaffold simple.
  workers: Number(process.env.ARCHON_PW_WORKERS) || 1,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [
        ['github'],
        ['list'],
        ['html', { open: 'never', outputFolder: './ui/reports/playwright-html-report' }],
        ['json', { outputFile: './ui/reports/results.json' }],
        ['junit', { outputFile: './ui/reports/junit.xml' }],
      ]
    : [
        ['list'],
        ['html', { open: 'never', outputFolder: './ui/reports/playwright-html-report' }],
        ['json', { outputFile: './ui/reports/results.json' }],
      ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
