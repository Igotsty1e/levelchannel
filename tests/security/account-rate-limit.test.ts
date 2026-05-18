import { afterEach, describe, expect, it } from 'vitest'

import { __resetRateLimitsForTesting } from '@/lib/security/rate-limit'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'

// SAAS-3+4 TINV.4-follow-up pure-function tests for the new
// `enforceAccountRateLimit` helper. Pins:
//   - bucket counts by account id only (no IP suffix).
//   - two different IPs against the same account share the bucket.
//   - returns null on allow, 429 Response on deny.

afterEach(async () => {
  await __resetRateLimitsForTesting()
})

describe('enforceAccountRateLimit', () => {
  it('allows the first N calls then 429s', async () => {
    const accountId = '00000000-0000-0000-0000-000000000001'
    for (let i = 0; i < 3; i += 1) {
      const r = await enforceAccountRateLimit(accountId, 'test', 3, 60_000)
      expect(r).toBeNull()
    }
    const denied = await enforceAccountRateLimit(accountId, 'test', 3, 60_000)
    expect(denied).not.toBeNull()
    expect(denied!.status).toBe(429)
    expect(denied!.headers.get('Retry-After')).toBeTruthy()
  })

  it('different accounts get independent buckets', async () => {
    const accountA = '00000000-0000-0000-0000-00000000000a'
    const accountB = '00000000-0000-0000-0000-00000000000b'
    for (let i = 0; i < 3; i += 1) {
      expect(
        await enforceAccountRateLimit(accountA, 'test', 3, 60_000),
      ).toBeNull()
    }
    // A is at limit; B can still pass.
    expect(
      await enforceAccountRateLimit(accountA, 'test', 3, 60_000),
    ).not.toBeNull()
    expect(
      await enforceAccountRateLimit(accountB, 'test', 3, 60_000),
    ).toBeNull()
  })

  it('different scopes for the same account get independent buckets', async () => {
    const accountId = '00000000-0000-0000-0000-000000000099'
    for (let i = 0; i < 3; i += 1) {
      expect(
        await enforceAccountRateLimit(accountId, 'scope-1', 3, 60_000),
      ).toBeNull()
    }
    // scope-1 burnt; scope-2 still fresh.
    expect(
      await enforceAccountRateLimit(accountId, 'scope-1', 3, 60_000),
    ).not.toBeNull()
    expect(
      await enforceAccountRateLimit(accountId, 'scope-2', 3, 60_000),
    ).toBeNull()
  })

  it('key shape is pure account id (no IP component — round-2 WARN#5+#6 closure)', async () => {
    // Verifying the key shape indirectly: with the OLD IP-keyed
    // helper, two simulated different IPs would burn separate
    // buckets. Here, there's no `request` arg — the helper has no
    // way to see IP. We assert this contract by simply confirming
    // the helper's signature accepts (accountId, scope, limit,
    // windowMs) and returns NextResponse | null without needing a
    // Request. The integration suite (TINV.6.11+6.12) pins the
    // route-level shape end-to-end with real cookies + simulated
    // IPs.
    const r = await enforceAccountRateLimit(
      '00000000-0000-0000-0000-000000000022',
      'shape-pin',
      1,
      60_000,
    )
    expect(r).toBeNull()
    const second = await enforceAccountRateLimit(
      '00000000-0000-0000-0000-000000000022',
      'shape-pin',
      1,
      60_000,
    )
    expect(second).not.toBeNull()
    expect(second!.status).toBe(429)
  })
})
