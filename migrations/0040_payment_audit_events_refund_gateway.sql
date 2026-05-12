-- Refund Phase 7 follow-up #3 — gateway-side automation. Widens
-- payment_audit_events.event_type to include two new kinds:
--
--   'payment.refund.initiated.gateway' — fired by the admin endpoint
--      that calls the CloudPayments `payments/refund` API. The
--      reversal row gets booked at the same time on Success=true.
--
--   'payment.refund.gateway.webhook' — fired by the webhook handler
--      when CP delivers a `Refund` notification. Idempotency-safe:
--      replays do not insert duplicate reversals (the canonical
--      reversal row was already booked at initiation time).
--
-- Follow-up to migration 0037 (which added 'payment.refund.recorded').
-- Same drop-and-recreate pattern as 0034 / 0037.

alter table payment_audit_events
  drop constraint payment_audit_events_event_type_check;

alter table payment_audit_events
  add constraint payment_audit_events_event_type_check
  check (event_type in (
    'order.created',
    'order.cancelled',
    'mock.confirmed',
    'webhook.check.received',
    'webhook.check.declined',
    'webhook.pay.received',
    'webhook.pay.processed',
    'webhook.pay.validation_failed',
    'webhook.fail.received',
    'webhook.fail.declined',
    'webhook.fail.processed',
    'charge_token.succeeded',
    'charge_token.requires_3ds',
    'charge_token.declined',
    'threeds.callback.received',
    'threeds.confirmed',
    'threeds.declined',
    'package.grant.failed',
    'package.grant.succeeded',
    'payment.refund.recorded',
    'payment.refund.initiated.gateway',
    'payment.refund.gateway.webhook'
  ));
