import { describe, expect, it } from 'vitest'

import {
  decideVerdict,
  type PathologicalSlot,
} from '@/lib/calendar/pathology'

// BCS-G.3 — pure verdict logic. The DB-fed integration is in
// tests/integration/calendar/pathology.test.ts; this file pins the
// branch table on its own.

function slot(count: number): PathologicalSlot {
  return {
    slotId: `slot-${count}`,
    teacherAccountId: 't',
    startAt: '2026-06-01T10:00:00Z',
    externalCalendarId: 'primary',
    externalEventId: 'evt',
    cancelRepushCount: count,
    lastReconciledAt: null,
  }
}

describe('decideVerdict', () => {
  it('returns ok on empty offenders', () => {
    expect(decideVerdict({ offenders: [] })).toEqual({ kind: 'ok' })
  })

  it('returns ok when every offender is below threshold (defensive)', () => {
    expect(
      decideVerdict({ offenders: [slot(1), slot(2)], threshold: 3 }),
    ).toEqual({ kind: 'ok' })
  })

  it('returns alert when at least one offender meets default threshold (3)', () => {
    const v = decideVerdict({ offenders: [slot(3)] })
    expect(v.kind).toBe('alert')
    if (v.kind !== 'alert') return
    expect(v.count).toBe(1)
    expect(v.threshold).toBe(3)
    expect(v.offenders[0]?.cancelRepushCount).toBe(3)
  })

  it('counts only offenders at or above threshold', () => {
    const v = decideVerdict({
      offenders: [slot(2), slot(5), slot(7)],
      threshold: 5,
    })
    expect(v.kind).toBe('alert')
    if (v.kind !== 'alert') return
    expect(v.count).toBe(2)
  })

  it('honours a custom higher threshold', () => {
    expect(
      decideVerdict({ offenders: [slot(3), slot(4)], threshold: 10 }),
    ).toEqual({ kind: 'ok' })
  })

  it('honours a custom lower threshold', () => {
    const v = decideVerdict({
      offenders: [slot(1), slot(2)],
      threshold: 1,
    })
    expect(v.kind).toBe('alert')
    if (v.kind !== 'alert') return
    expect(v.count).toBe(2)
    expect(v.threshold).toBe(1)
  })
})
