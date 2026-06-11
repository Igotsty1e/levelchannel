-- 0126_drop_prepaid_packages_payment_method.sql
-- epic-b Sub-PR B.1 (2026-06-11).
--
-- Drops the 'prepaid_packages' value from learner_billing_preferences.
-- payment_method enum. After this migration, the booking pipeline
-- always allows mix: package consume first → postpaid fallback. No more
-- "ригидный режим только пакеты".
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
