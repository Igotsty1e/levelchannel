# Engineering Backlog

Concrete engineering task queue. This file describes what still needs
to be implemented, not the current actual state of production.

If a task already works in code or on the server, it does not belong
here.

## Cabinet expansion (next phases)

Guest checkout is not touched: subsequent phases are additive.

Already closed and not in the backlog:

- Phase 0 stabilization
- Phase 1A auth foundation
- Phase 1B auth API routes
- Phase 2 auth UI
- Phase 3 profiles + admin pricing — **closed 2026-05-04**. Migrations 0017 / 0018 / 0019. Cabinet got profile editor, consent withdrawal, and 30-day-grace account deletion. Operator-side admin surface at `/admin` (dashboard, accounts list / detail, pricing CRUD) gated by `requireAdminRole`. Bootstrap via `scripts/grant-admin.mjs`. The retention cleanup job picks up rows where `scheduled_purge_at <= now()` and anonymizes them. Public `/pay` left free-amount in this wave; catalog wiring is in this same backlog under "Cabinet Phase 6 deferments". See `docs/plans/phase-3-profiles-admin-pricing.md`.

Open high-level queue:

- Phase 4: scheduling
- Phase 5: lesson lifecycle + 24h rule
- Phase 6: cabinet payment + `payment_allocations` + legal / receipt polish

Before starting any of these, write a fresh in-repo design doc. Code,
owner docs, and git history beat old chat outputs.

## P0

### Production reliability

- ~~wire up uptime / failure alerting on the app~~: **closed 2026-04-29**. GitHub Actions cron `*/5 *` pings `/api/health` and opens / closes an issue tagged `uptime-incident`. Runbook: `OPERATIONS.md §9`. Detection latency ~5–15 min (cron + GH Actions schedule jitter). For sub-minute precision, layer in BetterStack / Healthchecks.io.
- ~~add failure alerting on the **webhook contour** (CloudPayments check / pay / fail)~~: **shipped 2026-04-29 (workflow side; activation requires server-side patch)**. `scripts/webhook-flow-alert.mjs` plus systemd unit / timer (`scripts/systemd/`); every 30 minutes it reads `payment_audit_events` over the last hour and emails via Resend when `(paid + fail) / created < 0.3` with ≥5 created orders. Activation lives in the private operations runbook. Details: `OPERATIONS.md`.
- ~~signal failed git-based deploy or stuck `levelchannel-autodeploy.timer`~~: **shipped 2026-04-29 (workflow side; activation requires server-side patch)**. `.github/workflows/deploy-freshness.yml` compares `main` SHA with `version` from `/api/health` every 30 minutes; opens / closes a `deploy-stale` issue. Activation lives in the private operations runbook. Details: `OPERATIONS.md`.

### Security and payment safety

