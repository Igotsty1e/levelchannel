-- SAAS-PIVOT Epic 1 Day 1 — pricing_tariffs gains teacher_id + deleted_at.
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0075`, §2.4 soft-delete
-- semantics, §5 Day 1 step 3.
--
-- ZERO route changes on Day 1 — column adds are nullable so legacy
-- writers (admin pricing CRUD) keep inserting tariffs without a
-- teacher_id; backfill of pre-existing rows to the bootstrap teacher
-- happens in mig 0083 step 5.
--
-- NOT NULL flip on teacher_id is DEFERRED to Epic 2 (Day 3), after
-- `/teacher/tariffs` writers pass `teacher_id` at insert. Keeps Day 1
-- non-blocking for the existing admin pricing surface.
--
-- ON DELETE RESTRICT (not CASCADE / SET NULL): tariffs are referenced
-- by lesson_slots.tariff_id (historical price snapshot) and by
-- payment_orders downstream — accidentally cascading from a teacher
-- account deletion would corrupt historical price data. RESTRICT
-- forces the operator to soft-archive the teacher's tariffs (deleted_at)
-- before any account purge would even be possible.

alter table pricing_tariffs
  add column if not exists teacher_id uuid null
    references accounts(id) on delete restrict;

alter table pricing_tariffs
  add column if not exists deleted_at timestamptz null;

-- Hot path index: `/teacher/tariffs` CRUD reads filter by
-- (teacher_id = $session, deleted_at IS NULL). Partial keeps the
-- working set tight; historical-read sites still scan unfiltered.
create index if not exists pricing_tariffs_teacher_active_idx
  on pricing_tariffs (teacher_id)
  where deleted_at is null;

comment on column pricing_tariffs.teacher_id is
  'SAAS-PIVOT Epic 1 (2026-05-22): owning teacher account. NULL during '
  'Day-1 dual-write window; NOT NULL flips on Day 3 (Epic 2) after the '
  '/teacher/tariffs writers are wired. Plan: §2.1 + §2.4.';
comment on column pricing_tariffs.deleted_at is
  'SAAS-PIVOT Epic 1 (2026-05-22): soft-delete timestamp. Historical '
  'slot reads MUST still join unfiltered (price snapshot). Tariff '
  'list-for-teacher CRUD filters WHERE deleted_at IS NULL. Plan: §2.4.';
