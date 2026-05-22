-- SAAS-PIVOT Epic 3 Day 4 — extend payment_audit_events.event_type_check
-- with the teacher-driven grant lifecycle events.
--
-- Mirrors the 0050 + 0052 pattern: drop the CHECK, re-add with the
-- full known event-type set including the new pair. The set is
-- verified against lib/audit/payment-events.ts:PAYMENT_AUDIT_EVENT_TYPES
-- at migration-write time.
--
-- The two new events are emitted by:
--   - lib/billing/teacher-grant.ts:issueTeacherPackageGrant — post-
--     commit best-effort audit on a successful teacher_grant write.
--   - lib/billing/teacher-grant.ts:revokeTeacherPackageGrant — post-
--     commit best-effort audit on a successful teacher_revoke write.
--
-- Load-bearing record stays on payment_orders + package_purchases;
-- this audit row is observability.

alter table payment_audit_events
  drop constraint payment_audit_events_event_type_check;

alter table payment_audit_events
  add constraint payment_audit_events_event_type_check
  check (event_type in (
    -- 0034 baseline + earlier order/webhook events:
    'order.created', 'order.cancelled', 'mock.confirmed',
    'webhook.check.received', 'webhook.check.declined',
    'webhook.pay.received', 'webhook.pay.processed', 'webhook.pay.validation_failed',
    'webhook.fail.received', 'webhook.fail.declined', 'webhook.fail.processed',
    'charge_token.succeeded', 'charge_token.requires_3ds', 'charge_token.declined',
    'threeds.callback.received', 'threeds.confirmed', 'threeds.declined',
    'package.grant.failed', 'package.grant.succeeded',
    -- 0037 (refund Phase 7):
    'payment.refund.recorded',
    -- 0040 (refund gateway-initiated wave 60):
    'payment.refund.initiated.gateway',
    'payment.refund.gateway.webhook',
    -- 0050 (PKG-RECON):
    'payment.grant.retried-by-admin',
    'payment.grant.account-attached-by-admin',
    'payment.grant.resolved-manually-by-admin',
    -- 0052 (PKG-ADMIN-GRANT):
    'package.grant.operator-granted',
    -- 0088 (THIS migration — SAAS-PIVOT Epic 3 Day 4):
    'package.grant.teacher-granted',
    'package.grant.teacher-revoked'
  ));