- ~~move the app-level rate limiter into a shared backend store for a multi-instance future~~: **closed 2026-05-04**. Migration 0016 added `rate_limit_buckets` (bucket_key PK, count, reset_at). `lib/security/rate-limit.ts` rewritten to a Postgres-backed atomic upsert with an in-memory fallback when `DATABASE_URL` is unset or transiently unreachable (warn-and-fall-through, nginx `limit_req` is the last line either way). `enforceRateLimit` is now async; the 21 call sites in `app/api/**` were updated. Cleanup folded into the existing daily systemd timer (`scripts/db-retention-cleanup.mjs`, rows with `reset_at < now() - 1h`). Covered by an in-memory unit suite plus a real-Postgres integration suite under `tests/integration/security/rate-limit.test.ts`.
- ~~add a separate audit log for critical payment transitions~~: **closed 2026-04-29**. Migration 0012 plus `lib/audit/payment-events.ts`; 10 final-state events written from 7 route handlers (`order.created` / `cancelled`, `mock.confirmed`, `webhook.pay.processed`, `webhook.fail.received`, `charge_token.succeeded` / `requires_3ds` / `declined`, `threeds.callback.received` / `confirmed` / `declined`). Best-effort recorder, retention 3 years, full PII under 152-FZ legitimate interest. Docs: `ARCHITECTURE.md` Audit log section, `SECURITY.md` Audit log section, `OPERATIONS.md §5` psql queries.
- ~~add pre-validation phases to audit~~: **closed 2026-04-29**. Migration 0014 plus `lib/payments/cloudpayments-route.ts` refactor; the wrapper now takes `kind: 'check'|'pay'|'fail'` and writes phase-0 (`webhook.<kind>.received`) after parse and phase-1 (`webhook.<kind>.declined` / `webhook.pay.validation_failed`) on validation failure. The old `webhook.fail.received` (semantically a finalize event) was renamed to `webhook.fail.processed`; live data was migrated in the same transaction.
- ~~add `charge_token.attempted`~~: **NOT planned**. `chargeWithSavedCard` creates `invoice_id` inside the function; an `attempted` event has no clean attach point (FK constraint to payment_orders). The outcome events (`succeeded` / `requires_3ds` / `declined`) cover the lifecycle.
- **`charge_token.error` (deferred)**: the sync-error path needs the `chargeWithSavedCard` return type to surface `invoice_id` even on throw. The route's catch currently sends `console.warn` to journald (see `app/api/payments/charge-token/route.ts`). Close it when a real incident with lost context shows up.
- ~~consolidate domain-specific Postgres pools into a shared `lib/db/pool.ts`~~: **closed 2026-04-29**. `lib/db/pool.ts`: `getDbPool()` (throws on missing `DATABASE_URL`) plus `getDbPoolOrNull()` (silent, for audit best-effort). All 5 domain getters (payments / auth / idempotency / telemetry / audit) delegate to the shared singleton; public API at call sites is unchanged. Connection footprint: 5×10=50 max before, `DATABASE_POOL_MAX` (default 10) now.
- ~~set up cron pruning for `payment_audit_events`~~: **shipped 2026-04-29 (workflow side; activation requires SSH)**. `scripts/db-retention-cleanup.mjs` plus systemd unit / timer (04:30 daily) deletes `payment_audit_events > 3 years` and expired rows from `account_sessions` / `email_verifications` / `password_resets` / `idempotency_records`. Activation details live in the private operations runbook.

## P1

### Payment domain

- move from a polling-only model to a more reliable way to deliver the final status to the client
- ~~add lifecycle cleanup for old pending orders~~: **shipped 2026-05-04 (workflow side; activation requires server-side patch)**. `scripts/cancel-stale-orders.mjs` plus systemd unit / timer (`scripts/systemd/`); hourly at minute 7 it finds rows with `status='pending'` and `created_at < now() - <threshold>` (default 60 min, floor 30 min via `STALE_ORDER_THRESHOLD_MINUTES`), runs a per-row tx that flips status to `cancelled`, appends a `payment.cancelled` event with reason `stale_pending_timeout`, and writes a matching `order.cancelled` audit row with `actor='system'`. 4 integration tests cover stale cancel / fresh skip / terminal-status untouched / threshold-floor. Activation lives in the private operations runbook.
- decide whether client-visible reconciliation or an operator-side payment list is needed

### Observability

- ~~hook up error tracking~~: **closed 2026-04-29**. Sentry @sentry/nextjs v10 plus `instrumentation.ts` (Node / Edge), `instrumentation-client.ts` (browser), `app/global-error.tsx`. Project: `mastery-zs/levelchannel`. End-to-end smoke event passed. Production activation lives in the private operations runbook.
- add operator signals for payment failures and webhook failures

### Auth and consent

- ~~add password hash versioning plus a `needsRehash()` path for future cost / algorithm changes~~: **closed 2026-04-29**. `passwordNeedsRehash()` in `lib/auth/password.ts` parses the cost from the bcrypt prefix; the login route silently re-hashes after `verifyPassword` and calls `setAccountPassword`. Best-effort (warn, continue on DB error). Covered by unit and integration tests. Future migration to argon2id: update the regex at the same time as introducing the new hasher, otherwise every login will rehash every time.
- ~~add cleanup for expired `account_sessions`~~: **shipped 2026-04-29**. Folded into `scripts/db-retention-cleanup.mjs` (above).
- ~~add common-password rejection~~: **closed 2026-04-29**. Local denylist in `lib/auth/common-passwords.ts` (~100 top breaches), normalizes case and whitespace; `validatePasswordPolicy` returns `too_common`. HIBP k-anonymity API stays as a future extension if needed.

### Cabinet Phase 6 deferments (parked here so they don't get forgotten)

- **wire `/pay` to the pricing catalog** with a free-amount fallback. Phase 3 ships the catalog table + admin CRUD; the public checkout stays free-amount until the cabinet payment flow lands in Phase 6, at which point both the cabinet payment surface and the public `/pay` form route through the catalog (with a manual-amount fallback for one-off operator-DM payments).
- **collect `phone_e164` on the profile** if and when an operator workflow actually needs to call or Telegram a learner. Until then we don't widen the PD surface.

