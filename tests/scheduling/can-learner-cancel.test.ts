import { describe, expect, it } from 'vitest'

import { canLearnerCancel } from '@/lib/scheduling/slots'

const MS_HOUR = 60 * 60 * 1000

describe('canLearnerCancel', () => {
  it('allows cancel ≥ 24h before start', () => {
    const now = Date.parse('2026-05-04T10:00:00Z')
    const startAt = new Date(now + 30 * MS_HOUR).toISOString()
    expect(
      canLearnerCancel({ status: 'booked', startAt }, now),
    ).toEqual({ ok: true })
  })

  it('refuses cancel with < 24h to go', () => {
    const now = Date.parse('2026-05-04T10:00:00Z')
    const startAt = new Date(now + 23 * MS_HOUR).toISOString()
    const decision = canLearnerCancel({ status: 'booked', startAt }, now)
    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      expect(decision.reason).toBe('too_late_to_cancel')
      expect(decision.minutesUntilStart).toBe(23 * 60)
    }
  })

  it('refuses cancel exactly at the threshold (defines as < 24h)', () => {
    const now = Date.parse('2026-05-04T10:00:00Z')
    // 24h - 1 minute
    const startAt = new Date(now + 24 * MS_HOUR - 60_000).toISOString()
    const decision = canLearnerCancel({ status: 'booked', startAt }, now)
    expect(decision.ok).toBe(false)
  })

  it('refuses cancel for non-booked slot', () => {
    const now = Date.parse('2026-05-04T10:00:00Z')
    const startAt = new Date(now + 30 * MS_HOUR).toISOString()
    const decision = canLearnerCancel(
      { status: 'cancelled', startAt },
      now,
    )
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toBe('already_terminal')
  })

  it('refuses cancel for completed slot', () => {
    const now = Date.parse('2026-05-04T10:00:00Z')
    const startAt = new Date(now - 5 * MS_HOUR).toISOString()
    expect(
      canLearnerCancel({ status: 'completed', startAt }, now).ok,
    ).toBe(false)
  })
})
