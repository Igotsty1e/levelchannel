-- SAAS-PIVOT Epic 1 Day 1 — package_purchases.teacher_id (nullable column-add).
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0076c`, §5 Day 1 step 5.
--
-- Order: 0076c (Day 1, THIS migration) → 0083 (Day 1, backfills via
-- lesson_packages.teacher_id) → Day 4 / Epic 3 NOT NULL flip alongside
-- mig 0076b.
--
-- ZERO route changes on Day 1. Legacy CloudPayments webhook + admin
-- grant writers keep inserting without teacher_id; mig 0083 step 5
-- backfills every pre-existing row from the package row's owning
-- teacher.
--
-- No FK to accounts on this column to keep mig 0083's backfill simple
-- (the FK trail is package_purchases.package_id → lesson_packages.id →
-- lesson_packages.teacher_id → accounts.id, already enforced one hop
-- back). Future hardening can promote to a direct FK once the writer
-- surface is teacher-aware.

alter table package_purchases
  add column if not exists teacher_id uuid null;

-- Per-teacher reads (admin drill-down + future teacher cabinet learner
-- balance) hit this index. Partial pattern would not help here — most
-- purchases are active until expiry; full index is fine.
create index if not exists package_purchases_teacher_idx
  on package_purchases (teacher_id, created_at desc)
  where teacher_id is not null;

comment on column package_purchases.teacher_id is
  'SAAS-PIVOT Epic 1 (2026-05-22): owning teacher account (denormalised '
  'from lesson_packages.teacher_id at purchase time). NULL during Day-1 '
  '→ Day-4 dual-write window; NOT NULL flips on Day 4 (Epic 3) alongside '
  'mig 0076b. Plan: §2.1.';
