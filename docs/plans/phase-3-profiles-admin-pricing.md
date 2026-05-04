# Phase 3 — Profiles + Admin Pricing (proposal)

Status: **approved 2026-05-04**. Decisions D1–D8 settled with the
operator. Implementation can proceed.

## Why this wave exists

End of Phase 2 left the cabinet at "Здравствуйте, вы вошли. Кабинет в
разработке." A real cabinet needs:

1. enough learner identity (display name + simple prefs) to address the
   user by name and remember per-account context — without requiring it
   at registration (the consent flow is already heavy).
2. an admin surface so the operator can grant `admin` / `teacher`
   roles without `psql`, see who's registered, and (if needed) suspend an
   account.
3. a price catalog. The current `/pay` flow takes a free-text amount
   10–50 000₽; later phases (5 lesson lifecycle, 6 cabinet payment) need
   the cabinet to *pick* a tariff, not retype its number. An admin-managed
   catalog is the entry point for that.
4. **the 152-ФЗ pieces that already have store ops but no UI**: consent
   withdrawal, account deletion (subject access right). These were
   explicitly deferred to "Phase 3 admin / cabinet" in earlier docs.

## Out of scope (kept for later phases)

- scheduling / lesson booking (Phase 4)
- lesson lifecycle, 24h rule (Phase 5)
- cabinet payment flow + `payment_allocations` (Phase 6)
- per-account custom prices ("this student pays X, that one Y") — the
  catalog ships as a flat tariff list; per-account pricing is Phase 6
  alongside `payment_allocations`
- multilingual surfaces — RU only
- file uploads, avatars, profile photos

## Open decisions (to settle before code)

### D1. Profile fields — minimum viable set

**Settled:** ship without `phone_e164`. The operator does not need to
call or Telegram learners yet; adding a phone field invites collecting
PD that has no use case, and a phone field with weak validation creates
a 152-ФЗ trap (numeric data attached to identity = personal data).
Backlogged as "add `phone_e164` when an operator workflow actually
needs it" in `ENGINEERING_BACKLOG.md`.

Final shape:

| Field | Type | Required | Notes |
|---|---|---|---|
| `display_name` | text, nullable | no | "Иван", "Anna K." Free text 1–60 chars. Falls back to `email` when empty |
| `timezone` | text, nullable | no | IANA name; default null = "use server time when stamping". Phase 4 (scheduling) makes this required |
| `locale` | text, nullable | no | `ru` only for now; column exists for forward compat |

No avatar, no bio. Stored in a new `account_profiles` table (1:1 with
`accounts`, FK on delete cascade) so we don't widen `accounts`.

### D2. Admin surface — server-rendered or SPA?

Proposed: **server-rendered Next.js pages** at `/admin/*`, gated by
`requireAdminRole()` in the layout. Pattern matches `/cabinet`. No
client-side admin SPA, no per-row fetch dance. Data tables are simple
HTML lists with form-POSTs that return the same page server-rendered.

Pages:

- `/admin` — dashboard with three cards (accounts count, recent
  registrations, recent payments) and links into the three sub-pages
- `/admin/accounts` — paginated list (50/page), search by email, click
  → detail page
- `/admin/accounts/[id]` — detail: roles (grant / revoke), profile
  fields (read-only at first), email-verified status, disabled toggle,
  delete account button (152-ФЗ SAR)
- `/admin/pricing` — list of tariffs, edit one inline, add new, archive
  old
- (deferred) `/admin/payments` — operator payment list. The backlog has
  this as P2, not P0. Not in this wave unless we explicitly add it

### D3. Price catalog — schema

Proposed table `pricing_tariffs`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text unique | `lesson-60min`, `package-10` |
| `title_ru` | text | Operator-visible, learner-visible if shown in cabinet |
| `description_ru` | text nullable | Optional sub-line |
| `amount_kopecks` | integer | Single source of truth in kopecks; rubles is a derived display |
| `currency` | text default `RUB` | Forward compat |
| `is_active` | boolean | Soft-archive: `false` hides from learner UI but keeps history |
| `display_order` | int | Manual sort |
| `created_at` / `updated_at` | timestamptz | |

**Settled:** Phase 3 ships **only** the table + admin CRUD. The `/pay`
flow stays free-amount in this wave. Reasoning: changing `/pay`
mid-funnel without the cabinet flow ready is a regression for the
public checkout; we should not strand operator-managed prices in a
route the operator can't yet route learners through. Wiring the public
checkout to the catalog (with a "free amount" fallback for one-off
payments) is tracked in `ENGINEERING_BACKLOG.md` and ships with the
cabinet payment flow in Phase 6.

### D4. Consent withdrawal UI

Cabinet gets a `Согласия` section with:

- list of active consents (currently only `personal_data`) with
  `accepted_at`
- per-row "Отозвать" button → `POST /api/account/consents/withdraw`
  → confirms with the rule wording from `lib/legal/`
- list of withdrawn consents with `revoked_at`

