-- BCS-DEF-4 (2026-05-19) — per-user Telegram opt-in for learner
-- reminders. Pre-empts BCS-DEF-4-TG bot-handshake (still owned by
-- that plan); only the data columns ship here.
--
-- Plan: docs/plans/bcs-def-4-learner-reminders.md §1.6 (REVISED).
--
-- Postgres 11+ — ADD COLUMN ... DEFAULT false NOT NULL is metadata-only
-- (no table rewrite). The two CHECK constraints are pre-satisfied by
-- the default-false invariant on every existing row, so ADD CONSTRAINT
-- costs only a brief ACCESS EXCLUSIVE lock without a full-table scan
-- of values.
--
-- Schedule for a low-traffic window anyway.

alter table accounts
  add column if not exists learner_telegram_enabled boolean not null default false;

alter table accounts
  add column if not exists learner_telegram_chat_id text null;

-- Length cap defends against pathological storage. Telegram chat-ids
-- are numeric strings (e.g. "-1001234567890" for groups, "12345678"
-- for users) bounded around 16 chars; 64 is a forgiving upper bound.
alter table accounts
  drop constraint if exists accounts_learner_telegram_chat_id_len;
alter table accounts
  add constraint accounts_learner_telegram_chat_id_len
  check (learner_telegram_chat_id is null
         or length(learner_telegram_chat_id) between 1 and 64);

-- Opt-in cannot be true without a chat-id (consistency invariant).
alter table accounts
  drop constraint if exists accounts_learner_telegram_consistency;
alter table accounts
  add constraint accounts_learner_telegram_consistency
  check ((learner_telegram_enabled = false)
         or (learner_telegram_chat_id is not null));

comment on column accounts.learner_telegram_enabled is
  'BCS-DEF-4 (2026-05-19): per-user opt-in flag for learner Telegram '
  'reminders. Default false. Toggling true requires learner_telegram_chat_id '
  'to be non-null (CHECK constraint). This wave ships only the storage '
  'columns + a read-only placeholder section in /cabinet/profile; the '
  'actual bind handshake (one-time 8-char code, /start <code>, webhook) '
  'lives in BCS-DEF-4-TG which depends on BCS-DEF-1-TG for the '
  'sendTelegramMessage helper.';
comment on column accounts.learner_telegram_chat_id is
  'BCS-DEF-4 (2026-05-19): Telegram numeric chat-id captured from the '
  'BCS-DEF-4-TG /start handshake. Wiped by the retention sweep alongside '
  'email / password_hash when scheduled_purge_at elapses (defense-in-depth '
  'against residual PII per 152-FZ).';
