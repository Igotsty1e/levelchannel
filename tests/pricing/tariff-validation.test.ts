import { describe, expect, it } from 'vitest'

import { validateTariffInput } from '@/lib/pricing/tariffs'

describe('validateTariffInput', () => {
  it('passes a valid full input', () => {
    expect(
      validateTariffInput({
        slug: 'lesson-60min',
        titleRu: 'Урок 60 минут',
        amountKopecks: 350_000,
        isActive: true,
      }),
    ).toBeNull()
  })

  it('rejects slug with spaces', () => {
    expect(
      validateTariffInput({ slug: 'lesson 60min' }),
    ).toEqual({ field: 'slug', reason: 'invalid_format' })
  })

  it('rejects slug with capitals', () => {
    expect(validateTariffInput({ slug: 'Lesson60' })).toEqual({
      field: 'slug',
      reason: 'invalid_format',
    })
  })

  it('rejects an empty title', () => {
    expect(validateTariffInput({ titleRu: '   ' })).toEqual({
      field: 'titleRu',
      reason: 'too_short',
    })
  })

  it('rejects a non-integer amount', () => {
    expect(validateTariffInput({ amountKopecks: 12.5 })).toEqual({
      field: 'amountKopecks',
      reason: 'not_integer',
    })
  })

  it('rejects an out-of-band amount (too low)', () => {
    expect(validateTariffInput({ amountKopecks: 99 })).toEqual({
      field: 'amountKopecks',
      reason: 'out_of_band',
    })
  })

  it('rejects an out-of-band amount (too high)', () => {
    expect(validateTariffInput({ amountKopecks: 100_000_001 })).toEqual({
      field: 'amountKopecks',
      reason: 'out_of_band',
    })
  })
})
