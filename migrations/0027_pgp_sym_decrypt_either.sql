-- Wave 3.1 (security) — try-decrypt-either-key SQL helper for
-- AUDIT_ENCRYPTION_KEY rotation.
--
-- pgcrypto's `pgp_sym_decrypt(data, key)` THROWS on a wrong key
-- ("Wrong key or corrupt data"). That's load-bearing — it means we
-- can't write `coalesce(pgp_sym_decrypt(_enc, $primary),
-- pgp_sym_decrypt(_enc, $old))` directly: the throw on the first
-- argument aborts the whole query.
--
-- The PL/pgSQL helper here wraps each attempt in an EXCEPTION block
-- and returns NULL when both keys fail. The reader composes it with
-- the existing plaintext-fallback CASE so that:
--
--   1. PRIMARY succeeds → return the decrypted text.
--   2. PRIMARY throws (different ciphertext key), OLD succeeds →
--      return the decrypted text. This is the rotation-window path.
--   3. Both keys fail OR OLD is null and PRIMARY failed → return NULL.
--      The outer CASE then falls back to the plaintext column (which
--      after Phase B is null too — so the row simply disappears from
--      the read; loud failure surfaces in the operator UI).
--
-- Volatility: STABLE — same input produces the same output within a
-- single statement, but the underlying key material changes across
-- rotations. Not IMMUTABLE because the function reads pgcrypto's
-- internal state (timing-safe compare, randomness in pgp_sym_encrypt
-- on the WRITE path which doesn't apply here but the family is the
-- same). STABLE is correct.
--
-- Safety: the parameters are passed as TEXT, not bytea. pgcrypto's
-- `pgp_sym_decrypt(bytea, text)` is the matching signature.

create or replace function pgp_sym_decrypt_either(
  data bytea,
  primary_key text,
  old_key text default null
) returns text
language plpgsql
stable
as $$
begin
  -- Try the PRIMARY key first. The common case (>99% of reads after
  -- rotation completes) returns from this branch.
  if primary_key is not null and primary_key <> '' then
    begin
      return pgp_sym_decrypt(data, primary_key);
    exception when others then
      -- Wrong key or corrupt data — fall through to OLD.
    end;
  end if;

  -- Try the OLD key (only present during a rotation window).
  if old_key is not null and old_key <> '' then
    begin
      return pgp_sym_decrypt(data, old_key);
    exception when others then
      -- Both keys failed — return NULL. The reader's outer CASE
      -- will fall back to plaintext column or emit NULL.
      return null;
    end;
  end if;

  -- No OLD key configured and PRIMARY failed.
  return null;
end;
$$;

-- Documentation marker for tracking. The function lives in the
-- public schema; renaming it requires a coordinated app + migration
-- update.
comment on function pgp_sym_decrypt_either(bytea, text, text) is
  'Wave 3.1 — try-decrypt with PRIMARY then OLD key, return NULL if both fail. Used by lib/audit/payment-events.ts during AUDIT_ENCRYPTION_KEY rotation.';
