-- Wave 6.1 #4 (security) — receipt_token capability for invoiceId routes.
--
-- This migration is the SCHEMA half of Wave 6.1. It adds the column;
-- it does NOT yet require it. The runtime code in lib/payments/store
-- and the GET / cancel / stream routes is updated in a follow-up
-- (Phase 1.5: mint + return; Phase 2: enforce). This split keeps the
-- migration and the runtime change independently revertable.
--
-- Why this exists:
--
--   Codex review 2026-05-07 found that anyone who learns an
--   invoiceId can read order status, open an unlimited-duration SSE
--   stream, and cancel a pending order — `app/api/payments/[invoiceId]`,
--   `[invoiceId]/stream`, `[invoiceId]/cancel` authorize ONLY by
--   invoiceId shape. None require a session. invoiceIds leak via
--   shared screenshots, browser history, GitHub issue comments, etc;
--   they were never meant to be capability-secrets.
--
--   The fix is a server-issued receipt token, separate from the
--   invoiceId. The token is a 32-byte cryptographically random
--   string returned in the create-order response. The server stores
--   only the sha256 hash. Future requests carry the plain token
--   (?token=<plain> query param OR X-Receipt-Token header); the
--   routes hash and compare to the stored value. invoiceId stays as
--   the public reference; the token is the capability.
--
-- Schema design:
--
--   - `receipt_token_hash text null` — sha256 hex of the plain token.
--     NULL on rows that pre-date this wave; runtime fallback (Phase 2)
--     handles them via a grace window before refusing.
--
--   - Unique partial index on the column, `where receipt_token_hash
--     is not null`. Sha256 collisions are cosmically improbable but
--     the unique constraint makes any future "did the same token get
--     issued twice" question a fast SQL answer. The partial index
--     keeps the constraint from tripping on the legacy NULL rows.
--
-- Idempotence: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

alter table payment_orders
  add column if not exists receipt_token_hash text null;

create unique index if not exists payment_orders_receipt_token_hash_idx
  on payment_orders (receipt_token_hash)
  where receipt_token_hash is not null;

comment on column payment_orders.receipt_token_hash is
  'Wave 6.1 #4 — sha256(receipt_token) for capability-based access to GET/cancel/stream routes. NULL on pre-wave rows. Plain token is returned ONCE in create-order response and never persisted server-side.';
