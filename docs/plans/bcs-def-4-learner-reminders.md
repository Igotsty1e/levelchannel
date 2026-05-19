# BCS-DEF-4 — Lesson-start reminders for learner

**Status:** DRAFT 2026-05-18 (awaiting `/codex-paranoia plan`).
**Wave name:** `bcs-def-4-learner-reminders` (multi-PR epic — see §5 decomposition).
**Trigger:** Backlog item "BCS-DEF-4" (`ENGINEERING_BACKLOG.md:44`) — learner needs configurable advance pings (60/30/10 min default) before a booked slot's `start_at`. "Admin coverage required: per-channel master switch + default windows operator-editable." Mirror plan for teachers ships as **BCS-DEF-5** (out of scope here — see §10).
**Author:** Claude (autonomous).
**Channels:** **MVP = email only.** Telegram + push deferred to BCS-DEF-4-TG / BCS-DEF-4-PUSH (§10).

---

## 1. Goal

For every `booked` future `lesson_slots` row, deliver up to N (default 3) reminder emails to the learner at configurable offsets before `start_at` (defaults 60 / 30 / 10 minutes). Operator controls the master switch + the default offsets; learner overrides their own offsets + per-channel opt-in inside the cabinet.

Hard requirements:
- Idempotent — scheduler ticking twice never sends two reminders for the same (slot, channel, offset).
- Late-tick tolerant — if the scheduler misses a tick, the next tick still delivers any due reminder (with a "send_by deadline" cap to avoid sending a 10-min reminder 30 min after the lesson actually started).
- Best-effort against transient learner state — slot cancelled / learner email removed / package voided mid-flight → cancel pending reminder, NEVER send for a non-active slot.
- Per-user override: a learner who explicitly sets `[60, 10]` gets exactly those two, not the operator default.

Out of scope explicitly: telegram, push, teacher reminders (BCS-DEF-5), in-app banner reminders, calendar-invite ICS attachments.

## 1.1 Existing surface inventory — slot booking + lifecycle

Cited against `main` HEAD as of 2026-05-18.

- **`lib/scheduling/slots/booking.ts:108-309`** `bookSlot(slotId, learnerAccountId, actor, options)` — atomic `update lesson_slots set status='booked', learner_account_id=$2, booked_at=now()` re-asserting `status='open' AND start_at > now()` AND optional teacher-pin AND busy-overlap gate. Returns `BookSlotResult`. **This is the canonical "slot booked" success path.** A learner who books a slot reaches this function exactly once per slot transition (re-bookings of a cancelled-and-re-opened slot go through it again).
- **Route call-site:** `app/api/slots/[id]/book/route.ts:30-175` — the POST handler. After `bookSlot` returns `ok: true`, the route fire-and-forgets `enqueueCreatePushIfIntegrationActive` (calendar push to Google). **Reminder scheduling would land at the same fire-and-forget seam (`app/api/slots/[id]/book/route.ts:91-105` after the calendar-push enqueue) — symmetric shape, identical failure tolerance.**
- **Admin "book as operator"** path: a separate route `/api/admin/slots/[id]/book-as-operator` (referenced from `app/api/slots/[id]/book/route.ts:71-74` comment). Reminders must fire on that path too — both routes must enqueue.
- **Schema:** `migrations/0020_lesson_slots.sql:34-78` defines `lesson_slots` (id, teacher_account_id, learner_account_id, start_at, duration_minutes, status, booked_at, cancelled_at, events JSONB). `learner_account_id` is the join key for "who gets this reminder". `start_at` is UTC `timestamptz`.
- **Cancellation:** `lib/scheduling/slots/mutations-cancel.ts` (sibling) flips `status='cancelled'` and stamps `cancelled_at`. Reminder scheduler MUST gate on `status='booked'` at send time (not just enqueue time), so a cancelled mid-flight slot drops the pending row.
- **`events JSONB`** column: `migrations/0020_lesson_slots.sql:46` — append-only audit trail of slot transitions. Reminder send events could be appended here (one row per channel per send), giving the cabinet a "reminder history" surface for free. **Decision in §2.5: NO — reminder telemetry lives on its own per-slot-per-channel table, NOT inlined into `events` (keep `events` lean; reminders are operational, not booking-state-transition events).**

## 1.2 Existing surface inventory — alert / cron probe shape

This plan adopts the **stateful sibling-probe shape** the codebase has converged on across 4 alert probes (auth-flow, calendar-pathology, webhook-flow, conflict-unresolved). Specifically:

- Pure `.mjs` script in `scripts/`, no `@/` imports, ESM-only.
- Per-tick `resolveOperatorSettingsForProbe(pool, '<probe>')` snapshot (`scripts/lib/operator-settings.mjs` mirrors `lib/admin/operator-settings.ts SETTING_SCHEMA`). All thresholds are immutable for the tick.
- `recordProbeRun(pool, params)` (`scripts/lib/probe-runs.mjs:70-104`) writes a best-effort observability row per tick.
- Boot-relative systemd timer with `OnBootSec=Nmin` + `OnUnitActiveSec=Mmin`, mirroring `scripts/systemd/levelchannel-conflict-unresolved-alert.timer:14-21`.
- `if (invokedDirectly) { main() }` guard at the bottom so helpers are unit-testable as named exports.
- Sandbox profile: 12 directives mirrored from `scripts/systemd/levelchannel-conflict-unresolved-alert.service:36-54`.

**Critical difference from alert probes:** alert probes are alert-storm-dedup primitives (single email if a stable offender set persists). Reminders are NOT alerts — every (slot, channel, offset) is a unique transactional send. So this probe is "scheduler-on-cron" shape, not "alert-on-cron" shape: state is in the DB (the queue table) not a fingerprint state file.

## 1.3 Existing surface inventory — email dispatch

- **`lib/email/dispatch.ts:44-134`** — the canonical `sendXxxEmail(to, payload)` shape. Routes through `lib/email/client.ts:39-69 sendEmail()` which wraps Resend and falls back to `console.log` when `RESEND_API_KEY` is unset.
- **Templates** live in `lib/email/templates/*.ts`. Each exports `renderXxxEmail(params)` returning `{ subject, text, html }`. Plain inline HTML; no template engine. `lib/email/escape.ts escapeHtml(s)` is the standard for any user-supplied content.
- **Send result:** `SendEmailResult` (`lib/email/client.ts:17-19`) — `{ok: true, transport: 'resend'|'console'} | {ok: false, transport, error}`. Caller decides whether to retry / record / swallow.

