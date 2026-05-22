-- SAAS-PIVOT Epic 5A Day 5A — lesson_completions billable-event SoT.
--
-- Plan: docs/plans/saas-pivot-master.md §2.6 + §5 Day 5A.
-- Logical mig 0079; renumbered to 0092 to land after parallel-track
-- PRs #414/#415 (logical migs 0088-0091).
--
-- Contract:
--   - One row per "проведено" (completed) or "no_show_learner" event
--     for a teacher × learner-slot pair. UNIQUE(slot_id) is the
--     security boundary against double-completion (round-19 BLOCKER
--     #4 closure).
--   - Forward trigger: insert → flip lesson_slots.status to either
--     'completed' (was_no_show=false) or 'no_show_learner'
--     (was_no_show=true). Only flips from 'booked'.
--   - Reverse trigger: delete → flip lesson_slots.status back to
--     'booked' from {completed, no_show_learner}.
--   - BEFORE DELETE 4-condition guard (round-26 BLOCKER #1 closure):
--     blocks un-mark when (a) immutable_at is set (48h window passed),
--     (b) a lesson_settlement_completions row exists for the
--     completion, (c) a teacher_earnings.related_completion_id row
--     exists.
--   - Historical backfill from existing lesson_slots
--     status in ('completed','no_show_learner').
--   - ALTER teacher_earnings → add FK to lesson_completions(id) (Day-1
--     mig 0081 left it as plain UUID because the target table did not
--     yet exist).
--
-- Settlements table (lesson_settlement_completions) is referenced in
-- the BEFORE DELETE guard via dynamic SELECT — created in mig 0093 in
-- the same deploy. The guard function compiles even if the table is
-- absent (plpgsql resolves table references at execution time, not
-- function-creation time), and 0093 lands directly after this file.

create table if not exists lesson_completions (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null
    references lesson_slots(id) on delete restrict,
  teacher_id uuid not null references accounts(id),
  was_no_show boolean not null default false,
  amount_kopecks integer not null,
  completed_at timestamptz not null,
  -- 48h immutability stamp. Set by the daily retention sweep
  -- once created_at + 48h passes; the BEFORE DELETE trigger raises
  -- when this is non-null. NULL = still in the un-mark window.
  immutable_at timestamptz null,
  marked_by_account_id uuid null references accounts(id),
  created_at timestamptz not null default now(),
  constraint lesson_completions_slot_uniq unique (slot_id)
);

-- Hot path: teacher ledger UI (`/teacher/learners/[id]`) reads ordered
-- by created_at desc. Partial would buy little; keep it dense.
create index if not exists lesson_completions_teacher_idx
  on lesson_completions (teacher_id, created_at desc);

-- Eligible-for-settle predicate (was_no_show=false OR =true, but
-- still BILLABLE). The daily-immutability sweep also uses this
-- partial index to find rows that just crossed 48h.
create index if not exists lesson_completions_billable_idx
  on lesson_completions (was_no_show, immutable_at)
  where immutable_at is null;

comment on table lesson_completions is
  'SAAS-PIVOT Epic 5A (2026-05-22): billable-event SoT. '
  'Forward+reverse triggers flip lesson_slots.status. '
  'Plan: docs/plans/saas-pivot-master.md §2.6.';
comment on column lesson_completions.immutable_at is
  '48h un-mark window. NULL = still mutable; non-NULL = retention sweep '
  'has crossed the window. BEFORE DELETE trigger raises when set.';
comment on column lesson_completions.was_no_show is
  'false → forward trigger sets status=completed. true → status=no_show_learner. '
  'Both are BILLABLE; no_show_teacher is a separate path with no completion row.';

-- ============================================================
-- Forward trigger: insert lesson_completion → flip slot status.
-- ============================================================
create or replace function lesson_completion_apply() returns trigger as $$
begin
  update lesson_slots
     set status = case when new.was_no_show then 'no_show_learner' else 'completed' end,
         updated_at = now()
   where id = new.slot_id and status = 'booked';
  return new;
end$$ language plpgsql;

drop trigger if exists lesson_completion_apply_t on lesson_completions;
create trigger lesson_completion_apply_t
  after insert on lesson_completions
  for each row execute procedure lesson_completion_apply();

-- ============================================================
-- Reverse trigger: delete lesson_completion → flip slot back to booked.
-- Only from the two terminal billable states; cancelled/no_show_teacher
-- rows do not get reverted by this trigger (caller already knows
-- BEFORE DELETE guards above blocked the wrong cases).
-- ============================================================
create or replace function lesson_completion_revert() returns trigger as $$
begin
  update lesson_slots
     set status = 'booked', updated_at = now()
   where id = old.slot_id and status in ('completed', 'no_show_learner');
  return old;
end$$ language plpgsql;

drop trigger if exists lesson_completion_revert_t on lesson_completions;
create trigger lesson_completion_revert_t
  after delete on lesson_completions
  for each row execute procedure lesson_completion_revert();

-- ============================================================
-- BEFORE DELETE 4-condition guard (round-26 BLOCKER #1 closure).
-- App-side route does the friendly-error layer; this trigger is the
-- DB safety net against direct SQL DELETE.
-- ============================================================
create or replace function lesson_completion_delete_guard() returns trigger as $$
declare
  has_settlement int := 0;
  has_earnings int := 0;
  has_settlement_table boolean;
begin
  if old.immutable_at is not null then
    raise exception 'lesson_completions: immutability passed (48h)'
      using errcode = '40006';
  end if;

  -- lesson_settlement_completions ships in mig 0093 (same deploy).
  -- Guard against running this trigger before 0093 — fall through if
  -- the table is absent (the migration applies them back-to-back).
  select exists (
    select 1 from information_schema.tables
     where table_schema = 'public'
       and table_name = 'lesson_settlement_completions'
  ) into has_settlement_table;
  if has_settlement_table then
    execute 'select count(*) from lesson_settlement_completions where completion_id = $1'
      into has_settlement using old.id;
    if has_settlement > 0 then
      raise exception 'lesson_completions: settlement exists, un-mark forbidden'
        using errcode = '40007';
    end if;
  end if;

  select count(*) into has_earnings
    from teacher_earnings
   where related_completion_id = old.id;
  if has_earnings > 0 then
    raise exception 'lesson_completions: earnings accrued, un-mark forbidden'
      using errcode = '40008';
  end if;

  return old;
end$$ language plpgsql;

drop trigger if exists lesson_completion_delete_guard_t on lesson_completions;
create trigger lesson_completion_delete_guard_t
  before delete on lesson_completions
  for each row execute procedure lesson_completion_delete_guard();

-- ============================================================
-- Historical backfill — one row per existing terminal billable slot.
-- ============================================================
-- amount_kopecks comes from the joined pricing_tariffs snapshot; rows
-- without a tariff fall back to 0 (operator pricing was off-platform).
-- marked_by_account_id = NULL (synthetic). completed_at = slot.start_at
-- + duration (the slot's end time), or coalesce(marked_at, now()) if
-- duration math fails. immutable_at = now() so the historical backfill
-- is locked from the start — operators can't un-mark prod history.
do $$
declare
  completed_count int;
  no_show_count int;
begin
  insert into lesson_completions (
    id, slot_id, teacher_id, was_no_show, amount_kopecks,
    completed_at, immutable_at, marked_by_account_id, created_at
  )
  select gen_random_uuid(),
         s.id,
         s.teacher_account_id,
         false,
         coalesce(t.amount_kopecks, 0),
         coalesce(
           s.marked_at,
           s.start_at + (s.duration_minutes || ' minutes')::interval
         ),
         now(),
         null,
         coalesce(s.marked_at, s.updated_at, now())
    from lesson_slots s
    left join pricing_tariffs t on t.id = s.tariff_id
   where s.status = 'completed'
   on conflict (slot_id) do nothing;

  get diagnostics completed_count = row_count;
  raise notice 'lesson_completions backfill: % "completed" row(s) inserted', completed_count;

  insert into lesson_completions (
    id, slot_id, teacher_id, was_no_show, amount_kopecks,
    completed_at, immutable_at, marked_by_account_id, created_at
  )
  select gen_random_uuid(),
         s.id,
         s.teacher_account_id,
         true,
         coalesce(t.amount_kopecks, 0),
         coalesce(
           s.marked_at,
           s.start_at + (s.duration_minutes || ' minutes')::interval
         ),
         now(),
         null,
         coalesce(s.marked_at, s.updated_at, now())
    from lesson_slots s
    left join pricing_tariffs t on t.id = s.tariff_id
   where s.status = 'no_show_learner'
   on conflict (slot_id) do nothing;

  get diagnostics no_show_count = row_count;
  raise notice 'lesson_completions backfill: % "no_show_learner" row(s) inserted', no_show_count;
end $$;

-- ============================================================
-- ALTER teacher_earnings — add the deferred FK from mig 0081.
-- Round-25 BLOCKER #1 closure.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'teacher_earnings_completion_fk'
       and conrelid = 'teacher_earnings'::regclass
  ) then
    alter table teacher_earnings
      add constraint teacher_earnings_completion_fk
        foreign key (related_completion_id)
        references lesson_completions(id)
        on delete restrict;
  end if;
end $$;
