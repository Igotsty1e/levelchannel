import { Pool } from 'pg'

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
