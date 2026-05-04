# Phase 4 — Scheduling (proposal)

Status: **approved 2026-05-04**. Decisions D1–D5 settled with the
operator. Implementation can proceed.

## Why this wave exists

Phase 3 closed today: cabinet now has identity (display_name + tz),
admin can create tariffs, learner can request deletion with a 30-day
grace. The cabinet still says «Кабинет в разработке» where scheduling
should be — there is no surface for the learner to see *when* their
next lesson is, no way to book one, no way for the operator to put a
lesson on the calendar.

Phase 4 closes that gap with the smallest viable booking model. This
is intentionally NOT a calendar app — only what's needed for the
LevelChannel learner-operator workflow as it exists today.

## What ships in Phase 4

1. A `lesson_slots` table — concrete instances of "this teacher is
   available at this time" with state `open` / `booked` / `cancelled`.
2. An admin surface at `/admin/slots` — operator creates / edits /
   cancels slots; in MVP this is a list view with a simple "add slot"
   form.
3. A learner surface in `/cabinet` — list of upcoming lessons that the
   learner has booked, plus a "book a slot" view that lists open
   future slots and lets the learner pick one.
4. Booking is **payment-free in this wave**. Reservation is reserved
   on click, no money moved. Phase 6 wires bookings to the pricing
   catalog and triggers payment from the booking flow.
5. A simple cancellation flow that just stamps `cancelled_at` on the
   row. The 24-hour-before-rule is **Phase 5 territory** — the schema
   carries the column but the rule is not enforced yet.

## What is NOT in Phase 4 (parked for later)

- recurring slots ("every Monday 18:00 for 8 weeks") — operator
  creates one row per slot for now. Recurring goes into the backlog
  as a Phase 4.5 if it actually becomes painful.
- 24-hour cancellation rule — Phase 5.
- payment-at-booking — Phase 6 alongside `payment_allocations`.
- learner-side rescheduling — Phase 5.
- operator notifications when a slot is booked — Phase 5 (uses the
  same email infra Phase 3 ships).
