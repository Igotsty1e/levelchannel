# Architecture

## Overview

The project has two halves:

- a public landing on `Next.js App Router`
- a server-side payment surface inside the same app

Most of the product logic right now sits in the checkout flow and the
processing of payment statuses.

## Layout

### Frontend

- [`app/page.tsx`](app/page.tsx) - server wrapper for the main page; reads the public legal profile on the server and passes it into the client landing component so the home route does not depend on client-side `NEXT_PUBLIC_LEGAL_*` env evaluation
- [`components/home/home-page-client.tsx`](components/home/home-page-client.tsx) - client landing implementation: hero, sections, analytics hooks, sticky header, footer with the server-provided legal profile, and a defensive `IntersectionObserver` fallback for browsers where the API is missing or throws
- [`components/payments/pricing-section.tsx`](components/payments/pricing-section.tsx) - payment UI with a free amount and an e-mail, mandatory consent checkbox on personal-data processing, payment creation, status polling, widget launch, and a saved last-success confirmation on the main page
- [`app/thank-you/page.tsx`](app/thank-you/page.tsx) - payment confirmation page
- [`app/offer/page.tsx`](app/offer/page.tsx) - public oferta
- [`app/privacy/page.tsx`](app/privacy/page.tsx) - personal-data processing policy
- [`app/consent/personal-data/page.tsx`](app/consent/personal-data/page.tsx) - separate text of consent on personal-data processing
- [`app/register/page.tsx`](app/register/page.tsx) - registration (Phase 2): e-mail + password + 152-FZ consent → `POST /api/auth/register`, success → `/verify-pending`
- [`app/verify-pending/page.tsx`](app/verify-pending/page.tsx) - info page after registration
- [`app/login/page.tsx`](app/login/page.tsx) - login (Phase 2): e-mail + password → `POST /api/auth/login`, success → `/cabinet`
- [`app/forgot/page.tsx`](app/forgot/page.tsx) - password reset request (Phase 2): always a neutral confirmation (anti-enumeration)
- [`app/reset/page.tsx`](app/reset/page.tsx) - set a new password by the URL token (Phase 2): on success, `mech-5` has already created a new session
- [`app/cabinet/page.tsx`](app/cabinet/page.tsx) - server-side gate (Phase 2): direct `lookupSession` via cookie, 307 to `/login` without a session. Phase 3 added the profile editor, an admin-only entry-point card, and the destructive «Опасные действия» block (consent withdrawal + 30-day-grace deletion)
- [`app/cabinet/logout-button.tsx`](app/cabinet/logout-button.tsx) - client island: `POST /api/auth/logout` plus redirect to `/`
- [`app/cabinet/profile-editor.tsx`](app/cabinet/profile-editor.tsx) - client island for `PATCH /api/account/profile` (display name + IANA timezone). Phase 3
- [`app/cabinet/danger-zone.tsx`](app/cabinet/danger-zone.tsx) - client island with two destructive actions: withdraw personal-data consent (152-ФЗ ст.9 §5 — disables account, keeps data) and delete account (30-day grace then anonymization). Phase 3
- [`app/admin/layout.tsx`](app/admin/layout.tsx) - admin chrome with `requireAdminRole` gate and a left-side nav. Phase 3
- [`app/admin/page.tsx`](app/admin/page.tsx) - admin dashboard. Phase 3
- [`app/admin/accounts/page.tsx`](app/admin/accounts/page.tsx) - paginated learner list with e-mail search. Phase 3
- [`app/admin/accounts/[id]/page.tsx`](app/admin/accounts/[id]/page.tsx) - learner detail: status, role grants, profile, deletion-grace banner with cancel. Phase 3
- [`app/admin/pricing/page.tsx`](app/admin/pricing/page.tsx) + [`tariff-editor.tsx`](app/admin/pricing/tariff-editor.tsx) - tariff CRUD. Public `/pay` stays free-amount in Phase 3; the catalog wires into checkout in Phase 6
- [`app/admin/admin-action-button.tsx`](app/admin/admin-action-button.tsx) - tiny client island so SSR admin pages can POST to JSON admin routes and reload
- [`app/verify-failed/page.tsx`](app/verify-failed/page.tsx) - styled UI for an expired / used verify link (Phase 2 replaced the Phase 1B placeholder)
- [`components/site-header.tsx`](components/site-header.tsx) - sticky header for auth / legal pages with `useEffect → fetch /api/auth/me` and a «Войти» ↔ «Кабинет» switch
- [`components/auth-shell.tsx`](components/auth-shell.tsx) - common chrome wrapper for auth pages (header + centered column)
- [`components/auth-form-bits.tsx`](components/auth-form-bits.tsx) - shared `AuthField`, `AuthErrorBox`, `AuthInfoBox`, `authInputStyle` for the 4 forms
- [`lib/auth/client.ts`](lib/auth/client.ts) - browser `postAuthJson` helper: a single JSON shape, error normalization, 429 handling

