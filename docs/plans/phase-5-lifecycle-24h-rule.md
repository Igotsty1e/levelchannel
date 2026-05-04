# Phase 5 — Lesson Lifecycle + 24h Rule

Status: **approved (proposed defaults) 2026-05-04**. Defaults below.
If anything is wrong, course-correct mid-wave; I'll update the doc.

## Why this wave exists

Phase 4 shipped the booking surface but stopped at the booked / cancelled
states. A real lesson lifecycle needs:

1. an explicit "lesson happened" state so the operator can see what
   actually got delivered;
2. a "no-show" path so attendance issues are tracked separately from
   ordinary cancellations;
3. a 24-hour rule on learner cancellations so the teacher's calendar
   doesn't get wiped at the last minute;
4. an automatic `completed` transition so the operator doesn't have
   to flip every past-end slot manually.

Phase 5 adds those without touching the booking flow itself.

## What ships

1. **Schema extension** (migration 0021) — add three new statuses
   to the `lesson_slots.status` CHECK constraint:
   `completed`, `no_show_learner`, `no_show_teacher`. New nullable
   column `marked_at` for when the lifecycle status was set.
2. **24h rule** on `POST /api/slots/[id]/cancel` (the learner-side
   route). If `actor='learner'` AND `start_at - now() < 24h`, refuse
   with 403 + `error: 'too_late_to_cancel'`. The cabinet UI surfaces
   the same hint before the click. Operator/admin paths
   (`/api/admin/slots/[id]/cancel`) bypass — operator emergencies
   override the rule.
3. **Auto-complete cron** — `scripts/auto-complete-slots.mjs` plus
   systemd unit + timer (daily at 03:30 UTC, before the daily
   retention cleanup). Finds rows with `status='booked'` AND
   `start_at + duration_minutes * interval '1 minute' <= now()` and
   flips them to `completed`. Idempotent; respects rows the operator
   already marked.
4. **Operator "mark" endpoint** — `POST /api/admin/slots/[id]/mark`
   with body `{ status: 'completed' | 'no_show_learner' | 'no_show_teacher' }`.
   Allowed only on `booked` rows whose `start_at` is in the past.
5. **Admin UI extension** at `/admin/slots`: every booked row whose
   start_at is in the past gets «Прошёл» / «Не пришёл (учащийся)» /
   «Не пришёл (учитель)» buttons.
6. **Cabinet UI extension**: «Мои уроки» now distinguishes upcoming
   from past, shows lifecycle status on past lessons.

## Not in scope

- Lesson recordings, video calls, materials — out of scope.
- Late-cancel credit / penalty logic — Phase 6 territory (alongside
  payment).
- Operator-side reschedule by drag-drop — out of scope; operator can
  cancel + create new.
- Bulk lifecycle marking — operator marks one slot at a time. If the
  workflow needs it, ship a follow-up.

## Decisions (proposed defaults — change if any are wrong)

| ID | Default | Notes |
|---|---|---|
| D1 | 24h hard refuse for learner cancel; operator/admin override | Threshold = 24 hours, not 12 / 48 / etc. |
| D2 | Daily cron auto-completes past-end slots; operator can override before cron via the «Прошёл» / «Не пришёл» buttons | Cron is idempotent; if operator flips a past booked slot to no_show, cron leaves it alone (status != booked) |
| D3 | Three new statuses: `completed`, `no_show_learner`, `no_show_teacher`. Only operator can set them | Learners only see status; cannot self-mark no-show |
| D4 | No reschedule endpoint. Learner cancels (>24h) and books a different slot | Phase 6 may add a paired-tx endpoint if a real workflow needs it |
| D5 | Threshold 24h, cron at 03:30 UTC | Cron fires when most lessons are over for the day in MSK |

## Schema

Migration 0021 — additive:

```sql
alter table lesson_slots
  drop constraint lesson_slots_status_check;

alter table lesson_slots
  add constraint lesson_slots_status_check
  check (status in (
    'open', 'booked', 'cancelled',
    'completed', 'no_show_learner', 'no_show_teacher'
  ));

alter table lesson_slots
  add column if not exists marked_at timestamptz null;
```

The `lesson_slots_booked_invariants` and `lesson_slots_cancelled_invariants`
constraints from migration 0020 are unchanged: a row in `completed` /
`no_show_*` retains its `learner_account_id` and `booked_at`, since
those describe a real attended-or-not-attended lesson.

## Endpoints

- `POST /api/slots/[id]/cancel` — same shape; route now refuses
  with 403 + `{ error: 'too_late_to_cancel', minutesUntilStart: N }`
  when `actor='learner'` AND start is < 24h away.
- `POST /api/admin/slots/[id]/mark` — new admin route. Body
  `{ status: 'completed' | 'no_show_learner' | 'no_show_teacher' }`.
  Refuses if the row is not `booked` or `start_at` is still in the
  future. Sets `marked_at = now()` and appends a `slot.lifecycle`
  event to the row's events log.

Existing routes unchanged.

## Cron

`scripts/auto-complete-slots.mjs`:

```sql
update lesson_slots
   set status = 'completed',
       marked_at = now(),
       updated_at = now(),
       events = jsonb_build_array(
         jsonb_build_object(
           'type', 'slot.completed',
           'at', now(),
           'actor', 'system',
           'payload', jsonb_build_object('source', 'auto-complete')
         )
       ) || events
 where status = 'booked'
   and start_at + (duration_minutes || ' minutes')::interval <= now();
```

Idempotent (status='booked' filter), bounded (one batch per run),
logged via journald.

## Test coverage

Unit:
- 24h rule pure helper (canLearnerCancel: yes/no/no-with-reason).

Integration (Docker PG):
- learner cancel ≥24h away → 200.
- learner cancel <24h away → 403 'too_late_to_cancel'.
- admin cancel <24h away → 200 (override).
- admin mark booked-past as completed → 200; status flips, marked_at set.
- admin mark booked-future as completed → 400 (refused).
- admin mark unbooked as completed → 400 (refused).
- auto-complete cron picks up booked-past rows, leaves booked-future
  alone, leaves operator-marked rows alone.

## Activation

Server-side activation needed:
- migrate:up applies 0021 automatically on autodeploy as before.
- systemd timer for `levelchannel-auto-complete-slots.timer` needs to
  be installed via the existing `scripts/activate-prod-ops.sh`
  (we extend the script to include the new unit). Same as Phase 4 +
  the previous waves' systemd timers.
