# Critical-path inventory

**Status:** approved (2026-05-18; product-owner request).
**Scope:** 20 files whose breakage = production incident (money, security, or scheduling integrity). PRs that touch any file in this list MUST land `Codex-Paranoia: SIGN-OFF` (full paranoia loop), NOT `SUB-WAVE self-reviewed`.

## Selection criteria

A file is on this list iff at least one is true:

1. **Money-moving.** A bug stamps an incorrect amount, double-charges, or fails to grant a paid entitlement.
2. **Authoritative security gate.** A bug bypasses a session/admin-role check or lets a user act on data they don't own.
3. **Calendar/booking integrity.** A bug double-books a slot, loses a cancel, or de-syncs against Google.
4. **Audit-log integrity.** A bug rewrites or drops audit history that legal/forensic relies on.

"Production incident" here means: requires operator action to make whole (manual SQL, refund, support contact). Not "a route returns 500" — those are routine.

## The 20

Grouped by failure mode. Each entry: path + the specific invariant it owns.

### Money-moving (8 files)

1. **`app/api/payments/webhooks/cloudpayments/pay/route.ts`** — HMAC-verified webhook receiver. Owns: dispatches `processPackageGrant` / `processSlotGrant` on `metadata.{packageSlug,slotId}`; idempotent on `Idempotency-Key`; updates `payment_orders.status` to `paid`. Wire-up gap here = BCS-F.1-class silent failure.
2. **`app/api/payments/webhooks/cloudpayments/check/route.ts`** — pre-pay check webhook. Owns: returns code 0/100; mis-coding accepts a payment we couldn't have honored.
3. **`app/api/payments/webhooks/cloudpayments/fail/route.ts`** — failed-payment receiver. Owns: writes `webhook.fail.received` audit event; mis-handling masks payment-flow telemetry.
4. **`lib/payments/cloudpayments-webhook.ts`** — HMAC verification + replay-dedup core. Owns: rejects unsigned/replayed payloads. Single source of truth for the webhook security boundary.
5. **`lib/payments/store-postgres.ts`** — `payment_orders` CRUD. Owns: invariant that `paid` status writes never happen without an audit event in the same TX; the `pending → paid` and `paid → refunded` transitions; metadata field shape.
6. **`lib/billing/package-grant.ts`** — `processPackageGrant`. Owns: atomic `package_purchases` + `payment_allocations` insert under `pg-stack:` advisory lock; `paid_not_granted` resolution; idempotent on `payment_order_id`. Money-equivalent grants.
7. **`lib/billing/consumption.ts`** — `consumePackageUnit` (slot booking debits a package). Owns: FIFO selection of active purchases, race-safe consumption row insert keyed on `slot_id`, restore-on-cancel path.
8. **`lib/billing/reversals.ts`** — refund reversals on `payment_allocations`. Owns: full + partial refund accounting; the binary all-or-nothing contract for derived `paid` state.

### Security gates (5 files)