### Payment domain

- [`lib/legal/personal-data.ts`](lib/legal/personal-data.ts) - document version and a server-side snapshot of consent acceptance
- [`lib/payments/catalog.ts`](lib/payments/catalog.ts) - payment constraints, amounts and the service description
- [`lib/payments/types.ts`](lib/payments/types.ts) - order types and the public model
- [`lib/payments/config.ts`](lib/payments/config.ts) - payment env config
- [`lib/payments/provider.ts`](lib/payments/provider.ts) - orchestration: create payment, mark paid / failed, public model
- [`lib/payments/mock.ts`](lib/payments/mock.ts) - mock provider
- [`lib/payments/cloudpayments.ts`](lib/payments/cloudpayments.ts) - building the server-side order and the widget intent for CloudPayments / CloudKassir
- [`lib/payments/cloudpayments-webhook.ts`](lib/payments/cloudpayments-webhook.ts) - webhook payload parsing and verification
- [`lib/payments/cloudpayments-api.ts`](lib/payments/cloudpayments-api.ts) - server-to-server HTTP client for `/payments/tokens/charge` (one-click)
- [`lib/payments/tokens.ts`](lib/payments/tokens.ts) - Token extraction from a webhook and the public card mask
- [`lib/payments/store.ts`](lib/payments/store.ts) - adapter layer; picks file or postgres backend (orders + card tokens)
- [`lib/payments/store-file.ts`](lib/payments/store-file.ts) - file storage for orders and tokens
- [`lib/payments/store-postgres.ts`](lib/payments/store-postgres.ts) - PostgreSQL backend for orders and `payment_card_tokens`
- [`scripts/migrate-payment-orders-to-postgres.mjs`](scripts/migrate-payment-orders-to-postgres.mjs) - one-shot order migration from JSON to PostgreSQL
- [`scripts/public-surface-check.sh`](scripts/public-surface-check.sh) - repo guardrail for public safety: blocks `.env*`, `docs/private/*`, `*.private.*`, and known concrete production identifiers from entering tracked history; used by both the local pre-commit hook and CI

### Auth and account layer

The auth surface already lives in code: tables, `lib/auth/*`,
`lib/email/*` and `app/api/auth/*`. A full cabinet UI is not built
yet, but the backend routes already participate in build and runtime.
Guest checkout still does not depend on this layer.

