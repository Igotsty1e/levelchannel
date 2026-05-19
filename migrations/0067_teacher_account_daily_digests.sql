-- BCS-DEF-5 (2026-05-19) — daily teacher digest dedup + audit flag table.
--
-- Plan: docs/plans/bcs-def-5-teacher-reminders.md §2.3 + §2.6.
--
-- One row per (teacher account_id, sent_date) — sent_date is the
-- teacher's LOCAL calendar day (not UTC). PK enforces idempotency.
--
-- skipped_reason transitions:
--   NULL                          — pending / retry-eligible
--   'empty_day'                   — terminal; no slots today
--   'account_email_missing'       — terminal; recipient unreachable
--   'send_failed'                 — terminal after attempts >= max_attempts
--
-- Round-2 WARN 6 closure: state-machine encoded as CHECK constraint.
-- Round-3 mechanical closure: dropping the explicit `terminal` flag;
-- `attempts >= max_attempts` IS the implicit terminal condition (the
-- candidate-set SQL filter already excludes such rows on next ticks).

create table if not exists teacher_account_daily_digests (
  account_id uuid not null references accounts(id) on delete cascade,
  sent_date date not null,
  email_sent boolean not null default false,
  skipped_reason text null
    check (skipped_reason is null or skipped_reason in (
      'empty_day',
      'account_email_missing',
      'send_failed'
    )),
  resend_email_id text null,
  attempts integer not null default 0,
  last_error text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tadd_pk primary key (account_id, sent_date),
  -- R2-WARN 6 closure: explicit state-machine encoded in CHECK.
  -- R3-WARN 2 closure: send_failed requires attempts >= max_attempts
  -- semantics. The DB enforces `attempts >= 1` (a row that has at
  -- least one failed attempt to be marked send_failed); the
  -- application-level guard tightens this to attempts >= max_attempts
  -- before marking the row terminal.
  constraint tadd_state_consistency
    check (
      -- Sent: must have sent_at, no skipped_reason. resend_email_id
      -- nullable (Resend rare-case where data.id is null on success).
      (email_sent = true
       and sent_at is not null
       and skipped_reason is null)
      or
      -- Pending or transient-error: no skipped_reason, no sent_at,
      -- no resend_email_id, attempts >= 0.
      (email_sent = false
       and skipped_reason is null
       and sent_at is null
       and resend_email_id is null
       and attempts >= 0)
      or
      -- Non-retryable terminal (empty_day, account_email_missing):
      -- no sent_at, no resend_email_id.
      (email_sent = false
       and skipped_reason in ('empty_day', 'account_email_missing')
       and sent_at is null
       and resend_email_id is null)
      or
      -- Retryable terminal (send_failed): no sent_at, no resend_email_id,
      -- attempts >= 1 (must have at least one failed attempt before
      -- the row can be marked send_failed terminal).
      (email_sent = false
       and skipped_reason = 'send_failed'
       and sent_at is null
       and resend_email_id is null
       and attempts >= 1)
    )
);

-- Hot-path read: per-tick "did we already send for this teacher today?".
-- Covered by the PK (account_id, sent_date) → no extra index needed.

-- Operator-side read for the admin 7-day summary widget (§2.7).
create index if not exists tadd_sent_at_idx
  on teacher_account_daily_digests (sent_at desc)
  where email_sent = true;

comment on table teacher_account_daily_digests is
  'BCS-DEF-5 (2026-05-19): one row per (teacher account_id, sent_date) '
  'tracking the daily 08:00 lesson digest delivery. PK enforces '
  'idempotency. Plan: docs/plans/bcs-def-5-teacher-reminders.md §2.6.';
