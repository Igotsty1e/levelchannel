-- AUDIT-SEC-4 (2026-05-17) — encrypt the Google push channel
-- verification secret at rest. Mirrors the access_token_enc /
-- refresh_token_enc pattern from migration 0043 + the rotation
-- contract from migration 0027 (pgp_sym_decrypt_either).
--
-- Phase A (this migration + the PR that lands it): add nullable
-- channel_token_enc column. App code dual-writes the new column on
-- every channel-token write (lib/calendar/channel-renewer.ts
-- setupChannelForIntegration → the only writer of a non-null
-- channel token) and reads it preferentially (decrypt-aware) with
-- plaintext channel_token as fallback in the webhook handler.
-- Existing rows are not touched by this migration.
--
-- Phase B (operator, after Phase A has soaked and the pre-Phase-A
-- rollback window is closed): backfill encrypted column from
-- plaintext for rows that have channel_token set but
-- channel_token_enc null; null out plaintext after a hard
-- round-trip equality check. Executed via
-- scripts/null-plaintext-channel-token.mjs — not this migration.
-- See SECURITY.md §AUDIT-SEC-4 channel_token migration.
--
-- Phase C (next major release): drop the plaintext channel_token
-- column. Deferred.

alter table teacher_calendar_integrations
  add column if not exists channel_token_enc bytea null;
