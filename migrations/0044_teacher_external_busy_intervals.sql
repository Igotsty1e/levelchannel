-- BCS-A.3 — Cached busy intervals from teachers' Google calendars.
--
-- Design doc: docs/plans/booking-calendly-style.md §3.3.
--
-- Holds the replicated busy/free state from Google. Filled by the pull
-- worker (BCS-D), read by:
--   - bookSlot atomic overlap check (plan §4.2, P0 fix)
--   - pre-book hidden-slot filter on `GET /api/slots/booking-{days,times}`
--   - conflict detector that stamps lesson_slots.external_conflict_at
--   - hidden-slots surface (`GET /api/teacher/hidden-slots`)
--
-- Full-rewrite semantics: each pull cycle DELETEs all rows for
-- `(teacher_account_id, external_calendar_id)` and re-inserts the
-- bounded window (plan §4.4). Local index supports the hot overlap
-- query.
--
-- Self-echo handling: is_own_event = true when extendedProperties.shared
-- carries our `lc_origin/lc_slot_id/lc_epoch` matching the current
-- integration epoch. is_orphan_self = true when origin matches but epoch
-- doesn't (post-reconnect drift). Conflict detector filters out
-- `is_own_event=true`, surfaces `is_orphan_self=true` in the F8 UI.
--
-- PII minimization: `summary` of foreign events is PII for third parties.
-- Stored encrypted (pgcrypto + CALENDAR_ENCRYPTION_KEY), truncated to
-- 64 chars at insert time, retention 30 days via daily janitor.

create table if not exists teacher_external_busy_intervals (
  id uuid primary key default gen_random_uuid(),
  teacher_account_id uuid not null references accounts(id) on delete cascade,
  external_calendar_id text not null,
  external_event_id text not null,

  start_at timestamptz not null,
  end_at timestamptz not null,

  -- Encrypted (pgcrypto + CALENDAR_ENCRYPTION_KEY) at write time by
  -- the pull worker. Truncated to 64 chars BEFORE encryption. Used
  -- only in teacher conflict tooltip (visible to that one teacher).
  -- 30-day retention via janitor (BCS-G).
  summary_encrypted bytea,

  -- All-day event flag — drives whole-day overlap blocking. Plan §4.4.
  is_all_day boolean not null default false,

  -- accessRole from calendarList: 'owner' | 'writer' | 'reader' |
  -- 'freeBusyReader'. Owner/writer → is_writable_in_source = true.
  -- Gates conflict action 'b) Delete external event' enabled state.
  is_writable_in_source boolean not null default false,

  -- True if this row represents an event WE pushed AND current epoch
  -- matches. Conflict detector skips these.
  is_own_event boolean not null default false,

  -- True if shared.lc_origin matches but lc_epoch is from a previous
  -- integration session. Surfaces in F8 orphan-self UI; F9 reconcile
  -- treats as drift to clear.
  is_orphan_self boolean not null default false,

  etag text,
  fetched_at timestamptz not null default now()
);

-- Unique per (teacher, calendar, event) — same event imported twice in
-- one cycle is a bug. Cross-calendar copy of the same iCalUID is a
-- DIFFERENT row (different external_calendar_id), by design (plan F4).
create unique index if not exists teacher_external_busy_intervals_event_unique
  on teacher_external_busy_intervals (teacher_account_id, external_calendar_id, external_event_id);

-- Hot path: bookSlot overlap check + pre-book filter on booking-times.
-- Composite supports range query "any interval overlapping [a, b) for
-- this teacher". GiST would be more correct for tstzrange overlap, but
-- a btree on (teacher, start_at, end_at) is good enough at expected
-- cardinality (<2k rows per teacher at any time). Switch to GiST if
-- pgbench shows hot path slow.
create index if not exists teacher_external_busy_intervals_overlap_idx
  on teacher_external_busy_intervals (teacher_account_id, start_at, end_at)
  where is_own_event = false;

-- Janitor support: rows older than 30d get summary_encrypted nulled
-- daily. Indexed on fetched_at to keep sweep cheap.
create index if not exists teacher_external_busy_intervals_fetched_at_idx
  on teacher_external_busy_intervals (fetched_at)
  where summary_encrypted is not null;

-- Ownership / orphan-self mutual exclusion. A row cannot be both
-- own-event AND orphan-self — those are different epoch states.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'teacher_external_busy_intervals_ownership_check'
  ) then
    alter table teacher_external_busy_intervals
      add constraint teacher_external_busy_intervals_ownership_check
      check (not (is_own_event and is_orphan_self));
  end if;
end $$;

-- Time range sanity: end_at > start_at always (zero-length and
-- inverted intervals are bugs).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'teacher_external_busy_intervals_range_check'
  ) then
    alter table teacher_external_busy_intervals
      add constraint teacher_external_busy_intervals_range_check
      check (end_at > start_at);
  end if;
end $$;

comment on table teacher_external_busy_intervals is
  'BCS-A.3 — replicated Google Calendar busy/free state. Full-rewrite per pull. Plan: docs/plans/booking-calendly-style.md §3.3.';
comment on column teacher_external_busy_intervals.is_own_event is
  'True when extendedProperties.shared.lc_origin=levelchannel + lc_epoch matches current integration epoch. Conflict detector skips.';
comment on column teacher_external_busy_intervals.is_orphan_self is
  'True when lc_origin matches but lc_epoch is from a previous integration session. Surfaces in F8 orphan-self UI.';
comment on column teacher_external_busy_intervals.summary_encrypted is
  'pgcrypto(CALENDAR_ENCRYPTION_KEY), truncated to 64 chars pre-encrypt. PII retention 30d via janitor.';
