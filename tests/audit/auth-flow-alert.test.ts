import { describe, expect, it } from 'vitest'

// The script is a Node ESM module that reads env at module evaluation
// time. We import only the exported decision logic — no Postgres or
// Resend gets touched by this test.
import { decideVerdict } from '../../scripts/auth-flow-alert.mjs'

const noOffenders = {
  totalFailed: 0,
  offendingIps: [],
  offendingEmailHashes: [],
}

describe('auth-flow-alert / decideVerdict', () => {
  it('no_failures when total is 0 and no offenders', () => {
    expect(decideVerdict(noOffenders)).toEqual({ kind: 'no_failures' })
  })

  it('ok when there are failures but no IP / email_hash exceeds threshold', () => {
    const stats = {
      totalFailed: 17,
      offendingIps: [],
      offendingEmailHashes: [],
    }
    expect(decideVerdict(stats)).toEqual({ kind: 'ok' })
  })

  it('alert when at least one IP is over threshold', () => {
    const stats = {
      totalFailed: 80,
      offendingIps: [{ ip: '203.0.113.42', failures: 80 }],
      offendingEmailHashes: [],
    }
    expect(decideVerdict(stats)).toEqual({ kind: 'alert' })
  })

  it('alert when at least one email_hash is over threshold', () => {
    const stats = {
      totalFailed: 30,
      offendingIps: [],
      offendingEmailHashes: [{ emailHashShort: 'a1b2c3d4', failures: 25 }],
    }
    expect(decideVerdict(stats)).toEqual({ kind: 'alert' })
  })

  it('alert when both axes have offenders', () => {
    const stats = {
      totalFailed: 100,
      offendingIps: [{ ip: '203.0.113.99', failures: 51 }],
      offendingEmailHashes: [{ emailHashShort: '00000000', failures: 49 }],
    }
    expect(decideVerdict(stats)).toEqual({ kind: 'alert' })
  })

  it('does NOT alert on a quiet window with high background activity', () => {
    // 200 failures spread evenly across 50 IPs and 50 emails would
    // mean 4 failures per IP and per email — well under thresholds.
    // The SQL `having count(*) > threshold` already filters this case
    // out before stats reaches decideVerdict; this test pins the
    // contract that decideVerdict is purely a switchboard on what the
    // SQL hands it, not a re-check of thresholds.
    const stats = {
      totalFailed: 200,
      offendingIps: [],
      offendingEmailHashes: [],
    }
    expect(decideVerdict(stats)).toEqual({ kind: 'ok' })
  })
})