The new template lives at `lib/email/templates/learner-lesson-reminder.ts`. The new dispatch helper `sendLearnerLessonReminder(to, params)` lands in `lib/email/dispatch.ts`.

## 1.4 Existing surface inventory — operator settings + UI

- **`lib/admin/operator-settings.ts:17-31`** `ProbeName` literal union (already widened with `'conflict-unresolved'` in PR #283-equivalent). **Adding `'learner-reminders'` widens this union.**
- **`SETTING_SCHEMA`** (`lib/admin/operator-settings.ts:59-196`) — typed whitelist; each entry is `{kind:'int'|'decimal', default, min, max, envName, description, scope:ProbeName}`. **Adding ~5 keys with `scope: 'learner-reminders'`** (see §1.5 + §2.3).
- **`scripts/lib/operator-settings.mjs`** — ESM mirror. Drift test pins JSON.stringify equality.
- **Admin alerts page** `app/admin/(gated)/settings/alerts/page.tsx` + `lib/admin/probe-status.ts` + the `PROBE_NAMES` array iterated in the alerts UI. The conflict-unresolved precedent (`docs/plans/conflict-unresolved-alert.md §2.7`) is the exact template for extending all 5 UI touchpoints.

**Wave decision:** `learner-reminders` is NOT an "alert probe" — it's a scheduler. The `operator_settings` table is the right home for the per-channel knobs (master switch, default windows, rate-limit), but `/admin/settings/alerts` is the wrong surface (it's a probe-observability page, not a feature-config page). **New admin surface lives at `/admin/settings/reminders`** (matches the `admin-ux-coverage.md §5.4` proposal). It still reads/writes through `lib/admin/operator-settings.ts` — the `scope: 'learner-reminders'` keys just don't render in `/admin/settings/alerts`.

To keep type-level consistency, the `ProbeName` union widens to `ProbeName | 'learner-reminders'`. Probe-status iteration in `lib/admin/probe-status.ts:15-19 PROBE_NAMES` STAYS at the 4 alert-probe entries; `learner-reminders` is excluded from that iteration via a code comment + a test that pins the exclusion. Alternative considered: split the type — `type SettingScope = ProbeName | 'learner-reminders'` — REJECTED because it cascades into 6 files; the comment + test is cheaper.

## 1.5 Existing surface inventory — admin coverage tracking (`docs/plans/admin-ux-coverage.md`)

`docs/plans/admin-ux-coverage.md §3.4 + §5.4` explicitly calls out reminder cadences as an admin prereq. **This plan claims and discharges those gaps**:

- §3.4 ("reminder cadences ... MUST be operator-editable from `/admin`") — closed by §2.3 operator-settings keys.
- §5.4 ("Reminder cadence + channel switch editor ... `/admin/settings/reminders`") — closed by §2.6 new admin page.

`admin-ux-coverage.md` itself gets a one-line "BCS-DEF-4 ships the reminders editor" cross-reference in this PR's documentation sweep (§5 file inventory).

## 1.6 Per-user preference data model (NEW SCHEMA CHOICE)

**Critical nuance per the task brief**: BCS-DEF-4 needs per-USER preferences. No existing per-user reminder surface. Two options weighed:

**Option A — Columns on `account_profiles`** (`migrations/0017_account_profiles.sql:24-35`). Add `reminder_offsets_minutes integer[]` + `reminder_email_opt_in boolean` + `reminder_updated_at`. **Cons:** mixes identity (display_name, timezone, locale) with feature-flag fields; BCS-DEF-5 teacher mirror duplicates 3 more columns; per-channel growth (TG/push opt-in) keeps bloating it. Migrating offset shape (`[{minutes, channels[]}]`) forces JSONB or schema churn.

**Option B — New table `learner_reminder_preferences`** with `account_id PK → accounts(id) on delete cascade`, `offsets_minutes integer[] not null default array[60,30,10]`, `email_opt_in boolean not null default true`, plus a table-level CHECK pinning cardinality ≤5 AND allowed-values whitelist (defends against `array[1000000]`). **Cons:** one extra `LEFT JOIN` per scheduler query (negligible against slot-table scan). **Pros:** single-concern; teacher mirror is a sibling table not a column duplication; channel growth doesn't pollute profiles.

**Decision: Option B.** `account_profiles` is approaching identity-only; BCS-DEF-5 cleanly mirrors via `teacher_reminder_preferences`. **Default semantics**: missing row = "use operator defaults from `operator_settings`"; explicit row with `offsets_minutes='{}'` (valid per CHECK) = "explicit opt-out". Both honoured by §2.4.

## 1.7 Existing surface inventory — cabinet preference editor

There is NO existing learner-side "notifications" surface. The new cabinet page lives at **`/cabinet/settings/reminders`** (mirrors `app/cabinet/settings/calendar/page.tsx` placement). UI: a checkbox per default offset (60/30/10/15/5 — pinned to the CHECK allowlist) + an "email reminders ON" toggle. A reset-to-defaults button clears the row (delete-by-account_id) so the learner falls back to operator default.

No /api route required if the page submits via a Server Action; we'll mirror the `profile-editor` pattern from `app/cabinet/profile/page.tsx:13` (uses `<ProfileEditor>` client component + Server Action). **Decision: Server Action for simplicity.** Per-key rate-limit at 10 req/min/account (via `enforceRateLimit` from `lib/security/request`).

## 1.8 Critical-path inventory

Per `docs/critical-path.md`:
- **`lib/scheduling/slots/booking.ts`** is on critical path. **This plan adds NO logic to `bookSlot` itself.** The reminder enqueue is a separate fire-and-forget call in the route after `bookSlot` returns success — identical seam to `enqueueCreatePushIfIntegrationActive` at `app/api/slots/[id]/book/route.ts:91-105`.
- **`lib/admin/operator-settings.ts`** is on critical path. This plan adds 5 keys + widens `ProbeName` — additive.
- **`lib/email/dispatch.ts`** is on critical path. This plan adds one new sender — additive.

