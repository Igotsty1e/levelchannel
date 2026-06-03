import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/integration/**', 'node_modules/**'],
    setupFiles: ['tests/setup-env.ts', 'tests/setup-rtl.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Coverage protection scope. Started as 12 files (payments + security +
      // auth + email/escape); ratcheted 2026-06-03 to add unit-tested helpers
      // from the 4 modules where unit tests already produce solid coverage:
      //   - lib/calendar/*           (dates, encryption, grid, view-model, google/*)
      //   - lib/audit/*              (auth-events, encryption)
      //
      // Files in lib/billing/**, lib/scheduling/slots/**, lib/teacher-ledger/**,
      // lib/admin/** are integration-tested (real Postgres + advisory locks);
      // adding them here would either show 0% (file not loaded by units)
      // or pull thresholds down. Those modules are tracked separately in
      // docs/tech-debt/COVERAGE_RATCHET_PLAN.md for follow-up PRs that
      // measure + lock floors per file.
      include: [
        // Original phase 0 (payments + security + auth + email)
        'lib/payments/catalog.ts',
        'lib/payments/cloudpayments-api.ts',
        'lib/payments/cloudpayments-webhook.ts',
        'lib/payments/tokens.ts',
        'lib/security/rate-limit.ts',
        'lib/security/idempotency.ts',
        'lib/security/request.ts',
        'lib/auth/password.ts',
        'lib/auth/tokens.ts',
        'lib/auth/policy.ts',
        'lib/auth/email-hash.ts',
        'lib/email/escape.ts',
        // Phase 3 — lib/calendar/*  unit-tested helpers
        'lib/calendar/dates.ts',
        'lib/calendar/encryption.ts',
        'lib/calendar/grid-keyboard.ts',
        'lib/calendar/view-model.ts',
        'lib/calendar/google/config.ts',
        'lib/calendar/google/push.ts',
        'lib/calendar/google/state.ts',
        // Phase 5 — lib/audit/*
        'lib/audit/auth-events.ts',
        'lib/audit/encryption.ts',
      ],
      // Coverage floors preserved at the original 85/95/80/85 contract.
      // Measured 2026-06-03 with the expanded include list:
      // stmts 91.23 / branches 83.88 / funcs 99.04 / lines 92.17 — every
      // floor met with margin. The weakest individual contributor is
      // calendar/google/push.ts at 60.86% branches; the bundle absorbs
      // it because other 90%+ files dominate the weighted average.
      // Tightening floors further (e.g. branches 82) is a future ratchet.
      thresholds: {
        lines: 85,
        functions: 95,
        branches: 80,
        statements: 85,
      },
    },
  },
})
