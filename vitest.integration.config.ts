import { defineConfig } from 'vitest/config'

// Integration test runner — invoked via scripts/test-integration.sh
// (which provides DATABASE_URL pointing at Docker Postgres). Distinct
// config from vitest.config.ts so unit `npm run test:run` stays fast
// and dependency-free.
//
// Tests live under tests/integration/ and exercise lib/auth/* store ops
// + (later) /api/auth/* route handlers against a real Postgres 16.13.

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    pool: 'forks',
    // All integration test files share one Docker Postgres. Truncate-in-
    // afterEach races across parallel files cause spurious FK violations
    // and lost sessions. Run files sequentially.
    fileParallelism: false,
    testTimeout: 15000,
    // COVERAGE_RATCHET_PLAN.md phases 1/2/4/5/6: the critical-path
    // money/scheduling/teacher-ledger/admin/audit files are exclusively
    // exercised by integration tests against real Postgres. Unit
    // coverage (vitest.config.ts) can't see them. This block measures
    // their coverage from THIS suite so a separate floor can protect
    // regressions on critical-path business logic.
    //
    // Enabled only when `LC_INTEGRATION_COVERAGE=1` is set — the typical
    // local `npm run test:integration` stays fast (v8 instrumentation
    // adds ~30% to runtime). CI runs a dedicated job with the flag set
    // (see .github/workflows/integration-tests.yml).
    ...(process.env.LC_INTEGRATION_COVERAGE === '1'
      ? {
          coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: [
              // Phase 1 — money-moving, advisory-locked
              'lib/billing/package-grant.ts',
              'lib/billing/consumption.ts',
              'lib/billing/reversals.ts',
              'lib/billing/packages/eligibility.ts',
              'lib/billing/packages/purchases.ts',
              'lib/billing/teacher-grant.ts',
              'lib/billing/paid-not-granted.ts',
              'lib/billing/paid-state.ts',
              // Phase 2 — slot booking lifecycle
              'lib/scheduling/slots.ts',
              // Phase 4 — teacher-ledger
              'lib/teacher-ledger/mark-lesson-completed.ts',
              'lib/teacher-ledger/settle-lessons.ts',
              // Phase 5 remainder — payment-events
              'lib/audit/payment-events.ts',
              // Phase 6 — operator settings
              'lib/admin/operator-settings.ts',
              // Phase 3 remainder — pull-runner/pull-worker (calendar
              // integration logic exercised by integration tests).
              'lib/calendar/pull-runner.ts',
              'lib/calendar/pull-worker.ts',
            ],
            // Conservative floors — measured baseline 2026-06-03 against
            // the full integration suite. The integration suite covers
            // happy-path money flows extensively, but error branches
            // (advisory-lock contention, FK race, FOR UPDATE skip) get
            // less coverage than unit suites typically aim for. Pinned
            // ~5pt below measured to absorb churn.
            thresholds: {
              lines: 60,
              functions: 70,
              branches: 50,
              statements: 60,
            },
          },
        }
      : {}),
  },
})