Sub-PRs that touch only `lib/admin/operator-settings.ts` carry `Codex-Paranoia: SUB-WAVE self-reviewed (epic bcs-def-4-learner-reminders); epic-end review pending`. The epic-close PR (last sub-PR) carries `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`.

---

## 2. Design

### 2.1 High-level shape — polling cron vs queue-based dispatch

**Decision: polling cron, every 1 minute, against a per-slot-per-offset DB queue.**

Considered:

| Shape | Pros | Cons |
|---|---|---|
| **A. Polling cron, every 1 min, no queue table** — at each tick query `lesson_slots` directly + compute due reminders inline. | Zero schema cost. | No idempotency primitive; "did we already send?" requires a side table anyway. Wide-net query scans the booked-future-slots set every minute. |
| **B. Polling cron, every 1 min, with a `learner_reminder_dispatches` queue.** | Idempotent (UNIQUE(slot_id, offset_minutes, channel)). Late-tick recovery natural. Cheap query (only PENDING-and-due rows). Operator can see a queue. | Adds one table + an enqueue path on book. |
| **C. Queue-based with a job worker (pg-boss / BullMQ-style).** | "Real" job queue, retry semantics built-in. | LevelChannel doesn't run a job worker today — every async task is a cron + DB queue (calendar push/pull jobs, lifecycle intents). Adopting a job-queue lib here would be the first such introduction and out of scope for a deferred-notification feature. |
| **D. Per-slot Postgres NOTIFY at enqueue time + LISTEN'er.** | Real-time. | Requires a long-running process; LevelChannel has no such surface. |

**Picked B.** Mirrors the existing cron+queue pattern in `lib/calendar/push-worker` / `lib/calendar/pull-worker` / `slot_lifecycle_intents` (`migrations/0047`). Operator can list / inspect pending dispatches; idempotency lives in the table.

**Cron cadence: every 1 minute** with `OnBootSec=3min, OnUnitActiveSec=1min`. Justification:
- Offset precision is `±cadence`. Operator-defaults of `60/30/10` minutes tolerate a 1-min jitter (a "60-min reminder" arriving 59-61 min before lesson is fine).
- Finer cadence (every 30s) is overkill — Next.js + Postgres + Resend chain has more jitter than 1 min anyway.
- Coarser cadence (every 5 min) breaks the 10-min reminder if the scheduler ticks at T-12 then T-7 — the row is sent at T-7 (3 min late vs nominal T-10), still acceptable but uglier UX. **Pick 1 min for the cleanest UX.**

### 2.2 New migration — `learner_reminder_preferences` + `learner_reminder_dispatches`

**Migration 0059 — preferences table.**

```sql
-- BCS-DEF-4 (2026-05-XX) — per-learner reminder offset + channel toggle.
-- Plan: docs/plans/bcs-def-4-learner-reminders.md §1.6 (Option B chosen).
-- Per-teacher mirror (BCS-DEF-5) lands as 0060_teacher_reminder_preferences.

create table if not exists learner_reminder_preferences (
  account_id uuid primary key references accounts(id) on delete cascade,
  offsets_minutes integer[] not null default array[60, 30, 10]::integer[],
  email_opt_in boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint lrp_offsets_bounded
    check (
      cardinality(offsets_minutes) between 0 and 5
      and offsets_minutes <@ array[1440, 720, 360, 240, 180, 120, 90, 60, 45, 30, 20, 15, 10, 5]
    )
);

-- No hot-path index needed: the only read site is by-PK (the scheduler
-- joins learner_account_id → preferences) which uses the primary key.
```

**Migration 0061 — dispatch queue (separate from prefs so deploy ordering is independent).**

```sql
-- BCS-DEF-4 (2026-05-XX) — per-slot-per-offset-per-channel reminder
-- dispatch queue. One row inserted at slot-booking time; row updated
-- to status='sent' once the scheduler runs the send.
-- Plan: docs/plans/bcs-def-4-learner-reminders.md §2.5.

create table if not exists learner_reminder_dispatches (
  id bigserial primary key,
  slot_id uuid not null references lesson_slots(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  channel text not null check (channel in ('email')),  -- expand on BCS-DEF-4-TG / -PUSH
  offset_minutes integer not null
    check (offset_minutes in (1440, 720, 360, 240, 180, 120, 90, 60, 45, 30, 20, 15, 10, 5)),
  due_at timestamptz not null,           -- start_at - offset_minutes
  send_by_at timestamptz not null,       -- due_at + reminder_late_tolerance (op-tunable; e.g. due + 5 min)
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'skipped', 'cancelled')),
  skipped_reason text null
    check (skipped_reason is null or skipped_reason in (
      'slot_no_longer_booked', 'learner_opted_out', 'email_missing',
      'past_send_by', 'channel_disabled_by_operator'
    )),
  sent_at timestamptz null,
  resend_email_id text null,
  attempts integer not null default 0,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lrd_status_consistency
    check (
      (status = 'sent' and sent_at is not null)
      or (status = 'skipped' and skipped_reason is not null)
      or (status in ('pending', 'cancelled'))
    )
);

-- Idempotency: only ONE row per (slot, offset, channel). Enqueue uses
-- INSERT ... ON CONFLICT DO NOTHING.
create unique index if not exists lrd_slot_offset_channel_unique
  on learner_reminder_dispatches (slot_id, offset_minutes, channel);

-- Hot path: scheduler tick picks pending+due rows.
create index if not exists lrd_pending_due_idx
  on learner_reminder_dispatches (due_at)
  where status = 'pending';
```

### 2.3 Operator settings — 5 new keys

Extend `lib/admin/operator-settings.ts:59` SETTING_SCHEMA AND `scripts/lib/operator-settings.mjs`. The new `scope: 'learner-reminders'` requires `ProbeName` widening to `... | 'learner-reminders'`.

