# Phase 1B — Auth API routes

Status: **shipped 2026-04-29. Historical implementation plan, not current source of truth.**

## Decisions from /plan-eng-review

| ID | Decision | Outcome |
|---|---|---|
| D1 | Register timing parity | **Symmetric work**: existing-email path runs `verifyPassword('xxx', dummyHash)` AND sends "you already registered" email through Resend, matching new-email path latency within ±100ms |
| D2 | Consent storage shape | **`account_consents` table** (migration 0011). Normalized audit trail with `(account_id, document_kind, document_version, accepted_at, ip, user_agent)`. NOT jsonb on `accounts`. |
| D3 | Constant-time login | **Module-load `dummyHash`** = `bcrypt.hash('not-a-real-password', 12)` computed once at process start. Login route always calls `verifyPassword(input, accountHash || dummyHash)`. |
| D4 | Login on unverified email | **Allow login**, gate payment/booking on `account.email_verified_at`. Cabinet visible immediately; payment routes return 403 with `{ requireEmailVerification: true }` if `email_verified_at IS NULL`. |
| D5 | Test framework | **Docker Postgres in `docker-compose.test.yml`** (postgres:16.13 — exact prod parity). `scripts/test:integration` brings up the service, runs `migrate:up`, runs `vitest`. CI: GitHub Actions `services:` block. |
| mech-1 | Cache-Control on auth responses | All `/api/auth/*` routes set `Cache-Control: no-store` (mirrors `/api/payments/*` pattern). |
| mech-2 | `/verify-failed` placeholder | Ship a minimal HTML page in Phase 1B (Phase 2 owns the full UI). Phase 1B avoids dead-end redirect target. |
| mech-3 | Rate-limit secret | New env `AUTH_RATE_LIMIT_SECRET` (32+ chars). Do NOT reuse `TELEMETRY_HASH_SECRET` — different trust boundary, different rotation cadence. |
| mech-4 | Verify route origin check | Confirmed: NO `enforceTrustedBrowserOrigin` on `GET /api/auth/verify`. Cross-origin click from email is the intended trust path. Documented inline. |
| mech-5 | Reset-confirm session ordering | Confirmed: `revokeAllSessionsForAccount(id)` BEFORE `createSession({...})` for the actor. New session is on top of a clean slate. |
| mech-6 | Timing-test stability | CI test variance window relaxed to ±100ms (was ±50ms in draft) with `--retry 2`. Prevents CI flake without weakening the property the test asserts. |

Open follow-ups deferred to backlog (NOT blocking implementation):
- **PERF-1**: bcrypt cost=12 serializes Node event loop ~250ms per login. Under flood, capacity bottleneck.
- **PERF-2**: synchronous Resend in register makes response time = email API latency. Acceptable for MVP, fire-and-forget queue post-launch.

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

**Anti-enumeration (D1 — symmetric work):**

Both paths must consume the same wall-clock budget so a timing-side-channel
attacker cannot enumerate emails.

```
new-email path:
  1. validateCustomerEmail + validatePasswordPolicy + check consent
  2. hashPassword(password)         // ~250ms bcrypt
  3. createAccount                   // INSERT
  4. createEmailVerification         // INSERT + token
  5. sendVerifyEmail                 // Resend
  6. write account_consents row
  7. return { ok: true }

existing-email path:
  1. validateCustomerEmail + validatePasswordPolicy + check consent
  2. verifyPassword(password, dummyHash)  // ~250ms bcrypt (dummy)
  3. (no DB INSERT — account already exists)
  4. (no verify-token; the existing account already has one or is verified)
  5. sendAlreadyRegisteredEmail      // Resend (same SDK, same latency)
  6. (no consent row; existing record stands)
  7. return { ok: true }
```

The two paths run the same expensive operations: one bcrypt cycle, one
Resend dispatch, identical response. CI integration test asserts wall-clock
variance ≤100ms across 10 calls.

