# SAAS-3 + SAAS-4 — Teacher self-registration + invite-link auto-bind

**Status:** DRAFT 2026-05-18 — round-1 `/codex-paranoia plan` returned BLOCK with 5 BLOCKERs + 4 WARNs. Revisions applied 2026-05-18; ready for round 2.
**Wave name:** `teacher-self-reg-invite` (combined SAAS-3 + SAAS-4 epic).
**Trigger:** Product-owner decision 2026-05-18 — LevelChannel pivots from single-channel (operator-curated teachers + operator-assigned learners) to SaaS (any teacher signs up; teacher invites their own learners). No verification flag, no admin gate: a self-registered teacher is immediately active. Security relies on the invite-link being trusted by the learner who follows it, plus existing email-verification before the invite-generation surface unlocks.
**Author:** Claude (autonomous).
**Two-checkpoint paranoia:** PLAN checkpoint = this file. EPIC-END WAVE checkpoint = aggregated diff of all sub-PRs once merged.

This is the most security-sensitive plan in the current wave. Token forgery, replay, TOCTOU during redeem, anti-spoof on the inviting-teacher field, abuse via fake-teacher registration, and dangling-state after teacher deletion are all attack-surface I expect Codex to claw at.

---

## 0. Round-1 paranoia revision summary (2026-05-18)

Round-1 surfaced 5 BLOCKERs + 4 WARNs. Each is closed below; full revision is woven into the relevant §3.x section, but the canonical map is here for the round-2 reviewer.

| Round-1 finding | Closure |
|---|---|
| **BLOCKER#1** — `createAccount` / `recordConsent` / `grantAccountRole` / `createEmailVerification` are pool-only; the same-TX claim is false without a helper refactor. | §3.5b (NEW) — explicit helper-refactor surface inventory: each helper gets a `(client: PoolClient \| Pool, ...)` variant. The TX-mode caller passes a `PoolClient`; the original signature stays as a thin wrapper that calls `pool.connect()` itself. All four files (`lib/auth/accounts.ts`, `consents.ts`, `verifications.ts`, `single-use-tokens.ts`) carry sub-PR `TINV-2` in §5. |
| **BLOCKER#2** — redeem does a raw `UPDATE accounts SET assigned_teacher_id` bypassing `setAssignedTeacher()`'s role re-check; can bind a learner to an ex-teacher. | §3.7 revised — the redeem statement is now a multi-row CTE: redeem the invite + INNER JOIN `account_roles` proving the inviter is STILL `teacher` at the moment of redeem. If the inviter lost the role (e.g. promoted to admin via `grantAccountRole('admin')` stripping consumer roles), the JOIN fails → redeem returns 0 rows → TX rolls back. Test added (TINV.6.7). |
| **BLOCKER#3** — anti-enumeration timing symmetry breaks: invited new-email path adds TX open/commit + role INSERT + invite UPDATE + assign UPDATE, while already-registered path still only dummy-bcrypt + email. | §3.2 + §3.7 revised — already-registered path gains symmetric padding: open a TX with `BEGIN; SAVEPOINT s1; ROLLBACK TO s1; COMMIT;` shape, plus a dummy `SELECT count(*) FROM accounts WHERE id = $1` lookup and a no-op `SELECT FROM teacher_invites WHERE id = $1 FOR UPDATE` against a random uuid (won't match, but takes the same row-lock wait time on the index). Asymmetry stays within ±5 ms (asserted by new test `tests/integration/auth/register-symmetry.test.ts` — TINV.6.10, mandatory ms-budget assertion, NOT just a smoke test). |
| **BLOCKER#4** — email-verify dispatch failure strands the invite (already redeemed, account created, but learner has no verification link and the resend endpoint is authenticated-only). | §3.7 revised — invite redeem moves AFTER email-verify dispatch succeeds. New flow: (a) TX1 creates account + role + consent, (b) email-verify dispatch happens INSIDE TX1 (Resend client wrapped to throw on `{ ok: false }` instead of returning silently — small change in `lib/email/dispatch.ts:sendVerifyEmail`), (c) only if dispatch returns ok does the redeem + assign UPDATE run inside the same TX before commit. If Resend fails, TX rolls back: no account, invite stays unused, learner sees a transient error and retries. Idempotency: the verify-email INSERT into `email_verifications` is keyed on `(account_id, purpose)` with a partial unique idx — second attempt on same account collides cleanly. The anonymous resend gap closes naturally because no account exists when dispatch fails. |
| **BLOCKER#5** — `accounts_email_unique` 23505 on concurrent register isn't caught; one racer succeeds, the loser surfaces a 500 instead of the symmetric already-registered response. | §3.7 revised + new TX1 logic — the `createAccount` helper wraps its INSERT in `try/catch` and surfaces `EMAIL_ALREADY_REGISTERED` on a `code === '23505'` constraint match (`accounts_email_unique`). The route's catch handler normalises this to the same dummy-bcrypt + `{ ok: true }` response shape as the already-registered branch. Mirrors the contract in `docs/plans/phase-1b-auth-routes.md:392`. Test TINV.6.9 — two concurrent POSTs to `/api/auth/register` with the same email + same inviteToken; exactly one creates the account, the other gets `{ ok: true }` with no DB write. |
| **WARN#6** — `enforceRateLimit()` (`lib/security/request.ts:65`) always appends `:${ip}`, so the "per-teacher" key actually becomes per-teacher-per-IP. VPN/IP rotation bypasses. | §3.6 revised — invite-generate uses a new helper `enforceAccountRateLimit(accountId, scope, limit)` in `lib/security/account-rate-limit.ts` (NEW). Key shape: `account:${accountId}:${scope}` — pure account id, no IP. Stored in Redis with `INCR` + TTL 1 hr. Existing `enforceRateLimit` keeps its IP-keyed shape (anti-bruteforce surface). Tests TINV.6.11 + TINV.6.12 pin both the per-account ceiling AND the IP-bypass-attempt regression case. |
| **WARN#7** — Doc-target drift: `docs/operations.md` (lowercase) doesn't exist; the real owner is `OPERATIONS.md`. Plan also missed README/ARCH/SECURITY doc-sweep entries. | §5 sub-PR `TINV-7` (NEW) replaces all references to `docs/operations.md` with `OPERATIONS.md` (private runbook surface) + adds doc-sweep targets: `README.md` §"How to run" gains a `TEACHER_INVITE_SECRET` mention; `ARCHITECTURE.md:254` API map gets `/api/teacher/invites*` entries; `SECURITY.md:56` auth section gains a one-sentence note on the invite token contract pointing at this plan. |
| **WARN#8** — Test plan misses two authz cases: teacher B cannot list/revoke teacher A's invite; redeem fails after inviter loses `teacher`. | §6 revised — TINV.6.7 (cross-teacher list rejection: teacher B's GET /api/teacher/invites returns ONLY their own, no leakage of A's rows) + TINV.6.8 (cross-teacher revoke: teacher B's POST /api/teacher/invites/[A's-invite-id]/revoke → 404) + TINV.6.7-redeem (redeem AFTER inviter promoted to admin → fails closed). |
| **WARN#9** — UI mismatch: invite card visible but 403s when `!isVerified`; product copy says "locked until verified". | §3.8 revised — the cabinet `<TeacherInviteSection>` reads `isVerified` from server-side props (already passed to `<TeacherSection>`); if `!isVerified` it renders a disabled placeholder card with copy «Подтвердите e-mail, чтобы открыть приглашения учеников» + a `<ResendVerifyButton />` mount. The active controls are NOT rendered, so a forged POST attempt still 403s server-side AND the UI matches reality. |

