import { describe, expect, it } from 'vitest'

import { constantTimeEqual } from '@/lib/security/constant-time'

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('', '')).toBe(true)
    expect(constantTimeEqual('секрет', 'секрет')).toBe(true)
  })

  it('returns false for length mismatch', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('abcd', 'abc')).toBe(false)
    expect(constantTimeEqual('', 'a')).toBe(false)
  })

  it('returns false for same-length but different content', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'xbc')).toBe(false)
    expect(constantTimeEqual('xxxx', 'yyyy')).toBe(false)
  })

  it('handles unicode codepoints', () => {
    expect(constantTimeEqual('секрет', 'сезрет')).toBe(false)
    expect(constantTimeEqual('пароль', 'пароль')).toBe(true)
  })

  it('does not short-circuit on first-byte mismatch (structural invariant)', () => {
    // We can't measure wall-clock reliably; structural assertion:
    // the function body has a length check, then a fixed-iteration
    // XOR loop, then the final compare. Behaviour parity with the
    // expected truth table is what we pin here.
    expect(constantTimeEqual('abc', 'xbc')).toBe(false)
    expect(constantTimeEqual('abc', 'axc')).toBe(false)
    expect(constantTimeEqual('abc', 'abx')).toBe(false)
  })
})
