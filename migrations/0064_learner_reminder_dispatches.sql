-- BCS-DEF-4 (2026-05-19) — per-slot-per-channel reminder dispatch history.
-- One row INSERTed at SEND time (not book time). The row's existence is the
-- "we already sent this reminder" idempotency primitive.
--
-- Plan: docs/plans/bcs-def-4-learner-reminders.md §2.2 + §2.5.
--
-- FK ON DELETE RESTRICT mirrors lesson_slots.learner_account_id
-- (migrations/0020_lesson_slots.sql:36-40). Accounts are never
-- hard-deleted in this codebase; the retention sweep anonymises
-- in-place (see scripts/db-retention-cleanup.mjs). A FK with
-- ON DELETE CASCADE would be a benign no-op today, but RESTRICT
-- documents the contract correctly. The deletion-grace SELECT gate
-- in the scheduler (§2.4 step 4: WHERE disabled_at IS NULL AND
-- scheduled_purge_at IS NULL AND purged_at IS NULL) is the operative
-- protection against sending reminders to deletion-grace learners.

create table if not exists learner_reminder_dispatches (
  id bigserial primary key,
  slot_id uuid not null references lesson_slots(id) on delete restrict,
  account_id uuid not null references accounts(id) on delete restrict,
  channel text not null check (channel in ('email', 'telegram')),
  -- Captured at dispatch time. If the operator changes
  -- LEARNER_REMINDER_WINDOW_MINUTES mid-flight, future ticks use the
  -- new value; rows already inserted are immutable.
  window_minutes_at_dispatch integer not null
    check (window_minutes_at_dispatch between 5 and 360),
  -- Three-state lifecycle:
  --   'claimed' → row inserted, send not yet attempted (or in-flight).
  --                A row stuck in 'claimed' means the worker crashed
  --                between INSERT and send completion; an operator
  --                can DELETE it to unblock a one-time retry.
  --   'sent'    → provider returned ok. sent_at, resend_email_id /
  --                telegram_message_id populated.
  --   'skipped' → terminal non-success (cancelled mid-tick, email
  --                missing, past send-by, send failure). skipped_reason
  --                populated; sent_at is NULL.
  status text not null default 'claimed'
    check (status in ('claimed', 'sent', 'skipped')),
  skipped_reason text null
    check (skipped_reason is null or skipped_reason in (
      'slot_no_longer_booked', 'email_missing', 'past_send_by',
      'send_failed',
      'no_telegram_binding', 'telegram_helper_not_shipped'
    )),
  sent_at timestamptz null,
  resend_email_id text null,
  telegram_message_id text null,
  last_error text null,
  created_at timestamptz not null default now(),
  -- Stamped on every status transition (claimed → sent / skipped).
  updated_at timestamptz not null default now(),
  constraint lrd_status_consistency
    check (
      (status = 'claimed' and sent_at is null and skipped_reason is null)
      or (status = 'sent' and sent_at is not null)
      or (status = 'skipped' and skipped_reason is not null)
    )
);

-- Idempotency: ONE row per (slot, channel). Send-path uses
-- INSERT ... ON CONFLICT DO NOTHING + RETURNING — if the row was won by us,
-- proceed to send; if not, another tick already handled it.
create unique index if not exists lrd_slot_channel_unique
  on learner_reminder_dispatches (slot_id, channel);

-- Operator-side observability: "what was sent in the last hour".
create index if not exists lrd_created_at_idx
  on learner_reminder_dispatches (created_at desc);

comment on table learner_reminder_dispatches is
  'BCS-DEF-4 (2026-05-19): per-slot-per-channel dispatch history for '
  'the learner lesson reminder scheduler. UNIQUE (slot_id, channel) is '
  'the idempotency primitive — one row per channel per slot for the '
  'lifetime of the slot. Rows in status=claimed indicate a crash '
  'between INSERT and provider call; operator can DELETE to unblock.';
