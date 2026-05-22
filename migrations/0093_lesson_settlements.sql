-- SAAS-PIVOT Epic 5A Day 5A — lesson_settlements + M:N coverage.
--
-- Plan: docs/plans/saas-pivot-master.md §2.6 + §5 Day 5A.
-- Logical mig 0080; renumbered to 0093 to follow 0092 in this deploy.
--
-- Contract:
--   - One row per teacher-acknowledged payment from a learner. The
--     `amount_kopecks` is the FULL settlement (may cover multiple
--     completions partially or in full).
--   - lesson_settlement_completions is the M:N pairing — one row per
--     (settlement_id, completion_id) with the amount allocated from
--     this settlement to that completion. A single completion can be
--     covered by multiple partial settlement rows over time; a single
--     settlement can cover multiple completions.
--   - sum(lesson_settlement_completions.amount_kopecks WHERE
--     completion_id = X) is the running coverage; if it equals
--     lesson_completions.amount_kopecks, the completion is fully
--     settled.
--   - settlement_id ON DELETE CASCADE → coverage rows go with their
--     parent settlement (operator-driven correction). completion_id
--     ON DELETE RESTRICT → can't delete a completion that has any
--     coverage row (consistent with the BEFORE DELETE guard in 0092).

create table if not exists lesson_settlements (
  id uuid primary key default gen_random_uuid(),
  learner_account_id uuid not null references accounts(id),
  teacher_id uuid not null references accounts(id),
  amount_kopecks integer not null check (amount_kopecks > 0),
  settled_at timestamptz not null default now(),
  marked_by_account_id uuid null references accounts(id),
  created_at timestamptz not null default now()
);

create index if not exists lesson_settlements_learner_teacher_idx
  on lesson_settlements (learner_account_id, teacher_id, settled_at desc);

create index if not exists lesson_settlements_teacher_idx
  on lesson_settlements (teacher_id, settled_at desc);

comment on table lesson_settlements is
  'SAAS-PIVOT Epic 5A (2026-05-22): operator/teacher-acknowledged '
  'learner payment. Pairs with lesson_settlement_completions for the '
  'per-completion allocation. Plan: §2.6.';

create table if not exists lesson_settlement_completions (
  settlement_id uuid not null
    references lesson_settlements(id) on delete cascade,
  completion_id uuid not null
    references lesson_completions(id) on delete restrict,
  amount_kopecks integer not null check (amount_kopecks > 0),
  primary key (settlement_id, completion_id)
);

create index if not exists lesson_settlement_completions_completion_idx
  on lesson_settlement_completions (completion_id);

comment on table lesson_settlement_completions is
  'SAAS-PIVOT Epic 5A (2026-05-22): M:N coverage between '
  'lesson_settlements and lesson_completions. '
  'sum(amount_kopecks) per completion = running coverage. Plan: §2.6.';
