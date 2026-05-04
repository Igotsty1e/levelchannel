# Security

## Current state

The project has gone through a baseline hardening pass for a public site
with a payment API.

Already in place:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Resource-Policy`
- DNS prefetch disabled
- origin checks for browser-initiated payment requests
- `sec-fetch-site` filtering
- shared-store rate limiting per IP (Postgres-backed `rate_limit_buckets`; in-memory fallback when `DATABASE_URL` is unset or transiently unreachable)
- `invoiceId` validation
- `Cache-Control: no-store` for payment responses
- HMAC verification for CloudPayments webhooks via `X-Content-HMAC` and `Content-HMAC`
  (HMAC-SHA256 in base64 over the raw body, no re-encoding)
- amount validation on the server, no trust in the amount or e-mail from the client
- a separate server-side proof of personal-data consent acceptance
  (timestamp, document version, document path, IP, user agent)
- mock confirm restricted in production (closed by default, opened by an explicit `PAYMENTS_ALLOW_MOCK_CONFIRM=true`)
- transactional `SELECT ... FOR UPDATE` on order mutations in Postgres - TOCTOU protection against concurrent webhooks
- one-click charge (`/api/payments/charge-token`) proxies the CloudPayments
  Token API through server-side Basic Auth; tokens never reach the browser
- the payment storage file is excluded from the repository
- telemetry is hashed with a dedicated `TELEMETRY_HASH_SECRET`, and when the secret is empty the app omits `emailHash` instead of using a hardcoded fallback
- `npm audit --omit=dev` is clean on the current lockfile

## Auth and account layer

The auth backend is wired in: tables, `lib/auth/*`, `lib/email/*`,
`/api/auth/*` and a minimal auth/cabinet UI live in the runtime. The
full product surface of the cabinet is not built out yet, but the
security invariants below are already mandatory for the routes that
do work.

- passwords: `bcryptjs`, cost=12. No pepper in the current iteration;
  if we add one later, it goes through a separate rehash migration.
- session cookie: `lc_session`, `HttpOnly` + `SameSite=Lax` + `Secure`
  in production. The DB stores only sha256 of the cookie value, never
  plain. The `account_sessions` row carries `expires_at` (7 days) plus
  `revoked_at` for sign-out.
- single-use tokens (verify-email, password-reset) are stored as sha256;
  `consumed_at` is set atomically in the same transaction as the TTL
  check, so a replay returns the same "invalid or already used".
- email enumeration: both register and reset-request must reply with
  the same "we sent a link if the e-mail exists". The route handlers
  already do this; the lib/-modules themselves do not prevent
  enumeration on their own.
- password reset must revoke all active sessions of the account
  (sign-out everywhere). This is done via
  `revokeAllSessionsForAccount` in the reset-confirm handler.
- transport (Resend) gives a console fallback in dev. **The prod gate is
  in place (Phase 1B Lane A):** `lib/email/config.ts` throws on module
  load if `RESEND_API_KEY` or `AUTH_RATE_LIMIT_SECRET` is empty under
  `NODE_ENV=production`.
- per-email rate-limit scopes (`lib/auth/email-hash.ts`) keyed by a
  dedicated `AUTH_RATE_LIMIT_SECRET`. **Do not reuse**
  `TELEMETRY_HASH_SECRET`: different trust boundaries - the telemetry
  secret keys persistent analytics, the rate-limit secret keys
  shared-store buckets in `rate_limit_buckets` (and an in-memory
  fallback). Mixing them couples rotation cadences artificially.
- e-mail normalization: `lib/auth/accounts.ts.normalizeAccountEmail` =
  `email.trim().toLowerCase()` on every read/write path. A DB-level
  CHECK in `migrations/0010_accounts_email_normalized.sql` catches
  bypasses of the app layer (data migrations, manual psql), rejecting
  a non-normalized insert before it can create a shadow account. The
  UNIQUE index on `accounts.email` stays as a regular index - on
  normalized data it is equivalent to a functional one without the
  overhead.
- HTML escape for transactional templates: `lib/email/escape.ts` is
  applied to every dynamic value (verify / reset URL), even when the
  value is provably safe today. Defends against a future change to
  the token format that introduces `"` or `<`.
- single-use-tokens whitelist invariant: `tableFor(scope)` throws a
  typed error if the scope is invalid; SQL is never built on top of
  an `undefined` table name.

## Protected assets

- order statuses
- payment amounts
- CloudPayments credentials
- webhook endpoints
- server logs and technical order data
- `payment_audit_events` (audit-log-of-record for payments - contains the full e-mail and full IP, see below)

## Audit log - payment lifecycle

`payment_audit_events` is an append-only audit-log-of-record for every
money-bound transition (order creation, cancellation, paid via
webhook, fail via webhook, charge_token / 3DS branches, mock confirm).
Source of truth for incident investigations and 152-FZ subject access
requests.

Unlike `payment_telemetry` (privacy-friendly funnel - HMAC e-mail plus
/24-masked IP), the audit log stores **full** data: the real e-mail
and the real client IP. This is necessary to reconstruct "what exactly
happened with this specific order of this specific user".

**Access.** Read-only psql connection under the admin DB account. No
UI yet (Phase 6). No public route reaches this table. The rows are
**immutable** - no UPDATE/DELETE from application code, only INSERT
via `recordPaymentAuditEvent()`. ON DELETE NO ACTION on the FK to
`payment_orders` guarantees that audit survives any future cleanup
of orders.

**152-FZ basis.** Processing a full e-mail and IP in the audit log is
justified as **legitimate interest** (art.6 §7 of 152-FZ): audit
obligation on payment operations, fraud protection, complying with
CloudPayments / acquirer / FNS requirements.

**Retention.** ~3 years (aligned with 152-FZ for financial records).
No TTL on the schema level - pruning will be a cron, set up
separately when the table grows large enough to matter.

**Failure mode.** The recorder is best-effort: a PG outage logs a
warning to journalctl and returns false, but the business path does
not fall over. That means **a separate Postgres outage can produce a
gap in the audit log**. Defense: the uptime monitor
(`OPERATIONS.md §9`) catches the outage independently. The audit
INSERT itself is **not** transaction-bound to the business INSERT,
intentionally.

## Implemented controls

### 1. Frontend / Browser

- a strict CSP to reduce XSS and injection surface
- the user-facing payment form is limited to `amount + email`
- payment creation and one-click charge are forbidden without an explicit consent checkbox on personal-data processing
- no `dangerouslySetInnerHTML`
- sensitive order state is stored only as `invoiceId` in `localStorage`

### 2. API

- `POST /api/payments` accepts only `amountRub`, `customerEmail` and a confirmed-consent flag
- invalid invoice ids are rejected before any storage call
- rate limiting on create / status / mock confirm routes
- nginx holds per-IP `limit_req` on `/api/*`; CloudPayments webhooks are excluded from it and protected by HMAC plus order cross-checks
- browser-origin filtering for mutation endpoints
- sensitive responses are not cached

### 3. Payments

- the CloudPayments webhook signature is checked via HMAC
- the webhook amount is reconciled against the stored order amount
- the webhook `AccountId` / `Email` is reconciled against the stored order e-mail
- duplicate events are kept as an audit trail
- a `fail` after `paid` does not overwrite the successful status
- the chek is delivered to e-mail through CloudPayments / CloudKassir; the site does not send it itself

### 4. Secrets

- `.env` is excluded from the repository
- the payment storage file is excluded from the repository
- CloudPayments credentials are used only on the server
- `scripts/public-surface-check.sh` blocks private runbooks, `.env*`,
  and known concrete production paths from both local commits and CI

## Current limits and accepted gaps

- payment telemetry: Postgres is the primary path, file fallback is for the case
  of a DB outage (see `lib/telemetry/store.ts`). If `TELEMETRY_HASH_SECRET`
  is empty, telemetry still records the event but drops `emailHash`.
- there is no centralized audit log storage
- there is no Sentry / alerting / intrusion visibility

## Ownership boundary

Infra hardening, SSH, nginx, backup, deploy, rollback and the actual
production state live in `OPERATIONS.md`. This document describes the
current security boundaries, mandatory invariants and open security
gaps, not the historical timeline of server work.

## Change rule

Any future changes to the payment flow must be accompanied by:

- an update to `README.md`
- an update to `PAYMENTS_SETUP.md`
- a revisit of `SECURITY.md` if trust boundaries or secrets change
- a pass through [`docs/security-regression-checklist.md`](docs/security-regression-checklist.md) before merge