9. **`lib/auth/sessions.ts`** — session lookup + revoke. Owns: `lookupSession` is the predicate every authenticated route relies on; cache invalidation on revoke; cookie-name and TTL constants.
10. **`lib/auth/guards.ts`** — `requireAdminRole` + `requireLearnerArchetypeAndVerified`. Owns: the predicate that gates every `/api/admin/*` route + every `/api/slots/*` write.
11. **`lib/auth/learner-archetype.ts`** — `LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL` predicate. Owns: who can book; aligned with `deletion-guard.ts` and `requireLearnerArchetypeAndVerified` (AUDIT-SEC-3 closure).
12. **`lib/security/idempotency.ts`** — `withIdempotency` middleware. Owns: sequential-only same-key dedup contract (post-merge paranoia rollback PR #258 fixed this — see commit body). Money-moving routes depend on this exact shape.
13. **`lib/security/request.ts`** — `enforceRateLimit` + per-IP / per-account / per-Idempotency-Key buckets. Owns: defense-in-depth on every public endpoint.

### Calendar + scheduling integrity (5 files)

14. **`lib/scheduling/slots/mutations-cancel.ts`** — atomic `cancelLearnerSlot`. Owns: WHERE-clause-as-security-boundary (status='booked' AND start_at - now() >= window AND learner owns); the single-UPDATE TOCTOU-free shape. Plus operator/teacher cancel siblings.
15. **`lib/scheduling/slots/booking.ts`** — `bookSlot`. Owns: atomic UPDATE-with-status='open' re-assert for concurrent-book races; the billing-fast-path / package/postpaid branch; consumption write in the same TX.
16. **`lib/calendar/pull-runner.ts`** — Google Calendar pull. Owns: F8 epoch-aware self-echo detection (own vs foreign event); full-rewrite `teacher_external_busy_intervals` in one TX; `summary_encrypted` pgcrypto write.
17. **`lib/calendar/pull-worker.ts`** — pull-jobs drainer. Owns: dispatches per-calendar pull-runner, wires the post-pull conflict detector (BCS-F.1 wire-up gap closed PR #251), best-effort failure semantics.
18. **`app/api/calendar/google/webhook/route.ts`** — Google push-notification receiver. Owns: constant-time `channel_token` compare (decrypt-aware since AUDIT-SEC-4 PR #268), `channel_id`/`resource_id` match, monotonic `X-Goog-Message-Number` guard.

### Audit-log integrity (2 files)

19. **`lib/audit/payment-events.ts`** + the `levelchannel_audit_writer` INSERT-only role (migration 0029). Owns: every money-moving + 152-FZ-relevant event lands here; trigger blocks UPDATE on event rows (event_kind enum); 3-year retention per `scripts/db-retention-cleanup.mjs`.
20. **`lib/admin/operator-settings.ts`** + `scripts/lib/operator-settings.mjs` (ALERTS-EDITOR PR #272). Owns: DB → env → default resolver chain for operator-tunable thresholds; single-TX write+audit atomicity (no split-pool failure mode); `operator_settings_events` immutability trigger blocks UPDATE but permits 90-day retention DELETE.

## Process gate

PRs that modify any file from this list MUST land with:

```
Codex-Paranoia: SIGN-OFF round N/3
```

NOT `SUB-WAVE self-reviewed`. Even if the change is a sub-PR inside an already-planned epic. Rationale: these files are the load-bearing surface; a single bad commit can take prod down. The cost of one extra `/codex-paranoia wave` run on a single-file diff (~5 min) is far below the cost of a money-moving regression.

Implementation: `scripts/critical-path-check.sh` (TBD) reads this file, parses the paths, and on `pre-push` rejects the push if HEAD touches any of them without the SIGN-OFF trailer. A CI workflow `.github/workflows/critical-path.yml` does the same on the PR commit. Either one alone is sufficient; both together close the local-bypass gap.

The shell guardrail + CI workflow are NOT in this PR — `docs/critical-path.md` ships the inventory first so reviewers can argue with the LIST before the enforcement lands. Follow-up PR wires the guardrail.

## What is NOT on this list

Common false candidates:

- **App pages (`app/cabinet/*`, `app/admin/*`):** breakage shows a 500 to one user. Bad, recoverable.
- **Cron probes (`scripts/*-alert.mjs`):** failure mode is "operator doesn't get paged". Bad, NOT money-moving.
- **Migration files (`migrations/*.sql`):** breakage caught by `npm run migrate:up` in CI before merge. The migration framework is the gate, not individual files.
- **Test files:** zero production impact.
- **Email templates, copy, UI strings:** customer-visible but recoverable in minutes.
- **`tests/integration/setup.ts`:** breakage = no CI green, blocked from merge. Not production.

If a file feels load-bearing but doesn't make this list, ask: "If this file commits a bug, can prod recover with a deploy alone, or does it require operator SQL / refund / support contact?" If `deploy alone` → keep it off.

## Review cadence

Re-walk this list every 6 weeks or after any production incident. Add files when a new money-moving / auth surface ships (e.g. if a future wave adds a second payment provider, its webhook handler joins). Remove files when a refactor breaks a load-bearing concern into smaller pieces — the new pieces may not individually meet the bar.

Next scheduled re-walk: **2026-06-29**.