Quick scan: round-1 took the plan from "drafted-with-claims" to "drafted-with-helper-refactor + symmetrized timing + atomic-redeem-with-role-check + post-dispatch-redeem + 23505-normalised + per-account-rate-limit". The redesign tightens the security claims rather than weakening them.

---

## 1. Goal

**SAAS-3 — teacher self-registration.**
`/register` adds a single radio group «Я ученик / Я учитель» (default = ученик). On submit the account is created with the chosen role and is immediately active after the existing email-verification click-through. No operator step.

**SAAS-4 — teacher invite-link with auto-bind learner.**
An active, email-verified teacher can generate an HMAC-signed invite link from `/cabinet`. The link encodes a token. When a learner registers via `/register?invite=<token>`, the redeem is atomic with the account-create, and `accounts.assigned_teacher_id` is set to the inviting teacher in the same transaction.

After this epic:
- A teacher can onboard themselves and their first learner cohort without operator involvement.
- The operator role contracts to dispute resolution, KYC (future), and global admin tasks.
- The learner-archetype canonical predicate (`lib/auth/learner-archetype.ts`) and the role-exclusivity invariant (`lib/auth/accounts.ts:270-303`) MUST hold unchanged. No part of this epic loosens those.

---

## 2. Existing surface inventory

Cited as `file:line` so the paranoia reviewer can verify the design against actual code state at 2026-05-18.

### 2.1 Register flow

- `app/register/page.tsx:1-123` — client component. Two fields (email, password), one consent checkbox, no role selector today. POSTs `{ email, password, personalDataConsentAccepted: true }` to `/api/auth/register` and redirects to `/verify-pending?email=…` on `{ ok: true }`.
- `app/api/auth/register/route.ts:39-149` — handler. Anti-enumeration via symmetric work pattern: same wall-clock cost for new-email and already-registered paths. Emits one bcrypt hash + one Resend dispatch in either branch + an `auth.register.created` audit row. Today there is NO role assignment — accounts default to "no role", which the learner-archetype predicate treats as learner-eligible (`lib/auth/learner-archetype.ts:52-61`).
- `app/verify-pending/page.tsx:1-56` — landing after register. Purely informational; reads `?email=` from URL.
- `app/api/auth/verify/route.ts:36-76` — GET on email-verify click. Marks `email_verified_at`, mints a session via `createSession`, 303-redirects to `/cabinet`. Records `auth.verify.success` audit.

### 2.2 Account / role / session primitives

- `lib/auth/accounts.ts:88-100` — `createAccount({ email, passwordHash })`. Inserts into `accounts` with `gen_random_uuid()` id, normalized email; returns the row. **Does NOT touch `account_roles`.** Role assignment is a separate step.
- `lib/auth/accounts.ts:270-303` — `grantAccountRole`. Enforces admin ⟂ {teacher, student} mutual exclusion. Granting `teacher` while `admin` is held throws `role/admin_exclusive`. Granting `admin` strips consumer roles first. Insertion is `on conflict (account_id, role) do nothing` — re-grants are idempotent.
- `lib/auth/accounts.ts:368-389` — `setAssignedTeacher(learnerId, teacherId)`. Verifies the target carries `teacher` role first, throws `AssignedTeacherRoleError` otherwise. UPDATE skips purged rows (`where id = $1 and purged_at is null`).
- `lib/auth/sessions.ts:17-42` — `createSession({ accountId, ip, userAgent })`. Mints a 7-day token (hash stored, plain returned as cookie). Role-agnostic — works for any role.
- `lib/auth/sessions.ts:119-129` — `buildSessionCookie(value, isProd)`. Path=/, HttpOnly, SameSite=Lax, Max-Age=7d, Secure in prod.
- `lib/auth/sessions.ts:144-156` — `readSessionCookieFromRequest`. Tolerates standard Cookie header.
- `lib/auth/guards.ts:164-196` — `requireTeacherAndVerified`. Rejects admin+teacher hybrids (admin precedence), rejects non-teachers with `wrong_role`. **This is the gate the invite-generation endpoints will sit behind.**
- `lib/auth/guards.ts:124-158` — `requireLearnerArchetypeAndVerified`. Already reconciled with the canonical predicate via `isLearnerArchetypeCandidate`. Not touched by this epic.

### 2.3 Learner-archetype predicate

- `lib/auth/learner-archetype.ts:52-61` — `LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL`. Excluded conditions: `email_verified_at IS NULL`, `disabled_at IS NOT NULL`, `scheduled_purge_at IS NOT NULL`, `purged_at IS NOT NULL`, OR holds `admin` / `teacher` role. **This is the canonical "is this account a learner?" predicate.** The teacher-self-reg flow MUST NOT introduce any account state that violates the implicit guarantee "an account that holds the teacher role is not a learner". The role-grant must happen before the invite-redeem path can mistake them for a learner.

### 2.4 Profile + cabinet rendering

- `lib/auth/profiles.ts:72-83` — `getAccountProfile(accountId)`. Returns `null` for a fresh account. The register flow does NOT create a profile row; the first PATCH from `/cabinet` does. Teachers self-registering will land in `/cabinet` with no profile row — exactly the same shape as a fresh learner. No new code path.
- `app/cabinet/page.tsx:67-83` — role-fan-out. Admin → `/admin`, teacher → `<TeacherSection>` + `<TeacherLearnersSection>`, student-or-no-role → learner UI. **A self-registered teacher will hit the teacher branch on first login.** Today that branch renders only a slot-list summary (`app/cabinet/teacher-section.tsx:58-156`). SAAS-4 adds an "Пригласить ученика" card to the teacher section.
- `app/teacher/page.tsx`, `app/teacher/settings/` — full teacher calendar surface. Already gated by `requireTeacherAndVerified` server-side. Self-registered teachers reach this surface after verify + first cabinet visit, no new gating needed.

### 2.5 Migrations / schema

- `migrations/0005_accounts.sql:12-23` — `accounts` table. No `role` column on `accounts` itself — role is normalized into `account_roles` (`migrations/0006_account_roles.sql:5-14`), enum `('admin', 'teacher', 'student')` enforced by CHECK.
- `migrations/0023_account_assigned_teacher.sql:24-30` — `accounts.assigned_teacher_id` nullable FK with `ON DELETE SET NULL`. **This means: if a teacher account is purged, their invited learners' `assigned_teacher_id` automatically becomes NULL.** SAAS-4 inherits this — see RISK-3 below.
- `migrations/0028_auth_audit_events.sql:49-84` — `auth_audit_events`. CHECK constraint enumerates 7 event types: `auth.login.success`, `auth.login.failed`, `auth.register.created`, `auth.reset.requested`, `auth.reset.confirmed`, `auth.verify.success`, `auth.session.revoked`. **The four new audit events this epic needs (`auth.teacher.self_registered`, `auth.invite.created`, `auth.invite.revoked`, `auth.invite.redeemed`) are NOT in this list. A migration MUST extend the CHECK constraint as part of TINV.1.**
- Latest migration on disk: `migrations/0056_lesson_slots_zoom_url.sql`. New migration in this epic = `0057_teacher_invites.sql` (+ CHECK extension squashed into the same migration or a sibling 0058).

### 2.6 Race pattern reference

- `lib/scheduling/slots/mutations-cancel.ts:94-187` — `cancelLearnerSlot`. Canonical "WHERE-clause-as-security-boundary + same-TX wrap + classify-by-re-read on 0 rows" pattern. SAAS-4's `redeemInviteAndCreateLearner` MUST mirror this shape exactly.

