-- Customer-supplied comment on the payment form. Free-text up to 128
-- chars, optional. We use it for two things:
--   1. surface in the operator's payment notification email so the
--      operator sees what the payment is for at a glance ("за урок
--      26 апреля", "пакет на январь" и т.п.)
--   2. compose a richer `description` for the CloudPayments order so
--      the bank statement and chek read sensibly even without context
--
-- Stored separately from `description` because `description` is
-- composed server-side (PAYMENT_DESCRIPTION + comment + amount); the
-- raw user text is preserved in `customer_comment` for audit + admin
-- search.
--
-- Validation lives in the route handler:
--   - server trims whitespace
--   - rejects after-trim length > 128 with 400
--   - control characters stripped before persist (defense in depth)
-- The column itself just stores the post-validate string verbatim.

alter table payment_orders
  add column if not exists customer_comment text null;
