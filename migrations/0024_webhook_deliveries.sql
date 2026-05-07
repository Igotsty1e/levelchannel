-- Wave 1 (security) — webhook delivery dedup.
--
-- CloudPayments retries webhook deliveries when the merchant ACK is
-- slow, the network blips, or any non-2xx response is observed. Each
-- retry carries the SAME `TransactionId`. Without a dedup gate, a
-- retried Pay webhook re-runs:
--   - markOrderPaid (a second paid→paid transition; today a no-op
--     at the data layer, but still touches the row)
--   - recordPaymentAuditEvent (a duplicate audit row per retry —
--     pollutes the journal with phantom transitions)
--   - sendOperatorPaymentNotification (a duplicate operator email)
--   - recordAllocation (a second insert; ON CONFLICT DO NOTHING saves
--     us at the data layer, but still costs a roundtrip)
--
-- The HMAC verification + amount/email cross-check in the route
-- already block FORGED webhooks. This table blocks REPLAYED
-- legitimate webhooks.
--
-- Primary key:
--   (provider, kind, transaction_id) — a single transaction can fire
--   both `check` and `pay` webhooks legitimately, so kind is part of
--   the key. provider is included so the table extends cleanly when
--   a second PSP is added (today: only cloudpayments).
--
-- invoice_id:
--   nullable on purpose. We DON'T put a FK on payment_orders here —
--   the dedup row should outlive the order it points at (audit-grade
--   retention) and a missing order should not hide a duplicate
--   delivery from the dedup gate. Indexed conditionally for the
--   "show me every webhook for this invoice" admin query.
--
-- response_status / response_body:
--   what we replied to the original delivery. The retry receives a
--   bit-for-bit copy plus a `Webhook-Replay: true` header, so the
--   merchant-side ACK contract stays consistent across attempts.
--
-- received_at:
--   indexed for the cleanup janitor (mirrors idempotency_records).
--   We retain webhook deliveries for 90 days — long enough to debug
--   any real production support escalation, short enough to keep
--   the table small.

create table if not exists webhook_deliveries (
  provider text not null,
  kind text not null,
  transaction_id text not null,
  invoice_id text null,
  response_status int not null,
  response_body jsonb not null,
  received_at timestamptz not null default now(),
  primary key (provider, kind, transaction_id),
  constraint webhook_deliveries_provider_check
    check (provider in ('cloudpayments')),
  constraint webhook_deliveries_kind_check
    check (kind in ('check', 'pay', 'fail'))
);

create index if not exists webhook_deliveries_received_at_idx
  on webhook_deliveries (received_at);

create index if not exists webhook_deliveries_invoice_idx
  on webhook_deliveries (invoice_id)
  where invoice_id is not null;
