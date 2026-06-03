import { defineConfig, devices } from '@playwright/test'

// Staging Playwright config — runs the same product-flow contract suite
// against https://staging.levelchannel.ru. Used by the GH Actions
// `staging-e2e.yml` workflow after a promote lands. Does NOT spawn a
// local Next server — staging is a real deployed app.
//
// Source of truth: evals/PRODUCT_FLOWS.md + URL_REDIRECT_CONTRACT.md.
// The contract is the same; the URL is different.

const BASE_URL =
  process.env.PLAYWRIGHT_STAGING_BASE_URL ?? 'https://staging.levelchannel.ru'

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /staging-flows\.spec\.ts$/,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    extraHTTPHeaders: {
      // Surface CI runs in nginx access logs so the operator can spot
      // automated traffic separately from manual QA.
      'X-Lc-Test-Source': 'gh-actions-staging-e2e',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // No webServer block — staging is already deployed.
})
