-- Quality Sub-PR A (2026-06-02) — close the deferred-drop TODO from
-- mig 0101_learner_billing_preferences.sql lines 49-54.
--
-- Background: accounts.postpaid_allowed became a dead column the
-- moment migration 0101 shipped — booking consults
-- learner_billing_preferences per (teacher, learner) pair from there
-- on; nothing in the booking layer (lib/scheduling/slots/booking.ts)
-- reads accounts.postpaid_allowed any more. The DROP COLUMN was
-- deferred because 7 consumers still touched it (admin route, admin
-- UI block, cabinet inline SELECT, BookConfirmModal advisory banner,
-- 2 test files). Quality Sub-PR A removes every consumer in the
-- same wave that runs this DROP — see the code-quality-audit
-- 2026-06-02 plan doc §Sub-PR A for the full deletion list.
--
-- Forward-only: there is no `down` migration here. If a future
-- per-pair payment-method preview surface ever needs a re-introduced
-- account-level flag it ships as a new column with a new contract.

alter table accounts drop column postpaid_allowed;
