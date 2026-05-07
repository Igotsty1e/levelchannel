// Wave 2.1 (security) — at-rest encryption for payment_audit_events.
//
// We don't perform AES in JS. pgcrypto's `pgp_sym_encrypt(text, psw)`
// runs server-side and produces a bytea ciphertext. The application
// only handles the symmetric key, never the plaintext-on-disk.
//
// Key shape:
//   - read from env `AUDIT_ENCRYPTION_KEY`;
//   - 32+ characters required; pgp_sym_encrypt accepts any length but
//     a short key downgrades the underlying KDF iterations enough
//     that we want a hard floor;
//   - cached on first use; resetting requires a process restart
//     (which is what key rotation does anyway).
//
// Production policy:
//   - missing key in NODE_ENV=production → throws on first use;
//   - missing key in dev/test → returns null, application writes
//     plaintext only (existing behaviour). Tests opt in to encryption
//     by setting AUDIT_ENCRYPTION_KEY in their setup.

let cachedKey: string | null | undefined = undefined

const MIN_KEY_LENGTH = 32

export function getAuditEncryptionKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  // The cache is keyed by the live `process.env`; tests that mutate
  // env between cases must call `__resetAuditEncryptionKeyCache` to
  // pick up the new value. Production paths set the env once at
  // process start, so a single cache slot is sufficient.
  if (cachedKey !== undefined && env === process.env) return cachedKey

  const raw = env.AUDIT_ENCRYPTION_KEY?.trim() ?? ''
  if (raw.length === 0) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'AUDIT_ENCRYPTION_KEY is required in production. ' +
          'Set it to a random 32+ character string before deploying.',
      )
    }
    if (env === process.env) cachedKey = null
    return null
  }

  if (raw.length < MIN_KEY_LENGTH) {
    throw new Error(
      `AUDIT_ENCRYPTION_KEY must be at least ${MIN_KEY_LENGTH} characters. ` +
        `Got ${raw.length}.`,
    )
  }

  if (env === process.env) cachedKey = raw
  return raw
}

// Test hook. Production code must NOT call this — the cached key is
// load-bearing for the (rare) case where env is later mutated by some
// other module's side effect.
export function __resetAuditEncryptionKeyCache(): void {
  cachedKey = undefined
}
