# Phase 1B — Auth API routes

Status: **draft, awaiting `/plan-eng-review` before implementation starts.**

This builds on the Phase 1A library (`lib/auth/`, `lib/email/`,
migrations 0005..0010). Ships server-only API routes; UI lands in
Phase 2. Guest checkout on the landing page is untouched.

## Goal

Seven HTTP endpoints that consume the Phase 1A library and provide a
working auth backend:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create account, send verify email |
| GET  | `/api/auth/verify` | Click-through from email; verifies + creates session |
| POST | `/api/auth/login` | Exchange creds for session cookie |
| POST | `/api/auth/logout` | Revoke current session |
| POST | `/api/auth/reset-request` | Send password-reset email |
| POST | `/api/auth/reset-confirm` | Consume reset token, set new password, sign out everywhere |
| GET  | `/api/auth/me` | Return current session's account |

## Non-goals

- UI pages (`/register`, `/login`, etc.) — Phase 2.
- 2FA / OAuth providers — post-MVP.
- Admin role assignment UI — Phase 3.
- Rate limiter on shared-store backend — already in P0
  `ENGINEERING_BACKLOG.md`.
- HIBP / breached-password check — already in Phase 1A backlog.

## Per-route contract

### `POST /api/auth/register`

**Body:** `{ email, password, personalDataConsentAccepted }`.

**Validation:**
- `validateCustomerEmail` (reuse from `lib/payments/catalog.ts`).
- `validatePasswordPolicy`.
- `personalDataConsentAccepted === true`.

**Rate limit:** 5/min/IP + 3/hour/email-hash (see Rate limiting below).

**Origin check:** required.

