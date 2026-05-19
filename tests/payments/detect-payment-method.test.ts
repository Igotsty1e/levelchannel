import { describe, expect, it } from 'vitest'

import {
  type CloudPaymentsWebhookPayload,
  detectPaymentMethod,
} from '@/lib/payments/cloudpayments-webhook'

// SBP-PAY (2026-05-19) — detectPaymentMethod contract pins per
// §0a BLOCKER#6 + §0b WARN#4 + §0c WARN#3 closures:
//   - POSITIVE-signal: never default to 'sbp' on absence.
//   - Card-positive (CardType / CardLastFour non-empty) → 'card'.
//   - PaymentMethod EXACT whitelist match (case-insensitive) → 'sbp'.
//   - Otherwise → 'unknown' (column stays NULL, raw value captured
//     in payment_audit_events).
//
// The strict-exact-match contract prevents a future "SbpAndCardHybrid"
// or "FPS Faster Payments" string from being misclassified as 'sbp'
// via substring matching.

function payload(
  fields: Partial<CloudPaymentsWebhookPayload>,
): CloudPaymentsWebhookPayload {
  return { ...fields }
}

describe('detectPaymentMethod (card-positive)', () => {
  it('classifies a Visa card webhook as card', () => {
    expect(
      detectPaymentMethod(
        payload({ CardType: 'Visa', CardLastFour: '1234' }),
      ),
    ).toBe('card')
  })

  it('classifies a card-only (CardType present) webhook as card', () => {
    expect(detectPaymentMethod(payload({ CardType: 'MIR' }))).toBe('card')
  })

  it('classifies a card-only (CardLastFour present) webhook as card', () => {
    expect(detectPaymentMethod(payload({ CardLastFour: '4242' }))).toBe(
      'card',
    )
  })
})

describe('detectPaymentMethod (sbp positive-whitelist)', () => {
  it('matches `Sbp` (case-insensitive)', () => {
    expect(detectPaymentMethod(payload({ PaymentMethod: 'Sbp' }))).toBe('sbp')
    expect(detectPaymentMethod(payload({ PaymentMethod: 'sbp' }))).toBe('sbp')
    expect(detectPaymentMethod(payload({ PaymentMethod: 'SBP' }))).toBe('sbp')
  })

  it('matches `SbpQr`', () => {
    expect(detectPaymentMethod(payload({ PaymentMethod: 'SbpQr' }))).toBe(
      'sbp',
    )
  })

  it('matches the Cyrillic `СБП`', () => {
    expect(detectPaymentMethod(payload({ PaymentMethod: 'СБП' }))).toBe('sbp')
  })

  it('matches the exact whitelist `fps` token', () => {
    expect(detectPaymentMethod(payload({ PaymentMethod: 'fps' }))).toBe('sbp')
  })

  it('REJECTS substring-style values that would have falsely classified', () => {
    // Round-2 WARN#4 — the closed contract is EXACT match, not
    // includes(). These two cases are exactly the failure modes that
    // exact-match prevents.
    expect(
      detectPaymentMethod(payload({ PaymentMethod: 'FPS Faster Payments' })),
    ).toBe('unknown')
    expect(
      detectPaymentMethod(payload({ PaymentMethod: 'SbpAndCardHybrid' })),
    ).toBe('unknown')
  })
})

describe('detectPaymentMethod (unknown fallback)', () => {
  it('returns unknown on null PaymentMethod and null card fields', () => {
    expect(detectPaymentMethod(payload({}))).toBe('unknown')
  })

  it('returns unknown on empty-string fields', () => {
    expect(
      detectPaymentMethod(
        payload({ CardType: '', CardLastFour: '', PaymentMethod: '' }),
      ),
    ).toBe('unknown')
  })

  it('returns unknown for non-whitelist values (ApplePay)', () => {
    expect(
      detectPaymentMethod(payload({ PaymentMethod: 'ApplePay' })),
    ).toBe('unknown')
  })

  it('returns unknown for non-whitelist values (GooglePay)', () => {
    expect(
      detectPaymentMethod(payload({ PaymentMethod: 'GooglePay' })),
    ).toBe('unknown')
  })

  it('returns unknown when CardType is whitespace-only', () => {
    // Trim is part of the contract; a single space is NOT card-positive.
    expect(detectPaymentMethod(payload({ CardType: '   ' }))).toBe('unknown')
  })
})
