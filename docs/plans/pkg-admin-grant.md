# PKG-ADMIN-GRANT — operator-driven package grant

**Wave name:** `pkg-admin-grant`
**Priority:** P2 per admin-ux-coverage.md §10.1
**Predecessor:** PKG-RECON (merged 2026-05-15), PKG-LEARNER-BUY (merged 2026-05-16), RECEIPT-3DS-TOKEN (merged 2026-05-16)
**Status:** REVISED after plan-mode round 1 BLOCK (6 BLOCKERs). Schema approach pivoted from "no synthetic payment_orders" (Option C — relax NOT NULL) to **Option D: synthetic payment_orders row with `provider='admin_grant'`**. Closes all 6 BLOCKERs at the architecture level.

## Existing surface inventory (mandatory per COMPANY.md Survey-before-plan rule)

`grep -rln "package_purchases\b" lib/ app/` — 15 hits surveyed in round-1 rev (preserved below for reference; the Option D pivot makes MOST of them unrelated):

| File | Disposition under Option D |
|---|---|
| `lib/billing/packages/purchases.ts` | unrelated (schema unchanged — purchases still has NOT NULL payment_order_id). |
| `lib/billing/packages/eligibility.ts` | unrelated (same). |
| `lib/billing/consumption.ts` | unrelated (consumes by purchase id; source-agnostic via package_purchases row). |
| `lib/billing/deletion-guard.ts` | unrelated (joins on payment_orders.status='paid'; admin-grant order has status='granted' ≠ 'paid'). |
| `lib/payments/money.ts` | refactor (audit) — must exclude `provider='admin_grant'` from money aggregations + refund reconcile + revenue reports. |
| `lib/scheduling/slots/booking.ts` | unrelated (picks active package by duration; source-agnostic). |
| `lib/email/templates/operator-package-grant-failure.ts` | unrelated (failure email; admin-grant has no fail-via-webhook path). |
| `lib/billing/paid-not-granted.ts` | refactor — WHERE must add `status='paid'` (already filters this, but verify admin orders don't slip in). |
| `app/admin/(gated)/reconciliation/page.tsx` | unrelated (filters paid_not_granted via lib/billing/paid-not-granted.ts). |
| `app/admin/(gated)/payments/[invoiceId]/page.tsx` | refactor (display) — admin-grant orders SHOULD render in the operator's payment-detail view with the granted-by + reason fields. |
| `app/admin/(gated)/packages/page.tsx` | extend (UI) — NEW "Grant to learner" action. |
| `app/api/admin/reconciliation/package-grants/*` | unrelated. |
| `app/api/account/delete/route.ts` | unrelated (account-level delete; FK on delete restrict still holds). |

`grep -rln "payment_order_id\|invoice_id" lib/audit/ lib/billing/ lib/payments/` — touched only by money.ts + paid-not-granted.ts under Option D. Significantly smaller surface than Option C.

## 1. Goal

Close P2 from admin-ux-coverage.md: operator can grant a package to a specific learner without going through a real CloudPayments charge (refund-credits, marketing comps, customer-service make-goods). Admin grants are non-money flow but produce the same `package_purchases` row a paid grant would, so cabinet/booking/consumption are source-agnostic.

## 2. Schema decision: Option D — synthetic payment_orders row with `provider='admin_grant'`

### 2.1 Why this option

Round 1 paranoia returned BLOCK with 6 BLOCKERs on Option C (relax `package_purchases.payment_order_id NOT NULL` + grant_source enum). Root cause: the codebase has many DB-level invariants that assume `payment_order_id IS NOT NULL`:
- `payment_audit_events.invoice_id` FK requires it (BLOCKER #1).
- `package_purchases.payment_order_id UNIQUE` + `createPackagePurchase` `ON CONFLICT(payment_order_id) DO NOTHING` (BLOCKER #2).
- `PackagePurchase.paymentOrderId: string` TypeScript type (BLOCKER #3).
- Reason-persistence (BLOCKER #6) — payment_audit_events is best-effort, so reason can vanish.

The admin-ux-coverage doc previously rejected "synthetic payment_orders" because of money-side pollution. The pivot: a synthetic row with `provider='admin_grant'` is **trivially filterable** at the ~5 money-side query call-sites (way smaller than auditing 34 NOT-NULL assumptions across the codebase).

### 2.2 Migration `0051_payment_orders_admin_grant.sql`

```sql
-- Extend payment_orders to support operator-driven grants without
-- money flow. The synthetic row carries the package-buy contract
-- enough to satisfy existing FK + NOT NULL invariants:
--   - invoice_id: 'lc_adm_' + 16 hex
--   - provider: 'admin_grant' (NEW value)
--   - status: 'granted' (NEW value; distinct from 'paid' so money-
--     side queries don't accidentally pick it up)
--   - amount_rub: 0 (zero-money flow; OR catalog.amountKopecks/100
--     for accounting visibility — pick one in implementation)
--   - description: 'Admin grant: <reason>' (durable reason, lives
--     on a NOT NULL column — closes audit-best-effort BLOCKER)
--   - granted_by_operator_id: uuid (NEW column, NULL for paid orders)
--
-- CHECK enforces: provider='admin_grant' ⇔ granted_by_operator_id
-- IS NOT NULL ⇔ status='granted'.

ALTER TABLE payment_orders
  ADD COLUMN granted_by_operator_id uuid null
    references accounts(id) on delete restrict;

ALTER TABLE payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_provider_check;
ALTER TABLE payment_orders
  ADD CONSTRAINT payment_orders_provider_check
  CHECK (provider IN ('cloudpayments', 'mock', 'admin_grant'));

ALTER TABLE payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_status_check;
ALTER TABLE payment_orders
  ADD CONSTRAINT payment_orders_status_check
  CHECK (status IN ('pending', '3ds_required', 'paid', 'failed', 'cancelled', 'granted'));

ALTER TABLE payment_orders
  ADD CONSTRAINT payment_orders_admin_grant_consistency
  CHECK (
    (provider = 'admin_grant' AND granted_by_operator_id IS NOT NULL AND status = 'granted')
    OR
    (provider <> 'admin_grant' AND granted_by_operator_id IS NULL AND status <> 'granted')
  );
```

### 2.3 Migration `0052_payment_audit_events_admin_grant.sql`

Same pattern as PKG-RECON migration 0050:

```sql
ALTER TABLE payment_audit_events
  DROP CONSTRAINT IF EXISTS event_type_check;
ALTER TABLE payment_audit_events
  ADD CONSTRAINT event_type_check
  CHECK (event_type IN (
    -- existing types ...
    'package.grant.operator-granted'  -- NEW
  ));
```

AND synchronously update `lib/audit/payment-events.ts:PAYMENT_AUDIT_EVENT_TYPES` + `PaymentAuditEventType` union + `PaymentAuditActor` (`'admin:grant'` new value) per round-1 WARN #8.

## 3. Decomposition

Three sub-PRs:

### LBL.0 — migrations + provider/status taxonomy + reader fan-out

- Migration 0051 + 0052 (above).
- **`lib/payments/types.ts`** — extend `PaymentProvider` with `'admin_grant'`; extend `PaymentOrderStatus` with `'granted'`. Update every union match (likely 5-10 sites).
- **`lib/payments/store-postgres.ts:mapRowToOrder`** (round-2 BLOCKER #1 closure + round-3 WARN #2 closure + round-4 WARN #5 closure) — currently coerces unknown provider → `'mock'` and unknown status → `'pending'`. Three-step mitigation:
  1. **Pre-deploy data audit** — run `SELECT DISTINCT provider, status FROM payment_orders` against a STAGING snapshot (NOT prod directly — we don't have direct prod SELECT access in CI/operator hands; staging is the canonical pre-deploy harness). Document findings in `docs/deploy-checklist-pkg-admin-grant.md`. Expected values per the codebase audit: provider ∈ {'cloudpayments', 'mock'}, status ∈ {'pending', '3ds_required', 'paid', 'failed', 'cancelled'}.
  2. **Migration extends the value sets explicitly** — migration 0051 adds 'admin_grant' to provider and 'granted' to status. CHECK constraints enforce.
  3. **Coercion path replaced with explicit accept-list throw**. Loud-fail on unknown provider/status is the operational-safe behaviour. Fallback deploy story: if migration 0051 fails due to existing rows violating the new CHECK, the migration is reversible (it's purely additive — drop the new CHECK constraints, revert the column ALTER). The throw-on-unknown change is a code-level rollback (revert the deploy).
  All callers (`getOrder`, `listOrdersPostgres`, admin payment detail page) inherit the fix.
- **`app/admin/(gated)/payments/page.tsx`** + `[invoiceId]/page.tsx` (round-2 BLOCKER #2 + round-4 WARN #4 + round-5 WARN #3 closures) — admin payment list/detail hardcode the status taxonomy `pending|paid|failed|cancelled`. Extend rendering:
  1. Include `granted` with a distinct visual treatment ("Выдан админом" badge).
  2. Special-case `paid_at`-label: currently shown as "Оплачен" for any non-null paidAt; for `status='granted'` orders show "Выдан" instead (paid_at IS now() but it's NOT money paid — it's grant materialization timestamp).
  3. Display `granted_by_operator_id` via **page-local SQL join to `accounts`** (NOT extending `PaymentOrder`/`mapRowToOrder` — keeps the type surface minimal and the admin page is the only consumer that cares about the operator's identity). Page-local query: `SELECT po.*, a.email AS granted_by_email FROM payment_orders po LEFT JOIN accounts a ON a.id = po.granted_by_operator_id WHERE po.invoice_id = $1`.
- **`lib/audit/payment-events.ts`** — add `'package.grant.operator-granted'` to `PAYMENT_AUDIT_EVENT_TYPES` + `PaymentAuditEventType`; add `'admin:grant'` to `PaymentAuditActor`. Update enum-drift integration test.
- **`lib/billing/package-grant.ts`** — round-2 WARN #5 N/A after round-3 pivot: admin grants no longer route through `processPackageGrant`. `PackageGrantActor` union stays unchanged (no `'admin:grant'` value). Audit row from the new admin-grant route uses a separate event type (`package.grant.operator-granted`) with its own actor field — see audit-event-types update below.
- **Money-side reader inventory** (round-3 WARN #3 closure — `money.ts` itself only has `rublesToKopecks`; real readers are spread across):
  - `lib/payments/admin-list.ts:91` — admin payments list query. Add explicit filter or accept admin_grant rows with a flag-aware projection.
  - `app/api/admin/refunds/route.ts:132` — manual refund route. Adds the kind='package' on admin_grant guard separately (BLOCKER #4 closure).
  - `app/api/admin/refunds/gateway-initiated/route.ts:236` — already restricted to `kind='lesson_slot'` (round-3 INFO #4); no admin-grant exposure.
  - `lib/billing/paid-state.ts:42` — paid-state aggregation. Verify `status='paid'` filter (admin grants are status='granted', invisible).
  - `lib/billing/packages/debt.ts:40` — debt rollup. Same status filter.
  - `lib/payments/money.ts` itself — no SQL, no change. (Plan v1 was wrong about this owner.)
- **`app/api/admin/refunds/route.ts`** (round-2 BLOCKER #4 closure) — refund route accepts `kind='package'` and validates only against `payment_allocations`. Add guard: refuse refund when the underlying order's `provider='admin_grant'` (admin grants have no money to refund). Voids of admin grants go through PKG-ADMIN-VOID follow-up wave, NOT through `/api/admin/refunds`.
- **`lib/billing/paid-not-granted.ts`** WHERE clause: verify explicit `status = 'paid'` filter (it does; admin grants invisible by construction).
- **`lib/billing/deletion-guard.ts`** — predicate keys on `status='paid'` and pending statuses; `'granted'` orders are non-blocking. Test pin.
- Tests:
  - Migration applies + check constraints reject bad rows.
  - Type-narrowing: 'granted' status visible in admin payments page UI.
  - paid-not-granted: synthetic admin-grant row never appears in reconciliation queue.
  - Refund route: POST `/api/admin/refunds` with kind='package' on an admin_grant order → 422 `cannot_refund_admin_grant`.
  - package-grant.ts audit: admin-grant calls produce audit row with `toStatus='granted'`, not 'paid'.

### LBL.1 — server route `/api/admin/packages/[id]/grant`

- Auth: `requireAdminRole`.
- Body: `{ targetAccountId, reason }`. Reason required, non-empty, ≤1024 chars.
- Validation:
  - targetAccountId must pass `isLearnerArchetypeCandidate` (same SoT used by PKG-RECON attach-account + PKG-LEARNER-BUY page).
  - Package must exist + be active.
  - Reason non-empty.
- **Idempotency: DB-level** (round-1 BLOCKER #4 closure + round-2 BLOCKER #3 closure):
  - The synthetic invoice_id is generated deterministically from `(packageId, targetAccountId, dayBucket)` where dayBucket = `floor(now() / 1day)`. Same operator clicking twice within the same day → same invoice_id → UNIQUE constraint on payment_orders.invoice_id rejects the second INSERT with conflict.
  - When operator wants to stack: caller passes `{ allowStacking: true }`. The invoice_id derivation changes — adds a salt `random()` to the hash input so the invoice_id is different. Old plan said "allowStacking override" but didn't change the key derivation; round-2 BLOCKER #3 caught this. New rule: `allowStacking ? hash(packageId+target+date+randomSalt) : hash(packageId+target+date)`. Stacked grants always succeed insertion (different invoice_id every time); non-stacked grants dedupe by date-bucket invariant.
- **Single-TX atomic flow** (round-3 BLOCKER closure — DO NOT route through `processPackageGrant`):
  - `processPackageGrant` is designed for the money-flow webhook path: dual-source ownership corroboration (`metadata.accountId` ↔ `customer_email` resolves to same account), `getOrder()` re-read on a separate connection, audit row via separate pool. Under READ COMMITTED the separate-connection reads CAN'T see the synthetic order row before commit; committing first leaves a visible-but-incomplete `status='granted'` row if grant fails, and existing recovery paths (`paid_not_granted`, deletion-guard) key on `status='paid'` so the orphan is invisible.
  - **Admin grants are NOT money flow.** Operator IS the source-of-truth — no corroboration needed. Skip the entire `processPackageGrant` pipeline.
- Transport-level idempotency via `withIdempotency(scope='admin:packages:grant:<packageId>:<targetAccountId>')` (round-4 BLOCKER #2 closure). Same Idempotency-Key replay returns the cached response — protects against transport retries / accidental double-clicks. Separate from the business "allowStacking" rule.
- Single TX on a dedicated lockClient INSIDE the idempotency body:
  1. **Pre-resolve target email**: `SELECT email FROM accounts WHERE id = $1` — required for the synthetic payment_orders INSERT (`customer_email` is NOT NULL). Reject if not found.
  2. `pg_advisory_xact_lock(hashtextextended('pkg-admin-grant:' || targetAccountId || ':' || pkg.durationMinutes, 0))` (round-4 BLOCKER #1 closure — lock scope matches anti-stacking domain `(accountId, durationMinutes)`, NOT `(packageId, targetAccountId)`. Concurrent grants of DIFFERENT packages of the SAME duration to the SAME learner now serialize and the second hits the gate.)
  3. Optional anti-stacking gate via `learnerHasActivePackageOfDuration` (default REJECT, override via `allowStacking: true`).
  4. INSERT payment_orders row — FULL column set (round-4 BLOCKER #3 closure):
     - `invoice_id`: synthetic 'lc_adm_<16 hex>' (deterministic from `(packageId, targetAccountId, dayBucket)` OR with random salt if `allowStacking`).
     - `amount_rub`: 0 (admin grant is non-money flow).
     - `currency`: 'RUB'.
     - `description`: 'Admin grant: ' + reason (durable reason persistence).
     - `provider`: 'admin_grant'.
     - `status`: 'granted'.
     - `created_at`/`updated_at`: now().
     - `paid_at`: now() (status='granted' implies the order is terminal — paid_at marks terminal time for downstream chronology).
     - `customer_email`/`receipt_email`: target learner's email (from step 1).
     - `receipt`: structurally valid zero-money receipt (round-5 WARN #5 closure — `'{}'::jsonb` violates the app-level `PaymentReceipt` contract and `mapRowToOrder` casts blindly):
       ```json
       {
         "items": [],
         "email": "<target.email>",
         "isBso": false,
         "amounts": {"electronic": 0, "advancePayment": 0, "credit": 0, "provision": 0}
       }
       ```
       Zero-money for non-money flow; no fiscal-receipt items because 54-ФЗ obligation triggers on money flow which we skip.
     - `metadata`: jsonb with `{accountId: targetAccountId, packageSlug: pkg.slug, packageDurationMinutes: pkg.durationMinutes, packageId: pkg.id}`.
     - `granted_by_operator_id`: session.account.id.
     - `receipt_token_hash`: NULL (admin grants don't surface via /thank-you).
  5. INSERT package_purchases row DIRECTLY (same TX): account_id=targetAccountId, package_id=pkg.id, payment_order_id=invoiceId, amount_kopecks=pkg.amountKopecks, currency='RUB', title_snapshot=pkg.titleRu, duration_minutes=pkg.durationMinutes, count_initial=pkg.count, expires_at=now()+180 days.
  6. INSERT payment_allocations row (kind='package', target_id=purchase.id, amount_kopecks=pkg.amountKopecks). Same TX.
  7. COMMIT.
- Post-commit audit (best-effort, matches existing pattern): `recordPaymentAuditEvent({ eventType: 'package.grant.operator-granted', invoiceId, ..., payload: { reason, operatorAccountId, targetAccountId, packageId, purchaseId } })`. Audit failure is non-fatal — the load-bearing record is the package_purchases row + payment_orders row.description='Admin grant: <reason>'.
- Response: `{ invoiceId, purchaseId, expiresAt, titleSnapshot, count }`.

### LBL.2 — admin UI

- Inline action on `/admin/packages` LIST page (round-3 INFO #5 correction — there's no `/admin/packages/[id]` route today; the existing surface is `app/admin/(gated)/packages/page.tsx` + `packages-editor.tsx`). Add a per-row "Выдать ученику" button OR a detail-modal/drawer triggered from the list row. EXTEND `packages-editor.tsx`, do NOT create a new page (Survey-before-plan rule).
- Target account picker (email search via `listLearnerCandidates()` data source per round-4 INFO #8 — no reusable UI component exists in PKG-RECON, which uses native `prompt()`).
- Confirm modal with package details + reason field.
- Submit → POST route with `Idempotency-Key: <fresh UUID per click>`.
- **Idempotency-Key freshness rule** (round-5 WARN #2 closure): each intentional stacked click MUST generate a NEW Idempotency-Key — same key + same body replays the cached response by design (which is correct for transport retries but skips the random-salt INSERT for intentional stacking). The buy-button client island generates `crypto.randomUUID()` on each onClick. Integration test pins: stacked-click with NEW Idempotency-Key → two distinct invoice_ids; stacked-click with SAME Idempotency-Key → cached response (1 grant + Idempotency-Replay: true header).
- Optional: render existing operator grants for the package (count + most recent).

## 4. Security invariants

1. **Server-authoritative pricing/title/count/expiry** (matches PKG-LEARNER-BUY pattern).
2. **Target validation** via `isLearnerArchetypeCandidate`.
3. **Admin role gate** at the route.
4. **Reason persistence via NOT NULL column** (`payment_orders.description = 'Admin grant: <reason>'`). Closes round-1 BLOCKER #6 — reason can't vanish even if best-effort audit fails.
5. **No money flow** at the DB level: provider='admin_grant' enforced by CHECK; money.ts filters explicitly.
6. **No receipt token** — admin grants don't surface via /thank-you, no need.
7. **DB-level dedup** via deterministic invoice_id (closes round-1 BLOCKER #4).

## 5. Testing

- Migration tests (LBL.0).
- Integration:
  - Happy path: admin POST grant → 200 + payment_orders row with provider='admin_grant' + package_purchases row + audit row.
  - Auth: anonymous → 401, learner → 403, teacher → 403.
  - Invalid target (admin/teacher/unverified/deletion-grace) → 422.
  - Missing reason → 400.
  - Same-day double-submit → 409 (UNIQUE invoice_id) UNLESS `allowStacking: true`.
  - Reason persisted in payment_orders.description (durability test).
  - Money-side queries skip admin_grant: `lib/payments/money.ts` revenue aggregation EXCLUDES the granted invoice.
  - Paid-not-granted queue: admin grant doesn't appear (status='granted' ≠ 'paid').
  - Refund-reconcile: admin grant invisible.
  - Cabinet: granted package appears in /cabinet/packages "Мои пакеты".
  - Booking: granted package consumable as slot payment.
- Drift: `tests/integration/audit/payment-events.test.ts` enum check picks up new event type.

## 6. RISKs

- **RISK-1 (operator stacks same-duration grants for one learner):** plan §3.LBL.1 doesn't add an anti-stacking gate by default. The `learnerHasActivePackageOfDuration` predicate is available — should admin grant respect it? Decision deferred to round 2 — round-1 round-1 WARN #9 explicitly flagged this. Default proposed: REJECT same-duration stack BY DEFAULT, allow override via `allowStacking: true`. Mirrors PKG-LEARNER-BUY policy.
- **RISK-2 (catalog amount on synthetic row):** amount_rub=0 OR catalog.amountKopecks/100? Zero hides the economic value from operator reports; catalog amount makes admin grants look like revenue. Pick: `amount_rub = 0` to keep money.ts revenue accurate; catalog amount displayed in admin UI from package.amountKopecks anyway.
- **RISK-3 (admin grant before learner verifies email):** `isLearnerArchetypeCandidate` filters unverified — operator CAN'T grant to unverified accounts. Aligns with PKG-LEARNER-BUY anti-spoof at consumer layer; admin-side gate is intentionally tighter than the receipt-gate session fallback.
- **RISK-4 (refund of admin grant):** out of scope; PKG-ADMIN-VOID follow-up wave.

## 7. Out of scope

- **PKG-ADMIN-VOID** — operator-side void/refund of admin grants. Today: `voided_at` field exists; manual SQL voids. UI follow-up.
- **Bulk grant** — single grant per request.
- **Promo codes / subscriptions** — separate waves.

## 8. Doc updates

- `PAYMENTS_SETUP.md` — add "Operator-driven grant (PKG-ADMIN-GRANT)" section.
- `ARCHITECTURE.md` — add provider='admin_grant' + status='granted' to taxonomy.
- `admin-ux-coverage.md` — mark P2 PKG-ADMIN-GRANT shipped after LBL.2 merge.
- `prepay-postpay-billing.md` — supersession note for previously-rejected nullable-payment_order_id (round-1 WARN #7 closure).

## 9. Paranoia checklist

### Pre-implementation
- [x] Round 1: BLOCK 6 BLOCKERs + 3 WARNs on Option C — pivoted to Option D in round-2 rev.
- [x] Round 2: BLOCK 4 BLOCKERs + 1 WARN + 3 INFOs on Option D v1. Addressed in round-3 rev.
- [x] Round 3: BLOCK 1 BLOCKER + 2 WARNs + 2 INFOs. Addressed in round-4 rev.
- [x] Round 4: BLOCK 3 BLOCKERs + 2 WARNs + 2 INFOs. Addressed in round-5 rev.
- [x] Round 5: **SIGN-OFF** with 3 WARNs + 2 INFOs (NO BLOCKERs). All WARNs applied in-loop:
  - WARN #2 (idempotency-key freshness for stacking): LBL.2 now states the rule + pins it with an integration test.
  - WARN #3 (paid_at label mislabels admin grants as "Оплачен"): admin detail page special-cases `status='granted'` → "Выдан".
  - WARN #5 (receipt='{}' violates PaymentReceipt contract): replaced with structurally valid zero-money receipt.
  - INFO #1 (lock-scope cross-flow safety): confirmed no collision.
  - INFO #4 (store-file.ts parallel coercion): N/A — file backend doesn't go through mapRowToOrder.

### Post-implementation
- [ ] `/codex-paranoia wave <epic-range>` after LBL.2 merge.
