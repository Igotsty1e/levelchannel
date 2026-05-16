-- PKG-ADMIN-GRANT LBL.0 — extend payment_audit_events.event_type_check
-- with the operator-granted event.
--
-- Mirrors the 0050 pattern (PKG-RECON): drop the constraint, re-add
-- with the full known event-type set including the new one. The set
-- is verified against lib/audit/payment-events.ts:PAYMENT_AUDIT_EVENT_TYPES
-- at migration-write time.
--
-- The new event is emitted by /api/admin/packages/[id]/grant as the
-- post-commit best-effort audit row. Load-bearing record for an admin
-- grant is the package_purchases row + payment_orders.description
-- (NOT NULL); this audit row is best-effort observability.

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
    -- 0052 (THIS migration — PKG-ADMIN-GRANT):
    'package.grant.operator-granted'
  ));
