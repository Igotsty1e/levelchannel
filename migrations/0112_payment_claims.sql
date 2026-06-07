-- teacher-payments-sbp-self-service Sub-PR C (2026-06-07).
--
-- Журнал оплат: шапка (payment_claims) + что оплачено (items).
-- Round-3 BL-18/19: snapshot фоторафии phone/bank/name на момент
-- создания — история не «врёт» при изменениях.
-- Round-4 BL-23: surrogate id PK + NULLS NOT DISTINCT unique для items.
--
-- Plan: docs/plans/teacher-payments-sbp-self-service.md §2.5

create table if not exists payment_claims (
  id uuid primary key default gen_random_uuid(),
  learner_account_id uuid null
    references accounts(id) on delete set null,
  learner_display_name_snapshot text not null,
  teacher_account_id uuid null
    references accounts(id) on delete set null,
  teacher_display_name_snapshot text not null,
  amount_kopecks integer not null
    check (amount_kopecks > 0 and amount_kopecks < 100000000),
  payment_method_id uuid null
    references teacher_payment_methods(id) on delete set null,
  payment_method_phone_snapshot text null,
  payment_method_bank_snapshot text null,
  payment_channel text not null
    check (payment_channel in ('sbp', 'other')),
  initiated_by text not null
    check (initiated_by in ('learner', 'teacher')),
  status text not null
    check (status in ('claimed', 'confirmed', 'declined', 'cancelled')),
  amount_mismatch_kopecks integer not null default 0,
  note_learner text null,
  note_teacher text null,
  claimed_at timestamptz not null default now(),
  paid_at timestamptz null,
  resolved_at timestamptz null,
  replaces_claim_id uuid null
    references payment_claims(id) on delete restrict,
  constraint payment_claims_learner_method check (
    initiated_by <> 'learner'
    or payment_channel <> 'sbp'
    or payment_method_id is not null
  ),
  constraint payment_claims_teacher_status check (
    initiated_by <> 'teacher' or status in ('confirmed', 'declined')
  ),
  constraint payment_claims_paid_at_not_future check (
    paid_at is null or paid_at <= now() + interval '1 day'
  )
);

create index if not exists payment_claims_teacher_status_idx
  on payment_claims (teacher_account_id, status, claimed_at desc);
create index if not exists payment_claims_learner_idx
  on payment_claims (learner_account_id, claimed_at desc);
create index if not exists payment_claims_name_search_idx
  on payment_claims (teacher_account_id, lower(learner_display_name_snapshot));

create table if not exists payment_claim_items (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null
    references payment_claims(id) on delete cascade,
  slot_id uuid null
    references lesson_slots(id) on delete set null,
  package_purchase_id uuid null
    references package_purchases(id) on delete set null,
  expected_amount_kopecks integer not null
    check (expected_amount_kopecks >= 0 and expected_amount_kopecks < 100000000),
  item_label_snapshot text not null,
  constraint payment_claim_item_xor check (
    (slot_id is not null and package_purchase_id is null)
    or (slot_id is null and package_purchase_id is not null)
  )
);

-- NULLS NOT DISTINCT (Postgres 15+): дубликаты slot/package в одном claim запрещены.
create unique index if not exists payment_claim_items_uniq
  on payment_claim_items (claim_id, slot_id, package_purchase_id)
  nulls not distinct;

create index if not exists payment_claim_items_slot_idx
  on payment_claim_items (slot_id) where slot_id is not null;
create index if not exists payment_claim_items_package_idx
  on payment_claim_items (package_purchase_id) where package_purchase_id is not null;
create index if not exists payment_claim_items_claim_idx
  on payment_claim_items (claim_id);

comment on table payment_claims is
  'Журнал оплат СБП self-service. Plan: '
  'docs/plans/teacher-payments-sbp-self-service.md §2.5.';
