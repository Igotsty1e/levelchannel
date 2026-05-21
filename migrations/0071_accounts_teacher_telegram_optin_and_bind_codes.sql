-- BCS-DEF-5-TG (2026-05-21) — teacher-side Telegram opt-in storage
-- columns and bind-code table. Mirrors BCS-DEF-4 migration 0065
-- (storage columns) + BCS-DEF-4-TG migration 0070
-- (learner_telegram_bind_codes shape, including id-uuid PK + non-unique
-- partial indexes).
--
-- Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.2.1.
--
-- Postgres 11+ — ADD COLUMN ... DEFAULT false NOT NULL is metadata-only
-- (no table rewrite). The two CHECK constraints are pre-satisfied by
-- the default-false invariant on every existing row.

alter table accounts
  add column if not exists teacher_telegram_enabled boolean not null default false;

alter table accounts
  add column if not exists teacher_telegram_chat_id text null;

alter table accounts
  drop constraint if exists accounts_teacher_telegram_chat_id_len;
alter table accounts
  add constraint accounts_teacher_telegram_chat_id_len
  check (teacher_telegram_chat_id is null
         or length(teacher_telegram_chat_id) between 1 and 64);

alter table accounts
  drop constraint if exists accounts_teacher_telegram_consistency;
alter table accounts
  add constraint accounts_teacher_telegram_consistency
  check ((teacher_telegram_enabled = false)
         or (teacher_telegram_chat_id is not null));

comment on column accounts.teacher_telegram_enabled is
  'BCS-DEF-5-TG (2026-05-21): per-user opt-in flag for the daily 08:00 '
  'teacher digest delivered via Telegram. Default false. Toggling true '
  'requires teacher_telegram_chat_id to be non-null (CHECK constraint). '
  'The bind handshake reuses the webhook route at /api/telegram/webhook '
  'shipped by BCS-DEF-4-TG (extended to UNION-resolve across both '
  'bind-code tables).';
comment on column accounts.teacher_telegram_chat_id is
  'BCS-DEF-5-TG (2026-05-21): Telegram numeric chat-id captured from '
  'the /start handshake against teacher_telegram_bind_codes. Wiped by '
  'the retention sweep alongside email / password_hash / '
  'learner_telegram_chat_id when scheduled_purge_at elapses '
  '(defense-in-depth against residual PII per 152-FZ).';

-- Teacher-side bind codes — separate table from learner_telegram_bind_codes
-- so role-gating at write time prevents cross-archetype spoofing.
-- Schema mirrors BCS-DEF-4-TG migration 0070 verbatim:
-- - id uuid PK (NOT code as PK)
-- - code text with CHECK on /^[A-Z0-9]{8}$/
-- - non-unique partial index for active-code lookup
-- - relaxed ttbc_consumed_consistency CHECK (post-consumption chat_id may be null)

create table if not exists teacher_telegram_bind_codes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  consumed_chat_id text null,
  constraint ttbc_code_format
    check (code ~ '^[A-Z0-9]{8}$'),
  constraint ttbc_expires_after_created
    check (expires_at > created_at)
);

alter table teacher_telegram_bind_codes
  drop constraint if exists ttbc_consumed_consistency;
alter table teacher_telegram_bind_codes
  add constraint ttbc_consumed_consistency
  check (
    (consumed_at is null and consumed_chat_id is null)
    or (consumed_at is not null)
  );

create index if not exists ttbc_active_lookup_idx
  on teacher_telegram_bind_codes (code)
  where consumed_at is null;

create index if not exists ttbc_account_active_idx
  on teacher_telegram_bind_codes (account_id)
  where consumed_at is null;

create index if not exists ttbc_expires_at_idx
  on teacher_telegram_bind_codes (expires_at);

comment on table teacher_telegram_bind_codes is
  'BCS-DEF-5-TG (2026-05-21): one-time 8-char codes for the teacher '
  'Telegram bind handshake. Mirror of learner_telegram_bind_codes. '
  'Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.2.1.';
