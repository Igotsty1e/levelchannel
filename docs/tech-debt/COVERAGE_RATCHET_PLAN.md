# Coverage Ratchet Plan

> Gradual expansion of `vitest.config.ts` (unit) AND
> `vitest.integration.config.ts` (integration) coverage threshold protection
> across the load-bearing `lib/` modules.
> Status: **two ratchet passes shipped 2026-06-03** (PR #503 unit, PR #504 integration).
>
> PR #503 (unit): added 9 well-tested files from `lib/calendar/**` and
> `lib/audit/**` to `vitest.config.ts coverage.include`; thresholds
> preserved at 85/95/80/85. Measured: stmts 91.23 / branches 83.88 /
> funcs 99.04 / lines 92.17.
>
> PR #504 (integration): wired a separate integration-coverage signal
> via `vitest.integration.config.ts` + `.github/workflows/integration-
> coverage.yml`. Added 15 critical-path files (billing, scheduling/
> slots, teacher-ledger, audit/payment-events, admin/operator-settings,
> calendar/pull-*) with floors 60/70/50/60 — conservative because the
> integration suite is happy-path-heavy and tests fewer error branches
> than unit suites.

## Why this exists

Today coverage threshold 85/95/80/85 is pinned on **12 files** (`vitest.config.ts`
lines 17-29):

- `lib/payments/{catalog,cloudpayments-api,cloudpayments-webhook,tokens}.ts`
- `lib/security/{rate-limit,idempotency,request}.ts`
- `lib/auth/{password,tokens,policy,email-hash}.ts`
- `lib/email/escape.ts`

The audit (2026-06-02 — see `docs/plans/code-quality-audit-2026-06-02.md` and
the AI-assisted maturity audit) found that load-bearing money / scheduling /
calendar modules **outside this list** can regress silently. Tests exist;
threshold protection does not.

## What "ratcheting" means

For every module added to the threshold list:

1. **Measure** current per-file coverage with `npm run test:coverage`
   (unit) or `npm run test:integration:coverage` (integration).
2. **Pin** the threshold a few points *below* the measured value (5-10 pt
   buffer absorbs normal churn).
3. **Raise** thresholds in follow-up PRs once tests stabilize at higher coverage.
4. **Never** add a module to the threshold list and then weaken tests to satisfy it.

Failing this loop = unrelated PRs blocked by coverage drops they did not cause.

## Priority order (gradual rollout)

Order chosen by money-adjacency × pre-existing test density × file count.
Each row was originally one separate PR; the 2026-06-03 sweep bundled
phases 3+5 (unit, PR #503) and 1+2+4+5+6 partials (integration, PR #504)
into two PRs because the file lists naturally aligned with the two test
configs.

### Phase 1 — `lib/billing/**` — **SHIPPED VIA INTEGRATION COVERAGE 2026-06-03 (PR #504)**

Moved to `vitest.integration.config.ts coverage.include` because the
critical-path billing files are exclusively exercised by integration tests
against real Postgres. Adding them to `vitest.config.ts` (unit) would
show 0% — unit tests don't import them.

**Files protected** (integration coverage; floors 60/70/50/60):
- `lib/billing/package-grant.ts` (critical-path)
- `lib/billing/consumption.ts` (critical-path)
- `lib/billing/reversals.ts` (critical-path)
- `lib/billing/packages/eligibility.ts`
- `lib/billing/packages/purchases.ts`
- `lib/billing/teacher-grant.ts` (critical-path)
- `lib/billing/paid-not-granted.ts`
- `lib/billing/paid-state.ts`

**Still pending** (no integration test imports yet):
- `lib/billing/teacher-subscription.ts` — covered partially by saas-pivot tests
- `lib/billing/learner-tariff-access.ts` — has integration test
- `lib/billing/learner-payment-method.ts` — partial unit coverage exists

### Phase 2 — `lib/scheduling/slots/**` — **SHIPPED VIA INTEGRATION COVERAGE 2026-06-03 (PR #504)**

`lib/scheduling/slots.ts` — barrel re-export of the slots module (includes
booking, mutations-cancel, lifecycle indirectly via the surface) — added
to integration coverage with 60/70/50/60 floor.

**Still pending** (will require individually-pinned floors as deeper
behaviour gets tested):
- `lib/scheduling/slots/booking.ts` (critical-path; per-file granular ratchet)
- `lib/scheduling/slots/mutations-cancel.ts` (critical-path; same)
- `lib/scheduling/slots/mutations.ts`
- `lib/scheduling/slots/lifecycle.ts`

### Phase 3 — `lib/calendar/**` — **PARTIALLY SHIPPED 2026-06-03 (PR #503 + #504)**

**PR #503 unit** (covered by existing unit tests, all above floor):
- `lib/calendar/dates.ts` (97/90/100/98)
- `lib/calendar/encryption.ts` (96/96/100/100)
- `lib/calendar/grid-keyboard.ts` (100/96/100/100)
- `lib/calendar/view-model.ts` (98/92/100/100)
- `lib/calendar/google/config.ts` (91/85/100/100)
- `lib/calendar/google/push.ts` (84/60/100/85)
- `lib/calendar/google/state.ts` (88/76/100/90)

**PR #504 integration** (critical-path pull surface):
- `lib/calendar/pull-runner.ts` — critical-path
- `lib/calendar/pull-worker.ts` — critical-path

**Still pending**:
- `lib/calendar/integrations.ts`
- `lib/calendar/channel-renewer.ts`
- `lib/calendar/orphan-cleanup.ts`
- `lib/calendar/derive-status.ts` (no direct unit test; uses status enum)

### Phase 4 — `lib/teacher-ledger/**` — **SHIPPED VIA INTEGRATION COVERAGE 2026-06-03 (PR #504)**

Both critical-path files added to integration coverage with 60/70/50/60
floor:
- `lib/teacher-ledger/mark-lesson-completed.ts` (critical-path; SaaS-pivot Day 5A)
- `lib/teacher-ledger/settle-lessons.ts` (critical-path; SaaS-pivot Day 5B)

### Phase 5 — `lib/audit/**` — **MOSTLY SHIPPED 2026-06-03 (PR #503 + #504)**

**PR #503 unit**:
- `lib/audit/auth-events.ts` (100/91/100/100)
- `lib/audit/encryption.ts` (96/93/100/100)

**PR #504 integration**:
- `lib/audit/payment-events.ts` — critical-path

**Still pending**:
- `lib/audit/pool.ts` — connection helper; no behaviour to unit-test.

### Phase 6 — `lib/admin/**` — **PARTIALLY SHIPPED 2026-06-03 (PR #503 + #504)**

**PR #503 unit**:
- `lib/admin/dashboard.ts`
- `lib/admin/probe-status.ts`

**PR #504 integration**:
- `lib/admin/operator-settings.ts` (critical-path)

**Still pending**:
- `lib/admin/conflict-feed.ts` (critical-path; partial integration)
- `lib/admin/teacher-telegram-summary.ts`

## How to ratchet safely (concrete steps per PR)

1. Branch: `chore/coverage-ratchet-{module}`.
2. Run `npm run test:coverage` (unit) or `npm run test:integration:coverage`
   (integration) on `main` HEAD. Note per-file numbers in the PR body.
3. Add files to the right `coverage.include` list (unit → `vitest.config.ts`;
   integration → `vitest.integration.config.ts`).
4. Pin thresholds **a few points below** measured.
5. If any file is below 60 on any metric — DO NOT add it to the list yet. Open a
   `tech-debt/test-gap-{file}.md` plan instead.
6. Run the relevant `*:coverage` command locally to confirm pass under the new
   threshold.
7. Commit + PR. Trailer: `Skill-Used: chore-coverage` (+ `Codex-Paranoia: SIGN-OFF`
   if critical-path file is actually MODIFIED, not just added to a coverage
   include list).

## What this plan is NOT

- Not a mandate to write tests for every untested branch — only to **protect**
  existing tested coverage from silent regression.
- Not a mutation-testing plan — mutation testing lives in
  `docs/tech-debt/MUTATION_TESTING_PLAN.md` (Phase 1 shipped
  2026-06-04).
- Not a property-based testing plan.
- Not a code-quality refactor mandate.

## State as of 2026-06-03 (after PR #503 + PR #504)

- Phase 1 (lib/billing) — `shipped via integration coverage (PR #504)`;
  8 of ~11 files protected
- Phase 2 (lib/scheduling/slots) — `shipped via integration coverage (PR #504)`;
  barrel module protected; per-file granularity is a follow-up ratchet
- Phase 3 (lib/calendar) — `partially shipped`; 7 unit (PR #503) + 2 integration
  (pull-runner, pull-worker) (PR #504)
- Phase 4 (lib/teacher-ledger) — `shipped via integration coverage (PR #504)`;
  both critical-path files protected
- Phase 5 (lib/audit) — `mostly shipped`; 2 unit (PR #503) + 1 integration
  (payment-events) (PR #504); pool.ts has no behaviour to test
- Phase 6 (lib/admin) — `partially shipped`; 2 unit (PR #503) + 1 integration
  (operator-settings) (PR #504); conflict-feed + teacher-telegram-summary remain

The integration-coverage signal lives in `.github/workflows/integration-
coverage.yml` and runs every PR + push to main. Threshold floors are
intentionally conservative (60/70/50/60) since the integration suite
exercises happy-path money flows extensively but tests fewer error
branches than unit suites typically aim for. Raise the floors in follow-
up ratchet PRs as branch coverage stabilises.