After withdrawal of `personal_data` the account is effectively unusable
(can't keep processing PD). Behavior on withdrawal:

- `accounts.disabled_at = now()`
- all sessions revoked
- account *not* deleted (delete is a separate user action; withdrawal
  is reversible only by re-accepting)
- the operator gets a notification email

This matches 152-ФЗ art.9 §5: the operator stops processing within 30
days, the data isn't necessarily deleted at that moment.

### D5. Account deletion (152-ФЗ SAR) — 30-day grace window

**Settled:** two-stage deletion with a 30-day grace.

Stage 1 — request (immediate, learner action):

- `accounts.disabled_at = now()` (account unusable, login blocked)
- `accounts.scheduled_purge_at = now() + interval '30 days'` (new
  column, migration 0019)
- all sessions revoked
- the operator gets a notification email with an "Cancel" link to
  `/admin/accounts/[id]` so a returning learner can be reinstated
- the original e-mail and personal data **stay** on the row during the
  grace window — the data is still there, only the account is locked

Stage 2 — purge (automatic, after 30 days):

- a daily job in `scripts/db-retention-cleanup.mjs` finds rows where
  `scheduled_purge_at <= now()` and:
  - rewrites `accounts.email` to `deleted-<uuid>@example.invalid`
  - zeros `accounts.password_hash` (set to `'PURGED'`, never matches
    bcrypt prefix)
  - clears `account_profiles.*` (display_name / timezone / locale all
    null)
  - keeps `payment_orders` and `payment_audit_events` rows in place
    with the placeholder email — 54-ФЗ retention requires keeping the
    financial record (~5 years); the personal data is unlinked
  - sets a `purged_at` timestamp on the row for audit

Cancellation during grace:

- `/admin/accounts/[id]` shows a "Pending purge: <date>" banner
- one-click "Cancel deletion" button: `scheduled_purge_at = null`,
  `disabled_at = null`, audit-logged
- learner can log in again with old credentials (password_hash was
  not touched in stage 1)

The placeholder email after purge is randomized so it can never
collide with a future registration. `disabled_at` stays set forever
on a purged row so any residual lookup by id is treated as inactive.

### D6. Admin role bootstrap — CLI-only

**Settled:** CLI script only. `node scripts/grant-admin.mjs <email>`,
operator runs it on the server once. No env-variable auto-bootstrap.

Reasoning:

- env-var auto-grant turns a config typo / leak / accidental dev-prod
  cross-pollination into a silent admin grant. The blast radius of a
  misconfigured `INITIAL_ADMIN_EMAIL` is the whole admin surface
- env-var rotation does not retroactively revoke an already-granted
  admin role, so the env-var "self-disables" property is weaker than
  it sounds — the role outlives the bootstrap mechanism
- a CLI script forces an explicit, audit-logged, server-side action.
  shell history + journald together produce a clean trail of when /
  by whom an admin was granted
- the CLI script is also the recovery path if every admin loses
  access, so we'd need to write it anyway

Script behavior:

- argument: target e-mail (case-insensitive, normalized)
- if the account doesn't exist → exit 1 with "Account not found"
- if the account is already admin → exit 0 with "Already admin"
- otherwise inserts into `account_roles` with `granted_by_account_id`
  set to a special `'cli-bootstrap'` sentinel (or null — to be decided
  at implementation time given the FK)
- prints a one-line audit summary to stdout with the new admin id

Subsequent admin grants from the UI (`/admin/accounts/[id]`) work
once the first admin exists.

### D7. Test coverage

In line with Phase 1B / Phase 2 standard:

- unit: profile validation, tariff validation, slug format
- integration (Docker PG): `account_profiles` round-trip, tariff CRUD,
  admin route gates (anonymous → 401, non-admin → 403, admin → 200),
  consent withdrawal store ops + the disable-account side effect,
  account-deletion store ops + the placeholder-email round-trip

No e2e through a headless browser in this phase.

### D8. Migration / rollback strategy

Two new tables (`account_profiles`, `pricing_tariffs`). Both are
additive — no existing column changes. Rollback = drop tables; no
existing flows depend on them in this wave, so rollback is safe.

## Surface area summary

**New tables**: `account_profiles`, `pricing_tariffs` (migration 0017,
0018).

**New routes**:

- `GET/PATCH /api/account/profile`
- `POST /api/account/consents/withdraw`
- `POST /api/account/delete`
- `GET /admin`, `/admin/accounts`, `/admin/accounts/[id]`,
  `/admin/pricing`
- `POST /api/admin/accounts/[id]/role` (grant / revoke)
- `POST /api/admin/accounts/[id]/disable`
- `GET/POST/PATCH /api/admin/pricing` and `/api/admin/pricing/[id]`

**New cabinet sections**: profile editor, consents list, delete-account.

**Auth helpers**: `requireAdminRole(request) → Account`,
`requireAuthenticated(request) → Account` (the latter probably already
exists in `lib/auth/sessions.ts`; verify before duplicating).

## Estimate

Roughly:

- migrations + store ops + tests: ~0.5 day
- admin pages (server-rendered, no SPA): ~1 day
- profile editor + consent / delete in cabinet: ~0.5 day
- glue, retries, RU copy: ~0.5 day

≈ 2.5 day's worth of focused work. Smaller than Phase 1B because
there's no new auth mechanism — just CRUD on top of established auth.

## Decisions — settled 2026-05-04

| ID | Settled |
|---|---|
| D1 | Profile fields = display_name + timezone + locale. Phone deferred to backlog |
| D2 | Server-rendered `/admin/*`, no SPA |
| D3 | `/pay` stays free-amount; catalog wiring tracked in backlog under Phase 6 |
| D4 | Consent withdrawal = disable account + revoke sessions, data stays in place |
| D5 | Account deletion = 30-day grace, daily purge job folded into retention cleanup |
| D6 | Admin bootstrap = CLI script only, no env-var auto-grant |
| D7 | Unit + integration tests; no e2e in this wave |
| D8 | Additive migrations 0017 / 0018 / 0019; rollback = drop new tables / column |
