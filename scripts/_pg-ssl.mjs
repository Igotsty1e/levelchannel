// JS port of `resolveSslConfig` from `lib/db/pool.ts`. Operator-side
// scripts (backfill / rotate / retention / etc.) cannot import the TS
// module directly — this file keeps the policy in one place so a script
// that talks to production Postgres goes through the same TLS gate as
// the app does.
//
// MUST stay in lockstep with `lib/db/pool.ts:resolveSslConfig`. If the
// app changes the policy, change it here too. Tests for the TS source
// (tests/db/pool.test.ts) cover the gate semantics; this file is a
// 1:1 port.
//
// Why centralize: Codex review 2026-05-07 found that
// `scripts/backfill-audit-encryption.mjs` and
// `scripts/rotate-audit-encryption.mjs` were instantiating raw
// `new pg.Pool({connectionString})` pools — bypassing the app's TLS
// gate entirely. Rotation in particular sends BOTH the new and the old
// AUDIT_ENCRYPTION_KEY values to the DB; without strict TLS that is a
// key-material leak on the wire.

export function resolveSslConfig(url, env = process.env) {
  const isProd = env.NODE_ENV === 'production'
  const explicit = String(env.DB_SSL ?? '').trim().toLowerCase()

  let host = null
  try {
    host = new URL(url).hostname.toLowerCase()
    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1)
    }
  } catch {
    // Malformed URL — fall back to strict TLS (default below).
  }

  // Strict loopback allowlist. Literal-only — never wildcard suffixes.
  // `.local` is mDNS / LAN, NOT loopback.
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '::1'

  if (
    explicit === 'disable' ||
    explicit === 'off' ||
    explicit === 'false' ||
    explicit === '0' ||
    explicit === 'no'
  ) {
    if (isProd && !isLocal) {
      throw new Error(
        'DB_SSL=disable is rejected for non-local hosts in production. Postgres connections to remote hosts must use TLS.',
      )
    }
    return false
  }

  const rejectUnauthorizedRaw = String(env.DB_SSL_REJECT_UNAUTHORIZED ?? '')
    .trim()
    .toLowerCase()
  const rejectUnauthorized = rejectUnauthorizedRaw !== 'false'

  if (isProd && !rejectUnauthorized && !isLocal) {
    throw new Error(
      'DB_SSL_REJECT_UNAUTHORIZED=false is rejected for non-local hosts in production.',
    )
  }

  if (
    explicit === 'require' ||
    explicit === 'on' ||
    explicit === 'true' ||
    explicit === '1' ||
    explicit === 'yes'
  ) {
    return { rejectUnauthorized }
  }

  if (isLocal) {
    return false
  }

  return { rejectUnauthorized }
}