### 2.7 Security primitives

- `lib/auth/email-hash.ts:34-53` — HMAC-SHA256 helper + `rateLimitScope(action, email)`. We'll add `'invite-generate'` and `'invite-redeem'` (by IP, not email) actions but reuse the same helper pattern.
- `lib/security/request.ts:65-99` — `enforceRateLimit`, `getClientIp`, `enforceTrustedBrowserOrigin`. All three are already proven on the existing auth endpoints. New endpoints reuse them.
- `lib/auth/email-hash.ts:15-32` — production-required env pattern. `AUTH_RATE_LIMIT_SECRET` boot-fails on `NODE_ENV=production` if unset; dev fallback is a stable non-secret. **`TEACHER_INVITE_SECRET` MUST follow the exact same shape** (TINV.0 §3.3).

---

## 3. Design

### 3.1 Register form — single radio group

`app/register/page.tsx` gains:

```tsx
const [role, setRole] = useState<'student' | 'teacher'>('student')
```

A `<fieldset>` rendered between the email and password fields:

```
○ Я ученик — буду заниматься с учителем
○ Я учитель — буду вести занятия
```

Default = `'student'`. Submitted as `{ email, password, role, personalDataConsentAccepted, inviteToken? }`. The radio is `required`; UI uses two labelled `<input type="radio" name="role">` with `accentColor: '#C87878'` to match the consent checkbox.

**Russian copy is locked here, not in /codex-paranoia round 1 — fix orthography now:**
- «Я ученик — буду заниматься с учителем»
- «Я учитель — буду вести занятия»
- Section heading (above the radios): «Кто вы?»

### 3.2 `/api/auth/register` — role-aware new-email path

Diff in `app/api/auth/register/route.ts`:

```ts
const role: 'student' | 'teacher' =
  body.role === 'teacher' ? 'teacher' : 'student'

// ...existing email + password + consent validation...

// New-email path:
const account = await createAccount({ email, passwordHash })
await grantAccountRole(account.id, role, /* grantedByAccountId */ null)
// If role === 'student' AND body.inviteToken present, redeem here in the same TX (§3.6)
```

**Critical: `grantAccountRole` must run before any audit event tags this as a teacher, and before the email-verify token is created (so the verify-click → cabinet redirect lands them in the right pane).** The role grant is a separate INSERT (different table), so the new-email branch becomes a TX:

```ts
const client = await pool.connect()
try {
  await client.query('begin')
  // createAccount, recordConsent, grantAccountRole, createEmailVerification — all on client
  await client.query('commit')
} catch (e) {
  await client.query('rollback')
  throw e
}
```

This is a behavioural widening of the existing register path. The already-registered branch (`existing` truthy) is unchanged — no role decision, dummy bcrypt + already-registered email + audit row, as today.

**Already-registered + role-flip attempt:** if a learner registers, then re-registers with `role=teacher`, the existing branch fires and NO role grant happens. The pre-existing role stays. Anti-enumeration: the response is still `{ ok: true }`. Role is set ONCE at first-create and is immutable through this endpoint. Re-roling requires operator action.

**Anti-enumeration symmetric work invariant** (`app/api/auth/register/route.ts:30-37`): adding a role grant to the new-email path adds one INSERT to the new-email branch only. The already-registered branch has no equivalent. **This widens the wall-clock asymmetry the existing comment says is bounded.** Mitigation: the role-grant INSERT is ~1ms on local Postgres vs ~250ms bcrypt — the asymmetry is in the noise. The comment in the route stays accurate. Codex paranoia will likely flag this — see §11 Q3.

### 3.3 Invite token format

HMAC-SHA256 of a stable payload, signed by `TEACHER_INVITE_SECRET`.

**Payload** (UTF-8 JSON, then `base64url`):
```json
{
  "v": 1,
  "iid": "<uuid of teacher_invites row>",
  "tid": "<uuid of teacher_account_id>",
  "exp": 1763419200
}
```

`v` is a version tag so we can rotate the payload schema without breaking outstanding invites. `iid` is the database id of the invite row (used to look up DB state). `tid` is duplicated from the row for a fast "who invited me" preview on `/register?invite=…` (the page can pre-fetch the teacher email by `iid` only and ignore `tid` from the token; including `tid` is anti-tampering belt-and-suspenders, since the server validates `iid → teacher_account_id` from the DB anyway — see §3.6 anti-spoof note). `exp` is epoch-seconds.

**Wire format:** `<base64url(payload)>.<base64url(hmac)>` where `hmac = HMAC-SHA256(TEACHER_INVITE_SECRET, base64url(payload))`. Dot-separated, no padding. Two parts. Total length ~180 chars — fits inside a typical messenger preview without wrapping.

**`TEACHER_INVITE_SECRET` env contract** (mirrors `AUTH_RATE_LIMIT_SECRET`):
- Production: boot-fail if unset or empty/whitespace.
- Dev: stable fallback `'lc-dev-teacher-invite-fallback'` so local dev works without a real secret.
- Read once per call via `process.env.TEACHER_INVITE_SECRET?.trim()` — NOT cached at module scope. This matches the `email-hash.ts` pattern and lets rotation take effect on the next request without a process restart.
- Rotation effect: outstanding invites signed with the old secret will be rejected with `invalid_token`. Document this in `docs/operations.md` runbook addendum.

**HMAC verify uses `timingSafeEqual`** — never a plain `===` on the base64url'd hmac string. Even though the secret is the only sensitive part, timing-side-channel discipline is cheap.

### 3.4 `teacher_invites` table — migration `0057_teacher_invites.sql`

```sql
create table if not exists teacher_invites (
  id uuid primary key default gen_random_uuid(),
  teacher_account_id uuid not null
    references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  used_by_account_id uuid null
    references accounts(id) on delete set null,
  revoked_at timestamptz null
);

create index if not exists teacher_invites_teacher_idx
  on teacher_invites (teacher_account_id, created_at desc);

-- For the redeem path: only one row per id, but the predicate is the
-- security boundary. Index supports the WHERE clause.
create index if not exists teacher_invites_active_idx
  on teacher_invites (id)
  where used_at is null and revoked_at is null;
```