```ts
LEARNER_REMINDERS_EMAIL_ENABLED: {
  kind: 'int',  // 0/1 — operator-controlled master switch for the email channel
  default: 1,
  min: 0,
  max: 1,
  envName: 'LEARNER_REMINDERS_EMAIL_ENABLED',
  description: 'master switch (1=on/0=off) for learner email reminders',
  scope: 'learner-reminders',
},
LEARNER_REMINDERS_DEFAULT_OFFSETS_CSV: {
  // Stored as comma-joined ints (e.g. "60,30,10"). The single int validator
  // is wrong here — but the SETTING_SCHEMA only knows int/decimal today.
  // **DECISION (Q1 in §9): extend SETTING_SCHEMA with a 'csv-ints' kind**
  // OR encode as a packed integer (e.g. concat). The csv-ints kind is the
  // honest answer; see §2.3.1 for the schema extension.
  kind: 'csv-ints',
  default: '60,30,10',
  envName: 'LEARNER_REMINDERS_DEFAULT_OFFSETS_CSV',
  description: 'fallback offset list for learners without an explicit preference (CSV of ints from the allowlist {5,10,15,20,30,45,60,90,120,180,240,360,720,1440})',
  scope: 'learner-reminders',
  allowedValues: [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440],
  maxCardinality: 5,
},
LEARNER_REMINDERS_LATE_TOLERANCE_MINUTES: {
  kind: 'int',
  default: 5,
  min: 1,
  max: 30,
  envName: 'LEARNER_REMINDERS_LATE_TOLERANCE_MINUTES',
  description: 'if scheduler ticks late, max minutes past due_at before a reminder is dropped as "past_send_by"',
  scope: 'learner-reminders',
},
LEARNER_REMINDERS_RATE_LIMIT_PER_TICK: {
  kind: 'int',
  default: 200,
  min: 1,
  max: 5000,
  envName: 'LEARNER_REMINDERS_RATE_LIMIT_PER_TICK',
  description: 'max reminder emails dispatched per scheduler tick (defends Resend quota)',
  scope: 'learner-reminders',
},
LEARNER_REMINDERS_MAX_ATTEMPTS: {
  kind: 'int',
  default: 3,
  min: 1,
  max: 10,
  envName: 'LEARNER_REMINDERS_MAX_ATTEMPTS',
  description: 'on Resend failure, retry up to this many ticks before giving up (status stays pending with last_error)',
  scope: 'learner-reminders',
},
```

### 2.3.1 SETTING_SCHEMA `'csv-ints'` kind extension

The `LEARNER_REMINDERS_DEFAULT_OFFSETS_CSV` key needs a new validator. Add a 3rd `SettingSchemaCsvInts` variant:

```ts
type SettingSchemaCsvInts = {
  kind: 'csv-ints'
  default: string                  // canonical CSV (e.g. "60,30,10")
  envName: string
  description: string
  scope: ProbeName
  allowedValues: readonly number[]
  maxCardinality: number
}

function validateCsvInts(schema, raw: string): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return ''         // valid: opt-out CSV
  const parts = trimmed.split(',').map((p) => p.trim())
  if (parts.length > schema.maxCardinality) return null
  const nums: number[] = []
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null
    const n = Number(p)
    if (!schema.allowedValues.includes(n)) return null
    if (nums.includes(n)) return null         // no duplicates
    nums.push(n)
  }
  // Canonical form = sorted descending then joined.
  return nums.sort((a, b) => b - a).join(',')
}
```

Resolver returns `value: string` for csv-ints (not number). The probe scripts that read it call `.split(',').map(Number)`.

### 2.4 Reminder scheduler — `scripts/learner-reminder-dispatch.mjs`

ESM, no `@/`. Boot-relative timer (3-min offset; 1-min cadence). Stateless beyond the DB queue.

Tick anatomy:

```
1. Resolve operator settings snapshot via resolveOperatorSettingsForProbe('learner-reminders').
2. If LEARNER_REMINDERS_EMAIL_ENABLED == 0 → recordProbeRun({verdictKind: 'channel_disabled_by_operator'}); exit.
3. Reconcile-enqueue (idempotent for recently-booked slots; closes the gap when the route's fire-and-forget enqueue lost a row):
     INSERT INTO learner_reminder_dispatches (slot_id, account_id, channel, offset_minutes, due_at, send_by_at)
       SELECT s.id, s.learner_account_id, 'email', o.offset_minutes,
              s.start_at - (o.offset_minutes * interval '1 minute'),
              s.start_at - (o.offset_minutes * interval '1 minute') + (lateTolerance * interval '1 minute')
       FROM lesson_slots s
       LEFT JOIN learner_reminder_preferences p ON p.account_id = s.learner_account_id
       CROSS JOIN LATERAL (
         SELECT unnest(coalesce(p.offsets_minutes, $1::integer[])) AS offset_minutes
       ) o
       WHERE s.status = 'booked'
         AND s.start_at > now()
         AND (p.email_opt_in IS NULL OR p.email_opt_in = true)
       ON CONFLICT (slot_id, offset_minutes, channel) DO NOTHING;
   (Caveat: bounded to slots whose start_at is within the next 48h to keep
   the scan cheap.)
4. SELECT pending+due rows (limit = LEARNER_REMINDERS_RATE_LIMIT_PER_TICK):
     SELECT ... FROM learner_reminder_dispatches
       WHERE status = 'pending' AND due_at <= now()
       ORDER BY due_at ASC
       LIMIT $rateLimit
       FOR UPDATE SKIP LOCKED;
5. For each row, in its own short TX (one bad row doesn't block batch):
   5a. Re-fetch slot in TX. Skip with reason if: status != 'booked' (`slot_no_longer_booked`); start_at <= now() OR due_at + lateTolerance < now() (`past_send_by`); email empty (`email_missing`); prefs email_opt_in=false (`learner_opted_out`).
   5b. Else call sendLearnerLessonReminder. On ok → status='sent', sent_at, resend_email_id. On fail with attempts < maxAttempts → attempts++, last_error, stay 'pending'. **Decision: NEVER auto-promote to 'skipped' on Resend failure** — keep 'pending' with `attempts` visible to operator. Manual /admin button (out of scope) can finalize. Avoids irreversible drop on transient Resend incident.
6. Aggregate stats → recordProbeRun({verdictKind: 'ok', stats}).
```

### 2.5 Idempotency / dedup

