# Architecture

## Overview

The project has two halves:

- a public landing on `Next.js App Router`
- a server-side payment surface inside the same app

Most of the product logic right now sits in the checkout flow and the
processing of payment statuses.

## Per-module READMEs (2026-05-18, DOC-MODULE-CONTRACTS)

Module-specific contracts + invariants + file inventory live next to each module's code. This file stays as the top-level overview + cross-module diagram + API surface map. When in doubt about a module's invariants, the per-module README is the canonical source.

- [`lib/billing/README.md`](lib/billing/README.md) — package grants, consumption, refund reversals (4 critical-path files).
- [`lib/payments/README.md`](lib/payments/README.md) — CloudPayments wire protocol, payment-orders CRUD, allocations (2 critical-path files).
- [`lib/auth/README.md`](lib/auth/README.md) — sessions, guards, learner-archetype, single-use tokens (3 critical-path files).
- [`lib/scheduling/README.md`](lib/scheduling/README.md) — slot lifecycle, atomic cancel/book, MSK band, env-tunable 24h gate (2 critical-path files).
- [`lib/calendar/README.md`](lib/calendar/README.md) — Google OAuth, pull/push workers, channel renewer, conflict detector (2 critical-path files).
- [`lib/admin/README.md`](lib/admin/README.md) — operator-tunable settings, probe-status (4 alert probes + 1 digest sibling surface), conflict-feed reader, digest-summary reader (1 critical-path file).
- [`lib/security/README.md`](lib/security/README.md) — idempotency, rate-limit, origin gate (2 critical-path files).

The critical-path inventory (`docs/critical-path.md`) lists the 25 load-bearing files across these modules (refreshed 2026-05-21 at CRITICAL-PATH-INVENTORY epic close; additions since the 20-file baseline — `lib/auth/teacher-invites.ts` (SAAS-3+4), `app/api/payments/sbp/create-qr/route.ts` (SBP-PAY), `lib/admin/conflict-feed.ts` (BCS-DEF-2), `scripts/teacher-daily-digest.mjs` (BCS-DEF-5), `scripts/learner-reminder-dispatch.mjs` (BCS-DEF-4)). PRs touching any of them MUST carry `Codex-Paranoia: SIGN-OFF`.

## Layout

### Frontend

