# Calendar / grid UI for slots

**Status:** plan v4 (post Codex round 3).
**Owner:** Ivan + Claude.
**Estimate:** Wave A — 4 PRs, **~18-22 working hours** total (Codex round 3 corrected the v3 12-14h estimate). Wave B + C + D separately later.
**Source-of-truth for screens:** this document.

## What we're building

Replace the current list-only view of `lesson_slots` with a Google Calendar-style **week × hour grid** so:
- The **operator** sees the whole week's coverage at a glance and can paint many slots at once
- A **teacher** (Wave A read-only) sees own week + who booked which slot — self-create deferred to Wave C
- A **learner** (Wave B, later) picks a time visually instead of scanning a flat list

Current list view doesn't scale past ~10 slots and gives no spatial sense of "which days are full / empty."

## Phasing

### Wave A — operator + read-only teacher (this plan; 4 PRs)

| Surface | Route | Reads | Writes |
|---|---|---|---|
| Operator | `/admin/slots` (NEW calendar tab) | all teachers, filtered by selected `teacherId` | create / move-open-only / cancel via existing endpoints + new `move` endpoint |
| Teacher | `/teacher` (NEW route) | own slots only, full DTO incl. learner email on booked | NONE in Wave A |

Existing list view at `/admin/slots` STAYS PERMANENTLY as a tab alongside calendar — the calendar surfaces 4 of ~8 admin actions; lifecycle marking, status filtering, operator-as-learner booking, delete-open stay in the list view.

### `TeacherSection` ↔ `/teacher` transition (Codex round 3 #4 — pinned)

Existing `TeacherSection` in `/cabinet/page.tsx:27` shows a teacher their own slots in list form. Wave A introduces `/teacher` as a calendar surface for the same data. Without an explicit decision, a teacher would see their schedule in TWO places with no declared source of truth.

**Decision (made in v4):** in PR4, `TeacherSection` becomes a **summary preview** — shows next 3 upcoming slots + a prominent "Полный календарь →" link to `/teacher`. `/teacher` is **the** source of truth for teacher schedule view; `TeacherSection` is a glanceable preview from the cabinet, not a duplicate.

This is explicit, single-source-of-truth-defined, ships in the same wave as `/teacher`. No "Wave D will figure it out later" deferral.

### Wave B — learner book surface (separate plan, later)

Wire same calendar component into `/cabinet` "Записаться" tab with role-aware projection. Re-uses Wave A backend.

### Wave C — teacher self-serve (separate plan, much later)

