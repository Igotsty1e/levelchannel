-- Extend payment_audit_events to cover webhook pre-validation phases
-- and the synchronous-error case for one-click charge.
--
-- Three changes happen together so we don't ship a half-state:
--
-- 1) customer_email becomes nullable.
--    Why: pre-validation phase events (webhook.<kind>.received) fire
--    BEFORE we can trust the payload's email. We can fetch the order
--    by invoice_id and pull email from there — but if validation later
--    rejects the order (mismatch / unknown), the row still needs to
--    survive in audit. Easier path: nullable; let the recorder fill
--    it when it can, leave null otherwise.
--
-- 2) Existing rows tagged event_type='webhook.fail.received' get
--    re-tagged as 'webhook.fail.processed'. Original semantic of
--    'webhook.fail.received' was "Fail webhook arrived AND was applied
--    via markOrderFailed" — that's actually the FINALIZE event. The
--    new event with name 'webhook.fail.received' is the post-parse
--    pre-validation phase, symmetric with the .pay.received and
--    .check.received we're adding. Renaming live data to processed
--    keeps the audit history consistent under the new naming.
--
-- 3) Drop and re-add the CHECK enum constraint with the full new set.
--    Postgres allows DROP+ADD CONSTRAINT in a single transaction; the
--    migrate runner already wraps each migration in BEGIN/COMMIT, so
--    no rows can be observed under a partial enum.
--
-- New event types (six new + one rename):
--   webhook.check.received           — post-HMAC, post-parse, pre-validate
--   webhook.check.declined           — Check returned non-zero code
--   webhook.pay.received             — post-HMAC, post-parse, pre-validate
--   webhook.pay.validation_failed    — Pay payload parsed but order
--                                       cross-check failed (amount,
--                                       email, status mismatch, unknown)
--   webhook.fail.declined            — Fail webhook on already-paid /
--                                       unknown invoice (suspicious)
--   webhook.fail.processed           — finalize (used to be misnamed
--                                       `webhook.fail.received`)
--
-- charge_token.attempted and charge_token.error intentionally NOT added.
--
--   `attempted`: in the current shape of chargeWithSavedCard the
--   invoice_id is created INSIDE the function, so a truly "attempted"
--   event has no invoice_id to attach to. The audit table's invoice_id
--   FK requires a real order row.
--
--   `error`: same problem in the throw path — chargeWithSavedCard may
--   throw before invoice_id exists OR after the order row was inserted
--   but before we know about it in the route. We don't have a clean
--   way to know which case we're in from outside the function. For
--   now `console.warn` in the route's catch is the honest accounting;
--   surfacing `error` as an audit event would require returning
--   `{ kind: 'error', invoiceId, reason }` from chargeWithSavedCard
--   (which means routing the throw through the success path's tuple
--   shape). Tracked in ENGINEERING_BACKLOG.md as a follow-up.

alter table payment_audit_events
  alter column customer_email drop not null;

update payment_audit_events
   set event_type = 'webhook.fail.processed'
 where event_type = 'webhook.fail.received';

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
    'threeds.declined'
  ));
