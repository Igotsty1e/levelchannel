import { createHmac } from 'crypto'

import { describe, expect, it } from 'vitest'

import {
  parseCloudPaymentsPayload,
  verifyCloudPaymentsSignature,
} from '@/lib/payments/cloudpayments-webhook'

const SECRET = 'test_api_secret'

function sign(body: string) {
  return createHmac('sha256', SECRET).update(body, 'utf8').digest('base64')
}

describe('verifyCloudPaymentsSignature', () => {
  it('accepts X-Content-HMAC over raw body', () => {
    const body = 'TransactionId=123&Amount=100&InvoiceId=lc_test_123456'
    const signature = sign(body)
    expect(verifyCloudPaymentsSignature(body, signature, null)).toBe(true)
  })

  it('accepts Content-HMAC fallback', () => {
    const body = '{"TransactionId":123,"Amount":100,"InvoiceId":"lc_test_123456"}'
    const signature = sign(body)
    expect(verifyCloudPaymentsSignature(body, null, signature)).toBe(true)
  })

  it('rejects when both headers are missing', () => {
    const body = 'TransactionId=123'
    expect(verifyCloudPaymentsSignature(body, null, null)).toBe(false)
  })

  it('rejects tampered body', () => {
    const body = 'TransactionId=123&Amount=100'
    const signature = sign(body)
    expect(verifyCloudPaymentsSignature('TransactionId=123&Amount=999', signature, null)).toBe(false)
  })

  it('rejects signature signed with different secret', () => {
    const body = 'TransactionId=123'
    const fakeSig = createHmac('sha256', 'wrong_secret').update(body).digest('base64')
    expect(verifyCloudPaymentsSignature(body, fakeSig, null)).toBe(false)
  })

  it('rejects signature of wrong length without timing leak', () => {
    const body = 'TransactionId=123'
    expect(verifyCloudPaymentsSignature(body, 'too-short', null)).toBe(false)
  })

  it('does NOT decode body — signature is over exact bytes', () => {
    // Поле с пробелом / + в form-urlencoded должно проверяться по сырому body,
    // а не по декодированной форме. CloudPayments подписывает именно raw.
    const body = 'Reason=Card+declined&Amount=100'
    const signature = sign(body)
    expect(verifyCloudPaymentsSignature(body, signature, null)).toBe(true)

    // Re-encoded form (как делал старый код) — НЕ должна проходить.
    const decodedReencoded = 'Reason=Card declined&Amount=100'
    const sigOfDecoded = sign(decodedReencoded)
    expect(verifyCloudPaymentsSignature(body, sigOfDecoded, null)).toBe(false)
  })
})

describe('parseCloudPaymentsPayload', () => {
  it('parses application/json', () => {
    const body = '{"TransactionId":123,"InvoiceId":"lc_test_abc"}'
    const result = parseCloudPaymentsPayload(body, 'application/json; charset=utf-8')
    expect(result.TransactionId).toBe(123)
    expect(result.InvoiceId).toBe('lc_test_abc')
  })

  it('parses application/x-www-form-urlencoded', () => {
    const body = 'TransactionId=123&InvoiceId=lc_test_abc&Amount=100'
    const result = parseCloudPaymentsPayload(body, 'application/x-www-form-urlencoded')
    expect(result.TransactionId).toBe('123')
    expect(result.InvoiceId).toBe('lc_test_abc')
    expect(result.Amount).toBe('100')
  })

  it('falls back to URLSearchParams when content-type missing', () => {
    const body = 'TransactionId=123'
    const result = parseCloudPaymentsPayload(body, null)
    expect(result.TransactionId).toBe('123')
  })
})
