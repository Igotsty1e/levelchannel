import { defineConfig, devices } from '@playwright/test'

// Product-flow Playwright config.
//
// Scope: anonymous + public + role-boundary redirect contracts only. See
// `evals/PRODUCT_FLOWS.md` and `evals/URL_REDIRECT_CONTRACT.md` for what
// the suite asserts. Authenticated cabinet flows are out of scope until
// a session-cookie test fixture lands (tracked in
// `docs/tech-debt/COVERAGE_RATCHET_PLAN.md` — separate concern).
//
// Why chromium-only: catches the regression class we care about (URL
// behavior, redirect behavior, copy presence on shipped routes) without
// the cost of firefox + webkit installs. Cross-browser layout drift is
// a different problem out of scope for v1 of this harness.

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100)
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts/,
  // staging-flows.spec.ts runs against the deployed staging URL via its
  // own playwright.config.staging.ts. Exclude it from the default
  // local/CI run that spins up a fresh Next server (which reports
  // environment=prod by default and breaks STAGING-HEALTH-001).
  testIgnore: ['**/staging-flows.spec.ts'],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 5_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : {
        command: `next start --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
        env: {
          // Minimal env to let `next start` boot without throwing on
          // optional integrations. Real values come from the operator
          // env store in production; CI mirrors this set for the
          // build-check workflow already (NEXT_PUBLIC_LEGAL_*).
          NEXT_PUBLIC_SITE_URL: BASE_URL,
          NEXT_PUBLIC_LEGAL_OPERATOR_NAME: 'ci-placeholder',
          NEXT_PUBLIC_LEGAL_OPERATOR_DISPLAY: 'ci-placeholder',
          NEXT_PUBLIC_LEGAL_OPERATOR_TAX_ID: '000000000000',
          NEXT_PUBLIC_LEGAL_OPERATOR_OGRN: '000000000000000',
          NEXT_PUBLIC_LEGAL_OPERATOR_REG_AUTHORITY: 'ci-placeholder',
          NEXT_PUBLIC_LEGAL_OPERATOR_CLAIMS_ADDRESS: 'ci-placeholder',
          NEXT_PUBLIC_PUBLIC_CONTACT_EMAIL: 'ci@example.invalid',
          NEXT_PUBLIC_LEGAL_BANK_ACCOUNT: '00000000000000000000',
          NEXT_PUBLIC_LEGAL_BANK_NAME: 'ci-placeholder',
          NEXT_PUBLIC_LEGAL_BANK_BIK: '000000000',
          NEXT_PUBLIC_LEGAL_BANK_CORR_ACCOUNT: '00000000000000000000',
          NEXT_PUBLIC_LEGAL_BANK_CITY: 'ci-placeholder',
          // Pass through DATABASE_URL + auth secrets when set (CI sets
          // these against the seeded test PG); when unset, `next start`
          // falls back to whatever the local .env declares and the
          // authenticated suite is skipped by the .fixtures.json guard.
          ...(process.env.DATABASE_URL
            ? { DATABASE_URL: process.env.DATABASE_URL }
            : {}),
          ...(process.env.AUTH_RATE_LIMIT_SECRET
            ? { AUTH_RATE_LIMIT_SECRET: process.env.AUTH_RATE_LIMIT_SECRET }
            : {}),
          ...(process.env.TELEMETRY_HASH_SECRET
            ? { TELEMETRY_HASH_SECRET: process.env.TELEMETRY_HASH_SECRET }
            : {}),
          // 2026-06-18 business-flow e2e: tests/e2e/business-flow-*.spec.ts
          // создают SBP claims через payment-claims endpoint. Mock-режим
          // нужен чтобы payment-gate не звал реальный CloudPayments.
          // ВАЖНО: PAYMENTS_ALLOW_MOCK_CONFIRM=true reject'ится в проде
          // (NODE_ENV=production у next start), поэтому НЕ ставим — нашим
          // тестам confirm не нужен (booking + claim creation работают без).
          PAYMENTS_PROVIDER: 'mock',
          // TEACHER_INVITE_SECRET — required в проде (next start) для
          // /api/teacher/invites. 32+ chars фиксированный fixture.
          TEACHER_INVITE_SECRET:
            'e2e-fixture-invite-secret-must-be-32-chars-minimum',
          // LEARNER_ICS_TOKEN_SECRET тоже required в проде (для cabinet
          // settings/calendar SSR). Fixture-32+chars.
          LEARNER_ICS_TOKEN_SECRET:
            'e2e-fixture-ics-secret-must-be-32-chars-minimum',
        },
      },
})