```json
{ "ok": true }
```

**Errors:**
- 400 invalid email / weak password / missing consent.
- 429 over rate limit.
- 503 if `RESEND_API_KEY` empty under `NODE_ENV=production` — but
  `lib/email/config.ts` should fail boot before we reach this branch.

**Side effects:**
- Insert a row into `account_consents` (migration 0011) with
  `(account_id, document_kind='personal_data', document_version,
  accepted_at, ip, user_agent)`. This is the single audit trail for
  every consent acceptance going forward (offer, future privacy
  versions, marketing opt-in, etc.). NOT stored as `accounts.metadata
  jsonb` per D2.

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

**Constant-time (D3 — module-load dummyHash):**

```ts
// Computed once when login route module loads. ~250ms boot cost,
// amortised across all login requests for the lifetime of the process.
const dummyHash = await bcrypt.hash('not-a-real-password', 12)

// Inside the route handler:
const account = await getAccountByEmail(email)
const hashToCheck = account && !account.disabled_at ? account.password_hash : dummyHash
const valid = await verifyPassword(password, hashToCheck)
if (!valid || !account || account.disabled_at) {
  return 401 with { error: 'invalid email or password' }
}
```

This guarantees identical wall-clock for unknown-email, disabled-account,
and known-account-wrong-password cases. CI test asserts variance ≤100ms.

**Flow:**
1. Lookup account by email.
2. Verify password (constant-time path above).
3. If verified and not disabled: `createSession`, set cookie, return
   `{ account: { id, email, email_verified_at, roles, disabled_at } }`.
4. Otherwise: 401 with identical body `{ error: 'invalid email or password' }`.

**Unverified email (D4 — allow login, gate downstream actions):**

