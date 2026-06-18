-- mig 0138 — Epic D: per-event × per-channel notification preferences (2026-06-18).
--
-- Plan: docs/plans/clever-sprouting-floyd.md Epic D.
--
-- Контракт:
--   - Учитель / ученик может выключить конкретное событие в конкретном
--     канале (email / telegram / push). Default behaviour — все
--     уведомления включены (backward-compat: запись отсутствует =
--     enabled).
--   - PK = (account_id, event_kind, channel) — UNIQUE на тройку.
--   - event_kind строго совпадает со значениями `LessonEventKind` из
--     lib/notifications/lesson-event-dispatch.ts (free-form text здесь,
--     потому что новые event-kinds добавляются часто; жёсткий enum
--     создал бы migration debt).
--   - channel ∈ {'email','telegram','push'}.
--   - enabled boolean.
--   - updated_at — для audit.

create table if not exists notification_preferences (
  account_id   uuid not null references accounts(id) on delete cascade,
  event_kind   text not null,
  channel      text not null,
  enabled      boolean not null default true,
  updated_at   timestamptz not null default now(),
  primary key (account_id, event_kind, channel),
  constraint notification_preferences_channel_chk
    check (channel in ('email', 'telegram', 'push'))
);

create index if not exists notification_preferences_account_idx
  on notification_preferences (account_id);

comment on table notification_preferences is
  'Per-account × per-event × per-channel preferences (Epic D 2026-06-18). '
  'Default ON: запись отсутствует = enabled (backward-compat).';
comment on column notification_preferences.event_kind is
  'Свободный текст, совпадает с LessonEventKind в lib/notifications/lesson-event-dispatch.ts. '
  'Жёсткий enum создал бы migration debt — новые события добавляются часто.';