- **Enqueue idempotency** — `UNIQUE (slot_id, offset_minutes, channel)`. Both fire-and-forget route enqueue AND reconcile-enqueue use `ON CONFLICT DO NOTHING`.
- **Send idempotency** — `FOR UPDATE SKIP LOCKED` + `status='pending'` precondition. Two concurrent ticks cannot grab the same row.
- **Slot transition gating** — re-fetch slot inside per-row TX (5a). Cancelled-mid-flight → `slot_no_longer_booked`.

### 2.6 Admin surface — `/admin/settings/reminders`

NEW page. Mirrors the conflict-feed precedent (single read of `operator_settings` keys with `scope='learner-reminders'`, form-based editor, optimistic concurrency via `expectedUpdatedAt` per `lib/admin/operator-settings.ts:347-437 setOperatorSetting`).

UI elements:
- **Email master switch** (toggle): writes `LEARNER_REMINDERS_EMAIL_ENABLED` 0/1.
- **Default offsets** (multi-select against the 14-value allowlist; max 5 selected): writes `LEARNER_REMINDERS_DEFAULT_OFFSETS_CSV` as canonical CSV.
- **Late-tolerance**: number input 1-30, writes `LEARNER_REMINDERS_LATE_TOLERANCE_MINUTES`.
- **Rate limit per tick**: number input 1-5000, writes `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK`.
- **Max retry attempts**: number input 1-10, writes `LEARNER_REMINDERS_MAX_ATTEMPTS`.
- **Recent dispatch summary** (read-only): the 5 most recent `probe_runs` rows for `probe_name='learner-reminders'` showing tick verdict + stats. Same fetch pattern as `/admin/settings/alerts`.

POST handler: re-uses `app/api/admin/settings/alerts/setting/[key]` POST/DELETE route (already validates against `SETTING_SCHEMA`, gated by admin role).

### 2.7 Timezone semantics

`lesson_slots.start_at` is UTC `timestamptz` (`migrations/0020_lesson_slots.sql:37`). Reminders fire at `start_at - offset` minutes UTC — i.e. the **absolute wall-clock moment N minutes before the lesson begins**, irrespective of learner timezone. Examples:
- Slot at `2026-06-01 15:00 MSK` (12:00 UTC). 60-min reminder fires at `2026-06-01 14:00 MSK` (11:00 UTC). A learner in `Asia/Yekaterinburg` (UTC+5) gets the email at 16:00 local — still 1 hour before their lesson starts at 17:00 local. **Correct.**

The email body renders the slot time in the learner's `account_profiles.timezone` (`migrations/0017_account_profiles.sql:27` allows null). If null, fall back to `Europe/Moscow` (matches `migrations/0048_account_profiles_timezone_backfill.sql:36-44` allowlist precedent). Template helper inlined:

```ts
function renderLocalStart(startAt: Date, learnerTimezone: string | null): string {
  const tz = learnerTimezone ?? 'Europe/Moscow'
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(startAt)
}
```

The subject line + text body both surface the learner-local time AND the timezone label, so the learner sees `2026-06-01 17:00 (Asia/Yekaterinburg, UTC+5)` not just `15:00`.

### 2.8 Email template — `lib/email/templates/learner-lesson-reminder.ts`

```
Subject: Через ~60 мин — урок с преподавателем на LevelChannel

Здравствуйте.

У вас занятие на LevelChannel через ~60 минут.

   Когда: 2026-06-01 17:00 (Asia/Yekaterinburg, UTC+5)
   Длительность: 60 минут
   Ссылка для входа: https://meet.google.com/xxx-yyyy-zzz   ← from lesson_slots.zoom_url
   Моё расписание: https://levelchannel.ru/cabinet#mine

Получили это письмо случайно или хотите изменить расписание напоминаний?
   → https://levelchannel.ru/cabinet/settings/reminders

— LevelChannel
```

