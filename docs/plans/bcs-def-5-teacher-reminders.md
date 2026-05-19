# BCS-DEF-5 — Lesson-start reminders for teacher

**Status:** DRAFT 2026-05-18 (awaiting `/codex-paranoia plan`).
**Wave name:** `bcs-def-5-teacher-reminders` (DELTA on top of BCS-DEF-4).
**Trigger:** Backlog item "BCS-DEF-5" (`ENGINEERING_BACKLOG.md:45`) — "Lesson-start reminders for teacher (mirror settings, same admin coverage)".
**Author:** Claude (autonomous).
**Channels:** **MVP = email only.** Telegram + push deferred (§10).

> **READ FIRST: `docs/plans/bcs-def-4-learner-reminders.md`.** This document is a DELTA on top of that plan. Sections marked **[INHERIT]** carry the exact contract from BCS-DEF-4. Sections marked **[DELTA]** capture only the differences. Anything not listed here is unchanged from BCS-DEF-4.

---

## 0. Cross-reference to BCS-DEF-4

BCS-DEF-5 mirrors BCS-DEF-4 in nearly every architectural choice: the queue+cron scheduler shape, the idempotency model, the operator-settings extension pattern, the systemd sandbox profile, the rollout sequence and the security analysis. The few real deltas are:

| Axis | BCS-DEF-4 (learner) | BCS-DEF-5 (teacher) |
|---|---|---|
| Audience | `lesson_slots.learner_account_id` | `lesson_slots.teacher_account_id` (`migrations/0020_lesson_slots.sql:36`) |
| Preferences table | `learner_reminder_preferences` (migr. 0059) | `teacher_reminder_preferences` (NEW migr. 0063) |
| Dispatch queue | `learner_reminder_dispatches` (migr. 0061) | `teacher_reminder_dispatches` (NEW migr. 0064) |
| Default offsets | `[60, 30, 10]` | `[60, 30, 10, 5]` — 5-min "imminent" ping by default |
| Scheduler probe name | `learner-reminders` | shared — see §1.2 / §2.1 (decision: one probe, two enqueue paths) |
| Operator settings | `LEARNER_REMINDERS_*` (5 keys) | only 1 new key (`TEACHER_REMINDERS_EMAIL_ENABLED`) — see §2.3 |
| Admin surface | `/admin/settings/reminders` (NEW) | **same page** — teacher section added below learner section |
| Cabinet surface | `/cabinet/settings/reminders` | `/teacher/settings/reminders` (NEW) |
| Email template | learner copy, low vocabulary | teacher copy, medium vocabulary (content-style §2 row "Учитель", `docs/content-style.md:53`) |
| Sub-PRs | A/B/C/D (~2400 LOC) | E/F (~900 LOC) — see §5 |

The shared moving parts (scheduler binary, dispatch table shape, idempotency contract, late-tolerance, rate-limit knob, csv-ints validator, systemd sandbox) are reused as-is. BCS-DEF-5 only adds the teacher-specific surfaces and the teacher branch inside the scheduler.

**BCS-DEF-5 explicitly ships AFTER BCS-DEF-4 is merged to main** — §5 covers the staging.

---

## 1. Goal

