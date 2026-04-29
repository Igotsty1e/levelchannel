import { describe, expect, it } from 'vitest'

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePasswordPolicy,
} from '@/lib/auth/policy'

describe('lib/auth/policy', () => {
  it('rejects non-string input', () => {
    const result = validatePasswordPolicy(undefined as unknown as string)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('too_short')
  })

  it('rejects too-short password', () => {
    const result = validatePasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH - 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('too_short')
  })

  it('accepts boundary-length password', () => {
    expect(validatePasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH)).ok).toBe(true)
    expect(validatePasswordPolicy('a'.repeat(PASSWORD_MAX_LENGTH)).ok).toBe(true)
  })

  it('rejects too-long password', () => {
    const result = validatePasswordPolicy('a'.repeat(PASSWORD_MAX_LENGTH + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('too_long')
  })

  it('rejects all-digits password (too predictable)', () => {
    const result = validatePasswordPolicy('12345678')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('all_digits')
  })

  it('accepts a normal mixed password', () => {
    expect(validatePasswordPolicy('correct horse battery staple').ok).toBe(true)
  })

  it('rejects a top-of-list leaked password (too_common)', () => {
    const result = validatePasswordPolicy('password1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('too_common')
  })

  it('rejects regardless of case and surrounding whitespace', () => {
    expect(validatePasswordPolicy('PASSWORD1').ok).toBe(false)
    expect(validatePasswordPolicy('  password1  ').ok).toBe(false)
    expect(validatePasswordPolicy('Qwerty123').ok).toBe(false)
  })

  it('does not reject uncommon long passphrases', () => {
    expect(validatePasswordPolicy('mauve giraffe walks slowly').ok).toBe(true)
  })
})
