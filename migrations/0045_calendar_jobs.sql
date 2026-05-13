-- BCS-A.4 — Three job tables for the calendar sync machinery:
-- calendar_push_jobs, calendar_pull_jobs, slot_lifecycle_intents.
--
-- Design doc: docs/plans/booking-calendly-style.md §3.4 / §3.5 / §3.6.
--
-- Why three tables, not one outbox:
--   - push_jobs and pull_jobs target different Google APIs with
--     different retry semantics and rate-limit budgets.
--   - slot_lifecycle_intents is a DURABILITY layer above push_jobs:
--     cancel/move flows COMMIT slot state THEN durably record "we still
--     owe Google a delete/update" without holding the slot row lock
--     across two transactions (plan §4.6 F6′ + F6″ deadlock fix).
--
-- Lock-order discipline (plan §8 invariant #1):
--   Layer 4 = calendar_push_jobs + slot_lifecycle_intents (same family).
--   Layer 5 = calendar_pull_jobs.
--   Workers FOR UPDATE SKIP LOCKED their own layer; never escalate to
--   lower-numbered tables in the same TX.

-- =====================================================================
-- 1. calendar_push_jobs — outbox for events.{insert,patch,delete}
-- =====================================================================

create table if not exists calendar_push_jobs (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references lesson_slots(id) on delete cascade,
  teacher_account_id uuid not null references accounts(id) on delete cascade,

  kind text not null check (kind in ('create', 'update', 'delete')),
  payload jsonb not null,

  -- Worker drains by (status='pending' AND next_run_at <= now()) ordered.
  -- Status transitions:
  --   pending → in_progress (worker claims FOR UPDATE SKIP LOCKED)
  --   in_progress → succeeded | terminal_failure | pending (retry backoff)
  --   pending → cancelled_by_dependent (cancel-side dedups same-slot create)
  status text not null default 'pending'
    check (status in (
      'pending', 'in_progress', 'succeeded',
      'terminal_failure', 'cancelled_by_dependent'
    )),
  attempts integer not null default 0,
  next_run_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Worker pull: hot path is "next due pending job".
create index if not exists calendar_push_jobs_pending_idx
  on calendar_push_jobs (next_run_at)
  where status = 'pending';

-- Dedup at enqueue: at most one pending job per (slot_id, kind).
-- Cancel-side enqueue uses ON CONFLICT … DO NOTHING against this.
create unique index if not exists calendar_push_jobs_pending_unique
  on calendar_push_jobs (slot_id, kind)
  where status = 'pending';

-- Reconcile sweep (F9‴ gated re-enqueue) reads "latest job for this
-- slot+kind" — covered by this index.
create index if not exists calendar_push_jobs_slot_kind_idx
  on calendar_push_jobs (slot_id, kind, created_at desc);

create or replace function calendar_push_jobs_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists calendar_push_jobs_touch_updated_at_trg on calendar_push_jobs;
create trigger calendar_push_jobs_touch_updated_at_trg
  before update on calendar_push_jobs
  for each row execute function calendar_push_jobs_touch_updated_at();

comment on table calendar_push_jobs is
  'BCS-A.4 — outbox for Google Calendar push (events.insert/patch/delete). Plan: §3.4.';

-- =====================================================================
-- 2. calendar_pull_jobs — request queue for events.list refreshes
-- =====================================================================
--
-- Filled by:
--   (a) channel webhook handler — priority=2, targeted at one calendar
--   (b) cron every 5min for active+degraded — priority=0
--   (c) teacher action b) "Delete external event" — priority=2, drains
--       the affected calendar before the conflict UI updates
--   (d) GC sweep — priority=-1

create table if not exists calendar_pull_jobs (
  id uuid primary key default gen_random_uuid(),
  teacher_account_id uuid not null references accounts(id) on delete cascade,
  external_calendar_id text not null,
  priority smallint not null default 0,

  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'succeeded', 'terminal_failure')),
  attempts integer not null default 0,
  next_run_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_error text,

  created_at timestamptz not null default now()
);

-- Worker pulls highest priority + earliest due first.
create index if not exists calendar_pull_jobs_pending_idx
  on calendar_pull_jobs (priority desc, next_run_at)
  where status = 'pending';

-- Dedup: at most one pending pull per (teacher, calendar). A second
-- request arriving while one is pending collapses into the first.
create unique index if not exists calendar_pull_jobs_pending_unique
  on calendar_pull_jobs (teacher_account_id, external_calendar_id)
  where status = 'pending';

comment on table calendar_pull_jobs is
  'BCS-A.4 — pull request queue for Google Calendar busy refreshes. Plan: §3.5.';

-- =====================================================================
-- 3. slot_lifecycle_intents — post-mutation durability above push_jobs
-- =====================================================================
--
-- Records "we owe a follow-up push side-effect for this slot" durably,
-- separate from push_jobs themselves. Closes the F6′ + F6″ window:
--   1. TX_cancel_1: UPDATE lesson_slots status='cancelled' +
--      INSERT slot_lifecycle_intents (kind='post_cancel_push').
--      Atomic — if intent insert fails, cancel rolls back.
--   2. TX_cancel_2 (separate worker): drain intents, do the actual
--      push_jobs dedup + delete enqueue. Lock order obeyed: TX1 holds
--      only lesson_slots; TX2 holds only intents + push_jobs.
--
-- Status semantics (plan §4.6 F6‴ — no false-success):
--   pending → succeeded ONLY when a remediation job is actually
--     present in push_jobs (pending|in_progress) OR external binding
--     already cleared on the slot.
--   pending → blocked_integration when sync_state=disconnected at
--     worker check time. Revival sweep every 1h flips back to pending
--     when actionable.
--   pending → terminal_failure after 10 attempts over 7 days under
--     healthy integration — operator alert.

create table if not exists slot_lifecycle_intents (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references lesson_slots(id) on delete cascade,
  kind text not null
    check (kind in ('post_cancel_push', 'post_move_push', 'post_book_push')),

  status text not null default 'pending'
    check (status in (
      'pending', 'succeeded', 'blocked_integration', 'terminal_failure'
    )),
  attempts integer not null default 0,
  next_run_at timestamptz not null default now(),
  last_run_at timestamptz,
  last_error text,

  created_at timestamptz not null default now()
);

-- Worker pull index.
create index if not exists slot_lifecycle_intents_pending_idx
  on slot_lifecycle_intents (next_run_at)
  where status = 'pending';

-- Blocked-integration revival sweep — every 1h, flip back to pending
-- when teacher integration becomes actionable.
create index if not exists slot_lifecycle_intents_blocked_idx
  on slot_lifecycle_intents (slot_id)
  where status = 'blocked_integration';

-- Dedup at enqueue: at most one pending intent per (slot, kind).
create unique index if not exists slot_lifecycle_intents_pending_unique
  on slot_lifecycle_intents (slot_id, kind)
  where status = 'pending';

comment on table slot_lifecycle_intents is
  'BCS-A.4 — post-mutation durability layer above push_jobs. Solves cancel→create race + lock-order deadlock (F6″). Plan: §3.6 / §4.6.';
comment on column slot_lifecycle_intents.status is
  'No false-success rule (F6‴): only set succeeded when a remediation push_jobs row exists OR the slot binding is cleared. blocked_integration is the disconnect state; terminal_failure is operator-escalation.';
