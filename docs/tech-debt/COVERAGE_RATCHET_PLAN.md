# Coverage Ratchet Plan

> Gradual expansion of `vitest.config.ts` coverage threshold protection across
> the load-bearing `lib/` modules.
> Status: **plan only** — no code changes in the PR that created this file.

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

1. **Measure** current per-file coverage with `npm run test:coverage`.
2. **Pin** the threshold a few points *below* the measured value (5-10 pt
   buffer absorbs normal churn).
3. **Raise** thresholds in follow-up PRs once tests stabilize at higher coverage.
4. **Never** add a module to the threshold list and then weaken tests to satisfy it.

Failing this loop = unrelated PRs blocked by coverage drops they did not cause.

## Priority order (gradual rollout)

Order chosen by money-adjacency × pre-existing test density × file count.
Each row is a separate PR. Do **not** bundle.

### Phase 1 — `lib/billing/**`

**Files:** `lib/billing/{package-grant,consumption,reversals,packages,teacher-grant,teacher-subscription,learner-payment-method}.ts` + sub-directories.

**Acceptance criteria:**

- All files added to `vitest.config.ts coverage.include`.
- Threshold floor per file: minimum 70 lines / 80 functions / 65 branches / 70 statements (below measured value to absorb churn).
- All file-level integration tests still pass.
- New unit tests added only where there's a clear gap; do NOT manufacture tests to hit the floor.

**Risk:** money-adjacent. PR must carry `Codex-Paranoia: SIGN-OFF` per `docs/critical-path.md` since `package-grant.ts`, `consumption.ts`, `reversals.ts`, `teacher-grant.ts` are critical-path entries.

### Phase 2 — `lib/scheduling/slots/**`

**Files:** `lib/scheduling/slots/{booking,mutations-cancel,mutations,lifecycle}.ts`.

**Acceptance criteria:**

- Same floor pattern (70/80/65/70).
- Note: `lib/scheduling/slots/booking.ts` and `lib/scheduling/slots/mutations-cancel.ts` are critical-path; PR requires SIGN-OFF.

### Phase 3 — `lib/calendar/**`

**Files:** `lib/calendar/{pull-runner,pull-worker,derive-status,integrations}.ts` + Google subdir.

**Acceptance criteria:**

- Same floor pattern.
- `lib/calendar/pull-runner.ts` and `lib/calendar/pull-worker.ts` are critical-path.

### Phase 4 — `lib/teacher-ledger/**`

**Files:** `lib/teacher-ledger/{mark-lesson-completed,settle-lessons}.ts`.

**Acceptance criteria:**

- Same floor pattern.
- Both files are critical-path (SaaS-pivot Day 5).

### Phase 5 — `lib/audit/**`

**Files:** `lib/audit/{payment-events,pool}.ts`.

**Acceptance criteria:**

- Same floor pattern.
- `lib/audit/payment-events.ts` is critical-path.

### Phase 6 — `lib/admin/**`

**Files:** `lib/admin/{operator-settings,conflict-feed,teacher-telegram-summary}.ts` + sub-directories.

**Acceptance criteria:**

- Same floor pattern.
- `lib/admin/operator-settings.ts` is critical-path.

## How to ratchet safely (concrete steps per PR)

1. Branch: `chore/coverage-ratchet-{module}`.
2. Run `npm run test:coverage` on `main` HEAD. Note per-file numbers in the PR body.
3. Add files to `vitest.config.ts coverage.include` list.
4. Pin thresholds **a few points below** measured.
5. If any file is below 60 on any metric — DO NOT add it to the list yet. Open a
   `tech-debt/test-gap-{file}.md` plan instead.
6. Run `npm run test:coverage` locally to confirm pass under the new threshold.
7. Commit + PR. Trailer: `Skill-Used: chore-coverage` (+ `Codex-Paranoia: SIGN-OFF`
   if critical-path file was touched in `vitest.config.ts`; touching the config
   itself does not require SIGN-OFF, but the proxy effect on critical-path files
   means safer to run the loop).

## Suggested future GitHub issues

When this plan is acted on, open one issue per phase:

- `Phase 1 — Coverage threshold expansion: lib/billing/**`
- `Phase 2 — Coverage threshold expansion: lib/scheduling/slots/**`
- `Phase 3 — Coverage threshold expansion: lib/calendar/**`
- `Phase 4 — Coverage threshold expansion: lib/teacher-ledger/**`
- `Phase 5 — Coverage threshold expansion: lib/audit/**`
- `Phase 6 — Coverage threshold expansion: lib/admin/**`

Each issue body should link back to this plan.

## What this plan is NOT

- Not a mandate to write tests for every untested branch — only to **protect**
  existing tested coverage from silent regression.
- Not a mutation-testing plan (separate concern; out of scope here).
- Not a property-based testing plan.
- Not a code-quality refactor mandate.

## Owner

This plan is updated as each phase ships. Status field on each phase row:

- `pending` — not started
- `in progress` — PR open
- `shipped (PR #NNN)` — merged

Initial state: all phases `pending`.
