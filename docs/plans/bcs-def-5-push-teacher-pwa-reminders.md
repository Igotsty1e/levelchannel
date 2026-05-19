# BCS-DEF-5-PUSH — PWA push channel for teacher lesson-start reminders

**Status:** DRAFT 2026-05-18 (plan-doc only; awaiting `/codex-paranoia plan`).
**Wave name:** `bcs-def-5-push-teacher-pwa-reminders` (sub-PR within BCS-DEF-5 epic — see §5).
**Trigger:** Push channel deferred from BCS-DEF-5 MVP and from BCS-DEF-4-PUSH §10 ("BCS-DEF-5-PUSH — Teacher push reminders. Sibling plan; mirrors with `teacher_push_subscriptions` + parallel cabinet-teacher UI.").
**Author:** Claude (autonomous).
**Channel:** Browser Web Push (PWA, via `web-push` Node lib + VAPID — **shared keypair with BCS-DEF-4-PUSH**).

> **READ FIRST: `docs/plans/bcs-def-4-push-pwa-reminders.md`.** This document is a DELTA on top of that plan. Sections marked **[INHERIT]** carry the exact contract from BCS-DEF-4-PUSH. Sections marked **[DELTA]** capture only the differences. Anything not listed here is unchanged from BCS-DEF-4-PUSH.

---

## 0. Cross-refs

