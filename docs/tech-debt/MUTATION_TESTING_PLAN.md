# Mutation Testing Plan

> P0 #2 from the AI-assisted maturity audit (see docs/staging-setup.md
> §"Maturity bump").
> Status: **Phase 1 MVP shipped 2026-06-04**. Stryker installed +
> configured + gated by `.github/workflows/mutation-test.yml` on the
> 7 highest-leverage money/auth/security unit-tested files.

## Why this exists

The audit identified that coverage thresholds protect against tests
disappearing, but they DON'T protect against tests that pass when the
production code is wrong. A test like:

```ts
it('rejects unauthorized request', async () => {
  const res = await handler(unauthRequest)
  expect(res.status).toBeGreaterThan(0)  // passes for 200, 401, 500…
})
```

would pass against any non-zero status, including a regression that
quietly returns 200 for an unauthorized request.

Mutation testing fills that gap. Stryker corrupts the production code
in many small ways (flip `<` to `<=`, swap `+`/`-`, remove a `throw`,
flip `!=` to `==`) and asserts that the test suite catches each
corruption. A **surviving mutant** means the test on that line is
silently weak.

## How to read a Stryker report

After every CI run, the mutation report uploads as an artifact:
`mutation-report-<run-id>` from `reports/mutation/`. Open
`index.html` in the artifact for a per-line view.

| Mutant tag | Meaning |
|---|---|
| **Killed** | A test caught the mutation. Healthy. |
| **Survived** | The mutation was made and ALL tests still passed. The line under the mutation is silently undertested. |
| **No coverage** | The mutated line is never executed by any test. (Coverage threshold is the layer that should catch this — but mutation testing surfaces it cross-checking.) |
| **Timeout** | The mutation produced an infinite loop or hang. Usually a real regression — count as killed. |
| **Compile error** | The mutation produced invalid TypeScript. Ignore. |
| **Runtime error** | The mutation produced a non-test runtime error (e.g. import-time `throw`). Count as killed. |

A "mutation score" is `killed / (killed + survived) * 100`. Stryker
config sets:
- `thresholds.high: 80` — display in green
- `thresholds.low: 60` — display in yellow
- `thresholds.break: 50` — CI fails below this

## Phase 1 — money + auth + security unit-tested (shipped 2026-06-04)

The first wave is narrow on purpose: pick files that already have
strong unit-test coverage (per `vitest.config.ts coverage.include`)
and that handle money / auth / security boundaries. This keeps the
first CI run under the 15-minute wall-clock budget and produces
signal that's directly actionable.

Mutated files (see `stryker.config.mjs`):

- `lib/payments/cloudpayments-api.ts` — CloudPayments API client +
  signature verification helpers.
- `lib/payments/cloudpayments-webhook.ts` — Inbound webhook payload
  parsing + HMAC check.
- `lib/payments/tokens.ts` — CloudPayments card token storage +
  redaction.
- `lib/auth/password.ts` — Password hashing + verify (bcrypt/scrypt
  wrapper).
- `lib/auth/tokens.ts` — Email-verify + password-reset token gen +
  HMAC validation.
- `lib/security/rate-limit.ts` — Token-bucket rate limiter for auth
  routes.
- `lib/security/idempotency.ts` — Idempotency-key dedup for
  payment-side handlers.

These 7 files combined produce ~600 mutants on the first run. At
~3-5 seconds per mutant under the `command` runner (one vitest reboot
per mutant), wall-clock is ~10-15 minutes.

### Test runner choice

Stryker can drive Vitest via two runners:

1. **`vitest` runner** (in-process). Faster (no reboot per mutant)
   but requires Vitest's `--related` mode to discover test files
   that import the mutated source. Our tests import via TS path
   aliases (`@/lib/...`); Vitest's related-file resolver does not
   chase the `tsconfigPaths` plugin and reports "no related tests"
   even when explicit imports exist (verified 2026-06-04 locally).
   Setting `vitest.related: false` falls back to "run the full
   suite per mutant", which the runner does NOT do — it instead
   errors with `No tests were found`.

2. **`command` runner**. Stryker copies the project to a sandbox,
   replaces the source-under-test with a mutated version, then runs
   the user-supplied command. We use `npm run test:run` (plain
   `vitest run`). Slower per mutant (each iteration reboots vitest
   end-to-end) but reliable.

Phase 1 uses the **command runner**. Future ratchet: revisit the
vitest runner when Stryker / vitest-runner adds first-class
tsconfigPaths support.

## Phase 2 — integration-test-driven modules (next epic)

`lib/billing/**` is the highest-value remaining money module, but
it's covered by INTEGRATION tests (live Postgres + advisory-lock
scenarios), not unit tests. Mutation testing against integration
suites is a separate setup:

- Postgres service in CI (already present in
  `integration-tests.yml`).
- Stryker `commandRunner.command: 'bash scripts/test-integration.sh'`
  or similar, against the integration vitest config.
- Per-mutant wall-clock is ~30-60s (full integration suite), so
  Phase 2 will run **only weekly** by default, not per-PR.

Pre-requisites:
- Phase 1 stable (no false-positive mutants for >2 weeks).
- A clear "what's actually money-load-bearing" inventory of
  lib/billing files. (Probably: `consumption.ts`,
  `package-grant.ts`, `paid-state.ts`, `refund-reconcile.ts`,
  `teacher-grant.ts`.)

## Phase 3+ — broader sweep

After Phase 2 stabilises, expand by module:

- `lib/scheduling/slots/**` (booking + cancel mutations) — Phase 3.
- `lib/calendar/pull-*.ts` — Phase 4.
- `lib/audit/**` — Phase 5.
- `lib/admin/**` — Phase 6.

Each phase ships as its own PR with measured per-module mutation
score, threshold floors pinned conservatively (mirrors the coverage
ratchet pattern).

## How to ratchet safely (per PR)

1. Branch: `chore/mutation-{phase}-{module}`.
2. Add the new mutate paths to `stryker.config.mjs:mutate`.
3. Add the same paths to the `paths:` filter in
   `.github/workflows/mutation-test.yml` so PRs that touch them
   trigger the workflow.
4. Run `npm run test:mutation` locally once to confirm the run
   completes within the 30-minute CI cap.
5. Note the measured mutation score in the PR body.
6. Pin per-module thresholds in `stryker.config.mjs` if applicable.
7. Commit + PR. Trailer: `Skill-Used: chore-mutation` +
   `Codex-Paranoia: SUB-WAVE self-reviewed` if the source-under-
   mutation file is actually modified, not just added to the
   mutate list.

## What this plan is NOT

- Not a property-based testing plan. Property testing
  (fast-check / hypothesis-style) is a separate concern; out of
  scope here.
- Not a 100% mutation-score mandate. The break threshold (50) is
  intentionally low to avoid CI thrash. Raise via ratchet PRs as the
  test suite catches more mutants.
- Not a refactor mandate. Surviving mutants surface tests to
  strengthen; they do not imply the production code is wrong.

## Maturity bump

The audit's `Test depth / mutation testing` dimension was 0/5 (no
mutation testing) before this PR. Phase 1 moves it to ~2/5:
narrow scope, real CI gating, weekly cron. Phase 2 (billing
integration) → ~3.0/5. Phases 3-6 → ~3.5/5. A full lib/ sweep
plus property-based tests for the slot-scheduler invariants →
~4.0+/5.
