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
- a secondary IP-keyed rate limit on the CloudPayments webhook endpoints (60/min per kind) sitting AFTER HMAC verify, so unauth flood (HMAC-fail → 401) consumes zero budget while a key-leak flood is bounded
- `invoiceId` validation
- `Cache-Control: no-store` for payment responses
- HMAC verification for CloudPayments webhooks via `X-Content-HMAC` and `Content-HMAC`
  (HMAC-SHA256 in base64 over the raw body, no re-encoding)
- delivery-level dedup on the CloudPayments webhook contour: every accepted webhook is recorded by `(provider, kind, transaction_id)` in `webhook_deliveries`; a retried delivery returns the cached response with a `Webhook-Replay: true` header and is short-circuited before `markOrderPaid`, audit, operator email, or allocation runs again
- amount validation on the server, no trust in the amount or e-mail from the client
- a separate server-side proof of personal-data consent acceptance
  (timestamp, document version, document path, IP, user agent)
- mock confirm restricted in production (closed by default, opened by an explicit `PAYMENTS_ALLOW_MOCK_CONFIRM=true`)
- transactional `SELECT ... FOR UPDATE` on order mutations in Postgres - TOCTOU protection against concurrent webhooks
- one-click charge (`/api/payments/charge-token`) proxies the CloudPayments
  Token API through server-side Basic Auth; tokens never reach the browser