- [`migrations/0005_accounts.sql`](migrations/0005_accounts.sql) - `accounts` (uuid PK, email UNIQUE, password_hash, email_verified_at, disabled_at)
- [`migrations/0006_account_roles.sql`](migrations/0006_account_roles.sql) - `account_roles` (admin / teacher / student via CHECK)
- [`migrations/0007_account_sessions.sql`](migrations/0007_account_sessions.sql) - `account_sessions` (token_hash UNIQUE, expires_at, revoked_at)
- [`migrations/0008_email_verifications.sql`](migrations/0008_email_verifications.sql) - single-use verify-email tokens (TTL 24h)
- [`migrations/0009_password_resets.sql`](migrations/0009_password_resets.sql) - single-use reset tokens (TTL 1h)
- [`migrations/0010_accounts_email_normalized.sql`](migrations/0010_accounts_email_normalized.sql) - `CHECK (email = lower(btrim(email)))` invariant; defends against shadow accounts when the app layer is bypassed
- [`lib/auth/pool.ts`](lib/auth/pool.ts) - a separate `pg.Pool` for auth, the same DATABASE_URL
- [`lib/auth/password.ts`](lib/auth/password.ts) - bcryptjs, cost=12
- [`lib/auth/tokens.ts`](lib/auth/tokens.ts) - random 32B base64url + sha256 hash; tokens are stored only as a hash
- [`lib/auth/policy.ts`](lib/auth/policy.ts) - password policy (8..128 chars, not all-digit)
- [`lib/auth/accounts.ts`](lib/auth/accounts.ts) - store ops: create / getByEmail / getById / markVerified / setPassword / role grant/revoke + `disableAccount` / `reenableAccount` / `requestAccountDeletion` / `cancelAccountDeletion` (Phase 3 deletion grace) + `listAccounts` for /admin + `normalizeAccountEmail` helper (`trim().toLowerCase()`) - the single normalization point for every read / write path
- [`lib/auth/profiles.ts`](lib/auth/profiles.ts) - store ops + validation for the `account_profiles` table (display_name + timezone + locale). Phase 3
- [`lib/auth/guards.ts`](lib/auth/guards.ts) - `requireAuthenticated` and `requireAdminRole` wrappers used by cabinet + admin route handlers. Phase 3
- [`lib/pricing/tariffs.ts`](lib/pricing/tariffs.ts) - store ops + validation for `pricing_tariffs`. Money lives in kopecks; rubles is a derived display. Phase 3
- [`lib/auth/sessions.ts`](lib/auth/sessions.ts) - create / lookup / revoke + cookie helpers (`lc_session`, HttpOnly + SameSite=Lax + Secure in prod)
- [`lib/auth/single-use-tokens.ts`](lib/auth/single-use-tokens.ts) - common store for verify-email and password-reset (whitelist scope in SQL)
- [`lib/auth/verifications.ts`](lib/auth/verifications.ts), [`lib/auth/resets.ts`](lib/auth/resets.ts) - thin wrappers with TTL
- [`lib/auth/consents.ts`](lib/auth/consents.ts) - store ops for `account_consents` (recordConsent / listAccountConsents / getLatestConsent / **withdrawConsent / getActiveConsent**). The withdrawal model (152-FZ art.9 §5) was added in migration 0013 - a `revoked_at` column plus a partial index on `(account_id, document_kind, accepted_at desc) where revoked_at is null`. Phase 1B D2.
- [`lib/auth/dummy-hash.ts`](lib/auth/dummy-hash.ts) - module-load bcrypt-hashed dummy + `constantTimeVerifyPassword`. Closes e-mail enumeration via login timing (Phase 1B D3).
- [`lib/auth/email-hash.ts`](lib/auth/email-hash.ts) - HMAC-keyed sha256 of the normalized e-mail through `AUTH_RATE_LIMIT_SECRET` for per-email rate-limit scope keys. Do not reuse `TELEMETRY_HASH_SECRET` - different trust boundaries (Phase 1B mech-3).

### Email transport

- [`lib/email/config.ts`](lib/email/config.ts) - `RESEND_API_KEY` + `EMAIL_FROM`. If the key is empty, console fallback. **Production assertions at module load:** `RESEND_API_KEY` and `AUTH_RATE_LIMIT_SECRET` are mandatory under `NODE_ENV=production` - boot aborts if they are empty.
- [`lib/email/client.ts`](lib/email/client.ts) - Resend SDK + dev console writer.
- [`lib/email/escape.ts`](lib/email/escape.ts) - `escapeHtml` for dynamic values in templates (5 dangerous characters).
- [`lib/email/templates/verify.ts`](lib/email/templates/verify.ts), [`lib/email/templates/reset.ts`](lib/email/templates/reset.ts), [`lib/email/templates/already-registered.ts`](lib/email/templates/already-registered.ts) - inline HTML + plain text, RU. The URL is run through `escapeHtml`. `already-registered` covers the existing-email path in the register flow (Phase 1B D1 timing parity).
- [`lib/email/templates/operator-payment-notify.ts`](lib/email/templates/operator-payment-notify.ts) - operator-facing «Платёж получен». Every user-supplied field (transactionId, paymentMethod, customerEmail) goes through `escapeHtml`. Subject of the form `[LevelChannel] Платёж получен: <amount> ₽ - <invoice>`.
- [`lib/email/dispatch.ts`](lib/email/dispatch.ts) - `sendVerifyEmail`, `sendResetEmail`, `sendAlreadyRegisteredEmail`, `sendOperatorPaymentNotification`. URLs are built from `paymentConfig.siteUrl`. Operator dispatch reads `OPERATOR_NOTIFY_EMAIL` env; on empty, silent no-op (returns `{ok:false, reason:'no_recipient'}`).

### Test infrastructure (integration)

