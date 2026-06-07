-- teacher-payments-sbp-self-service Sub-PR E (2026-06-07).
--
-- Возвраты денег учителем ученику. Отдельная таблица (вместо
-- negative-amount-claim) для чистоты SQL-агрегаций.
--
-- Plan: docs/plans/teacher-payments-sbp-self-service.md §2.6

create table if not exists payment_refunds (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null
    references payment_claims(id) on delete restrict,
  amount_kopecks integer not null
    check (amount_kopecks > 0 and amount_kopecks < 100000000),
  reason text not null check (reason in (
    'slot_cancelled', 'overpaid', 'goodwill', 'duplicate', 'other'
  )),
  note text null,
  refunded_at timestamptz not null default now(),
  created_by text not null default 'teacher' check (created_by = 'teacher')
);

create index if not exists payment_refunds_claim_idx
  on payment_refunds (claim_id);

comment on table payment_refunds is
  'SBP refund log. Plan: '
  'docs/plans/teacher-payments-sbp-self-service.md §2.6.';
