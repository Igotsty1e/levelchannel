-- Refund Phase 7 Stage B — widen payment_audit_events.event_type to
-- include 'payment.refund.recorded', fired by the new admin refund
-- endpoint when a payment_allocation_reversals row lands.
--
-- Follow-up to migration 0034 (which last replaced this CHECK to add
-- package.grant.{succeeded,failed}). Same drop-and-recreate pattern.

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
    'payment.refund.recorded'
  ));
