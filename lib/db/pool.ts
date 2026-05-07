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

// TLS policy. Default: enforce TLS with strict cert verification on
// every non-local host. The pg library's JS-side `ssl` option
// overrides any `?sslmode=...` hint in the URL, so this is the
// authoritative policy.
//
// Auto-detect:
//   - localhost / 127.0.0.1 / ::1 / *.local → no TLS (local dev)
//   - everything else → `{ rejectUnauthorized: true }`
//
// Explicit overrides via `DB_SSL`:
//   - `disable` / `off` / `false` → no TLS (rejected in production)
//   - `require` / `on` / `true`   → strict TLS even on localhost
//
// In production:
//   - `DB_SSL=disable` is rejected (throws).
//   - `DATABASE_URL` pointing at localhost is rejected (throws) —
//     a real Postgres host is mandatory.
//   - `DB_SSL_REJECT_UNAUTHORIZED=false` is rejected (throws). We do
//     not silently accept self-signed certs in prod.
export function resolveSslConfig(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): PoolConfig['ssl'] {
  const isProd = env.NODE_ENV === 'production'
  const explicit = (env.DB_SSL ?? '').trim().toLowerCase()

  if (
    explicit === 'disable' ||
    explicit === 'off' ||
    explicit === 'false' ||
    explicit === '0' ||
    explicit === 'no'
  ) {
    if (isProd) {
      throw new Error(
        'DB_SSL=disable is rejected in production. Postgres connections must use TLS.',
      )
    }
    return false
  }

  const rejectUnauthorizedRaw = (env.DB_SSL_REJECT_UNAUTHORIZED ?? '')
    .trim()
    .toLowerCase()
  const rejectUnauthorized = rejectUnauthorizedRaw !== 'false'

  if (isProd && !rejectUnauthorized) {
    throw new Error(
      'DB_SSL_REJECT_UNAUTHORIZED=false is rejected in production.',
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

  // Auto path: parse the URL, decide by host.
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
    // Strict TLS is the safe default until then.
  }

  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    (host !== null && host.endsWith('.local'))

  if (isLocal) {
    if (isProd) {
      throw new Error(
        'DATABASE_URL points at localhost in production. Set it to a real Postgres host.',
      )
    }
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
