-- SAAS-PIVOT Epic 2 Day 3 — pricing_tariffs.teacher_id NOT NULL flip.
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 (row 0075 — deferred flip),
-- §3 Epic 2, §5 Day 3, §5 line 1061 ("NOT NULL flip on
-- pricing_tariffs.teacher_id → Day 3 (Epic 2), after /teacher/tariffs
-- CRUD ships").
--
-- Pre-condition: every existing pricing_tariffs row carries a non-NULL
-- teacher_id. Mig 0083 step 5.2 backfilled all NULL rows to the
-- newly-minted bootstrap teacher account. The DO block below asserts
-- that invariant BEFORE issuing the ALTER; if any rows are NULL (because
-- 0083 was skipped on a fresh DB without an admin, or because a fresh
-- INSERT slipped between 0083 and this mig in a partial deploy), it
-- RAISES with an actionable error pointing to the bootstrap migration
-- rather than letting the ALTER do it cryptically.
--
-- After this migration:
--   - createTariff() / createTariffForTeacher() MUST pass teacher_id.
--   - The admin pricing route (legacy admin-global writer) likewise
--     needs a teacher_id (the operator picks "as which teacher?" or
--     defaults to bootstrap). The Day-3 PR wires the admin write path
--     to keep the bootstrap teacher as the default owner so existing
--     admin behaviour stays green.
--
-- IDEMPOTENCY: ALTER COLUMN ... SET NOT NULL is a no-op when the
-- column is already NOT NULL (Postgres validates the constraint on each
-- run but tolerates the redundant SET). Re-running this mig against a
-- post-flip DB is safe.

do $$
declare
  null_count int;
begin
  select count(*) into null_count
    from pricing_tariffs
   where teacher_id is null;
  if null_count > 0 then
    raise exception
      'mig 0088: % pricing_tariffs rows still have teacher_id IS NULL — bootstrap mig 0083 incomplete (no admin to row-MOVE from, or a writer inserted post-bootstrap without teacher_id). Inspect with: select id, slug, created_at from pricing_tariffs where teacher_id is null; before re-running this migration.',
      null_count;
  end if;
end $$;

alter table pricing_tariffs
  alter column teacher_id set not null;

comment on column pricing_tariffs.teacher_id is
  'SAAS-PIVOT Epic 2 Day 3 (2026-05-22): owning teacher account. NOT '
  'NULL after mig 0088. CRUD reads filter by teacher_id = $session AND '
  'deleted_at IS NULL; admin-global readers explicitly pass null and '
  'annotate the call-site. Plan: §2.1 + §2.4 + §3 Epic 2.';
