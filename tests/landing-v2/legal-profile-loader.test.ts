import { describe, expect, it } from 'vitest'

import { loadLegalProfile } from '@/lib/landing/legal-profile-loader'

describe('lib/landing/legal-profile-loader', () => {
  it('returns structured profile with all 7 fields', () => {
    const p = loadLegalProfile()
    expect(p).toHaveProperty('legalOperatorDisplay')
    expect(p).toHaveProperty('legalOperatorTaxId')
    expect(p).toHaveProperty('legalOperatorOgrn')
    expect(p).toHaveProperty('legalBankAccount')
    expect(p).toHaveProperty('legalBankName')
    expect(p).toHaveProperty('legalBankBik')
    expect(p).toHaveProperty('publicContactEmail')
  })

  it('non-empty strings for every field in test env (defaults applied)', () => {
    const p = loadLegalProfile()
    Object.values(p).forEach((v) => {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
    })
  })
})
