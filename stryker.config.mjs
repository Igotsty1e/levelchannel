// Mutation-testing config — P0 #2 from the AI-assisted maturity audit.
//
// Why this exists:
//   Coverage thresholds (vitest.config.ts + vitest.integration.config.ts)
//   protect against tests disappearing. They DON'T protect against tests
//   that pass when the production code is wrong. Mutation testing fills
//   that gap by deliberately corrupting source code (e.g. flipping `<` to
//   `<=`, replacing `+` with `-`, removing a `throw`) and asserting the
//   test suite catches each corruption. A "surviving mutant" means the
//   test suite is silently weak on that line.
//
// Scope (Phase 1):
//   - `lib/payments/**` + `lib/auth/**` + `lib/security/**` files
//     that already have UNIT-level test coverage (vitest.config.ts
//     `coverage.include`). These are money-critical (CloudPayments
//     signature + webhook handling, payment token generation, auth
//     policy + password hashing, rate-limit + idempotency); a silent
//     test gap here is the highest-leverage failure mode the audit
//     surfaced.
//   - `lib/billing/**` is INTEGRATION-test-driven, not unit-tested,
//     so it lives in a future Phase 2 (mutation-testing against
//     `vitest.integration.config.ts`) — tracked in
//     docs/tech-debt/MUTATION_TESTING_PLAN.md.
//
// Runner:
//   - `command` runner that invokes `npm run test:run`. The Stryker
//     Vitest plugin was tried first but failed to discover tests
//     through the project's TS path aliases (`@/lib/...`); see
//     docs/tech-debt/MUTATION_TESTING_PLAN.md §"Test runner choice"
//     for the trade-off analysis.
//
// Performance:
//   - With 7 mutate files and the unit-test suite, a full run takes
//     ~10-15 minutes on CI under concurrency=2. We run it WEEKLY
//     (cron) + on-demand via workflow_dispatch + on PRs that touch
//     the mutate paths. The path filter in
//     .github/workflows/mutation-test.yml keeps unrelated PRs
//     untouched.

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: 'npm',
  testRunner: 'command',
  commandRunner: {
    // Falls back to the project's own `npm test` so the runner has
    // identical setup (env, path aliases, tsconfig) to local dev and
    // CI's unit-tests workflow. The Stryker vitest-runner plugin
    // was tried first but failed to discover tests through the TS
    // path aliases (`@/lib/...`) the project uses — see
    // docs/tech-debt/MUTATION_TESTING_PLAN.md §Phase 1 notes.
    // Trade-off: slower wall-clock per mutant (vitest reboots per
    // run) vs full compatibility with the existing test setup.
    command: 'npm run test:run',
  },
  // Source files to MUTATE. The unit suite stays the same; we just
  // corrupt these files between runs.
  //
  // Phase 1a (shrunk further to 1 file after the 3-file run also
  // CANCELLED at 30 min): the command runner's per-mutant vitest
  // reboot is much heavier on the GHA ubuntu-latest runner than the
  // local-Mac estimate suggested (~15s+ per mutant including the
  // sandbox-replace round-trip; 200+ mutants overruns 30 min).
  //
  // Phase 1a: PROOF-OF-CONCEPT on the smallest money-critical file
  // (token gen + HMAC verification). The 6 deferred files re-enter
  // Phase 1b once we switch the workflow to use a faster runner —
  // tracked as the Phase 1 -> Phase 2 transition in
  // docs/tech-debt/MUTATION_TESTING_PLAN.md. Until that runner
  // upgrade lands, Phase 1 stays at this minimum-viable scope.
  //
  // lib/billing/** is NOT here — it's integration-test driven and
  // lives in a future Phase 2 against the integration vitest config.
  mutate: ['lib/security/rate-limit.ts'],
  // Files / dirs to ignore from the SANDBOX (Stryker copies the
  // project into a temp dir + replaces the source-under-test with a
  // mutated version, then runs `npm test` there). We exclude only
  // the heavy build artefacts; tests/** stays because the sandbox
  // needs to find them.
  ignorePatterns: [
    '**/node_modules/**',
    '**/.next/**',
    '**/.stryker-tmp/**',
    '**/coverage/**',
    '**/dist/**',
    'reports/**',
  ],
  // Quality bar. Thresholds set conservatively to start; raise as
  // the test suite catches more mutants.
  //
  // 2026-06-04 baseline (lib/security/rate-limit.ts): 36.59 % —
  // 30 killed / 52 survived / 82 total. Most survived mutants are
  // log-message format strings + the `__resetRateLimitsForTesting`
  // helper body (legitimately not under test). Surviving branch
  // mutations on the postgres-fallback-to-memory path ARE real test
  // gaps; tracked in docs/tech-debt/MUTATION_TESTING_PLAN.md
  // §"Ratcheting up the Phase 1 break threshold" as the next
  // ratchet PR.
  //
  // `break: 30` reflects the current measured state — anything
  // BELOW 30 is a regression. Each ratchet PR that closes a
  // surviving-mutant class raises this.
  thresholds: {
    high: 80,
    low: 60,
    break: 30,
  },
  // Reporters. `dashboard` can be added later when/if we publish to
  // dashboard.stryker-mutator.io.
  reporters: ['progress', 'clear-text', 'html'],
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  // Conservative concurrency for the GHA ubuntu-latest 4-core runner.
  // Higher values cause swap-thrash on Stryker's per-mutant Vitest
  // boot (each test runner boots its own Node process).
  concurrency: 2,
  // Time budget per mutant. Slower than the vitest --bail default
  // because Stryker's command-runner reboots vitest per mutant.
  timeoutMS: 30_000,
  // Skip Stryker's TypeScript-checker pass on these dirs; we don't
  // need to type-check generated sandboxes / build artefacts.
  disableTypeChecks: '{stryker-tmp/**,.next/**,node_modules/**}',
}

export default config