- per-teacher availability mode (teacher marks "I'm free, generate
  slots") — out of scope; operator-managed only.
- iCal / Google Calendar export — out of scope.
- video-call link generation — out of scope.
- buffer-time enforcement (no back-to-back slots) — operator's
  responsibility when creating slots, no DB enforcement.

## Open decisions (to settle before code)

### D1. Slot model — schema

Proposed table `lesson_slots`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `teacher_account_id` | uuid FK accounts(id) | Must have `teacher` role at booking time. Soft check (DB doesn't FK to roles). Operator usually has a single `teacher` account in MVP |
| `start_at` | timestamptz | UTC stored, displayed in `account_profiles.timezone` |
| `duration_minutes` | int | Default 60, allowed band 15-180 |
| `status` | text | `open` \| `booked` \| `cancelled` |
| `learner_account_id` | uuid FK accounts(id) | Null when status='open'; non-null when 'booked' |
| `booked_at` | timestamptz | Null until booked |
| `cancelled_at` | timestamptz | Null unless cancelled |
| `cancelled_by_account_id` | uuid FK | Who cancelled (operator or learner). Null when not cancelled |
| `cancellation_reason` | text | Free text, optional |
| `notes` | text | Operator note ("Anna says student wants to focus on grammar this week") |
| `created_at` / `updated_at` | timestamptz | |

Constraints:
- `start_at` must be in the future at INSERT time (CHECK constraint;
  past slots are an authoring mistake, not a runtime invariant)
- `(teacher_account_id, start_at)` unique — one slot per teacher per
  start time, prevents accidental double-booking via two CREATE calls
- partial index on `(teacher_account_id, start_at)` where
  `status = 'open'` — speeds up the learner's "what's available"
  list; expected to be small (operator creates ~1 week of slots
  ahead)

Rejected alternatives:
- separate `slots` + `bookings` tables. With operator-managed model
  and ≤2 teachers, the 1:1 mapping doesn't justify the second table
  + JOIN. If we ever support per-teacher availability windows that
  *generate* slots on demand, we'll split.

### D2. Booking endpoint shape (now reflects settled D2 + D4)

Proposed:

- `GET /api/slots/available?teacher_id=...&from=...&to=...` — list
  open future slots for the learner. No auth gate; same loose model
  as the rest of the cabinet read API
- `POST /api/slots/[id]/book` — learner books a slot. Body empty.
  Server checks `requireAuthenticated` + `status = 'open'` + slot is
  in the future, then atomic UPDATE `set status='booked', learner_id=$me`
  with `WHERE status='open'` re-asserted in WHERE so two concurrent
  books on the same slot can't both win
- `POST /api/slots/[id]/cancel` — booked learner OR operator can
  cancel. Body `{ reason? }`. Sets cancelled_at + cancelled_by
- `GET /api/slots/mine` — learner's upcoming + recent booked slots
  for the cabinet "Мои уроки" section

Admin endpoints:

- `POST /api/admin/slots` — create one open slot
- `POST /api/admin/slots/bulk-preview` — body
  `{ teacherAccountId, weekdays:[0..6], startTime:'HH:MM',
     durationMinutes, startDate:'YYYY-MM-DD', weeks, skipDates? }`
  → returns the array of `{ startAt }` it would generate. Pure
  function over the input, no DB write. Lets the admin UI render a
  preview and deselect individual rows
- `POST /api/admin/slots/bulk-create` — body
  `{ teacherAccountId, durationMinutes, notes?, slots: [{ startAt }] }`
  → atomic insert of the final operator-curated list in one tx;
  conflicts on `(teacher_account_id, start_at)` skip-with-report
- `PATCH /api/admin/slots/[id]` — edit start_at / duration / notes;
  forbidden once status != 'open' (force operator to cancel + recreate)
- `DELETE /api/admin/slots/[id]` — only allowed for open slots; for
  booked slots use cancel route to preserve audit trail
- `POST /api/admin/slots/[id]/book-as-operator` — operator books
  on behalf of a learner ("Anna told me Tom wants 18:00 Tuesday")

### D3. Cabinet UI

Two new sections under `/cabinet`:

1. **«Мои уроки»** — list of upcoming + last 5 past lessons. Each
   row: date / time / teacher name / status (booked / cancelled) +
   "Отменить" button if `start_at` is in the future.
2. **«Записаться»** — list of open slots grouped by date; click
   → confirm modal → `POST /book`. After success, the row moves to
   "Мои уроки".

In the **«Кабинет в разработке»** placeholder block in `app/cabinet/page.tsx`:
remove the "расписание ваших занятий" bullet (it's no longer roadmap-
mention, it's shipped above).

### D4. Admin UI

Single page `/admin/slots`:

- top: form "create open slot" with fields:
  teacher (select from accounts with `teacher` role), date, time,
  duration (default 60), notes
- below: list of all slots, sortable by start_at, filterable by
  status. Inline cancel + delete actions on each row, "book as
  operator" expanded action.

### D5. Timezone handling

**Settled in advance:** UTC in DB; `account_profiles.timezone` (filled
out by the learner in Phase 3) controls display. Phase 4 makes
`timezone` effectively required — the cabinet UI nags if it's null
("укажите часовой пояс, чтобы видеть время уроков корректно") but
does NOT block booking; we fall back to `Europe/Moscow` for null tz.

Operator's admin UI uses the operator's tz from their profile or
falls back to `Europe/Moscow`.

### D6. Concurrency model

Two learners click "book" on the same open slot at the same time.
The atomic UPDATE pattern:

```sql
UPDATE lesson_slots
   SET status='booked',
       learner_account_id=$1,
       booked_at=now(),
       updated_at=now()
 WHERE id=$2 AND status='open'
RETURNING *;
```

Whichever request hits the row first wins (PG default isolation).
The other gets `rowCount=0` and the route returns 409 with a friendly
"этот слот только что забронировал кто-то другой; обновите список".

### D7. Audit / events

Lesson slots get their own event log on the row (`events JSONB`
array, similar to `payment_orders.events`). On every state mutation
we append an event with type / actor / payload. No separate audit
table for now; if we ever need cross-row audit the existing
`payment_audit_events` pattern is the template to copy.

### D8. Test coverage

In line with Phase 3 standard:

- unit: slot validation (duration band, start_at must be future)
- integration (Docker PG): admin create + edit + cancel happy path,
  learner book + cancel happy path, concurrent-book race (two
  parallel POSTs, one wins), unauthorized access (anon, non-admin),
  past-slot booking refused

Migration `0020_lesson_slots.sql` ships the table + indexes; nothing
else changes in the schema.

## Surface area summary

**New table**: `lesson_slots` (migration 0020).

**New routes**:

- `GET /api/slots/available`
- `GET /api/slots/mine`
- `POST /api/slots/[id]/book`
- `POST /api/slots/[id]/cancel`
- `POST /api/admin/slots`
- `PATCH /api/admin/slots/[id]`
- `DELETE /api/admin/slots/[id]`
- `POST /api/admin/slots/[id]/book-as-operator`

**New cabinet sections**: «Мои уроки», «Записаться».

**New admin page**: `/admin/slots`.

**New store ops**: `lib/scheduling/slots.ts` with the validation +
SQL helpers.

## Estimate

Roughly:

- migration + store ops + tests: ~0.5 day
- API routes: ~0.5 day
- admin page (single CRUD): ~0.5 day
- cabinet sections: ~0.5 day
- glue, RU copy, polish: ~0.5 day

≈ 2.5 days of focused work. Same shape as Phase 3 — additive, no new
auth mechanism, no new payment surface.

## Decisions — settled 2026-05-04

| ID | Settled |
|---|---|
| D1 | Schema keeps `notes` (operator-side) and `cancellation_reason` (free text on cancel) |
| D2 | Booking gate = authenticated **+ email verified**. New helper `requireAuthenticatedAndVerified` in `lib/auth/guards.ts`. Unverified learner gets a 403 with a hint to confirm their e-mail; the cabinet UI shows the existing «E-mail не подтверждён» banner |
| D3 | "Book as operator" ships in this wave. Operator picks a learner by e-mail in the bulk create + per-slot UI |
| D4 | Bulk creation **with precise control**: operator picks teacher + weekdays + start time + duration + start date + weeks count + optional skip dates → server returns a *preview* of every concrete `start_at` it would generate → operator can deselect individual slots → submit commits the final list in one tx. No "recurring template" table; bulk just generates N rows in `lesson_slots`. Per-slot edits / cancels stay on the existing per-row endpoints. |
| D5 | Default timezone in `/admin/slots` = `Europe/Moscow`. Learner's display tz comes from `account_profiles.timezone`; null → `Europe/Moscow`. UTC stored everywhere |
| D6 | Atomic UPDATE-with-WHERE-status='open' for concurrent-book races; loser gets 409 |
| D7 | Per-row `events JSONB` event log; no separate audit table for slots in this wave |
| D8 | Unit + integration tests; no e2e through a headless browser in this phase |
