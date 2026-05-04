-- Phase 6+ — assign a teacher to a learner.
--
-- Until now, every learner saw every teacher's open slots in
-- /cabinet → «Записаться». For real workflow with 1+ teachers we
-- need a 1:1 binding so a learner sees only their own teacher's
-- availability. Operator picks the teacher in /admin/accounts/[id].
--
-- Modelled as a single nullable FK column on `accounts` rather than a
-- separate `account_teacher_assignments` table. Reasons:
--   - 1:1 binding (a learner has at most one assigned teacher); a
--     join table would carry no extra columns and just add a JOIN.
--   - hot path: cabinet reads `accounts.assigned_teacher_id` to
--     filter slots — single column read on the already-loaded auth
--     row, zero new query.
--   - if business model evolves to multi-teacher per learner (an
--     unlikely scenario today), promoting to a join table is
--     straightforward and additive.
--
-- ON DELETE SET NULL — if a teacher account is purged or hard-
-- deleted, learners revert to "no teacher assigned" rather than
-- having a dangling FK. The cabinet then surfaces the "ваш учитель
-- пока не назначен" hint and the operator can reassign.

alter table accounts
  add column if not exists assigned_teacher_id uuid null
    references accounts(id) on delete set null;

create index if not exists accounts_assigned_teacher_idx
  on accounts (assigned_teacher_id)
  where assigned_teacher_id is not null;
