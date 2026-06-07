-- teacher-payments-sbp-self-service Sub-PR A1 (2026-06-07).
--
-- Per-pair override: учитель закрепляет конкретный СБП-метод за
-- конкретным учеником. Если строки нет — ученик видит default
-- метод учителя (если default есть).
--
-- Plan: docs/plans/teacher-payments-sbp-self-service.md §2.2

create table if not exists teacher_payment_method_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_account_id uuid not null
    references accounts(id) on delete cascade,
  learner_account_id uuid not null
    references accounts(id) on delete cascade,
  payment_method_id uuid not null
    references teacher_payment_methods(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (teacher_account_id, learner_account_id)
);

-- Hot path: учитель смотрит лист учеников + ученик видит свой метод.
create index if not exists teacher_payment_method_assignments_teacher_idx
  on teacher_payment_method_assignments (teacher_account_id);
create index if not exists teacher_payment_method_assignments_learner_idx
  on teacher_payment_method_assignments (learner_account_id);

comment on table teacher_payment_method_assignments is
  'Per-pair override: какой СБП-метод учитель показывает конкретному '
  'ученику. NULL = ученик видит default метод. '
  'Plan: docs/plans/teacher-payments-sbp-self-service.md §2.2.';
