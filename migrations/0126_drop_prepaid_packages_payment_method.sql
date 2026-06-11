-- 0126_drop_prepaid_packages_payment_method.sql
-- epic-b Sub-PR B.1 (2026-06-11).
--
-- Drops the 'prepaid_packages' value from learner_billing_preferences.
-- payment_method enum AND teacher_invites.default_payment_method enum.
-- After this migration, the booking pipeline always allows mix: package
-- consume first → postpaid fallback. No more "ригидный режим только
-- пакеты". The invite-default flow inherits the same enum, so invites
-- created with the dropped value normalize to 'postpaid' too.
--
-- Existing rows with payment_method='prepaid_packages' are converted to
-- 'postpaid' (mix mode).

update learner_billing_preferences
   set payment_method = 'postpaid'
 where payment_method = 'prepaid_packages';

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'learner_billing_preferences_payment_method_check'
  ) then
    alter table learner_billing_preferences
      drop constraint learner_billing_preferences_payment_method_check;
  end if;
end $$;

alter table learner_billing_preferences
  add constraint learner_billing_preferences_payment_method_check
  check (payment_method in ('postpaid', 'none'));

-- teacher_invites.default_payment_method (mig 0101 line 58-59) also
-- carried 'prepaid_packages' as a valid value; the redeem CTE copies it
-- directly into learner_billing_preferences, so leaving it accepted
-- would let stale invite rows write the dropped value into the
-- preferences table and trip the new CHECK constraint above.

update teacher_invites
   set default_payment_method = 'postpaid'
 where default_payment_method = 'prepaid_packages';

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'teacher_invites_default_payment_method_check'
  ) then
    alter table teacher_invites
      drop constraint teacher_invites_default_payment_method_check;
  end if;
end $$;

alter table teacher_invites
  add constraint teacher_invites_default_payment_method_check
  check (default_payment_method in ('postpaid', 'none'));
