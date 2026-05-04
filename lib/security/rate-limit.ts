import { getDbPoolOrNull } from '@/lib/db/pool'

type RateLimitBucket = {
  count: number
  resetAt: number
}

type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

// In-memory fallback bucket store. Used when DATABASE_URL is unset
// (local dev / mock-payment mode without Postgres) or when Postgres
// is transiently unreachable. Multi-instance correctness only holds
// when the Postgres path is in use.
const memoryBuckets = new Map<string, RateLimitBucket>()

function now() {
  return Date.now()
}

function cleanupExpiredMemoryBuckets(currentTime: number) {
  memoryBuckets.forEach((bucket, key) => {
    if (bucket.resetAt <= currentTime) {
      memoryBuckets.delete(key)
    }
  })
}

function takeMemoryBucket(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const currentTime = now()
  cleanupExpiredMemoryBuckets(currentTime)

  const current = memoryBuckets.get(key)

  if (!current || current.resetAt <= currentTime) {
    memoryBuckets.set(key, {
      count: 1,
      resetAt: currentTime + windowMs,
    })

    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    }
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((current.resetAt - currentTime) / 1000),
      ),
    }
  }

  current.count += 1
  memoryBuckets.set(key, current)

  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((current.resetAt - currentTime) / 1000),
    ),
  }
}

// Single-statement atomic upsert. Either inserts a fresh bucket or
// increments / refreshes the existing one based on `reset_at`.
// Returns the post-update `count` and `reset_at`; the allow/deny
// decision is taken in app code from those numbers. See the migration
// 0016 header for the algorithm.
async function takePostgresBucket(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  const pool = getDbPoolOrNull()
  if (!pool) return null

  try {
    const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000))
    const result = await pool.query<{ count: number; reset_at: Date }>(
      `insert into rate_limit_buckets (bucket_key, count, reset_at)
       values ($1, 1, now() + make_interval(secs => $2))
       on conflict (bucket_key) do update
         set count = case
               when rate_limit_buckets.reset_at <= now() then 1
               else rate_limit_buckets.count + 1
             end,
             reset_at = case
               when rate_limit_buckets.reset_at <= now()
                 then now() + make_interval(secs => $2)
               else rate_limit_buckets.reset_at
             end
       returning count, reset_at`,
      [key, windowSeconds],
    )

    const row = result.rows[0]
    if (!row) return null

    const count = Number(row.count)
    const resetAtMs = new Date(row.reset_at).getTime()
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((resetAtMs - now()) / 1000),
    )

    if (count > limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds,
    }
  } catch (error) {
    // Fail-open at the *transport* level: if Postgres is unreachable
    // we fall back to the in-memory bucket so the route still has
    // *some* protection. nginx `limit_req` is the last line and
    // remains in place. Logged at warn so an outage is visible.
    console.warn(
      JSON.stringify({
        level: 'warn',
        ts: new Date().toISOString(),
        probe: 'rate-limit',
        msg: 'postgres bucket failed, falling back to memory',
        key,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return null
  }
}

export async function takeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const pgResult = await takePostgresBucket(key, limit, windowMs)
  if (pgResult) return pgResult
  return takeMemoryBucket(key, limit, windowMs)
}

// Test-only: clear all in-memory buckets and (when DATABASE_URL is
// set) truncate the Postgres bucket table so rate-limit thresholds
// don't leak across integration test cases. Without this, every
// test request shares the same client-ip ("unknown" because
// buildRequest does not set X-Forwarded-For) and the global counter
// burns down within one suite.
export async function __resetRateLimitsForTesting(): Promise<void> {
  memoryBuckets.clear()
  const pool = getDbPoolOrNull()
  if (!pool) return
  try {
    await pool.query('truncate table rate_limit_buckets')
  } catch {
    // Table may not exist yet (migration not applied in some unit
    // contexts that happen to have DATABASE_URL set). Best-effort.
  }
}
