-- SAAS-PIVOT Epic 1 Day 1 — payment_orders.teacher_account_id (column-add
-- + Day-1 backfill chain).
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0085`, §2.8 derivation
-- paths, §5 Day 1 step 11.
--
-- ORDER: runs AFTER mig 0083 because backfill bucket (c) credits all
-- non-slot/non-package orders to the bootstrap teacher, identified by
-- `teacher_account_migration_marker='bootstrap-2026-05-22'`.
--
-- ZERO route changes on Day 1. Column nullable; NOT NULL flip deferred
-- to Epic 6 (Day 6) after EVERY payment_orders writer (§2.8 table) is
-- updated to pass teacher_account_id at INSERT.
--
-- Backfill chain (Day-1 nullable, idempotent — only fills rows where
-- teacher_account_id IS NULL):
--   (a) orders with metadata->>'slotId' → lesson_slots.teacher_account_id
--   (b) orders with metadata->>'packageId' OR metadata->>'packageSlug'
--       → lesson_packages.teacher_id (already backfilled by mig 0083)
--   (c) remaining orders → bootstrap teacher (mig 0083 marker)
--
-- RAISE NOTICE per bucket so the deploy log shows backfill coverage.

alter table payment_orders
  add column if not exists teacher_account_id uuid null
    references accounts(id) on delete restrict;

-- Index for admin filters: "all payments for this teacher, newest first".
create index if not exists payment_orders_teacher_created_idx
  on payment_orders (teacher_account_id, created_at desc)
  where teacher_account_id is not null;

do $backfill$
declare
  bootstrap_teacher_id uuid;
  bucket_a_count integer := 0;
  bucket_b_count integer := 0;
  bucket_c_count integer := 0;
begin
  -- Look up the bootstrap teacher account (set by mig 0083 step 7).
  -- LIMIT 1 defensive — the marker should be UNIQUE in practice but
  -- there is no constraint enforcing it.
  select id into bootstrap_teacher_id
    from accounts
   where teacher_account_migration_marker = 'bootstrap-2026-05-22'
   limit 1;

  -- Bucket (a): orders bound to a slot.
  with updated as (
    update payment_orders po
       set teacher_account_id = ls.teacher_account_id
      from lesson_slots ls
     where po.teacher_account_id is null
       and po.metadata is not null
       and po.metadata ? 'slotId'
       and ls.id::text = (po.metadata ->> 'slotId')
       and ls.teacher_account_id is not null
    returning po.invoice_id
  )
  select count(*) into bucket_a_count from updated;
  raise notice 'mig 0085 bucket (a) slotId join: % rows updated', bucket_a_count;

  -- Bucket (b): orders bound to a package. Accept either packageId
  -- (canonical, post-round-28) OR packageSlug (legacy). lesson_packages
  -- already has teacher_id set by mig 0083 step 5.3.
  with updated as (
    update payment_orders po
       set teacher_account_id = lp.teacher_id
      from lesson_packages lp
     where po.teacher_account_id is null
       and po.metadata is not null
       and lp.teacher_id is not null
       and (
         (po.metadata ? 'packageId' and lp.id::text = (po.metadata ->> 'packageId'))
         or (po.metadata ? 'packageSlug' and lp.slug = (po.metadata ->> 'packageSlug'))
       )
    returning po.invoice_id
  )
  select count(*) into bucket_b_count from updated;
  raise notice 'mig 0085 bucket (b) packageId/packageSlug join: % rows updated', bucket_b_count;

  -- Bucket (c): remaining orders → bootstrap teacher. Skipped on fresh
  -- DBs where mig 0083 was a no-op (bootstrap_teacher_id IS NULL).
  if bootstrap_teacher_id is not null then
    with updated as (
      update payment_orders
         set teacher_account_id = bootstrap_teacher_id
       where teacher_account_id is null
      returning invoice_id
    )
    select count(*) into bucket_c_count from updated;
    raise notice 'mig 0085 bucket (c) → bootstrap teacher (%): % rows updated',
      bootstrap_teacher_id, bucket_c_count;
  else
    raise notice 'mig 0085 bucket (c) skipped — no bootstrap teacher (fresh DB)';
  end if;
end
$backfill$;

comment on column payment_orders.teacher_account_id is
  'SAAS-PIVOT Epic 1 (2026-05-22): owning teacher account for the order. '
  'NULL during Day-1 → Day-6 dual-write window. NOT NULL flips on Day 6 '
  '(Epic 6) after all SEVEN writers (§2.8) pass it at INSERT. '
  'Plan: docs/plans/saas-pivot-master.md §2.8.';