Subject template params: `offset_minutes`, `display_name?` (learner's display_name if set, otherwise nothing). The `~60 мин` rounds to the nominal offset, not the actual delay — even if the scheduler ticks 4 min late, the email still says "~60 мин".

The opt-out / settings link is the soft-unsubscribe surface (no separate unsubscribe token wave 1 — the cabinet page is the explicit control). **Hard unsubscribe (mailto: List-Unsubscribe header) deferred to BCS-DEF-4-UNSUB** (§10) once we have any unauthenticated unsubscribe primitive in the codebase.

Zoom URL inclusion: `lesson_slots.zoom_url` (`migrations/0056_lesson_slots_zoom_url.sql`) is the teacher's "join here" URL. If empty, the line is omitted entirely.

### 2.9 Systemd unit

`scripts/systemd/levelchannel-learner-reminder-dispatch.{service,timer}`. Same 12-directive sandbox as `levelchannel-conflict-unresolved-alert.service`. ReadWritePaths includes `__LEVELCHANNEL_APP_DIR__/var` (no state file is written today, but the directive is symmetric with siblings and trivial to keep aligned in case a state file is added).

`.timer`:
```ini
[Unit]
Description=Run LevelChannel learner reminder dispatcher every minute

[Timer]
# Boot offset 3 min: stagger against the 4 alert probes (5/7/12 + the
# calendar-pathology fixed-time timer). 1-min cadence per docs/plans/
# bcs-def-4-learner-reminders.md §2.1.
OnBootSec=3min
OnUnitActiveSec=1min
Persistent=true
Unit=levelchannel-learner-reminder-dispatch.service

[Install]
WantedBy=timers.target
```

Also add to `scripts/activate-prod-ops.sh:247-277 units=()` and `:310-324 timers=()` allowlists (exact pattern from `docs/plans/conflict-unresolved-alert.md §2.8`).

### 2.10 `probe_runs.probe_name` CHECK extension

Migration 0062 — additive ALTER. Same idiom as `migrations/0058_probe_runs_conflict_unresolved.sql`:
```sql
alter table probe_runs
  drop constraint if exists probe_runs_probe_name_check;
alter table probe_runs
  add constraint probe_runs_probe_name_check
  check (probe_name in (
    'auth-flow', 'calendar-pathology', 'webhook-flow',
    'conflict-unresolved', 'learner-reminders'
  ));
```

`scripts/lib/probe-runs.mjs PROBE_NAMES` gets `LEARNER_REMINDERS: 'learner-reminders'`.

`VERDICT_KINDS` already covers `ok`, `error`, `config_missing`. Add `channel_disabled_by_operator` to the constant + to the migration's `verdict_kind` CHECK if it's enumerated there. (Confirmed in `scripts/lib/probe-runs.mjs:37-51` — `VERDICT_KINDS` is the source of truth; the migration's CHECK must mirror. **§5 file inventory carries the corresponding migration ALTER**.)

---

## 3. Tests

Fixture-driven, mirrors `tests/integration/scripts/conflict-unresolved-alert.test.ts` shape.

### 3.1 Unit — `tests/admin/operator-settings.test.ts`

- 5 new keys present in `SETTING_SCHEMA` with the expected kind/min/max/scope.
- `'csv-ints'` kind validator round-trip: `validateCsvInts({allowedValues:[5,10,30,60], maxCardinality:3}, '60,30,10') === '60,30,10'`.
- Canonicalization: `validateCsvInts(... , '10, 30, 60 ') === '60,30,10'`.
- Reject duplicate: `validateCsvInts(... , '60,60,30') === null`.
- Reject out-of-allowlist: `validateCsvInts(... , '7') === null`.
- Reject over-cardinality.

### 3.2 Drift — `tests/admin/operator-settings.test.ts`

Existing drift pin (TS-side ↔ `.mjs` mirror JSON.stringify) extends to the new 5 keys automatically by walking SETTING_SCHEMA. Add explicit assertion that `learner-reminders` scope is recognised.

### 3.3 Integration — preferences write path

`tests/integration/cabinet/reminder-preferences.test.ts`:
- POST Server Action with valid `offsets_minutes=[60,30,10]` → row exists; idempotent on second submit.
- POST with empty array → row exists with `offsets_minutes='{}'`; learner is opted-out for offsets but `email_opt_in` independent.
- POST with `offsets_minutes=[7]` → 400 (CHECK violation, surface as form error).
- POST with cardinality 6 → 400.
- POST as unauthenticated → redirect to /login.
- POST as teacher → 403 (learners-only surface this wave; teacher mirror lands in BCS-DEF-5).

### 3.4 Integration — scheduler

`tests/integration/scripts/learner-reminder-dispatch.test.ts`:
- Slot at T+90, defaults [60,30,10]. Tick at T → 3 pending rows. Ticks at T+30/+60/+80 send (60/30/10) in order.
- Tick after slot start with straggler row → `skipped_reason='past_send_by'`.
- Cancellation race: cancel at T+59, tick at T+60 → `slot_no_longer_booked`.
- Master switch off → no Resend calls, `verdict_kind='channel_disabled_by_operator'`.
- Per-learner custom offsets `[15]` honoured; operator default ignored.
- `email_opt_in=false` → reconcile-enqueue gates BEFORE insert (queue stays lean).
- Resend transient failure: attempts++, status stays 'pending'; next tick retries.
- Rate limit per tick: seed 250 + rate=200 → 200 consumed, 50 left for next tick.
- Late tolerance: row due at T, tick at T+10 with tolerance=5 → `past_send_by`.
- ON DELETE CASCADE: deleting accounts row cascade-deletes dispatch rows.

### 3.5 Integration — booking-route enqueue seam

`tests/integration/slots/book-enqueues-reminders.test.ts`:
- Book a slot via POST `/api/slots/[id]/book` → 3 (or N per learner's prefs) rows in `learner_reminder_dispatches` (status='pending') for that (slot, learner) pair.
- Admin-side `/api/admin/slots/[id]/book-as-operator` → same enqueue happens.

### 3.6 Integration — admin settings page

`tests/integration/admin/reminders-settings-page.test.ts`:
- GET as admin → page renders, current values from `operator_settings` or defaults.
- POST master-switch off → next scheduler tick honours it.
- POST with malformed CSV → 400 + form-level error, no DB write.

### 3.7 Unit — email template

`tests/email/learner-lesson-reminder.test.ts`:
- Subject contains the nominal `~N мин`.
- Body contains learner-local time + tz label.
- Body omits zoom-url line when `zoomUrl` is null.
- Settings page link is `/cabinet/settings/reminders`.
- HTML body escapes any user-supplied content (display_name, zoomUrl) via `escapeHtml`.

---

## 4. Security analysis

### 4.1 Email content boundaries

The reminder body contains:
- Learner's display_name (from `account_profiles.display_name`, optional, max 60 chars — `migrations/0017_account_profiles.sql:32`). escapeHtml-ed.
- Slot start time, duration.
- Teacher's zoom-url (from `lesson_slots.zoom_url`, validated https-only ≤512 chars by the DB CHECK from `migrations/0056_lesson_slots_zoom_url.sql`). escapeHtml-ed.
- The reminder-settings deep-link (static, no user data).

**No teacher PII** in the body — the learner can already see their teacher via `/cabinet#mine`, so adding teacher email/name to the reminder is no incremental disclosure, but we omit it for cleanliness.

### 4.2 Recipient is the learner's verified email

`accounts.email` is the canonical send target. The scheduler skips when `email` is null/empty. **Email verification status is NOT a precondition** — a booked slot already requires `requireLearnerArchetypeAndVerified` at the route level (`app/api/slots/[id]/book/route.ts:39`), so any learner whose row landed in the dispatch queue was verified at book-time. We don't re-check at send time to avoid the edge case where a learner's verification was administratively revoked between book and reminder; in that case the operator already has a "you need to re-verify" path and the reminder leaking through is a minor noise issue, not a security issue.

### 4.3 Rate-limit / abuse

- `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK` (default 200) caps how many emails leave per tick.
- Resend's own per-account rate limit is the upstream cap.
- A pathological case (operator sets 5000 + 5000 learners book in one minute) is bounded by the operator setting; the queue just lengthens for several ticks. No exhaustion of Resend free tier in one shot.

### 4.4 SQL injection

All scheduler queries are parameterised. The `offsets_minutes` array passed from prefs is a Postgres `integer[]` typed column — no string interpolation. The CSV operator setting is parsed in-process to `number[]` before passing to `unnest`.

### 4.5 Cross-account leakage

`UNIQUE (slot_id, offset_minutes, channel)` does NOT enforce per-account uniqueness. But `slot_id → learner_account_id` is 1:1 (a slot has one learner). So a row's `account_id` is structurally derivable from the slot. The scheduler still stores it explicitly so the `ON DELETE CASCADE` on `accounts(id)` chains correctly.

### 4.6 Migration ACCESS EXCLUSIVE locks

- 0059 (preferences) — new table; no existing-table locks.
- 0061 (dispatches) — new table; no existing-table locks.
- 0062 (probe_runs CHECK extend) — ACCESS EXCLUSIVE briefly on probe_runs. Same shape as 0058; accepted (best-effort writer swallows).

---

## 5. Decomposition — multi-PR epic

### Sub-PR A — Schema foundation (NO behaviour change)
- `migrations/0059_learner_reminder_preferences.sql` (NEW)
- `migrations/0061_learner_reminder_dispatches.sql` (NEW)
- `migrations/0062_probe_runs_learner_reminders.sql` (NEW — CHECK extend)
- `lib/admin/operator-settings.ts` (ProbeName widen + 5 keys + 'csv-ints' validator)
- `scripts/lib/operator-settings.mjs` (mirror)
- `scripts/lib/probe-runs.mjs` (PROBE_NAMES + verdict_kinds)
- Tests: §3.1, §3.2.
- **Trailer**: `Codex-Paranoia: SUB-WAVE self-reviewed (epic bcs-def-4); epic-end review pending`. **Critical-path touched**: `lib/admin/operator-settings.ts`.

### Sub-PR B — Scheduler skeleton + email template
- `scripts/learner-reminder-dispatch.mjs` (NEW)
- `lib/email/templates/learner-lesson-reminder.ts` (NEW)
- `lib/email/dispatch.ts` (new `sendLearnerLessonReminder`)
- `scripts/systemd/levelchannel-learner-reminder-dispatch.{service,timer}` (NEW)
- `scripts/activate-prod-ops.sh` (allowlist append)
- Tests: §3.4, §3.7. No booking-route wiring yet — exercised via direct queue seeding.
- **Trailer**: SUB-WAVE self-reviewed (touches no critical-path files).

### Sub-PR C — Booking-route enqueue + admin page
- `app/api/slots/[id]/book/route.ts` (fire-and-forget enqueue after success)
- `app/api/admin/slots/[id]/book-as-operator/route.ts` (same enqueue)
- `lib/reminders/enqueue.ts` (NEW; the shared enqueue helper called from both routes)
- `app/admin/(gated)/settings/reminders/page.tsx` (NEW)
- `app/admin/(gated)/settings/reminders/save-settings-form.tsx` (NEW — Server Action page)
- Tests: §3.5, §3.6.
- **Trailer**: SUB-WAVE self-reviewed (touches `app/api/slots/[id]/book/route.ts` which is critical-path-adjacent — verify in `docs/critical-path.md` first; trailer reflects).

### Sub-PR D — Learner cabinet page (epic close)
- `app/cabinet/settings/reminders/page.tsx` (NEW)
- `app/cabinet/settings/reminders/reminder-prefs-form.tsx` (NEW — Server Action form)
- `lib/auth/profiles.ts` extension (NEW `getLearnerReminderPreferences` / `setLearnerReminderPreferences`)
- Tests: §3.3.
- Docs: `ENGINEERING_BACKLOG.md` strikethrough BCS-DEF-4; `docs/plans/admin-ux-coverage.md` mark §3.4 / §5.4 done.
- **Trailer**: `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`. **Critical-path touched**: revisit per the epic diff.

Total estimated diff: ~2400 LOC across 4 sub-PRs. The PR-A round of paranoia covers the schema gate; PR-D epic-close paranoia wave covers the aggregated diff.

---

## 6. Risks + mitigations

### RISK-1 — Reminder storm if scheduler runs hot

Scheduler ticks every minute. If the reconcile-enqueue query bug-doubles rows somehow, the rate limit caps blast radius at `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK` per minute. Operator sees the queue length climb in `/admin/settings/reminders` (recent dispatch summary) and can flip the master switch off.

### RISK-2 — Missing reminders if scheduler ticks late

systemd `Persistent=true` ensures missed ticks fire on the next boot/wake. The `send_by_at = due_at + lateTolerance` window absorbs ≤5-min systemd jitter. A truly catastrophic outage (>5 min late) drops the row with `past_send_by`. **Accepted: a 10-min reminder that arrives at T-4 instead of T-10 is more confusing than not arriving at all** — the learner is already 4 min from their lesson, the reminder is moot.

### RISK-3 — Learner removes email mid-flight

If `accounts.email` is nulled (operator deletion / GDPR), the row at send-time gates on `email_missing`. Skipped with reason; queue stays clean.

### RISK-4 — Slot cancelled mid-flight

Step 5a re-fetch catches it; skipped with `slot_no_longer_booked`. **Race window**: a slot cancelled AFTER step 5a returns 'booked' but BEFORE Resend send completes will trigger a reminder for a cancelled slot. Window is ~hundreds of ms. **Accepted as a degenerate case** — the email body has the "Моё расписание" link, the learner clicks and sees no booked lesson; mild confusion, no harm.

### RISK-5 — Per-user preference mid-flight

A learner toggles `email_opt_in=false` between enqueue and send. The §2.4 step 5a re-check on `email_opt_in` catches it. Row → `skipped_reason='learner_opted_out'`.

### RISK-6 — Operator-default change mid-flight

Operator changes `LEARNER_REMINDERS_DEFAULT_OFFSETS_CSV` from `60,30,10` to `60,15`. Slots booked before the change have 3 enqueued rows already. **Decision: existing rows stand**; only newly-booked slots get the new defaults. The reconcile-enqueue clause won't reduce existing rows (it only INSERTs). **Operator can manually `delete from learner_reminder_dispatches where status='pending' and offset_minutes in (...)`** if they want retroactive shrinkage. Not exposed in admin UI in this wave.

### RISK-7 — Resend monthly quota

A 1000-learner / 30-day spike could exhaust Resend's free tier (~3000 emails/month). Rate-limit-per-tick caps tick-level burst but NOT month-aggregate. **Mitigation: ALERTS-OBS-style probe (out of scope here)** — operator-tunable threshold "alert me when daily reminder sends > N". Out of scope for this wave; documented as a follow-up.

### RISK-8 — Critical-path drift on `lib/admin/operator-settings.ts`

Sub-PR A adds 5 keys + a new `'csv-ints'` validator. The validator is the riskiest change (touches the resolver code path used by all 4 alert probes). **Mitigation: paranoia plan-mode covers the validator design; unit tests pin the round-trip behaviour; the canonicalization output is itself a regression-pin** (any future change to the canonicalization breaks the unit test, surfacing a deliberate decision).

### RISK-9 — `'csv-ints'` resolver-result type-narrowing

`resolveOperatorSetting()` returns `ResolvedSetting.value: number` today. For csv-ints, value would be `string`. **Two options**: (a) widen the return type to `number | string` with a discriminant, (b) special-case csv-ints with a separate `resolveOperatorCsvIntsSetting()` function. **Decision (Q2 in §9): pick (b)** — keeps the existing int/decimal resolver tight (it's on critical path) and gives csv-ints its own focused path. Sub-PR A adds both the schema entry AND the dedicated resolver.

---

## 7. Acceptance criteria (per sub-PR + epic)

- **A**: migrations 0059/0061/0062 apply; SETTING_SCHEMA keys validate; csv-ints round-trip green; `test:run` + `test:integration` + `build` green.
- **B**: scheduler against empty queue → `ok` with zero stats; against seeded queue sends (mocked Resend) + advances to 'sent'; master-switch off → no sends.
- **C**: booking enqueues N rows; admin "book as operator" enqueues likewise; admin page reads/writes 5 keys w/ optimistic concurrency.
- **D (epic close)**: cabinet page lets learner set 0-5 offsets + toggle email_opt_in; empty array opt-out honoured; BACKLOG strikethrough; `/codex-paranoia wave` SIGN-OFF round N/3.

Post-merge operator activation: `scripts/activate-prod-ops.sh` picks up timer+service; first tick within 1 min; admin sets master switch + default offsets at `/admin/settings/reminders`.

---

## 8. Migration / rollout

1. Sub-PRs A → B → C → D merge in order. A is independent (schema-only, no behaviour). B can ship without C (manual queue seeding for smoke testing). C activates the route enqueue. D shipped the learner-side surface.
2. After A merges, operator can pre-set knobs at `/admin/settings/alerts` (or wait until `/admin/settings/reminders` lands in C). Defaults are sane (`60,30,10`, master switch ON) so even with no operator config, the system works once C + D are live.
3. After D, `scripts/activate-prod-ops.sh` is run on the VPS to enable the new systemd unit. Until then, the cron is dormant on prod and reminders queue but never dispatch.
4. **First-tick safety:** when the systemd unit is enabled, the reconcile-enqueue catches up any already-booked future slots (limited to 48h forward) — first tick could enqueue many rows + send up to `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK` immediately. **Operator pre-action**: set master switch OFF at activation, monitor queue for ~1 hour, then enable. Documented in PR description.

---

## 9. Open questions for paranoia

**Q1.** Is `'csv-ints'` right, or should operator defaults live in a separate table? **Pre-answer:** csv-ints reuses operator_settings primitive (admin editor, audit log, drift test). A 3rd table is heavier.

**Q2.** Should the dedicated `resolveOperatorCsvIntsSetting()` resolver land in Sub-PR A or be deferred until B consumes it? **Pre-answer:** A — tests-as-spec alongside the schema entry.

**Q3.** Queue table cascade on `lesson_slots(id) ON DELETE` even though slots are never hard-deleted? **Pre-answer:** yes — defence in depth, cascade is free.

**Q4.** List-Unsubscribe header in the email? **Pre-answer:** no in MVP — cabinet page is the explicit opt-out. Unauthenticated unsubscribe is a separate attack surface; defer to BCS-DEF-4-UNSUB.

**Q5.** Rate limit as emails per Resend-account per hour instead of per-tick? **Pre-answer:** per-tick simpler + equally effective at instantaneous blast. Long-window quota → ALERTS-OBS follow-up.

**Q6.** Why polling every 1 minute, not enqueue-with-delayed-NOTIFY? **Pre-answer:** NOTIFY needs a listener LevelChannel doesn't run; polling matches `lib/calendar/pull-worker` + `slot_lifecycle_intents`.

**Q7.** Learner books 50 slots in a row? **Pre-answer:** 150 rows, well within rate limit (200/tick).

**Q8.** Per-slot user-customised offsets? **Pre-answer:** out of scope MVP. Defer to BCS-DEF-4-PER-SLOT.

**Q9.** Could reconcile-enqueue be a trigger on `lesson_slots` INSERT/UPDATE? **Pre-answer:** no — couples booking TX to reminder feature. Fire-and-forget + reconciliation is looser, same shape as `enqueueCreatePushIfIntegrationActive`.

**Q10.** Multi-tick race on a row? **Pre-answer:** `FOR UPDATE SKIP LOCKED` + `status='pending'` makes the row uncontended.

---

## 10. Out of scope — deferred follow-ups

- **BCS-DEF-4-TG** — Telegram channel. Needs bot setup + per-account chat_id linkage + admin surface. Mirror BCS-DEF-1-TG precedent.
- **BCS-DEF-4-PUSH** — PWA web push. Needs service worker + VAPID keys + subscription store.
- **BCS-DEF-5** — Teacher reminders. Sibling plan; mirrors this with `teacher_reminder_preferences` + parallel scheduler.
- **BCS-DEF-4-UNSUB** — List-Unsubscribe header + signed-token `/api/reminders/unsubscribe?t=...`. Unauthenticated surface; defer.
- **BCS-DEF-4-PER-SLOT** — Per-slot custom offsets (learner picks `[5]` for one specific lesson). Enqueue-time override.
- **BCS-DEF-4-VOL-ALERT** — Daily aggregate volume alert defending Resend quota. Mirrors `auth-flow-alert`.

---

## 11. Final trailer expectations

- **Sub-PRs A/B/C** — `Codex-Paranoia: SUB-WAVE self-reviewed (epic bcs-def-4-learner-reminders); epic-end review pending` + `Critical-Path-Touched: <files>` + `Skill-Used: /codex (manual diff pass)`.
- **Sub-PR D (epic close)** — `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)` + `Skill-Used: /codex-paranoia wave`.

— END OF DRAFT (awaiting `/codex-paranoia plan`) —
