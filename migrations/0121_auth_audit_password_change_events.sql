-- In-cabinet password change — auth audit event types.
--
-- Plan: docs/plans/in-cabinet-password-change-2026-06-09.md
--
-- Widens auth_audit_events.event_type CHECK constraint to accept two
-- new strings:
--   - password.changed.in_cabinet         — successful change.
--   - password.changed.in_cabinet.bad_current — wrong currentPassword
--                                              attempt (anti-brute
--                                              signal).
--
-- TS allowlist mirror lives in lib/audit/auth-events.ts. Drift caught
-- by tests/integration/auth/auth-audit-event-types-drift.test.ts.
--
-- Idempotent — drops and re-creates the constraint with the full
-- whitelist, so a re-run on a db that already has the new strings is
-- a no-op of identical shape.

alter table auth_audit_events
  drop constraint if exists auth_audit_events_event_type_check;
alter table auth_audit_events
  add constraint auth_audit_events_event_type_check
  check (event_type in (
    'auth.login.success',
    'auth.login.failed',
    'auth.register.created',
    'auth.reset.requested',
    'auth.reset.confirmed',
    'auth.verify.success',
    'auth.session.revoked',
    'auth.teacher.self_registered',
    'auth.invite.created',
    'auth.invite.revoked',
    'auth.invite.redeemed',
    'auth.teacher.saas_offer_accepted',
    'auth.teacher.saas_offer_backfilled',
    'auth.onboarding.reset',
    'auth.billing.method_changed',
    'auth.tariff_access.granted',
    'auth.tariff_access.revoked',
    'auth.package_access.granted',
    'auth.package_access.revoked',
    'push.subscription.created',
    'push.subscription.reassigned',
    'push.subscription.revived',
    'push.subscription.unsubscribed.user',
    'push.subscription.unsubscribed.auto',
    -- 2026-06-09 — in-cabinet password change:
    'password.changed.in_cabinet',
    'password.changed.in_cabinet.bad_current'
  ));