- [`app/page.tsx`](app/page.tsx) - server wrapper for the public 1:1 English-teacher landing at `/`; reads the public legal profile on the server and passes it into the client landing component so the home route does not depend on client-side `NEXT_PUBLIC_LEGAL_*` env evaluation
- [`components/home/home-page-client.tsx`](components/home/home-page-client.tsx) - client implementation of the restored public landing about Anastasia: hero, teaching formats, results, teacher section, pricing CTA, analytics hooks, sticky header, footer with the server-provided legal profile, and a defensive `IntersectionObserver` fallback for browsers where the API is missing or throws
- [`app/saas/page.tsx`](app/saas/page.tsx) - temporary test surface for the teacher SaaS landing; server wrapper that reuses the same public legal profile as `/` but sets route-level `noindex` metadata
- [`components/home/teacher-landing-client.tsx`](components/home/teacher-landing-client.tsx) - client implementation of the teacher-acquisition SaaS landing moved off `/` onto `/saas`
- [`components/payments/pricing-section.tsx`](components/payments/pricing-section.tsx) - payment UI with a free amount and an e-mail, mandatory consent checkbox on personal-data processing, payment creation, status polling, widget launch, and a saved last-success confirmation on the main page
- [`app/thank-you/page.tsx`](app/thank-you/page.tsx) - payment confirmation page
- [`app/offer/page.tsx`](app/offer/page.tsx) - public oferta
- [`app/privacy/page.tsx`](app/privacy/page.tsx) - personal-data processing policy
- [`app/consent/personal-data/page.tsx`](app/consent/personal-data/page.tsx) - separate text of consent on personal-data processing
- [`app/register/page.tsx`](app/register/page.tsx) - registration (Phase 2): e-mail + password + 152-FZ consent → `POST /api/auth/register`, success → `/verify-pending`. SAAS-3 (2026-05-18): adds a `я ученик / я учитель` radio (default = student). SAAS-4 (2026-05-18): when `?invite=<token>` is present, the role radio is hidden, role is force-locked to student, the token rides along in the POST body for atomic redeem-and-bind via `redeemInviteAndBindLearnerAtomic`
- [`app/verify-pending/page.tsx`](app/verify-pending/page.tsx) - info page after registration
- [`app/login/page.tsx`](app/login/page.tsx) - login (Phase 2): e-mail + password → `POST /api/auth/login`, success → `/cabinet`
- [`app/forgot/page.tsx`](app/forgot/page.tsx) - password reset request (Phase 2): always a neutral confirmation (anti-enumeration)
- [`app/reset/page.tsx`](app/reset/page.tsx) - set a new password by the URL token (Phase 2): on success, `mech-5` has already created a new session
- [`app/cabinet/page.tsx`](app/cabinet/page.tsx) - server-side gate (Phase 2): direct `lookupSession` via cookie, 307 to `/login` without a session. SAAS-5 (2026-05-18): ProfileEditor + DangerZone moved off this surface to keep lessons dominant; main page now renders a header-right `Профиль` link to `/cabinet/profile` + `LogoutButton`. Bug #1 (2026-06-02) added a server-side `getPaymentMethodForPair` per-teacher derivation so the page can render [`components/cabinet/missing-payment-method-banner.tsx`](components/cabinet/missing-payment-method-banner.tsx) above the «Открыть календарь» / «Записаться к этому учителю» CTAs whenever `learner_billing_preferences.payment_method = 'none'` (or no row) for the (teacher, learner) pair; multi-teacher learners carry the per-pair method on `TeacherBlock.paymentMethod` via [`lib/cabinet/teacher-blocks.ts`](lib/cabinet/teacher-blocks.ts). The booking-side gate at `lib/scheduling/slots/booking.ts:249-252` remains as defense-in-depth (route handler now maps `payment_method_not_set` → 422 with the same copy so stale-tab learners no longer see the misleading generic 409)
- [`app/cabinet/profile/page.tsx`](app/cabinet/profile/page.tsx) - SAAS-5 sub-route hosting ProfileEditor + DangerZone behind a single link. Same auth gate as `/cabinet` (cookies → `lookupSession` → admin → `/admin`); learners + teachers both reach this page. `metadata.robots = noindex,nofollow`
- [`app/cabinet/logout-button.tsx`](app/cabinet/logout-button.tsx) - client island: `POST /api/auth/logout` plus redirect to `/`
- [`app/cabinet/profile-editor.tsx`](app/cabinet/profile-editor.tsx) - client island for `PATCH /api/account/profile` (display name + IANA timezone). Phase 3. Mounted on `/cabinet/profile` (SAAS-5 2026-05-18 moved it off `/cabinet`)
- [`app/cabinet/danger-zone.tsx`](app/cabinet/danger-zone.tsx) - client island with two destructive actions: withdraw personal-data consent (152-ФЗ ст.9 §5 — disables account, keeps data) and delete account (30-day grace then anonymization). Phase 3. Mounted on `/cabinet/profile` (SAAS-5 2026-05-18 moved it off `/cabinet`)
- [`app/cabinet/billing-sections.tsx`](app/cabinet/billing-sections.tsx) - client island with two cards: «Мои пакеты» (active package list with `countRemaining` progress + expiry; reads `/api/account/packages`) and «К оплате» (postpaid debt list with «Оплатить» links into `/checkout/[tariffSlug]?slot=<uuid>`; reads `/api/account/postpaid-debt`). PKG-LEARNER-BUY LBL.2 (2026-05-16) added a discovery «Купить пакет →» link in the «Мои пакеты» header pointing at `/cabinet/packages`
- [`app/cabinet/packages/page.tsx`](app/cabinet/packages/page.tsx) + [`buy-button.tsx`](app/cabinet/packages/buy-button.tsx) - PKG-LEARNER-BUY LBL.1 (2026-05-16) learner-facing package catalog. SSR auth pattern mirrors `app/cabinet/page.tsx` (read `lc_session` cookie → `lookupSession` → 307 to `/login` if missing); post-session gate via `isLearnerArchetypeCandidate` keeps admin / teacher / deletion-grace accounts out and matches the same SoT used by the API route. Renders `listActivePackages()` next to `listAccountActivePackages(account.id)` so the learner sees what's already owned. `buy-button.tsx` is the client island that POSTs `/api/checkout/package/[slug]`, branches on `provider`: mock → redirect to `/thank-you?invoiceId=...&token=...`, cloudpayments → mount the CloudPayments Widget with the server-built `checkoutIntent` and let `successRedirectUrl` carry the receipt token. The widget script is loaded at the page level (NOT in `app/layout.tsx`) per the 2026-05-08 Wave 10 #5 rule
- [`app/admin/layout.tsx`](app/admin/layout.tsx) - admin chrome with `requireAdminRole` gate and a left-side nav. Phase 3
- [`app/admin/page.tsx`](app/admin/page.tsx) - admin dashboard. Phase 3
- [`app/admin/accounts/page.tsx`](app/admin/accounts/page.tsx) - paginated learner list with e-mail search. Phase 3
- [`app/admin/accounts/[id]/page.tsx`](app/admin/accounts/[id]/page.tsx) - learner detail: status, role grants, profile, deletion-grace banner with cancel. Phase 3
- [`app/admin/pricing/page.tsx`](app/admin/pricing/page.tsx) + [`tariff-editor.tsx`](app/admin/pricing/tariff-editor.tsx) - tariff CRUD. Public `/pay` stays free-amount in Phase 3; the catalog wires into checkout in Phase 6. BUG-3 (2026-05-14): `durationMinutes` is now a required field with a `DurationSelect` (30/45/60/90 + custom). BUG-2 (2026-05-14): each row has a red 🗑 button + `DeleteConfirm` modal (hard-delete refused if any slot has ever referenced the tariff; modal shows the 409 message inline). Labels for `Порядок (для админки)` carry a ⓘ tooltip.
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
- [`lib/payments/provider/`](lib/payments/provider/) - orchestration folder (Wave 41 split): `lifecycle.ts` for `toPublicOrder` / `markOrderPaid|Failed|Cancelled` / `syncMockOrderState`, `checkout.ts` for `createPayment` / `chargeWithSavedCard` / `confirmThreeDsAndFinalize`, `index.ts` facade. All callers keep `@/lib/payments/provider`.
- [`lib/payments/mock.ts`](lib/payments/mock.ts) - mock provider
- [`lib/payments/cloudpayments.ts`](lib/payments/cloudpayments.ts) - building the server-side order and the widget intent for CloudPayments / CloudKassir. PKG-LEARNER-BUY LBL.0 (2026-05-16) made `buildCloudPaymentsWidgetIntent` accept an optional `{ receiptToken }` so the `successRedirectUrl` carries `&token=` and `/thank-you`'s status fetch is authorised on the widget-completed redirect (epic-end paranoia BLOCKER #2 closure). Server-side `3ds-callback` redirect still omits `&token=` — closed at the GATE layer by RECEIPT-3DS-TOKEN (2026-05-16) session-fallback (see `lib/payments/receipt-token-gate.ts` + `lib/payments/receipt-gate-session.ts`).
- [`lib/payments/receipt-token-gate.ts`](lib/payments/receipt-token-gate.ts) - the receipt-token gate gating `/api/payments/[invoiceId]/{route,cancel,stream}`. Two accept paths: (1) `token_match` against `payment_orders.receipt_token_hash`; (2) `session_match` when `session.account.id === order.metadata.accountId` (RECEIPT-3DS-TOKEN session-fallback, 2026-05-16). Anti-spoof lives at the consumer (`lib/payments/receipt-gate-session.ts` rejects admin/teacher sessions BEFORE threading the account id into the gate). Gate itself is dumb — equality only.
- [`lib/payments/cloudpayments-webhook.ts`](lib/payments/cloudpayments-webhook.ts) - webhook payload parsing and verification
- [`lib/payments/cloudpayments-api.ts`](lib/payments/cloudpayments-api.ts) - server-to-server HTTP client for `/payments/tokens/charge` (one-click), `/payments/cards/post3ds` (3DS finalization), `/payments/refund` (gateway refund), and `/payments/qr/sbp/create` (SBP QR generation, SBP-PAY 2026-05-19). All four functions share `basicAuthHeader()` + `fetchWithTimeout()`; SBP returns a discriminated union (`success` { transactionId, qrUrl, image? } | `declined` | `error`).
- [`app/api/payments/sbp/create-qr/route.ts`](app/api/payments/sbp/create-qr/route.ts) - SBP-PAY (2026-05-19). Server endpoint that creates a `payment_orders` row (`provider='cloudpayments'`, `payment_method='sbp'`, `status='pending'`), mints a receipt token, calls `createSbpQr()`, returns `{invoiceId, qrUrl, receiptToken, accountIdAttached, transactionId}` to the modal. Idempotency-Key header REQUIRED (`400 'idempotency_key_required'` if missing). `enforceTrustedBrowserOrigin` BEFORE business logic. Consent built server-side via `buildPersonalDataConsentSnapshot({ipAddress, userAgent})`. Session-account resolution via `lib/payments/order-account-resolver.ts` (admin-only rejection; learner + learner-with-teacher hybrid sessions both accepted). 502 on transient CP errors (order stays pending; retry with new key); 422 on affirmative decline. **PAY-SBP-REMOVAL 2026-05-20:** route operator-gated by `SBP_ENABLED=true` env (default off — returns 503 `sbp_disabled` until the CloudPayments-side terminal is activated and the env is flipped). The in-page SBP CTA on `/pay` was removed at the same time; CloudPayments' own widget exposes SBP as an in-modal payment method, so the explicit button was redundant. See `docs/plans/sbp-payments.md` for the original plan + paranoia closures, and `docs/plans/pay-sbp-removal-and-cp-ready-gate.md` for the removal plan.
- [`lib/payments/order-account-resolver.ts`](lib/payments/order-account-resolver.ts) - SBP-PAY (2026-05-19) writer-side session resolver. Tighter than `resolveSessionAccountIdForReceiptGate` (the reader): rejects only admin, allows teacher / hybrid. Trust-boundary differential — writing your own account.id into your own order's metadata is strictly less-privileged than reading any order via session-fallback.
- [`lib/payments/tokens.ts`](lib/payments/tokens.ts) - Token extraction from a webhook and the public card mask
- [`lib/payments/store.ts`](lib/payments/store.ts) - adapter layer; picks file or postgres backend (orders + card tokens)
- [`lib/payments/store-file.ts`](lib/payments/store-file.ts) - file storage for orders and tokens
- [`lib/payments/store-postgres.ts`](lib/payments/store-postgres.ts) - PostgreSQL backend for orders and `payment_card_tokens`. PKG-ADMIN-GRANT (2026-05-16) replaced silent coercion in `mapRowToOrder` with explicit `KNOWN_PROVIDERS` + `KNOWN_STATUSES` accept-lists that throw on unknown values (a `3ds_required` row used to be misread as `pending`).
- [`app/api/admin/packages/[id]/grant/route.ts`](app/api/admin/packages/[id]/grant/route.ts) - PKG-ADMIN-GRANT (2026-05-16). Operator-driven non-money package grant. Synthetic `payment_orders` row (`provider='admin_grant'`, `status='granted'`, `paid_at=NULL`, `granted_by_operator_id` set) + `package_purchases` + `payment_allocations` written atomically in one TX on a `lockClient` holding `pg_advisory_xact_lock(hashtextextended('pkg-stack:' || accountId || ':' || durationMinutes, 0))` — shared `pkg-stack:` prefix serialises against the learner-buy route and the webhook grant path. Migration `0051` adds the triple-CHECK so the three signals always agree. Refund route refuses `kind='package'` on `admin_grant` orders. See `PAYMENTS_SETUP.md` for the full contract.
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
- [`lib/auth/guards.ts`](lib/auth/guards.ts) - `requireAuthenticated`, `requireAuthenticatedAndVerified`, `requireAdminRole`, plus the Wave 2.1 / 1.3 learner-archetype gates `requireLearnerArchetype` and `requireLearnerArchetypeAndVerified` (deny-list on `admin` + `teacher`; legacy "no role" passes through as the implicit student archetype). AUDIT-SEC-3 (2026-05-17) added a second-stage canonical-predicate check inside `requireLearnerArchetypeAndVerified` via `isLearnerArchetypeCandidate(account.id)` — request-time guards now also reject deletion-grace / purged / disabled accounts, not just admin/teacher roles. The non-`AndVerified` variant still runs Stage 1 only (see SCOPE NOTE in `lib/auth/learner-archetype.ts`). Used by cabinet + admin + `/api/slots/*` route handlers
- [`lib/pricing/tariffs.ts`](lib/pricing/tariffs.ts) - store ops + validation for `pricing_tariffs`. Money lives in kopecks; rubles is a derived display. `durationMinutes` (15-240 band) is required and immutable after first slot reference (BUG-3, migration 0046 + `pricing_tariffs_duration_guard` trigger; matches the amount_kopecks immutability pattern from migration 0033). `deleteTariffIfUnreferenced` (BUG-2) does a single-TX hard-delete with `SELECT FOR UPDATE` + slot-reference check + `DELETE … RETURNING *`; returns the deleted row snapshot for audit logging (no concurrent-PATCH drift). The admin DELETE route logs the snapshot to `[admin-audit] tariff.deleted` (systemd journal) and a formal DB audit table is a future migration. Phase 3
- [`lib/auth/sessions.ts`](lib/auth/sessions.ts) - create / lookup / revoke + cookie helpers (`lc_session`, HttpOnly + SameSite=Lax + Secure in prod)
- [`lib/auth/single-use-tokens.ts`](lib/auth/single-use-tokens.ts) - common store for verify-email and password-reset (whitelist scope in SQL)
- [`lib/auth/verifications.ts`](lib/auth/verifications.ts), [`lib/auth/resets.ts`](lib/auth/resets.ts) - thin wrappers with TTL
- [`lib/auth/consents.ts`](lib/auth/consents.ts) - store ops for `account_consents` (recordConsent / listAccountConsents / getLatestConsent / **withdrawConsent / getActiveConsent**). The withdrawal model (152-FZ art.9 §5) was added in migration 0013 - a `revoked_at` column plus a partial index on `(account_id, document_kind, accepted_at desc) where revoked_at is null`. Phase 1B D2.
- [`lib/auth/dummy-hash.ts`](lib/auth/dummy-hash.ts) - module-load bcrypt-hashed dummy + `constantTimeVerifyPassword`. Closes e-mail enumeration via login timing (Phase 1B D3).
- [`lib/auth/email-hash.ts`](lib/auth/email-hash.ts) - HMAC-keyed sha256 of the normalized e-mail through `AUTH_RATE_LIMIT_SECRET` for per-email rate-limit scope keys. Do not reuse `TELEMETRY_HASH_SECRET` - different trust boundaries (Phase 1B mech-3).
- [`lib/auth/teacher-invites.ts`](lib/auth/teacher-invites.ts) - SAAS-3+4 (2026-05-18). HMAC-SHA256 sign/verify primitives + DB-bound helpers for teacher-issued invite links. `createInviteForTeacher` INSERTs a `teacher_invites` row, signs the wire token, returns the full `/register?invite=<token>` URL. `redeemInviteAndBindLearnerAtomic` is a writable CTE wrapped in an explicit TX that atomically marks the invite used AND sets `accounts.assigned_teacher_id` IF the inviting teacher still holds the `teacher` role at the moment of redeem (EXISTS sub-query against `account_roles`) — closes the round-3 BLOCKER#1 race window. SAAS-PIVOT Day 2 (2026-05-22): the CTE also INSERTs a row into `learner_teacher_links` (canonical n:m) with `via_invite_id` set; the TX takes `pg_advisory_xact_lock(hashtext('lc-saas-pivot:learner-teacher-links:<learner_uuid>'))` before the CTE so concurrent operator reassign (`setAssignedTeacher` in `lib/auth/accounts.ts`) cannot create multi-link drift on the same learner. Per-call env read of `TEACHER_INVITE_SECRET` (no module-scope cache so rotation takes effect on the next request); auto-synthesized by `scripts/activate-prod-ops.sh` on first activation. Routes: `POST/GET /api/teacher/invites`, `POST /api/teacher/invites/[id]/revoke`. Cabinet UI: [`app/cabinet/teacher-invite-section.tsx`](app/cabinet/teacher-invite-section.tsx). Migration 0057 owns the schema + extends `auth_audit_events.event_type` CHECK with 4 invite events.
- [`lib/auth/teacher-scope.ts`](lib/auth/teacher-scope.ts) - SAAS-PIVOT Day 2 (2026-05-22). Source of truth for the n:m "current teacher" resolution per plan §2.5. `getActiveTeacherForLearner(accountId)` returns `{ teacherId, needsPicker }` — single active link → that teacher; multi-link → `needsPicker:true` (callers MUST accept `?teacher=<id>` and validate it against the active link set); zero links → null. `getActiveTeacherIdsForLearner(accountId)` returns the full active link array (linked_at asc) used by session hydration in `lib/auth/sessions.ts` to populate `Account.assignedTeacherIds`. `Account.assignedTeacherId` survives as a back-compat alias = `assignedTeacherIds[0] ?? null` through MVP (mig 0084 drops the column post-MVP).
- [`migrations/0057_teacher_invites.sql`](migrations/0057_teacher_invites.sql) - `teacher_invites` (id, teacher_account_id FK→accounts CASCADE, created_at, expires_at, used_at, used_by_account_id FK→accounts SET NULL, revoked_at) + partial active index + extended `auth_audit_events.event_type` CHECK with `auth.teacher.self_registered` / `auth.invite.created` / `auth.invite.revoked` / `auth.invite.redeemed`.

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
- [`.githooks/commit-msg`](.githooks/commit-msg) - chains the legal-pipeline + skill-pipeline trailer checks (see `docs/legal-pipeline.md` + `docs/skill-pipeline.md`)
- [`.github/workflows/public-surface-check.yml`](.github/workflows/public-surface-check.yml) - CI copy of the same guardrail for pull requests and pushes to `main`
- [`.github/workflows/legal-pipeline.yml`](.github/workflows/legal-pipeline.yml) - CI gate enforcing `Legal-Pipeline-Verified:` trailer on commits touching regulated text
- [`.github/workflows/skill-pipeline.yml`](.github/workflows/skill-pipeline.yml) - CI gate enforcing `Skill-Used:` trailer on commits with non-trivial diff (≥3 files OR ≥100 lines in `app/`/`lib/`/`tests/`/`migrations/`); see `docs/skill-pipeline.md`
- [`scripts/skill-pipeline-check.sh`](scripts/skill-pipeline-check.sh) - shared logic for the hook + CI; `--commit-msg` and `--ci` modes
- [`scripts/session-audit.sh`](scripts/session-audit.sh) - read-only diagnostic; reports missing trailers and missing `/document-release`-or-`/learn` markers across the recent session window
- [`.github/pull_request_template.md`](.github/pull_request_template.md) - PR description scaffold mirroring the AGENTS §4 skill gates (visual checklist; the trailer + CI gate is the binding enforcement)
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
- [`migrations/0025_payment_audit_events_pgcrypto.sql`](migrations/0025_payment_audit_events_pgcrypto.sql) - Wave 2.1 (security). Enables the `pgcrypto` extension and adds `customer_email_enc bytea` + `client_ip_enc bytea` alongside the plaintext columns. Three-phase migration plan documented in the migration body: Phase A dual-write (this is what's live), Phase B operator-driven null-out of plaintext (tracked in `ENGINEERING_BACKLOG.md`), Phase C drop plaintext columns. Reads in `listPaymentAuditEventsByInvoice` prefer `pgp_sym_decrypt(_enc)` with plaintext fallback so Phase B is invisible to consumers.
- [`lib/audit/payment-events.ts`](lib/audit/payment-events.ts) - `recordPaymentAuditEvent(...)` (best-effort: catch + warn + return false; does not throw, so the business path does not fall over). Wave 2.1 dual-writes encrypted columns when `AUDIT_ENCRYPTION_KEY` is set, via `pgp_sym_encrypt` in the SQL `case when` branches. `listPaymentAuditEventsByInvoice(invoiceId)` for admin tooling, decrypt-aware. Export of `PAYMENT_AUDIT_EVENT_TYPES` is the single source of truth for the enum and must match the migration CHECK (covered by an integration test).
- [`lib/audit/encryption.ts`](lib/audit/encryption.ts) - Wave 2.1 key resolver. Reads `AUDIT_ENCRYPTION_KEY` (PRIMARY) from env, mandatory in `NODE_ENV=production`, ≥32-char floor. Wave 3.1 added `getAuditEncryptionKeyOld()` reading optional `AUDIT_ENCRYPTION_KEY_OLD` for the rotation window — used by the read path only. Cached on first use against `process.env`; tests use the explicit-env overload + `__resetAuditEncryptionKeyCache()` to swap values without restarting the process.
- [`scripts/backfill-audit-encryption.mjs`](scripts/backfill-audit-encryption.mjs) - one-shot operator-driven backfill that encrypts pre-Wave-2.1 rows. Idempotent, batched (1000 default), uses `FOR UPDATE SKIP LOCKED` so re-runs are safe under concurrent app traffic. Run with `AUDIT_ENCRYPTION_KEY=... DATABASE_URL=... node scripts/backfill-audit-encryption.mjs`. Exits 0 on full sweep, 1 if any rows remain after the run (re-run).
- [`scripts/rotate-audit-encryption.mjs`](scripts/rotate-audit-encryption.mjs) - Wave 3.1 operator-driven key rotation. Re-encrypts every row from `AUDIT_ENCRYPTION_KEY_OLD` to `AUDIT_ENCRYPTION_KEY`. Idempotent (rows already on PRIMARY are skipped via the try-decrypt-either predicate), batched, `FOR UPDATE SKIP LOCKED`. See `SECURITY.md § At-rest encryption — Key rotation` for the full runbook.
- [`lib/audit/pool.ts`](lib/audit/pool.ts) - thin re-export → `getDbPoolOrNull()` from the common `lib/db/pool.ts`. The `OrNull` shape is needed because the recorder is best-effort (silent skip without DATABASE_URL).
- [`lib/db/pool.ts`](lib/db/pool.ts) - the single pg Pool for the project (5 domain pools were consolidated 2026-04-29). `getDbPool()` throws when `DATABASE_URL` is missing; `getDbPoolOrNull()` does a silent skip. Cap via `DATABASE_POOL_MAX` env (default 10). Wave 1.1 added `resolveSslConfig(url, env)` which auto-detects `localhost` / `127.0.0.1` / `::1` / `*.local` as no-TLS (loopback — single-server deploys with Postgres on the same VPS are a valid topology) and forces `ssl: { rejectUnauthorized: true }` on every non-local host. Production refuses `DB_SSL=disable` and `DB_SSL_REJECT_UNAUTHORIZED=false` ONLY for non-local hosts (the threat is "TLS off for a REMOTE Postgres in prod", not "TLS off on the loopback path"). The JS-side `ssl` option overrides any `?sslmode=...` URL hint, so the policy is owned in code.

Write points (route handlers):

- [`app/api/payments/route.ts`](app/api/payments/route.ts) → `order.created`
- [`app/api/payments/[invoiceId]/cancel/route.ts`](app/api/payments/[invoiceId]/cancel/route.ts) → `order.cancelled`
- [`app/api/payments/mock/[invoiceId]/confirm/route.ts`](app/api/payments/mock/[invoiceId]/confirm/route.ts) → `mock.confirmed`
- [`app/api/payments/charge-token/route.ts`](app/api/payments/charge-token/route.ts) → `charge_token.succeeded` / `charge_token.requires_3ds` / `charge_token.declined`
- [`app/api/payments/3ds-callback/route.ts`](app/api/payments/3ds-callback/route.ts) → `threeds.callback.received` + `threeds.confirmed` / `threeds.declined`
- [`app/api/payments/webhooks/cloudpayments/pay/route.ts`](app/api/payments/webhooks/cloudpayments/pay/route.ts) → `webhook.pay.processed` (plus `webhook.pay.received` / `.validation_failed` via the wrapper)
- [`app/api/payments/webhooks/cloudpayments/fail/route.ts`](app/api/payments/webhooks/cloudpayments/fail/route.ts) → `webhook.fail.processed` (plus `webhook.fail.received` / `.declined` via the wrapper)
- [`app/api/payments/webhooks/cloudpayments/check/route.ts`](app/api/payments/webhooks/cloudpayments/check/route.ts) → `webhook.check.received` / `.declined` via the wrapper (no business handler - Check only validates)
- [`lib/payments/cloudpayments-route.ts`](lib/payments/cloudpayments-route.ts) - wrapper handles HMAC verify → Wave 2.2 secondary IP rate limit (60/min/kind) → Wave 3.2 serialised dedup path (sticky pool client + `pg_advisory_xact_lock(hashtext("cp:<kind>:<txId>"))` inside one transaction wrapping the lookup → handler → record sequence) → parse → order lookup → audit phase-0 (`received`) → validate → audit phase-1 (`declined` / `validation_failed`) → call `handler(payload)` for business finalize → Wave 1.2 record dedup row. A retried delivery short-circuits at the dedup lookup and returns the cached response with a `Webhook-Replay: true` header; a key-leak flood is bounded by the rate limit; concurrent retries are serialised so the handler runs exactly once per delivery
- [`lib/payments/webhook-dedup.ts`](lib/payments/webhook-dedup.ts) - Wave 1.2 dedup module: `ensureWebhookDeliveriesSchema()`, `lookupWebhookDelivery()`, `recordWebhookDelivery()`, plus a `purgeStaleWebhookDeliveries(maxAgeDays=90)` janitor. Wave 3.2 added the sticky-client variants `lookupWebhookDeliveryClient(client, ...)` and `recordWebhookDeliveryClient(client, ...)` that operate on a caller-supplied `PoolClient` so the lookup + record stay inside the lock-holding transaction. Uses the `webhook_deliveries` table (migrations 0024 + 0025 baseline + 0026 `request_fingerprint`) keyed by `(provider, kind, transaction_id)`. Wave 2.3 added a sha256 fingerprint over `(invoice_id, amount, email, account_id)`; the lookup result is a tagged union (`hit | miss | fingerprint_mismatch`) so the caller can distinguish a legitimate retry from a TxId-collision attack and run the handler in the latter case. Best-effort throughout: a Postgres outage on lookup or persist falls through to the legacy non-dedup path so a real CloudPayments retry is never blocked by dedup infra

Not covered (see `ENGINEERING_BACKLOG.md` for context):
- `charge_token.error` - the sync-error path in `chargeWithSavedCard` may throw before or after the order INSERT; a return-type refactor to `{kind:'error', invoiceId, reason}` is needed before an audit row can be honestly attached. For now, sync errors land in `console.warn` (journald). `charge_token.attempted` is not needed (see backlog rationale).
- HMAC fail / parse fail for webhooks: `invoice_id` is unreliable at this point (FK constraint), so an audit row is not written. These rejections stay in nginx + journal logs.

### Observability probes (ALERTS-OBS)

Read-only `/admin/settings/alerts` surface (ALERTS-OBS, 2026-05-17; extended by BCS-DEF-1 to 4 probe slots 2026-05-19). Four systemd cron alert probes emit JSON to journald + persist a per-tick row to `probe_runs` so the operator can see "last run", "last alert", effective thresholds (snapshot from row, NOT process env), and trigger a dry-run test email. **Activation gate:** systemd `.timer` units are only installed + enabled after an operator runs `scripts/activate-prod-ops.sh` on the VPS — the 4th probe (`conflict-unresolved`) renders an `/admin/settings/alerts` card on first deploy but the card stays "Данные недоступны" until that activation step ships the systemd timer. **BCS-DEF-1-TG (2026-05-19):** per-recipient row discriminator (`probe_runs.recipient_kind in ('email','telegram')`, migration 0061) lets each probe tick record one row per delivery channel — `lib/admin/probe-status.ts:getLatestTelegramRun` reads the channel-specific verdict for the future Telegram card. **BCS-DEF-5 sibling surface (2026-05-19):** the daily teacher digest cron is a 5th `probe_runs` writer (`probe_name='teacher-daily-digest'`, migration 0068) but is NOT iterated in the standard `PROBE_NAMES` array — it has its own dedicated `/admin/settings/digest` admin page backed by `lib/admin/digest-summary.ts` (`getDigestLastRun` + `getDigestSevenDaySummary`) and 3 operator-tunable settings under scope `teacher-daily-digest` (`TEACHER_DIGEST_MASTER_SWITCH` off-by-default + `TEACHER_DIGEST_RATE_LIMIT_PER_TICK` + `TEACHER_DIGEST_MAX_ATTEMPTS`).

- [`migrations/0053_probe_runs.sql`](migrations/0053_probe_runs.sql) - single observability sink. CHECK on `probe_name` (initially 3 values; extended to 4 by `migrations/0058_probe_runs_conflict_unresolved.sql` (BCS-DEF-1, 2026-05-19)) + `verdict_kind` (13 values). Two partial indexes: `(probe_name, ran_at desc) WHERE is_test = false` for "last real run" and `(probe_name, ran_at desc) WHERE alert_sent = true AND is_test = false` for "last real alert". `initiator_account_id` FK to `accounts.id` ON DELETE RESTRICT (matches sibling operator-action audit tables `payment_refund_attempts`, `package_grant_resolutions`).
- [`scripts/lib/probe-runs.mjs`](scripts/lib/probe-runs.mjs) - pure ESM helper used by the `.mjs` probes (Node CLI doesn't resolve `@/` TS aliases). Exports `PROBE_NAMES` + `VERDICT_KINDS` frozen constants + `recordProbeRun(pool, params)`. The caller passes its own `pg.Pool({max:1})` (probes run as oneshot systemd units with explicit `await pool.end()`; `getDbPool()` is a Next.js singleton with `max:10` and no shutdown path, wrong shape for oneshot). Best-effort: catches + warns + returns, NEVER throws — probe's primary email-send job must never block on observability.
- [`scripts/auth-flow-alert.mjs`](scripts/auth-flow-alert.mjs), [`scripts/calendar-pathology-alert.mjs`](scripts/calendar-pathology-alert.mjs), [`scripts/webhook-flow-alert.mjs`](scripts/webhook-flow-alert.mjs), [`scripts/conflict-unresolved-alert.mjs`](scripts/conflict-unresolved-alert.mjs) - each probe captures its env-read at the top of the run (`stats.thresholds` snapshot), wraps the Resend SDK call in a local try/catch so transport exceptions yield `alert_send_failed` taxonomy (not a generic `error`), and has a top-level try/catch that writes an `error` verdict row before re-throwing so an unexpected exception doesn't leave the admin page on stale data forever. `sendAlertEmail` in auth-flow + webhook-flow returns `{ ok: true, emailId } | { ok: false, error }`; the caller advances dedup state ONLY on `ok=true` (auth-flow had a real pre-existing bug here — dedup state advanced on send failure, silently masking retries). The conflict-unresolved probe (BCS-DEF-1, 2026-05-19) reads booked future slots with `external_conflict_at <= now() - threshold` joined to `accounts.email`, applies a window-function per-teacher cap (round-2 paranoia BLOCKER #2 closure: noisy teacher can't monopolise the global LIMIT), emails the operator with per-teacher `/admin/accounts/<id>` deep-links + slot ids inline, dedups on a fingerprint over sorted `(teacherAccountId, slotId, conflictSourceCalendarId, conflictSourceEventId)` tuples.
- [`lib/admin/probe-status.ts`](lib/admin/probe-status.ts) - `getProbeStatus(probeName)` reads the latest real run + latest real alert via the two partial indexes. Wraps the queries in a try/catch on Postgres `42P01` ("relation does not exist") and returns `{ migrationPending: true }` so the deploy-before-migrate window doesn't 500 the admin page. `getLatestTelegramRun(probeName)` (BCS-DEF-1-TG, 2026-05-19) reads the latest `recipient_kind='telegram'` row via `probe_runs_telegram_latest_idx` (migration 0061) for the future TG channel card.
- [`lib/admin/digest-summary.ts`](lib/admin/digest-summary.ts) - BCS-DEF-5 (2026-05-19). `getDigestLastRun()` + `getDigestSevenDaySummary()` for the `/admin/settings/digest` page. Reads `probe_runs` filtered on `probe_name='teacher-daily-digest'` for the per-tick last-run card; reads `teacher_account_daily_digests` (migration 0067) for the 7-day operator widget (sent count, skipped buckets, terminal-failed rows).
- [`app/admin/(gated)/settings/alerts/page.tsx`](app/admin/(gated)/settings/alerts/page.tsx) + [`test-send-button.tsx`](app/admin/(gated)/settings/alerts/test-send-button.tsx) - server-rendered per-probe cards. Migration-pending banner takes precedence (renders before each card's body). The test-send client island generates a fresh UUID `Idempotency-Key` per click and gates the action behind a two-step prompt (reason ≥3 chars + final confirm).
- [`app/api/admin/settings/alerts/[probe]/test-send/route.ts`](app/api/admin/settings/alerts/%5Bprobe%5D/test-send/route.ts) - POST endpoint that fires a dry-run alert email via Resend. Auth: `requireAdminRole` + `enforceTrustedBrowserOrigin` + rate limit 5/h/IP. Wrapped in `withIdempotency` scoped `admin:alerts:test-send:${probe}:${operatorAccountId}`. **Explicit `select 1 from probe_runs limit 0` preflight runs BEFORE any Resend call** so an unmigrated DB returns 503 without side-effects (load-bearing for the deploy-before-migrate window). Writes a `probe_runs` row with `is_test=true` + `initiator_account_id=session.account.id` + `verdict_kind=test_send_succeeded|test_send_failed`; these rows are excluded from both the "last run" and "last alert" queries via the partial indexes' `is_test = false` filter. NO `payment_audit_events` involvement (table is payment-domain only and requires real `invoice_id` FK).
- [`scripts/db-retention-cleanup.mjs`](scripts/db-retention-cleanup.mjs) - 90-day retention rule (`delete from probe_runs where ran_at < now() - interval '90 days'`). Volume cap: ~6 INSERTs/h × 24 × 90 = ~13k rows.

Plan: [`docs/plans/alerts-obs.md`](docs/plans/alerts-obs.md). 3-round Codex paranoia plan-mode loop + manual fresh-eyes pass before implementation; 1-round Codex paranoia wave-mode loop with 2 WARNs closed inline before merge.

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
  - `0024_webhook_deliveries.sql` - Wave 1.2 (security). Adds `webhook_deliveries` keyed by `(provider, kind, transaction_id)` for dedup of CloudPayments webhook retries. CHECK constraints whitelist `provider in ('cloudpayments')` and `kind in ('check', 'pay', 'fail')`. `invoice_id` is nullable on purpose (no FK) so dedup outlives the order it points at and a missing order doesn't hide a duplicate from the gate.
  - `0025_payment_audit_events_pgcrypto.sql` - Wave 2.1 (security). Enables `pgcrypto`, adds `customer_email_enc` + `client_ip_enc` bytea columns. Three-phase migration plan documented in the migration body — Phase A live, Phase B + C tracked in `ENGINEERING_BACKLOG.md`.
  - `0026_webhook_deliveries_request_fingerprint.sql` - Wave 2.3 (security, post-Wave-2 adversarial #7). Adds nullable `request_fingerprint text` column to `webhook_deliveries`. New rows carry sha256 of (invoice_id, amount, email, account_id); the lookup compares fingerprints to defend against an attacker (with leaked HMAC secret) submitting a webhook with a spoofed TransactionId chosen to collide with a future legit one. NULL on legacy rows is treated as "no comparison performed" for backward compat — those rows expire under the existing 90-day retention.
  - `0027_pgp_sym_decrypt_either.sql` - Wave 3.1 (security). Creates the PL/pgSQL helper `pgp_sym_decrypt_either(data, primary_key, old_key)` that wraps each `pgp_sym_decrypt` attempt in an EXCEPTION block — pgcrypto's decrypt THROWS on a wrong key, so we cannot `coalesce` two attempts directly. The helper returns NULL when both keys fail, enabling the read path to support the rotation window (PRIMARY tried first; OLD as fallback when present).
  - `0046_pricing_tariffs_duration_minutes.sql` - BUG-3 (2026-05-14). Adds `duration_minutes integer not null` to `pricing_tariffs` with backfill default 60 (production reality: only `lesson-60min` was ever used), then drops the DEFAULT so new inserts must supply a duration. CHECK band 15-240. Installs `pricing_tariffs_duration_guard` trigger mirroring the `amount_kopecks_immutable` pattern from migration 0033 — duration is immutable after the first slot reference.
- The legacy `ensureSchema*` functions in `lib/payments/store-postgres.ts`, `lib/security/idempotency-postgres.ts`, `lib/telemetry/store-postgres.ts` stay as a safety net. Once the runner is wired into the deploy pipeline and has rolled at least once on prod, they can be removed gradually - but not in this cycle.

#### Recent migrations (May 2026)

Quick-reference for the most-recently-shipped schema changes (refreshed 2026-05-19 — migrations 0049 → 0069 covered, with 0064–0066 reserved for BCS-DEF-4 on the feature branch); the full migration files in `migrations/` are the source of truth.

| Mig | Wave | Adds | Purpose |
|---|---|---|---|
| `0049_package_grant_resolutions.sql` | PKG-RECON (2026-05-15) | new table `package_grant_resolutions` | durable operator-resolution log for `paid_not_granted` orders. PK=`invoice_id` (one terminal resolution per order). `resolution in ('granted','attached_and_granted','marked_resolved_manually')`. Deletion-guard consults this table — a resolved order no longer blocks account deletion. |
| `0050_payment_audit_events_pkg_recon.sql` | PKG-RECON | extends `payment_audit_events.event_type_check` | 3 new event kinds: `payment.grant.retried-by-admin`, `payment.grant.account-attached-by-admin`, `payment.grant.resolved-manually-by-admin`. |
| `0051_payment_orders_admin_grant.sql` | PKG-ADMIN-GRANT (2026-05-16) | extends `payment_orders.provider` + `.status` + new `granted_by_operator_id uuid` | triple-CHECK invariant: `provider='admin_grant' iff granted_by_operator_id IS NOT NULL iff status='granted'`. Admin-grant route writes synthetic non-money rows with this signature. Refund route refuses `kind='package'` on these orders. |
| `0052_payment_audit_events_admin_grant.sql` | PKG-ADMIN-GRANT | extends `payment_audit_events.event_type_check` | new event kind: `package.grant.operator-granted`. Actor `'admin:grant'` records the operator id. |
| `0053_probe_runs.sql` | ALERTS-OBS (2026-05-17) | new table `probe_runs` | per-tick observability sink for the systemd cron alert probes. CHECK on `probe_name` (3 values at ship; extended to 4 by migration 0058) + `verdict_kind` (13 values). Two partial indexes: latest-real-run + latest-real-alert (`WHERE is_test = false`). `initiator_account_id` FK ON DELETE RESTRICT preserves operator-action provenance. |
| `0054_calendar_channel_token_enc.sql` | AUDIT-SEC-4 (2026-05-17) | adds `channel_token_enc bytea` to `teacher_calendar_integrations` | encrypts the Google channel-token at rest. Dual-write in `lib/calendar/channel-renewer.ts setupChannelForIntegration`; decrypt-aware read in the webhook handler with plaintext fallback for legacy rows. Phase B null-out via `scripts/null-plaintext-channel-token.mjs`. |
| `0055_operator_settings.sql` | ALERTS-EDITOR Sub-PR A (2026-05-17) | new tables `operator_settings` + `operator_settings_events` | operator-tunable alert thresholds (DB → env → hardcoded-default resolver chain in `lib/admin/operator-settings.ts` + `scripts/lib/operator-settings.mjs`). Immutability trigger blocks UPDATE on the audit log unconditionally and DELETE on rows <89 days. 90-day retention sweep in `scripts/db-retention-cleanup.mjs`. |
| `0056_lesson_slots_zoom_url.sql` | BCS-DEF-3 (2026-05-18) | adds nullable `zoom_url text` to `lesson_slots` | optional Zoom link surfaced on a booked slot. Length-capped at 512 chars + CHECK `^https://` (no `http://` / `javascript:` schemes). Admin + teacher routes can set/clear it independently of the otherwise-locked schedule/tariff fields. |
| `0057_teacher_invites.sql` | SAAS-3+4 TINV.1 (2026-05-18) | new table `teacher_invites` + extends `auth_audit_events.event_type` CHECK with 4 invite events | HMAC-SHA256 invite-link primitives + atomic redeem-and-bind via `lib/auth/teacher-invites.ts`. FK `teacher_account_id → accounts ON DELETE CASCADE`, `used_by_account_id → accounts ON DELETE SET NULL`. Partial active index for "is this token still redeemable". |
| `0058_probe_runs_conflict_unresolved.sql` | BCS-DEF-1 Phase 1 (2026-05-19) | extends `probe_runs_probe_name_check` | adds `'conflict-unresolved'` to the CHECK so the new alert probe (scripts/conflict-unresolved-alert.mjs) can write rows. Additive — no existing values dropped. ACCESS EXCLUSIVE briefly on probe_runs; recorder swallows errors so the brief window is invisible. |
| `0060_teacher_calendar_integrations_sync_token.sql` | BCS-DEF-7 Phase 1 (2026-05-18) | adds nullable `next_sync_token text` to `teacher_calendar_integrations` | foundation for incremental Google Calendar pull. Phase 1 lands the column NULL on all rows; Phase 2 (PR #390, 2026-05-19) ships the pull-runner delta path — delta is now the default for active teachers, full-rewrite is the bootstrap + 410-Gone fallback path. Per-teacher key (MVP 1:1 `writeCalendarId = readCalendarIds[0] = 'primary'`); multi-calendar follow-up promotes this into a `teacher_calendar_sync_states` table. |
| `0061_probe_runs_recipient_kind.sql` | BCS-DEF-1-TG (2026-05-19) | adds NOT NULL `recipient_kind text default 'email'` to `probe_runs` + partial Telegram-latest index | per-recipient row discriminator (`email` / `telegram`) so the 4 operator probes can record one row per delivery channel. Future channels (Slack/SMS) widen the CHECK without new columns. Recorder writes the channel-agnostic message id back into `alert_email_id` (Resend id for email, stringified Telegram message id for telegram). |
| `0062_slot_admin_actions.sql` | BCS-DEF-2 (2026-05-19) | new table `slot_admin_actions` + partial index `lesson_slots_external_conflict_admin_idx` | secondary cross-action audit ledger for the `/admin/slots/conflicts` dashboard. Canonical audit stays in `lesson_slots.events` jsonb; this table is a cross-action index for operator queries (`action in ('dismiss-conflict','cancel-from-conflict')`). 42P01 in the deploy-before-migrate window is recovered via SAVEPOINT in the dismiss-conflict route + post-commit log+swallow in the cancel-from-conflict cleanup TX. |
| `0063_payment_orders_payment_method.sql` | SBP-PAY (2026-05-19) | adds nullable `payment_method text` to `payment_orders` with CHECK `in ('card','sbp','admin_grant')` + backfill + partial index | canonical method discriminator (single source of truth — `metadata.payment_method` is NOT used). Backfill: `provider='admin_grant'` → `'admin_grant'`, everything else → `'card'`. Webhook handler reads/writes this column via `detectPaymentMethod()` (positive-signal whitelist) + `markOrderPaid({detectedPaymentMethod})`. |
| `0064_learner_reminder_dispatches.sql` | BCS-DEF-4 (2026-05-19, **NOT YET MERGED — on `feat/bcs-def-4-learner-reminders-impl`**) | new table `learner_reminder_dispatches` | per-slot reminder-dispatch idempotency ledger for the single 60-min learner lesson reminder (email MVP). |
| `0065_accounts_learner_telegram_optin.sql` | BCS-DEF-4 (2026-05-19, **NOT YET MERGED**) | adds per-account Telegram opt-in fields to `accounts` | placeholder columns + CHECK constraints for the future per-user TG channel handshake (BCS-DEF-4-TG). Cabinet/profile surfaces the opt-in state as a stub until the BotFather handshake activates. |
| `0066_probe_runs_learner_reminders.sql` | BCS-DEF-4 (2026-05-19, **NOT YET MERGED**) | extends `probe_runs_probe_name_check` | adds `'learner-reminders'` to the CHECK so the new probe (`scripts/learner-reminder-dispatch.mjs`) can write rows. |
| `0067_teacher_account_daily_digests.sql` | BCS-DEF-5 (2026-05-19) | new table `teacher_account_daily_digests` | daily 08:00 teacher digest dedup + audit ledger. PK `(account_id, sent_date)` enforces idempotency (`sent_date` is the teacher's LOCAL calendar day, not UTC). State machine encoded as CHECK: `email_sent` + `skipped_reason in (NULL, 'empty_day', 'account_email_missing', 'send_failed')` + attempts-vs-max-attempts terminal semantics. Operator widget reads via partial index on `sent_at desc where email_sent = true`. |
| `0068_probe_runs_teacher_daily_digest.sql` | BCS-DEF-5 (2026-05-19) | extends `probe_runs_probe_name_check` + `probe_runs_verdict_kind_check` | adds `'teacher-daily-digest'` to the probe-name CHECK + 3 new verdict kinds (`digest_sent`, `digest_skipped_disabled`, `digest_no_teachers`). The digest cron writes one `probe_runs` row per tick (sibling of the 4 alert probes) but the standard `PROBE_NAMES` iteration on `/admin/settings/alerts` is unchanged — digest gets its own `/admin/settings/digest` surface backed by `lib/admin/digest-summary.ts`. |
| `0069_account_profiles_timezone_check.sql` | BCS-DEF-5 (2026-05-19) | adds NOT VALID + VALIDATE CHECK on `account_profiles.timezone` against the 19-IANA allowlist | belt-and-suspenders DB-side gate for the digest cron SQL hot path (`now() AT TIME ZONE coalesce(p.timezone, 'Europe/Moscow')`). Re-normalizes any non-IANA legacy rows to NULL (idempotent vs migration 0048), then ADD CONSTRAINT NOT VALID + VALIDATE CONSTRAINT. Allowlist MUST stay in lockstep with `lib/auth/timezones.ts` + `scripts/lib/timezone.mjs`. |

90-day retention for `probe_runs` lives in `scripts/db-retention-cleanup.mjs`. The probe-name CHECK is extended in lockstep with every new probe — 0058 (`conflict-unresolved`), 0066 (`learner-reminders`, BCS-DEF-4 pending), 0068 (`teacher-daily-digest`). Recipient-kind discriminator (`'email' | 'telegram'`) lives in column form via migration 0061. Key rotations for the calendar-encrypted columns (separate from audit-encryption key) ship as `scripts/rotate-calendar-encryption.mjs` (AUDIT-SEC-2, 2026-05-17; covers four columns: access_token_enc, refresh_token_enc, channel_token_enc, summary_encrypted). AUDIT-SEC-4 (2026-05-17) Phase B null-out of legacy plaintext `channel_token` ships as `scripts/null-plaintext-channel-token.mjs` — operator-driven, gated behind preflight + snapshot + post-verify; see SECURITY.md §AUDIT-SEC-4 channel_token migration.

ALERTS-EDITOR (2026-05-18) ships `operator_settings` (migration 0055) — operator-tunable alert thresholds across the systemd probes (10 keys at ship; extended to 14 by BCS-DEF-1 Phase 1 with 4 new `CONFLICT_UNRESOLVED_*` keys, 2026-05-19); resolver chain DB → env → hardcoded-default in `lib/admin/operator-settings.ts` (server) + `scripts/lib/operator-settings.mjs` (probes). Per-probe snapshot read at tick start; writes are single-TX (config + audit row in `operator_settings_events` with a trigger that blocks UPDATE unconditionally and blocks DELETE on rows < 89 days — recent rows stay immutable so app-compromise cannot erase audit history; 90-day retention sweep prunes only `ts < now() - 90 days` rows). Editor UI at `/admin/settings/alerts` with optimistic concurrency via `expectedUpdatedAt`. `ALERT_EMAIL_TO` stays env-only per security review (suppression/reroute surface).

### Security layer

- [`scripts/cancel-stale-orders.mjs`](scripts/cancel-stale-orders.mjs) - hourly systemd job that flips abandoned pending orders to `cancelled` past `STALE_ORDER_THRESHOLD_MINUTES` (default 60, floor 30). Per-row tx writes the order event + audit row. Reference unit / timer in `scripts/systemd/levelchannel-stale-orders.{service,timer}`
- [`lib/payments/status-bus.ts`](lib/payments/status-bus.ts) - in-process `EventEmitter` for payment status transitions; `markOrderPaid` / `markOrderFailed` / `markOrderCancelled` emit on real transitions only. Multi-instance future swaps to PG `LISTEN/NOTIFY` without changing call sites
- [`lib/scheduling/slots/`](lib/scheduling/slots/) - Phase 4 store ops + bulk-preview generator, split into a 9-file folder via Waves 39-40 (1746-line god-module → siblings under 400 LOC each, facade keeps `@/lib/scheduling/slots`). Atomic UPDATE-with-`status='open'` re-assert for concurrent-book races; UTC-stored `start_at`, IANA tz at render. Phase 5 added `canLearnerCancel` (24h pure helper, env-tunable via `LEARNER_CANCEL_WINDOW_HOURS` since POLICY-KNOBS 2026-05-17 — see `lib/scheduling/policy.ts`), `markSlotLifecycle` (operator stamp on past-booked rows), `autoCompletePastBookedSlots` (cron sweep). Folder layout: `types.ts` (public type surface + lifecycle constants), `internal.ts` (sibling-only DB plumbing), `validation.ts` (pure validators incl. MSK business-band), `queries.ts` (read-only DB ops), `lifecycle.ts` (mark + auto-complete), `mutations-write.ts` (createSlot / bulk / edit / move / delete — no billing), `mutations-cancel.ts` (cancel ops, dynamic `lib/billing/consumption`), `booking.ts` (`bookSlot` — always runs the per-pair payment-method gated billing pipeline since the `BILLING_WAVE_ACTIVE` flag retired in Quality Sub-PR B, 2026-06-02), `index.ts` (facade). `/api/slots/*` (cabinet — list available + mine + book + cancel with 24h gate) and `/api/admin/slots/*` (admin — single + bulk-preview + bulk-create + edit + delete + cancel + book-as-operator + lifecycle mark). Cabinet UI at [`app/cabinet/lessons-section.tsx`](app/cabinet/lessons-section.tsx) splits Предстоящие / Прошедшие and surfaces the «<24ч — через оператора» hint; admin UI at [`app/admin/slots/`](app/admin/slots) with weekday-grid bulk preview-deselect-commit flow + per-row lifecycle buttons
- [`scripts/auto-complete-slots.mjs`](scripts/auto-complete-slots.mjs) - daily systemd job (03:30 UTC) that flips still-`booked` lesson_slots rows whose `start_at + duration_minutes` has elapsed to `completed`. Reference unit / timer in `scripts/systemd/levelchannel-auto-complete-slots.{service,timer}`
- [`lib/payments/allocations.ts`](lib/payments/allocations.ts) - Phase 6 payment_allocations store ops: `recordAllocation` (best-effort insert from the Pay webhook on `metadata.slotId`), `listAllocationsForOrder`, `listSlotPaidStatus(slotIds[])` for the cabinet-side bulk «оплачено» check
- [`lib/payments/admin-list.ts`](lib/payments/admin-list.ts) + [`app/admin/payments/`](app/admin/payments) - operator-side payment list at `/admin/payments` with status / e-mail filters and pagination + detail page at `/admin/payments/[invoiceId]` showing the order, audit events trail, and payment_allocations with linked lesson_slots
- [`app/checkout/[tariffSlug]/page.tsx`](app/checkout/[tariffSlug]/page.tsx) + [`checkout-form.tsx`](app/checkout/[tariffSlug]/checkout-form.tsx) - tariff-bound public checkout. Runs in parallel with `/pay` (which stays free-amount). Optional `?slot=<uuid>` binds the resulting paid invoice to a `lesson_slot` via `payment_allocations` written from the CloudPayments Pay webhook handler. PKG-LEARNER-BUY LBL.2 (2026-05-16) threaded the receipt token into the post-init redirect so `/thank-you` can authorise its status fetch on the in-app branch (mock + cloudpayments-widget success path)
- [`lib/billing/packages/eligibility.ts`](lib/billing/packages/eligibility.ts) - PKG-LEARNER-BUY LBL.0 (2026-05-16) `learnerHasActivePackageOfDuration(accountId, durationMinutes)` predicate used as Gate 2 in `/api/checkout/package/[slug]` (alongside `accountHasPendingPackageGrantForDuration` in `lib/billing/packages/purchases.ts`). Must stay logically identical to the WHERE-fragment inside `listAccountActivePackages` (`voided_at IS NULL` AND `expires_at > now()` AND `count_remaining > 0`); a drift test in [`tests/integration/billing/learner-buy-eligibility.test.ts`](tests/integration/billing/learner-buy-eligibility.test.ts) pins the predicate to the SoT so a new exclusion on the cabinet read path cannot silently relax the buy gate. Epic-end paranoia round-1 BLOCKER #1: the `count_remaining > 0` filter MUST live in SQL — moving it to JS allowed the helper to return null when an earlier exhausted purchase shadowed a later active one, falsely admitting a third buy
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
- [`app/api/checkout/package/[slug]/route.ts`](app/api/checkout/package/%5Bslug%5D/route.ts) - package-buy init. PKG-LEARNER-BUY LBL.0 (2026-05-16) refactor in place: guard via `requireLearnerArchetypeAndVerified` + post-guard `isLearnerArchetypeCandidate` (deletion-grace coverage; matches the cabinet page SoT). **SAAS-PIVOT security-audit HIGH-1/HIGH-2 (2026-05-23) closures:** route now accepts `?packageId=<uuid>` (preferred — canonical row lookup; refuses with 404 if `packageId` points at a different slug than the URL claims) and `?teacher=<uuid>` (composite slug lookup). Bare slug refuses with 400 `package_slug_ambiguous` when `countPackagesBySlug > 1` (mig 0089 retired global UNIQUE(slug)). After resolving the package row, refuses with 422 `plan_4_required` when the owning teacher is non-plan-4 — mirrors the gate on `/api/payments`, `/api/payments/sbp/create-qr`, `/api/payments/charge-token`, and `POST /api/teacher/packages`. Wrapped in `withIdempotency(scope = checkout:package:${pkg.id}:${slug}:${accountId})` — `pkg.id` is the load-bearing portion so the cache cannot bridge two teachers sharing the same slug (security-audit round-1 BLOCKER closure). The body of the idempotency callback acquires a dedicated `PoolClient`, opens a TX, and takes a per-(accountId, durationMinutes) `pg_advisory_xact_lock(hashtextextended('pkg-stack:' || account || ':' || duration, 0))` on it. The `pkg-stack:` prefix is shared with the admin-grant route AND `lib/billing/package-grant.ts:processPackageGrant` (PKG-ADMIN-GRANT epic-end paranoia BLOCKER #1 closure, 2026-05-16) so a concurrent admin grant + learner buy + delayed webhook for the same `(account, duration)` all serialise against each other. The two gates — Gate 1 (`accountHasPendingPackageGrantForDuration` → 409 `pending_package_in_flight`) and Gate 2 (`learnerHasActivePackageOfDuration` → 409 `already_owns_active_package`) — read via the shared pool (NOT the lock client), which is correct because the lock blocks any other session from racing between their reads and the lock-holder's `INSERT INTO payment_orders` on the lock client, all inside the same TX. After the TX commits, the route calls `buildCloudPaymentsWidgetIntent(order, { receiptToken })` for `provider=cloudpayments` and returns the intent in the response body as `checkoutIntent` (mock provider returns `checkoutIntent: null`). Different-duration purchases from the same learner proceed concurrently.

#### API surface map (all 88 routes, May 2026)

The route docstrings above lean toward "load-bearing context" rather than complete coverage. This table is the quick-reference for every route under `app/api/`: who guards it, what it does in one sentence. The 12 routes documented in detail above are linked there; the rest live as code comments. Count refreshed 2026-05-19 (post-burst) — 2 new routes added since the 86-route mid-burst baseline: `app/api/admin/slots/[id]/dismiss-conflict` (BCS-DEF-2 conflict-feed) + `app/api/payments/sbp/create-qr` (SBP-PAY). BCS-DEF-4 (learner reminders) is on a feature branch and will add `learner-reminders` status reads when merged.

##### Public — auth + checkout (anonymous-eligible)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `app/api/auth/register` | POST | anonymous | account create + consent record + verify-email send |
| `app/api/auth/login` | POST | anonymous | session mint, sha256 cookie set |
| `app/api/auth/logout` | POST | session | revoke session row |
| `app/api/auth/me` | GET | session | current account + clears cookie on stale |
| `app/api/auth/verify` | POST | anonymous + token | verify-email finalize (single-use token) |
| `app/api/auth/resend-verify` | POST | session | rate-limited resend of verify-email |
| `app/api/auth/reset-request` | POST | anonymous | password-reset link send (enumeration-safe) |
| `app/api/auth/reset-confirm` | POST | anonymous + token | password-reset finalize + revoke all sessions |
| `app/api/payments` | POST | anonymous | tariff-free-amount payment init (legacy /pay flow) |
| `app/api/payments/[invoiceId]` | GET | receipt-token gate | order status read |
| `app/api/payments/[invoiceId]/cancel` | POST | receipt-token gate | abandon pending order |
| `app/api/payments/[invoiceId]/stream` | GET (SSE) | receipt-token gate | live payment status events |
| `app/api/payments/events` | POST | anonymous | client-side telemetry beacons |
| `app/api/payments/saved-card` | POST | session | one-click eligibility check by email |
| `app/api/payments/charge-token` | POST | session | one-click charge via CP `tokens/charge` |
| `app/api/payments/3ds-callback` | POST | anonymous + invoice | 3DS ACS return finalize |
| `app/api/payments/mock/[invoiceId]/confirm` | POST | anonymous (gated by env) | mock-mode payment confirm |
| `app/api/checkout/package/[slug]` | POST | learner-archetype + verified | package buy init (PKG-LEARNER-BUY) |
| `app/api/payments/sbp/create-qr` | POST | rate-limit + `SBP_ENABLED` env + origin-check + idempotency-key | SBP-PAY (2026-05-19) — create CloudPayments-hosted SBP QR for the order. Writer-side resolves account id via `lib/payments/order-account-resolver.ts` (admin rejected; teacher + learner-with-teacher hybrid accepted — writer is strictly less privileged than the reader, which rejects both admin AND teacher). Sets `payment_orders.payment_method='sbp'` at create-qr time. **PAY-SBP-REMOVAL 2026-05-20**: route operator-gated by `SBP_ENABLED=true` env (default off → 503 `sbp_disabled`). |
| `app/api/payments/webhooks/cloudpayments/{check,pay,fail}` | POST | HMAC | CloudPayments webhook handlers (Pay handler classifies `card` vs `sbp` via `detectPaymentMethod()`) |
| `app/api/health` | GET | anonymous | health probe (no DB roundtrip needed) |

##### Cabinet — learner account (session required)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `app/api/account/profile` | GET / PUT | session | account profile read + update |
| `app/api/account/packages` | GET | session | learner's active package purchases + remaining counts |
| `app/api/account/postpaid-debt` | GET | session | postpaid debt summary for the learner |
| `app/api/account/consents/withdraw` | POST | session | withdraw personal-data consent (deletion grace path) |
| `app/api/account/delete` | POST | session | request account deletion (stamps `scheduled_purge_at`) |
| `app/api/slots/mine` | GET | learner-archetype | own slots (upcoming + past) |
| `app/api/slots/available` | GET | anonymous | open slots for a tariff/teacher pair |
| `app/api/slots/calendar` | GET | anonymous | calendar grid view for a teacher |
| `app/api/slots/booking-days` | GET | learner-archetype + verified | Calendly screen-1 day picker |
| `app/api/slots/booking-times` | GET | learner-archetype + verified | Calendly screen-2 time list |
| `app/api/slots/[id]/book` | POST | learner-archetype + verified | book a slot (TX with overlap check + push intent) |
| `app/api/slots/[id]/cancel` | POST | learner-archetype | cancel learner-side (24h gate) |

##### Teacher — calendar surface (teacher role required)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `app/api/teacher/slots` | GET / POST | teacher + verified | own slots list + create single |
| `app/api/teacher/slots/bulk-create` | POST | teacher + verified | bulk-create slots in a date range |
| `app/api/teacher/slots/[id]/cancel` | POST | teacher + verified | cancel teacher-side |
| `app/api/teacher/slots/[id]/move` | PATCH | teacher + verified | move an open slot |
| `app/api/teacher/slots/[id]/conflicts` | GET | teacher + verified | per-slot live conflict re-scan (+N other conflicts picker) |
| `app/api/teacher/slots/[id]/dismiss-conflict` | POST | teacher + verified | clear `external_conflict_at` for a slot |
| `app/api/teacher/slots/[id]/delete-external-conflict` | POST | teacher + verified | synchronous Google events.delete on the foreign event |
| `app/api/teacher/hidden-slots` | GET | teacher + verified | BCS-G hidden-slots (own events of LC that fell out of MSK business band) |
| `app/api/teacher/calendar/google/start` | POST | teacher + verified | begin Google OAuth (returns authorizationUrl) |
| `app/api/teacher/calendar/google/callback` | GET | OAuth state nonce | OAuth code exchange + integration upsert |
| `app/api/teacher/calendar/google/disconnect` | POST | teacher + verified | clear tokens + flip `sync_state='disconnected'` |
| `app/api/teacher/calendar/orphan-slots` | GET | teacher + verified | post-disconnect drift list (slots with stale `external_event_id`) |
| `app/api/teacher/calendar/orphan-slots/ignore` | POST | teacher + verified | suppress one orphan-self row |
| `app/api/teacher/slots/[id]/zoom-url` | PATCH | teacher + verified | set/clear `lesson_slots.zoom_url` on a booked slot (BCS-DEF-3, migration 0056) |
| `app/api/teacher/invites` | GET / POST | teacher + verified | list own active invites + mint a new HMAC-signed invite link (SAAS-3+4 TINV.4) |
| `app/api/teacher/invites/[id]/revoke` | POST | teacher + verified | revoke an unused invite row (`withIdempotency`); audit `auth.invite.revoked` |

##### Admin — operator surface (admin role required, `requireAdminRole` + origin gate + rate limit)

| Route | Method | Purpose |
|---|---|---|
| `app/api/admin/accounts/[id]/cancel-deletion` | POST | clear `scheduled_purge_at` (operator-side undelete during grace) |
| `app/api/admin/accounts/[id]/disable` | POST | toggle `disabled_at` + revoke sessions (`withIdempotency`) |
| `app/api/admin/accounts/[id]/role` | POST | grant / revoke admin / teacher / student role (`withIdempotency`) |
| `app/api/admin/accounts/[id]/teacher` | POST | bind a teacher to a learner (assigned-teacher contract) |
| `app/api/admin/pricing` + `[id]` | GET/POST/PATCH/DELETE | tariff CRUD; hard-delete refused when slots reference; price + duration immutable post-purchase |
| `app/api/admin/packages` + `[id]` | GET/POST/PATCH/DELETE | package CRUD; economic fields immutable after first purchase (0033 trigger) |
| `app/api/admin/packages/[id]/grant` | POST | PKG-ADMIN-GRANT non-money operator grant (synthetic `payment_orders` row + audit) |
| `app/api/admin/slots` + `[id]` | GET/POST/PATCH/DELETE | slot CRUD (operator-side) |
| `app/api/admin/slots/bulk-preview` + `bulk-create` | POST | weekday-grid bulk slot generation: preview deselect, commit |
| `app/api/admin/slots/[id]/cancel` | POST | cancel slot (operator-side; reason required for booked) |
| `app/api/admin/slots/[id]/move` | PATCH | move open slot (operator-side) |
| `app/api/admin/slots/[id]/mark` | POST | operator lifecycle stamp (manual completed / no-show / refunded) |
| `app/api/admin/slots/[id]/book-as-operator` | POST | book a slot on behalf of a learner |
| `app/api/admin/slots/[id]/zoom-url` | PATCH | set/clear `lesson_slots.zoom_url` on a booked slot (BCS-DEF-3, migration 0056) |
| `app/api/admin/slots/[id]/dismiss-conflict` | POST | BCS-DEF-2 (2026-05-19) — clear `external_conflict_at` on a booked slot from the `/admin/slots/conflicts` dashboard; writes `slot_admin_actions` row (`action='dismiss-conflict'`) + jsonb event in `lesson_slots.events`. 42P01 recovered via SAVEPOINT — table-absent in deploy-before-migrate window does NOT fail the dismiss |
| `app/api/admin/payments/*` (page surfaces, not API) | — | payments list + detail (read-only admin page) |
| `app/api/admin/refunds` | POST | record refund / package reversal (existing manual ledger) |
| `app/api/admin/refunds/gateway-initiated` | POST | initiate CP-side refund via `payments/refund` API |
| `app/api/admin/debt-summary` | GET | postpaid debt rollup across all learners |
| `app/api/admin/legal/versions` | GET / POST | publish legal-document versions (offer / privacy / personal_data) |
| `app/api/admin/reconciliation/package-grants` | GET | PKG-RECON list of `paid_not_granted` orders |
| `app/api/admin/reconciliation/package-grants/[invoiceId]/retry-grant` | POST | re-run `processPackageGrant` for a stuck order |
| `app/api/admin/reconciliation/package-grants/[invoiceId]/attach-account` | POST | rewrite metadata.accountId + re-run grant |
| `app/api/admin/reconciliation/package-grants/[invoiceId]/mark-resolved` | POST | durable resolution row (refunded_offline / manual_grant / comped / other) |
| `app/api/admin/settings/alerts/[probe]/test-send` | POST | ALERTS-OBS dry-run test email + `probe_runs` is_test row |
| `app/api/admin/settings/alerts/setting/[key]` | PATCH | ALERTS-EDITOR Sub-PR C operator-tunable threshold update; optimistic concurrency via `expectedUpdatedAt`; single-TX config write + `operator_settings_events` audit row (migration 0055) |

##### Calendar webhook + cron surfaces

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `app/api/calendar/google/webhook` | POST | constant-time channel-token + monotonic message-number | Google channels.watch push-notification receiver |
| `app/api/cron/calendar/pull` | POST | cron-auth (loopback + bearer) | drain calendar_pull_jobs |
| `app/api/cron/calendar/push` | POST | cron-auth | drain calendar_push_jobs |
| `app/api/cron/calendar/intents` | POST | cron-auth | drain slot_lifecycle_intents |
| `app/api/cron/calendar/renew-channels` | POST | cron-auth | rotate Google watch channels approaching expiry |
| `app/api/cron/calendar/revive-blocked` | POST | cron-auth | flip blocked_integration intents back to pending |
| `app/api/cron/calendar/reconcile` | POST | cron-auth | BCS-G.1 bounded reconcile sweep (daily only) |

### Booking + calendar sync (BCS wave, in flight)

Wave-level design: [`docs/plans/booking-calendly-style.md`](docs/plans/booking-calendly-style.md) (7-round Codex paranoia loop SIGN-OFF). Shipped sub-waves: BCS-A schema (migrations 0042-0045), BCS-B Calendly-style learner booking, BCS-C OAuth integration scaffold + UI, BCS-D pull worker + webhook + channel renewal + D.5 atomic gate, BCS-E push primitives + push worker + intent worker + cancel split + book wire-up, BCS-F.1 post-pull conflict detector + F.UI non-dismissable red banner + 3 action endpoints. In flight: BCS-G reconciliation + hidden slots; deferred BCS-F.3 in-calendar highlight, admin/teacher cancel-push wire, move push.

- [`migrations/0042_lesson_slots_calendar_columns.sql`](migrations/0042_lesson_slots_calendar_columns.sql) — agenda, external_event_id/calendar_id/etag, integration_epoch, external_conflict_*, conflict_source_*, last_reconciled_at, cancel_repush_count. Paired-binding CHECK + enum CHECKs.
- [`migrations/0043_teacher_calendar_integrations.sql`](migrations/0043_teacher_calendar_integrations.sql) — per-teacher Google OAuth state, encrypted tokens (CALENDAR_ENCRYPTION_KEY: access_token_enc / refresh_token_enc; channel_token_enc added in migration 0054 AUDIT-SEC-4), sync_state + epoch + last_reconnected_at + last_pulled_at, channel triple. MSK-only trigger + symmetric `account_profiles.timezone` guard.
- [`migrations/0054_calendar_channel_token_enc.sql`](migrations/0054_calendar_channel_token_enc.sql) — AUDIT-SEC-4 (2026-05-17) adds nullable bytea `channel_token_enc`. Dual-write in `lib/calendar/channel-renewer.ts setupChannelForIntegration` with a top-of-function fail-closed guard (key+schema preflight before any external Google call); decrypt-aware read in the webhook handler with plaintext fallback for legacy rows. Phase B null-out via `scripts/null-plaintext-channel-token.mjs` (operator, post-rollback-window).
- [`migrations/0044_teacher_external_busy_intervals.sql`](migrations/0044_teacher_external_busy_intervals.sql) — pull-cached Google busy intervals. is_own_event + is_orphan_self for F8 epoch-aware self-echo. summary_encrypted (30d retention).
- [`migrations/0045_calendar_jobs.sql`](migrations/0045_calendar_jobs.sql) — calendar_push_jobs + calendar_pull_jobs + slot_lifecycle_intents. Partial unique indexes for pending dedup.

Library surface (`lib/calendar/`):

- [`lib/calendar/encryption.ts`](lib/calendar/encryption.ts) — CALENDAR_ENCRYPTION_KEY resolver mirroring `lib/audit/encryption.ts`. Separate key from audit for blast-radius (plan §8 #6); optional `_KEY_OLD` for rotation read-fallback. Covers four columns: access_token_enc, refresh_token_enc, channel_token_enc (AUDIT-SEC-4), summary_encrypted.
- [`lib/calendar/google/config.ts`](lib/calendar/google/config.ts) — env config resolver for `GOOGLE_CALENDAR_CLIENT_ID/SECRET/REDIRECT_URL` + `GOOGLE_OAUTH_STATE_SECRET`. Exports the minimum OAuth scope list (`calendar.events` + `calendar.calendarlist.readonly`).
- [`lib/calendar/google/state.ts`](lib/calendar/google/state.ts) — HMAC-signed CSRF state nonce bound to issuing account_id. Constant-time verify, 10-min TTL, future-skew defense.
- [`lib/calendar/google/oauth.ts`](lib/calendar/google/oauth.ts) — `buildAuthorizationUrl`, `exchangeCodeForTokens`, `refreshAccessToken`. Discriminated error union; no in-lib retries.
- [`lib/calendar/google/pull.ts`](lib/calendar/google/pull.ts) — `pullBusyIntervalsForCalendar` (events.list, bounded `[now-1d, now+30d]`, paginated, MSK-pinned all-day) and `listCalendars` (calendarList.list paginated, derives `isWritable` from accessRole). `shapeEvent` is a total function — bad date input returns null.
- [`lib/calendar/integrations.ts`](lib/calendar/integrations.ts) — DB store ops for `teacher_calendar_integrations`. pgcrypto in SQL for token at-rest. `upsertGoogleIntegration({ reason: 'initial_connect' | 'token_refresh' })`. `initial_connect` rotates epoch + bumps last_reconnected_at + clears last_pulled/push_at + channel triple.
- [`lib/calendar/pull-runner.ts`](lib/calendar/pull-runner.ts) — D.2a `runPullForCalendar`. Per (teacher, calendar): pull busy intervals via lib/calendar/google/pull, compute is_own_event / is_orphan_self per F8 epoch rule (foreign slot ids rejected for security), EITHER full-rewrite (token=NULL / inactive teacher / first cycle) OR delta merge (delete cancelled events + upsert active events; persist new `next_sync_token` in same TX under optimistic `IS NOT DISTINCT FROM … AND epoch =` guard) per BCS-DEF-7 §2, in one tx; bump last_pulled_at + flip sync_state to active. summary_encrypted via pgp_sym_encrypt in SQL, 64-char truncate.
- [`lib/calendar/google/token-refresh.ts`](lib/calendar/google/token-refresh.ts) — D.complete `ensureFreshAccessToken`. 60s skew, refresh via oauth.ts when expired, upsert via integrations.ts (token_refresh mode preserves epoch). Permanent failure (400/401/403) flips integration to disconnected. Transient (5xx/network) bubbles up so caller can retry.
- [`lib/calendar/pull-worker.ts`](lib/calendar/pull-worker.ts) — D.complete `drainPullJobs` + `enqueuePullJob`. FOR UPDATE SKIP LOCKED claim, ensureFreshAccessToken + runPullForCalendar per job, retry-with-backoff (1/2/5/15/30 min, MAX_ATTEMPTS=5) on transient failure, terminal_failure on permanent. ON CONFLICT DO UPDATE with LEAST(next_run_at) + GREATEST(priority) so a webhook upgrade always wins over a backoff-pushed prior row.
- [`lib/calendar/channel-renewer.ts`](lib/calendar/channel-renewer.ts) — D.4 `setupChannelForIntegration` (registers Google channels.watch on the read calendar set) + `renewExpiringChannels` (cron sweep for channels approaching expiry). SQL filter `cardinality(read_calendar_ids) > 0` so empty-array integrations are skipped.
- [`lib/calendar/google/push.ts`](lib/calendar/google/push.ts) — E.1 idempotent `insertEventIdempotent` / `patchEvent` / `deleteEvent` against Google Calendar API. Deterministic event id via `deterministicEventId(slotId)` using base32hex alphabet (Google's required encoding). Idempotency: on 409 Conflict from events.insert we events.get and confirm `extendedProperties.shared.lc_slot_id` matches — if so, accept as success; otherwise `ownership_mismatch`. Patch/delete 404/410 are treated as terminal success (event already gone).
- [`lib/calendar/push-worker.ts`](lib/calendar/push-worker.ts) — E.worker `drainPushJobs` + `enqueuePushJob` + `enqueueCreatePushIfIntegrationActive`. FOR UPDATE SKIP LOCKED claim. processCreate / processDelete wrap post-API DB writes (slot binding UPDATE + job mark-succeeded) in one explicit BEGIN/COMMIT via `pool.connect()` — plan §8 #1 lock order. Cancelled slot on create → `cancelled_by_dependent` (no Google call). Delete uses `COALESCE(external_event_id, deterministicEventId(slot.id))`. Retry classification: 5xx/429/403-quota/network/shape transient; 4xx other (incl. 403 non-quota) permanent.
- [`lib/calendar/intent-worker.ts`](lib/calendar/intent-worker.ts) — E.worker `drainIntents` + `insertPostCancelIntent` (called inside the cancel TX) + `reviveBlockedIntents`. processPostCancelPush: no integration row → no_op regardless of binding (plan §4.6 F6‴ no-false-success); integration disconnected → blocked_integration (re-checked hourly, terminal after MAX_ATTEMPTS); integration active → enqueue delete push + verify a pending/in_progress delete row landed before marking succeeded.
- [`lib/calendar/conflict-detector.ts`](lib/calendar/conflict-detector.ts) — F.1 `runConflictDetectionForTeacher` + `listConflictsForSlot`. Filters `is_own_event = false AND is_orphan_self = false` so the detector never raises a false alarm on LC's own pushed events or its own post-disconnect drift.
- [`lib/calendar/dates.ts`](lib/calendar/dates.ts) / [`lib/calendar/drag-state.ts`](lib/calendar/drag-state.ts) / [`lib/calendar/paint-synth.ts`](lib/calendar/paint-synth.ts) / [`lib/calendar/types.ts`](lib/calendar/types.ts) / [`lib/calendar/view-model.ts`](lib/calendar/view-model.ts) — Wave-A/B/C operator calendar grid helpers (pre-dates BCS).

API routes (BCS):

- [`app/api/slots/booking-days/route.ts`](app/api/slots/booking-days/route.ts) — Calendly screen-1 day picker, learner-only, range cap 92 days.
- [`app/api/slots/booking-times/route.ts`](app/api/slots/booking-times/route.ts) — Calendly screen-2 time list, learner-only.
- [`app/api/teacher/calendar/google/start/route.ts`](app/api/teacher/calendar/google/start/route.ts) — POST, teacher+verified, returns `{ authorizationUrl }`.
- [`app/api/teacher/calendar/google/callback/route.ts`](app/api/teacher/calendar/google/callback/route.ts) — GET (Google 302 destination). State nonce CSRF defense, all failures redirect to /teacher/settings/calendar.
- [`app/api/teacher/calendar/google/disconnect/route.ts`](app/api/teacher/calendar/google/disconnect/route.ts) — POST, teacher+verified, clears tokens + sync_state=disconnected (no Google cascade-delete).
- [`app/api/calendar/google/webhook/route.ts`](app/api/calendar/google/webhook/route.ts) — D.complete Google channels.watch push-notification receiver. Plan §4.9 security: constant-time channel_token, channel_id + resource_id match, monotonic X-Goog-Message-Number guard. All failures return silent 200 (Google retries; replay defense in headers). On valid message: bump last_seen_message_number AND enqueue per-calendar pull jobs in the SAME transaction.
- [`app/api/cron/calendar/pull/route.ts`](app/api/cron/calendar/pull/route.ts) — BCS-OP-ROLLOUT cron: drains `calendar_pull_jobs` (Google events.list → busy_intervals refresh). Two-layer gate (loopback Host + bearer), per plan §4.2.
- [`app/api/cron/calendar/push/route.ts`](app/api/cron/calendar/push/route.ts) — BCS-OP-ROLLOUT cron: drains `calendar_push_jobs` (LC bookings → Google events).
- [`app/api/cron/calendar/intents/route.ts`](app/api/cron/calendar/intents/route.ts) — BCS-OP-ROLLOUT cron: drains `slot_lifecycle_intents` (mainly post_cancel_push enqueues).
- [`app/api/cron/calendar/renew-channels/route.ts`](app/api/cron/calendar/renew-channels/route.ts) — BCS-OP-ROLLOUT cron: rotates Google watch channels approaching expiry. Replaces the legacy `app/api/calendar/cron/channel-renewal/route.ts` entry point — auth-gated via cron-auth helper.
- [`app/api/cron/calendar/revive-blocked/route.ts`](app/api/cron/calendar/revive-blocked/route.ts) — BCS-OP-ROLLOUT cron: flips `blocked_integration` intents back to `pending` after teacher reconnects.
- [`app/api/cron/calendar/reconcile/route.ts`](app/api/cron/calendar/reconcile/route.ts) — BCS-OP-ROLLOUT cron: runs the F9‴ bounded reconcile sweep (BCS-G.1). Daily only — invariant per plan §6 #3.
- [`lib/api/cron-auth.ts`](lib/api/cron-auth.ts) — BCS-OP-ROLLOUT shared cron-route gate. Loopback Host (404 on mismatch — hides route from external scans) + bearer secret (constant-time compare against `CRON_SHARED_SECRET`; 503 if env unset). 12/min/IP rate-limit defense-in-depth on every cron route.
- [`scripts/calendar-cron.mjs`](scripts/calendar-cron.mjs) — BCS-OP-ROLLOUT systemd entry. `CALENDAR_CRON_TARGET` env-var dispatches to one of the 6 routes above; per-target HTTP timeout (TimeoutStartSec − 30s) aborts the fetch cleanly before systemd SIGKILL. Reference units `scripts/systemd/levelchannel-calendar-{pull,push,intents,renew-channels,revive-blocked,reconcile}.{service,timer}`.
- [`app/api/calendar/cron/conflict-detect/route.ts`](app/api/calendar/cron/conflict-detect/route.ts) — F.1 cron: runs `runConflictDetectionForTeacher` across teachers with active integrations, populates `external_conflict_*` columns on overlapping slots.
- [`app/api/teacher/slots/[id]/conflicts/route.ts`](app/api/teacher/slots/[id]/conflicts/route.ts) — F.4 GET: list overlapping foreign events for a slot.
- [`app/api/teacher/slots/[id]/dismiss-conflict/route.ts`](app/api/teacher/slots/[id]/dismiss-conflict/route.ts) — F.4 POST: teacher accepts the overlap (no Google action).
- [`app/api/teacher/slots/[id]/delete-external-conflict/route.ts`](app/api/teacher/slots/[id]/delete-external-conflict/route.ts) — F.4 POST: deletes the foreign event from Google. Read-only-calendar check refuses gracefully.

UI (BCS):

- [`app/cabinet/book/page.tsx`](app/cabinet/book/page.tsx) + [`month-day-picker.tsx`](app/cabinet/book/month-day-picker.tsx) — Calendly screen 1.
- [`app/cabinet/book/[ymd]/page.tsx`](app/cabinet/book/[ymd]/page.tsx) + [`time-list.tsx`](app/cabinet/book/[ymd]/time-list.tsx) — Calendly screen 2.
- [`app/cabinet/book/[ymd]/[slotId]/page.tsx`](app/cabinet/book/[ymd]/[slotId]/page.tsx) + [`confirm-form.tsx`](app/cabinet/book/[ymd]/[slotId]/confirm-form.tsx) — Calendly screen 3, captures agenda.
- [`app/teacher/settings/calendar/page.tsx`](app/teacher/settings/calendar/page.tsx) + [`connect-card.tsx`](app/teacher/settings/calendar/connect-card.tsx) — Google connect/disconnect + plain-language onboarding copy.
- [`app/cabinet/settings/calendar/page.tsx`](app/cabinet/settings/calendar/page.tsx) — learner read-only status of teacher's integration.
- [`app/teacher/page.tsx`](app/teacher/page.tsx) — F.UI hosts the non-dismissable red conflict banner driven by `countTeacherConflicts`. F.3 copy: directs teachers to use the slot modal (cancel via existing flow); other actions reachable via the conflict-marked slot in the calendar grid.
- [`app/teacher/client.tsx`](app/teacher/client.tsx) — F.3: `TeacherSlotDetailModal` extended with per-conflict action block. When the booked slot carries `externalConflictAt`, the modal shows two extra buttons wired to `/api/teacher/slots/[id]/dismiss-conflict` and `/api/teacher/slots/[id]/delete-external-conflict`. Success-path is split per action (no false "Слот отменён" toast on dismiss/delete). On success `router.refresh()` is called so the SSR conflict banner upstairs rebuilds.
- [`components/calendar/SlotBlock.tsx`](components/calendar/SlotBlock.tsx) — F.3 conflict palette: a `booked-full` slot with `externalConflictAt != null` renders with a red 2px outline, red palette, ⚠ glyph in the time line, and "(конфликт)" suffix in label + aria-label. Tooltip becomes "HH:MM – HH:MM · конфликт с событием в Google Calendar".

bookSlot atomic overlap (D.5, plan §4.2): the booking UPDATE re-asserts NOT EXISTS overlap against `teacher_external_busy_intervals` filtered by `sync_state='active'` AND `last_pulled_at >= now() - 10 min` AND `is_own_event = false`. Failure surfaces as `external_conflict` on the `BookSlotResult.reason` union.

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
