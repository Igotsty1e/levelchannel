type RateLimitBucket = {
  count: number
  resetAt: number
}

type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

const buckets = new Map<string, RateLimitBucket>()

function now() {
  return Date.now()
}

function cleanupExpiredBuckets(currentTime: number) {
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= currentTime) {
      buckets.delete(key)
    }
  })
}

export function takeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const currentTime = now()
  cleanupExpiredBuckets(currentTime)

  const current = buckets.get(key)

  if (!current || current.resetAt <= currentTime) {
    buckets.set(key, {
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
  buckets.set(key, current)

  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((current.resetAt - currentTime) / 1000),
    ),
  }
}

// Test-only: clear all in-memory buckets between integration tests
// so rate-limit thresholds don't leak across cases.
export function __resetRateLimitsForTesting(): void {
  buckets.clear()
}
