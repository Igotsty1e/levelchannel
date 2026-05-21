-- SAAS-PIVOT Epic 1 Day 1 — account_profiles.teacher_public_slug.
--
-- Plan: docs/plans/saas-pivot-master.md §2.1 row `0086`, §2.8 /pay
-- surface, §5 Day 1 step 9.
--
-- FILENAME NOTE: plan-doc §2.1 labels this row `0086`. The actual file
-- is numbered `0082` so that scripts/migrate.mjs (lexicographic order)
-- applies it BEFORE `0083_bootstrap_teacher_account.sql`. Plan-row
-- labels are logical; filenames must satisfy lex order. Round-20
-- BLOCKER #1 closure: pre-fix sequence had file `0086` AFTER file
-- `0083`, which would fail because 0083 step 5a writes
-- `teacher_public_slug='level'` and the column must exist first.
--
-- Source-of-truth for the `/t/<teacher-slug>/pay` route (new in Epic 6).
-- Nullable for Free/Mid/Pro teachers (they have no /pay surface).
-- Bootstrap teacher backfilled to `'level'` by mig 0083 step 5a.
--
-- Allowlist regex `^[a-z0-9][a-z0-9-]{2,30}$`:
--   - Min 3 chars total (`level` qualifies, `xy` doesn't).
--   - Max 31 chars total.
--   - Lowercase alphanumeric + hyphen, must start with alnum.
--   - URL-safe; no leading hyphen / dot / underscore.
--
-- UNIQUE index (partial on NOT NULL) prevents spoofing.

alter table account_profiles
  add column if not exists teacher_public_slug text null;

-- Allowlist regex CHECK. Drop + re-add for idempotency (same pattern
-- as mig 0072 telegram_skipped_reason_check).
alter table account_profiles
  drop constraint if exists account_profiles_teacher_public_slug_format;
alter table account_profiles
  add constraint account_profiles_teacher_public_slug_format
  check (teacher_public_slug is null
         or teacher_public_slug ~ '^[a-z0-9][a-z0-9-]{2,30}$');

create unique index if not exists account_profiles_teacher_public_slug_unique
  on account_profiles (teacher_public_slug)
  where teacher_public_slug is not null;

comment on column account_profiles.teacher_public_slug is
  'SAAS-PIVOT Epic 1 (2026-05-22): public slug for the /t/<slug>/pay '
  'surface (Plan-4 teachers only). Bootstrap teacher = ''level'' '
  '(set by mig 0083 step 5a). NULL for Free/Mid/Pro tiers. '
  'Plan: docs/plans/saas-pivot-master.md §2.8.';
