-- Withdrawal model for account_consents.
--
-- Rationale (152-ФЗ ст.9 п.5): a data subject has the right to withdraw
-- consent at any time. The current `account_consents` table only models
-- acceptance — we lacked a place to record the fact and timestamp of a
-- withdrawal.
--
-- Design choice: extra column on the existing row, NOT a new event row
-- with `document_kind = 'personal_data:revoked'`.
--   - Query intent we need most often is "is this user's consent for
--     `personal_data` currently active". A column on the latest row
--     answers that with one filter (`revoked_at IS NULL`); a separate
--     event row needs a join or window function.
--   - History is preserved either way: a user who accepts → withdraws
--     → re-accepts produces 1) a `revoked_at`-stamped row, then 2) a
--     fresh acceptance row with `revoked_at` null. Timeline reads in
--     `accepted_at desc` order naturally.
--   - The audit trail is unchanged: each acceptance is still its own
--     row, the revocation just stamps the row that's being revoked.
--
-- Withdrawal of which row: we revoke the LATEST acceptance for the
-- given `(account_id, document_kind)`. Earlier rows stay untouched —
-- their record of "this version was accepted at time T" is still true,
-- only the current authority is invalidated.

alter table account_consents
  add column if not exists revoked_at timestamptz null;

-- Quick lookup of "active consents" — partial index on rows that
-- haven't been revoked. Modest, since most consents stay un-revoked.
create index if not exists account_consents_active_idx
  on account_consents (account_id, document_kind, accepted_at desc)
  where revoked_at is null;