Login succeeds regardless of `email_verified_at`. Cabinet bootstraps,
user can browse teacher profile and slots. Routes that initiate
chargeable side effects (booking, payment) check
`account.email_verified_at` and return 403 + `{ requireEmailVerification:
true }` if NULL. UI surfaces a "подтвердите e-mail для оплаты" prompt.

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
if (isProd && !process.env.AUTH_RATE_LIMIT_SECRET) {
  throw new Error(
    'AUTH_RATE_LIMIT_SECRET is required when NODE_ENV=production.',
  )
}
```

This closes the silent-`console.log` gap noted in `SECURITY.md` Phase
1A section.

## Cache-Control discipline (mech-1)

Every `/api/auth/*` response sets `Cache-Control: no-store`. Same as
`/api/payments/*` today — auth state must never be cached by browser
or intermediary.

## Rate limiting (per-email scope)

`lib/security/rate-limit.ts` already supports arbitrary scope strings.
Extend call sites with an email-hash scope:

```ts
import { hashEmailForRateLimit } from '@/lib/auth/email-hash'

enforceRateLimit(req, 'auth:login:email:' + hashEmailForRateLimit(email), 5, 60_000)
```

`hashEmailForRateLimit` uses a dedicated `AUTH_RATE_LIMIT_SECRET`
(32+ chars), NOT `TELEMETRY_HASH_SECRET`. The two trust boundaries are
different:
- `TELEMETRY_HASH_SECRET` keys persisted analytics (rotation breaks the
  ability to correlate one email across telemetry events — that's
  acceptable analytics drift).
- `AUTH_RATE_LIMIT_SECRET` keys ephemeral in-memory limiter buckets
  (rotation just resets the per-email counter — harmless).

Mixing them couples the rotation cadences artificially.

Single-instance OK for MVP; multi-instance needs shared store
(already P0 backlog).

## Anti-enumeration tests (must-have)

Integration tests for register, reset-request, login that assert:
- Response body byte-equal across `email_exists=true` and
  `email_exists=false` cases.
- Response status equal.
- Wall-clock time within **±100ms** variance across 10 sequential calls,
  with vitest `--retry 2` to absorb CI noise spikes (mech-6).

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
| ✓ | `app/verify-failed/page.tsx` (mech-2; minimal placeholder, "ссылка недействительна или уже использована"; full UI in Phase 2) |
| ✓ | `lib/auth/dummy-hash.ts` (D3; module-load constant-time helper) |
| ✓ | `lib/auth/email-hash.ts` (mech-3; AUTH_RATE_LIMIT_SECRET-keyed sha256) |
| ✓ | `lib/auth/already-registered-email.ts` (D1; sendAlreadyRegisteredEmail template + dispatch) |
| ✓ | `lib/email/templates/already-registered.ts` (D1; new template) |
| ✓ | `lib/auth/consents.ts` (D2; store ops on account_consents) |
| ✓ | `migrations/0011_account_consents.sql` (D2; CREATE TABLE account_consents + indexes) |
| ✓ | `docker-compose.test.yml` (D5; postgres:16.13 service) |
| ✓ | `scripts/test-integration.sh` (D5; bring up → wait → migrate → vitest → tear down) |
| ✓ | `tests/auth/routes/*.test.ts` (one per route + cross-route enumeration test) |
| edit | `lib/email/config.ts` — production assertion for `RESEND_API_KEY` AND `AUTH_RATE_LIMIT_SECRET` |
| edit | `.env.example` — `AUTH_RATE_LIMIT_SECRET=` |
| edit | `package.json` — `test:integration` script |

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

`/plan-eng-review` ran 2026-04-29 (above table records all decisions).
All 6 original asks resolved:

1. dummyHash — module-load (D3). ✓
2. Reset-confirm order — revoke all → create new (mech-5). ✓
3. Rate-limit secret — dedicated `AUTH_RATE_LIMIT_SECRET` (mech-3). ✓
4. Consent storage — `account_consents` table (D2). ✓
5. Verify origin check — none, confirmed (mech-4). ✓
6. Login on unverified — allow + gate downstream (D4). ✓

Plus 5 new findings from the review applied:
- Register timing parity (D1)
- Test framework: Docker Postgres (D5)
- Cache-Control: no-store (mech-1)
- /verify-failed placeholder shipped here (mech-2)
- Timing test variance ±100ms with retries (mech-6)

Implementation can start.

## What already exists (reuse, don't rebuild)

| Existing | Reused for |
|---|---|
| `lib/payments/catalog.ts.validateCustomerEmail` | register / reset-request email validation |
| `lib/security/request.ts.{enforceRateLimit,enforceTrustedBrowserOrigin,getClientIp}` | every mutation route |
| `lib/security/idempotency.ts.withIdempotency` | NOT reused — auth routes are semantically idempotent without it (login replay = new session, register dup = caught by UNIQUE) |
| `lib/payments/config.ts` boot-time assertion pattern | mirrored in `lib/email/config.ts` for `RESEND_API_KEY` + `AUTH_RATE_LIMIT_SECRET` |
| `lib/legal/personal-data.ts.buildPersonalDataConsentSnapshot` | shape input for `account_consents` row (rows store the same fields) |
| Phase 1A `lib/auth/{accounts,sessions,verifications,resets,password,tokens,policy}.ts` | the entire route layer is thin glue on top of these |
| `migrations/0001..0010` runner pattern | same `npm run migrate:up` in test fixture |

## Failure modes (per route)

| Route | Realistic prod failure | Caught by | User sees |
|---|---|---|---|
| register | Resend API 5xx | try/catch around `sendEmail`, log telemetry, still return 200 (don't leak email-exists via error) | "Если письмо не пришло, перезапросите подтверждение через 5 минут" placeholder copy |
| register | DB unique-violation race (two simultaneous registers) | `accounts_email_unique` index → 23505 caught and treated as "already registered" path | identical 200 response (consistent with anti-enumeration) |
| verify | Two simultaneous clicks on same link | `consumeSingleUseToken` row-locked tx (Phase 1A) → second returns null | second click → 303 to /verify-failed (already-consumed) |
| login | Postgres connection pool exhausted under flood | bcrypt timing dominates; new connections queue. p99 grows but no crash | spinner; recoverable |
| login | Unknown email + valid bcrypt hash check (timing edge) | dummyHash module-load + always-verify | identical 401 |
| reset-request | Resend down → reset email never sent | best-effort; user can retry | "Если письмо не пришло…" copy |
| reset-confirm | Token consumed, but `revokeAllSessionsForAccount` fails midway | wrapped in tx with token consume | reset rolled back, user can retry |
| logout | Cookie absent / session unknown | revoke is no-op; clear cookie regardless | success |
| me | Session expired between cookie issue and lookup | lookupSession returns null → 401 + clear cookie | redirect to login |

**Critical gaps (no test + no error handling + silent):** none identified. Every failure has at least one of (test path / error handler / observable response).

## Worktree parallelization

| Lane | Steps | Modules touched |
|---|---|---|
| Lane A (foundation) | (1) migration 0011 + lib/auth/consents.ts; (2) docker-compose.test.yml + scripts/test-integration.sh; (3) lib/auth/{dummy-hash,email-hash}.ts; (4) lib/email/config.ts assertion + already-registered template | migrations/, lib/auth/, lib/email/, scripts/, docker-compose |
| Lane B (auth routes) | depends on A | app/api/auth/* + integration tests (one route at a time, since route handlers share lib/auth/ but don't share files) |
| Lane C (verify-failed page) | independent | app/verify-failed/ |

**Execution order:** Lane A first (foundation). Lane B and Lane C can run in parallel once A merges. Inside Lane B, all 7 routes can be parallel sub-lanes (no shared files).

**Conflict flags:** none.

## NOT in scope

| Deferred | Reason |
|---|---|
| UI pages (`/register`, `/login`, `/forgot`, `/reset`, `/verify`) | Phase 2 |
| Admin role assignment routes (`/api/admin/*`) | Phase 3 |
| 2FA, OAuth providers, SSO | post-MVP |
| Shared-store rate limiter (multi-instance) | already P0 in `ENGINEERING_BACKLOG.md` |
| HIBP / breached-password rejection | already in Phase 1A backlog |
| bcrypt hash version-stamp + needsRehash() check on login | already in Phase 1A backlog (will land here as smallest patch when login route is wired) |
| `account_sessions` cleanup cron | OPERATIONS.md runbook entry, post-merge |
| Fire-and-forget email queue (PERF-2) | post-MVP; sync Resend acceptable at one-teacher scale |
| CAPTCHA on register / reset-request | post-launch if abuse appears in telemetry |

## Completion summary

- Step 0 (Scope Challenge): scope accepted as-is (17 files, but minimum-viable for full auth surface; cannot reduce without breaking flow)
- Architecture review: 4 issues found, all resolved via D1–D4
- Code Quality review: 0 new issues (DRY rate-limit scope already addressed in plan)
- Test review: 1 issue (D5 — test framework), resolved
- Performance review: 2 informational risks flagged (PERF-1, PERF-2), backlog'd
- NOT in scope: written above
- What already exists: written above
- TODOS.md updates: 0 new (PERF-1 / PERF-2 / hash-versioning already in `ENGINEERING_BACKLOG.md`)
- Failure modes: 0 critical gaps
- Outside voice: skipped (codex limits exhausted at user's instruction)
- Parallelization: 3 lanes (A foundation, then B routes ‖ C placeholder page)
- Lake Score: 5/5 — every contested decision picked the complete-coverage option (symmetric work, separate audit table, real Postgres, dedicated secret, full timing harness)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | skipped (limits exhausted) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 5 issues, 0 critical gaps, 4 D-decisions + 6 mech fixes |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | n/a (backend-only PR) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

**UNRESOLVED:** 0
**VERDICT:** ENG CLEARED — ready to implement.
