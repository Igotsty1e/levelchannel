# Teacher cabinet polish (2026-05-23 — owner-requested)

**Status:** SHIPPED 2026-05-23 — all 6 sub-PRs (A-F) merged to main via PRs #432/#433/#434/#435/#436/#437/#438. Plan-paranoia rounds 1-6 closed (11 BLOCKERs + 3 WARNs).
**Author:** Claude (orchestrator-mode).
**Owner context:** chat 2026-05-23 (RU). SaaS pivot Epic 8 shipped; the teacher cabinet at `/teacher` works but is rough. Owner wants a UX polish pass before opening to outside teachers.

> Companion plan: `docs/plans/saas-pivot-master.md` (the just-shipped 8-epic pivot is the SoT for the surfaces this polish builds on).

## 0. Plan-paranoia gate

This file MUST be sent through `/codex-paranoia plan docs/plans/teacher-cabinet-polish.md` rounds 1-3 BEFORE the first sub-PR opens.

- Hard cap = 3 rounds. BLOCKERs block SIGN-OFF; WARN/INFO fix in-loop but don't iterate.
- After SIGN-OFF, sub-PRs inherit it. Each sub-PR ships with `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-cabinet-polish); epic-end review pending`.
- After all sub-PRs merge, run `/codex-paranoia wave <commit-range>` (one pass per the global epic-end rule). Epic-close PR carries `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`.
- If round 3 still has BLOCKERs → STOP, escalate (`ESCALATED round 3/3`).

## 0z. Existing Surface Inventory

Per company contract (~/.claude/COMPANY.md §"Existing Surface Inventory"). Every NEW file under §3 Sub-PRs gets a grep-survey hit table here so reviewers verify no existing-surface duplication. NEW = create; EXTEND = touch existing; KEEP = unchanged.

