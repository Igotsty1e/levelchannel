-- SAAS-PIVOT Epic 1 Day 1 — learner_teacher_links n:m membership table.
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0077`, §2.5
-- current-teacher contract, §5 Day 1 step 6.
--
-- Replaces the legacy 1:1 accounts.assigned_teacher_id with a true n:m
-- relationship. The legacy column STAYS through MVP (round-20 WARN #2
-- closure — dual-write during the n:m migration window); mig 0083 step 6
-- backfills initial rows from accounts.assigned_teacher_id.
--
-- PK = (learner_account_id, teacher_account_id) — composite key
-- enforces "at most one link between a given (learner, teacher) pair".
-- A re-link after `unlinked_at IS NOT NULL` is modelled as
-- UPDATE-unlinked_at-back-to-NULL, not a second row (R2-2 invariant:
-- the redeem CTE is the SOLE link-creation path; it uses
-- INSERT ... ON CONFLICT (learner, teacher) DO UPDATE SET unlinked_at=NULL).
--
-- ON DELETE CASCADE on learner_account_id: hard-delete of a learner
-- account should clear their links (no orphans). ON DELETE RESTRICT on
-- teacher_account_id: deleting a teacher with live links is blocked at
-- the FK; operator must soft-unlink learners first.
--
-- via_invite_id FK → teacher_invites (mig 0057, already shipped).
-- ON DELETE SET NULL — invite row may be janitor-purged for retention
-- while the link itself is the historical record.
--
-- Empty for now; mig 0083 step 6 fills it from accounts.assigned_teacher_id.

create table if not exists learner_teacher_links (
  learner_account_id uuid not null
    references accounts(id) on delete cascade,
  teacher_account_id uuid not null
    references accounts(id) on delete restrict,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz null,
  via_invite_id uuid null
    references teacher_invites(id) on delete set null,
  primary key (learner_account_id, teacher_account_id)
);

-- Hot path: active-learner count for a teacher (§2.10 cap enforcement).
-- Partial index keeps the working set tight — most cap reads skip
-- unlinked rows.
create index if not exists learner_teacher_links_active_teacher_idx
  on learner_teacher_links (teacher_account_id)
  where unlinked_at is null;

-- Reverse lookup: `/cabinet` reads "all teachers for this learner"
-- ordered by linked_at.
create index if not exists learner_teacher_links_learner_idx
  on learner_teacher_links (learner_account_id, linked_at desc);

comment on table learner_teacher_links is
  'SAAS-PIVOT Epic 1 (2026-05-22): n:m membership between learners and '
  'teachers. Replaces accounts.assigned_teacher_id (kept through MVP for '
  'dual-write). Plan: §2.1 + §2.5.';
comment on column learner_teacher_links.unlinked_at is
  'Soft-unlink timestamp. Active row predicate: unlinked_at IS NULL. '
  'Re-link is UPDATE-back-to-NULL, never an INSERT (PK enforces uniqueness).';
