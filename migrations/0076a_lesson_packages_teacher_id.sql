-- SAAS-PIVOT Epic 1 Day 1 — lesson_packages.teacher_id (nullable column-add).
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0076a`, §5 Day 1 step 4.
--
-- Three-stage split (R2-5 closure):
--   - 0076a (THIS migration, Day 1) — nullable column add.
--   - 0076c (Day 1)                  — package_purchases.teacher_id column add.
--   - 0083  (Day 1)                  — bootstrap backfill via mig 0083 step 5.
--   - 0076b (Day 4 / Epic 3)         — drop global UNIQUE(slug), add
--                                      composite UNIQUE(teacher_id, slug),
--                                      flip teacher_id NOT NULL.
--
-- ZERO route changes on Day 1. Legacy `/admin/packages` writers keep
-- inserting without teacher_id. The bootstrap teacher (mig 0083 step 5)
-- claims every pre-existing row, so the eventual NOT NULL flip in
-- Epic 3 / Day 4 is safe.
--
-- ON DELETE RESTRICT — same rationale as pricing_tariffs.teacher_id
-- (mig 0075): package rows carry historical price/duration snapshots
-- that backstop the package_purchases.amount_kopecks invariant; we
-- never cascade from teacher-account deletion.

alter table lesson_packages
  add column if not exists teacher_id uuid null
    references accounts(id) on delete restrict;

-- Hot path index: `/teacher/packages` CRUD list filters by teacher_id.
-- Partial on is_active mirrors the existing
-- lesson_packages_active_order_idx (mig 0033) but scopes by tenant.
create index if not exists lesson_packages_teacher_active_idx
  on lesson_packages (teacher_id, display_order, id)
  where is_active = true;

comment on column lesson_packages.teacher_id is
  'SAAS-PIVOT Epic 1 (2026-05-22): owning teacher account. NULL during '
  'Day-1 → Day-4 dual-write window; NOT NULL flips on Day 4 (Epic 3 / mig 0076b) '
  'alongside the composite UNIQUE(teacher_id, slug) flip. Plan: §2.1.';
