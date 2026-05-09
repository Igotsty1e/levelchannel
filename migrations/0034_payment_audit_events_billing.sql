-- Billing wave PR 2 — widen payment_audit_events.event_type to include
-- the package-grant outcome events.
--
-- Two new event_type values:
--   - package.grant.failed    (one of the seven semantic ownership
--                              failure reasons; payload carries the reason)
--   - package.grant.succeeded (purchase materialized; payload carries
--                              package_purchase_id)
--
-- The CHECK constraint was last replaced in migration 0014; this
-- migration follows the same drop-and-recreate pattern.

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
    'package.grant.succeeded'
  ));
