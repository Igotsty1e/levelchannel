import { describe, expect, it } from 'vitest'

import { synthesizePaintSlots } from '@/lib/calendar/paint-synth'

// PR3b — paint-synth pure function. Pins:
//   - back-to-back placement at uniform stride D
//   - 30-min boundaries always
//   - bad inputs return null (caller surfaces a UX hint, not a partial
//     payload that would 400 at the API)

describe('synthesizePaintSlots — happy paths', () => {
  it('60-min duration, 4-cell paint (18:00..19:30) → 2 slots: 18:00, 19:00', () => {
    // halfHour 24 = 06:00 + 12h = 18:00; halfHour 27 = 19:30
    const r = synthesizePaintSlots({
      ymd: '2026-05-11',
      fromHalfHour: 24,
      toHalfHour: 27,
      durationMinutes: 60,
    })
    expect(r).not.toBeNull()
    expect(r!.startsHhmm).toEqual(['18:00', '19:00'])
    // 18:00 MSK = 15:00 UTC; 19:00 MSK = 16:00 UTC.
    expect(r!.startsIso[0]).toBe('2026-05-11T15:00:00.000Z')
    expect(r!.startsIso[1]).toBe('2026-05-11T16:00:00.000Z')
  })

  it('60-min duration, 1-cell paint → 0 slots → null', () => {
    const r = synthesizePaintSlots({
      ymd: '2026-05-11',
      fromHalfHour: 24,
      toHalfHour: 24,
      durationMinutes: 60,
    })
    expect(r).toBeNull()
  })

  it('30-min duration, 1-cell paint → 1 slot', () => {
    const r = synthesizePaintSlots({
      ymd: '2026-05-11',
      fromHalfHour: 24,
      toHalfHour: 24,
      durationMinutes: 30,
    })
    expect(r).not.toBeNull()
    expect(r!.startsHhmm).toEqual(['18:00'])
  })

  it('90-min duration, 5-cell paint (18:00..20:00) → 1 slot: 18:00', () => {
    // 5 cells × 30 min = 150 min span; floor(150/90) = 1
    const r = synthesizePaintSlots({
      ymd: '2026-05-11',
      fromHalfHour: 24,
      toHalfHour: 28,
      durationMinutes: 90,
    })
    expect(r).not.toBeNull()
    expect(r!.startsHhmm).toEqual(['18:00'])
  })

  it('90-min duration, 6-cell paint (18:00..20:30) → 2 slots: 18:00, 19:30', () => {
    const r = synthesizePaintSlots({
      ymd: '2026-05-11',
      fromHalfHour: 24,
      toHalfHour: 29,
      durationMinutes: 90,
    })
    expect(r).not.toBeNull()
    expect(r!.startsHhmm).toEqual(['18:00', '19:30'])
  })

  it('120-min duration, 8-cell paint (18:00..21:30) → 2 slots: 18:00, 20:00', () => {
    const r = synthesizePaintSlots({
      ymd: '2026-05-11',
      fromHalfHour: 24,
      toHalfHour: 31,
      durationMinutes: 120,
    })
    expect(r).not.toBeNull()
    expect(r!.startsHhmm).toEqual(['18:00', '20:00'])
  })

  it('30-min duration, full 8-cell paint → 8 slots', () => {
    const r = synthesizePaintSlots({
      ymd: '2026-05-11',
      fromHalfHour: 24,
      toHalfHour: 31,
      durationMinutes: 30,
    })
    expect(r).not.toBeNull()
    expect(r!.startsHhmm).toHaveLength(8)
    expect(r!.startsHhmm[0]).toBe('18:00')
    expect(r!.startsHhmm[7]).toBe('21:30')
  })
})

describe('synthesizePaintSlots — invariants', () => {
  it('every emitted ISO is on a 30-min boundary in MSK', () => {
    const r = synthesizePaintSlots({
      ymd: '2026-05-11',
      fromHalfHour: 0, // 06:00
      toHalfHour: 35, // 23:30
      durationMinutes: 60,
    })
    expect(r).not.toBeNull()
    // Every start_at parses to an ISO whose minute is 00 or 30 in MSK.
    // MSK = UTC+3 means UTC minutes equal MSK minutes (no DST), so
    // checking UTC minutes is fine.
    for (const iso of r!.startsIso) {
      const min = new Date(iso).getUTCMinutes()
      expect([0, 30]).toContain(min)
    }
  })

  it('rejects unsupported durations (50)', () => {
    const r = synthesizePaintSlots({
      ymd: '2026-05-11',
      fromHalfHour: 24,
      toHalfHour: 27,
      // @ts-expect-error — 50 is not in ALLOWED_PAINT_DURATIONS_MIN
      durationMinutes: 50,
    })
    expect(r).toBeNull()
  })

  it('rejects from > to', () => {
    const r = synthesizePaintSlots({
      ymd: '2026-05-11',
      fromHalfHour: 27,
      toHalfHour: 24,
      durationMinutes: 60,
    })
    expect(r).toBeNull()
  })

  it('rejects bad ymd', () => {
    const r = synthesizePaintSlots({
      ymd: '2026-13-01',
      fromHalfHour: 24,
      toHalfHour: 27,
      durationMinutes: 60,
    })
    expect(r).toBeNull()
  })

  it('rejects negative halfHour', () => {
    const r = synthesizePaintSlots({
      ymd: '2026-05-11',
      fromHalfHour: -1,
      toHalfHour: 5,
      durationMinutes: 60,
    })
    expect(r).toBeNull()
  })

  it('rejects halfHour > 35', () => {
    const r = synthesizePaintSlots({
      ymd: '2026-05-11',
      fromHalfHour: 30,
      toHalfHour: 36,
      durationMinutes: 60,
    })
    expect(r).toBeNull()
  })
})
