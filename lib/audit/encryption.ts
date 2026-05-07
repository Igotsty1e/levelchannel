// Wave 2.1 (security) — at-rest encryption for payment_audit_events.
// Wave 3.1 (security) — key rotation via PRIMARY + OLD pair.
//
// We don't perform AES in JS. pgcrypto's `pgp_sym_encrypt(text, psw)`
// runs server-side and produces a bytea ciphertext. The application
// only handles the symmetric key, never the plaintext-on-disk.
//
// Key shape:
//   - read from env `AUDIT_ENCRYPTION_KEY` (the active / PRIMARY key);
//   - 32+ characters required; pgp_sym_encrypt accepts any length but
//     a short key downgrades the underlying KDF iterations enough
//     that we want a hard floor;
//   - cached on first use; resetting requires a process restart
//     (which is what key rotation does anyway).
//
// Wave 3.1 rotation contract:
//   - `AUDIT_ENCRYPTION_KEY`     — the PRIMARY key. Used to ENCRYPT
//     every new audit row, and tried FIRST when reading any existing row.
//   - `AUDIT_ENCRYPTION_KEY_OLD` — optional. The previous key, present
//     only during the rotation window. Reads fall back to it ONLY when
//     the primary fails to decrypt the row (different ciphertext key).
//     Never used for writes.
//
//   Operator runbook (also in SECURITY.md):
//     day 0: set AUDIT_ENCRYPTION_KEY = <new>, AUDIT_ENCRYPTION_KEY_OLD
//            = <previous>. Restart. App writes new rows with the new
//            key; reads succeed for both old + new rows via the
//            either-key SQL helper.
//     day N: run `scripts/rotate-audit-encryption.mjs` to re-encrypt
//            every row from OLD to PRIMARY. Idempotent; rows already
//            on PRIMARY are skipped. Re-runnable.
//     day N+1: drop AUDIT_ENCRYPTION_KEY_OLD from env, restart. All
//              rows are now PRIMARY-only.
//
// Production policy:
//   - missing AUDIT_ENCRYPTION_KEY in NODE_ENV=production → throws on
//     first use;
//   - missing key in dev/test → returns null, application writes
//     plaintext only (existing behaviour). Tests opt in to encryption
//     by setting AUDIT_ENCRYPTION_KEY in their setup.
//   - AUDIT_ENCRYPTION_KEY_OLD is OPTIONAL in any env. Length check
//     applies if present, otherwise treated as absent (null).

let cachedKey: string | null | undefined = undefined
let cachedOldKey: string | null | undefined = undefined

const MIN_KEY_LENGTH = 32

function readAndValidate(
  raw: string,
  varName: string,
): string {
  if (raw.length < MIN_KEY_LENGTH) {
    throw new Error(
      `${varName} must be at least ${MIN_KEY_LENGTH} characters. ` +
        `Got ${raw.length}.`,
    )
  }
  return raw
}

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

  const validated = readAndValidate(raw, 'AUDIT_ENCRYPTION_KEY')
  if (env === process.env) cachedKey = validated
  return validated
}

// Wave 3.1: read-only fallback key during rotation. Returns null when
// not set (the common case — rotation is a rare event). Length-checks
// the value if present, but missing is never an error in any env.
export function getAuditEncryptionKeyOld(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (cachedOldKey !== undefined && env === process.env) return cachedOldKey

  const raw = env.AUDIT_ENCRYPTION_KEY_OLD?.trim() ?? ''
  if (raw.length === 0) {
    if (env === process.env) cachedOldKey = null
    return null
  }

  const validated = readAndValidate(raw, 'AUDIT_ENCRYPTION_KEY_OLD')
  if (env === process.env) cachedOldKey = validated
  return validated
}

// Test hook. Production code must NOT call this — the cached keys are
// load-bearing for the (rare) case where env is later mutated by some
// other module's side effect.
export function __resetAuditEncryptionKeyCache(): void {
  cachedKey = undefined
  cachedOldKey = undefined
}
