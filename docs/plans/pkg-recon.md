# Wave PKG-RECON — operator reconciliation UI for `paid_not_granted` package orders

**Status:** SHIPPED 2026-05-15 (PRs #227 + #232-#236). Archive of the design + plan-mode trail.

Plan-mode history: round 1 BLOCK (9 BLOCKERs + 3 WARNs) → revision → round 2 BLOCK (5 BLOCKERs + 2 WARNs) → revision → round 3 BLOCK (1 BLOCKER + 2 WARNs, down 89% from round 1). Hard cap reached; round 3 BLOCKER #1 + WARNs #2+#3 applied in-place post-cap under user autonomy grant "делай по максимуму"; Codex INFO #4 confirmed round-2 BLOCKERs are genuinely closed.
**Project:** LevelChannel
**Predecessor:** `docs/plans/admin-ux-coverage.md` §9 Codex #3+#4 — `paid_not_granted` reconciliation is the missing P0 operator workflow.

## 1. Problem

LevelChannel's package-grant flow (`lib/billing/package-grant.ts`) has SEVEN enumerated semantic-failure reasons. When any fires on a CloudPayments webhook (or mock-confirm), the flow:

1. Writes `payment.grant.failed/<reason>` audit row.
2. Sends operator Resend email via `sendOperatorPackageGrantFailureNotification`.
3. Returns 200 (so CloudPayments doesn't retry).
4. Leaves the order at `status='paid'` with **no `package_purchases` row**.

`lib/billing/deletion-guard.ts:checkAccountInFlightPackageGrant` already encodes the predicate (Branch B). Today it only blocks deletion — operators have NO UI to remediate. Raw SQL is the only workaround.

## 2. Goals

1. Operator sees all `paid_not_granted` orders at `/admin/reconciliation/package-grants`.
2. THREE resolution actions, each idempotent + serialised + audit-logged + TERMINAL (one-shot per invoice; no replaceable resolutions):
   - **Re-run grant** — call `processPackageGrant` again.
   - **Attach to a different account** — operator picks target, system rewrites `metadata.accountId` + `customer_email`, then re-runs grant.
   - **Mark resolved** — writes a DURABLE row in a new `package_grant_resolutions` table; deletion-guard checks this table too, so resolution actually unblocks deletion. Includes a `category` field so the operator can record `refunded_offline` (CP-dashboard refund), `manual_grant_via_tariff` (operator granted equivalent via a tariff outside the system), `comped`, or `other`.
3. Existing `/admin/payments/[invoiceId]` becomes package-aware.

**Refund-via-gateway is OUT OF SCOPE (round 2 BLOCKERs #1+#2+#5+#7).** Existing CP-refund machinery (`app/api/admin/refunds/gateway-initiated/route.ts`) requires a `payment_allocations` row, which `paid_not_granted` lacks by construction. Building a dedicated refund-via-gateway path that bypasses allocations would (a) regress the durable-breadcrumb invariant from `payment_refund_attempts` + the `gateway_succeeded_db_failed` reconcile worker, (b) leave the new refunds invisible in `/admin/refunds` (it's a `payment_allocation_reversals` ledger, not a `payment_orders.status='refunded'` filter), (c) require writing a non-existent `status='refunded'` value that read-side maps back to 'pending'. Operator refunds CP-side via the CloudPayments dashboard manually, then uses **mark-resolved** with `category='refunded_offline'` to close the case. A future wave PKG-RECON-REFUND can extend `payment_refund_attempts` to support allocation-less orders cleanly; not this wave.

## 3. Non-goals

- Learner-side package buy CTA (separate wave PKG-LEARNER-BUY).
- Operator-driven manual grant of arbitrary packages (separate wave PKG-ADMIN-GRANT).
- Alert observability surface (separate wave ALERTS-OBS).

## 4. Architecture

### 4.1 Shared detection helper — single source of truth (Codex round 1 WARN #11)

New file `lib/billing/paid-not-granted.ts` exports:

```ts
export type PaidNotGrantedRow = {
  invoiceId: string
  customerEmail: string | null
  amountRub: number
  paidAt: string
  metaAccountId: string | null
  metaAccountEmail: string | null   // resolved from metaAccountId, null if not resolvable
  emailAccountId: string | null      // resolved from customer_email, null if no match
  metaPackageSlug: string | null
  lastFailureReason: string | null   // last 'package.grant.failed' audit reason
}

export const PAID_NOT_GRANTED_WHERE_SQL = `
  po.status = 'paid'
  AND po.metadata->>'packageSlug' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM package_purchases pp
     WHERE pp.payment_order_id = po.invoice_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM package_grant_resolutions r
     WHERE r.invoice_id = po.invoice_id
  )
`

export async function listPaidNotGrantedOrders(...)
export async function existsPaidNotGrantedForAccount(accountId: string)  // refactored deletion-guard branch B
```

**Codex round 1 WARN #11 closure:** `lib/billing/deletion-guard.ts:checkAccountInFlightPackageGrant` Branch B is refactored to call `existsPaidNotGrantedForAccount` instead of duplicating SQL. A new integration test pins both routes to the same set of paid_not_granted rows (drift detector).

**Codex round 1 BLOCKER #8 closure:** the new helper compares `po.metadata->>'accountId'` as TEXT against `accounts.id::text` — NO `::uuid` cast. One poisoned row no longer kills the entire list.

### 4.2 New table — `package_grant_resolutions` (Codex round 1 BLOCKERs #2 + #3)

Migration `0049_package_grant_resolutions.sql`:

```sql
CREATE TABLE IF NOT EXISTS package_grant_resolutions (
  invoice_id TEXT PRIMARY KEY
    REFERENCES payment_orders(invoice_id) ON DELETE RESTRICT,
  resolved_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  resolution TEXT NOT NULL
    CHECK (resolution IN ('granted', 'attached_and_granted', 'marked_resolved_manually')),
  category TEXT NULL
    CHECK (category IS NULL OR category IN ('manual_grant_via_tariff', 'refunded_offline', 'comped', 'other')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1024),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_grant_resolutions_resolved_at_idx
  ON package_grant_resolutions (resolved_at DESC);
```

- `invoice_id PRIMARY KEY` — at most ONE resolution per order. **All resolutions are TERMINAL** (round 2 BLOCKER #4 closure): `ON CONFLICT (invoice_id) DO NOTHING` on every insert path. Once an operator marks an invoice resolved (any of `granted`, `attached_and_granted`, `marked_resolved_manually`), it's permanently out of the recon queue. If the operator made a mistake (e.g. wrong target_account on attach-account), raw SQL is the recovery path; rare enough to not justify a "reopen" UI.
- `payload` JSONB holds action-specific context (e.g. `{previous_account_id, new_account_id}` for attach-and-granted).
- `reason` is NOT NULL — every insert path provides a string. Non-operator-supplied paths use a server-generated default (round 2 BLOCKER #3 closure):
  - `retry-grant` → `'Re-run grant by admin <email> at <ISO timestamp>'`
  - `attach-account` → `'Attached to account <new-email> by admin <email> at <ISO timestamp>'`
  - `mark-resolved` → operator-supplied (required, non-empty in route validation). Additionally, when `category='refunded_offline'`, the route ALSO accepts (and the schema stores in `payload`) an explicit `cpRefundTransactionId` string field so future operator reconciliation against the CloudPayments dashboard has a structured key rather than parsing free-text reason (round 3 WARN #3 closure). When `category='refunded_offline'` is set but `cpRefundTransactionId` is absent, the route accepts the action (operator may have refunded by other means) but emits a warning log line so prod observability surfaces it.
- `ON DELETE RESTRICT` keeps the audit signal even if the operator-account is later deleted (deletion-guard predicate also covers operator's own paid orders, transitively safe).
- **Durable** — NOT subject to `payment_audit_events` 3y retention (Codex round 1 BLOCKER #3 closure). `scripts/db-retention-cleanup.mjs` does NOT touch this table.

**Codex round 1 BLOCKER #2 closure:** `lib/billing/deletion-guard.ts` Branch B now also checks `NOT EXISTS package_grant_resolutions WHERE invoice_id = po.invoice_id`. Operator-resolved orders STOP blocking account deletion. The PRIMARY KEY ensures the resolution is durable + unique.

### 4.3 Per-invoice serialisation lock (Codex round 1 BLOCKER #5)

Every action route opens a Postgres transaction and acquires `pg_advisory_xact_lock(hashtextextended('pkg-recon:' || $1, 0))` keyed by invoice_id. ALL three recon actions (retry-grant, attach-account, mark-resolved) wait on the same lock per invoice. Inter-action races (e.g. retry-grant in flight while attach-account fires) serialise cleanly.

The webhook path does NOT take this lock — but `package_purchases.payment_order_id UNIQUE` + the existing `processPackageGrant` `already_granted` branch already make webhook + recon-action interleave safe.

### 4.4 ~~Refund-via-gateway action~~ DROPPED from this wave

Per round 2 BLOCKERs #1+#2+#5+#7. Operator workflow for refunding a paid_not_granted order:
1. Operator refunds CP-side manually via the CloudPayments dashboard.
2. Operator clicks **Mark resolved** in the recon UI with `category='refunded_offline'` and a reason like `"Refunded via CP dashboard, tx <id>"`.
3. `package_grant_resolutions` row created; deletion-guard unblocks the account.

A future wave **PKG-RECON-REFUND** can extend the existing `payment_refund_attempts` machinery (`app/api/admin/refunds/gateway-initiated/route.ts`) to support allocation-less paid_not_granted orders cleanly. That requires:
- Allowing `payment_refund_attempts` to reference an order WITHOUT an `allocation_key`.
- Extending `lib/billing/refund-reconcile.ts` to surface these.
- Adding a `payment_orders.status='refunded'` state (today's union is `pending|paid|failed|cancelled` per `lib/payments/types.ts`).
- Extending `/admin/refunds` ledger to show non-allocation refunds.

That's a 4-touchpoint payment-domain extension; out of scope for the operator-visibility wave.

### 4.5 Retry-grant action

Files: `app/api/admin/reconciliation/package-grants/[invoiceId]/retry-grant/route.ts` (new).

Workflow (inside per-invoice lock):
1. Acquire per-invoice lock.
2. Re-verify paid_not_granted via shared helper.
3. Call `processPackageGrant(invoiceId, { actor: 'admin:retry-grant' })` — `PackageGrantActor` extended.
4. If result is `granted`: insert `package_grant_resolutions` with `resolution='granted'`, `payload={packagePurchaseId}`.
5. If result is `semantic_failure` or `package_unknown_or_inactive`: do NOT insert resolution row; return the failure to operator UI so they pick a different action.
6. If result is `already_granted` (race with webhook): insert resolution row with `resolution='granted'`, `payload={packagePurchaseId, replay:true}`.

### 4.6 Attach-account action (Codex round 1 BLOCKERs #6 + #7)

Files: `app/api/admin/reconciliation/package-grants/[invoiceId]/attach-account/route.ts` (new).

**Codex round 1 BLOCKER #6 closure:** target-state policy uses REAL columns: `accounts.email_verified_at`, `accounts.disabled_at`, `accounts.scheduled_purge_at`, `accounts.purged_at`. NO `deletion_grace_until` or `@purged.localhost` heuristic.

**Codex round 1 BLOCKER #7 / round 2 WARN #6 / round 3 BLOCKER #1 closure:** the predicate today is SPLIT across two files (round 3 BLOCKER #1 — `isLearnerArchetypeCandidate` does NOT exist):
- `lib/auth/accounts.ts:listLearnerCandidates()` (line ~192) — a paginated QUERY (returns rows for admin browse).
- `lib/auth/guards.ts:requireLearnerArchetype*()` (line ~111) — request-time AUTH GUARDS for `/api/slots/*`.

The two consumers encode SIMILAR-BUT-NOT-IDENTICAL logic; neither exports a single-account check function reusable by the recon attach-account route.

**Plan (RECON.0):** extract a single canonical predicate into a NEW file `lib/auth/learner-archetype.ts` exporting:
```ts
// Pure-criteria check for a single account. No request context.
// Returns true iff the account is a valid TARGET for learner-side
// flows: email-verified, not disabled, not scheduled for purge,
// not purged, and does NOT hold an admin/teacher role grant.
export async function isLearnerArchetypeCandidate(accountId: string): Promise<boolean>
// And the same predicate as a raw SQL fragment for use in
// listLearnerCandidates() pagination query — single source of truth
// for the WHERE-clause shape.
export const LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL: string
```

Then refactor BOTH existing consumers to use this:
- `accounts.ts:listLearnerCandidates` interpolates `LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL` instead of inlining its own WHERE.
- `guards.ts:requireLearnerArchetype*` adds a check (or factors into) the same function for symmetry.

The attach-account route uses `isLearnerArchetypeCandidate(targetAccountId)`. Drift test in `tests/integration/auth/learner-archetype-predicate.test.ts` seeds rows on each excluded condition (disabled / unverified / purged / scheduled-purged / admin-role / teacher-role) and asserts BOTH the SQL filter (via listLearnerCandidates) AND the function check (via isLearnerArchetypeCandidate) reject identically.

This pins ONE canonical predicate, ONE file, with both existing consumers refactored to use it (round 3 BLOCKER #1 closure: "the plan still does not pin one canonical predicate, one file, and the exact consumer set"). `scheduled_purge_at IS NULL` is added to the canonical predicate; both consumers inherit it automatically.

The attach-account route refuses with 422 `target_account_unavailable` if `isLearnerArchetypeCandidate` returns false. Admin self-attach is BLOCKED by the canonical predicate (admin role grant disqualifies).

Workflow (inside per-invoice lock):
1. Acquire per-invoice lock.
2. Validate target account passes `isLearnerCandidate`.
3. In TX: UPDATE `payment_orders` SET `metadata = jsonb_set(metadata, '{accountId}', ...)`, `customer_email = (SELECT email FROM accounts WHERE id = $1)` WHERE invoice_id = $2.
4. Call `processPackageGrant(invoiceId, { actor: 'admin:attach-account' })`.
5. On grant success: insert `package_grant_resolutions` with `resolution='attached_and_granted'`, `payload={previousAccountId, previousCustomerEmail, newAccountId, newCustomerEmail, packagePurchaseId}`.
6. Audit row `payment.grant.account-attached-by-admin` (new event type — see §4.8).

### 4.7 Mark-resolved action (Codex round 1 BLOCKER #2 redux)

Files: `app/api/admin/reconciliation/package-grants/[invoiceId]/mark-resolved/route.ts` (new).

Body: `{ category: 'manual_grant_via_tariff' | 'refunded_offline' | 'comped' | 'other', reason: string (required, non-empty) }`.

Workflow (inside per-invoice lock):
1. Acquire lock.
2. Re-verify paid_not_granted.
3. Insert `package_grant_resolutions` with `resolution='marked_resolved_manually'`, `category=<picked>`, `reason=<text>`.
4. Audit row `payment.grant.resolved-manually-by-admin` (new event type).

**Why this NOW unblocks deletion:** §4.2 + §4.1 — deletion-guard's predicate reads `package_grant_resolutions`. Once the row exists, the account becomes deletable. Trade-off accepted: `package_purchases` STILL has no row (since the grant didn't actually happen); the learner has no entitlement; the operator confirmed this is fine (e.g. they granted equivalent value through a tariff outside the system).

### 4.8 Audit event taxonomy migration (Codex round 1 BLOCKER #9)

Migration `0050_payment_audit_events_pkg_recon.sql` (base: 0049 + current head taxonomy at 0040):

```sql
ALTER TABLE payment_audit_events
  DROP CONSTRAINT payment_audit_events_event_type_check;

ALTER TABLE payment_audit_events
  ADD CONSTRAINT payment_audit_events_event_type_check
  CHECK (event_type IN (
    -- ALL existing types from 0034 + 0037 + 0040 + ...
    'order.created', 'order.cancelled', 'mock.confirmed',
    'webhook.check.received', 'webhook.check.declined',
    'webhook.pay.received', 'webhook.pay.processed', 'webhook.pay.validation_failed',
    'webhook.fail.received', 'webhook.fail.declined', 'webhook.fail.processed',
    'charge_token.succeeded', 'charge_token.requires_3ds', 'charge_token.declined',
    'threeds.callback.received', 'threeds.confirmed', 'threeds.declined',
    'package.grant.failed', 'package.grant.succeeded',
    'payment.refund.recorded',
    'payment.refund.initiated.gateway',
    'payment.refund.gateway.webhook',
    -- New for PKG-RECON:
    'payment.grant.retried-by-admin',
    'payment.grant.account-attached-by-admin',
    'payment.grant.resolved-manually-by-admin'
  ));
```

**Migration must be derived from the CURRENT enumeration of `PAYMENT_AUDIT_EVENT_TYPES` in `lib/audit/payment-events.ts` AT MIGRATION-WRITE TIME**, not from 0034 as round-1 plan said. The migration author verifies all 20 existing + 3 new types are listed by running a diff against `PAYMENT_AUDIT_EVENT_TYPES`.

Code changes:
- `lib/audit/payment-events.ts`: `PAYMENT_AUDIT_EVENT_TYPES` const array extended with the 3 new types. `PaymentAuditActor` union extended with `'admin:retry-grant' | 'admin:attach-account' | 'admin:resolved'` literal types (NO refund actor — refund-via-gateway dropped).
- `lib/billing/package-grant.ts`: `PackageGrantActor` union extended with `'admin:retry-grant' | 'admin:attach-account'`.
- `tests/integration/audit/payment-events.test.ts`: the enum-drift test (line 153) automatically picks up the new types via `for (const eventType of PAYMENT_AUDIT_EVENT_TYPES)`.

### 4.9 Idempotency via Idempotency-Key header (Codex round 1 BLOCKER #4)

All FOUR action routes use the existing `withIdempotency(request, scope, rawBody, executor)` helper at `lib/security/idempotency.ts:41`:

- The client (admin UI confirm-modal) generates an `Idempotency-Key` HEADER (UUID v4) on action-modal-open. The same key is reused on confirm-click and any retry.
- Server reads via `request.headers.get('idempotency-key')` — already inside the helper. NO body field involved.
- `scope` is `'admin:pkg-recon:retry-grant'` / `'admin:pkg-recon:attach-account'` / `'admin:pkg-recon:mark-resolved'`. Different scopes ensure key collision across actions is harmless.
- Per-key TTL is enforced by the existing janitor (NOT the helper itself); plan does NOT promise 24h freshness inline.

### 4.10 `/admin/payments/[invoiceId]` package-aware rendering (Codex round 1 WARN #10)

Scope correction — NOT a "tiny diff." Real changes:
- `lib/payments/allocations.ts`: `AllocationKind = 'lesson_slot' | 'package'`. `ALLOWED_KINDS` Set extended. The DB already accepts both kinds (per `package-grant.ts:191` inserting `kind='package'`), TS type was lagging.
- `listAllocationsForOrder` adds a `package_purchases` JOIN to surface `title_snapshot` + `count_initial` + `duration_minutes` for `kind='package'` rows.
- `app/admin/(gated)/payments/[invoiceId]/page.tsx`: pre-fetch package rows for `kind='package'` allocations (same shape as the existing lesson_slot pre-fetch); render "Пакет: 10×60 мин (lc_xxxxxxxx...)" instead of raw UUID.
- **Verification sub-task (round 1 WARN #10 explicit)**: grep the repo for every `WHERE kind = 'lesson_slot'` / `a.kind = 'lesson_slot'` query. Verify each is INTENTIONALLY filtering to slot allocations only (vs. silently missing package rows due to legacy assumption). RECON.1 PR description lists every site touched (or explicitly justified as slot-only). Known sites already in `lib/payments/allocations.ts:119,177`.

### 4.11 GET-endpoint auth/RL discipline (Codex round 1 WARN #12)

The list endpoint `/api/admin/reconciliation/package-grants/route.ts` GET handler explicitly:

```ts
const originGate = enforceTrustedBrowserOrigin(request)
if (originGate) return originGate
const rl = await enforceRateLimit(request, 'admin:reconciliation:list', 30, 60_000)
if (rl) return rl
const auth = await requireAdminRole(request)
if (!auth.ok) return auth.response
```

Same shape as the POSTs. Documented explicitly here so the route author cannot leave it implicit.

## 5. Sub-PR decomposition

### Sub-PR RECON.0 — Foundation (migrations + shared helper + AllocationKind extension)

Files:
- `migrations/0049_package_grant_resolutions.sql` (new) — §4.2.
- `migrations/0050_payment_audit_events_pkg_recon.sql` (new) — §4.8.
- `lib/billing/paid-not-granted.ts` (new) — §4.1 shared helper.
- `lib/billing/deletion-guard.ts` — refactor branch B to use shared helper + check `package_grant_resolutions` (§4.2 closure).
- `lib/audit/payment-events.ts` — extend `PAYMENT_AUDIT_EVENT_TYPES` + `PaymentAuditActor` (§4.8).
- `lib/billing/package-grant.ts` — extend `PackageGrantActor` (§4.8).
- `lib/payments/allocations.ts` — extend `AllocationKind` union + `ALLOWED_KINDS` + listAllocationsForOrder JOIN (§4.10).
- `lib/auth/guards.ts` — new `isLearnerCandidate(accountId)` (§4.6).
- `tests/integration/audit/payment-events.test.ts` — enum-drift test auto-extends.
- `tests/integration/billing/paid-not-granted.test.ts` (new) — drift test asserting deletion-guard branch B + shared helper return same invoice_ids for same DB state.
- `tests/integration/billing/deletion-guard.test.ts` — extend to assert `package_grant_resolutions` row unblocks deletion.

Size: ~500 LOC + ~250 test LOC.

Trailer: `Codex-Paranoia: SUB-WAVE self-reviewed (epic pkg-recon); epic-end review pending`.

### Sub-PR RECON.1 — List + payment-detail package rendering

Files:
- `app/api/admin/reconciliation/package-grants/route.ts` (new, GET) — §4.11.
- `app/admin/(gated)/reconciliation/page.tsx` (new) — list UI with last-failure-reason column + action buttons (initially disabled).
- `app/admin/(gated)/layout.tsx` — add `Реконсилиация` nav.
- `app/admin/(gated)/payments/[invoiceId]/page.tsx` — package-aware rendering (§4.10).
- `tests/integration/admin/reconciliation-list.test.ts` (new).

Size: ~350 LOC + ~150 test LOC.

### Sub-PR RECON.2 — Retry-grant action

Files:
- `app/api/admin/reconciliation/package-grants/[invoiceId]/retry-grant/route.ts` (new) — §4.5.
- `app/admin/(gated)/reconciliation/retry-modal.tsx` (new) — client island; generates Idempotency-Key UUID on mount.
- `tests/integration/admin/reconciliation-retry.test.ts` (new) — happy path + replay + race-with-webhook.

Size: ~300 LOC + ~200 test LOC.

### Sub-PR RECON.3 — Attach-account action

Files:
- `app/api/admin/reconciliation/package-grants/[invoiceId]/attach-account/route.ts` (new) — §4.6.
- `app/admin/(gated)/reconciliation/attach-modal.tsx` (new) — operator picks target via email search.
- `tests/integration/admin/reconciliation-attach.test.ts` (new) — happy path + admin-self refused + purged-account refused + email-mismatch repaired.

Size: ~400 LOC + ~250 test LOC.

### Sub-PR RECON.4 — Mark-resolved action

Files:
- `app/api/admin/reconciliation/package-grants/[invoiceId]/mark-resolved/route.ts` (new) — §4.7.
- `app/admin/(gated)/reconciliation/mark-resolved-modal.tsx` (new) — category picker (manual_grant_via_tariff | refunded_offline | comped | other) + required reason input.
- `tests/integration/admin/reconciliation-mark-resolved.test.ts` (new) — assert deletion-guard unblocks after mark-resolved.

Size: ~250 LOC + ~150 test LOC.

### Epic-close PR

After all 5 sub-PRs merge: run `/codex-paranoia wave <range>` on aggregated diff. Final epic-close PR carries SIGN-OFF trailer.

### 4.12 What this wave does NOT touch

For completeness (round 2 BLOCKER #1+#2+#5+#7+ INFO #8 closure):

- `payment_orders.status` enum stays `pending|paid|failed|cancelled`. No `'refunded'` introduction.
- `payment_allocations` table — schema unchanged. No new allocation kinds.
- `payment_allocation_reversals` — untouched.
- `payment_refund_attempts` — untouched.
- `/admin/refunds` ledger — untouched.
- CloudPayments refund-API path — untouched.

Operator-driven refund of a paid_not_granted order is an OUT-OF-BAND workflow (CP dashboard) + the `mark-resolved` audit signal. Future wave PKG-RECON-REFUND will close this loop properly.

## 6. Invariants this wave must not break

1. `processPackageGrant` operational-failure → throw → 5xx → CloudPayments retries. Admin retry uses same fn; operational failure propagates as 500 to operator UI.
2. `package_purchases.payment_order_id` NOT NULL UNIQUE — preserved. attach-account does NOT create new payment_orders, only mutates metadata + customer_email.
3. `deletion-guard.ts` Branch B continues to block paid_not_granted UNTIL `package_grant_resolutions` row exists. Mark-resolved is the ONLY operator-driven path that creates a resolution without a grant.
4. Audit-event taxonomy enum: every event type emitted in code must be in `PAYMENT_AUDIT_EVENT_TYPES` AND in the CHECK constraint. Enum-drift test (line 153 of `tests/integration/audit/payment-events.test.ts`) is the safety net.
5. Shared helper `paid-not-granted.ts` is the SoT — deletion-guard branch B and the new operator GET use the SAME SQL. New `tests/integration/billing/paid-not-granted.test.ts` is the drift detector.
6. Idempotency-Key contract: header-based per existing `withIdempotency` shape.
7. Per-invoice serialisation: `pg_advisory_xact_lock` keyed by `hashtextextended('pkg-recon:' || invoiceId, 0)`. ALL recon actions go through this lock.
8. `AllocationKind` union now includes `'package'` — the DB already had these rows; the TS type was lagging. Update propagates safely.

## 7. Failure modes considered

- **Concurrent operator actions on same order**: per-invoice advisory lock serialises (§4.3). The first action wins; second action sees the resolution-row + bails with "already resolved."
- **Operator retries grant after package was deactivated**: `processPackageGrant` returns `package_unknown_or_inactive`. Operator sees the reason in the UI; flow stays paid_not_granted; operator can choose attach or refund or mark-resolved.
- **Race with webhook retry**: per-invoice lock makes operator action wait for in-flight webhook retry; `already_granted` branch fires cleanly.
- **Operator picks a purged target account**: §4.6 `isLearnerCandidate` refuses with 422.
- **CloudPayments refund-API outage**: out of scope (refund-via-gateway is dropped from this wave). Operator refunds CP-side via the CP dashboard out-of-band, then marks-resolved with `category='refunded_offline'`.
- **Mark-resolved row deleted manually via raw SQL**: deletion-guard returns to blocking. Recoverable from raw SQL re-insert.

## 8. Codex-paranoia plan-checkpoint requested findings (round 2)

When Codex paranoia-reviews this revision, surface specifically:

- Did the per-invoice lock contract miss any action path that mutates `payment_orders.metadata` / `customer_email` (e.g. CloudPayments webhook handler also rewrites these — would the lock starve it)?
- Audit-event enum migration: any event type added since 0040 that I missed in the explicit list?
- `package_grant_resolutions.ON DELETE RESTRICT` on the operator FK — what happens if the operator-account is later anonymised? Is anonymisation a DELETE or an UPDATE?
- AllocationKind extension — are there existing query paths that filter `WHERE kind='lesson_slot'` and would silently start MISSING package allocations?
- `isLearnerCandidate` predicate — does any existing flow already check this same set of conditions? (Avoid creating a NEW SoT for the predicate.)
- Mark-resolved durability — package_grant_resolutions retention story? Or is it permanent by design?
- ON CONFLICT shape on `package_grant_resolutions` PRIMARY KEY — the round-2 plan says "overwrite only when prior was audit-only manual"; is that right semantics or should ALL resolutions be terminal (one-shot per invoice)?
- Cross-pull worker interaction: any side-effect on `calendar_pull_jobs`, `calendar_push_jobs`, `slot_lifecycle_intents` from a re-run grant or attach-account? (These workers don't touch payment_orders, but verify.)
- Anything a 200-IQ paranoid engineer would catch.