- [`docker-compose.test.yml`](docker-compose.test.yml) - `postgres:16.13` service on `127.0.0.1:54329`, tmpfs storage. Exact match with prod.
- [`scripts/test-integration.sh`](scripts/test-integration.sh) - bring up → wait → migrate:up → vitest → tear down. `npm run test:integration`.
- [`.githooks/pre-commit`](.githooks/pre-commit) - local public-surface gate; runs `scripts/public-surface-check.sh --staged`
- [`.github/workflows/public-surface-check.yml`](.github/workflows/public-surface-check.yml) - CI copy of the same guardrail for pull requests and pushes to `main`
- [`vitest.integration.config.ts`](vitest.integration.config.ts) - separate config; `tests/integration/**/*.test.ts`. Unit `npm run test:run` stays fast and free of a Docker dependency.

**Auth invariants covered by the integration suite.** This matrix is the source of truth for which security invariants are already verified by the Postgres-backed tests. If an invariant below is changed in code, the regression must fail in the file shown. Open items are in `ENGINEERING_BACKLOG.md` § DX and quality.

| Invariant | Where covered |
|---|---|
| Register: byte-equal response for known/unknown email (anti-enumeration shape) | [`tests/integration/auth/register.test.ts`](tests/integration/auth/register.test.ts) (`returns identical response for already-registered email`) |
| Register: symmetric wall-clock budget for new vs existing email path (anti-enumeration timing) | [`tests/integration/auth/register.test.ts`](tests/integration/auth/register.test.ts) (`register paths take similar wall-clock time`) |
| Login: constant-time via `dummyHash` for unknown-email vs known-email-wrong-password | [`tests/integration/auth/login.test.ts`](tests/integration/auth/login.test.ts) (`constant-time D3`) |
| Reset: a request for an unknown email returns 200 ok (anti-enumeration) | [`tests/integration/auth/reset.test.ts`](tests/integration/auth/reset.test.ts) (`returns 200 ok for unknown email`) |
| Reset confirm: revoke every session of the account before creating a new one (mech-5 sign-out-everywhere) | [`tests/integration/auth/reset.test.ts`](tests/integration/auth/reset.test.ts) (`signs out everywhere on success (mech-5 invariant)`) |
| Session lifecycle: create / validate / revoke / expiry | [`tests/integration/auth/session-lifecycle.test.ts`](tests/integration/auth/session-lifecycle.test.ts) |
| Login allows unverified email (Phase 1B D4) - cabinet allows, payment gates separately | [`tests/integration/auth/login.test.ts`](tests/integration/auth/login.test.ts) (`allows login when email is not yet verified`) |
| Silent password rehash on a successful login when the stored hash is below the current cost | [`tests/integration/auth/login.test.ts`](tests/integration/auth/login.test.ts) (`silently upgrades a legacy lower-cost password hash`) |
| Payment route create + idempotency replay + amount / consent rejection (mock provider, postgres backend) | [`tests/integration/payment/payment-routes.test.ts`](tests/integration/payment/payment-routes.test.ts) |
| Payment route cancel + mock-confirm transitions, audit events written for each | [`tests/integration/payment/payment-routes.test.ts`](tests/integration/payment/payment-routes.test.ts) |
| CloudPayments Pay/Fail webhooks: HMAC verify, validation, status transitions, audit phases | [`tests/integration/payment/webhooks.test.ts`](tests/integration/payment/webhooks.test.ts) (test-side HMAC via [`tests/integration/payment/sign.ts`](tests/integration/payment/sign.ts)) |

### Audit log (payment lifecycle)

Append-only audit-log-of-record for money-bound transitions. A
parallel channel to `payment_telemetry` (which is privacy-friendly
funnel analytics, HMAC e-mail + /24 IP) - the audit log keeps the full
e-mail and full IP for incident investigation. Admin-only access; see
`SECURITY.md § Audit log - payment lifecycle`.

