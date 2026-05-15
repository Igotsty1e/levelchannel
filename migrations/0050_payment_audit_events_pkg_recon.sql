-- PKG-RECON wave RECON.0 — extend payment_audit_events.event_type
-- CHECK constraint with 3 new operator-action event types.
--
-- Base: current head taxonomy (migrations 0034 + 0037 + 0040 all
-- shipped before this one; the rebase here lists ALL existing types
-- explicitly so a migration replay from scratch lands the right set).
-- Verified against lib/audit/payment-events.ts:PAYMENT_AUDIT_EVENT_TYPES
-- at migration-write time (round 1 BLOCKER #9 closure).

alter table payment_audit_events
  drop constraint payment_audit_events_event_type_check;

alter table payment_audit_events
  add constraint payment_audit_events_event_type_check
  check (event_type in (
    -- 0034 (billing wave) baseline + earlier order/webhook events:
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
    -- 0050 (THIS migration — PKG-RECON):
    'payment.grant.retried-by-admin',
    'payment.grant.account-attached-by-admin',
    'payment.grant.resolved-manually-by-admin'
  ));
