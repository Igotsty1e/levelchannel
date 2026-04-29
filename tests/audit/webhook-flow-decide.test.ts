import { describe, expect, it } from 'vitest'

// @ts-expect-error — pulling JS from a sibling tools script, no TS types
import { decideVerdict } from '../../scripts/webhook-flow-alert.mjs'

// Pure-logic threshold check. The probe itself is a side-effecting
// CLI (DB + Resend) and is exercised manually + in production via
// systemd journal. Here we just lock the math.

describe('webhook-flow decideVerdict', () => {
  const opts = { minVolume: 5, ratioFloor: 0.3 }

  it('low_volume_skip when created < minVolume', () => {
    const v = decideVerdict(
      { created: 4, paidWebhooks: 0, failWebhooks: 0, cancelled: 0 },
      opts,
    )
    expect(v.kind).toBe('low_volume_skip')
  })

  it('all_resolved when terminations + cancellations cover all orders', () => {
    const v = decideVerdict(
      { created: 10, paidWebhooks: 7, failWebhooks: 2, cancelled: 1 },
      opts,
    )
    expect(v.kind).toBe('all_resolved')
  })

  it('alert when terminated/created < ratioFloor', () => {
    // 10 created, only 1 paid, no fails, no cancels → ratio 0.1
    const v = decideVerdict(
      { created: 10, paidWebhooks: 1, failWebhooks: 0, cancelled: 0 },
      opts,
    )
    expect(v.kind).toBe('alert')
    expect(v.ratio).toBeCloseTo(0.1)
  })

  it('ok when ratio above floor but not fully resolved', () => {
    // 10 created, 5 paid, 1 fail, 0 cancel → ratio 0.6
    const v = decideVerdict(
      { created: 10, paidWebhooks: 5, failWebhooks: 1, cancelled: 0 },
      opts,
    )
    expect(v.kind).toBe('ok')
    expect(v.ratio).toBeCloseTo(0.6)
  })

  it('cancellations count toward resolution but NOT toward terminated ratio', () => {
    // 10 created, 0 paid, 0 fail, 9 cancelled → resolved < created
    // (terminated + cancelled = 9 < 10), ratio = 0/10 = 0 → alert.
    // The test guards against an accidental rewrite where cancelled
    // is mixed into the alert math (it shouldn't — cancelled is a
    // user-driven outcome, not a webhook failure).
    const v = decideVerdict(
      { created: 10, paidWebhooks: 0, failWebhooks: 0, cancelled: 9 },
      opts,
    )
    expect(v.kind).toBe('alert')
    expect(v.ratio).toBe(0)
  })

  it('boundary: ratio exactly at floor → ok (strict less-than)', () => {
    // 10 created, 3 paid → ratio 0.3 exactly. Not "< 0.3" so ok.
    const v = decideVerdict(
      { created: 10, paidWebhooks: 3, failWebhooks: 0, cancelled: 0 },
      opts,
    )
    expect(v.kind).toBe('ok')
  })
})
