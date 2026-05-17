# lib/payments — payment orders + CloudPayments contour

> **Trust boundary:** money-moving. `cloudpayments-webhook.ts` + `store-postgres.ts` are on the **critical-path inventory** (`docs/critical-path.md`). PRs touching them MUST carry `Codex-Paranoia: SIGN-OFF`.

## Purpose

Owns:
- **CloudPayments wire protocol** — HMAC verification, replay-dedup, signed-body parsing. `cloudpayments-webhook.ts` is the single source of truth.
- **Payment-orders CRUD** — `store-postgres.ts` is the only writer of `payment_orders`. Transitions `pending → paid → refunded` happen here, always inside an audit-emit-in-same-TX wrapper.
- **CloudPayments API** — outgoing calls to `payments/cards/charge` + `payments/refund` (`cloudpayments-api.ts`). Basic-Auth via Public ID + API Secret. Retry semantics, decline classification, JSON-shape guards.
- **Allocations** — `payment_allocations` writes from the Pay webhook. `allocations.ts` is the bookkeeping pair to `lib/billing/package-grant.ts`.
- **Receipt-token gate** — dual-mode (token + session-fallback) for `/api/payments/[invoiceId]/{route,cancel,stream}`. See `lib/payments/receipt-token-gate.ts` + `receipt-gate-session.ts`.
- **Status bus** — in-process `EventEmitter` for `markOrderPaid` / `Failed` / `Cancelled` transitions; SSE endpoint streams these.

## Files

| File | Role |
|---|---|
| `store-postgres.ts` | payment_orders CRUD; sole writer of `status` transitions |
| `cloudpayments-webhook.ts` | HMAC verify + replay-dedup + parse |
| `cloudpayments-api.ts` | outgoing charge/refund; Basic-Auth; decline classification |
| `cloudpayments-route.ts` | webhook route helpers (rate-limit, kind dispatch) |
| `cloudpayments.ts` | provider shim |
| `allocations.ts` | `payment_allocations` writes + read helpers (`listSlotPaidStatus`) |
| `admin-list.ts` | `/admin/payments` list query |
| `catalog.ts` | tariff catalog + e-mail validation + `formatRubles` helper |
| `status-bus.ts` | in-process EventEmitter for status transitions |
| `receipt-token-gate.ts` | constant-time token compare; load-bearing gate |
| `receipt-gate-session.ts` | learner-session fallback consumer (anti-spoof: rejects admin/teacher) |
| `tokens.ts` | hashing helpers for receipt tokens |
| `config.ts` | env-driven config; imports captured at module load (cannot be re-stubbed at test runtime) |
| `webhook-dedup.ts` | `webhook_deliveries` row + fingerprint write |

## Invariants

1. **HMAC verify happens BEFORE rate-limit consumes budget** (`cloudpayments-route.ts`). Unsigned floods get rejected at HMAC step, not at limit. Rate-limit is post-HMAC defense-in-depth (60/min/IP/kind).
2. **`paymentConfig` is import-time captured.** Tests that need different env values must set them BEFORE the first import. `vi.stubEnv` after import doesn't affect `publicId/apiSecret`.
3. **Webhook dedup is by `(provider, kind, transaction_id)` + sha256 fingerprint.** A retried delivery with matching fingerprint replays the cached response (`Webhook-Replay: true` header). Mismatched fingerprint does NOT trust the cache.
4. **`pg_advisory_xact_lock(hashtext("cp:<kind>:<txId>"))`** serializes concurrent retries arriving milliseconds apart. The `markOrderPaid` + audit + operator email + allocation all run exactly once.
5. **`status` writes always audit-emit in same TX.** `store-postgres.ts:markOrderPaid` etc. is the contract.
6. **Receipt-token gate is constant-time string compare.** No early-return on length mismatch (would leak length).
7. **`receipt-gate-session.ts` rejects elevated sessions** (admin/teacher) at the consumer layer, BEFORE threading account id into the gate. The gate itself is dumb equality.

## Cross-references

- `ARCHITECTURE.md §Payment flow` + `§Order storage` — high-level.
- `PAYMENTS_SETUP.md` — operator runbook + provider config.
- `docs/critical-path.md §Money-moving` — the 2 files in this module that are load-bearing.
- `lib/billing/README.md` — billing pairs with payments (`payment_allocations` ↔ `package_purchases`).
- `migrations/0001_payment_orders.sql` + `0025_payment_audit_events_pgcrypto.sql` (at-rest encryption) — schema.

## Test surface

- `tests/payments/*.test.ts` — unit (mock fetch + in-memory).
- `tests/integration/payment/*.test.ts` — live Postgres + signed webhook bodies (`tests/integration/payment/sign.ts`).
- Coverage: `vitest.config.ts` `include` lists this module; thresholds ratchet ≥ 85% lines / 80% branches as of COVERAGE-PAYMENTS 2026-05-18.