Teacher self-creates own slots, gated by `accounts.can_self_assign_slots` (migration ships in Wave C, NOT Wave A — Codex round 2 #4). Brings:
- New write endpoints (POST /api/teacher/slots/*)
- Learner-notification + refund-or-credit flow on teacher-cancel-booked (Codex round 1 #5)
- Recent-auth window on writes (Codex round 1 #5)
- Admin permission toggle + audit trail for the flag (Codex round 2 #4)

### Wave D — calendar polish (separate plan)

- Month-view toggle (Wave A is week-only — Codex round 2 #5: backend strictly 1-week, no scope drift)
- TeacherSection retirement / migration decision

## Group A decisions (confirmed by Ivan 2026-05-09)

1. **Scope V1**: operator + read-only teacher per phasing above
2. **Grid**: week × hour, 30-min granularity, 06:00-23:30 MSK band (35 rows)
3. **Timezone**: MSK (Europe/Moscow) fixed
4. **Library**: custom — pure JSX + CSS Grid, zero deps
5. **Operator interaction**: click empty cell → single create; click-and-drag → bulk paint via existing `/api/admin/slots/bulk-create` (Codex round 2 #6: pin reuse, no invention); drag existing **open** slot → move (booked/completed/cancelled IMMOVABLE); click any slot → modal with cancel
6. **Multi-teacher**: `teacherId` REQUIRED on every fetch
7. **Mobile**: container-query based. When the calendar's container is too narrow (~<720px), the calendar component renders a compact day-grouped list of the SAME data (a sibling `<MobileSlotList>` component with the same DTO input). The cabinet's existing list view is NOT used as the mobile fallback for `/teacher` — `/teacher` owns its own mobile rendering (Codex round 4 #1)
8. **Real-time sync**: refresh button + `lastUpdatedAt` badge + forced refetch after every mutation + explicit stale-conflict toast
9. **Backend**: new `GET /api/slots/calendar?from=&to=&teacherId=`. Range = exactly **1 week** per fetch; navigation = paged week-by-week. `from` and `to` accept ONLY `YYYY-MM-DD` strings

## Group B decisions (Claude's call)

10. Color encoding: open=accent green, booked=neutral gray, past-completed=dark gray w/ check, no-show-learner=orange tint, no-show-teacher=red tint, cancelled=light gray strikethrough
11. Tariff badge: small ₽ amount in slot block corner; full breakdown in modal
12. Empty state copy per role
13. Pagination: «← Предыдущая | На этой неделе | Следующая →». Range bounds: 4 weeks past, 12 weeks future. Past beyond 4 weeks not shown
14. Past slots: each role's window TBD per surface (Wave A both roles see 4 weeks past)
15. Conflict UX during paint: backend returns existing `{ created[], skippedConflicts[] }` from bulk-create; frontend shows summary toast
16. Booking flow (Wave B): keep `POST /api/slots/[id]/book` JSON-only contract; calendar's modal does same UI-side redirect existing list view does

## Domain policy decisions (enforced at data layer)

Codex round 1 #4 + round 2 #2: every domain invariant gets a DB-level CHECK and a mirror route validation. UI is the third layer, not the only one.

### Migration `0031_lesson_slots_domain_invariants.sql`

Three CHECK constraints encode every domain invariant the calendar relies on. Codex round 3 #1 specifically: 30-min start alignment must be enforced or the grid receives rows it can't place cleanly. v4 adds the alignment constraint AND embeds a pre-flight production-data check inside the migration itself (Codex round 3 #5: PR-description acknowledgement is not a guard).

```sql
-- Wave A — domain policy from calendar-ui plan v4. Three constraints,
-- ALL enforced at the DB layer plus mirrored in route validation.
--
-- The migration starts with an embedded pre-flight: if any existing
-- row violates any of the new invariants, the migration fails LOUD
-- with a descriptive error. This is stronger than "verified manually
-- before merge" because the real risk is dirty production data, and
-- a fresh-DB integration test can't see it.

do $$
declare
  bad_count integer;
begin
  select count(*) into bad_count
    from lesson_slots
   where
     -- Cross-midnight: end > 23:59:59 MSK
     (start_at at time zone 'Europe/Moscow')::time
       + (duration_minutes * interval '1 minute') > time '23:59:59'
     -- Start out of business band: <06:00 or >22:00 MSK
     or extract(hour from (start_at at time zone 'Europe/Moscow')) < 6
     or extract(hour from (start_at at time zone 'Europe/Moscow')) > 22
     or (
       extract(hour from (start_at at time zone 'Europe/Moscow')) = 22
       and extract(minute from (start_at at time zone 'Europe/Moscow')) > 0
     )
     -- Start not on 30-min boundary
     or extract(minute from (start_at at time zone 'Europe/Moscow')) not in (0, 30)
     or extract(second from (start_at at time zone 'Europe/Moscow')) > 0;

  if bad_count > 0 then
    raise exception
      'Cannot apply migration 0031: % existing lesson_slots rows violate calendar invariants (cross-midnight / out-of-band / not-30min-aligned). Reconcile rows before applying. Diagnostic query: see migration source.',
      bad_count;
  end if;
end $$;

-- Codex round 4 #3: ALTER TABLE ADD CONSTRAINT IF NOT EXISTS is not
-- universally supported across Postgres versions and isn't used
-- anywhere else in the repo. Wrap each in a do-block that checks
-- pg_constraint first, so re-runs are idempotent without relying on
-- IF NOT EXISTS DDL syntax.

-- 1. Cross-midnight forbid — slots end before MSK midnight.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_slots_within_msk_day') then
    alter table lesson_slots
      add constraint lesson_slots_within_msk_day
        check (
          (start_at at time zone 'Europe/Moscow')::time
            + (duration_minutes * interval '1 minute')
          <= time '23:59:59'
        );
  end if;
end $$;

-- 2. Start within business band — 06:00 ≤ start ≤ 22:00 MSK.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_slots_start_in_business_hours') then
    alter table lesson_slots
      add constraint lesson_slots_start_in_business_hours
        check (
          extract(hour from (start_at at time zone 'Europe/Moscow')) >= 6
          and (
            extract(hour from (start_at at time zone 'Europe/Moscow')) < 22
            or (
              extract(hour from (start_at at time zone 'Europe/Moscow')) = 22
              and extract(minute from (start_at at time zone 'Europe/Moscow')) = 0
            )
          )
        );
  end if;
end $$;

-- 3. Start aligned to 30-min grid (Codex round 3 #1).
--    Duration is NOT constrained to multiples of 30 — existing
--    pricing has a 50-min product (oferta §4). A 50-min slot starts
--    on a 30-min boundary and renders as a pixel-precise absolutely-
--    positioned block (see "How fractional-row durations render"
--    section below), not constrained to 30-min row boundaries.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lesson_slots_start_30min_aligned') then
    alter table lesson_slots
      add constraint lesson_slots_start_30min_aligned
        check (
          extract(minute from (start_at at time zone 'Europe/Moscow')) in (0, 30)
          and extract(second from (start_at at time zone 'Europe/Moscow')) = 0
        );
  end if;
end $$;
```

### Mirror route validation

`createSlot`, `bulkCreateSlots`, the new `moveSlot` validate the same invariants and return 400 with one of:
- `slot/cross_midnight`
- `slot/start_out_of_band`
- `slot/start_not_30min_aligned`

BEFORE hitting the DB. The CHECK constraints are the last line of defence.

### Why duration is NOT constrained to multiples of 30

Existing pricing in `app/offer/page.tsx` §4 has a 50-min product (2500/3500/5000 ₽ for 50 min). Constraining to 30-min multiples would break this.

### How fractional-row durations render (Codex round 4 #2)

The grid is NOT a strict CSS-grid-rows layout for slot blocks. Each day is a positioned container; slot blocks use absolute positioning with pixel-precise math:

```
top    = (slotStartMinutesFromMidnight - 360) * PX_PER_MIN
height = slotDurationMinutes * PX_PER_MIN
```

where `360` = minutes from midnight to 06:00 (start of band) and `PX_PER_MIN` is a constant (e.g. 1.5px/min → a 50-min slot is 75px tall, a 30-min half-hour row is 45px tall). The CSS-grid 35-row scaffold provides the time-axis labels and visual gridlines; slot blocks float over them.

A 50-min slot starting at 18:00 renders as an absolutely-positioned block that:
- Starts at `top = (18*60 - 360) * 1.5 = 1080px`
- Has height `= 50 * 1.5 = 75px`
- Visually overlaps the 18:00-18:30 row fully and the 18:30-19:00 row partially (the bottom 15px of the block sits inside the next row)
- Block label reads "18:00 – 18:50"

Acceptance test in PR2: `tests/calendar/slot-block-geometry.test.ts` — for slot durations 30, 50, 60, 90, 120, 180, assert `block.height === duration * PX_PER_MIN` and `block.top === (startMinutesFromMidnight - 360) * PX_PER_MIN`.

### Other policy decisions

- **Teacher self-cancel of booked slot — DEFERRED to Wave C** (Codex round 1 #5). Wave A teacher view is strictly read-only.
- **`/teacher` login** — REUSES existing `/login`. **NO post-login redirect change in Wave A** (Codex round 2 #3). Teachers manually navigate to `/teacher`. Wave D will revisit if needed.
- **Existing `TeacherSection` in `/cabinet`** — REWIRED in PR4 to a 3-slot summary preview + CTA → `/teacher` (Codex round 3 #4). `/teacher` is the single source of truth for teacher schedule view; cabinet's `TeacherSection` becomes a glanceable preview, not a duplicate.

## Auth matrix (Codex round 2 #1 + round 3 #2 — most important fix)

`GET /api/slots/calendar` enforces these guard rules at the route layer.

### Role precedence (Codex round 3 #2 — pinned)

The `account_roles` table allows multi-role accounts (DB schema permits `admin+teacher` even though the app-layer grant logic in `lib/auth/accounts.ts:255` actively prevents it). The route MUST handle the hybrid case explicitly. Precedence:

```
admin > teacher > learner
```

If an account holds multiple roles (e.g. `admin+teacher` was directly inserted into `account_roles` bypassing the grant function), the highest-precedence role determines auth behavior. This means an admin+teacher hybrid CAN request any `teacherId` (admin powers win).

Implementation lives in a new helper `pickActiveCalendarRole(roles: AccountRole[])`:

```ts
export function pickActiveCalendarRole(roles: AccountRole[]): 'admin' | 'teacher' | 'learner' | null {
  if (roles.includes('admin')) return 'admin'
  if (roles.includes('teacher')) return 'teacher'
  if (roles.includes('student')) return 'learner'
  return null
}
```

### Auth matrix table

| Active role (post-precedence) | Allowed `teacherId` | Else |
|---|---|---|
| `admin` | ANY UUID | — |
| `teacher` | ONLY `session.account.id` | 403 `teacher_id_mismatch` |
| `learner` | ONLY `session.account.assignedTeacherId` | 403 `teacher_id_mismatch` |
| anonymous / no role match | — | 401 |

### `/teacher` route (Wave A) — admin+teacher hybrid handling

A teacher-only account lands on `/teacher` and sees their calendar. An admin+teacher hybrid:
- The route detects `pickActiveCalendarRole(roles) === 'admin'` and **redirects to `/admin/slots`** instead of rendering the teacher view. Reasoning: admin operator workflow > teacher self-view; sending them to the operator surface is more useful and removes ambiguity.

Pinned implementation, not deferred.

### Negative tests pinned in PR1 (`tests/integration/scheduling/calendar-auth.test.ts`)

Each test asserts the exact response shape (status + reason + no slot data leaks):

1. `it('teacher requesting another teacher's calendar gets 403 with reason teacher_id_mismatch and no slots in body')`
2. `it('learner with assignedTeacher=A requesting teacher=B gets 403, body has no slots')`
3. `it('learner with no assigned teacher gets 403 even when requesting their own non-bound query')`
4. `it('learner-class user with manually-injected teacher role guard does not get admin powers')` (defense-in-depth — re-assert via store-layer per Wave 7 #3 lesson)
5. `it('admin can request any teacher (happy path)')`
6. `it('teacher can request their own teacherId (happy path)')`
7. `it('learner can request their assigned teacher (happy path)')`
8. Anonymous → 401, not 403 (status differentiated)
9. **(Codex round 3 #2)** `it('hybrid admin+teacher account: directly INSERT both roles into account_roles, then call calendar endpoint with arbitrary teacherId — admin precedence wins, returns 200')`
10. **(Codex round 3 #2)** `it('hybrid admin+teacher account hitting /teacher route — redirects to /admin/slots (302 location header)')`
11. **(Codex round 3 #2)** `it('hybrid teacher+student account: teacher precedence wins for calendar; can request own teacherId only')`

## Backend surface (Wave A)

### `GET /api/slots/calendar`

Query params:
- `from` (required): `YYYY-MM-DD` string only — anything else → 400 with reason `bad_from_format`
- `to` (required): `YYYY-MM-DD` string only — must be exactly 7 days after `from` → else 400 `bad_range`
- `teacherId` (required, UUID): per auth matrix above

### Response — discriminated union (Codex round 1 #9 + round 2 #7)

```ts
type CalendarSlot =
  | {
      kind: 'open'
      id: string
      startAt: string  // ISO with MSK offset
      durationMinutes: number
      tariffId: string | null
      tariffAmountKopecks: number | null
    }
  | {
      kind: 'booked-full'  // admin / teacher view
      id: string
      startAt: string
      durationMinutes: number
      learnerAccountId: string
      learnerEmail: string
      tariffId: string | null
      tariffAmountKopecks: number | null
    }
  | {
      kind: 'booked-self'  // learner role only — own booking (Wave B)
      id: string
      startAt: string
      durationMinutes: number
      tariffId: string | null
      tariffAmountKopecks: number | null
    }
  | {
      kind: 'booked-other'  // learner role only — someone else's booking (Wave B)
      // NO id, NO learnerAccountId, NO learnerEmail, NO tariffAmount
      startAt: string
      durationMinutes: number
    }
  | {
      kind: 'past-full'  // admin / teacher — completed/no-show/cancelled with full identity
      id: string
      startAt: string
      durationMinutes: number
      status: 'completed' | 'no_show_learner' | 'no_show_teacher' | 'cancelled'
      learnerAccountId: string | null  // null only if status='cancelled' on never-booked slot
      learnerEmail: string | null
    }
  | {
      kind: 'past-redacted'  // learner Wave B — past slot, identity stripped
      id: string  // own bookings keep id; others' bookings have no id
      startAt: string
      durationMinutes: number
      status: 'completed' | 'no_show_learner' | 'no_show_teacher' | 'cancelled'
      // NO learnerAccountId, NO learnerEmail, NO tariffAmount
    }

type CalendarResponse = {
  slots: CalendarSlot[]
  rangeStart: string  // ISO MSK midnight
  rangeEnd: string    // ISO MSK midnight (exclusive)
  teacherId: string
  generatedAt: string
}
```

The discriminated union forces TypeScript callers to narrow per `kind`; absence/presence is fully encoded by the kind, no runtime assumption needed.

### DTO contract tests pinned in PR1 (`tests/integration/scheduling/calendar-projection.test.ts`)

For each role × kind combination, assert the exact field set. Specifically:

1. `it('admin response of a booked slot is shape booked-full with learnerEmail present')`
2. `it('teacher response of a booked slot is shape booked-full with learnerEmail present')`
3. `it('learner response of a booked-by-other slot is shape booked-other with NO id, NO learnerAccountId, NO learnerEmail, NO tariffAmountKopecks')` — assert ABSENCE explicitly via `expect(slot).not.toHaveProperty('learnerEmail')` (Codex round 1 #2: "absence not undefined")
4. `it('learner response of own booking is shape booked-self with id and tariff but NO learnerAccountId/learnerEmail visible')`
5. `it('learner response of past slot is shape past-redacted with NO email')`
6. `it('admin response of past slot is shape past-full with full identity')`

### Range guard tests (`tests/integration/scheduling/calendar-range-guard.test.ts`)

1. `it('to-from = 8 days returns 400 bad_range')`
2. `it('to-from = 6 days returns 400 bad_range')`
3. `it('from > to returns 400 bad_range')`
4. `it('from = "2026-05-10T00:00:00Z" (ISO timestamp) returns 400 bad_from_format')`
5. `it('from = "2026-13-01" (invalid date) returns 400 bad_from_format')`
6. `it('from = "yesterday" returns 400 bad_from_format')`
7. `it('happy: from=2026-05-10, to=2026-05-17 returns slots')`

### Move endpoint — `PATCH /api/admin/slots/[id]/move` (admin only in Wave A)

```sql
update lesson_slots
   set start_at = $newStartAt,
       updated_at = now(),
       events = $event::jsonb || events
 where id = $1
   and status = 'open'
returning ${SLOT_COLUMNS}
```

Atomic open-only at DB layer (mirrors `cancelLearnerSlot` pattern from `lib/scheduling/slots.ts:943`). On 0 rows, sniff to disambiguate (status changed since fetch, slot deleted, etc.) and return 409 with reason. UI on 409 snaps back + shows toast.

Tests in `tests/integration/scheduling/calendar-move.test.ts`:

1. `it('move open slot succeeds, start_at updated, events log carries actor=admin')`
2. `it('move booked slot returns 409 not_open, original slot unchanged')`
3. `it('move completed slot returns 409 not_open')`
4. `it('move with newStartAt outside business hours returns 400 slot/start_out_of_band')`
5. `it('move with newStartAt creating cross-midnight returns 400 slot/cross_midnight')`
6. `it('move respects unique (teacher_account_id, start_at) constraint, returns 409 collision')`

### Audit trail propagation (Codex round 1 #10 — threaded in PR1)

`lib/scheduling/slots.ts` mutations currently hardcode `actor: 'admin'` in the events JSONB. Wave A change:

- `cancelSlot`, `createSlot`, `bulkCreateSlots`, the new `moveSlot` accept:
  - `actor: 'admin' | 'teacher' | 'learner'`
  - `actorAccountId: string`
- Events log JSONB carries `{ actor, actorAccountId }`
- Routes pass these from session

This is dead code in Wave A (only admin uses it via existing routes), but ships now so Wave C teacher endpoints can plug in without retrofitting the events log.

### TZ refactor pre-flight (Codex round 1 #8 + round 2 #6)

Codex caught: existing admin single-create UI (`slots-manager.tsx:23, :161`) serializes browser-local time; bulk uses MSK. Three writers with three different instant-derivations would be a mess. PR1 normalizes:

**New module:** `lib/calendar/dates.ts` — extracts existing MSK math from `slots.ts:309` and `slots-manager.tsx:157` into one home. NOT a second source of truth (Codex round 2 #6 explicit) — it IS the source of truth, existing call sites migrated to it.

**Acceptance for the refactor:** *same MSK wall time → same UTC instant via single-create, bulk-create, and (future) calendar paths.* Pinned by an integration test:

`tests/integration/scheduling/tz-consistency.test.ts`:
1. `it('single-create with MSK input "2026-05-10T18:00" produces same start_at instant as bulk-create with same MSK input')`
2. `it('helper mskMidnightUtc returns 21:00:00Z for "2026-05-10" (MSK is UTC+3, year-round, no DST)')`
3. `it('helper handles year boundary: input "2026-12-31" returns Dec 30 21:00:00Z')`
4. `it('helper handles leap day: input "2024-02-29" returns Feb 28 21:00:00Z')` (use historical leap year so the test stays valid)

## Component architecture (Codex round 1 #9, round 2 #5 month dropped)

```
components/calendar/
├── SlotCalendar.tsx        — composition root, ~120 lines (week-only Wave A; month is Wave D)
├── Grid.tsx                — pure layout (CSS Grid 7 days × 35 half-hours), ~180 lines
├── SlotBlock.tsx           — single slot rendering with kind-aware visuals + a11y labels, ~140 lines
├── PaintLayer.tsx          — drag-paint state machine, ~120 lines
├── MoveLayer.tsx           — drag-move state machine, ~100 lines
├── Toolbar.tsx             — week nav + lastUpdatedAt + refresh, ~80 lines
└── MobileFallback.tsx      — container-query observer, switches to existing list, ~60 lines

lib/calendar/
├── dates.ts                — MSK helpers (PR1)
├── types.ts                — discriminated DTO types
└── view-model.ts           — DTO normalization (server response → UI rows)
```

**Keyboard / focus contract** lives in `Grid.tsx` from PR2, not deferred (Codex round 1 #28 + round 2 missing). Grid is a focusable region; arrow keys move a focus indicator across half-hour cells; Enter on a focused cell → onCellClick (create) or onSlotClick (open modal).

## PR-by-PR plan

### PR 1 — backend foundation + TZ refactor + audit trail (no UI)

**Migrations:**
- `0031_lesson_slots_domain_invariants.sql` (cross-midnight + start-window CHECKs)

**No `0032_accounts_can_self_assign_slots.sql`** (Codex round 2 #4: deferred to Wave C with the rest of the self-serve work).

**New modules:**
- `lib/calendar/dates.ts` — MSK helpers (extracts existing math; not a parallel source)
- `lib/calendar/types.ts` — discriminated DTO + UI-row types

**Refactor (UI-side behavior change for admin single-create only — see Behavior change call-out below):**
- `slots-manager.tsx:157` and `slots.ts:309` route through `lib/calendar/dates.ts`
- `cancelSlot`, `createSlot`, `bulkCreateSlots` accept `actor` + `actorAccountId`; routes pass session-derived values

**New endpoint:**
- `GET /api/slots/calendar` — auth matrix per table above; 7-day-exact range guard; discriminated DTO per role
- `PATCH /api/admin/slots/[id]/move` — atomic open-only; 409 on conflict; audit event with `actor='admin'`

**Tests pinned (file names exact):**
- `tests/integration/scheduling/calendar-auth.test.ts` — 8 cases (auth matrix HIGH from round 2)
- `tests/integration/scheduling/calendar-projection.test.ts` — 6 cases (DTO contract per role × kind)
- `tests/integration/scheduling/calendar-range-guard.test.ts` — 7 cases (range parsing + invariants)
- `tests/integration/scheduling/calendar-move.test.ts` — 6 cases (move endpoint open-only)
- `tests/integration/scheduling/tz-consistency.test.ts` — 4 cases (TZ refactor invariant)
- `tests/calendar/dates.test.ts` — unit tests for MSK helpers

**Pre-flight is embedded in migration** (Codex round 3 #5 — permanent guard, not PR-description acknowledgement). The `do $$ ... raise exception ... end $$` block at the top of `0031_lesson_slots_domain_invariants.sql` (see Domain policy section) hard-fails the migration if any existing row violates any invariant. This means the migration ITSELF is the guard — it cannot be applied to dirty data. Future agents who add a new constraint must follow the same pattern.

**Behavior change call-out** (Codex round 3 #5):

PR1 ALSO changes the admin single-create form to interpret time inputs as MSK (currently browser-local). This is a real UI behavior change for admin users:
- Form labels updated to "Время начала (МСК)"
- The change is documented in PR description as a behavior diff
- Client-side test added: `tests/admin/single-create-tz.test.ts` — asserts that a `<input type="datetime-local">` value of `2026-05-10T18:00` produces the same UTC instant on the wire as the bulk-create flow's MSK serialization

This is NOT a "no behavior change" PR — admin users will see the label change and start thinking in MSK terms. Operators have always been in Smolensk (MSK), so the practical effect is zero, but the framing matters.

**Acceptance:**
- Embedded migration pre-flight passes against production data (else migration fails loud)
- Existing slot operations work via API with same MSK wall time → same UTC instant via single-create AND bulk-create AND (future) calendar paths — pinned by `tests/integration/scheduling/tz-consistency.test.ts`
- Calendar endpoint returns correct projection per role; negative tests pass (11 cases including 3 hybrid-role)
- Cross-midnight + out-of-band + not-30min-aligned slot creation rejected at DB layer (3 CHECK constraints active) AND at route layer (mirror validation)
- Admin single-create form labels show "(МСК)"; `tests/admin/single-create-tz.test.ts` passes

**Estimate:** ~6-8 hours.

### PR 2 — calendar component skeleton + demo route

**New:** all 7 files in `components/calendar/` (skeleton, week-view-only, read-only — no drag-paint or drag-move)

**New:** `/admin/(gated)/calendar-demo` route — operator-only, renders calendar against PR1 endpoint

**Tests:**
- Unit tests for `view-model.ts` (DTO → UI rows, identity stable across renders)
- Snapshot of `SlotBlock.tsx` per `kind` (6 kinds × snapshot)
- Visual inspection on demo route (manual)

**Acceptance:**
- Navigate to `/admin/calendar-demo`, see this week's slots laid out correctly with right colors per kind
- Click any slot → modal placeholder fires
- Keyboard arrows move focus across cells; Enter on slot opens modal
- No mutation actions yet

**Estimate:** ~4 hours.

### PR 3 — operator surface (calendar tab + interactions)

**Wire:** `<SlotCalendar role="admin">` into `/admin/slots` as a NEW tab; existing list view = first tab. User can switch.

**Wire:** click empty cell → existing single-create dialog (already in admin)

**Wire:** drag-paint preview-deselect-commit → existing `/api/admin/slots/bulk-create` (Codex round 2 #6: REUSE, no invention) with synthesized list of `(start_at, duration)` tuples generated from the painted cells

**Wire:** drag-move (open-only) → new `PATCH /api/admin/slots/[id]/move` (already in PR1); on 409, snap back + toast

**Wire:** click slot → modal with cancel button → existing `POST /api/admin/slots/[id]/cancel`

**Tests:**
- Integration: paint creates N slots, returns `{ created[], skippedConflicts[] }`, frontend shows summary toast
- Integration: move open slot succeeds; move booked slot returns 409 with toast; UI snaps back
- Integration: cancel via calendar fires same audit event as cancel via list

**Acceptance:**
- Operator can do everything from list view, plus paint and move
- List view tab still works (escape hatch)

**Estimate:** ~4 hours.

### PR 4 — read-only teacher surface + cabinet TeacherSection rewire

**New route:** `/teacher` (gated by `requireTeacherAndVerified`)

**New guard:** `requireTeacherAndVerified` in `lib/auth/guards.ts` — uses `pickActiveCalendarRole(roles[])` to handle multi-role accounts (Codex round 3 #2). Hybrid `admin+teacher` → 302 redirect to `/admin/slots`. Re-asserts at data layer per Wave 7 #3 + Codex round 1 #5.

**Wire:** `<SlotCalendar role="teacher">` against PR1 endpoint, full DTO with learner email on booked

**No write endpoints exposed.** Read-only.

**Cabinet TeacherSection rewire (Codex round 3 #4):** existing `app/cabinet/teacher-section.tsx` replaced with a summary preview component:
- Shows next 3 upcoming slots in compact list form
- Prominent "Полный календарь →" CTA linking to `/teacher`
- Single source of truth for the schedule view = `/teacher`

**Login:** post-login redirect UNCHANGED. Existing `/cabinet` stays the default destination. Teachers see the new TeacherSection preview + click through to `/teacher` for the full calendar.

**Tests:**
- Integration: `/teacher` 403s for non-teacher / non-admin-teacher accounts
- Integration: teacher can see own slots with learner email; cannot see other teachers' slots (auth-matrix test reused from PR1)
- Integration: hybrid `admin+teacher` hitting `/teacher` → 302 to `/admin/slots`
- Integration: teacher's `/teacher` does not expose any mutation route
- Snapshot/component test: new `TeacherSection` shows ≤3 upcoming slots + CTA link

**Acceptance:**
- Teacher logs in via `/login` → lands on `/cabinet` → sees new compact TeacherSection preview with link → clicks through to `/teacher` for the full week
- Booked slots show learner email on `/teacher`
- No mutation buttons anywhere (read-only)
- Hybrid admin+teacher account on `/teacher` → redirected to `/admin/slots`

**Estimate:** ~3-4 hours (added TeacherSection rewire is small).

### Wave A ends here.

Wave B (learner) and Wave C (teacher self-serve) get separate plans, separate Codex passes, separate user OK.

## Existing system contracts — what stays vs changes

| Existing contract | Wave A behavior |
|---|---|
| `/admin/slots` list view | STAYS PERMANENTLY as a tab alongside calendar |
| `POST /api/slots/[id]/book` JSON response | UNCHANGED. UI does redirect (preserved Wave B contract) |
| `/api/slots/available` flat list | UNCHANGED. Wave B will add calendar projection alongside |
| `TeacherSection` in `/cabinet` | UNCHANGED in Wave A. Wave D decides retirement |
| Single-create browser-local time | NORMALIZED in PR1 to MSK helpers |
| Bulk-create MSK time | UNCHANGED behaviorally; routed through new helpers |
| Cancel rules | UNCHANGED |
| Lifecycle marks | UNCHANGED, surfaced in list view only. Calendar shows them as `kind: 'past-full'` for context |
| Post-login redirects | UNCHANGED |
| `accounts` schema | UNCHANGED in Wave A. `can_self_assign_slots` migration deferred to Wave C |

## Open questions for Codex round 4

After v4 rewrite, pinpointing what's left:

1. **30-min alignment via DB extract():** the new constraint uses `extract(minute from ... at time zone 'Europe/Moscow') in (0, 30)` and `extract(second) = 0`. Does this handle DST transitions? MSK is UTC+3 year-round (no DST since 2014); the constraint is `at time zone 'Europe/Moscow'` which Postgres resolves via tzdata. If a future RF DST law re-activates seasonal shifts, the constraint behavior changes. Worth a test that pins the current MSK = UTC+3 invariant?

2. **Embedded `do $$ raise exception $$` pre-flight:** Postgres syntax is right, error message format is right. Does this play well with our migration runner (`scripts/migrate.mjs`)? Specifically — does the migration runner correctly surface the raised exception as a failure exit code, or does it silently skip the rest of the migration?

3. **Hybrid admin+teacher integration test:** the test inserts directly into `account_roles` bypassing `grantAccountRole`. Is there a cleanup hook that fires after the test so the hybrid state doesn't bleed into other tests? Standard tests with `beforeEach` truncate, but I want to verify.

4. **TeacherSection rewire vs Wave A scope:** the TeacherSection change adds component work to PR4 that wasn't in v3. Estimate +1h. Is that the right home (PR4 alongside `/teacher`) or should it be PR5?

5. **Admin precedence in /teacher → /admin/slots redirect:** the redirect uses 302. If an admin+teacher hybrid is doing automated testing and follows redirects, they end up on `/admin/slots`. Is that surprising for the admin who wanted to look at the teacher view? Should there be a query param like `?as=teacher` to force teacher view? Probably overkill for V1 (hybrids should never exist normally), but flagging.

6. **Anything else? Roast me round 4.**

## Refs

- v1 + v2 of this plan + Codex rounds 1+2 — preserved in chat for audit trail
- `lib/scheduling/slots.ts` — slot model + CRUD
- `app/admin/(gated)/slots/*` — current operator UI (list view stays)
- `app/cabinet/page.tsx:27` — current TeacherSection (untouched in Wave A)
- `migrations/0020_lesson_slots.sql` — slot schema
- Backlog: `## Open high-level queue` → "Calendar / grid UI for slots"