- the payment storage file is excluded from the repository
- telemetry is hashed with a dedicated `TELEMETRY_HASH_SECRET`, and when the secret is empty the app omits `emailHash` instead of using a hardcoded fallback
- TLS-required Postgres connections to remote hosts: `lib/db/pool.ts` auto-detects `localhost` / `127.0.0.1` / `::1` / `*.local` as no-TLS (loopback — single-server deploys are valid) and forces `ssl: { rejectUnauthorized: true }` on every non-local host. Production refuses `DB_SSL=disable` and `DB_SSL_REJECT_UNAUTHORIZED=false` ONLY for non-local hosts — disabling TLS on a remote Postgres in prod is the actual leak; on the loopback path TLS is meaningless. The JS-side `ssl` option overrides any `?sslmode=...` URL hint, so the policy is owned in code, not in the URL
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
- learner-archetype gate on `/api/slots/*`: `requireLearnerArchetype`
  and `requireLearnerArchetypeAndVerified` (`lib/auth/guards.ts`)
  block authenticated `admin` and `teacher` accounts from learner-side
  slot endpoints (`mine`, `available`, `[id]/book`, `[id]/cancel`)
  with `error: 'wrong_role'`. Deny-list rather than allow-list because
  legacy accounts have no role row at all (the cabinet treats "no
  role" as an implicit student); per migration 0023 admin is mutually
  exclusive with student / teacher, so the deny-list is sufficient.
  Anonymous browse on `/api/slots/available` stays open (loose
  contract, no learner data leaks since open slots carry teacher +
  tariff + timing only).

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

**At-rest encryption.** From Wave 2.1 (PR #45 squash `a094337`,
shipped 2026-05-07), `customer_email` and `client_ip` are also
written to bytea columns `customer_email_enc` and `client_ip_enc`
via `pgp_sym_encrypt(plaintext, AUDIT_ENCRYPTION_KEY)` (pgcrypto
extension; migration 0025). Reads prefer the encrypted column with
plaintext fallback so the eventual operator-driven null-out is
invisible to consumers. The migration is three-phase:

1. **Phase A (live now).** Both columns dual-write. Plaintext stays
   for safe rollback during the migration window. Backfill of
   pre-Wave-2.1 rows handled by `scripts/backfill-audit-encryption.mjs`.
2. **Phase B (operator-driven, no schema change).** A single SQL
   `UPDATE ... SET customer_email = NULL, client_ip = NULL WHERE
   customer_email_enc IS NOT NULL OR client_ip_enc IS NOT NULL`
   wipes plaintext from disk. From here on, a DB-dump leak is useless
   without `AUDIT_ENCRYPTION_KEY`. Tracked in `ENGINEERING_BACKLOG.md
   § TOMORROW — 2026-05-08`.
3. **Phase C (future wave).** Drop the now-empty plaintext columns
   for good. Sequenced ≥30 days after Phase B with no rollback need.

`AUDIT_ENCRYPTION_KEY` is mandatory in `NODE_ENV=production` and
must be at least 32 characters. `lib/audit/encryption.ts` enforces
both invariants and throws on first use if the key is missing in
production. A throw is caught by `recordPaymentAuditEvent` (the
recorder is best-effort) which surfaces a `console.warn` and skips
the row — operator sees a loud signal at the very next audit event
and fixes the env. Reads in `listPaymentAuditEventsByInvoice` log a
warning and fall back to plaintext if the key is missing in
production, so admin tooling does not go dark on a misconfiguration.

Key rotation (operator runbook, not yet automated): set the new key
alongside the old (`AUDIT_ENCRYPTION_KEY=new`,
`AUDIT_ENCRYPTION_KEY_OLD=old` — note the latter is a future
extension, not yet in code), run a re-encrypt sweep, drop the old
key. Until rotation is wired in, the active key is the only key.

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
- delivery-level dedup: a retried CloudPayments webhook (same `TransactionId`, same kind) returns the cached response with `Webhook-Replay: true` and is short-circuited before re-running the handler — no double `markOrderPaid`, no duplicate audit row, no duplicate operator email, no duplicate allocation insert. Backed by `webhook_deliveries` (migration 0024) keyed by `(provider, kind, transaction_id)`. Best-effort: a Postgres outage on the dedup lookup or persist falls through to the legacy non-dedup path so a real webhook is never blocked by dedup infra
- secondary IP-keyed rate limit on the webhook endpoints (60/min per kind) sits AFTER HMAC verify; an unauth flood (HMAC-fail → 401) consumes zero budget while a key-leak flood is bounded
- duplicate events are kept as an audit trail
- a `fail` after `paid` does not overwrite the successful status
- the chek is delivered to e-mail through CloudPayments / CloudKassir; the site does not send it itself

### 4. Secrets

- `.env` is excluded from the repository
- the payment storage file is excluded from the repository
- CloudPayments credentials are used only on the server
- `AUDIT_ENCRYPTION_KEY` (Wave 2.1) is mandatory in production; `lib/audit/encryption.ts` throws on first use without it. Minimum length is 32 characters. The key is the only thing that makes a `payment_audit_events` DB-dump useful — treat it as a peer of `CLOUDPAYMENTS_API_SECRET` and `AUTH_RATE_LIMIT_SECRET` for rotation cadence
- `DB_SSL` / `DB_SSL_REJECT_UNAUTHORIZED` (Wave 1.1) opt-outs that disable TLS are honored only on the loopback path or outside production. `DB_SSL=disable` and `DB_SSL_REJECT_UNAUTHORIZED=false` throw on pool init when `NODE_ENV=production` AND the host is non-local (a remote Postgres without TLS in prod is a real leak; on `127.0.0.1` it's a no-op). `DATABASE_URL` pointing at `localhost` in production is allowed — single-server deploys (Postgres on the same VPS) are a valid topology
- `scripts/public-surface-check.sh` blocks private runbooks, `.env*`,
  and known concrete production paths from both local commits and CI

## Operator-side invariants (non-app surface)

These are NOT enforced by the application — they are Postgres-level
config that the operator must keep correct. A change in any of them
silently breaks the at-rest encryption story.

- **`pg_stat_statements` MUST NOT be loaded** in `shared_preload_libraries`,
  or — if loaded for performance triage — must run with `track = top`
  (NOT `all`) and `save = off`. The audit recorder passes the
  encryption key as parameter bind values (`$14` on insert, `$2` on
  read). With `track = all + save = on`, the key would land in
  `pg_stat_statements` as a captured bind value visible to any DBA
  with `pg_read_all_stats`. Verified disabled on prod 2026-05-07.

- **`log_statement` MUST be `none`** (or `ddl` / `mod` — anything that
  excludes SELECT/INSERT). Same threat: the encryption key bind value
  ends up in `pg_log` if statements are logged. Verified `none` on
  prod 2026-05-07.

- **`log_min_duration_statement` SHOULD be `-1`** or ≥ 1000ms with
  `log_parameter_max_length = 0`. A wide slow-log captures bind values
  for any query above the threshold. Verified `-1` on prod 2026-05-07.

- **`log_parameter_max_length_on_error` MUST be `0`** or unset. On a
  query error, full parameter values are dumped into the error log
  unless this is clamped. Verified `0` on prod 2026-05-07.

If any of these flips on, the encryption-at-rest layer is downgraded
to "encrypted on disk, key-also-on-disk-elsewhere." Treat the change
as a SECURITY incident, rotate the key, re-encrypt the audit table.

## Current limits and accepted gaps

- payment telemetry: Postgres is the primary path, file fallback is for the case
  of a DB outage (see `lib/telemetry/store.ts`). If `TELEMETRY_HASH_SECRET`
  is empty, telemetry still records the event but drops `emailHash`.
- audit-log encryption is **mid-migration** until Phase B lands (see § Audit log → At-rest encryption). Until then a DB dump still leaks plaintext — the bytea ciphertext just lives alongside it.
- audit-log key rotation is operator-only and not automated. There is no `AUDIT_ENCRYPTION_KEY_OLD` fallback path in code yet; rotating means a one-shot re-encrypt sweep with both keys held momentarily. If the key is lost, every encrypted row is unrecoverable — back up the env-var alongside `CLOUDPAYMENTS_API_SECRET`.

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
