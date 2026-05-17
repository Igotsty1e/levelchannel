// BCS-C.1 — at-rest encryption key resolver for the Google Calendar
// integration. Mirrors `lib/audit/encryption.ts` (Wave 2.1 + 3.1)
// because the same trust pattern applies: pgcrypto runs the actual
// AES-equivalent server-side, the application only handles the
// symmetric key string, plaintext never lands on disk.
//
// What gets encrypted with this key:
//   - teacher_calendar_integrations.access_token_enc
//   - teacher_calendar_integrations.refresh_token_enc
//   - teacher_calendar_integrations.channel_token_enc (AUDIT-SEC-4)
//   - teacher_external_busy_intervals.summary_encrypted
//
// Blast-radius isolation: this is a SEPARATE env from
// AUDIT_ENCRYPTION_KEY. A leak of one key must not decrypt the other
// table's data. Same rotation pattern, different secret.
//
// Key shape:
//   - read from env `CALENDAR_ENCRYPTION_KEY` (the active / PRIMARY key);
//   - 32+ characters required; pgp_sym_encrypt accepts any length but
//     short keys downgrade the underlying KDF iterations enough that
//     we want a hard floor;
//   - cached on first use; resetting requires a process restart
//     (which is what key rotation does anyway).
//
// Rotation contract:
//   - `CALENDAR_ENCRYPTION_KEY`     — PRIMARY. Used to ENCRYPT every
//     new row, and tried FIRST when reading any existing row.
//   - `CALENDAR_ENCRYPTION_KEY_OLD` — optional. The previous key,
//     present only during the rotation window. Reads fall back to it
//     ONLY when PRIMARY fails to decrypt (different ciphertext key).
//     Never used for writes.
//
// Production policy:
//   - missing CALENDAR_ENCRYPTION_KEY in NODE_ENV=production AND any
//     teacher_calendar_integrations row exists → resolver throws on
//     first use. The "no integration yet" state in early production
//     is safe because the resolver is only invoked when we touch
//     tokens or summaries.
//   - missing key in dev/test → returns null. Tests opt in to
//     encryption by setting the env in their setup.
//   - CALENDAR_ENCRYPTION_KEY_OLD is OPTIONAL in any env. Length check
//     applies if present, otherwise treated as absent (null).

let cachedKey: string | null | undefined = undefined
let cachedOldKey: string | null | undefined = undefined

const MIN_KEY_LENGTH = 32

function readAndValidate(raw: string, varName: string): string {
  if (raw.length < MIN_KEY_LENGTH) {
    throw new Error(
      `${varName} must be at least ${MIN_KEY_LENGTH} characters. ` +
        `Got ${raw.length}.`,
    )
  }
  return raw
}

export function getCalendarEncryptionKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  // The cache is keyed by the live `process.env`; tests that mutate
  // env between cases must call `__resetCalendarEncryptionKeyCache()`
  // to pick up the new value. Production paths set the env once at
  // process start, so a single cache slot is sufficient.
  if (cachedKey !== undefined && env === process.env) return cachedKey

  const raw = env.CALENDAR_ENCRYPTION_KEY?.trim() ?? ''
  if (raw.length === 0) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'CALENDAR_ENCRYPTION_KEY is required in production. ' +
          'Set it to a random 32+ character string before deploying ' +
          'the Google Calendar integration. ' +
          'See SECURITY.md for the rotation runbook.',
      )
    }
    if (env === process.env) cachedKey = null
    return null
  }

  const validated = readAndValidate(raw, 'CALENDAR_ENCRYPTION_KEY')
  if (env === process.env) cachedKey = validated
  return validated
}

// Read-only fallback key during rotation. Returns null when not set
// (the common case — rotation is a rare event). Length-checks the
// value if present, but missing is never an error in any env.
export function getCalendarEncryptionKeyOld(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (cachedOldKey !== undefined && env === process.env) return cachedOldKey

  const raw = env.CALENDAR_ENCRYPTION_KEY_OLD?.trim() ?? ''
  if (raw.length === 0) {
    if (env === process.env) cachedOldKey = null
    return null
  }

  const validated = readAndValidate(raw, 'CALENDAR_ENCRYPTION_KEY_OLD')
  if (env === process.env) cachedOldKey = validated
  return validated
}

// Test hook. Production code must NOT call this — the cached keys are
// load-bearing for the (rare) case where env is later mutated by some
// other module's side effect.
export function __resetCalendarEncryptionKeyCache(): void {
  cachedKey = undefined
  cachedOldKey = undefined
}
