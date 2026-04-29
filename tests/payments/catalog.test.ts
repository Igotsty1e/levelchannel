import { describe, expect, it } from 'vitest'

import {
  buildPaymentDescription,
  isValidPaymentAmount,
  MAX_PAYMENT_AMOUNT_RUB,
  MIN_PAYMENT_AMOUNT_RUB,
  PAYMENT_COMMENT_MAX_LENGTH,
  PAYMENT_DESCRIPTION,
  normalizeCustomerEmail,
  normalizePaymentAmount,
  validateCustomerComment,
  validateCustomerEmail,
} from '@/lib/payments/catalog'

describe('normalizePaymentAmount', () => {
  it('round to two decimals', () => {
    expect(normalizePaymentAmount(123.456)).toBe(123.46)
    expect(normalizePaymentAmount(123.454)).toBe(123.45)
  })

  it('keeps integers as is', () => {
    expect(normalizePaymentAmount(500)).toBe(500)
  })
})

describe('isValidPaymentAmount', () => {
  it('accepts boundary values', () => {
    expect(isValidPaymentAmount(MIN_PAYMENT_AMOUNT_RUB)).toBe(true)
    expect(isValidPaymentAmount(MAX_PAYMENT_AMOUNT_RUB)).toBe(true)
    expect(isValidPaymentAmount(3500)).toBe(true)
  })

  it('rejects out of bounds and non-numeric', () => {
    expect(isValidPaymentAmount(MIN_PAYMENT_AMOUNT_RUB - 1)).toBe(false)
    expect(isValidPaymentAmount(MAX_PAYMENT_AMOUNT_RUB + 1)).toBe(false)
    expect(isValidPaymentAmount(NaN)).toBe(false)
    expect(isValidPaymentAmount(Infinity)).toBe(false)
    expect(isValidPaymentAmount(-100)).toBe(false)
  })
})

describe('normalizeCustomerEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeCustomerEmail('  HELLO@Example.COM  ')).toBe('hello@example.com')
  })
})

describe('validateCustomerEmail', () => {
  it('accepts a normal e-mail', () => {
    const result = validateCustomerEmail('user@example.com')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.email).toBe('user@example.com')
    }
  })

  it('accepts subdomains and plus addressing', () => {
    expect(validateCustomerEmail('user.name+filter@mail.example.co.uk').ok).toBe(true)
  })

  it('rejects empty', () => {
    expect(validateCustomerEmail('')).toMatchObject({ ok: false, reason: 'required' })
  })

  it('rejects spaces', () => {
    expect(validateCustomerEmail('user @example.com')).toMatchObject({
      ok: false,
      reason: 'spaces',
    })
  })

  it('rejects missing @', () => {
    expect(validateCustomerEmail('userexample.com')).toMatchObject({
      ok: false,
      reason: 'format',
    })
  })

  it('rejects double-dot in local part', () => {
    expect(validateCustomerEmail('a..b@example.com')).toMatchObject({
      ok: false,
      reason: 'local_dots',
    })
  })

  it('rejects too long local part', () => {
    const long = 'a'.repeat(65)
    expect(validateCustomerEmail(`${long}@example.com`)).toMatchObject({
      ok: false,
      reason: 'local_too_long',
    })
  })

  it('rejects domain with no dot', () => {
    expect(validateCustomerEmail('user@localhost')).toMatchObject({
      ok: false,
      reason: 'domain_format',
    })
  })

  it('rejects too short tld', () => {
    expect(validateCustomerEmail('user@example.a')).toMatchObject({
      ok: false,
      reason: 'tld',
    })
  })

  it('rejects label starting with hyphen', () => {
    expect(validateCustomerEmail('user@-example.com')).toMatchObject({
      ok: false,
      reason: 'domain_label',
    })
  })

  it('rejects e-mail longer than 254 chars', () => {
    const long = `${'a'.repeat(60)}@${'b'.repeat(200)}.com`
    expect(validateCustomerEmail(long)).toMatchObject({ ok: false, reason: 'too_long' })
  })
})

describe('validateCustomerComment', () => {
  it('returns null comment for empty / undefined input', () => {
    expect(validateCustomerComment(undefined)).toEqual({ ok: true, comment: null })
    expect(validateCustomerComment(null)).toEqual({ ok: true, comment: null })
    expect(validateCustomerComment('')).toEqual({ ok: true, comment: null })
    expect(validateCustomerComment('   ')).toEqual({ ok: true, comment: null })
  })

  it('trims surrounding whitespace and returns the cleaned string', () => {
    expect(validateCustomerComment('  За урок 26 апреля  ')).toEqual({
      ok: true,
      comment: 'За урок 26 апреля',
    })
  })

  it('strips control characters before measuring length', () => {
    // 50 control bytes + 50 visible chars; would otherwise blow past 128
    // when concatenated with more control bytes.
    const input = '\u0000'.repeat(50) + 'плата за урок' + '\u001b'.repeat(50)
    expect(validateCustomerComment(input)).toEqual({
      ok: true,
      comment: 'плата за урок',
    })
  })

  it('rejects after-trim length over 128', () => {
    const long = 'a'.repeat(PAYMENT_COMMENT_MAX_LENGTH + 1)
    const result = validateCustomerComment(long)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('too_long')
  })

  it('treats non-string types leniently as empty', () => {
    expect(validateCustomerComment(42)).toEqual({ ok: true, comment: null })
    expect(validateCustomerComment({})).toEqual({ ok: true, comment: null })
  })
})

describe('buildPaymentDescription', () => {
  it('always starts with PAYMENT_DESCRIPTION + amount when no comment', () => {
    const out = buildPaymentDescription(2500, null)
    expect(out.startsWith(PAYMENT_DESCRIPTION)).toBe(true)
    // Whitespace-insensitive amount check (ICU may use NBSP in ru-RU).
    expect(out.replace(/\s/g, '')).toContain('—2500₽')
  })

  it('inserts comment between description and amount when present', () => {
    const out = buildPaymentDescription(1500, 'За урок 26 апреля')
    expect(out).toContain('За урок 26 апреля')
    expect(out.indexOf('За урок 26 апреля')).toBeGreaterThan(
      out.indexOf(PAYMENT_DESCRIPTION),
    )
    expect(out.replace(/\s/g, '')).toContain('1500₽')
  })

  it('formats amount with ru-RU decimals', () => {
    expect(buildPaymentDescription(1234.56, null).replace(/\s/g, ''))
      .toContain('1234,56₽')
  })
})
