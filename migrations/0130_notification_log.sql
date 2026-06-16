-- Notification Wave-A (2026-06-15)
--
-- Audit-trail для всех transactional уведомлений (email + Telegram) о
-- lesson-событиях: cancel, reschedule, mark-paid, claim-confirmed,
-- claim-declined, refund-issued. Закрывает 5 BLOCKER + 3 HIGH из
-- docs/audit/2026-06-15-reschedule-cancel-markpaid-audit.md.
--
-- Используется как:
--   1. dedup для idempotency (повторный POST cancel не шлёт второе письмо)
--   2. replay queue (failed status → cron retry в будущем)
--   3. operator audit ("почему ученик не получил уведомление")
--
-- Дoes NOT store: secrets, payment tokens, full email body. Только
-- {event_kind, recipient, channel, status, ssylki + структурированный
-- payload} — то что ученик/учитель уже видит в кабинете.

create table notification_log (
  id uuid primary key default gen_random_uuid(),

  -- Тип события. Discriminated union в коде (LessonEventKind в TS).
  event_kind text not null,

  -- Релевантные FK. nullable — событие может ссылаться на slot ИЛИ
  -- claim ИЛИ refund.
  related_slot_id uuid,
  related_claim_id uuid,
  related_refund_id uuid,

  -- Получатель уведомления. ON DELETE CASCADE — если аккаунт
  -- удаляется, лог тоже уходит (есть retention policy на 2 года —
  -- мid-term добавим cron-cleanup).
  recipient_account_id uuid not null
    references accounts(id) on delete cascade,

  -- Канал доставки.
  channel text not null check (channel in ('email', 'telegram')),

  -- Статус. 'sent' — успех; 'failed' — провайдер вернул ошибку (текст
  -- в error_text); 'skipped' — recipient не имеет канала (e.g. TG
  -- chat не привязан) ИЛИ env BOT_TOKEN не задан ИЛИ dedup-skip.
  status text not null check (status in ('sent', 'failed', 'skipped')),

  -- Idempotency key. UNIQUE — повторный INSERT с тем же ключом
  -- провалится через ON CONFLICT в коде → trip as 'skipped'.
  --
  -- Format: '<event_kind>:<related_id>:<channel>:<iter_seq>'
  -- где iter_seq = jsonb_array_length(lesson_slots.events) or аналог
  -- для claims/refunds. Это закрывает self-review BLOCKER #2:
  -- slot cancel → uncomplete → cancel снова имеет ≠ iter_seq и
  -- legitimate second-cancel не считается dup.
  dedup_key text not null unique,

  dispatched_at timestamptz not null default now(),

  -- Текст ошибки от провайдера для status='failed'. Никаких секретов
  -- (Resend message-id ОК; полный body не пишем).
  error_text text,

  -- Структурированный payload рендера. JSON безопасен — только данные
  -- которые recipient уже видит в кабинете. Используется для:
  --   1. replay (regenerate template из payload + send)
  --   2. operator debug ("что было отправлено пользователю X")
  payload jsonb
);

-- Index for recent-first operator queries (admin debug surface).
create index notification_log_dispatched_at
  on notification_log(dispatched_at desc);

-- Partial indexes для FK lookups — пишем только когда related_id
-- известен (партиal index экономит место на large table).
create index notification_log_slot
  on notification_log(related_slot_id)
  where related_slot_id is not null;

create index notification_log_claim
  on notification_log(related_claim_id)
  where related_claim_id is not null;

create index notification_log_refund
  on notification_log(related_refund_id)
  where related_refund_id is not null;

-- Index для replay-of-failed (cron в будущем будет SELECT WHERE status='failed').
create index notification_log_failed
  on notification_log(dispatched_at desc)
  where status = 'failed';
