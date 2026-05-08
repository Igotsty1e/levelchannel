import { describe, expect, it } from 'vitest'

// The script is a Node ESM module that reads env at module evaluation
// time. We import only the exported decision logic — no Postgres or
// Resend gets touched by this test.
import {
  decideVerdict,
  offenderFingerprint,
  shouldSuppress,
} from '../../scripts/auth-flow-alert.mjs'

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

// Codex review 2026-05-09 — dedup. Without this, sustained brute-force
// triggers 48 identical emails / day. With it, operator sees 1 email
// per unique offender-set per ~4 hours.
describe('auth-flow-alert / offenderFingerprint', () => {
  it('produces same fingerprint regardless of input ordering', () => {
    const a = {
      totalFailed: 80,
      offendingIps: [
        { ip: '203.0.113.1', failures: 60 },
        { ip: '203.0.113.2', failures: 51 },
      ],
      offendingEmailHashes: [],
    }
    const b = {
      totalFailed: 80,
      offendingIps: [
        { ip: '203.0.113.2', failures: 51 },
        { ip: '203.0.113.1', failures: 60 },
      ],
      offendingEmailHashes: [],
    }
    expect(offenderFingerprint(a)).toBe(offenderFingerprint(b))
  })

  it('different counts on same offender → different fingerprint (escalation = fresh alert)', () => {
    const a = {
      totalFailed: 60,
      offendingIps: [{ ip: '203.0.113.1', failures: 51 }],
      offendingEmailHashes: [],
    }
    const b = {
      totalFailed: 600,
      offendingIps: [{ ip: '203.0.113.1', failures: 590 }],
      offendingEmailHashes: [],
    }
    expect(offenderFingerprint(a)).not.toBe(offenderFingerprint(b))
  })

  it('different offender → different fingerprint', () => {
    const a = {
      totalFailed: 60,
      offendingIps: [{ ip: '203.0.113.1', failures: 60 }],
      offendingEmailHashes: [],
    }
    const b = {
      totalFailed: 60,
      offendingIps: [{ ip: '203.0.113.99', failures: 60 }],
      offendingEmailHashes: [],
    }
    expect(offenderFingerprint(a)).not.toBe(offenderFingerprint(b))
  })

  it('email-hash axis affects the fingerprint', () => {
    const a = {
      totalFailed: 30,
      offendingIps: [],
      offendingEmailHashes: [{ emailHashShort: 'a1b2c3d4', failures: 25 }],
    }
    const b = {
      totalFailed: 30,
      offendingIps: [],
      offendingEmailHashes: [{ emailHashShort: 'ffffffff', failures: 25 }],
    }
    expect(offenderFingerprint(a)).not.toBe(offenderFingerprint(b))
  })
})

describe('auth-flow-alert / shouldSuppress', () => {
  const fingerprint = 'abc123def456'
  const windowMs = 4 * 60 * 60 * 1000

  it('does NOT suppress on first run (no prevState)', () => {
    expect(
      shouldSuppress({
        fingerprint,
        prevState: null,
        nowMs: 1_000_000_000_000,
        windowMs,
      }),
    ).toBe(false)
  })

  it('does NOT suppress when fingerprint differs', () => {
    expect(
      shouldSuppress({
        fingerprint,
        prevState: { fingerprint: 'different', sentAtMs: 1_000_000_000_000 },
        nowMs: 1_000_000_000_001,
        windowMs,
      }),
    ).toBe(false)
  })

  it('SUPPRESSES when fingerprint matches and within window', () => {
    expect(
      shouldSuppress({
        fingerprint,
        prevState: { fingerprint, sentAtMs: 1_000_000_000_000 },
        nowMs: 1_000_000_000_000 + windowMs - 1,
        windowMs,
      }),
    ).toBe(true)
  })

  it('does NOT suppress when fingerprint matches but window expired', () => {
    expect(
      shouldSuppress({
        fingerprint,
        prevState: { fingerprint, sentAtMs: 1_000_000_000_000 },
        nowMs: 1_000_000_000_000 + windowMs + 1,
        windowMs,
      }),
    ).toBe(false)
  })
})
