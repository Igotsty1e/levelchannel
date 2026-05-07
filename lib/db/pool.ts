import { Pool, type PoolConfig } from 'pg'

// Single shared `pg.Pool` for every Postgres-backed module:
// payments, auth, idempotency, telemetry, audit. Replaces five
// per-domain pools that each defaulted to `max=10` connections —
// 50 connections worst case, against Postgres `max_connections=100`
// default. With a single bounded pool we cap our footprint and stop
// having to negotiate with ourselves on multi-instance future.
//
// Why one pool and not one pool per domain "for isolation":
//
//   - Connection acquisition is queued at the pool level, not at the
//     query level. A slow audit insert can't starve auth queries —
//     Postgres serves them in parallel up to `max`. The "isolation"
//     concern is theoretical at our load.
//
//   - On VPS the connection cap is shared by the whole process anyway.
//     Splitting into 5 buckets just makes the cap unevenly used.
//
//   - Per-domain getters (getAuthPool / getAuditPool / etc.) stay
//     for legibility — call sites don't change. They all delegate
//     here and return the same singleton.
//
// Env: reads `DATABASE_URL`. If unset, returns null — callers MUST
// handle the no-pool case gracefully (audit recorder already does;
// payment storage already throws explicitly).
//
// The `max` ceiling: 10 keeps us under Postgres free-tier limits
// (most managed Postgres tiers allow 25-50 connections per app).
// Tunable via `DATABASE_POOL_MAX`.

declare global {
  // eslint-disable-next-line no-var
  var __levelchannelDbPool: Pool | undefined
}

function readPoolMax(): number {
  const raw = process.env.DATABASE_POOL_MAX?.trim() || ''
  if (!raw) return 10
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return 10
  return Math.floor(parsed)
}

// TLS policy. The pg library's JS-side `ssl` option overrides any
// `?sslmode=...` hint in the URL, so this is the authoritative policy.
//
// Auto-detect by host:
//   - localhost / 127.0.0.1 / ::1 / *.local → no TLS (loopback —
//     same-host Postgres is the legit single-server deploy shape)
//   - everything else → `{ rejectUnauthorized: true }`
//
// Explicit overrides via `DB_SSL`:
//   - `disable` / `off` / `false` → no TLS (rejected in production
//     ONLY for non-local hosts — disabling TLS on a remote Postgres
//     in prod is the actual leak; on loopback it is meaningless)
//   - `require` / `on` / `true`   → strict TLS even on localhost
//
// `DB_SSL_REJECT_UNAUTHORIZED=false`: encrypted-but-lax cert check.
// Rejected in production for non-local hosts (we don't silently
// accept self-signed certs from a remote Postgres in prod). Allowed
// for localhost because the loopback path doesn't carry a cert
// chain that matters.
//
// Note: this resolver does NOT block a localhost `DATABASE_URL` in
// production. A single-server deploy with Postgres on the same VPS
// is a valid topology; the original "refuse localhost in prod" rule
// was overzealous and broke real prod. The `DATABASE_URL is not
// configured` throw in `getDbPool()` already covers the
// implicit-fallback risk (forgotten env → loud failure, not silent
// localhost connect).
export function resolveSslConfig(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): PoolConfig['ssl'] {
  const isProd = env.NODE_ENV === 'production'
  const explicit = (env.DB_SSL ?? '').trim().toLowerCase()

  // Detect host first; production safety only matters for non-local hosts.
  let host: string | null = null
  try {
    host = new URL(url).hostname.toLowerCase()
    // WHATWG URL keeps the brackets on IPv6 hostnames (`[::1]`).
    // Strip them so the localhost check below sees a bare address.
    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1)
    }
  } catch {
    // Malformed URL — let pg surface the parse error downstream.
    // Treat as "non-local" so the strict TLS default kicks in.
  }

  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    (host !== null && host.endsWith('.local'))

  // DB_SSL=disable: production safety applies only to non-local hosts.
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

  // DB_SSL_REJECT_UNAUTHORIZED=false: production safety for remote hosts.
  const rejectUnauthorizedRaw = (env.DB_SSL_REJECT_UNAUTHORIZED ?? '')
    .trim()
    .toLowerCase()
  const rejectUnauthorized = rejectUnauthorizedRaw !== 'false'

  if (isProd && !rejectUnauthorized && !isLocal) {
    throw new Error(
      'DB_SSL_REJECT_UNAUTHORIZED=false is rejected for non-local hosts in production.',
    )
  }

  // DB_SSL=require: strict TLS regardless of host.
  if (
    explicit === 'require' ||
    explicit === 'on' ||
    explicit === 'true' ||
    explicit === '1' ||
    explicit === 'yes'
  ) {
    return { rejectUnauthorized }
  }

  // Auto path: localhost gets no TLS, every other host gets strict TLS.
  if (isLocal) {
    return false
  }

  return { rejectUnauthorized }
}

// The throw-on-missing variant. Used by code that assumes Postgres
// is configured (the production payment / auth path); throws so the
// failure surfaces immediately rather than silently no-op'ing.
export function getDbPool(): Pool {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not configured.')
  }

  if (!global.__levelchannelDbPool) {
    global.__levelchannelDbPool = new Pool({
      connectionString: url,
      max: readPoolMax(),
      ssl: resolveSslConfig(url),
    })
  }
  return global.__levelchannelDbPool
}

// Optional variant: returns null when DATABASE_URL is missing instead
// of throwing. Used by audit recorder, which is best-effort and must
// silently skip when there's no DB to talk to.
export function getDbPoolOrNull(): Pool | null {
  if (!process.env.DATABASE_URL) return null
  return getDbPool()
}