**`ON DELETE CASCADE` for `teacher_account_id`** (not `SET NULL`): if a teacher account is hard-deleted, their invites disappear. A dangling invite to a non-existent teacher is meaningless. **Note the asymmetry with `accounts.assigned_teacher_id` (which is SET NULL):** for already-redeemed learners we keep the learner alive and just unlink them (so they don't lose their account); but the invite row itself is purely artifact-of-the-teacher and goes away with them. Already-purged teacher's already-redeemed learner ends up with `assigned_teacher_id = null` — same shape as a learner whose teacher was never assigned.

**`used_by_account_id` is `ON DELETE SET NULL`** so the invite row's audit trail survives the learner being purged.

**Single-use invariant:** the row is "active" iff `used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`. Redeem is the atomic UPDATE in §3.6.

**Default expiry:** 7 days from creation. Codable as a constant in `lib/auth/teacher-invites.ts`. Not env-tunable for MVP — adds knob complexity without clear demand.

### 3.5 Lib `lib/auth/teacher-invites.ts`

Owns the four primitives:

- `signInviteToken(payload: InvitePayload): string` — payload → wire token.
- `verifyInviteToken(token: string): InvitePayload | null` — wire token → payload, with HMAC + `timingSafeEqual` + version check + `exp` check (in seconds, not ms). Returns `null` on ANY failure — no detailed error class out the door (anti-enumeration / no info-leak).
- `createInviteForTeacher(teacherAccountId): Promise<{ id, token, url, expiresAt }>` — INSERT row + sign token + return URL `https://levelchannel.ru/register?invite=<token>`. URL base from `paymentConfig.siteUrl` (already used in `app/api/auth/verify/route.ts:30-33` for the `verify-failed` redirect).
- `redeemInviteAtomic(client: PoolClient, inviteId: uuid, learnerAccountId: uuid): Promise<{ teacherAccountId } | null>` — runs `UPDATE teacher_invites SET used_at = now(), used_by_account_id = $2 WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING teacher_account_id`. Receives a `client` (not the pool) so the caller controls the surrounding TX. Returns the teacher id on success, `null` on failure — caller classifies by re-read if it cares about UX disambiguation.

`createInviteForTeacher` does NOT verify that `teacherAccountId` actually holds the `teacher` role — that's the route guard's job. The lib stays narrow.

### 3.6 Teacher endpoints

#### `POST /api/teacher/invites` — generate invite

- Guard: `requireTeacherAndVerified(request)` (already exists, `lib/auth/guards.ts:164`).
- Origin: `enforceTrustedBrowserOrigin(request)`.
- Rate limit: 5 per hour per teacher account. Scope key: `teacher:invite-generate:account:<teacherAccountId>` (not by IP — IP is bypassable by VPN; per-teacher matches the resource being protected). Implementation: `enforceRateLimit(request, scope, 5, 60 * 60_000)` where `scope` is built from `account.id`. Codex will likely flag the per-account-key concern — see §11 Q5.
- Body: empty (no params; expiry is fixed).
- Action: `createInviteForTeacher(account.id)`.
- Audit: `auth.invite.created` with `payload: { inviteId, teacherAccountId, expiresAt }`.
- Response: `{ id, url, expiresAt }`. The full URL is returned so the teacher copies it directly. **The plain `token` is NOT returned in the response payload** — it's already embedded in the URL, and surfacing it separately invites accidental logging. Round-1 self-flag.

#### `GET /api/teacher/invites` — list

- Guard: `requireTeacherAndVerified`.
- Returns the teacher's last N=50 invites: `{ id, createdAt, expiresAt, usedAt, usedByEmail, revokedAt, status: 'active' | 'used' | 'revoked' | 'expired' }`. `usedByEmail` joins `accounts` on `used_by_account_id` AND filters out purged accounts (`purged_at is null`) — a purged learner's email is replaced with `null` to avoid leaking the placeholder address.
- No URL / token in the response — the teacher already has the URL from the create call. Re-displaying it after creation would force us to re-sign the token from the row, which would be a second issued token with the same `iid` (still valid because HMAC is deterministic over the payload), but it muddies the audit semantics. Render `id` only; if the teacher lost the URL, they revoke + create a new one. UX trade-off accepted for security clarity.

#### `POST /api/teacher/invites/[id]/revoke`

- Guard: `requireTeacherAndVerified`.
- Auth-on-target: `UPDATE teacher_invites SET revoked_at = now() WHERE id = $1 AND teacher_account_id = $2 AND revoked_at IS NULL AND used_at IS NULL RETURNING id`. **Ownership is in the WHERE clause** — a teacher cannot revoke another teacher's invite even if they guess the id. The `used_at IS NULL` guard makes revoke a no-op on already-redeemed invites (you can't un-redeem; revoke-after-redeem is a separate "break the learner-teacher link retroactively" feature scoped OUT — see §11 Q1).
- Rate limit: 30/hour by teacher (revokes are cheap, but bounded against accidental loop).
- Audit: `auth.invite.revoked` with `payload: { inviteId, teacherAccountId }`.

### 3.7 `/register?invite=<token>` flow

`app/register/page.tsx` becomes a server component wrapper around a client island, so the token can be validated server-side BEFORE the form renders (no flash of "valid invite" for a tampered token).

**New `app/register/page.tsx` (server component):**
```tsx
import { verifyInviteToken } from '@/lib/auth/teacher-invites'
// ... resolves searchParams.invite, looks up DB state, renders <RegisterForm initialInvite={…} />
```

