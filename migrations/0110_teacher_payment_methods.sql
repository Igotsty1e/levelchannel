-- teacher-payments-sbp-self-service Sub-PR A1 (2026-06-07).
--
-- Учительские реквизиты для приёма СБП-платежей напрямую от ученика.
-- Платформа НЕ держит деньги — это просто реестр (phone + bank).
-- Plan: docs/plans/teacher-payments-sbp-self-service.md §2.1
--
-- Soft delete через `archived_at`. Re-add того же (phone, bank) -—
-- un-archive в API-слое (плюс `unique ... where archived_at is null`
-- предотвращает дубль активных).
--
-- Default: ровно один active default per teacher через partial unique.

create table if not exists teacher_payment_methods (
  id uuid primary key default gen_random_uuid(),
  teacher_account_id uuid not null
    references accounts(id) on delete cascade,
  phone_e164 text not null,
  phone_display text not null,
  bank_label text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  archived_at timestamptz null,
  -- round-4 WN-22: phone format strict +7XXXXXXXXXX.
  constraint teacher_payment_methods_phone_e164_format
    check (phone_e164 ~ '^\+7\d{10}$'),
  -- round-4 WN-21: bank_label non-empty.
  constraint teacher_payment_methods_bank_nonempty
    check (length(trim(bank_label)) > 0)
);

-- Uniqueness of (phone, bank) per teacher among ACTIVE rows only.
-- При re-add архивированной комбинации API делает UPDATE archived_at=null.
create unique index if not exists teacher_payment_methods_active_uniq
  on teacher_payment_methods (teacher_account_id, phone_e164, bank_label)
  where archived_at is null;

-- Exactly one default per teacher among ACTIVE rows.
create unique index if not exists teacher_payment_methods_default_uniq
  on teacher_payment_methods (teacher_account_id)
  where is_default = true and archived_at is null;

-- Hot path: учитель открывает settings + ученик GET payment method.
create index if not exists teacher_payment_methods_teacher_idx
  on teacher_payment_methods (teacher_account_id)
  where archived_at is null;

comment on table teacher_payment_methods is
  'SBP-реквизиты учителя для прямых платежей ученика. '
  'Plan: docs/plans/teacher-payments-sbp-self-service.md §2.1.';
