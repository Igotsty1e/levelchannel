-- Wave 2.1 (security) — at-rest encryption for payment_audit_events PII.
--
-- Until now, `payment_audit_events.customer_email` and `client_ip`
-- have been stored plaintext. The retention policy is ~3 years
-- (152-FZ alignment for financial records), so a DB dump leak —
-- via Render support, an operator laptop, a backup misconfig — would
-- expose 3 years of customer emails + login IPs. HMAC verify, env-
-- only credentials, and the new TLS-required pool from Wave 1.1 each
-- raise the bar; encryption-at-rest is the layer that stays
-- protective even after a credentialed leak.
--
-- pgcrypto: enable the extension and add bytea columns alongside the
-- existing plaintext ones. We DO NOT drop the plaintext columns in
-- this migration. Per migrations/README.md, additive only — destructive
-- changes need a separate planning round and an operator-confirmed
-- backfill cycle.
--
-- The migration plan is three-phase:
--   Phase A (this wave): add encrypted columns. Application dual-
--     writes plaintext + encrypted; reads prefer encrypted with
--     plaintext fallback. Operator runs the backfill script
--     (scripts/backfill-audit-encryption.mjs) to encrypt historical
--     rows. With AUDIT_ENCRYPTION_KEY set in env, every NEW row is
--     encrypted at rest immediately.
--
--   Phase B (operator-driven, no migration): once the backfill is
--     verified in prod (every row has customer_email_enc populated),
--     the operator runs a one-shot SQL:
--
--       update payment_audit_events
--          set customer_email = null, client_ip = null
--        where customer_email_enc is not null
--           or client_ip_enc is not null;
--
--     This is DML, not DDL — no schema change. After this point the
--     plaintext columns hold no data; the application's read path
--     keeps working because it already prefers the encrypted column.
--
--   Phase C (future wave, when Phase B is fully in for >30 days):
--     drop the plaintext columns entirely. That's the destructive
--     migration.
--
-- AUDIT_ENCRYPTION_KEY:
--   - mandatory in production (lib/audit/encryption.ts throws on
--     first use if missing in NODE_ENV=production);
--   - 32+ chars random;
--   - rotated by writing both keys into the env temporarily, running
--     a re-encrypt script, then dropping the old key. Key rotation
--     is operator-side; not in scope for this wave.

create extension if not exists pgcrypto;

alter table payment_audit_events
  add column if not exists customer_email_enc bytea null,
  add column if not exists client_ip_enc bytea null;
