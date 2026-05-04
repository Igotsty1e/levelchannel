import { describe, expect, it } from 'vitest'

import { validateProfileUpdate } from '@/lib/auth/profiles'

describe('validateProfileUpdate', () => {
  it('passes empty update', () => {
    expect(validateProfileUpdate({})).toBeNull()
  })

  it('passes null fields (clear)', () => {
    expect(
      validateProfileUpdate({
        displayName: null,
        timezone: null,
        locale: null,
      }),
    ).toBeNull()
  })

  it('passes a valid full update', () => {
    expect(
      validateProfileUpdate({
        displayName: 'Иван',
        timezone: 'Europe/Moscow',
        locale: 'ru',
      }),
    ).toBeNull()
  })

  it('rejects display name longer than 60 chars', () => {
    const long = 'a'.repeat(61)
    expect(validateProfileUpdate({ displayName: long })).toEqual({
      field: 'displayName',
      reason: 'too_long',
    })
  })

  it('rejects display name that trims to empty', () => {
    expect(validateProfileUpdate({ displayName: '   ' })).toEqual({
      field: 'displayName',
      reason: 'too_short',
    })
  })

  it('rejects malformed timezone', () => {
    expect(validateProfileUpdate({ timezone: 'not a tz' })).toEqual({
      field: 'timezone',
      reason: 'invalid_format',
    })
  })

  it('rejects unsupported locale', () => {
    expect(validateProfileUpdate({ locale: 'en' })).toEqual({
      field: 'locale',
      reason: 'unsupported',
    })
  })
})