- [`migrations/0012_payment_audit_events.sql`](migrations/0012_payment_audit_events.sql) - append-only table. CHECK enum on `event_type`, FK `invoice_id` → `payment_orders` ON DELETE NO ACTION (audit outlives the order), structured columns plus a JSONB `payload`. Indexes: per-invoice, per-account (partial WHERE NOT NULL), per-type-time.
- [`migrations/0014_payment_audit_events_more_phases.sql`](migrations/0014_payment_audit_events_more_phases.sql) - extends the enum to 17 types: adds phase-0 events for webhooks (`webhook.check.received`, `webhook.pay.received`, `webhook.fail.received`) and validation-failure events (`webhook.check.declined`, `webhook.pay.validation_failed`, `webhook.fail.declined`). The old `webhook.fail.received` (semantically finalize) is renamed to `webhook.fail.processed` via UPDATE in the same transaction. `customer_email` becomes nullable (a phase-0 event does not always carry a verified e-mail). `charge_token.attempted` / `charge_token.error` are intentionally NOT added - there is no clean attach point (FK to `payment_orders` requires `invoice_id`).
- [`lib/audit/payment-events.ts`](lib/audit/payment-events.ts) - `recordPaymentAuditEvent(...)` (best-effort: catch + warn + return false; does not throw, so the business path does not fall over). `listPaymentAuditEventsByInvoice(invoiceId)` for admin tooling. Export of `PAYMENT_AUDIT_EVENT_TYPES` is the single source of truth for the enum and must match the migration CHECK (covered by an integration test).
- [`lib/audit/pool.ts`](lib/audit/pool.ts) - thin re-export → `getDbPoolOrNull()` from the common `lib/db/pool.ts`. The `OrNull` shape is needed because the recorder is best-effort (silent skip without DATABASE_URL).
- [`lib/db/pool.ts`](lib/db/pool.ts) - the single pg Pool for the project (5 domain pools were consolidated 2026-04-29). `getDbPool()` throws when DATABASE_URL is missing; `getDbPoolOrNull()` does a silent skip. Cap via `DATABASE_POOL_MAX` env (default 10).

Write points (route handlers):

- [`app/api/payments/route.ts`](app/api/payments/route.ts) → `order.created`
- [`app/api/payments/[invoiceId]/cancel/route.ts`](app/api/payments/[invoiceId]/cancel/route.ts) → `order.cancelled`
- [`app/api/payments/mock/[invoiceId]/confirm/route.ts`](app/api/payments/mock/[invoiceId]/confirm/route.ts) → `mock.confirmed`
- [`app/api/payments/charge-token/route.ts`](app/api/payments/charge-token/route.ts) → `charge_token.succeeded` / `charge_token.requires_3ds` / `charge_token.declined`
- [`app/api/payments/3ds-callback/route.ts`](app/api/payments/3ds-callback/route.ts) → `threeds.callback.received` + `threeds.confirmed` / `threeds.declined`
- [`app/api/payments/webhooks/cloudpayments/pay/route.ts`](app/api/payments/webhooks/cloudpayments/pay/route.ts) → `webhook.pay.processed` (plus `webhook.pay.received` / `.validation_failed` via the wrapper)
- [`app/api/payments/webhooks/cloudpayments/fail/route.ts`](app/api/payments/webhooks/cloudpayments/fail/route.ts) → `webhook.fail.processed` (plus `webhook.fail.received` / `.declined` via the wrapper)
- [`app/api/payments/webhooks/cloudpayments/check/route.ts`](app/api/payments/webhooks/cloudpayments/check/route.ts) → `webhook.check.received` / `.declined` via the wrapper (no business handler - Check only validates)
- [`lib/payments/cloudpayments-route.ts`](lib/payments/cloudpayments-route.ts) - wrapper handles HMAC verify → parse → order lookup → audit phase-0 (`received`) → validate → audit phase-1 (`declined` / `validation_failed`) → call `handler(payload)` for business finalize

Not covered (see `ENGINEERING_BACKLOG.md` for context):
- `charge_token.error` - the sync-error path in `chargeWithSavedCard` may throw before or after the order INSERT; a return-type refactor to `{kind:'error', invoiceId, reason}` is needed before an audit row can be honestly attached. For now, sync errors land in `console.warn` (journald). `charge_token.attempted` is not needed (see backlog rationale).
- HMAC fail / parse fail for webhooks: `invoice_id` is unreliable at this point (FK constraint), so an audit row is not written. These rejections stay in nginx + journal logs.

### Error tracking (Sentry)

