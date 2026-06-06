-- BCS-DEF-4-PUSH (2026-06-06): widen CHECK constraints for the push channel.
-- (a) learner_reminder_dispatches.channel: add 'push'.
-- (b) learner_reminder_dispatches.skipped_reason: add 'no_push_subscription' + 'push_helper_not_shipped'.
-- (c) auth_audit_events.event_type: add 5 push.subscription.* events.
-- No data rewrites; CHECK widening only.
--
-- Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.1

alter table learner_reminder_dispatches
  drop constraint learner_reminder_dispatches_channel_check;
alter table learner_reminder_dispatches
  add constraint learner_reminder_dispatches_channel_check
  check (channel in ('email', 'telegram', 'push'));

alter table learner_reminder_dispatches
  drop constraint learner_reminder_dispatches_skipped_reason_check;
alter table learner_reminder_dispatches
  add constraint learner_reminder_dispatches_skipped_reason_check
  check (skipped_reason is null or skipped_reason in (
    'slot_no_longer_booked', 'email_missing', 'past_send_by',
    'send_failed',
    'no_telegram_binding', 'telegram_helper_not_shipped',
    'no_push_subscription', 'push_helper_not_shipped'
  ));

alter table auth_audit_events
  drop constraint auth_audit_events_event_type_check;
alter table auth_audit_events
  add constraint auth_audit_events_event_type_check
  check (event_type in (
    'auth.login.success', 'auth.login.failed',
    'auth.register.created', 'auth.reset.requested', 'auth.reset.confirmed',
    'auth.verify.success', 'auth.session.revoked',
    'auth.teacher.self_registered',
    'auth.invite.created', 'auth.invite.revoked', 'auth.invite.redeemed',
    'auth.teacher.saas_offer_accepted', 'auth.teacher.saas_offer_backfilled',
    'auth.onboarding.reset', 'auth.billing.method_changed',
    'auth.tariff_access.granted', 'auth.tariff_access.revoked',
    'auth.package_access.granted', 'auth.package_access.revoked',
    'push.subscription.created',
    'push.subscription.reassigned',
    'push.subscription.revived',
    'push.subscription.unsubscribed.user',
    'push.subscription.unsubscribed.auto'
  ));
