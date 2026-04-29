import { describe, expect, it } from 'vitest'

import { isValidInvoiceId } from '@/lib/security/request'

describe('isValidInvoiceId', () => {
  it('accepts mock-style id', () => {
    expect(isValidInvoiceId('lc_20260429_abc12345')).toBe(true)
  })

  it('accepts cloudpayments-style id', () => {
    expect(isValidInvoiceId('lc_a1b2c3d4e5f6g7h8i9')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidInvoiceId('')).toBe(false)
  })

  it('rejects too short', () => {
    expect(isValidInvoiceId('lc_short')).toBe(false)
  })

  it('rejects too long (over 48 chars)', () => {
    expect(isValidInvoiceId(`lc_${'a'.repeat(50)}`)).toBe(false)
  })

  it('rejects without lc_ prefix', () => {
    expect(isValidInvoiceId('invoice_12345678')).toBe(false)
  })

  it('rejects special characters / SQL injection attempts', () => {
    expect(isValidInvoiceId("lc_test'; drop table--")).toBe(false)
    expect(isValidInvoiceId('lc_test/../etc/passwd')).toBe(false)
    expect(isValidInvoiceId('lc_тест1234')).toBe(false)
  })
})