- [`instrumentation.ts`](instrumentation.ts) - Next.js auto-loaded boot hook; init Sentry SDK for the `nodejs` or `edge` runtime. Re-exports `onRequestError` for server-component / route-handler error capture.
- [`instrumentation-client.ts`](instrumentation-client.ts) - browser SDK init; `onRouterTransitionStart` for router traces.
- [`app/global-error.tsx`](app/global-error.tsx) - top-level React error boundary; `Sentry.captureException` plus a Russian fallback UI.
- [`next.config.js`](next.config.js) - wrapped in `withSentryConfig({ org: 'mastery-zs', project: 'levelchannel', silent: !CI })`. The CSP in the same file allows `*.ingest.{de.,}sentry.io` in `connect-src` plus `worker-src 'self' blob:`.
- DSN from env: `SENTRY_DSN` (server) + `NEXT_PUBLIC_SENTRY_DSN` (browser). Without a DSN the SDK becomes a no-op. The optional `SENTRY_AUTH_TOKEN` is needed for source-maps upload at `npm run build`.
- `tracesSampleRate=0.1`, `sendDefaultPii: false` in both inits. `release: process.env.GIT_SHA` - once the server-side patch is active, Sentry groups issues by release.

### Schema migrations

- [`scripts/migrate.mjs`](scripts/migrate.mjs) - minimal self-contained runner on top of `pg`. Commands: `npm run migrate:up`, `npm run migrate:status`. Applies `migrations/NNNN_*.sql` files in order inside transactions and records the names in `_migrations`.
- [`migrations/`](migrations) - SQL migrations, one per schema change.
  - `0001_payment_orders.sql`, `0002_payment_card_tokens.sql`, `0003_payment_telemetry.sql`, `0004_idempotency_records.sql` - repeat the existing `ensureSchema*` via `create ... if not exists`. On a prod DB where the tables already exist, `npm run migrate:up` brings the schema under bookkeeping with no diff.
- The legacy `ensureSchema*` functions in `lib/payments/store-postgres.ts`, `lib/security/idempotency-postgres.ts`, `lib/telemetry/store-postgres.ts` stay as a safety net. Once the runner is wired into the deploy pipeline and has rolled at least once on prod, they can be removed gradually - but not in this cycle.

### Security layer

- [`scripts/cancel-stale-orders.mjs`](scripts/cancel-stale-orders.mjs) - hourly systemd job that flips abandoned pending orders to `cancelled` past `STALE_ORDER_THRESHOLD_MINUTES` (default 60, floor 30). Per-row tx writes the order event + audit row. Reference unit / timer in `scripts/systemd/levelchannel-stale-orders.{service,timer}`
- [`lib/payments/status-bus.ts`](lib/payments/status-bus.ts) - in-process `EventEmitter` for payment status transitions; `markOrderPaid` / `markOrderFailed` / `markOrderCancelled` emit on real transitions only. Multi-instance future swaps to PG `LISTEN/NOTIFY` without changing call sites
- [`lib/scheduling/slots.ts`](lib/scheduling/slots.ts) - Phase 4 store ops + bulk-preview generator. Atomic UPDATE-with-`status='open'` re-assert for concurrent-book races; UTC-stored `start_at`, IANA tz at render. Phase 5 added `canLearnerCancel` (24h pure helper), `markSlotLifecycle` (operator stamp on past-booked rows), `autoCompletePastBookedSlots` (cron sweep). `/api/slots/*` (cabinet — list available + mine + book + cancel with 24h gate) and `/api/admin/slots/*` (admin — single + bulk-preview + bulk-create + edit + delete + cancel + book-as-operator + lifecycle mark). Cabinet UI at [`app/cabinet/lessons-section.tsx`](app/cabinet/lessons-section.tsx) splits Предстоящие / Прошедшие and surfaces the «<24ч — через оператора» hint; admin UI at [`app/admin/slots/`](app/admin/slots) with weekday-grid bulk preview-deselect-commit flow + per-row lifecycle buttons
- [`scripts/auto-complete-slots.mjs`](scripts/auto-complete-slots.mjs) - daily systemd job (03:30 UTC) that flips still-`booked` lesson_slots rows whose `start_at + duration_minutes` has elapsed to `completed`. Reference unit / timer in `scripts/systemd/levelchannel-auto-complete-slots.{service,timer}`
- [`lib/payments/allocations.ts`](lib/payments/allocations.ts) - Phase 6 payment_allocations store ops: `recordAllocation` (best-effort insert from the Pay webhook on `metadata.slotId`), `listAllocationsForOrder`, `listSlotPaidStatus(slotIds[])` for the cabinet-side bulk «оплачено» check
- [`lib/payments/admin-list.ts`](lib/payments/admin-list.ts) + [`app/admin/payments/`](app/admin/payments) - operator-side payment list at `/admin/payments` with status / e-mail filters and pagination + detail page at `/admin/payments/[invoiceId]` showing the order, audit events trail, and payment_allocations with linked lesson_slots
- [`app/checkout/[tariffSlug]/page.tsx`](app/checkout/[tariffSlug]/page.tsx) + [`checkout-form.tsx`](app/checkout/[tariffSlug]/checkout-form.tsx) - tariff-bound public checkout. Runs in parallel with `/pay` (which stays free-amount). Optional `?slot=<uuid>` binds the resulting paid invoice to a `lesson_slot` via `payment_allocations` written from the CloudPayments Pay webhook handler
- [`app/api/payments/[invoiceId]/stream/route.ts`](app/api/payments/[invoiceId]/stream/route.ts) - SSE endpoint for live payment status. Initial state from DB, server-pushed transitions via the status bus, heartbeat every 25 s, hard cap 5 min, `X-Accel-Buffering: no` so nginx doesn't buffer. Replaces the old 4-second poll in `pricing-section.tsx`; a slow 10-second poll stays as a fallback for ad-blockers / corporate proxies that strip `text/event-stream`
- [`lib/email/templates/operator-payment-failure.ts`](lib/email/templates/operator-payment-failure.ts) + [`sendOperatorPaymentFailureNotification`](lib/email/dispatch.ts) - per-event operator email on terminal payment failure (Fail webhook, 3DS decline). Best-effort, silent skip when `OPERATOR_NOTIFY_EMAIL` unset. Aggregate webhook-flow alert continues to watch low-ratio trends in parallel
- [`lib/security/request.ts`](lib/security/request.ts) - origin checks, invoice id validation, per-IP rate limiting (`enforceRateLimit` is async)
- [`lib/security/rate-limit.ts`](lib/security/rate-limit.ts) - shared-store rate limiter. Postgres-backed bucket (table `rate_limit_buckets`, migration 0016) with an in-memory fallback when `DATABASE_URL` is unset or transiently unreachable. Atomic upsert with fixed-window semantics; the same counter agrees across replicas. Cleanup folded into `scripts/db-retention-cleanup.mjs` (rows with `reset_at` older than 1 hour are removed daily)
- [`next.config.js`](next.config.js) - security headers for the Node deployment
- [`public/.htaccess`](public/.htaccess) - security headers for Apache

