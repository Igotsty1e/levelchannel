# Audit findings — 2026-05-17 wave

> **Extracted from `ENGINEERING_BACKLOG.md` 2026-05-19 (DOC-SPLIT task).** Closed wave; preserved here for audit trail.

Three parallel sub-agent audits (code quality / documentation / security) on current main. Findings consolidated below as new backlog items. Each tagged with severity, owner doc/file, suggested action, estimated effort. None are correctness blockers shipping today; codebase is operationally strong. These are completion gaps, doc drift, and hardening refinements.

## Security findings (HIGH priority)

- ~~**AUDIT-SEC-1 (HIGH)**~~ — **CLOSED 2026-05-17.** Phase B null-out applied on prod via `scripts/null-plaintext-audit-pii.mjs --execute --confirm`. Sequence: prior Phase B left a stale snapshot blocking re-run; verified 18 prior-nulled rows decrypt cleanly under current `AUDIT_ENCRYPTION_KEY`; user authorized dropping the stale `payment_audit_events_pre_phase_b` snapshot; backfill caught 1 plaintext-only row (added since prior Phase B); fresh Phase B nulled all 32 rows (snapshot retained ≥7 days for rollback). Encryption-at-rest claim now holds across full `payment_audit_events`.
- ~~**AUDIT-SEC-2 (HIGH)**~~ — **Closed 2026-05-17** (PR #259). `scripts/rotate-calendar-encryption.mjs` ships mirroring `rotate-audit-encryption.mjs`; runbook documents the four-column rotation contract.
- ~~**AUDIT-SEC-3 (HIGH)**~~ — **Closed 2026-05-17** (PR #257). `requireLearnerArchetypeAndVerified` aligned with canonical `LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL`; 6 integration tests pin the `scheduled_purge_at` / `purged_at` deletion-grace cases.
- **AUDIT-SEC-4 (MEDIUM) — DONE 2026-05-17.** Migration 0054 added bytea `channel_token_enc`. Dual-write in `lib/calendar/channel-renewer.ts setupChannelForIntegration` with top-of-function fail-closed guard (key+schema preflight before any external Google call); decrypt-aware read in `app/api/calendar/google/webhook/route.ts` with plaintext fallback for legacy rows. Rotation script + runbook updated to four columns. Phase B null-out via `scripts/null-plaintext-channel-token.mjs` (operator, post-rollback-window). 3-round paranoia plan-mode loop SIGN-OFF + post-loop runbook syntax fix per R3 BLOCKER #1.

## Code-quality findings (HIGH priority)

- ~~**AUDIT-CODE-1 (HIGH)**~~ — **Closed 2026-05-17** (PR #255). `withIdempotency` wired on `POST /api/admin/accounts/[id]/disable` + `/role` + `/postpaid`; 13 integration cases in `tests/integration/admin/accounts-mutations.test.ts`.
- ~~**AUDIT-CODE-2 (HIGH)**~~ — **Closed 2026-05-17** (PR #254). Env preflight now runs BEFORE `withIdempotency` on test-send route; 422 cache poisoning fixed; regression test pins the contract.
- ~~**AUDIT-CODE-3 (MEDIUM)**~~ — **Closed 2026-05-17** (PR #261). `isUndefinedTableError` extracted to `lib/db/errors.ts` along with `ERR_UNIQUE_VIOLATION` / `ERR_FOREIGN_KEY_VIOLATION` / `ERR_CHECK_VIOLATION` siblings; consumers in `lib/admin/probe-status.ts`, `lib/admin/operator-settings.ts`, route file all import from one source.
- ~~**AUDIT-CODE-4 (MEDIUM)**~~ — **Closed 2026-05-17** (PR #266). `useUnknownInCatchVariables` enabled in `tsconfig.json`; all catch-blocks repo-wide now narrow via `instanceof Error` guards (compile-time enforcement).
- ~~**AUDIT-CODE-5 (MEDIUM)**~~ — **Closed-as-already-done 2026-05-17 (PR #255).** `tests/integration/admin/accounts-mutations.test.ts` covers all three admin account routes (disable, role, postpaid) with 13 cases including anon/non-admin/self-disable/role-flip/postpaid-on-off/idempotency. Created alongside AUDIT-CODE-1 wave. No further action.
- ~~**AUDIT-CODE-6 (MEDIUM)**~~ — **Closed 2026-05-17** (PR #267). `tests/integration/billing/learner-buy-end-to-end.test.ts` exercises the full `/cabinet/packages` buy → CloudPayments webhook → `grantPackageToAccount` seam in one transaction; closes the wire-up-gap failure mode.
- ~~**AUDIT-CODE-7 (LOW)**~~ — **Closed-as-already-done 2026-05-17.** `lib/calendar/pull-worker.ts:222-237` already emits the success-side `[pull-worker] conflict detector ok` log with `jobId`/`teacherAccountId`/outcome. Anchor comment carries the `AUDIT-CODE-7 (2026-05-17)` tag. No further action.
- ~~**AUDIT-CODE-8 (LOW)**~~ — **Closed 2026-05-17** (PR #265). `drainPullJobs` now emits per-job structured metrics line (`outcome`, `durationMs`, `jobId`, `teacherAccountId`); success-side observability matches the prior failure-side coverage.

## Documentation findings (MEDIUM priority)

- ~~**AUDIT-DOC-1 (HIGH)**~~ — **Closed 2026-05-17** (PR #264). `ARCHITECTURE.md §API surface map` now covers all 81 routes; missing 33 routes added with one-line responsibility entries.
- ~~**AUDIT-DOC-2 (HIGH)**~~ — **Closed 2026-05-17** (PR #263). `ARCHITECTURE.md §Database Schema (Recent Migrations)` lists 0049–0053 with semantic purpose per new table / column.
- ~~**AUDIT-DOC-3**~~ — **Closed 2026-05-17** (PR #262). PAYMENTS_SETUP.md §Admin-driven package grant теперь ссылается на §Package-buy init вместо дублирования полного `pg_advisory_xact_lock` контракта.
- ~~**AUDIT-DOC-4**~~ — **Closed 2026-05-17** (PR #256). Status headers обновлены на 4 shipped plan docs (pkg-recon, pkg-learner-buy, receipt-3ds-token, alerts-obs).
- ~~**AUDIT-DOC-5**~~ — **Closed-as-already-done.** PAYMENTS_SETUP.md §Receipt-token gate — dual-mode (~line 220) already documents the RECEIPT-3DS-TOKEN session fallback including `chargeWithSavedCard` writing `metadata.accountId`. No action needed.
- ~~**AUDIT-DOC-6 (MEDIUM)**~~ — **Closed 2026-05-17** (PR #263). `docs/public/ROADMAP.md` + `docs/public/ARCHITECTURE.md` refreshed with package catalog, admin grant, alerts observability entries.
- ~~**AUDIT-DOC-7**~~ — **Closed 2026-05-17** (PR #262). SECURITY.md §Auth and account layer теперь имеет sentence about the receipt-token gate's dual-mode (token + session-fallback), pointing at PAYMENTS_SETUP for full contract.
- ~~**AUDIT-DOC-8**~~ — **Closed-as-stale 2026-05-17.** ARCHITECTURE.md already documents `probe_runs` 90d retention (line 179). `slot_admin_actions` table belongs to CONFLICT-FEED epic which is PARKED — premature. Operator-facing private runbook deltas (`docs/private/OPERATIONS.private.md`) are out of public-repo scope.

## Aggregate

Total: 4 SEC + 8 CODE + 8 DOC = 20 actionable items. ~46h of dev work + some operator time. None are correctness blockers shipping today.

**Status 2026-05-17 (audit wave fully closed):** 20/20 items closed across PR #252-#268 + post-merge operator run for AUDIT-SEC-1 (Phase B null-out applied on prod, snapshot retained for the 7-day rollback window).
