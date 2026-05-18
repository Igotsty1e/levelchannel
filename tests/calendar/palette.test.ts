import { describe, expect, it } from 'vitest'

import {
  CONFLICT_PALETTE,
  paletteForKind,
  paletteForRow,
  type SlotKind,
} from '@/lib/calendar/palette'

// SAAS-1 follow-up — pure-function tests for the extracted palette
// lookup. Pins the kind → palette mapping that lives in
// `components/calendar/SlotBlock.tsx`'s render path.

describe('paletteForKind', () => {
  it.each<SlotKind>([
    'open',
    'booked-self',
    'booked-other',
    'booked-full',
    'past-full',
    'past-redacted',
  ])('returns a non-empty palette for kind %s', (kind) => {
    const p = paletteForKind(kind)
    expect(p.background).toMatch(/^rgba\(/)
    expect(p.border).toMatch(/^rgba\(/)
    expect(p.text).toMatch(/^#/)
  })

  it('open uses the green family (status-success)', () => {
    const p = paletteForKind('open')
    expect(p.background).toBe('rgba(34, 197, 94, 0.15)')
    expect(p.text).toBe('#bbf7d0')
  })

  it('booked-self uses the blue family (accent)', () => {
    const p = paletteForKind('booked-self')
    expect(p.background).toBe('rgba(59, 130, 246, 0.18)')
  })

  it('booked-other and booked-full share the neutral palette', () => {
    expect(paletteForKind('booked-other')).toEqual(paletteForKind('booked-full'))
  })

  it('past-full and past-redacted share the muted palette', () => {
    expect(paletteForKind('past-full')).toEqual(paletteForKind('past-redacted'))
  })

  it('returns the same reference on repeat calls (no allocation)', () => {
    expect(paletteForKind('open')).toBe(paletteForKind('open'))
    expect(paletteForKind('past-full')).toBe(paletteForKind('past-redacted'))
  })
})

describe('paletteForRow conflict overlay', () => {
  it('non-conflict booked-full uses the neutral palette', () => {
    expect(
      paletteForRow({ kind: 'booked-full', hasConflict: false }),
    ).toEqual(paletteForKind('booked-full'))
  })

  it('conflict overrides booked-full → red palette', () => {
    expect(paletteForRow({ kind: 'booked-full', hasConflict: true })).toBe(
      CONFLICT_PALETTE,
    )
  })

  it('conflict overrides regardless of underlying kind', () => {
    // (The runtime contract is "booked-full only" but the function
    // is intentionally narrow — conflict wins on any kind.)
    expect(paletteForRow({ kind: 'open', hasConflict: true })).toBe(
      CONFLICT_PALETTE,
    )
    expect(paletteForRow({ kind: 'past-full', hasConflict: true })).toBe(
      CONFLICT_PALETTE,
    )
  })

  it('CONFLICT_PALETTE uses the red family (status-danger)', () => {
    expect(CONFLICT_PALETTE.background).toBe('rgba(239, 68, 68, 0.18)')
    expect(CONFLICT_PALETTE.border).toBe('rgba(239, 68, 68, 0.85)')
    expect(CONFLICT_PALETTE.text).toBe('#fecaca')
  })
})
