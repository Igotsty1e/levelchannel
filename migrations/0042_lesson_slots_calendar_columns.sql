-- BCS-A.1 — Add Google Calendar integration columns to lesson_slots.
--
-- Design doc: docs/plans/booking-calendly-style.md (v1, Codex SIGN-OFF
-- after 7 paranoia rounds, 2026-05-13).
--
-- All additions are nullable — backward compatible, zero runtime impact
-- until BCS-D (pull contract) and BCS-E (push contract) wire them up.
-- Columns split into three groups: (a) learner agenda capture for the
-- Calendly screen 3, (b) external-event identity + state, (c) conflict
-- + sync ops metadata.
--
-- Invariant references (from plan §8):
--   #1 lock order — schema-only, no impact
--   #3 `external_event_id` is LC's identity for our pushed event in
--      teacher's Google Calendar; bound to specific (calendar, event)
--   #5 reconciliation is bounded — `last_reconciled_at` drives ordering
--   #7 webhook is enqueue-only — schema-only, no impact

-- ---------------------------------------------------------------------
-- 1. Learner agenda capture (Calendly screen 3 free-form comment)
-- ---------------------------------------------------------------------

alter table lesson_slots
  add column if not exists agenda text;

-- ---------------------------------------------------------------------
-- 2. External event identity + ownership stamp metadata
-- ---------------------------------------------------------------------
--
-- external_event_id + external_calendar_id together identify the event
-- LC pushed to Google. Stored AFTER the create push succeeds. Pairs
-- with extendedProperties.shared.lc_* (see plan §4.5).
--
-- integration_epoch stamps which integration session created the
-- binding. Survives disconnect/reconnect — on reconnect a new epoch is
-- minted, old bindings surface in the orphan-self UI (plan §4.12).
--
-- external_event_etag — for optimistic concurrency on update/delete.

alter table lesson_slots
  add column if not exists external_event_id text;
alter table lesson_slots
  add column if not exists external_calendar_id text;
alter table lesson_slots
  add column if not exists external_event_etag text;
alter table lesson_slots
  add column if not exists integration_epoch text;

-- Partial unique: at most one slot can bind to a given (calendar, event)
-- pair. NULLs (no binding) are not constrained. The pair is the lookup
-- key for delete/update push and for self-echo suppression.
--
-- Codex BCS-A review: predicate-only `is not null` is insufficient,
-- because Postgres treats NULL as distinct in unique indexes — a row
-- `(external_calendar_id=NULL, external_event_id='evt_123')` would
-- slip through and break the lookup-key contract. Tighten by
-- predicating on BOTH columns non-null AND requiring them to be
-- paired (either both set or both clear) via a companion CHECK.
create unique index if not exists lesson_slots_external_event_unique
  on lesson_slots (external_calendar_id, external_event_id)
  where external_event_id is not null and external_calendar_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'lesson_slots_external_binding_paired_check'
  ) then
    alter table lesson_slots
      add constraint lesson_slots_external_binding_paired_check
      check ((external_event_id is null) = (external_calendar_id is null));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Post-book conflict surface
-- ---------------------------------------------------------------------
--
-- external_conflict_at / external_conflict_kind — set by the pull-side
-- conflict detector when a foreign Google event overlaps this booked
-- slot. The 4-action resolution (dismiss/delete-external/cancel/move)
-- clears them.
--
-- conflict_source_(calendar|event)_id — the specific external event
-- that caused the conflict, so action "b) Delete external event" knows
-- where to delete. Plan finding F4 / round 3.

alter table lesson_slots
  add column if not exists external_conflict_at timestamptz;
alter table lesson_slots
  add column if not exists external_conflict_kind text;
alter table lesson_slots
  add column if not exists conflict_source_calendar_id text;
alter table lesson_slots
  add column if not exists conflict_source_event_id text;

-- CHECK kind enum. Wave will set values per detector branch.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'lesson_slots_external_conflict_kind_check'
  ) then
    alter table lesson_slots
      add constraint lesson_slots_external_conflict_kind_check
      check (
        external_conflict_kind is null
        or external_conflict_kind in (
          'pre_book_busy',
          'post_book_overlap',
          'external_event_deleted',
          'external_event_moved'
        )
      );
  end if;
end $$;

-- Hot path: teacher's main page reads "do I have any conflicts?".
-- Partial index keeps it cheap.
create index if not exists lesson_slots_external_conflict_idx
  on lesson_slots (teacher_account_id, start_at)
  where external_conflict_at is not null;

-- ---------------------------------------------------------------------
-- 4. Push retry exhaustion state
-- ---------------------------------------------------------------------
--
-- external_sync_failed_at — set by push worker when retries exhausted.
-- external_sync_failure_kind — diagnostic, drives teacher banner copy.

alter table lesson_slots
  add column if not exists external_sync_failed_at timestamptz;
alter table lesson_slots
  add column if not exists external_sync_failure_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'lesson_slots_external_sync_failure_kind_check'
  ) then
    alter table lesson_slots
      add constraint lesson_slots_external_sync_failure_kind_check
      check (
        external_sync_failure_kind is null
        or external_sync_failure_kind in (
          'terminal_4xx',
          'terminal_5xx',
          'calendar_unwritable',
          'token_revoked'
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Reconciliation ordering
-- ---------------------------------------------------------------------
--
-- last_reconciled_at — daily sweep orders by `NULLS FIRST` so fresh
-- bindings get a first check soonest. Composite ORDER BY in plan §4.8
-- prioritises cancelled+binding-alive cases first, then nearest start.

alter table lesson_slots
  add column if not exists last_reconciled_at timestamptz;

-- ---------------------------------------------------------------------
-- 6. F9‴ pathology alert counter
-- ---------------------------------------------------------------------
--
-- cancel_repush_count — incremented by reconcile when the (cancelled +
-- events.get=200 → re-enqueue delete) cycle repeats. Operator alert
-- fires at ≥3 (plan §5 minor note 2). Default 0, never decremented.

alter table lesson_slots
  add column if not exists cancel_repush_count integer not null default 0;
