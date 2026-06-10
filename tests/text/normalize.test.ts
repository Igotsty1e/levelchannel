import { describe, expect, it } from 'vitest'

import { normalizeForSearch } from '@/lib/text/normalize'

describe('normalizeForSearch', () => {
  it('lower-cases input', () => {
    expect(normalizeForSearch('Petr')).toBe('petr')
  })

  it('maps ё → е', () => {
    expect(normalizeForSearch('Пётр')).toBe('петр')
    expect(normalizeForSearch('Алёна')).toBe('алена')
  })

  it('maps й → и (so «семен» matches «Семён»)', () => {
    expect(normalizeForSearch('Семён')).toBe('семен')
    expect(normalizeForSearch('Райан')).toBe('раиан')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeForSearch('  Анна  ')).toBe('анна')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeForSearch('')).toBe('')
    expect(normalizeForSearch('   ')).toBe('')
  })
})