## P2

### Product and operator tooling

- add a proper operator-side payment list instead of manual DB / file inspection
- add payment funnel telemetry useful for decisions
- ~~add operator email notification for a successful payment~~: **closed 2026-04-29**. Inline in the pay-webhook handler after `markOrderPaid` plus audit. Renders via `lib/email/templates/operator-payment-notify.ts`, dispatched via `sendOperatorPaymentNotification()`. Best-effort (try / catch plus warn). Production activation lives in the private operations runbook. Silent no-op when unset.
- Telegram notification: separate wave if email turns out to be insufficient (needs bot token plus parse_mode reasoning; do it when a real need appears).
- ~~add `POST /api/auth/resend-verify` plus UI button~~: **closed 2026-04-29**. Endpoint in `app/api/auth/resend-verify/route.ts` (authenticated, idempotent, rate-limited 10/min/IP plus 3/hour/account); UI button in `app/cabinet/resend-verify-button.tsx` replaced the Phase 2 hack of linking to `/forgot`.
- ~~add a consent withdrawal model for `account_consents`~~: **closed 2026-04-29**. Migration 0013 added a `revoked_at` column plus partial index `account_consents_active_idx` (where `revoked_at IS NULL`). Store ops in `lib/auth/consents.ts`: `withdrawConsent()` (stamps the latest unrevoked row), `getActiveConsent()` (returns the latest non-revoked). UI / API endpoint goes with Phase 3 admin / cabinet. Covered by 5 integration tests. Implements 152-FZ art.9 §5.
- add a separate `accepted_at`-covering index for `account_consents` if consent-history becomes a real hot path

### DX and quality

- ~~assemble a security regression checklist for releases~~: **closed 2026-04-29**. `docs/security-regression-checklist.md`: 9 sections (code-review gates, tests must be green, auth invariants matrix cross-ref, payment + webhook invariants, audit log invariants, observability, legal scope, post-merge smoke, quarterly drill). First scheduled drill: 2026-07-29.
- ~~widen integration coverage for payment routes~~: **closed 2026-04-29**. `tests/integration/payment/payment-routes.test.ts` covers `POST /api/payments` (create plus amount / consent rejection plus idempotency replay), cancel (success plus 404 plus 400 malformed id), mock-confirm. Each test asserts DB state plus audit event shape. All against a real Docker Postgres in mock-payment mode (via `TEST_INTEGRATION=1`, which makes setup-env switch provider / storage / allowMockConfirm). Webhook handlers: in the next item.
- ~~add an integration test for webhook handlers (HMAC verify path)~~: **closed 2026-04-29**. `tests/integration/payment/webhooks.test.ts` plus helper `tests/integration/payment/sign.ts`. 4 tests: Pay valid → paid plus received / processed audit; HMAC mismatch → 401, no audit; Pay amount-mismatch → received plus validation_failed; Fail valid → failed plus received / processed audit. Order seeding goes through a direct INSERT (not through `createPayment`) because in integration mode the provider is mock and webhook validation requires `provider='cloudpayments'`.
- ~~parameterize the Docker integration stack for parallel CI~~: **closed 2026-04-29**. `docker-compose.test.yml` now reads `LC_TEST_DB_NAMESPACE` (default `default`) and `LC_TEST_DB_PORT` (default 54329) from env. `scripts/test-integration.sh` derives namespace plus port from `LC_TEST_PARALLEL_ID` (sha256 → 8-char suffix plus port window 54330..54429), plus a unique `COMPOSE_PROJECT_NAME`. Single-developer flow stays byte-equal historical defaults; parallel shards / runners no longer fight over the port / container.
- ~~add an integration test for login with an unverified email (Phase 1B D4)~~: **closed 2026-04-29**. `tests/integration/auth/login.test.ts` now contains the test `allows login when email is not yet verified`: registers, asserts `emailVerifiedAt` is null, login returns 200 plus session cookie plus body with `emailVerifiedAt: null`.
- add a real-time signal for `/verify-pending`, only if users actually need it

## Not now

- do not bloat the cabinet beyond auth and payment-adjacent scenarios without a direct business need
- do not collect more personal data at checkout
- do not complicate the payment form without a direct business need
