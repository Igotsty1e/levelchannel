-- Phase 3 — 30-day deletion grace window on accounts.
--
-- Two new nullable columns:
--
--   scheduled_purge_at — set when a learner requests deletion from
--                        the cabinet. Null = no pending purge.
--                        Acts as the "this row will be anonymized
--                        after this date unless cancelled" timer.
--
--   purged_at          — stamped when the daily retention job has
--                        actually anonymized the row. Set together
--                        with the email-rewrite + password-zero +
--                        profile-clear in scripts/db-retention-cleanup.mjs.
--                        Allows the cleanup query to skip already-
--                        purged rows on subsequent runs.
--
-- We do NOT add a separate `deletion_requested_at` because
-- `scheduled_purge_at - 30 days` is always the request time, and an
-- explicit field would be a denormalized fact that can drift if the
-- grace window changes.
--
-- The two columns interact with `disabled_at` (already exists):
--
--   - learner requests deletion:
--       disabled_at = now()
--       scheduled_purge_at = now() + 30 days
--       purged_at = null
--   - operator cancels during grace:
--       disabled_at = null
--       scheduled_purge_at = null
--       purged_at stays null
--   - retention job purges:
--       disabled_at stays set (locked forever)
--       scheduled_purge_at stays set (audit of when it was scheduled)
--       purged_at = now() (the anonymization happened)
--       email := 'deleted-<uuid>@example.invalid'
--       password_hash := 'PURGED' (no bcrypt prefix → never matches)
--       (account_profiles row updated separately, FK on delete cascade
--        is NOT used because we keep the auth row for audit)

alter table accounts
  add column if not exists scheduled_purge_at timestamptz null;

alter table accounts
  add column if not exists purged_at timestamptz null;

-- Partial index drives the daily purge job: only rows that are
-- scheduled and not yet purged. Almost always empty (typical
-- accounts have neither column set), so the index stays tiny.
create index if not exists accounts_pending_purge_idx
  on accounts (scheduled_purge_at)
  where scheduled_purge_at is not null and purged_at is null;