**Anti-enumeration:** identical response for new and already-registered
email. If email is new → `createAccount` + `createEmailVerification` +
`sendVerifyEmail`. If email exists → send a different transactional
email ("you tried to register again; if this was you, sign in or reset
password") and otherwise no-op. Both paths return:

```json
{ "ok": true }
```

**Errors:**
- 400 invalid email / weak password / missing consent.
- 429 over rate limit.
- 503 if `RESEND_API_KEY` empty under `NODE_ENV=production` — but
  `lib/email/config.ts` should fail boot before we reach this branch.

**Side effects:**
- Persist `metadata.personalDataConsent` snapshot on the account
  (mirror what `payment_orders` does today). Add a `consents` audit
  table later; for now embed in `accounts.metadata jsonb` (additive
  migration 0011, not blocking).

**Idempotency:** not wrapped in `withIdempotency`. UNIQUE on `email`
catches dups; replay returns identical response.

### `GET /api/auth/verify?token=...`

**Rate limit:** 20/min/IP.

**Origin check:** NOT enforced — this URL is clicked from an external
email client, sec-fetch-site=cross-site is expected.

**Flow:**
1. `consumeEmailVerification(token)`.
2. On success: `markAccountVerified(accountId)`, `createSession`, set
   `lc_session` cookie, 303 redirect to `/cabinet`.
3. On failure (unknown / expired / consumed token): 303 redirect to
   `/verify-failed` (placeholder page renders generic "ссылка
   недействительна или уже использована").

### `POST /api/auth/login`

**Body:** `{ email, password }`.

**Rate limit:** 10/min/IP + 5/min/email-hash.

**Origin check:** required.

**Constant-time:** if account doesn't exist OR is disabled, run
`verifyPassword(password, dummyHash)` to keep response timing identical
to the case where account exists with wrong password. `dummyHash` is a
single bcrypt of a constant string, computed once at module load.

**Flow:**
1. Lookup account by email.
2. Verify password (constant-time path above).
3. If verified and not disabled: `createSession`, set cookie, return
   `{ account: { id, email, email_verified_at, roles, disabled_at } }`.
4. Otherwise: 401 with identical body `{ error: 'invalid email or password' }`.

**Open question — unverified email:** allow login but flag
`email_verified_at: null` so UI can prompt for verification, OR block
login entirely until verified? Default: **allow login**, gate only
payment-initiating actions on `email_verified_at`. This matches the
spec ("оплата заблокирована до verification").

### `POST /api/auth/logout`

**Rate limit:** 60/min/IP.

**Origin check:** required.

**Flow:**
1. Read `lc_session` cookie.
2. Look up session (no-op if absent or expired).
3. `revokeSession(sessionId)`.
4. `Set-Cookie` with `Max-Age=0`.
5. Return `{ ok: true }`.

Replay-safe: revoking already-revoked session is a no-op.

### `POST /api/auth/reset-request`

**Body:** `{ email }`.

**Rate limit:** 5/min/IP + 3/hour/email-hash.

**Origin check:** required.

**Anti-enumeration:** identical response for known and unknown email.

**Flow:**
1. Lookup account.
2. If exists: `createPasswordReset(accountId)` → `sendResetEmail`.
3. If not: no-op.
4. Return `{ ok: true }` either way.

### `POST /api/auth/reset-confirm`

**Body:** `{ token, password }`.

**Rate limit:** 10/min/IP.

**Origin check:** required.

**Flow:**
1. `validatePasswordPolicy`.
2. `consumePasswordReset(token)` → `accountId` or null.
3. If null: 400 `{ error: 'invalid or expired token' }`.
4. `setAccountPassword(accountId, hashPassword(password))`.
5. **`revokeAllSessionsForAccount(accountId)`** (sign-out everywhere).
6. `createSession` for the actor that just reset, set cookie.
7. Return `{ ok: true }`.

### `GET /api/auth/me`

**Rate limit:** 60/min/IP.

**Origin check:** NOT enforced — this is a same-origin read called by
client JS to bootstrap the cabinet.

**Flow:**
1. Read cookie. If absent: 401.
2. `lookupSession(cookieValue)`. If null: 401 + clear cookie.
3. Return `{ account, session }` (only public fields).

## Production assertions (gate that lands with the routes)

`lib/email/config.ts` extends with module-load assertion mirroring
`lib/payments/config.ts`:

```ts
if (isProd && !apiKey) {
  throw new Error(
    'RESEND_API_KEY is required when NODE_ENV=production.',
  )
}
```

This closes the silent-`console.log` gap noted in `SECURITY.md` Phase
1A section.

## Rate limiting (per-email scope)

`lib/security/rate-limit.ts` already supports arbitrary scope strings;
extend the call sites to include an email-hash scope:

```ts
enforceRateLimit(req, 'auth:login:email:' + sha256(email), 5, 60_000)
```

Hash with `TELEMETRY_HASH_SECRET` to avoid storing raw emails in
in-memory limiter keys. Single-instance OK for MVP; multi-instance
needs shared store (already P0 backlog).

## Anti-enumeration tests (must-have)

Integration tests for register, reset-request, login that assert:
- Response body byte-equal across `email_exists=true` and
  `email_exists=false` cases.
- Response status equal.
- Wall-clock time within 50ms variance (constant-time bcrypt path).

## Files

| New | Path |
|---|---|
| ✓ | `app/api/auth/register/route.ts` |
| ✓ | `app/api/auth/verify/route.ts` |
| ✓ | `app/api/auth/login/route.ts` |
| ✓ | `app/api/auth/logout/route.ts` |
| ✓ | `app/api/auth/reset-request/route.ts` |
| ✓ | `app/api/auth/reset-confirm/route.ts` |
| ✓ | `app/api/auth/me/route.ts` |
| ✓ | `lib/auth/dummy-hash.ts` (single-load constant-time helper) |
| ✓ | `lib/auth/email-hash.ts` (TELEMETRY_HASH_SECRET-keyed sha256 for rate-limit scopes) |
| ✓ | `tests/auth/routes/*.test.ts` (one per route + cross-route enumeration) |
| edit | `lib/email/config.ts` — production assertion |
| edit | `migrations/0011_*.sql` — `accounts.metadata jsonb null` for consent snapshot (additive) |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Per-email rate limiter relies on `TELEMETRY_HASH_SECRET` not leaking | low | Already in `.env`, not in repo. Same trust boundary as payment telemetry. |
| Constant-time login bypassed by bcrypt cost varying with hash | low | bcryptjs is constant-cost per cost level; we always run `verifyPassword`. |
| Verify link clicked from device B while registered on device A | low | UX edge case; session sets on device B, A stays logged out. Acceptable. |
| Two simultaneous reset-confirm calls with same token | low | `consumeSingleUseToken` is row-locked; second call returns null cleanly. |
| `RESEND_API_KEY` rotation while session is open | low | Resend client cached globally; restart picks up new key. |

## Acceptance

- 7 routes return 2xx on happy path, documented status codes on errors.
- Anti-enumeration tests pass (byte-equal + timing within 50ms).
- Constant-time login test passes (no timing leak between unknown
  email and wrong password).
- Coverage gate stays at 70% for newly testable pure helpers
  (`dummy-hash`, `email-hash`).
- Integration tests run against ephemeral Postgres (or `pg-memory` if
  acceptable); CI runs them on each PR.
- `npm run build` green.
- Docs swept: `ARCHITECTURE.md`, `SECURITY.md` (anti-enumeration
  inventory), `OPERATIONS.md` (env var if added), `AGENTS.md` if any
  new critical path.

## Out of scope (deferred)

- UI for `/cabinet`, `/register`, `/login`, `/forgot`, `/reset`,
  `/verify-failed` — Phase 2.
- Email-template versioning beyond constants — when content team
  needs it.
- Admin-only routes (`/api/admin/*`) — Phase 3.

## Pre-implementation gate

Run `/plan-eng-review` against this file before writing code. Specific
asks for the review:

1. Constant-time login — is the `dummyHash` pattern sufficient, or do
   we need explicit timing harness in production?
2. Reset-confirm sign-out-everywhere — does revoke-all happen before
   or after creating the new session for the actor?
3. Per-email rate limit using `TELEMETRY_HASH_SECRET` — appropriate
   reuse, or do we want a dedicated `AUTH_RATE_LIMIT_SECRET`?
4. `accounts.metadata jsonb` for consent snapshot — or new
   `account_consents` table? Mirrors `payment_orders.metadata.personalDataConsent`
   as a precedent for the simpler shape.
5. Verify route's lack of origin check — confirm cross-site click from
   email is intended trust path.
6. Allow login on unverified email vs block until verify — confirm
   product preference.