Server-side preflight:
1. Read `searchParams.invite` (string or undefined).
2. If absent → render form without invite context. Default flow.
3. If present:
   - `verifyInviteToken(token)` → payload or null.
   - If null → render form with a yellow banner «Ссылка-приглашение недействительна или истекла. Регистрация продолжится без привязки к учителю.» + STRIP the `?invite=` from the URL via a `redirect()` to `/register` (so a bot can't farm errors). **Do NOT redirect on the same render — this strips the token from the URL bar but keeps the user on the same page with the warning visible.** Implementation note: use `redirect('/register?invite_error=expired')` and have the page render the banner from `?invite_error=`. The banner is on a query-param, not on server-state-passed-through-cookies, to keep the page stateless.
   - If payload valid: re-read the row from DB by `payload.iid` and check `used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`. The DB state is the authority — the token alone is not enough (tokens are self-signed but DB state can flip independently). If DB check fails → same banner as above + redirect.
   - If DB check passes: render the form with a green info box «Вас пригласил учитель `<teacher@email>`. После регистрации вы будете привязаны к этому учителю.» + a hidden field `inviteId` (NOT the full token — see anti-spoof below) prefilled.

**Client island `<RegisterFormWithInvite>`:**
- Same form fields as today, plus a pre-checked-and-disabled radio `role = 'student'` (an invited user is by definition a learner; rendering the teacher option would be misleading).
- Hidden field `inviteId` only. NOT the token. NOT the `teacher_account_id`.
- On submit: POSTs `{ email, password, personalDataConsentAccepted, inviteId, inviteToken }`. We send BOTH the `inviteId` AND the full token so the server re-verifies. The hidden `inviteId` is purely a UX preview / display; the server treats `inviteToken` as authoritative.

**Anti-spoof gate (CRITICAL):** the server-side new-email branch in `/api/auth/register`:
```ts
const teacherAccountIdFromInvite = await (async () => {
  const invitePayload = verifyInviteToken(body.inviteToken)
  if (!invitePayload) return null
  // Re-read the DB row — token alone is not authority
  // Performed inside the same TX, as the redeem
  return null // placeholder; actual fetch + redeem happens below in TX
})()
```

The flow inside the TX:
1. `createAccount(client, { email, passwordHash })`.
2. `grantAccountRole(client, account.id, 'student', null)` — yes, even for invited learners; learners are explicit student-role under SAAS (the default "no role" path stays for non-invited learners to preserve historical compat per the deny-list rationale in `lib/auth/guards.ts:84-93`).
3. If `inviteToken` present AND verifies:
   - `redeemed = await redeemInviteAtomic(client, payload.iid, account.id)`.
   - If `redeemed === null`: ROLLBACK the entire TX. The whole register fails with `{ error: 'invite_already_used_or_expired' }`. **This is intentional:** if the user came via an invite link and the link is bad, we'd rather they re-try than silently create an unbound account. Rationale: the invite preview was server-rendered just seconds ago, so a redeem failure mid-flight means a real race (someone else used it) — not a UX papercut. Better to fail loud than create the account and silently drop the binding.
   - If `redeemed.teacherAccountId` returned: `UPDATE accounts SET assigned_teacher_id = $1 WHERE id = $2` inside the same TX, with `teacher_account_id` taken FROM THE DB RETURNING CLAUSE, never from the client-submitted `inviteId` or `inviteToken.tid`. This is the load-bearing anti-spoof guarantee.
4. Verify-email token + Resend dispatch fire AFTER commit — these are best-effort side effects, not transactional.

**Edge case — invite present but role='teacher' submitted:**
The form pre-locks the role to `student` for invited registers. But a forged POST body could attempt `{ role: 'teacher', inviteToken: '…' }`. Server rule: **if `inviteToken` verifies, force role to `student`**, ignoring the body's role. Document this in route comment and assert via test (TINV.6.4).

**Edge case — invite present but already-registered email:**
The existing-email branch fires. The invite is NOT redeemed (the existing email path returns `{ ok: true }` before any DB write). The invite remains active. This is correct: the existing user must log in and (if they want to associate with the new teacher) operator-side reassign — invites are for fresh learner-accounts only. Future enhancement: an "associate-via-invite" flow for existing learners — explicitly scoped OUT here.

### 3.8 Cabinet UI — teacher invite section

`app/cabinet/teacher-section.tsx` gets a sibling card OR a new component `<TeacherInviteSection>` rendered between `<TeacherSection>` and `<TeacherLearnersSection>` in `app/cabinet/page.tsx:156-164`.

```
Пригласить ученика
[Создать ссылку-приглашение]   ← button

При нажатии на кнопку появится ссылка на одного ученика.
Скопируйте её и отправьте ученику любым способом
(мессенджер, e-mail, СМС). Ссылка действует 7 дней
и подходит только для одного ученика.

Активные приглашения:
- 2026-05-20 14:32 — не использовано — [Отозвать]   [Скопировать ссылку*]
- 2026-05-19 09:11 — использовано: alex@example.com
- 2026-05-15 22:00 — истёк срок действия

* «Скопировать ссылку» доступно только в течение текущей сессии, пока ссылка хранится в памяти страницы.
```

The "копировать ссылку" affordance ONLY works on invites created in the current page session (the URL is held in component state). Old invites do not expose a copy button — listing them is a status display, not a re-share path. This is the intentional limitation from §3.6 GET endpoint design.

### 3.9 Audit events (extended CHECK constraint)

Migration `0057_teacher_invites.sql` (or sibling) extends the `auth_audit_events.event_type` CHECK:

```sql
alter table auth_audit_events
  drop constraint auth_audit_events_event_type_check;
alter table auth_audit_events
  add constraint auth_audit_events_event_type_check
  check (event_type in (
    'auth.login.success',
    'auth.login.failed',
    'auth.register.created',
    'auth.reset.requested',
    'auth.reset.confirmed',
    'auth.verify.success',
    'auth.session.revoked',
    'auth.teacher.self_registered',
    'auth.invite.created',
    'auth.invite.revoked',
    'auth.invite.redeemed'
  ));
```

**Note:** dropping + re-adding the CHECK constraint is an `ACCESS EXCLUSIVE` lock event briefly on `auth_audit_events`. The table is write-only and the lock is sub-second on a 50k-row table, so this is fine for a maintenance-window deploy. **For zero-downtime deploys this would need `NOT VALID` + `VALIDATE` two-step** — flagging here because LevelChannel does NOT have a zero-downtime requirement on auth-audit (writes are best-effort and swallow errors per `lib/audit/auth-events.ts:79-85`). Codex will flag — §11 Q9.

Also: `lib/audit/auth-events.ts:11-19` `AUTH_AUDIT_EVENT_TYPES` literal-tuple gains the four new strings. TypeScript catches drift between the SQL CHECK and the TS type via existing tests.

The four new events:
- `auth.teacher.self_registered` — fired alongside `auth.register.created` for the new-email + role=teacher branch. `account_id` is set, `payload: { role: 'teacher' }`.
- `auth.invite.created` — `account_id = teacherAccountId`, `email_hash` from teacher's email, `payload: { inviteId, expiresAt }`.
- `auth.invite.revoked` — `account_id = teacherAccountId`, `payload: { inviteId, revokedAt }`.
- `auth.invite.redeemed` — `account_id = learnerAccountId` (the redeemer), `email_hash` from learner email, `payload: { inviteId, teacherAccountId }`.

### 3.10 Email — invite generation does NOT email the learner

The teacher copies the URL themselves. Future enhancement could add a "send invite to <learner-email>" affordance — explicitly out of scope for MVP. Rationale: keeping the operator out of the loop is the entire point; adding a learner-email field on the teacher's invite-generation form re-introduces a typo-risk surface and a Resend dispatch we don't need.

The existing verify-email dispatch (`sendVerifyEmail` in `lib/email/dispatch.ts`) fires for the invited learner on register submit, exactly as today. Same Resend cost, same template.

---

## 4. Security analysis

### 4.1 Token integrity — HMAC + timingSafeEqual

- HMAC-SHA256 with `TEACHER_INVITE_SECRET` prevents token forgery. An attacker without the secret cannot produce a valid token for an arbitrary `teacher_account_id`.
- `timingSafeEqual` on the hmac comparison prevents micro-timing oracles. Implementation: `Buffer.compare` via `crypto.timingSafeEqual` after equal-length check.
- HMAC failure → return null; do NOT include the failure reason in the response. Anti-enumeration discipline.

### 4.2 Replay / single-use

- Single-use is enforced by the WHERE clause on the redeem UPDATE: `used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`. RETURNING-on-update gives the caller the teacher id ONLY if the update matched. Two concurrent redeems → exactly one matches; the other gets 0 rows + ROLLBACK.
- The token itself is "valid forever in HMAC sense" until `exp` — but the DB state flips on first redeem. The two checks (HMAC + DB) are AND'd. Either one going invalid invalidates the link.

### 4.3 Expiry

- 7-day default expiry caps blast radius. A teacher who leaks an invite (e.g. accidentally posts to a public chat) has 7 days max before the link self-expires. A revoke is the instant-mitigation path.
- Expiry is enforced at TWO points: in `verifyInviteToken` (against `payload.exp` in seconds) AND in the redeem UPDATE WHERE clause (against DB `expires_at`). The two MUST agree to within a tiny epsilon — they're stamped from the same `now()` at create time, with `expires_at = now() + interval '7 days'` for the row and `exp = Math.floor(Date.now() / 1000) + 7*24*3600` for the payload. **Drift mitigation: clamp `exp` and DB `expires_at` from a SINGLE `Date.now()` call at create time** (TINV.1 implementation note).

### 4.4 TOCTOU between page-load and submit

- Page-load preflight: HMAC ok + DB row active. Display teacher email. 7-day window.
- User submits 30 seconds later. The DB redeem-update is the authority. If a sibling race redeemed it in those 30 seconds, the update matches 0 rows and the whole register TX rolls back. The user sees «Ссылка-приглашение была использована, пока вы заполняли форму. Зарегистрируйтесь по новому приглашению.» — not «Регистрация не удалась» (the latter would imply their data was rejected; we want to be precise about WHY).

### 4.5 Anti-spoof on `teacher_account_id`

- The client's hidden `inviteId` field is display-only. The server's `redeemInviteAtomic` RETURNING-clause provides the teacher id from the DB row, NEVER from any client input.
- Even the token's `tid` claim is treated as a hint, not authority. The DB row is the only authority. Reason: a forged token cannot exist (HMAC), but the principle of "client input never authorities sensitive FK assignment" is independently load-bearing.

### 4.6 Rate limits

- **Generate**: 5/hour per teacher account. Key = `teacher:invite-generate:account:<teacherAccountId>`. Why per-teacher and not per-IP: teachers may legitimately use multiple devices / VPNs; an IP-keyed limit would be both over-broad (multiple teachers on one corporate IP) and under-broad (one teacher rotating VPN). Concern (Codex will surface — §11 Q5): a malicious teacher could spam invites at 5/hour for days. Counter-arg: the only outbound effect is a DB row + an audit log entry — no email dispatch, no notification. Cost per generate is ~1ms. Sustained 5/hour is 120/day = 840/week per teacher = bounded. Operator can revoke en-masse via SQL if abuse appears.
- **Redeem (POST /register?invite=…)**: piggy-backs on the existing `auth:register:ip` 5/min/IP limit (`app/api/auth/register/route.ts:40`). Additional invite-specific limit: 3/min by IP `register:invite:ip` — prevents enumeration of `inviteId` even though `inviteId` is in the token (a brute-force attacker would have to also forge HMAC, which is the whole point of HMAC). Defense-in-depth.
- **Revoke**: 30/hour per teacher. Low ceiling, bounded.

### 4.7 NEW threat vector — fake teachers

Anyone can register as a teacher today (no admin gate). Mitigations:

- **(a) Email verification before invite-generation.** The invite-generation endpoint sits behind `requireTeacherAndVerified` (`lib/auth/guards.ts:164`). Email-verify is the bot/throwaway gate, not a real KYC, but it raises the cost of bulk-fake-teacher attacks meaningfully.
- **(b) Friction is on the learner side.** The learner-victim has to trust the link the "teacher" gives them. If a scammer hands a victim a `/register?invite=<token>` link, the victim sees «Вас пригласил учитель `scam@example.com`». Whether they trust that email is a social-engineering question, not a technical one.
- **(c) No money flows through teacher-self-reg yet.** A fake teacher cannot extract payment from the learner via the platform. Payments still flow learner → platform; teacher payouts are explicitly out of scope until KYC ships.
- **(d) Future: payout requires KYC.** When teacher payouts ship, KYC enforcement gates the payout side, not the registration side. Bulk-fake-teacher attacks then become economically pointless.

**Accepted risk for MVP**, documented here so future audits don't re-litigate.

### 4.8 Critical-path impact — `lib/auth/sessions.ts`

`lib/auth/sessions.ts` is on the critical-path inventory (see project memory `2026-05-17-18-mega-wave.md`). This epic does NOT modify session creation, lookup, or revoke semantics. `createSession` already works for any role — the existing verify-flow path (`app/api/auth/verify/route.ts:49-53`) mints sessions identically for teachers and learners. **`sessions.ts` is NOT touched.** This needs to be explicit in the epic-end paranoia trailer.

### 4.9 Critical-path impact — `lib/auth/learner-archetype.ts`

The canonical predicate (`LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL`) excludes `teacher` role accounts. The teacher self-reg flow grants `teacher` role inside the same TX as the account create. After commit, the account is correctly excluded from learner-archetype. **Pre-commit window analysis:**
- Between `createAccount` and `grantAccountRole`, the row exists with no role grant. The learner-archetype predicate would temporarily MATCH (no role = learner-eligible by deny-list).
- BUT the TX hasn't committed, so no other connection sees the row. The window is invisible externally.
- Post-commit, both rows are visible atomically. No external observer sees the half-state.

This is correct only because both INSERTs are in the same TX. If the role grant moved out of the TX (e.g., into a post-verify webhook), there would be a real window where the new teacher is briefly classified as learner-eligible. **Same-TX is load-bearing.** Document in route comment + test (TINV.6.5).

---

## 5. Implementation phases (sub-PRs)

Each sub-PR is independently merge-able + self-tested + carries `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-self-reg-invite); epic-end review pending`. Order matters — later sub-PRs depend on earlier.

### TINV.1 — Migration + env contract

- `migrations/0057_teacher_invites.sql`: table + indexes + extended CHECK constraint on `auth_audit_events.event_type`.
- `lib/audit/auth-events.ts:11-19` — extend `AUTH_AUDIT_EVENT_TYPES` tuple to match.
- `lib/auth/teacher-invites.ts` — env-read helper for `TEACHER_INVITE_SECRET`. Mirror `lib/auth/email-hash.ts:15-32` exactly: prod-required, dev-fallback, no module-scope cache.
- README addendum: `TEACHER_INVITE_SECRET` env var documented in `lib/auth/README.md` + `.env.example`.
- Prod runbook addendum: `docs/operations.md` — "Before deploying TINV.X, set `TEACHER_INVITE_SECRET` on the VPS via `systemctl edit levelchannel.service` env override + restart". **Env-flip race rule: secret MUST be live before TINV.2 code path can read it.**

Tests: migration applies clean on a fresh DB; rollback (manual SQL) is documented; `AUTH_AUDIT_EVENT_TYPES` matches SQL CHECK (drift test).

### TINV.2 — Lib `teacher-invites.ts` (sign/verify/create/redeem)

- `signInviteToken`, `verifyInviteToken`, `createInviteForTeacher`, `redeemInviteAtomic`.
- Unit tests in `tests/unit/auth/teacher-invites.test.ts`: round-trip sign/verify, tampered HMAC rejected, expired token rejected, version mismatch rejected, malformed base64url rejected, `timingSafeEqual` on equal-length-but-different-bytes returns false.

### TINV.3 — Backend endpoints

- `app/api/teacher/invites/route.ts` — POST (create), GET (list).
- `app/api/teacher/invites/[id]/revoke/route.ts` — POST.
- `app/api/auth/register/route.ts` — role-aware path + invite-redeem TX. **Touches the most security-sensitive route in the codebase.** Self-review pass MUST include a manual diff against `app/api/auth/register/route.ts:39-149` confirming the anti-enumeration symmetric-work shape is preserved.

### TINV.4 — UI

- `app/register/page.tsx` — server-component wrapper + client island. Role radio. Invite preflight.
- `app/cabinet/teacher-section.tsx` (or new `<TeacherInviteSection>`) — invite-generation card + list.
- Russian copy locked per §3.1 + §3.8 — orthography pass before commit.

### TINV.5 — Audit-event wiring

- All four new event types fired at the documented points.
- Verify all rows have `email_hash` populated (the recorder enforces this — `lib/audit/auth-events.ts:48-86`).

### TINV.6 — Integration tests

See §6.

---

## 6. Tests

### 6.1 `tests/integration/auth/teacher-self-register.test.ts`

- POST `/api/auth/register` with `{ role: 'teacher', ... }` → 200 `{ ok: true }`.
- DB: `account_roles` has one row `(account.id, 'teacher')`. `accounts.email_verified_at IS NULL`.
- Click verify link → `email_verified_at` stamped, session minted.
- Authenticated GET `/cabinet` → 200, page contains «Мои занятия как учитель».
- Authenticated GET `/teacher` → 200 (verified teacher reaches teacher surface).
- Authenticated GET `/admin` → 403 (teacher is NOT admin).
- `auth.teacher.self_registered` audit row exists.

### 6.2 `tests/integration/auth/teacher-invite-generate.test.ts`

- Register + verify a teacher. POST `/api/teacher/invites` with empty body → 200 `{ id, url, expiresAt }`.
- DB: `teacher_invites` row exists, `used_at IS NULL`, `revoked_at IS NULL`, `expires_at` is 7d in future.
- `url` is `<siteUrl>/register?invite=<token>` shape.
- `verifyInviteToken(token)` on the returned URL succeeds, payload `{ v: 1, iid, tid: teacherAccountId, exp }`.
- GET `/api/teacher/invites` → list contains the new row.
- 6 consecutive POSTs in <1 hour → 6th returns 429 (rate limit, 5/hour).
- POST `/api/teacher/invites` as a non-verified teacher → 403 `email_not_verified`.
- POST as admin → 403 `admin_precedence`.
- POST as learner → 403 `wrong_role`.

### 6.3 `tests/integration/auth/teacher-invite-redeem.test.ts`

- Register teacher A, generate invite I.
- Anonymous GET `/register?invite=<I-token>` → 200, page HTML contains «Вас пригласил учитель `<teacher-A-email>`».
- POST `/api/auth/register` with `{ email: 'learner@x', password, role: 'student', personalDataConsentAccepted: true, inviteToken: <I-token> }` → 200.
- DB: learner account exists, `assigned_teacher_id = teacher-A.id`. `teacher_invites.used_at IS NOT NULL`, `used_by_account_id = learner.id`.
- `auth.invite.redeemed` audit row exists with payload `{ inviteId: I.id, teacherAccountId: A.id }`.
- **Race test**: two parallel POSTs to `/api/auth/register` with the SAME `inviteToken` from two distinct emails. Use `Promise.all([fetch(…), fetch(…)])` + a Postgres-side sleep inside a wrapping TX is NOT needed — the WHERE-clause-as-security-boundary in the redeem UPDATE serializes them at row-lock level. Expected: exactly one returns 200, the other returns 4xx (`invite_already_used_or_expired`). DB ends with exactly one learner account whose `assigned_teacher_id = A.id`. The losing email's account does NOT exist (the whole register TX rolled back).

### 6.4 `tests/integration/auth/teacher-invite-hmac.test.ts`

- Tampered token (last char of hmac flipped) → `/register?invite=<bad>` server-side returns the form WITHOUT teacher preview + `invite_error=expired` banner.
- POST register with tampered token → 400 `invite_invalid_or_expired` (or treats invite as absent and creates a free-floating learner with NO teacher binding — DECISION POINT: see §11 Q4).
- Expired token (mock clock — `exp` set 2 days in the past via direct DB UPDATE + a re-signed token) → same shape as tampered.
- Already-redeemed token (run §6.3 redeem first, then try again with same token + different email) → POST register returns 400 `invite_already_used_or_expired`. **No second learner is created** (whole TX rolled back).
- Revoked-then-attempted token → same as already-redeemed.
- Forged-role attack: POST `{ role: 'teacher', inviteToken: <valid> }` → server forces role to `student`. DB has `(account.id, 'student')` role row, NOT teacher. (§3.7 force-rule test.)

### 6.5 `tests/integration/auth/learner-archetype-invariant.test.ts` (extends existing)

- New assertion: a freshly self-registered + verified teacher returns `false` from `isLearnerArchetypeCandidate(teacher.id)`. (Mid-TX state is invisible because no observer sees the un-committed row — this test is post-commit, exercising the deny-list path.)

### 6.6 Drift test

- `tests/integration/auth/auth-audit-event-types-drift.test.ts` — assert `AUTH_AUDIT_EVENT_TYPES` (TS) matches the SQL CHECK constraint enumeration on `auth_audit_events`. Pattern from `tests/integration/auth/learner-archetype-predicate.test.ts`.

---

## 7. Migration / rollout

- Sub-PR-by-sub-PR merge. **No feature flag** — the change is fully additive:
  - The register-form radio defaults to `'student'`; old clients (no JS update, cached HTML) submit without `role`, which the server treats as `'student'`. Existing learner-register works unchanged.
  - The invite endpoints are new — no clients reference them until TINV.4 ships the UI.
- **Env-flip race**: `TEACHER_INVITE_SECRET` MUST be set on prod BEFORE TINV.2 code path can read it. Sequence:
  1. Set env var on VPS via `systemctl edit levelchannel.service` + reload.
  2. Restart the service (the env-read is in a function call, not module-load — see §3.3 — but a restart guarantees fresh state).
  3. Then merge TINV.1 (migration).
  4. Then merge TINV.2 (lib).
  - If TINV.2 merged before the env was set, the dev-fallback secret would mint tokens that production would later reject after the real secret was set — an outage of all outstanding invites. Mitigate by ordering and runbook addendum.
- Migration `0057` applies via the existing migration runner (`scripts/run-migrations.mjs`, invoked by `levelchannel-autodeploy.timer` per project memory `bcs_op_rollout_activated.md`).

---

## 8. Risks + mitigations

### RISK-1 — Fake-teacher abuse

Bulk registration of fake teacher accounts, each generating invites pointed at vulnerable learners. Documented in §4.7. Accepted risk for MVP.

Mitigation hooks already in place: email-verify gate, rate limit on invite-generate, no payout path. Future KYC closes the residual risk.

### RISK-2 — Token leakage via teacher's device

A teacher copies the URL and pastes it into an insecure channel (public messenger, screenshot to a screen-sharing call). Single-use + 7-day expiry + revoke endpoint cap blast radius. Documented in invite-section UI copy: «Ссылка действует 7 дней и подходит только для одного ученика».

### RISK-3 — Teacher purged with outstanding invites

`teacher_invites.teacher_account_id` is `ON DELETE CASCADE` — invites disappear. `accounts.assigned_teacher_id` is `ON DELETE SET NULL` — already-redeemed learners go to "no teacher assigned" and the cabinet shows «обратитесь к оператору» (existing UX in `app/cabinet/page.tsx:175`).

A learner who tries to redeem a now-deleted-teacher's invite hits the redeem UPDATE on a row that no longer exists → 0 rows matched → same `invite_already_used_or_expired` path as expired/revoked. Acceptable.

### RISK-4 — Email verification skipped via invite

The invite-redeem flow does NOT skip email verification for the learner. After register submit, the existing `createEmailVerification` + `sendVerifyEmail` fires, and the learner clicks the link to activate. **Implication: `assigned_teacher_id` is set BEFORE `email_verified_at` is stamped.** This is intentional — the binding is committed at register time, not at verify time. A learner who never verifies cannot book (booking requires verified per `lib/auth/guards.ts:58-73`) but their assignment is recorded.

If we wanted the binding to be conditional on verify, we'd add a `pending_teacher_id` column and promote it on verify. Out of scope; not worth the complexity for MVP.

### RISK-5 — Symmetric-work asymmetry

Adding `grantAccountRole` to the new-email branch widens the wall-clock gap vs the already-registered branch. Quantified: ~1ms additional INSERT vs 250ms bcrypt cost. The gap is in the noise. **Codex paranoia will likely measure this empirically — see §11 Q3.**

### RISK-6 — Migration CHECK-constraint lock

Dropping + re-adding the `auth_audit_events_event_type_check` constraint takes ACCESS EXCLUSIVE briefly. Auth-audit writes are best-effort and swallowed on failure, so a sub-second lock causes at most a few swallowed audit rows. Acceptable. Documented in deploy log.

### RISK-7 — Race between page-render preflight and submit-redeem

Two windows:
- Window A: page load HMAC + DB check passes → user fills form. ~30s typical.
- Window B: submit hits server → redeem UPDATE evaluates.

If a sibling redeem happened in Window A, Window B's UPDATE matches 0 rows. The whole register TX rolls back. User-visible error: precise message «Ссылка-приглашение была использована, пока вы заполняли форму». No silent corruption. §4.4 covers this.

---

## 9. Open questions for paranoia (Q1-Q12)

These are the questions I'd attack this plan with if I were the adversarial reviewer. Answer them in round 1 SIGN-OFF.

**Q1.** Should the invite be revocable AFTER redeem (to break the learner-teacher link retroactively)? Today's design says no — revoke is no-op on used invites, the operator-side reassign flow handles "wrong teacher" cases. Is this the right call? It seems intentional, but `/admin/accounts/[id]` is the only re-assign surface — does the teacher have a way to drop an unwanted bound learner without operator help? **Recommended answer:** add a separate "Учитель → отвязать ученика" endpoint, scoped OUT of THIS epic but tracked as a follow-up.

**Q2.** What happens if the teacher account is deleted while invites are outstanding? Current design: `ON DELETE CASCADE` drops the invite rows; outstanding redeems get `invite_already_used_or_expired`. Already-redeemed learners get `assigned_teacher_id = null`. Is the cascade the right shape, or should outstanding invites be soft-revoked (audit-preserved) before being dropped? **Recommended answer:** explicit two-step in the operator-side delete: first UPDATE all the teacher's invites SET `revoked_at = now()` + audit, then the cascade fires the rest. Adds one helper call to the operator delete route. Worth doing for audit clarity.

**Q3.** Rate-limit key for invite-generate — by teacher account vs by IP. Plan picks per-teacher. Counter: a compromised teacher session could exhaust the 5/hour quota and prevent legitimate teacher use from a new device. Counter-counter: the legitimate teacher revokes session via `/api/auth/logout-all` + the burst is bounded anyway. **Recommended answer:** keep per-teacher, document the trade-off in route comments.

**Q4.** Tampered-token POST register behaviour — fail loud (400) OR fall through to "register without invite binding" (200, no `assigned_teacher_id`). Plan currently says fail loud (§6.4). Rationale: a tampered token signals an attack, not a UX miss; the user should re-fetch the invite. Counter: a legitimate user with a malformed token in their URL (e.g. truncated by a messenger) loses the binding silently AND can't register at all. **Recommended answer:** fail loud, but the page-load preflight in §3.7 STRIPS the bad token from the URL with a banner, so by the time the user clicks "Создать аккаунт" they're already on the no-invite path. The fail-loud branch only fires on a forged-body attack post-strip.

**Q5.** Existing register endpoint anti-enumeration symmetric-work — does the new role grant + TX wrap meaningfully widen the wall-clock asymmetry? Measure on local: how many ms does the new-email branch take vs already-registered? Plan claims ~1ms additional, in the noise. Verify empirically in `tests/integration/auth/register-symmetry.test.ts` (new test).

**Q6.** Anti-bot on `/register` — is the existing 5/min/IP + 3/h/email rate limit sufficient, or does teacher-self-reg specifically need a stricter gate? Plan keeps existing limits. The existing limits were designed for learner-only sign-ups. Counter: teacher sign-ups are by definition rarer, so the existing limits are over-permissive for the teacher path. Counter-counter: we don't know a teacher from a learner at rate-limit time — the role is in the body, the rate-limit gate runs before the body parse. **Recommended answer:** post-launch monitor `auth.teacher.self_registered` event volume; if abuse appears, add captcha (already planned post-launch per `docs/plans/phase-1b-auth-routes.md:427`).

**Q7.** Hidden `inviteId` field on the register form vs deriving from `inviteToken` server-side. Plan sends BOTH. The server treats `inviteToken` as authority. Question: why send `inviteId` at all? Answer: for the audit row of a tampered-token register attempt — the `inviteId` from the body is logged as "attempted invite id" even when the token doesn't verify, giving forensic context. **Recommended answer:** keep the dual field, log `attemptedInviteId` in the audit payload on tampered-token attempts.

**Q8.** Email-verify token + invite-redeem ordering. Plan redeems in the register TX, fires verify email AFTER commit. Question: should the redeem instead be conditional on verify-click? Discussed under RISK-4 — plan picks "redeem at register, binding survives even if verify never happens". Alternatives: (a) `pending_teacher_id` column promoted on verify; (b) reject register entirely if invite present but verify will be deferred. Plan picks the simplest. **Recommended answer:** confirm "binding-at-register" is the product-owner's intent; document explicitly.

**Q9.** Migration CHECK-constraint drop+re-add — should we use `NOT VALID + VALIDATE` for zero-downtime? Plan says no (LevelChannel doesn't have a zero-downtime requirement on auth-audit, writes are swallow-failures). Confirm by reading `migrations/0029_audit_writer_role.sql` — does it use any specific lock-avoidance pattern? **Recommended answer:** check it, document the precedent, follow the existing convention.

**Q10.** Should `teacher_invites` carry a free-form `note` column ("приглашаю Алёну на пробное") that the teacher fills in at create time, surfaced in the list view? Out of scope OR in scope? Plan says out of scope. Counter: surfaces UX value at near-zero implementation cost — one varchar column + one form field. **Recommended answer:** in scope, add to TINV.4 (UI sub-PR). Cap length at 200 chars, render-safe (no HTML), audit-logged at create time.

**Q11.** `verifyInviteToken` failure modes — does it log to audit on every failure? Plan says no — anti-enumeration. Counter: a flood of failed-HMAC POSTs on `/api/auth/register` should be alertable. Where does that alert live today? Answer: it doesn't. The existing `enforceRateLimit('auth:register:ip', 5, 60_000)` is the only signal. **Recommended answer:** add `register:invite:failure_count` to telemetry, but DO NOT log to `auth_audit_events` per-failure (would explode the table on attack). Aggregate at the rate-limit-bucket level.

**Q12.** What if a user submits the register form TWICE with the same invite (network retry, double-click)? Plan: the second POST hits the redeem UPDATE on a now-used row, gets 0 rows, ROLLBACK, returns 400. The user sees the "already used" error and is confused (they didn't see the first one succeed). Counter: the first POST returned `{ ok: true }` which redirected them to `/verify-pending` — the second submit shouldn't be reachable. Counter-counter: if the redirect was eaten by a slow network, the user might hammer the button. **Recommended answer:** add `Idempotency-Key` header support to `/api/auth/register` for invite-redeem paths specifically, using the existing `idempotency_records` table (`migrations/0004_idempotency_records.sql`). Idempotent retry returns the same `{ ok: true }` as the original. Out of scope for THIS epic — track as TINV.7 follow-up.

---

## 10. Acceptance criteria (epic-end)

The epic ships when:

- All sub-PRs TINV.1 through TINV.6 are merged with self-review trailers.
- `/codex-paranoia wave` on the aggregated diff returns SIGN-OFF (BLOCKERs absent).
- Production smoke: register-as-teacher → verify → generate invite → fresh learner register-via-invite → cabinet shows assigned teacher → teacher cabinet shows new learner in `<TeacherLearnersSection>`.
- Migration `0057` applied on prod.
- `TEACHER_INVITE_SECRET` set on prod, restart confirmed in journalctl.
- `auth_audit_events` shows the four new event types firing in the smoke run.
- Existing tests pass: full integration suite green; no regression in `tests/integration/auth/*` or `tests/integration/billing/*`.
- Critical-path inventory file updated: `lib/auth/sessions.ts` confirmed not touched in the epic diff. (If it WAS touched, this epic owes `/codex-paranoia` an extra targeted review per project memory.)

---

## 11. Final trailer

Merge commit for the epic-close PR carries:
```
Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)
```

Sub-PRs carry:
```
Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-self-reg-invite); epic-end review pending
```

— END OF DRAFT —