### Auth API routes (Phase 1B Lane B)

- [`app/api/auth/register/route.ts`](app/api/auth/register/route.ts) - POST. Symmetric work for the new vs existing e-mail path; consent recording on new accounts (D1)
- [`app/api/auth/verify/route.ts`](app/api/auth/verify/route.ts) - GET click-through; no origin check (mech-4); consumes a single-use token; 303 → `/cabinet` on success, `/verify-failed` on failure
- [`app/api/auth/login/route.ts`](app/api/auth/login/route.ts) - POST. constantTimeVerifyPassword (D3); identical 401 for unknown / disabled / wrong-password (anti-enumeration); allows login on an unverified e-mail (D4)
- [`app/api/auth/logout/route.ts`](app/api/auth/logout/route.ts) - POST. Revokes the session, clears the cookie. Replay-safe.
- [`app/api/auth/reset-request/route.ts`](app/api/auth/reset-request/route.ts) - POST. Identical `{ok: true}` for known / unknown e-mail (anti-enumeration)
- [`app/api/auth/reset-confirm/route.ts`](app/api/auth/reset-confirm/route.ts) - POST. revokeAllSessionsForAccount **before** createSession (mech-5); the password-policy gate keeps the token unconsumed on weak input
- [`app/api/auth/me/route.ts`](app/api/auth/me/route.ts) - GET. Bootstrap; same-origin, no origin check; 401 with cookie cleared on missing / expired session
- [`app/api/auth/resend-verify/route.ts`](app/api/auth/resend-verify/route.ts) - POST. Authenticated; idempotent on already-verified (200 noop); rate-limited 10/min/IP plus 3/hour/account. Replaces the Phase 2 cabinet hack of pointing at `/forgot`. Old unconsumed verify tokens are NOT pre-emptively invalidated - single-use enforcement at consume time covers the race
- [`app/cabinet/resend-verify-button.tsx`](app/cabinet/resend-verify-button.tsx) - client island for the cabinet banner button
- [`app/verify-failed/page.tsx`](app/verify-failed/page.tsx) - minimal placeholder for the verify-route failure landing (Lane C; full UI in Phase 2)

### API routes

