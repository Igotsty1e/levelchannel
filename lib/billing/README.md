# lib/billing — money flow

> **Trust boundary:** money-equivalent. 4 of the 8 files in this module are on the **critical-path inventory** (`docs/critical-path.md`). PRs touching `package-grant.ts`, `consumption.ts`, `reversals.ts`, `paid-state.ts` MUST carry `Codex-Paranoia: SIGN-OFF`.

## Purpose

Owns:
- **Package grants** — `processPackageGrant` writes `package_purchases` + `payment_allocations` atomically under the `pg-stack:` advisory lock prefix. Idempotent on `payment_order_id`. Money-equivalent grants from a paid order.
- **Package consumption** — `consumePackageUnit` debits a unit on slot booking; `restorePackageConsumption` restores on cancel. FIFO across active purchases; race-safe via consumption-row PK on `slot_id`.
- **Refund reversals** — `payment_allocation_reversals` ledger. Binary all-or-nothing for derived `paid` state (`paid-state.ts`).
- **Paid-not-granted reconciliation** — `paid-not-granted.ts` queries are the source of truth for the `/admin/reconciliation/package-grants` dashboard.
- **Deletion guard** — `deletion-guard.ts` blocks account anonymization while a pending or paid-not-granted package order exists. Mirrored as inline SQL in `scripts/db-retention-cleanup.mjs` (mjs can't import ts).

## Files

| File | Role |
|---|---|
| `package-grant.ts` | `processPackageGrant`; atomic insert under `pg-stack:` advisory lock |
| `consumption.ts` | `consumePackageUnit` + `restorePackageConsumption`; FIFO across purchases |
| `reversals.ts` | refund reversal ledger; binary paid-state |
| `paid-state.ts` | derived `paid` flag = sum(allocations) >= expected; partial refund stays paid |
| `paid-not-granted.ts` | reconciliation list query |
| `deletion-guard.ts` | account anonymize gate; SQL-mirrored in retention cleanup |
| `refund-attempts.ts` | `payment_refund_attempts` write path |
| `refund-reconcile.ts` | watchdog for stuck pending refunds (`DEFAULT_PENDING_TIMEOUT_MINUTES = 30`) |
| `packages/` | catalog reads (`listAccountActivePackages`, `learnerHasActivePackageOfDuration`); sub-folder for catalog vs purchases vs eligibility |

## Invariants (must survive future changes)

1. **All money writes inside one TX.** `package_purchases` + `payment_allocations` always written together. Audit event written by the caller (`processPackageGrant` audit-emits the success/failure; webhook handler audit-emits the dispatch).
2. **`pg-stack:` advisory-lock prefix** — shared between learner-buy + admin-grant + webhook-grant code paths. Different prefix would not serialize across paths. See `~/.claude/projects/-Users-ivankhanaev-LevelChannel/memory/advisory_lock_prefix_unification.md`.
3. **`payment_order_id` is the idempotency key** for grants. `package_purchases.payment_order_id UNIQUE` enforces single grant per paid order.
4. **`count_remaining > 0` filter MUST live in SQL** for eligibility helpers — moving to JS allowed an earlier exhausted purchase to shadow a later active one (PKG-LEARNER-BUY paranoia BLOCKER #1).
5. **Refund accounting is binary** — a partially-refunded allocation keeps the slot in the paid bucket. Full refunds flip the slot to refunded-only.

## Cross-references

- `ARCHITECTURE.md §Payment domain` + `§API routes` — public API surface.
- `docs/plans/prepay-postpay-billing.md` — design spec.
- `docs/plans/pkg-recon.md` + `pkg-learner-buy.md` + `pkg-admin-grant.md` — wave plans.
- `docs/critical-path.md §Money-moving` — the 4 files in this module that are load-bearing.
- `migrations/0033_billing_packages_and_postpaid.sql` + `0036_payment_allocation_reversals.sql` — schema.

## How to extend

- Adding a new money-moving operation: write the SQL inside ONE transaction including the audit event. Bind the advisory lock if the new write contends with `pg-stack:` invariants.
- Adding a new refund kind: extend `reversals.ts` ledger first; `paid-state.ts` derives from it.
- Schema changes: prefer additive (new nullable column) over destructive. The `billing-packages_and_postpaid` trigger blocks economic-field edits post-purchase.
