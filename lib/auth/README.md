# lib/auth — accounts, sessions, security gates

> **Trust boundary:** authoritative security gates. `sessions.ts`, `guards.ts`, `learner-archetype.ts` are on the **critical-path inventory** (`docs/critical-path.md`). PRs touching them MUST carry `Codex-Paranoia: SIGN-OFF`.

## Purpose

Owns:
- **Sessions** — `lc_session` cookie, sha256-hashed in DB. `lookupSession` is the predicate every authenticated route relies on. 7-day TTL, revoke-on-logout, revoke-all-on-password-reset.
- **Guards** — `requireAdminRole` + `requireLearnerArchetypeAndVerified`. Used by every `/api/admin/*` route (admin) and every `/api/slots/*` write (learner-archetype + verified-email).
- **Learner-archetype predicate** — `LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL` is the canonical SQL the request-time guard mirrors. AUDIT-SEC-3 (2026-05-17) aligned `requireLearnerArchetypeAndVerified` with this predicate (previously checked role-only, missing `scheduled_purge_at` / `purged_at` exclusion).
- **Single-use tokens** — verify-email, password-reset. sha256-stored, `consumed_at` set atomically with TTL check.
- **Email-hashing** — keyed by `AUTH_RATE_LIMIT_SECRET` (NOT `TELEMETRY_HASH_SECRET`).
- **Password policy** — bcrypt cost 12, no pepper, common-passwords list rejection.

## Files

| File | Role |
|---|---|
| `sessions.ts` | `lookupSession`, `createSession`, `revokeSession`, `revokeAllSessionsForAccount` |
| `guards.ts` | `requireAdminRole(request)`, `requireLearnerArchetype(request)`, `requireLearnerArchetypeAndVerified(request)` |
| `learner-archetype.ts` | `LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL` predicate; `isLearnerArchetypeCandidate(accountId)` |
| `accounts.ts` | `createAccount`, `getAccountByEmail`, `disableAccount`, `setAssignedTeacher`, `normalizeAccountEmail` |
| `password.ts` | `hashPassword`, `constantTimeVerifyPassword` |
| `tokens.ts` | single-use token mint + consume (sha256 storage) |
| `single-use-tokens.ts` | scope dispatch (`verify-email` / `password-reset`) |
| `verifications.ts` | email verification path |
| `resets.ts` | password reset path |
| `consents.ts` | personal-data-consent recording |
| `profiles.ts` | `account_profiles` CRUD |
| `policy.ts` | password policy (length, common-passwords, common-formats) |
| `email-hash.ts` | HMAC email-hash via `AUTH_RATE_LIMIT_SECRET` |
| `dummy-hash.ts` | constant-time bcrypt-shaped dummy for anti-enumeration |
| `common-passwords.ts` | bundled-list rejection |
| `timezones.ts` | IANA TZ whitelist |
| `pool.ts` | `getAuthPool()` (delegates to `getDbPool()`; legacy boundary) |
| `client.ts` | client-side session helpers (Next.js components) |
| `teacher-invites.ts` | SAAS-3+4 (2026-05-18). HMAC sign/verify primitives + DB-bound `createInviteForTeacher` / `listInvitesForTeacher` / `revokeInvite` / `redeemInviteAndBindLearnerAtomic` (single-statement CTE with EXISTS role-check). `TEACHER_INVITE_SECRET` per-call env read. Migration 0057 owns the schema. |

## Invariants

1. **`lc_session` cookie is `HttpOnly + SameSite=Lax + Secure` in production.** DB stores sha256 of cookie value, never plaintext.
2. **Anti-enumeration.** register, login, reset-request all return identical `{ok:true}` for known / unknown / disabled email. The lib functions DO leak (`getAccountByEmail` returns null vs row) — anti-enumeration lives at the ROUTE handler.
3. **Password reset revokes all sessions BEFORE creating a new one** (`reset-confirm/route.ts`). `revokeAllSessionsForAccount` is the seam.
4. **Single-use tokens enforce one-shot atomically.** `consumed_at` set in the same UPDATE that checks TTL.
5. **`AUTH_RATE_LIMIT_SECRET` ≠ `TELEMETRY_HASH_SECRET`.** Different trust boundaries, separate rotation cadences.
6. **Email is normalized at every read/write boundary** (`normalizeAccountEmail`). DB CHECK constraint at migration 0010 catches bypasses.
7. **Learner-archetype guard mirrors the canonical SQL.** Adding a new exclusion (e.g. new account state) requires updating BOTH `LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL` AND verifying every guard call site picks it up. AUDIT-SEC-3 (2026-05-17) is the closure of a prior gap.

## Cross-references

- `ARCHITECTURE.md §Auth and account layer` + `§Auth API routes (Phase 1B Lane B)`.
- `SECURITY.md §Auth and account layer` — invariant list.
- `docs/plans/phase-1b-auth-routes.md` — Lane A/B/C design.
- `docs/critical-path.md §Security gates` — the 3 files in this module that are load-bearing.

## Test surface

- `tests/auth/*.test.ts` — unit on `password.ts`, `tokens.ts`, `policy.ts`, `email-hash.ts`.
- `tests/integration/auth/*.test.ts` — register, login, reset, verify, resend-verify flows against live Postgres.
- `tests/integration/scheduling/*.test.ts` — guards exercised end-to-end via `/api/slots/*`.
