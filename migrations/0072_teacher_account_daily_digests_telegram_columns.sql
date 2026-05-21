-- BCS-DEF-5-TG (2026-05-21) — Telegram channel columns on the daily
-- digest dedup row. Email path on the same row is unchanged.
--
-- Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.2.2.
--
-- Operator runbook (§2.1 / §8) requires stopping the digest timer
-- BEFORE this migration runs to avoid the brief ACCESS EXCLUSIVE
-- on teacher_account_daily_digests racing with an in-flight tick's
-- SELECT ... FOR UPDATE. PG11+ ADD COLUMN ... DEFAULT NOT NULL is
-- metadata-only (no rewrite).

alter table teacher_account_daily_digests
  add column if not exists telegram_sent boolean not null default false;
alter table teacher_account_daily_digests
  add column if not exists telegram_skipped_reason text null;
alter table teacher_account_daily_digests
  add column if not exists telegram_message_id text null;
alter table teacher_account_daily_digests
  add column if not exists telegram_attempts integer not null default 0;
alter table teacher_account_daily_digests
  add column if not exists telegram_last_error text null;
alter table teacher_account_daily_digests
  add column if not exists telegram_sent_at timestamptz null;

alter table teacher_account_daily_digests
  drop constraint if exists tadd_telegram_skipped_reason_check;
alter table teacher_account_daily_digests
  add constraint tadd_telegram_skipped_reason_check
  check (telegram_skipped_reason is null or telegram_skipped_reason in (
    'no_telegram_binding',
    'bot_blocked_by_user',
    'channel_disabled',
    'send_failed'
  ));

-- Telegram channel state machine — parallel to the existing email
-- state machine (tadd_state_consistency, migration 0067). The existing
-- CHECK is UNCHANGED; this new CHECK only constrains the relationship
-- between the new Telegram columns.
alter table teacher_account_daily_digests
  drop constraint if exists tadd_telegram_state_consistency;
alter table teacher_account_daily_digests
  add constraint tadd_telegram_state_consistency
  check (
    -- Sent: telegram_sent_at set, no skipped_reason.
    (telegram_sent = true
     and telegram_sent_at is not null
     and telegram_skipped_reason is null)
    or
    -- Pending: no skipped_reason, no sent_at, no message_id, attempts >= 0.
    (telegram_sent = false
     and telegram_skipped_reason is null
     and telegram_sent_at is null
     and telegram_message_id is null
     and telegram_attempts >= 0)
    or
    -- Non-retryable terminal: no sent_at, no message_id.
    (telegram_sent = false
     and telegram_skipped_reason in (
       'no_telegram_binding', 'channel_disabled', 'bot_blocked_by_user'
     )
     and telegram_sent_at is null
     and telegram_message_id is null)
    or
    -- Retryable terminal (send_failed): attempts >= 1.
    (telegram_sent = false
     and telegram_skipped_reason = 'send_failed'
     and telegram_sent_at is null
     and telegram_message_id is null
     and telegram_attempts >= 1)
  );

create index if not exists tadd_telegram_sent_at_idx
  on teacher_account_daily_digests (telegram_sent_at desc)
  where telegram_sent = true;