- [`app/api/payments/route.ts`](app/api/payments/route.ts) - payment creation
- [`app/api/payments/[invoiceId]/route.ts`](app/api/payments/%5BinvoiceId%5D/route.ts) - status
- [`app/api/payments/[invoiceId]/cancel/route.ts`](app/api/payments/%5BinvoiceId%5D/cancel/route.ts) - cancellation
- [`app/api/payments/events/route.ts`](app/api/payments/events/route.ts) - client telemetry
- [`app/api/payments/saved-card/route.ts`](app/api/payments/saved-card/route.ts) - does this e-mail have a saved card (one-click)
- [`app/api/payments/charge-token/route.ts`](app/api/payments/charge-token/route.ts) - charge by stored token (one-click)
- [`app/api/payments/3ds-callback/route.ts`](app/api/payments/3ds-callback/route.ts) - finalize payment after 3-D Secure (TermUrl)
- [`app/api/health/route.ts`](app/api/health/route.ts) - health check for monitoring
- [`app/api/payments/mock/[invoiceId]/confirm/route.ts`](app/api/payments/mock/%5BinvoiceId%5D/confirm/route.ts)
- [`app/api/payments/webhooks/cloudpayments/check/route.ts`](app/api/payments/webhooks/cloudpayments/check/route.ts)
- [`app/api/payments/webhooks/cloudpayments/pay/route.ts`](app/api/payments/webhooks/cloudpayments/pay/route.ts) - also stores Token for one-click
- [`app/api/payments/webhooks/cloudpayments/fail/route.ts`](app/api/payments/webhooks/cloudpayments/fail/route.ts)

### One-click flow

1. After a successful payment CloudPayments delivers `Token` in the Pay webhook
   (along with `CardLastFour`, `CardType`, `CardExpDate`).
2. The server saves the token in `payment_card_tokens`, bound to the normalized
   `customerEmail`.
3. On the next visit the frontend calls `POST /api/payments/saved-card`
   with the e-mail. If a record is there, a public mask comes back (last4 + type).
4. The user clicks «Оплатить картой ··NNNN» → `POST /api/payments/charge-token`.
5. The server creates an order, calls `POST https://api.cloudpayments.ru/payments/tokens/charge`
   with HTTP Basic (`Public ID : API Secret`) and branches on the response:
   - `Success: true` → order `paid`, the token's `last_used_at` is updated.
   - `AcsUrl + PaReq` → the client builds an auto-submit form to the bank's ACS;
     the user passes 3DS; the bank POSTs back to
     `/api/payments/3ds-callback`; we call `post3ds` and finalize.
   - decline → order `failed`; for critical ReasonCodes the token is removed.

## Payment flow

### Mock mode

1. The user enters an amount and an e-mail.
2. The frontend calls `POST /api/payments`.
3. The server creates an order through the `mock` provider.
4. The frontend polls `GET /api/payments/[invoiceId]`.
5. The status flips to `paid` automatically on a timer.

### CloudPayments mode

1. The user enters an amount and an e-mail.
2. The frontend calls `POST /api/payments`.
3. The backend checks the separate consent on personal-data processing and saves a proof of consent in the order metadata.
4. The server creates an internal `invoiceId`, an order and a widget intent.
5. The client launches the CloudPayments Widget on top of the site.
6. `externalId`, `receiptEmail`, `receipt`, `userInfo.email` are passed into the widget.
7. After payment CloudPayments delivers a webhook.
8. The server validates the signature, the amount and the `AccountId`.
9. The client sees the final status through polling, the `/thank-you` page and a saved success card on the main page after returning.

## Order storage

Storage is now picked through `PAYMENTS_STORAGE_BACKEND`.

Options:

- `file` - JSON file in the `data/` directory
- `postgres` - `payment_orders` table in PostgreSQL

Pros:

- simple
- convenient for local checks and the MVP
- no external infrastructure required

Cons:

- not suitable for a multi-instance deployment
- no DB-level transactionality
- limited scalability

Current production target: `PostgreSQL`.

## Deployment model

The current architecture requires a server runtime.

Suitable options:

- Vercel
- VPS plus `next start`
- any Node.js hosting with a long-lived process

Not suitable:

- a pure static export with no backend runtime

## Source of truth

If documents disagree:

1. code
2. the topic-owning specialized doc from `DOCUMENTATION.md`
3. `README.md`
4. `ROADMAP.md` and `ENGINEERING_BACKLOG.md` - only as the intent layer
5. `PRD.md` as a historical document