- **`docs/plans/bcs-def-4-push-pwa-reminders.md`** — sibling plan (learner push). **This plan reuses**: VAPID keypair, env contract, `web-push` lib wrapper, `public/sw.js` service worker, `public/manifest.webmanifest`, `app/layout.tsx` head additions, scheduler per-channel branch pattern. **This plan diverges**: audience-specific subscription table, audience-specific API routes, teacher cabinet UI, admin row, notification copy. **Dispatch ordering** see §6 RISK-1.
- **`docs/plans/bcs-def-5-teacher-reminders.md`** — parent BCS-DEF-5 epic plan (DRAFT 2026-05-18). Reserves `teacher_reminder_dispatches.channel` for `'push'` (mirroring BCS-DEF-4's CHECK extension precedent); §10 defers push explicitly. **This sub-PR fits inside that epic** under sub-PR slot G (after the renamed `lesson-reminders` probe lands in F).
- **`docs/plans/bcs-def-5-tg-telegram-reminders.md`** — sibling teacher Telegram channel plan (NOT YET DRAFTED as of 2026-05-18). Will share `teacher_reminder_dispatches.channel` CHECK with this plan. Same migration-ordering coordination as BCS-DEF-4-TG ↔ BCS-DEF-4-PUSH (see §6 RISK-3).
- **`docs/plans/bcs-def-4-tg-telegram-reminders.md`** — sibling learner Telegram plan (in flight as PR #347). Reference for the binding/dispatch pattern and the per-channel scheduler iteration that this plan extends.

---

## 1. Goal — DELTA from BCS-DEF-4-PUSH

Add Web Push as a delivery channel for the **unified `lesson-reminders` scheduler's teacher branch** (the union probe that BCS-DEF-5 §1.2 introduces by renaming `learner-reminders` → `lesson-reminders`). When a teacher has opted-in AND a Push subscription has been registered for their account, the scheduler dispatches each due teacher reminder via **all enabled teacher channels** (email + push, plus telegram if that PR has landed).

**Audience swap** (the only conceptual diff): every reference to "learner" in BCS-DEF-4-PUSH becomes "teacher":
- Audience join: `lesson_slots.teacher_account_id` (not `learner_account_id`).
- Subscription table: `teacher_push_subscriptions` (not `learner_push_subscriptions`).
- Master switch: `TEACHER_PUSH_ENABLED` (not `LEARNER_PUSH_ENABLED`).
- API routes: `/api/teacher/push/*` (not `/api/push/*`).
- Cabinet page: `/teacher/settings/reminders` (NEW page; not extension of existing).
- Admin row: "Push канал (преподаватели)" beneath the BCS-DEF-4-PUSH learner row on `/admin/settings/reminders`.
- Auth guard: `requireTeacherAndVerified` (`lib/auth/guards.ts:164`) — admin-precedence rejected at 403, matching teacher API precedent.
- Notification copy: teacher-facing (focus on imminent lesson + zoom-link reminder).

**Hard requirements:** identical to BCS-DEF-4-PUSH §1 (idempotent per `(slot_id, offset_minutes, channel)`, soft-skip on missing subscription, auto-unsubscribe on 410/404, multi-device per teacher). **[INHERIT]**

**Out of scope:** see §10.

---

## 1.1 Existing surface inventory **[DELTA]**

Cited against `main` HEAD as of 2026-05-18.

### Parent surface (BCS-DEF-5)

- **`migrations/0020_lesson_slots.sql:36`** — `teacher_account_id uuid not null` — join key for "who gets this teacher push".
- **Teacher dispatch queue** — `teacher_reminder_dispatches` (planned in BCS-DEF-5 §1.2 / §2.1, migration ordinal TBD by epic). `channel text not null check (channel in ('email'))` initially; this plan extends to include `'push'`.
- **Teacher preferences** — `teacher_reminder_preferences` (BCS-DEF-5 §1.6). NO new column needed; subscription existence acts as implicit opt-in (mirrors BCS-DEF-4-PUSH §1.1).
- **Scheduler** — `scripts/lesson-reminder-dispatch.mjs` (renamed in BCS-DEF-5 sub-PR F). Extended with teacher-branch `channel === 'push'` per-row handler.
- **`lib/admin/operator-settings.ts`** — adds 1 new key `TEACHER_PUSH_ENABLED` with `scope: 'lesson-reminders'` (parity with the renamed scope from BCS-DEF-5 §1.4).
- **`app/admin/(gated)/settings/reminders/page.tsx`** — adds a second "Push канал (преподаватели)" row below BCS-DEF-4-PUSH's learner row.
- **`app/teacher/settings/reminders/page.tsx`** — **NEW page** (`/teacher/settings/` currently only contains `calendar/`; verified via `ls app/teacher/settings/`). Renders the teacher-equivalent of `/cabinet/settings/reminders` (audience-scoped to `requireTeacherAndVerified`). The "Push-уведомления" section is one part of that new page — the page itself is a BCS-DEF-5 deliverable; this sub-PR adds the push section *within* it (or, if BCS-DEF-5 has already merged the page in sub-PR E, this sub-PR only extends it).

### Shared surface — already exists from BCS-DEF-4-PUSH

The following are **inherited as-is** from BCS-DEF-4-PUSH and NOT duplicated:
- **VAPID keypair** — single `PUSH_VAPID_*` env triple (see §2.1).
- **`public/sw.js`** — same service worker file; extended to dispatch on `payload.audience` discriminant (§2.2).
- **`public/manifest.webmanifest`** — unchanged.
- **`app/layout.tsx`** — `<link rel="manifest">` + `<meta name="theme-color">` already added by BCS-DEF-4-PUSH.
- **`lib/notifications/web-push-wrapper.ts`** — same `sendWebPush()` wrapper.
- **`GET /api/push/vapid-public-key`** — same route; teachers fetch from the same endpoint (the public key is identical for both audiences — it's per-deployment).

### NEW surface — teacher-specific

- **`migrations/00XX_teacher_push_subscriptions.sql`** — parallel table to `learner_push_subscriptions` (§2.3).
- **`migrations/00XX_teacher_reminder_dispatches_push_channel.sql`** — CHECK extension for `teacher_reminder_dispatches.channel` (§2.5).
- **`app/api/teacher/push/subscribe/route.ts`** — teacher-scoped subscribe.
- **`app/api/teacher/push/unsubscribe/route.ts`** — teacher-scoped unsubscribe.
- **`lib/notifications/teacher-push-templates.ts`** — teacher-facing copy (§2.4).
- **`app/teacher/settings/reminders/push-subscribe-button.tsx`** — client component (audience-scoped variant of the learner one; same shape).

---

## 1.2 Critical-path inventory **[DELTA]**

Per `docs/critical-path.md`:
- **`lib/admin/operator-settings.ts`** — on critical path. 1 new key (additive).
- **`scripts/lesson-reminder-dispatch.mjs`** — NOT on critical path.
- **`app/teacher/settings/reminders/page.tsx`** — NEW page; not yet on critical path (no production traffic until BCS-DEF-5 sub-PR E lands).
- **`public/sw.js`** — modified (audience-discriminant branch added). The SW is shared infrastructure; touched here must coordinate with BCS-DEF-4-PUSH (§6 RISK-1).
- **`app/layout.tsx`** — **NOT touched** here (already covered by BCS-DEF-4-PUSH).

---

## 2. Design — deltas only

### 2.1 VAPID — shared keypair, no new env **[INHERIT]**

**Single deployment-wide VAPID keypair.** Teacher subscriptions are signed with the **same** `PUSH_VAPID_PUBLIC_KEY` / `PUSH_VAPID_PRIVATE_KEY` / `PUSH_VAPID_SUBJECT` as learner subscriptions. Rationale:

- VAPID identifies the **application** (LevelChannel) to push services — not the audience. A teacher's Chrome and a learner's Chrome talk to the same FCM endpoint; the same `applicationServerKey` works for both.
- Avoids operator burden of managing two keypairs.
- No security drift — there is exactly one "LevelChannel push identity".
- `/api/push/vapid-public-key` (BCS-DEF-4-PUSH §2.4) is reused as-is. Teacher cabinet's subscribe button fetches the same key.

**No new env vars introduced.** Operator activates teacher push by flipping `TEACHER_PUSH_ENABLED=1` (no extra VAPID generation step required, provided BCS-DEF-4-PUSH has already shipped and VAPID env is set).

### 2.2 Service worker — audience discriminant **[DELTA]**

`public/sw.js` is **shared between learner and teacher push** (a SW is a singleton per origin/scope — there can't be two). The push payload gains an `audience: 'learner' | 'teacher'` field; the SW reads it only for the **click-routing fallback** (which existing tab to focus when no `url`-matching tab is found).

**Delta against BCS-DEF-4-PUSH §2.5 sketch** (only the changed lines):

```js
// inside push handler — destructure the new field:
const { title, body, url, tag, audience } = payload
// inside showNotification options.data:
data: { url: url || 'https://levelchannel.ru/', audience },

// inside notificationclick handler — pick fallback hint by audience:
const audienceHint = data.audience === 'teacher' ? '/teacher' : '/cabinet'
// then prefer windows whose URL includes audienceHint, fall back to payload `url`.
```

**`url` field remains the source of truth** for the click target (server-built per audience: `/cabinet` for learner, `/teacher` for teacher). `audience` is the secondary hint used only when no existing tab matches. SW renders the notification identically regardless of audience — no audience-specific icon / sound.

**Coordination with BCS-DEF-4-PUSH:** if this PR ships AFTER (Scenario A in §6 RISK-1), the SW upgrades from learner-only to audience-aware; `skipWaiting()` + `clients.claim()` (already in BCS-DEF-4-PUSH §2.5) force activation on next page load. If BEFORE, the SW is audience-aware from day one — BCS-DEF-4-PUSH then ships only its non-SW surface.

### 2.3 Subscription per teacher — `teacher_push_subscriptions` **[DELTA]**

Parallel to `learner_push_subscriptions` (BCS-DEF-4-PUSH §2.3). Same column shape; only the table name + FK target differ.

```sql
-- BCS-DEF-5-PUSH — per-teacher per-device Web Push subscriptions.
-- Parallel to learner_push_subscriptions; identical column shape.
-- Plan: docs/plans/bcs-def-5-push-teacher-pwa-reminders.md §2.3.
create table if not exists teacher_push_subscriptions (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  endpoint text not null,
  p256dh_key text not null,
  auth_key text not null,
  user_agent text null,
  subscribed_at timestamptz not null default now(),
  last_succeeded_at timestamptz null,
  unsubscribed_at timestamptz null,
  unsubscribe_reason text null
    check (unsubscribe_reason is null or unsubscribe_reason in (
      'user_revoked', 'endpoint_gone_410', 'endpoint_not_found_404',
      'payload_too_large', 'admin_revoked', 'vapid_rotated')),
  constraint tps_keys_format check (
    length(p256dh_key) between 80 and 100
    and length(auth_key) between 20 and 30
    and length(endpoint) between 16 and 1024)
);
create index if not exists tps_active_by_account_idx
  on teacher_push_subscriptions (account_id) where unsubscribed_at is null;
create unique index if not exists tps_one_active_per_endpoint_idx
  on teacher_push_subscriptions (account_id, endpoint) where unsubscribed_at is null;
```

Cross-table endpoint collisions accepted (a person with both teacher AND separate learner accounts has two `account_id`s → two rows in different tables; admin+teacher hybrids excluded by `requireTeacherAndVerified` admin-precedence).

**Why a parallel table vs single `push_subscriptions` + `audience` column:** same reasoning as BCS-DEF-5 §1.2 axis 1 — keeps audience-specific schema room and keeps auth-scoped reasoning trivial (`requireTeacherAndVerified` writes only this table). Duplication is purely at the storage layer; send shape is identical.

### 2.4 Notification copy — teacher-facing **[DELTA]**

Teacher-facing copy (medium vocabulary per `docs/content-style.md:53`):

**60 / 30 / 10 / 5 min offsets** (5-min is teacher-default per BCS-DEF-5 §1.6):

```
title: "Через ~5 мин — занятие с учеником"
body:  "Сегодня 17:00 • 60 мин\nСсылка: meet.google.com/xxx\nОткрыть: /teacher"
url:   "https://levelchannel.ru/teacher"
tag:   "lc-reminder-teacher-<slotUuid8>-<offsetMinutes>"
audience: "teacher"
```

**Differences from learner copy** (BCS-DEF-4-PUSH §2.7):
- Title focuses on the *teacher's commitment* ("занятие с учеником"), not the learner's lesson.
- The body **emphasises the zoom link** because teachers are the link-owners (they set `lesson_slots.zoom_url`); the reminder is "your link is X — open in N min".
- `url` deep-links to `/teacher` (the teacher's full-week calendar — per BCS-DEF-5 §1.1).
- `tag` carries the audience discriminant `teacher` to prevent collapsing a teacher reminder onto a learner reminder if the same browser somehow received both (rare, but defensive).
- `audience: "teacher"` payload field consumed by the SW (§2.2).

No teacher PII; no learner identification (preserves BCS-DEF-4-PUSH §4.4 privacy boundary applied in reverse — a teacher reminder doesn't leak which specific learner the slot is with).

`lib/notifications/teacher-push-templates.ts` exports `buildTeacherReminderPushPayload({offsetMinutes, slot})` mirroring the learner builder.

### 2.5 Scheduler dispatch — teacher branch **[DELTA]**

`scripts/lesson-reminder-dispatch.mjs` (renamed union probe per BCS-DEF-5 §1.2) gains a per-row branch for `row.audience === 'teacher' && row.channel === 'push'`: SELECT active rows from `teacher_push_subscriptions WHERE account_id = $1`, then run the **identical fan-out + send + per-endpoint 410/404 auto-unsub logic** as BCS-DEF-4-PUSH §2.7 (learner) — only the source table name changes.

**Reconcile-enqueue extension** mirrors BCS-DEF-4-PUSH §2.7.1: `CROSS JOIN LATERAL (SELECT unnest(array_remove(array['email', ...telegram-conditional..., ...push-conditional...], NULL)))` — with `EXISTS (SELECT 1 FROM teacher_push_subscriptions tps WHERE tps.account_id = s.teacher_account_id AND tps.unsubscribed_at IS NULL)` gated on `TEACHER_PUSH_ENABLED`.

**CHECK extension** for `teacher_reminder_dispatches.channel`:
- `channel CHECK in ('email', 'telegram', 'push')` (drop + re-add idempotently).
- `skipped_reason CHECK` adds `'no_push_subscription'` to existing teacher-side allowlist.

If BCS-DEF-5-TG hasn't landed, channel set is `('email', 'push')` and skipped_reason omits telegram values — see §6 RISK-3.

### 2.6 Teacher cabinet UI — `/teacher/settings/reminders` push section **[DELTA]**

Same audience-driven UI matrix as BCS-DEF-4-PUSH §2.9 (browser permission states × server subscription state × master switch). Differences:

- **Auth guard:** page-level `requireTeacherAndVerified` (admin-precedence rejected at route).
- **Page layout:** the page already lives under `/teacher/settings/` (created by BCS-DEF-5 sub-PR E); this sub-PR adds the "Push-уведомления" section beneath the email-prefs section.
- **Per-device list copy:** "Push включены: Chrome on macOS • last delivered 2h ago" — same as learner, teacher-scoped.
- **`<TeacherPushSubscribeButton>`** client component — calls `/api/teacher/push/subscribe` (audience-scoped route).
- **VAPID public key fetch:** reuses the same `GET /api/push/vapid-public-key` (public, audience-agnostic). Inlined server-side same as learner page.

### 2.7 Admin row — `/admin/settings/reminders` extension **[DELTA]**

NEW row "Push канал (преподаватели)" beneath the existing learner Push row from BCS-DEF-4-PUSH §2.10:
- Master switch — `TEACHER_PUSH_ENABLED`.
- **VAPID env presence indicators are NOT duplicated** — only one set of indicators exists for the shared keypair (rendered once in the learner row; teacher row references "VAPID env: см. строку выше").
- Active teacher-subscriptions count.
- Recent teacher unsubscribes (last 24h) split by reason.
- Recent teacher failures (last 1h).

---

## 3. Tests — deltas only

Mirrors BCS-DEF-4-PUSH §3 with `teacher_push_subscriptions` + `teacher` audience as the audience-scoped variant. Files (additive):

- `tests/notifications/teacher-reminder-push.test.ts` — payload builder; teacher-specific copy; `audience='teacher'` field; tag pattern `lc-reminder-teacher-<slot8>-<offset>`.
- `tests/integration/api/teacher-push-subscribe.test.ts` — auth scopes (401 unauth / 403 learner / 403 admin / 200 teacher); rate-limit; idempotent re-subscribe; reactivation.
- `tests/integration/api/teacher-push-unsubscribe.test.ts` — same shape as learner; cross-audience scope check (learner endpoint cannot be unsubscribed via teacher route).
- `tests/integration/scripts/lesson-reminder-dispatch-teacher-push.test.ts` — scheduler teacher-push branch: enabled + 1 sub → sent; 410 → unsub; transient → retry; both teacher AND learner push rows in same tick → both dispatched.
- `tests/integration/teacher/reminder-push-section.test.ts` — SSR-only UI tests (master switch off/on; subscription list).
- `tests/integration/admin/reminders-teacher-push-row.test.ts` — admin row visibility; master flip; VAPID presence shown only once (regression-pin for de-dup).
- `tests/integration/admin/teacher-push-migrations.test.ts` — migration apply clean; `channel='push'` ok; `channel='sms'` fails.
- **NEW (cross-audience SW regression-pin):** `tests/public/sw-audience.test.ts` — `push` event with `audience='teacher'` payload → notification rendered; `notificationclick` → existing `/teacher` window focused if present, else `/cabinet`; existing learner test (BCS-DEF-4-PUSH §3.8) still passes.

**VAPID endpoint tests (BCS-DEF-4-PUSH §3.2) NOT duplicated** — the endpoint is audience-agnostic and was covered by BCS-DEF-4-PUSH.

---

## 4. Security analysis — deltas only

All BCS-DEF-4-PUSH §4 mitigations apply identically. **Audience-specific additions:**

- **§4.1 / §4.5 cross-audience scope check** — `/api/teacher/push/subscribe` MUST reject learner / admin sessions; the existing teacher-scoped auth helper `requireTeacherAndVerified` (`lib/auth/guards.ts:164`) explicitly rejects `admin+teacher` hybrids (admin-precedence). Pinned by §3 integration tests.
- **Endpoint-row leakage across audiences** — a hostile teacher cannot list learner endpoints (separate table; auth-scoped reads only). Conversely a hostile learner cannot enumerate teacher endpoints. No shared read path.
- **VAPID key compromise blast radius** — increased: a compromised private key now permits push spam to BOTH audiences. **Mitigation:** unchanged (operator-side env-file 0640 root:levelchannel; rotation invalidates all subscriptions across both audiences). Acceptable because the keypair is a singleton-per-app per VAPID design.
- **Notification content boundary** — teacher reminder does NOT leak the learner identity (only slot time + zoom URL); validates BCS-DEF-4-PUSH §4.4 in the reverse direction.

---

## 5. Decomposition — sub-PR within BCS-DEF-5 epic

**This plan is one sub-PR within the BCS-DEF-5 epic** — slot **G**, after sub-PRs E (`/teacher/settings/reminders` page) + F (probe rename to `lesson-reminders` + teacher dispatch table). Cannot ship standalone: depends on the unified `lesson-reminders` probe + `teacher_reminder_dispatches` table that E/F introduce. (BCS-DEF-4-PUSH is independent because the learner queue table predates the union rename.)

**Files (additive ~500 LOC):**
- Plan-doc (this file).
- `migrations/00XX_teacher_push_subscriptions.sql` (NEW).
- `migrations/00XX_teacher_reminder_dispatches_push_channel.sql` (NEW — CHECK ext).
- `app/api/teacher/push/{subscribe,unsubscribe}/route.ts` (NEW).
- `lib/notifications/teacher-push-templates.ts` (NEW).
- `app/teacher/settings/reminders/push-subscribe-button.tsx` (NEW client component).
- `app/teacher/settings/reminders/page.tsx` (modified — Push section).
- `app/admin/(gated)/settings/reminders/page.tsx` (modified — teacher Push row).
- `lib/admin/operator-settings.ts` + `scripts/lib/operator-settings.mjs` (modified — `TEACHER_PUSH_ENABLED` key).
- `scripts/lesson-reminder-dispatch.mjs` (modified — teacher push branch).
- `public/sw.js` (modified — audience discriminant §2.2).
- Test files per §3.
- `ENGINEERING_BACKLOG.md`, `docs/plans/bcs-def-5-teacher-reminders.md` (modified — strikethrough + cross-ref).

**Paranoia trailer:** `Codex-Paranoia: SUB-WAVE self-reviewed (epic bcs-def-5); epic-end review pending`. Plan-doc itself goes through `/codex-paranoia plan` if not already covered by the BCS-DEF-5 epic-level plan checkpoint.

---

## 6. Risks — deltas only

### RISK-1 — Service-worker collision if BCS-DEF-4-PUSH not yet shipped

**The audience-aware `public/sw.js` (§2.2) is the production version going forward.** Three scenarios:

| Scenario | Ordering | This plan ships |
|---|---|---|
| **A — BCS-DEF-4-PUSH lands first (RECOMMENDED).** | Learner push live; learner-only SW in `public/sw.js`. | This PR replaces SW with audience-aware variant. `skipWaiting()` + `clients.claim()` force re-activation on next page load for existing learner subscribers. Notification routing unaffected during cutover (the new SW still handles learner payloads identically; `audience` field is just additive). |
| **B — This plan lands first.** | No SW today. | This PR introduces the **audience-aware SW** from day one. BCS-DEF-4-PUSH then ships only its learner-specific surface (table + API + cabinet section) **without further SW changes**. Net SW churn: same total, just front-loaded. |
| **C — Both ship simultaneously.** | Whichever merges first defines SW shape. | Second PR must rebase its SW changes onto the first. **Mitigation**: this PR's SW patch is small (~20 LOC delta vs BCS-DEF-4-PUSH SW); rebase is mechanical. |

**Decision: prefer Scenario A** (ship BCS-DEF-4-PUSH first). Rationale:
1. The unified `lesson-reminders` probe (BCS-DEF-5 §1.2 sub-PR F) must land before this sub-PR anyway — the dependency forces BCS-DEF-5 sub-PR ordering E→F→G. Sub-PR G can't ship until the renamed scheduler exists.
2. Sub-PR F is the natural earliest point for any BCS-DEF-5 push work; BCS-DEF-4-PUSH is independent of F.
3. Allowing BCS-DEF-4-PUSH to land first lets the SW shape stabilise as "learner-only" briefly, then upgrade to audience-aware here — easier code review than two parallel SW patches.

### RISK-2 — Cross-audience tab focus collision in SW `notificationclick`

A learner who is also (separately accounted) a teacher could have both `/cabinet` and `/teacher` tabs open. SW focuses *the matching surface* via `audienceHint`. **Mitigation:** §2.2 — `audienceHint` is computed from `event.notification.data.audience`; the SW prefers the matching audience tab. If neither is open, opens a new window at `payload.url`. Edge case: if the user has multiple `/teacher` tabs, the FIRST matching `clients.matchAll` result wins — acceptable (browser behaviour, not under our control).

### RISK-3 — Migration ordinal collision with BCS-DEF-5-TG

When BCS-DEF-5-TG (not yet drafted) lands, it will also extend `teacher_reminder_dispatches.channel` CHECK. Same coordination as BCS-DEF-4-PUSH ↔ BCS-DEF-4-TG (BCS-DEF-4-PUSH §6 RISK-9). **Mitigation:** `drop constraint if exists` makes the CHECK extension idempotent. Migration numbers claimed loosely; finalised at impl time.

### RISK-4 — Operator confusion: two master switches, one VAPID key

Admin UI now has TWO push master switches (`LEARNER_PUSH_ENABLED`, `TEACHER_PUSH_ENABLED`) but ONE VAPID env triple. Operator may flip teacher switch without realising VAPID is shared. **Mitigation:** §2.7 — teacher Push row UI references "VAPID env: см. строку выше" (the learner Push row owns the presence indicators); the audit log records BOTH switches' state on each flip. Drift test covers the indicator de-dup.

### RISK-5 — Iconography / branding identical across audiences

Both audiences see `icon: '/favicon.svg'` notifications. A teacher receiving a notification can't visually tell at a glance that it's the "teacher" reminder vs a hypothetical learner one (if same browser). **Mitigation:** `title` and `body` text disambiguate; `tag` carries audience prefix so they can't collapse onto each other. Custom icon variants deferred (§10 BCS-DEF-PUSH-ICONOGRAPHY).

### RISK-6 — Inherited BCS-DEF-4-PUSH risks **[INHERIT]**

All BCS-DEF-4-PUSH §6 risks 1-11 apply (VAPID rotation, SW stale cache, iOS Safari, etc.). Not re-listed.

---

## 7. Acceptance criteria — deltas only

Same shape as BCS-DEF-4-PUSH §7. Additional teacher-specific gates:
- BCS-DEF-5 sub-PRs E + F merged to main BEFORE this sub-PR opens (dependency: union scheduler + teacher dispatch table + teacher reminders page).
- BCS-DEF-4-PUSH merged to main (recommended ordering per §6 RISK-1 Scenario A).
- Teacher SSR test verifies admin precedence rejects on `/teacher/settings/reminders`.
- Cross-audience SW regression-pin test (`tests/public/sw-audience.test.ts`) green.

PR commit body trailer:
```
Codex-Paranoia: SUB-WAVE self-reviewed (epic bcs-def-5); epic-end review pending
Skill-Used: trivial
```

(The epic-end paranoia wave checkpoint covers the aggregated BCS-DEF-5 diff including this sub-PR — per the epic-level paranoia contract.)

---

## 8. Migration / rollout — deltas only

1. **Prereq:** BCS-DEF-4-PUSH merged + operator has VAPID env populated.
2. **Prereq:** BCS-DEF-5 sub-PRs E + F merged.
3. This sub-PR opens.
4. CI runs migrations against test DB → green.
5. PR merges (squash) to main.
6. Autodeploy timer picks up; Next.js restarts.
7. `TEACHER_PUSH_ENABLED=0` (default) → channel dormant; teacher cabinet section hidden.
8. Operator flips `TEACHER_PUSH_ENABLED=1` at `/admin/settings/reminders`.
9. Reconcile-enqueue begins emitting `channel='push'` rows for teachers with active subscriptions (initially zero).
10. Operator self-subscribes as a test teacher; books a slot in their teacher calendar; confirms notification delivery within next 1-min scheduler tick.

**No ordering hazard.** Additive migrations. Dormant until master switch.

---

## 9. Pre-canned answers for paranoia round 2

**Q1.** Why a parallel teacher table vs a single `push_subscriptions` table with `audience` column? **A:** §2.3 — keeps RLS-like reasoning trivial (auth-scoped writes go to one table per audience); makes future audience-specific columns (e.g., `imminent_only` on teacher) painless; the duplication is purely at the storage layer because the send shape is identical.

**Q2.** Why share VAPID keys across audiences? **A:** §2.1 — VAPID identifies the application, not the audience; single keypair is the spec-correct shape; operator burden minimised.

**Q3.** Why ship SW changes here, not in BCS-DEF-4-PUSH? **A:** §6 RISK-1 — could go either way; we prefer ordering A (BCS-DEF-4-PUSH first, this second) so the SW evolves learner→audience-aware in a small, reviewable diff.

**Q4.** Can a learner abuse `/api/teacher/push/subscribe`? **A:** §4 — no; the route uses `requireTeacherAndVerified`; learner sessions get 403 (audience-scoped auth). Pinned by integration test.

**Q5.** What if a person has both a teacher account AND a separate learner account? **A:** Each `account_id` scopes its own subscriptions; both rows can exist; SW routes click target via `audience` field per notification. Behaves as expected.

**Q6.** Multi-device per teacher OK? **A:** Yes (§2.3 partial unique index per `(account_id, endpoint)`). Identical contract to BCS-DEF-4-PUSH.

**Q7.** What about the 5-min imminent reminder vs 60-min: any teacher-specific payload tuning? **A:** §2.4 — title varies by offset bucket ("Через ~5 мин…" / "Через ~30 мин…" / "Сегодня в…") same as learner; no special logic.

**Q8.** Why no separate admin VAPID indicators row? **A:** §2.7 / §6 RISK-4 — there's only one keypair; duplicating presence indicators creates a drift surface. The teacher row points back at the learner row's indicators.

---

## 10. Out of scope — deferred follow-ups

- **BCS-DEF-5-TG** — Teacher Telegram channel (sibling plan; not yet drafted as of 2026-05-18).
- **BCS-DEF-5-PUSH-IOS** (or shared **BCS-DEF-PUSH-IOS**) — Full PWA install flow (`display: standalone` + iOS-specific install instructions) for iOS Safari push support across both audiences.
- **BCS-DEF-5-PUSH-RICH** — Rich notifications (image attachments, action buttons "В Zoom" / "Отложить 5 мин"). Requires extending payload + SW notification-click router.
- **BCS-DEF-PUSH-ICONOGRAPHY** — Audience-distinct notification icons (a small badge variant for teacher vs learner notifications).
- **Multi-device per-row send visibility** — same deferral as BCS-DEF-4-PUSH §10 (queue-row aggregation only at MVP).
- **Per-channel preferences in `teacher_reminder_preferences`** — currently subscription presence is the implicit opt-in; explicit per-channel toggle deferred.
- **Localization beyond Russian** — out of scope.

---

## 11. Final trailer expectations

```
Codex-Paranoia: SUB-WAVE self-reviewed (epic bcs-def-5); epic-end review pending
Skill-Used: trivial
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

— END OF DRAFT (awaiting `/codex-paranoia plan` if BCS-DEF-5 epic-plan checkpoint doesn't already cover sub-PR G) —