| New/touched surface | Status | Existing-surface grep check |
|---|---|---|
| `app/teacher/layout.tsx` | EXTEND | already exists (PR #339). Sub-PR B wraps children with `<TeacherCabinetNav />`. |
| `components/teacher/cabinet-nav.tsx` | NEW | grep `cabinet-nav.tsx` → no hit. Confirmed not duplicated. |
| `app/teacher/profile/page.tsx` | NEW | grep `app/teacher/profile/` → does not exist. NEW route. |
| `components/teacher/tariff-comparison-card.tsx` | NEW | grep `tariff-comparison` → no hit. No existing tariff cards in teacher cabinet (admin pricing UI separate). |
| `lib/notifications/teacher-digest-preview.ts` | NEW | grep `teacher-digest-preview` → no hit. Cron lives at `scripts/teacher-daily-digest.mjs`; helper is a NEW ts extraction with SQL aligned 1:1 to cron's per-teacher SELECT. |
| `components/teacher/digest-preview-tile.tsx` | NEW | grep `digest-preview-tile` → no hit. |
| `app/teacher/learners/page.tsx` | NEW | grep `app/teacher/learners/page.tsx` → does not exist; only `[id]/page.tsx` and `[id]/settle/page.tsx` exist (Day 5A/5B). |
| `migrations/0095_account_profiles_first_last_name.sql` | NEW | highest existing migration is 0094 (PR #425 NOT NULL flip). 0095 free. |
| `lib/auth/profile-name.ts` | NEW | grep `formatProfileName` → no hit. Helper duo is genuinely new. |
| `lib/auth/profiles.ts` | EXTEND | already exists. Sub-PR F adds `firstName` / `lastName` fields to AccountProfile + extends PATCH writer. |
| `app/api/auth/register/route.ts` | EXTEND | already exists. Sub-PR F adds post-create UPSERT (non-tx per round-2 closure). |
| `app/api/teacher/learners/[id]/rename/route.ts` | EXTEND | already exists (PR #427). Sub-PR F adds `firstName` / `lastName` body fields. |
| `app/teacher/settings/calendar/page.tsx` | EXTEND | already exists. Sub-PR A flips page-level intro on `configReady` (round-2 BLOCKER #1 closure). |
| `app/teacher/settings/calendar/connect-card.tsx` | EXTEND | already exists. Sub-PR A flips error banner branches. |
| `scripts/db-retention-cleanup.mjs` | EXTEND | already exists (Day 5B + earlier). Sub-PR F extends `purgeAccounts` SQL to nullify `first_name` / `last_name` (round-1 BLOCKER #4 closure). |
| `scripts/lib/profile-name.mjs` | NEW | grep `profile-name.mjs` → no hit. Mjs twin of `lib/auth/profile-name.ts` for cron `scripts/teacher-daily-digest.mjs` greeting use (Q-10 closure). |

No surface is silently extended. Every consumer named above is named in §3 Sub-PRs + §5 Day-by-day plan.

## 1. Owner context — the 6 tasks

Tasks below are translations + scope crystallisations of the owner request (2026-05-23, RU). No new server features beyond mig 0095; everything else is UI scaffolding over already-shipped Epic 1-8 data.

**TASK-1 (cabinet nav menu).** The teacher cabinet has no top-level navigation today. `/teacher` itself is "Мой календарь", and a small `Link` row above the calendar surfaces `/teacher/settings/calendar`, `/teacher/settings/digest`, `/teacher/tariffs`. That row is a stop-gap. Add an explicit cabinet-wide nav with `Календарь` / `Ученики` / `Пакеты` / `Тарифы` / `Профиль` buttons that lives in the teacher layout (not in `page.tsx`) so it's visible on every `/teacher/*` route.

**TASK-2 (tariff card on `/teacher/profile`).** No `/teacher/profile` route exists yet. Create one. The page shows the current `teacher_subscription_plans` row (`free` / `mid` / `pro` / `operator-managed`) plus a 4-column comparison card so the teacher can see what they're missing. "Сменить тариф" buttons are present but **DISABLED** for now (Mid/Pro public upgrade is the still-deferred Epic 4 per saas-pivot-master.md §3 Epic 4-DEFERRED). The page also reuses the cabinet `ProfileEditor` so the teacher can edit their own имя + часовой пояс (no duplicate UI).

**TASK-3 (daily digest preview tile on `/teacher`).** The teacher digest cron lives at `scripts/teacher-daily-digest.mjs`; the operator-side admin surface at `/admin/(gated)/settings/digest` lets the operator see the next-tick digest preview for ALL teachers. The teacher's own settings page is `/teacher/settings/digest` (Telegram bind + master switch surface). Owner wants the **teacher's own digest for TODAY (teacher-local calendar day)** preview tile on `/teacher` main page so the teacher sees today's lessons without reading email. Round-1 BLOCKER #1 closure: the shipped cron computes the digest by `todayLocalYmd` per `scripts/teacher-daily-digest.mjs:188`, NOT rolling 24h. The tile MUST use the same predicate so the preview matches the email + the admin /admin/(gated)/settings/digest view. Implementation: extract the digest "today's slot list for teacher" helper from the cron script into `lib/notifications/teacher-digest-preview.ts` (pure read; no send; same SQL predicate as the cron's per-teacher SELECT including `start_at >= today_local_00:00 AT TIME ZONE teacher_tz` AND `start_at < tomorrow_local_00:00 AT TIME ZONE teacher_tz`) and render it as a tile near the top of `/teacher` page.tsx.

**TASK-4 (learners list at `/teacher/learners`).** The drill-down at `/teacher/learners/[id]` exists (Day 5A page lists completions + rename form + settle CTA), and the cabinet's learner section in `/cabinet/teacher-learners-section.tsx` lists rows for the bootstrap teacher's UI. Owner wants the EQUIVALENT list rendered at `/teacher/learners` (SSR page) so the teacher cabinet has a real top-level Ученики surface, with rows linking to the existing drill-down. Backing helper `listLearnersForTeacher` already exists in `lib/scheduling/teacher-learners.ts` — reuse, don't duplicate.

**TASK-5 (firstName + lastName globally).** Today the user's name is a single `account_profiles.display_name` (mig 0017, nullable, ≤60 chars). Owner wants distinct `Имя` + `Фамилия` everywhere — registration, cabinet profile, teacher's rename-learner form, teacher digest greeting, etc. New schema:
- mig 0095: `account_profiles` adds `first_name text NULL` (≤60) + `last_name text NULL` (≤60). Both nullable to preserve back-compat. Backfill from existing `display_name`: split on first space, dump everything before into `first_name`, after into `last_name`; if no space, dump whole string into `first_name`. Empty `display_name` → both NULL.
- `display_name` is KEPT as a NULLABLE storage column **for one release cycle** for read-path back-compat; a follow-up post-MVP epic computes it virtually or drops it (open Q-2).
- **Reader helper** (round-2 BLOCKER #3 closure — SEPARATE from writer): `formatProfileNameForRender({ firstName, lastName, displayName, fallbackEmail })` in `lib/auth/profile-name.ts` — return `nullif(trim((firstName||'') + ' ' + (lastName||'')))` ?? `displayName` ?? `fallbackEmail`. Used at every UI render site. **Allowed to fall back to email.**
- **Writer helper** (round-2 BLOCKER #3 closure — SEPARATE from reader): `computeDisplayNameForStorage({ firstName, lastName })` in `lib/auth/profile-name.ts` — return `nullif(trim((firstName||'') + ' ' + (lastName||'')))` (i.e. NULL if both names empty). **Never falls back to email.** Used by PATCH `/api/account/profile` and the register UPSERT to recompute the storage column. The CHECK constraint `account_profiles_display_name_len` is satisfied because empty becomes NULL, not `''`.
- Writer contract: every UI form that previously wrote `displayName` switches to writing `firstName` + `lastName` (both optional). The PATCH route adds `firstName` / `lastName` keys; the PATCH SQL writes the new `first_name`/`last_name` columns AND `display_name = computeDisplayNameForStorage(...)` (NULL on empty). Reader contract: every read site uses `formatProfileNameForRender` (with email fallback if needed for UI).

**TASK-6 (calendar text fix).** Today `/teacher/settings/calendar` has TWO problem branches in `connect-card.tsx`:
1. `configError` (env throws on prod with missing GOOGLE_CALENDAR_* vars) → red banner "⚠ Интеграция не настроена на этом окружении. Напишите оператору" + stack-trace `<details>`. This is what the owner saw — fix to a NEUTRAL "Скоро будет — функция активируется в ближайшем обновлении" tile, drop operator email exposure, drop the stack-trace `<details>` (debug-only — keep in logs).
2. `!configReady` (non-prod, env missing legitimately) → grey "ℹ Интеграция временно недоступна на этом окружении (dev / staging)" — keep, but unify copy with branch 1 for visual consistency.
- When env vars ARE configured (`configReady === true`), the existing connect flow proceeds — NO change.
- The page-level intro text + "Как будет работать (по мере включения)" section is kept verbatim.

**Round-1 BLOCKER #2 closure — page-level text must also flip.** Just changing `connect-card.tsx` leaves contradictory page-level copy: `app/teacher/settings/calendar/page.tsx:126,129` say "подключение готово" / "Подключитесь сейчас" while the card now says "Скоро будет". Sub-PR A MUST also gate those page-level strings on `configReady`:
- `configReady === false` → page intro becomes "Эта функция активируется в ближайшем обновлении. Спасибо за терпение." + suppress the "Подключитесь сейчас" CTA paragraph entirely.
- `configReady === true` → existing text + connect CTA proceeds unchanged.
- The success banner at `page.tsx:145` ("в течение нескольких минут") is only rendered after a successful OAuth callback (`oauthSuccess === true`) — never visible in the !configReady branch, so it stays.

## 2. Schema / data changes

### 2.1 mig 0095 — first_name + last_name on account_profiles

`migrations/0095_account_profiles_first_last_name.sql`:

```sql
-- TASK-5 (2026-05-23) — first_name + last_name on account_profiles.
-- Plan: docs/plans/teacher-cabinet-polish.md §2.1.
--
-- Both columns are NULLABLE so the migration is non-blocking; the
-- UI is the source of truth for "what shape does a name take now".
-- display_name is KEPT in this migration for one release cycle;
-- a post-MVP epic computes it virtually or drops it.
--
-- Backfill rule (deterministic, idempotent):
--   - split display_name on FIRST whitespace
--   - left of split → first_name; right of split → last_name (may be NULL)
--   - if display_name has no whitespace → first_name = display_name, last_name NULL
--   - if display_name is NULL or empty → both NULL
--
-- Re-running the migration is safe: ADD COLUMN IF NOT EXISTS + the
-- UPDATE has a "WHERE first_name IS NULL AND last_name IS NULL" guard
-- so it never overwrites manually-set values.

alter table account_profiles
  add column if not exists first_name text null,
  add column if not exists last_name text null;

alter table account_profiles
  add constraint account_profiles_first_name_len
    check (first_name is null or (char_length(first_name) between 1 and 60));

alter table account_profiles
  add constraint account_profiles_last_name_len
    check (last_name is null or (char_length(last_name) between 1 and 60));

update account_profiles
   set first_name = case
         when display_name is null then null
         when trim(display_name) = '' then null
         when position(' ' in trim(display_name)) = 0 then trim(display_name)
         else substring(trim(display_name) from 1 for position(' ' in trim(display_name)) - 1)
       end,
       last_name = case
         when display_name is null then null
         when trim(display_name) = '' then null
         when position(' ' in trim(display_name)) = 0 then null
         else trim(substring(trim(display_name) from position(' ' in trim(display_name)) + 1))
       end
 where first_name is null
   and last_name is null;
```

**Constraint length:** matches the existing `display_name` 60-char cap. If split produces a 60+ char half (e.g. one-word display_name `'верыдлинноеимябезпробеловмногоооо' …`), the LEFT side will fit (we only split on the first space; an unsplit single word stays as-is since it was already ≤60).

**Idempotency edge:** running mig 0095 twice over the same DB is a no-op (the WHERE guard rejects pre-populated rows). NO `truncate` / re-split — that would obliterate user-edited values.

**Reverse rollback** (for emergency): `alter table account_profiles drop column first_name, drop column last_name;` — `display_name` is untouched, so the cabinet still renders names correctly.

### 2.2 No schema changes for TASK-1/2/3/4/6

All UI-only over existing tables.

- TASK-1 (nav menu) — no DB.
- TASK-2 (tariff card on `/teacher/profile`) — reads `teacher_subscriptions` + `teacher_subscription_plans` (mig 0073/0074, both shipped).
- TASK-3 (digest tile) — refactors `scripts/teacher-daily-digest.mjs` to extract the read query into a reusable lib helper; no schema change.
- TASK-4 (learners list) — reuses `listLearnersForTeacher` (existing helper).
- TASK-6 (calendar text) — UI string + branch logic change only.

## 3. Sub-epic decomposition — 6 sub-PRs

Decomposition is intentionally fine-grained: 5 of the 6 sub-PRs are 1-day-each scope; Sub-PR F (firstName/lastName sweep) is the only multi-day piece because it touches many files.

### Sub-PR A — calendar text fix (TASK-6)

Files:
- `app/teacher/settings/calendar/connect-card.tsx` — replace red `configError` banner with neutral "Скоро будет — функция активируется в ближайшем обновлении" tile. Drop the stack-trace `<details>` block. Unify with `!configReady` non-prod copy so both branches render the same neutral tile.
- **`app/teacher/settings/calendar/page.tsx`** (round-2 BLOCKER #1 closure) — page-level intro paragraph AND the "Подключитесь сейчас" CTA paragraph at lines 126,129 BOTH gate on `configReady`:
  - `configReady === false` → page intro becomes "Эта функция активируется в ближайшем обновлении. Спасибо за терпение." + the "Подключитесь сейчас" paragraph is suppressed entirely.
  - `configReady === true` → existing text + CTA proceed unchanged.
  - The success banner at line 145 (post-OAuth-callback) is only rendered after `oauthSuccess === true`, so it stays.

Trailer: `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-cabinet-polish); epic-end review pending`.

Tests:
- `tests/integration/teacher-cabinet-polish/calendar-connect-card.test.tsx` — RTL render with `configError` set + `configError === null && configReady === false` → asserts:
  - "Скоро будет" copy present;
  - "Напишите оператору" copy ABSENT (no operator email exposure);
  - no `<details>` element rendering the raw error.
- **`tests/integration/teacher-cabinet-polish/calendar-page-gated-intro.test.tsx`** (round-2 BLOCKER #1 closure) — RTL render of `/teacher/settings/calendar` with `configReady=false` asserts the page intro shows "Эта функция активируется в ближайшем обновлении" AND the "Подключитесь сейчас" paragraph is absent; with `configReady=true` asserts the original text + CTA appear.

### Sub-PR B — cabinet nav menu (TASK-1)

Files:
- `app/teacher/layout.tsx` — wrap `{children}` with `<TeacherCabinetNav />` rendered above the main content.
- `components/teacher/cabinet-nav.tsx` (NEW) — server component (it reads no client state). 5 buttons: `Календарь` → `/teacher`, `Ученики` → `/teacher/learners`, `Пакеты` → `/teacher/packages`, `Тарифы` → `/teacher/tariffs`, `Профиль` → `/teacher/profile`. The active route gets the accent style (read from `next/navigation.usePathname` — so this leaf can be a client component; the parent is server).
- `app/teacher/page.tsx` — restructure the top of the page (round-5 BLOCKER #1 closure):
  - REMOVE the inline nav-link row (lines 132-188 in current head: the 3 `Link` buttons to settings/calendar, settings/digest, /teacher/tariffs) — TeacherCabinetNav in the layout supersedes it.
  - REMOVE the inline Google Calendar status row (lines 56,132,164) — the new TeacherCabinetNav's Календарь button surfaces the ●/○ connection-state dot in its label (Q11 closure).
  - KEEP the conflict / hidden-slot banners at the top — those are urgent action surfaces, not nav.

Tests:
- `tests/integration/teacher-cabinet-polish/cabinet-nav.test.tsx` — RTL renders the nav with the right hrefs; pathname='/teacher' makes Календарь active; pathname='/teacher/learners' makes Ученики active.

### Sub-PR C — profile tariff card (TASK-2)

Files:
- `app/teacher/profile/page.tsx` (NEW) — SSR page. Auth gate: the layout already enforces teacher role. Reads:
  - `teacher_subscriptions` (current plan_slug + state) — `null` row falls back to `'free'` for display.
  - `teacher_subscription_plans` (all 4 rows for the comparison grid).
  - `account_profiles` (for the embedded ProfileEditor — re-use).
- `components/teacher/tariff-comparison-card.tsx` (NEW) — server component: renders 4 plan cards side-by-side. The current plan gets a "● Текущий тариф" badge. Each card has a `Сменить тариф` button that is **DISABLED** and tooltipped (open Q-4) "Скоро / Свяжитесь с оператором".
- `app/cabinet/profile-editor.tsx` — reuse AS-IS in Sub-PR C; Sub-PR F is where it grows firstName/lastName fields.

Tests:
- `tests/integration/teacher-cabinet-polish/profile-tariff-card.test.tsx` — render with subscription state `free` / `mid` / `pro` / `operator-managed`; assert the right card has the current-plan badge; assert all 4 `Сменить тариф` buttons are disabled.

### Sub-PR D — daily digest tile on `/teacher` dashboard (TASK-3)

Files:
- `lib/notifications/teacher-digest-preview.ts` (NEW) — pure read helper. **Same SQL predicate as the cron** at `scripts/teacher-daily-digest.mjs:196`: `start_at >= today_local_00:00 AT TIME ZONE teacher_tz AND start_at < tomorrow_local_00:00 AT TIME ZONE teacher_tz` (teacher's local calendar day, NOT rolling 24h — round-2 BLOCKER #2 closure). Returns `{ slots: Array<{ startAt, learnerEmail, learnerName, ... }>, todayLocalYmd: string }`.
- `scripts/teacher-daily-digest.mjs` — refactor: the per-teacher slot-fetch query body is the same SQL; the cron script keeps its own copy (mjs vs ts boundary) but the SQL is consciously aligned 1:1 with the lib helper. Document the duplication intent in a header comment so a future refactor doesn't drift them silently.
- `app/teacher/page.tsx` — render `<DigestPreviewTile slots={await getTeacherDigestPreview(...)} todayLocalYmd={...} />` near the top of the page (after banners, before the calendar header).
- `components/teacher/digest-preview-tile.tsx` (NEW) — server-rendered tile: empty state "На сегодня уроков нет", 1-N rows with time + learner-name + (if present) join-link. Header shows the teacher's local date (`todayLocalYmd`). Link "Открыть настройки дайджеста →" goes to `/teacher/settings/digest`.

Tests:
- `tests/integration/teacher-cabinet-polish/digest-preview-tile.test.ts` — call `getTeacherDigestPreview` against a seeded teacher with **3 booked slots inside teacher's local "today"** (start_at within [today_local_00:00, tomorrow_local_00:00) at teacher_tz); assert the 3 rows come back in `start_at` ascending order.
- `tests/integration/teacher-cabinet-polish/digest-preview-tile-empty.test.ts` — same, empty result (zero booked slots in today_local) → tile renders empty state.
- `tests/integration/teacher-cabinet-polish/digest-preview-cron-parity.test.ts` (round-2 BLOCKER #2 closure) — seed a teacher with slots straddling the today_local boundary (one slot at today_local 23:30 MSK, one at tomorrow_local 00:30 MSK); assert `getTeacherDigestPreview` returns ONLY the today_local 23:30 slot (excludes tomorrow). Same fixture asserts the cron's per-teacher SELECT returns the same single row → cron + preview parity.

### Sub-PR E — learners list page (TASK-4)

Files:
- `app/teacher/learners/page.tsx` (NEW) — SSR list. Calls `listLearnersForTeacher(session.account.id)`; renders a table with columns `Имя` / `Email` / `Назначен` / `Будущих` / `Проведено` / `Отменено` / `Не пришёл`. Each row's name is a `<Link href="/teacher/learners/${id}">…</Link>` to the existing drill-down.
- Sort: **`is_assigned DESC, (upcoming_count + completed_count) DESC, email ASC`** — the EXACT order `listLearnersForTeacher` returns per `lib/scheduling/teacher-learners.ts:88-90` (round-5 BLOCKER #2 closure: helper computes activity from `(upcoming + completed)` aggregates, NOT a `last_activity_at` column which doesn't exist).
- No new helper; reuse `listLearnersForTeacher`.

Tests:
- `tests/integration/teacher-cabinet-polish/learners-list.test.ts` — seed a teacher with 3 linked learners + 1 historical-only learner; assert all 4 rows; assert ordering rule; assert each row links to `/teacher/learners/<uuid>`.

### Sub-PR F — firstName / lastName sweep (TASK-5)

Largest sub-PR. Split into 4 stacked commits inside the same PR for reviewability:

1. **mig 0095 + helpers.** Mig file + `lib/auth/profile-name.ts` (`formatProfileNameForRender({ firstName, lastName, displayName, fallbackEmail })` (read) + `computeDisplayNameForStorage({ firstName, lastName })` (write, NULL on empty) + `splitDisplayName(displayName)`).
2. **profile reader + writer plumbing.** `lib/auth/profiles.ts` returns `firstName` / `lastName` on the AccountProfile type; PATCH `/api/account/profile` accepts them, recomputes `display_name` server-side via `computeDisplayNameForStorage(...)` (NULL on empty).
3. **UI forms.**
   - `app/cabinet/profile-editor.tsx` — replace `Имя` field with two inputs (Имя + Фамилия). Submit sends both.
   - `app/teacher/learners/[id]/rename-form.tsx` — same split.
   - `app/api/teacher/learners/[id]/rename/route.ts` + `lib/auth/teacher-learner-mutations.ts` — accept `firstName` + `lastName`; recompute display_name in the same TX.
   - `app/register/page.tsx` — add two optional fields (Имя + Фамилия) above email; submit forwards them.
   - `app/api/auth/register/route.ts` — accept the optional first/last; UPSERT into `account_profiles` in the post-create hook (today the cabinet PATCH is the first profile-row creation; if user provides name at register, we land it eagerly).
4. **Read-site sweep.** Every `display_name` UI surface gets the formatter:
   - `app/teacher/page.tsx` — N/A, no name surfaced
   - `app/teacher/learners/[id]/page.tsx` — name title at the top
   - `app/cabinet/profile-editor.tsx` — placeholder + initial
   - `app/admin/(gated)/accounts/[id]/page.tsx` — admin learner view
   - `app/admin/(gated)/teachers/[id]/page.tsx` — admin teacher view
   - `lib/email/templates/teacher-daily-digest.ts` — greeting "Здравствуйте, {name}"
   - `lib/notifications/teacher-digest-telegram-template.ts` — same
   - `lib/email/templates/learner-lesson-reminder.ts` — learner greeting
   - Plus any helper referenced via the `grep -rn "display_name\|displayName"` survey at sweep time (sweep script: `grep -rn "display_name\|displayName" lib/ app/ scripts/ tests/`).

Tests:
- `tests/integration/teacher-cabinet-polish/mig-0095-backfill.test.ts` — seed `account_profiles` with `display_name` rows of various shapes (no space, one space, multi-word, NULL, empty); run the backfill UPDATE; assert split is correct.
- `tests/integration/teacher-cabinet-polish/profile-name-format.test.ts` — unit tests on `formatProfileNameForRender` AND `computeDisplayNameForStorage` for all branches.
- `tests/integration/teacher-cabinet-polish/profile-patch.test.ts` — PATCH `/api/account/profile` with `firstName` + `lastName`; assert returned profile + DB row both reflect the new values AND `display_name` is recomputed.
- `tests/integration/teacher-cabinet-polish/teacher-rename-learner-first-last.test.ts` — teacher renames a learner with `firstName` + `lastName`; same assertion.
- `tests/integration/teacher-cabinet-polish/register-with-name.test.ts` — register with `firstName: 'Иван', lastName: 'Петров'`; verify the post-create UPSERT lands an `account_profiles` row with `first_name='Иван'`, `last_name='Петров'`, `display_name='Иван Петров'`. Do NOT assert "same TX" (register flow is non-transactional per round-2 closure). Tolerate a brief window between `accounts` INSERT and `account_profiles` UPSERT: assert eventual consistency via a 50ms `await` if needed.

Trailer per sub-PR: `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-cabinet-polish); epic-end review pending`.

## 4. Edge cases / open questions

### Q1 — top-bar or sidebar nav?

Owner request says "menu button". The current `/teacher` SiteHeader is a thin app-wide header (search "components/site-header" — used in `/teacher/layout.tsx` line 60). The cabinet uses a `<AuthShell>` wrapper. Adding a SECOND header bar inside the teacher layout (below SiteHeader, above the main content) feels visually closest to the owner's screenshot intent. **Decision (Sub-PR B):** horizontal nav row injected at the top of the teacher layout, BELOW SiteHeader. Sidebar is rejected — would require a layout-grid refactor, and the owner asked for "buttons", not a full sidebar.

### Q2 — `display_name` back-compat lifetime

mig 0095 keeps `display_name` NULLABLE; Sub-PR F UI writes both first/last AND display_name (recomputed). The post-MVP epic that DROPs the column is OUT OF SCOPE for this polish wave. **Decision (Sub-PR F):** keep `display_name` writes in every PATCH path (recomputed via `computeDisplayNameForStorage`) so the column never goes stale. Drop is a follow-up sized at "one mig 0NNN + sweep" once the next release cycle is verified.

### Q3 — does `/teacher/settings/digest` exist?

YES — it lives at `app/teacher/settings/digest/page.tsx` (BCS-DEF-5-TG). Sub-PR D's tile "Открыть настройки дайджеста →" link points there.

### Q4 — disabled tariff button tooltip

**Decision (Sub-PR C):** show a hover tooltip "Скоро / Свяжитесь с оператором" via plain `title="..."` HTML attribute. No special component, no JS-driven popover.

### Q5 — what does the teacher "first lesson" look like for digest preview?

If a teacher has zero booked slots in their teacher-local "today" (the same predicate the cron uses — `start_at >= today_local_00:00 AND start_at < tomorrow_local_00:00` at the teacher's timezone), Sub-PR D's tile renders the empty state copy "На сегодня уроков нет". If timezone is NULL on the profile, default to `'Europe/Moscow'` (mirrors the cabinet ProfileEditor's `safeTimezone` default).

### Q6 — invite-flow registration

The invite-redeem flow forces `role=student`. Sub-PR F's register form changes (firstName/lastName fields) apply to BOTH the invite path AND the direct-register path. Validation: both fields optional, server normalises (trim, ≤60 char, both can be empty).

**Round-1 BLOCKER #3 closure:** if both empty → profile row gets `first_name=NULL`, `last_name=NULL`, `display_name=NULL` (NOT `''`). The existing CHECK `account_profiles_display_name_len` rejects empty strings (`char_length(display_name) between 1 and 60`); only NULL is valid for "no name yet". The reader `formatProfileNameForRender({...}, fallbackEmail)` coalesces NULL → email — same UX as today.

**Round-1/2 register contract — non-transactional + UPSERT-on-first-PATCH recovery.** `POST /api/auth/register` deliberately returns 409 on duplicate email AFTER `createAccount()` succeeds (`app/api/auth/register/route.ts:152,192`). Sub-PR F's "profile row created in the same TX" is NOT achievable without a `registerWithProfileAtomic` helper that's out of scope.

**Decision (round-2 BLOCKER #4 closure):**
- Register stays non-transactional. Sub-PR F adds a post-create UPSERT of `account_profiles(account_id, first_name, last_name, display_name)` immediately after `createAccount`. Failure here is BEST-EFFORT (log + continue with 200); the account row exists, the formatter coalesces NULL → email so UX is unaffected.
- Recovery: there is NO `getOrCreateAccountProfile` lazy-create on login. Instead, the existing `account_profiles` UPSERT in `lib/auth/profiles.ts:upsertAccountProfile` (called on first PATCH) is the canonical recovery — first time the user opens `/cabinet` and saves their profile, the row appears.
- The 1-tick window where an `accounts` row exists without an `account_profiles` row is acceptable because EVERY render path uses `formatProfileNameForRender({ ..., fallbackEmail })` with the email fallback.

**Test contract for Sub-PR F:** assert post-register that EITHER an `account_profiles` row exists OR (`accounts` row exists AND email-fallback render works). Do NOT assert "same TX" — that contract was explicitly weakened in round 1.

### Q7 — backfill split for non-Latin display names

mig 0095 uses `trim()` + `position(' ' in ...)` for the split. This is unicode-safe in Postgres 16. Cyrillic names with a single space like "Иван Петров" split correctly. Names containing multiple spaces (rare, but possible — "Анна-Мария Иванова" with hyphen and space) put everything after the FIRST space into last_name → "Иванова". That's acceptable: the user can edit the form later. Document this in the mig header comment.

### Q8 — what if a teacher's calendar text fix breaks the OAuth flow?

Sub-PR A only touches the `configError` / `!configReady` branches. The `configReady === true` branch (real OAuth flow) is UNCHANGED. The connect button still POSTs to `/api/teacher/calendar/google/start`. If env vars are flipped on later, the page re-renders without code change — the configError fallback was a load-bearing UX warning, not load-bearing logic.

### Q9 — should Sub-PR F update digest email greetings IN-LINE or skip them for a follow-up?

In-line. The whole point of TASK-5 is "no more single display_name field". A follow-up that touches the email templates separately would leave the digest greeting using the stale `display_name` value, and that's exactly the regression we're avoiding. Tests (`tests/email/teacher-daily-digest.test.ts`) need to be updated to expect the new format.

### Q10 — Round-1 BLOCKER #4 closure: purge sweep must scrub first_name/last_name

`scripts/db-retention-cleanup.mjs:231` `purgeAccounts` currently nullifies `display_name`, `timezone`, `locale` (152-FZ erasure). Sub-PR F MUST extend the SQL to also `UPDATE account_profiles SET first_name = NULL, last_name = NULL WHERE account_id = $1`. Test `tests/integration/retention-cleanup.test.ts` (or whichever pins the purge sweep) MUST add an assertion that post-purge both new columns are NULL. Without this, post-purge PII remains in the DB — 152-FZ erasure violation.

### Q11 — Round-1 WARN #6 closure: TASK-1 must preserve calendar status discoverability

`app/teacher/page.tsx:56,132,164` renders an always-visible Google Calendar status row (connected/not-connected badge + CTA → `/teacher/settings/calendar`). The owner-requested cabinet nav (TASK-1) MUST keep this status surface visible — re-render the badge inside the new nav's Календарь button label. **Decision (Sub-PR B, round-5 BLOCKER #1 final):** the new top nav uses dot-icons next to each button (●/○) where the dot reflects connection state for the calendar item. The inline row on `/teacher` is REMOVED in the same Sub-PR B commit (no one-release-cycle deferral — keeping both surfaces would split the status truth and confuse users).

### Q12 — Round-1 WARN #7 closure: TASK-4 helper sort + leakage tests

`lib/scheduling/teacher-learners.ts:88-90` `listLearnersForTeacher` sorts by **`is_assigned DESC, (upcoming_count + completed_count) DESC, email ASC`**. **Decision (Sub-PR E):** REUSE the helper without changing its sort. The teacher's "Ученики" surface gets the same sort as the cabinet's learners section already shows.

Integration tests for Sub-PR E MUST include three negative cases (Round-1 WARN #7 closure): (a) teacher A cannot see teacher B's learners; (b) admin attempting `/teacher/learners/[id]` with someone else's learner gets 404 (NOT info-leak); (c) attempting to GET `/teacher/learners/[someAdminAccountId]` gets 404 — archetype check rejects non-learner targets.

### Q10 — what about cron + script paths reading display_name?

`scripts/teacher-daily-digest.mjs` reads `account_profiles.display_name` (for the greeting). After Sub-PR F: read `first_name`, `last_name`, `display_name`; compute via the formatter (replicated as a mjs helper in `scripts/lib/profile-name.mjs`). Identical logic in both lib and scripts because the cron is a separate Node entry point.

## 5. Day-by-day sequence

Sequencing assumes Claude is a solo worker; if parallelised across sub-agents, Days 1+2 can be one calendar day.

- **Day 1** — Sub-PR A (calendar text) + Sub-PR B (nav menu). Both 1-file-ish changes plus a small new component.
- **Day 2** — Sub-PR C (tariff card on `/teacher/profile`) + Sub-PR D (digest tile + helper extraction).
- **Day 3** — Sub-PR E (learners list page).
- **Day 4** — Sub-PR F commits 1+2 (mig 0095, profile-name helpers, PATCH /api/account/profile, profiles.ts).
- **Day 5** — Sub-PR F commits 3+4 (UI form sweep + read-site sweep) + epic-close PR after `/codex-paranoia wave`.

If `/codex-paranoia wave` surfaces a BLOCKER, the fix lands as a follow-up PR (shifted-right per the global epic-end model) — not blocking close of the main 6.

## 6. Risks

### R1 — firstName/lastName sweep misses a read site

**Mitigation:** Sub-PR F commit 4 explicitly runs the grep sweep at sweep-time (not at plan-time — code can move). Tests asserting the formatted name appears in email body / digest body cover the high-traffic emails. CI typecheck catches missing `formatProfileNameForRender`/`computeDisplayNameForStorage` imports if the AccountProfile type adds `firstName` / `lastName` as REQUIRED fields (we keep them optional via `?:` to avoid this break, but the type-safe call sites still get the change).

### R2 — calendar text fix freezes UX after env-vars activation

**Mitigation:** Sub-PR A only swaps copy inside the `configError` / `!configReady` branches. As soon as ops sets all 4 GOOGLE_CALENDAR_* env vars in prod, `getGoogleCalendarOauthConfig()` returns a non-null `GoogleCalendarOauthConfig`, `configReady` flips to `true`, the page renders the connect button branch automatically — no second deploy needed. The neutral "Скоро будет" tile is wired EXCLUSIVELY to the `!configReady` / `configError` paths.

### R3 — mig 0095 backfill races with a live PATCH /api/account/profile during deploy

**Mitigation:** mig 0095 runs INSIDE the autodeploy migration step BEFORE the new Next.js bundle is hot. Old bundle does NOT know about `first_name` / `last_name` columns, so it only writes `display_name`. Backfill UPDATE has the `where first_name is null and last_name is null` guard. New bundle (post-migration) writes all three fields. The brief window where an old-bundle PATCH writes `display_name` only is fine — the backfill UPDATE in the same migration is one-shot and won't fire again. If a teacher's display_name changes between migration apply and bundle hot-swap, their first_name+last_name remain NULL — the cabinet formatter falls back to display_name correctly.

### R4 — tariff card surfaces a plan-flip path that doesn't exist

**Mitigation:** Sub-PR C explicitly disables the buttons. Hover tooltip explains "Скоро / Свяжитесь с оператором". E2E test asserts disabled state. If an owner clicks the operator-managed plan card, they get the disabled button + tooltip — no surprise route attempt.

### R5 — digest preview tile uses a query that drifts from the cron script

**Mitigation:** Sub-PR D's `lib/notifications/teacher-digest-preview.ts` and `scripts/teacher-daily-digest.mjs` share the same SQL conceptually but are physically separate (ts vs mjs). Header comments in both files reference each other explicitly. A future refactor PR can lift the SQL into a shared `.sql` file or migrate the cron to ts; that's out of scope here. Tests in Sub-PR D's `digest-preview-tile.test.ts` assert the same row set the cron would have emailed (same teacher, same window, same status filters).

### R6 — top-bar nav collides with `<SiteHeader>` already in `app/teacher/layout.tsx`

**Mitigation:** the `<TeacherCabinetNav>` is rendered BELOW SiteHeader, inside the `<main>` wrapper or as a sticky-below-header strip. RTL test asserts both render in document order. No padding / position collision.

### R7 — register page firstName/lastName fields create cross-tenant collisions

There's no uniqueness constraint on first_name / last_name (both NULLABLE TEXT). Nothing to collide. The accounts.email UNIQUE constraint stays.

## 7. Trailer expectations

Per CLAUDE.md global rules:

- Each sub-PR (A through F): `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-cabinet-polish); epic-end review pending`.
- Epic-close PR (after `/codex-paranoia wave <commit-range>` SIGN-OFF): `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`.
- Legal-pipeline trailer is NOT required (this epic touches no legal-paths).

Sub-PR PR titles:
- `feat(teacher-cabinet): fix calendar settings copy to neutral coming-soon (TASK-6, sub-PR A)`
- `feat(teacher-cabinet): add cabinet nav menu (TASK-1, sub-PR B)`
- `feat(teacher-cabinet): /teacher/profile + tariff card (TASK-2, sub-PR C)`
- `feat(teacher-cabinet): daily-digest preview tile on /teacher (TASK-3, sub-PR D)`
- `feat(teacher-cabinet): /teacher/learners list page (TASK-4, sub-PR E)`
- `feat(teacher-cabinet): firstName + lastName across profiles + UI (TASK-5, sub-PR F, mig 0095)`

Epic-close: `feat(teacher-cabinet-polish): epic-close (paranoia SIGN-OFF + summary)`.

## 8. Test plan

Every sub-PR runs the full integration suite green. Specific assertions per sub-PR are listed in §3. Acceptance threshold: PASS on `npm run test:integration` + `npm run build` + `npm run typecheck` before merge.

Manual smoke per sub-PR:
- A: `/teacher/settings/calendar` on prod-mirror DB (env vars absent) → see "Скоро будет" tile.
- B: navigate every `/teacher/*` route → cabinet nav visible, active button highlighted correctly.
- C: `/teacher/profile` renders the comparison card with all 4 plans; current plan badged; buttons disabled.
- D: `/teacher` main page shows the digest tile with today's lessons (or empty state).
- E: `/teacher/learners` lists all linked learners; row click lands on existing drill-down.
- F: register with first+last → on success page render, the account row exists; the profile row appears via post-create UPSERT (best-effort). If the UPSERT failed (rare; logged), opening `/cabinet` and saving the profile lazily creates the row via `upsertAccountProfile`. NO same-TX guarantee.