For every `booked` future `lesson_slots` row, also deliver up to N reminder emails to the **teacher** (the slot's `teacher_account_id`), at the same per-tick guarantees as BCS-DEF-4. Defaults are `60 / 30 / 10 / 5` minutes — the 5-min "imminent" ping is the BCS-DEF-5-only addition (teachers want a tab-switch nudge right before the lesson opens).

Hard requirements: identical to BCS-DEF-4 §1 — idempotent, late-tick tolerant, slot-state gated, per-user override. **[INHERIT]**

Out of scope: telegram, push, ICS invites, learner reminders (those are BCS-DEF-4 and assumed-shipped before this one starts), in-app banners.

## 1.1 Existing surface inventory — slot → teacher

Cited against `main` HEAD as of 2026-05-18.

- **`migrations/0020_lesson_slots.sql:36`** — `teacher_account_id uuid not null references accounts(id) on delete restrict`. The slot's teacher is mandatory and immutable from creation (an OPEN slot has a teacher but no learner; a BOOKED slot has both). Join key for "who gets this teacher reminder".
- **Teacher discovery from a booked slot:** the scheduler reconcile-enqueue already SELECTs `lesson_slots s WHERE s.status='booked' AND s.start_at > now()` for the learner branch (BCS-DEF-4 §2.4). The teacher branch reuses the same row — adds `s.teacher_account_id` to the projection. **No extra join required**: the slot row already carries both account ids. The join to `accounts` happens at send-time (5b) to pull `accounts.email` for the teacher account.
- **Teacher email source:** `accounts.email` for the row whose `id = lesson_slots.teacher_account_id`. Identical lookup path as learner — no new column / table.
- **Teacher's "current schedule" surface:** `app/teacher/page.tsx:17-28` already SELECTs `lesson_slots ... where teacher_account_id = $1` for the conflict count. The CTA in the reminder email points at `/teacher` (no anchor needed — the page is a full-week calendar).
- **Zoom URL** for the lesson — `lesson_slots.zoom_url` (`migrations/0056_lesson_slots_zoom_url.sql:9`, BCS-DEF-3 shipped 2026-05-18). The teacher is the row's editor (admin or teacher can PATCH it); the reminder surfaces the same URL to remind the teacher of *the link they already set*. If empty, the line is omitted.

## 1.2 Schema + scheduler — separate table OR shared scheduler?

Two design axes. **[DELTA]**

**Axis 1: Preferences table.** Same Option A vs B trade-off as BCS-DEF-4 §1.6 (columns on `account_profiles` vs new table).

**Decision: separate table `teacher_reminder_preferences`.** Reasoning:
1. **Different default cadence** — `[60, 30, 10, 5]` for teacher vs `[60, 30, 10]` for learner. The schema-level DEFAULT diverges, so a single shared table would force a `kind text` discriminant column + per-row defaults via app code — worse.
2. **Channel preferences may diverge over time** — task brief explicitly notes "teacher might want telegram bot for the 5min imminent channel; email-only for 60min". Keeping the table per-audience leaves room for `imminent_channel text` columns later without polluting learner schema.
3. **Identical structural shape** to `learner_reminder_preferences` (BCS-DEF-4 §2.2) — only the default value of `offsets_minutes` and the CHECK allowlist differ (the 5-min value is already in the BCS-DEF-4 allowlist, so the constraint shape is reusable).

**Axis 2: Scheduler.** Should the existing `scripts/learner-reminder-dispatch.mjs` (BCS-DEF-4 §2.4) handle teacher reminders too, or do we ship a sibling `scripts/teacher-reminder-dispatch.mjs`?

| Shape | Pros | Cons |
|---|---|---|
| **(a) ONE probe, both audiences** — rename to `scripts/lesson-reminder-dispatch.mjs`, two reconcile-enqueue statements (one per audience), one SELECT...FOR UPDATE drain that union-pulls both queues. | One timer, one DB sweep per tick (saves a 1-min query), one probe_runs stream, one rate-limit budget to reason about, single operator dashboard surface in `/admin/settings/reminders`. | Slightly more complex tick. Renaming the BCS-DEF-4 script post-merge is a non-trivial migration. |
| **(b) TWO probes** — sibling `scripts/teacher-reminder-dispatch.mjs` with its own timer (boot offset 4 min, same 1-min cadence), own `probe_runs.probe_name='teacher-reminders'`. | Zero impact on BCS-DEF-4 script; isolated failure domains. | Doubles the rate-limit reasoning ("learner sent 200, teacher sent 200, did we just hit Resend hourly cap?"); two probe_runs streams to read; two timers to maintain. |

**Decision: option (a) — one probe, two enqueue paths.** Justification:
- The expensive primitive is the per-tick DB scan + Resend dispatch. Doing it once with both audiences amortises the systemd wake + pool connection.
- The rate-limit knob `REMINDERS_RATE_LIMIT_PER_TICK` (renamed from `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK`, see §2.3) is then the single source of truth for "how many emails per tick" — eliminates the multi-probe accounting problem.
- The operator-defaults knob (`REMINDERS_DEFAULT_OFFSETS_CSV`) STAYS learner-only as `LEARNER_REMINDERS_DEFAULT_OFFSETS_CSV`; teacher defaults live in a sibling `TEACHER_REMINDERS_DEFAULT_OFFSETS_CSV`. The csv-ints validator (BCS-DEF-4 §2.3.1) is reused.
- **Renaming cost is real but bounded.** Sub-PR F (§5) does the rename: `scripts/learner-reminder-dispatch.mjs` → `scripts/lesson-reminder-dispatch.mjs`, `probe_runs.probe_name = 'lesson-reminders'` (migration ALTER), systemd unit rename. All-or-nothing in one PR; revert-safe because the rename ships before the teacher enqueue path activates.

Probe name `lesson-reminders` is the union — covers both audiences and the eventual telegram/push channels. BCS-DEF-4's `learner-reminders` value transitions to `lesson-reminders` via the rename migration (data-preserving UPDATE).

## 1.3 Existing surface inventory — email dispatch **[INHERIT]**

Reuse `lib/email/dispatch.ts:44-134` shape (BCS-DEF-4 §1.3). New helper `sendTeacherLessonReminder(to, params)` lands alongside `sendLearnerLessonReminder` (shipped in BCS-DEF-4 Sub-PR B). New template at `lib/email/templates/teacher-lesson-reminder.ts`.

## 1.4 Operator settings — 1 new key + 1 rename **[DELTA]**

BCS-DEF-4 §2.3 adds 5 keys: `LEARNER_REMINDERS_EMAIL_ENABLED`, `LEARNER_REMINDERS_DEFAULT_OFFSETS_CSV`, `LEARNER_REMINDERS_LATE_TOLERANCE_MINUTES`, `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK`, `LEARNER_REMINDERS_MAX_ATTEMPTS`. **[INHERIT for the learner side.]**

This wave **renames** the 3 *shared-semantics* knobs (late-tolerance, rate-limit-per-tick, max-attempts) to drop the audience prefix:
- `LEARNER_REMINDERS_LATE_TOLERANCE_MINUTES` → `REMINDERS_LATE_TOLERANCE_MINUTES`
- `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK` → `REMINDERS_RATE_LIMIT_PER_TICK`
- `LEARNER_REMINDERS_MAX_ATTEMPTS` → `REMINDERS_MAX_ATTEMPTS`

The two **audience-specific** master switches stay separate:
- `LEARNER_REMINDERS_EMAIL_ENABLED` (existing, untouched)
- `TEACHER_REMINDERS_EMAIL_ENABLED` **(NEW — 1 added key)**

The two **default-offsets** knobs stay separate (defaults diverge):
- `LEARNER_REMINDERS_DEFAULT_OFFSETS_CSV` default `'60,30,10'` (existing)
- `TEACHER_REMINDERS_DEFAULT_OFFSETS_CSV` default `'60,30,10,5'` **(NEW — sibling key, second added)**

**Rename mechanic:** `operator_settings.key` is the PK in the table (`migrations/0055_operator_settings.sql`). The rename ships as a data-preserving migration: `update operator_settings set key='REMINDERS_LATE_TOLERANCE_MINUTES' where key='LEARNER_REMINDERS_LATE_TOLERANCE_MINUTES'` for each of the 3 keys. SETTING_SCHEMA in `lib/admin/operator-settings.ts` removes the old entries and adds the renamed ones. Drift tests adjusted. **Scope value `'learner-reminders'` also renames to `'lesson-reminders'`** in the same migration (since the probe rename is in the same sub-PR).

**Why rename now rather than ship sibling `TEACHER_REMINDERS_*` keys?** Three settings whose defaults are by-design audience-agnostic (late-tolerance, rate-limit, max-attempts) should not be duplicated; a duplicate creates a drift surface (operator bumps learner rate-limit to 500, forgets teacher, teacher hits a backlog). Renaming pre-flight is cheap because BCS-DEF-4 is freshly merged and the operator has not yet configured the renamed keys in prod (defaults are sane).

## 1.5 Existing surface inventory — admin coverage tracking **[INHERIT]**

BCS-DEF-4 §1.5 discharges `docs/plans/admin-ux-coverage.md §3.4 + §5.4` (reminder cadence editor). The teacher-reminder section adds:
- §3.4 narrative gets a "teacher reminders also operator-tunable from same page" line — closed by §2.6 (admin page extension).
- §5.4 is already closed structurally; this wave only **extends** the existing `/admin/settings/reminders` page with a teacher section beneath the existing learner section.

## 1.6 Per-user preference data model

**[DELTA]** Mirror of BCS-DEF-4 §1.6 Option B. New table `teacher_reminder_preferences`:
- `account_id uuid pk → accounts(id) on delete cascade`
- `offsets_minutes integer[] not null default array[60,30,10,5]::integer[]` — **5-min default added vs learner table**
- `email_opt_in boolean not null default true`
- CHECK `cardinality between 0 and 5 AND offsets <@ array[1440,720,360,240,180,120,90,60,45,30,20,15,10,5]` (same allowlist as learner table)

Defaults of *both* tables are honoured when a user has no row: scheduler falls back to the operator default for that audience (`TEACHER_REMINDERS_DEFAULT_OFFSETS_CSV` vs `LEARNER_REMINDERS_DEFAULT_OFFSETS_CSV`). **Defaults-of-defaults:** if a teacher has no row and the operator setting is empty too, the schema-level `array[60,30,10,5]` default kicks in via the per-tick fallback resolver — i.e. the scheduler never sends zero reminders for a slot purely due to missing config. (Same defence as BCS-DEF-4 §1.6.)

## 1.7 Existing surface inventory — cabinet preference editor

**[DELTA]** The cabinet path for learners is `/cabinet/settings/reminders` (BCS-DEF-4 §1.7). Teachers use a different routed surface — `/teacher/settings/reminders` (mirrors `app/teacher/settings/calendar/page.tsx` placement, `app/teacher/settings/calendar/page.tsx:1`). Server-Action submit (same pattern as learner page); rate-limit 10 req/min/account.

## 1.8 Critical-path inventory **[INHERIT]**

`docs/critical-path.md` already covers `lib/scheduling/slots/booking.ts`, `lib/admin/operator-settings.ts`, `lib/email/dispatch.ts` per BCS-DEF-4 §1.8.

This wave adds:
- `lib/admin/operator-settings.ts` — rename 3 keys + add 2 keys. Additive + rename; tests pin the rename.
- `lib/email/dispatch.ts` — additive (new sendTeacherLessonReminder).
- `scripts/lesson-reminder-dispatch.mjs` (renamed from `scripts/learner-reminder-dispatch.mjs`) — touches BCS-DEF-4 code; covered by sub-PR-F paranoia self-review + epic-end wave.

Sub-PRs E/F carry `Codex-Paranoia: SUB-WAVE self-reviewed (epic bcs-def-5); epic-end review pending`; epic-close sub-PR (F) carries SIGN-OFF.

---

## 2. Design deltas vs BCS-DEF-4

### 2.1 Scheduler shape **[DELTA]**

One probe, two enqueue paths (§1.2 decision). Inside `scripts/lesson-reminder-dispatch.mjs` tick anatomy (BCS-DEF-4 §2.4 inherited verbatim):

- **Step 2 (master-switch gate)** evaluates BOTH switches independently: if `LEARNER_REMINDERS_EMAIL_ENABLED=0` AND `TEACHER_REMINDERS_EMAIL_ENABLED=0` → exit with `channel_disabled_by_operator`. If only one is 0, only that audience is gated.
- **Step 3 (reconcile-enqueue)** runs the BCS-DEF-4 §2.4 INSERT for the learner queue **only if learner switch is ON**, then runs the parallel INSERT for the teacher queue **only if teacher switch is ON**. Each INSERT has its own `ON CONFLICT DO NOTHING` against its own queue table.
- **Step 4 (drain)** SELECTs `UNION ALL` across both `learner_reminder_dispatches` AND `teacher_reminder_dispatches` filtered to `status='pending' AND due_at <= now()`, `ORDER BY due_at ASC LIMIT $rateLimit FOR UPDATE SKIP LOCKED`. Result rows tagged with `audience text` column ('learner'|'teacher') from the SELECT (literal in projection).
- **Step 5 (per-row send TX)** branches on `audience`: learner rows → `sendLearnerLessonReminder`; teacher rows → `sendTeacherLessonReminder`. The status-update writes back to the corresponding table.
- **Step 6 (stats)** records aggregate counts `{learner_sent, teacher_sent, learner_skipped, teacher_skipped, ...}` in `probe_runs.stats` JSON.

The 5-min "imminent" offset is just another row in the dispatch queue. No special-case code path — the cron-cadence is still 1 min, so a 5-min reminder for a slot at T+5 enqueues at booking (or at the next tick's reconcile), drains at T or T-1 (within tolerance).

### 2.2 New migrations **[DELTA]**

Numbers reserved on the assumption BCS-DEF-4 lands first and consumes 0059/0061/0062. BCS-DEF-5 ships:

- **Migration 0063 — `teacher_reminder_preferences`** — clone of `learner_reminder_preferences` (BCS-DEF-4 §2.2) with `default array[60,30,10,5]::integer[]`.
- **Migration 0064 — `teacher_reminder_dispatches`** — structurally identical to `learner_reminder_dispatches` (BCS-DEF-4 §2.2); same `audience` column NOT added at table level (the audience is implicit in the table name; the SELECT projection adds the literal in step 4).
- **Migration 0065 — `probe_runs.probe_name` CHECK extend + rename + scope+key renames**:
  - `update probe_runs set probe_name='lesson-reminders' where probe_name='learner-reminders';` (data-preserving)
  - `alter table probe_runs drop constraint probe_runs_probe_name_check; alter table probe_runs add constraint ... check (probe_name in ('auth-flow','calendar-pathology','webhook-flow','conflict-unresolved','lesson-reminders'));`
  - `update operator_settings set scope='lesson-reminders' where scope='learner-reminders';` — column `scope` lives in `operator_settings` per `migrations/0055_operator_settings.sql`. If it doesn't, this UPDATE is a no-op and the rename is purely TS-side (verify in plan paranoia round).
  - `update operator_settings set key='REMINDERS_LATE_TOLERANCE_MINUTES' where key='LEARNER_REMINDERS_LATE_TOLERANCE_MINUTES';` (× 3 for the 3 renamed keys)

All migrations are additive or data-preserving renames; no destructive ALTERs.

### 2.3 Operator settings — code changes **[DELTA]**

Concrete additions to `lib/admin/operator-settings.ts SETTING_SCHEMA`:

```ts
TEACHER_REMINDERS_EMAIL_ENABLED: {
  kind: 'int',
  default: 1,
  min: 0,
  max: 1,
  envName: 'TEACHER_REMINDERS_EMAIL_ENABLED',
  description: 'master switch (1=on/0=off) for teacher email reminders',
  scope: 'lesson-reminders',
},
TEACHER_REMINDERS_DEFAULT_OFFSETS_CSV: {
  kind: 'csv-ints',
  default: '60,30,10,5',
  envName: 'TEACHER_REMINDERS_DEFAULT_OFFSETS_CSV',
  description: 'fallback offset list for teachers without an explicit preference (CSV of ints from the same allowlist)',
  scope: 'lesson-reminders',
  allowedValues: [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440],
  maxCardinality: 5,
},
```

Renames of the 3 shared keys + `ProbeName` value change `'learner-reminders'` → `'lesson-reminders'` per §1.4. `scripts/lib/operator-settings.mjs` mirror updates in lockstep; drift test pins.

### 2.4 Teacher email template — `lib/email/templates/teacher-lesson-reminder.ts` **[DELTA]**

Teacher copy. Per `docs/content-style.md:53` (audience row "Учитель") vocabulary tolerance is medium — we use "занятие", "слот в расписании", "учащийся", but not "урок" (BCS-DEF-2 lexicon change) and not slang. Subject line and body keep the LevelChannel imperative tone (content-style §3 — direct, active voice).

```
Subject: Через ~60 мин — занятие на LevelChannel

Здравствуйте, Анна.

У вас занятие в расписании через ~60 минут.

   Когда: 2026-06-01 17:00 (Europe/Moscow, UTC+3)
   Длительность: 60 минут
   Учащийся: Иван П.                ← from accounts/account_profiles via slot.learner_account_id; first-name + initial only, escapeHtml
   Ссылка для входа: https://meet.google.com/xxx-yyyy-zzz   ← from lesson_slots.zoom_url; omit line if null
   Расписание целиком: https://levelchannel.ru/teacher

Хотите изменить расписание напоминаний?
   → https://levelchannel.ru/teacher/settings/reminders

— LevelChannel
```

Key copy deltas vs learner email:
- Subject says "занятие" not "урок с преподавателем" (teacher already knows the audience).
- Body greets by teacher's `display_name` (escaped); falls back to no name if profile.display_name is null (content-style §2 row "Учитель" — formal greeting without name is acceptable).
- New line "Учащийся: Иван П." — surfaces the learner's first name + initial (privacy-conservative; `account_profiles.display_name` is used if set, else the email's first letter — never the full email). Tests pin escapeHtml on this field.
- "Расписание целиком" (vs learner's "Моё расписание") — links to `/teacher` not `/cabinet#mine`.
- The "settings/reminders" link points at `/teacher/settings/reminders`.

5-min "imminent" subject variant: `Через ~5 мин — занятие сейчас начнётся`. Same body shape.

Subject template input: `{offset_minutes: 60 | 30 | 10 | 5, display_name?}`. The `~5 мин — занятие сейчас начнётся` variant is selected when offset === 5; all other offsets use the generic `Через ~N мин — занятие на LevelChannel` form.

### 2.5 Idempotency / dedup **[INHERIT]**

Same UNIQUE-index-and-FOR-UPDATE-SKIP-LOCKED model (BCS-DEF-4 §2.5). Each table has its own unique index. The two tables never alias because they have separate `id` namespaces.

### 2.6 Admin surface — `/admin/settings/reminders` (extended)

Same page as BCS-DEF-4 §2.6; this wave adds a "Teacher reminders" section below the existing "Learner reminders" section:
- Master switch (TEACHER_REMINDERS_EMAIL_ENABLED)
- Default offsets multi-select (TEACHER_REMINDERS_DEFAULT_OFFSETS_CSV; preselects `60,30,10,5`)
- The shared knobs (late-tolerance, rate-limit-per-tick, max-attempts) MOVE into a "Shared scheduler settings" section at the top — same form, just renamed inputs (REMINDERS_LATE_TOLERANCE_MINUTES, etc.).

The "Recent dispatch summary" widget (BCS-DEF-4 §2.6) now reads `probe_runs.probe_name='lesson-reminders'` and surfaces the per-audience stats from `stats JSON` (learner_sent, teacher_sent).

### 2.7 Timezone semantics **[INHERIT]**

Same as BCS-DEF-4 §2.7 — UTC `start_at`, render in `account_profiles.timezone` for the recipient. Teacher's timezone is independent of the learner's timezone for the same slot — the same lesson can render as "17:00 MSK" in the teacher's email and "19:00 Asia/Yekaterinburg" in the learner's email. Tests pin both.

### 2.8 Cabinet/teacher surface — `/teacher/settings/reminders`

NEW page. Mirrors `app/cabinet/settings/reminders/page.tsx` (shipped in BCS-DEF-4 Sub-PR D) — same UI components, same Server-Action submit shape. Layout-level role gate ensures only the teacher archetype can reach it; reusing the same gate as `app/teacher/page.tsx` (cookie → session → archetype check at layout level — `app/teacher/page.tsx:38-47` precedent).

### 2.9 Systemd unit **[DELTA]**

BCS-DEF-4 ships `scripts/systemd/levelchannel-learner-reminder-dispatch.{service,timer}`. This wave **renames** them to `levelchannel-lesson-reminder-dispatch.{service,timer}` to match the renamed probe script.

Rename mechanic on prod: `scripts/activate-prod-ops.sh` (BCS-DEF-4 Sub-PR B touched it) gets updated allowlist entries — the old unit names are dropped, the new ones added. On VPS, the activation script disables the old timer, removes the dropin, enables the new one. **First boot after rename re-uses `OnBootSec=3min`**, so a ~3-min reminder gap is possible during the rollover (acceptable; sub-PR F PR description calls this out as the only operator-visible side effect).

### 2.10 `probe_runs.probe_name` CHECK extension **[INHERIT]** + rename **[DELTA]**

Migration 0065 (per §2.2). After the migration:
- Allowed `probe_name` values: `auth-flow, calendar-pathology, webhook-flow, conflict-unresolved, lesson-reminders`.
- `learner-reminders` is removed from the CHECK (the data UPDATE happens first; any concurrent insert of the old name during the migration TX is impossible because the CHECK is atomic with the data update inside the migration TX).

`scripts/lib/probe-runs.mjs PROBE_NAMES`: `LEARNER_REMINDERS` constant renames to `LESSON_REMINDERS`. Any caller of the old name fails the build (good — exposes any pinned references).

### 2.11 Volume / rate-limit accounting **[DELTA]**

Critical safety question (task §6 risk note: "teacher with 8 lessons/day × 4 offsets = 32 emails"). Defence-in-depth:

1. **Per-tick rate limit** (`REMINDERS_RATE_LIMIT_PER_TICK`, default 200) — already enforced by the existing drain query. Now shared across both audiences (one budget).
2. **Per-recipient-per-day cap** — **NEW** soft cap of 50 reminders / 24h / `account_id`. Implemented as a pre-send gate in step 5a: `SELECT count(*) FROM teacher_reminder_dispatches WHERE account_id=$1 AND status='sent' AND sent_at > now() - interval '24 hours'`. If ≥ 50 → skip with new reason `daily_recipient_cap`. Knob `REMINDERS_DAILY_RECIPIENT_CAP` defaults to 50; operator-tunable 0-500. (Cap of 0 = disabled.)
3. **Per-recipient deduplication is structural, not adversarial** — the UNIQUE index on `(slot_id, offset_minutes, channel)` prevents the *same* (slot, offset, channel) row from sending twice. The daily-cap above defends against the **legitimate high-volume teacher** case (4 offsets × 8 lessons = 32, which is under 50, so a normal teacher day fits comfortably under the cap).

Worked example: teacher with 8 lessons × default 4 offsets = 32 emails/day. Cap 50 leaves headroom. A pathological teacher with 12 lessons (4 × 12 = 48) still fits. Above 50 → late-day reminders get skipped, alert visible in `/admin/settings/reminders` recent-dispatch widget.

Cap added as **one new operator-settings key**: `REMINDERS_DAILY_RECIPIENT_CAP` (kind: 'int', default 50, min 0 max 500). Applies to both audiences uniformly; the gate runs in step 5a regardless of audience. **Total new operator keys this wave = 3** (TEACHER_REMINDERS_EMAIL_ENABLED, TEACHER_REMINDERS_DEFAULT_OFFSETS_CSV, REMINDERS_DAILY_RECIPIENT_CAP).

---

## 3. Tests — what differs from BCS-DEF-4

Most BCS-DEF-4 tests (§3.1-§3.7) carry over via the renamed scheduler script; this section documents only the teacher-side additions and the rename-pinning.

### 3.1 Rename pinning

`tests/admin/operator-settings.test.ts`:
- The 3 renamed keys are present under their new names; old names are absent.
- `ProbeName` union contains `'lesson-reminders'`; does NOT contain `'learner-reminders'`.
- Drift test (TS ↔ mjs mirror JSON.stringify) still green after rename.

### 3.2 Teacher preferences write path

`tests/integration/teacher/reminder-preferences.test.ts`:
- Mirror of BCS-DEF-4 §3.3 but POSTing to `/teacher/settings/reminders` Server Action.
- Default cardinality test: empty submission keeps defaults `[60,30,10,5]` (vs learner's `[60,30,10]`).
- POST as **learner archetype** → 403 (teacher-only surface).
- POST with `offsets_minutes=[5]` → success (5 is in allowlist; cardinality 1 is valid).

### 3.3 Scheduler — teacher branch

Extends `tests/integration/scripts/lesson-reminder-dispatch.test.ts` (renamed from BCS-DEF-4's learner-reminder-dispatch.test.ts):
- Slot at T+90 with teacher prefs [60,30,10,5]. Tick T → 4 pending rows in `teacher_reminder_dispatches` (vs 3 in learner table).
- Ticks at T+30/+60/+80/+85 send the 60/30/10/5 reminders in due_at order.
- Master switches: learner=1, teacher=0 → only learner queue drains; teacher rows stay `pending`. Vice versa.
- Daily cap: pre-seed 50 sent rows for a teacher in last 24h, drain at tick → next row → `skipped_reason='daily_recipient_cap'`.
- Same slot has BOTH learner and teacher prefs → 3 learner emails + 4 teacher emails fire at correct offsets; no cross-audience interference.
- Slot cancelled mid-flight → BOTH queues' rows for that slot get `slot_no_longer_booked` on next tick.

### 3.4 Booking-route enqueue

Existing `tests/integration/slots/book-enqueues-reminders.test.ts` (BCS-DEF-4 Sub-PR C) extends:
- Booking enqueues N learner rows AND M teacher rows (default 3 + 4 = 7 inserts).
- If teacher master switch is OFF at book time → reconcile-enqueue path (in scheduler) is gated; route-level enqueue might still insert (we don't gate at route, only at scheduler drain). **Decision: route-level enqueue unconditional; switch gates the drain.** Reasoning: the queue is cheap; flipping the switch back ON should resurrect already-queued reminders without re-booking the slot. Test pins this.

### 3.5 Email template

`tests/email/teacher-lesson-reminder.test.ts`:
- Subject for offset=5 contains "сейчас начнётся".
- Subject for offset=60 contains "~60 мин".
- Learner-name line is `escapeHtml`'d.
- Zoom URL omitted when null.
- "Расписание целиком" link is `/teacher`, not `/cabinet#mine`.

### 3.6 Migration rename

`tests/integration/migrations/rename-learner-to-lesson-reminders.test.ts` (NEW):
- Seed a `probe_runs` row with `probe_name='learner-reminders'`.
- Run migration 0065.
- Assert: row's `probe_name='lesson-reminders'`.
- Assert: `INSERT probe_name='learner-reminders'` fails the CHECK.
- Assert: `INSERT probe_name='lesson-reminders'` succeeds.

### 3.7 Admin page

`tests/integration/admin/reminders-settings-page.test.ts` (BCS-DEF-4) extends:
- Page now renders 3 sections: "Shared", "Learner", "Teacher".
- POST teacher master switch off → reflected in next scheduler tick.

---

## 4. Security analysis **[INHERIT mostly]**

Most of BCS-DEF-4 §4 carries over. Deltas:

### 4.1 Teacher email body leaks learner first-name + initial

`accounts/account_profiles.display_name` is shown to the teacher who already has the same data in `/teacher` calendar UI — no incremental disclosure. Falls back to first-letter-of-email if no profile display_name (avoids leaking the learner's email address to the teacher; teacher already sees the address in admin views but not in the cabinet-style calendar).

### 4.2 Reminder spam attack vector

The §2.11 daily cap is the structural defence. A malicious learner repeatedly booking/cancelling slots to flood the teacher with reminders would be capped at 50 emails / 24h regardless of booking count. The cancellation path also doesn't fire reminders (slot status flips to 'cancelled' before next reconcile-enqueue tick).

### 4.3 Cross-audience leakage

The teacher email never includes the learner's email address. The learner email (BCS-DEF-4) doesn't include the teacher's name or email. Pinned by tests §3.5 + BCS-DEF-4 §3.7.

### 4.4 Migration rename — concurrency

The data UPDATE (`update probe_runs set probe_name='lesson-reminders' where probe_name='learner-reminders'`) runs in the same TX as the CHECK constraint replace. If a concurrent scheduler tick inserts a row with the OLD name mid-migration, the row's INSERT is serialized (Postgres TX isolation) and either runs before the UPDATE (the UPDATE picks it up) or after the CHECK swap (fails). The probe binary is idempotent on transient INSERT failure (`recordProbeRun` swallows errors per `scripts/lib/probe-runs.mjs:18-20`); next tick succeeds.

---

## 5. Decomposition — independent epic, post-BCS-DEF-4

**Q: does BCS-DEF-5 ship as sub-PR of a combined epic OR as independent epic?**

**Decision: INDEPENDENT EPIC.** Reasoning:
1. BCS-DEF-4 is already a 4-sub-PR / ~2400-LOC epic; bundling 5 into it would push toward 3300+ LOC and 6 sub-PRs, which lowers the epic-end paranoia signal-to-noise.
2. BCS-DEF-4 ships the foundational shape (queue table, scheduler script, csv-ints validator, admin page, systemd unit, email template pattern). BCS-DEF-5 reuses all of it — the value of a clean BCS-DEF-4 SIGN-OFF on prod first is that **BCS-DEF-5's paranoia wave runs on a smaller surface** (only the deltas).
3. Sequencing: BCS-DEF-4 epic-end SIGN-OFF on main → BCS-DEF-5 plan paranoia → BCS-DEF-5 sub-PRs → BCS-DEF-5 epic-end SIGN-OFF. The 7-day latency between epics is acceptable for a teacher-side feature whose absence is a known gap (backlog row, not a paying-user blocker).

**Sub-PR layout (BCS-DEF-5 is a 2-sub-PR epic):**

### Sub-PR E — Schema + scheduler unification (renames + teacher table foundation)
- `migrations/0063_teacher_reminder_preferences.sql` (NEW)
- `migrations/0064_teacher_reminder_dispatches.sql` (NEW)
- `migrations/0065_rename_learner_to_lesson_reminders.sql` (NEW — data-preserving renames per §2.2)
- `scripts/learner-reminder-dispatch.mjs` → `scripts/lesson-reminder-dispatch.mjs` (rename + add teacher reconcile-enqueue, drain UNION, audience branching)
- `scripts/systemd/levelchannel-learner-reminder-dispatch.{service,timer}` → `levelchannel-lesson-reminder-dispatch.{service,timer}` (rename)
- `scripts/activate-prod-ops.sh` — allowlist entries renamed
- `lib/admin/operator-settings.ts` — rename 3 keys, scope value, add 3 new keys (TEACHER_REMINDERS_EMAIL_ENABLED, TEACHER_REMINDERS_DEFAULT_OFFSETS_CSV, REMINDERS_DAILY_RECIPIENT_CAP)
- `scripts/lib/operator-settings.mjs` — mirror
- `scripts/lib/probe-runs.mjs` — `LEARNER_REMINDERS` → `LESSON_REMINDERS` rename
- Booking-route enqueue (`app/api/slots/[id]/book/route.ts` + admin sibling) — extend to also INSERT into `teacher_reminder_dispatches` for the slot's teacher
- Tests: §3.1, §3.3 (rename pinning + scheduler dual-audience), §3.6 (migration rename)
- **Trailer:** `Codex-Paranoia: SUB-WAVE self-reviewed (epic bcs-def-5); epic-end review pending`. **Critical-path touched:** `lib/admin/operator-settings.ts`, `lib/email/dispatch.ts` (preview only — actual `sendTeacherLessonReminder` ships in F).

### Sub-PR F — Teacher email + cabinet surface + admin surface extension (epic close)
- `lib/email/templates/teacher-lesson-reminder.ts` (NEW)
- `lib/email/dispatch.ts` — `sendTeacherLessonReminder` added
- `app/teacher/settings/reminders/page.tsx` (NEW)
- `app/teacher/settings/reminders/reminder-prefs-form.tsx` (NEW — Server Action)
- `lib/auth/profiles.ts` — `getTeacherReminderPreferences` / `setTeacherReminderPreferences` (sibling helpers; same shape as learner counterparts shipped in BCS-DEF-4 Sub-PR D)
- `app/admin/(gated)/settings/reminders/page.tsx` — extend with "Teacher reminders" section + "Shared scheduler settings" section restructure
- `scripts/lesson-reminder-dispatch.mjs` — wire `sendTeacherLessonReminder` into step 5b teacher branch
- Tests: §3.2, §3.4, §3.5, §3.7
- Docs: `ENGINEERING_BACKLOG.md` strikethrough BCS-DEF-5; `docs/plans/admin-ux-coverage.md` mark §3.4 / §5.4 teacher-coverage line done.
- **Trailer:** `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`. **Critical-path touched:** revisit per the epic diff.

Total estimated diff: ~900 LOC across 2 sub-PRs. Paranoia plan paranoia covers the scheduler unification gate; sub-PR F epic-close wave covers the aggregated diff.

---

## 6. Risks + mitigations

Most BCS-DEF-4 §6 risks (RISK-1 through RISK-9) carry over verbatim for the teacher branch. Deltas:

### RISK-10 — Reminder spam if a teacher has 8 lessons/day × 4 offsets = 32 emails

Worst-case 32 emails/day per teacher with default config. §2.11 daily cap (`REMINDERS_DAILY_RECIPIENT_CAP` default 50) leaves a 16-email buffer; pathological 12-lesson days still fit. Above 50 → soft-skip with reason logged in dispatch row + visible in admin recent-summary widget. Operator can bump the cap if a power-teacher complains.

### RISK-11 — Rename rollover gap

§2.9: the systemd unit rename causes a ~3-min reminder gap during prod activation. Mitigation: rollover scheduled to a non-business hour (3am MSK) via operator activation step; reminders queue but don't drain for 3 min; on next boot the new unit picks them up (any rows whose `due_at + lateTolerance` was within the gap fall to `past_send_by` — capped at lateTolerance=5 min, so at worst a few late reminders).

### RISK-12 — Operator forgets to set teacher master switch after BCS-DEF-5 prod activation

Default in §2.3 is `TEACHER_REMINDERS_EMAIL_ENABLED=1`. Teachers start receiving reminders from the moment Sub-PR F merges + the systemd unit picks up the renamed timer. **Acceptable** — defaults represent the intended user experience. Teacher cabinet page surfaces an "Off" toggle for any teacher who wants out, no admin escalation needed.

### RISK-13 — Cross-audience email confusion

A teacher whose `accounts.id` accidentally matches a learner's id can't happen (UUID PK, no collision possible). But a single physical person who holds both teacher and learner archetypes (allowed by `lib/auth/profiles.ts` — archetypes are additive) booking a lesson with themselves (operator anti-pattern) would receive TWO emails (one teacher, one learner). Acceptable degenerate case — the booking route doesn't prevent self-booking; admin would catch this.

### RISK-14 — Teacher prefs `[5]` only — teacher gets no advance notice

A teacher who sets `offsets_minutes=[5]` only gets a 5-min imminent ping — no 60-min advance. Acceptable per-user override per BCS-DEF-4 §1 hard requirement. Cabinet UI surfaces the trade-off in the same form ("Reset to defaults" button reverts to 60/30/10/5).

### RISK-15 — Daily cap interacts with rate-limit cap

If the per-tick rate limit (200) fires before the daily cap check, a teacher could get more than 50 emails in 24h IF the rate-limit decision is made on a per-tick window aligned with a teacher's reminder bursts. The §2.11 daily cap runs in step 5a BEFORE the send, so it's evaluated per row; rate-limit caps the batch size but each batch still goes through the per-recipient gate. **Verified safe**: daily cap is the harder bound; rate limit is just a Resend-API-friendliness throttle.

---

## 7. Acceptance criteria (per sub-PR + epic)

- **E**: migrations 0063-0065 apply; rename UPDATEs are data-preserving (test row from §3.6 survives); SETTING_SCHEMA renames green; scheduler script runs against empty queues for both audiences → `ok` zero-stats; test:run + test:integration + build green.
- **F (epic close)**: teacher cabinet page lets teacher set 0-5 offsets + toggle email_opt_in; teacher reminder emails fire correct subject/body for each offset; admin page renders Shared/Learner/Teacher sections + writes pass round-trip; BACKLOG strikethrough BCS-DEF-5; `/codex-paranoia wave` SIGN-OFF round N/3.

Post-merge operator activation: `scripts/activate-prod-ops.sh` swaps in the renamed timer + service; first tick within 1 min; admin verifies teacher switch is ON; spot-check one upcoming booked slot to confirm the teacher dispatch rows enqueued.

---

## 8. Migration / rollout

1. **Strict prerequisite:** BCS-DEF-4 epic-close SIGN-OFF must be on prod (i.e. `/admin/settings/reminders` exists, learner reminders are flowing, `learner_reminder_dispatches` rows are accumulating green sends). Confirm via prod `/admin/settings/reminders` widget showing recent ticks. If BCS-DEF-4 itself is paused, BCS-DEF-5 plan is paused too.
2. Sub-PRs E → F merge in order. E is large but covers schema + scheduler rename atomically (a partial-deploy is risky). E ships behind the master-switch defaults that keep teacher reminders OFF? **No — defaults are ON per §2.3.** But: between E merge and F merge, the teacher dispatch rows accumulate as `pending` (no email sender exists yet — sub-PR F adds it). The drain query in E's scheduler skips audience='teacher' if `sendTeacherLessonReminder` is not yet imported (graceful no-op at the route level: the import is added in F; in E the audience branch logs a stat `teacher_skipped_no_sender` and leaves rows pending).
3. After F merges, `scripts/activate-prod-ops.sh` is rerun on the VPS — the renamed unit takes over; first tick drains the accumulated teacher queue (rate-limit caps the burst).
4. **First-tick safety:** the activation script flips `TEACHER_REMINDERS_EMAIL_ENABLED=0` momentarily, lets the operator verify the queue length, then `=1` to release. Documented in F's PR description. Same pattern as BCS-DEF-4 §8 step 4.

---

## 9. Open questions for paranoia

**Q1.** Is the renamed-key migration worth the operator-comm cost, or should we ship `TEACHER_REMINDERS_*` siblings of the 3 shared keys and accept the drift? **Pre-answer:** rename — drift compounds and the renamed key is more honest. Operator-comm cost is one line in the PR description.

**Q2.** Should the teacher cabinet page live at `/teacher/settings/reminders` or `/cabinet/settings/reminders` (learner-style)? **Pre-answer:** `/teacher/settings/reminders` — teacher archetype has a distinct dashboard at `/teacher`; symmetric placement.

**Q3.** Should the 5-min "imminent" offset be a separate channel rather than just another offset value? **Pre-answer:** no — offset value is sufficient. A separate channel adds an axis (channel × offset) that's only needed if the **delivery mechanism** for 5-min differs (push vs email). MVP is email-only.

**Q4.** Daily cap of 50 — is it too low for a power teacher with 16 lessons/day? **Pre-answer:** 16 × 4 = 64; bumps over 50. Operator can raise cap to 100. Cap range max=500 covers any realistic teacher. Adversarial spam still capped.

**Q5.** Should learner+teacher reminders for the SAME slot enqueue atomically with the slot booking? **Pre-answer:** the booking route already fire-and-forget enqueues; this wave extends the same fire-and-forget block. The reconcile-enqueue path catches drops. No new TX coupling.

**Q6.** What happens if BCS-DEF-4 epic-close paranoia surfaces a BLOCKER that changes the queue table shape? **Pre-answer:** BCS-DEF-5 starts AFTER BCS-DEF-4 SIGN-OFF, so any BLOCKER fix lands first. If `learner_reminder_dispatches` shape changes, this plan's `teacher_reminder_dispatches` mirror inherits the change automatically — replan only the rename migration.

**Q7.** Should the scheduler's UNION drain be replaced with two separate SELECTs (one per audience), avoiding the audience-literal projection trick? **Pre-answer:** UNION is fine. One DB roundtrip beats two. The projection literal is idiomatic Postgres.

**Q8.** Should we ship a teacher unsubscribe-token path now? **Pre-answer:** no, same deferral as BCS-DEF-4 §10 BCS-DEF-4-UNSUB. Teacher cabinet toggle is the explicit opt-out.

**Q9.** Is the daily cap row-counting query expensive? **Pre-answer:** indexed on `(account_id, sent_at)` via a new partial index `where status='sent'`. Query cost: small for normal teachers; bounded for power teachers. Plan migration 0064 includes the index.

**Q10.** Could the rename be deferred and we just add `TEACHER_REMINDERS_*` keys naïvely? **Pre-answer:** technically yes; rejected per Q1 reasoning. If paranoia escalates the rename risk, fallback to deferred rename + carry the drift as a known follow-up.

---

## 10. Out of scope — deferred follow-ups

- **BCS-DEF-5-TG** — Telegram channel for teachers, especially the 5-min imminent ping. Sibling of BCS-DEF-4-TG. Needs teacher chat_id linkage.
- **BCS-DEF-5-PUSH** — PWA web push for teachers.
- **BCS-DEF-5-UNSUB** — Hard List-Unsubscribe for teacher reminders. Sibling of BCS-DEF-4-UNSUB.
- **BCS-DEF-5-PER-SLOT** — Per-slot custom offsets (teacher picks `[5]` for a specific lesson).
- **BCS-DEF-5-CALENDAR-DELTA** — Reminder when a learner CANCELS a slot (different probe; not a pre-start reminder).
- **REMINDERS-MULTI-CHANNEL** — Per-offset channel routing (teacher routes 5-min to telegram, others to email). Requires BCS-DEF-5-TG first.

---

## 11. Final trailer expectations

- **Sub-PR E** — `Codex-Paranoia: SUB-WAVE self-reviewed (epic bcs-def-5-teacher-reminders); epic-end review pending` + `Critical-Path-Touched: lib/admin/operator-settings.ts, scripts/lesson-reminder-dispatch.mjs` + `Skill-Used: /codex (manual diff pass)`.
- **Sub-PR F (epic close)** — `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)` + `Skill-Used: /codex-paranoia wave`.

— END OF DRAFT (awaiting `/codex-paranoia plan`) —
