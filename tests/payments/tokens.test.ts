import { describe, expect, it } from 'vitest'

import type { CloudPaymentsWebhookPayload } from '@/lib/payments/cloudpayments-webhook'
import {
  extractTokenFromWebhookPayload,
  readRememberCardConsent,
  toPublicSavedCard,
} from '@/lib/payments/tokens'
import type { PaymentOrder, SavedCardToken } from '@/lib/payments/types'

function buildOrder(rememberCard: boolean | undefined): PaymentOrder {
  return {
    invoiceId: 'lc_test_abcd1234efgh',
    amountRub: 100,
    currency: 'RUB',
    description: 'test',
    provider: 'cloudpayments',
    status: 'pending',
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
    customerEmail: 'user@example.com',
    receiptEmail: 'user@example.com',
    receipt: {
      items: [],
      email: 'user@example.com',
      isBso: false,
      amounts: { electronic: 100, advancePayment: 0, credit: 0, provision: 0 },
    },
    metadata:
      rememberCard === undefined
        ? undefined
        : { rememberCard, source: 'widget' },
    events: [],
  }
}

describe('extractTokenFromWebhookPayload', () => {
  it('returns null when token is missing', () => {
    const payload: CloudPaymentsWebhookPayload = { TransactionId: 1 }
    expect(extractTokenFromWebhookPayload(payload, 'user@example.com')).toBeNull()
  })

  it('returns null when email is empty', () => {
    const payload: CloudPaymentsWebhookPayload = { Token: 'tk_abc' }
    expect(extractTokenFromWebhookPayload(payload, '')).toBeNull()
  })

  it('extracts token with card meta', () => {
    const payload: CloudPaymentsWebhookPayload = {
      Token: 'tk_xyz',
      CardLastFour: '1234',
      CardType: 'Visa',
      CardExpDate: '11/27',
    }
    const result = extractTokenFromWebhookPayload(payload, 'user@example.com')
    expect(result).toMatchObject({
      customerEmail: 'user@example.com',
      token: 'tk_xyz',
      cardLastFour: '1234',
      cardType: 'Visa',
      cardExpMonth: '11',
      cardExpYear: '27',
    })
  })

  it('handles missing CardExpDate gracefully', () => {
    const payload: CloudPaymentsWebhookPayload = { Token: 'tk_xyz' }
    const result = extractTokenFromWebhookPayload(payload, 'user@example.com')
    expect(result?.cardExpMonth).toBeUndefined()
    expect(result?.cardExpYear).toBeUndefined()
  })

  it('skips malformed CardExpDate', () => {
    const payload: CloudPaymentsWebhookPayload = {
      Token: 'tk_xyz',
      CardExpDate: '11-2027',
    }
    const result = extractTokenFromWebhookPayload(payload, 'user@example.com')
    expect(result?.cardExpMonth).toBeUndefined()
  })
})

describe('readRememberCardConsent', () => {
  it('honours order.metadata.rememberCard=true', () => {
    expect(readRememberCardConsent({}, buildOrder(true))).toBe(true)
  })

  it('honours order.metadata.rememberCard=false even if Data says true', () => {
    const payload: CloudPaymentsWebhookPayload = {
      Data: '{"rememberCard": true}',
    }
    // Order is the source of truth — opt-out wins over forged Data.
    expect(readRememberCardConsent(payload, buildOrder(false))).toBe(false)
  })

  it('falls back to Data when order has no metadata', () => {
    const payload: CloudPaymentsWebhookPayload = {
      Data: '{"rememberCard": true}',
    }
    expect(readRememberCardConsent(payload, null)).toBe(true)
  })

  it('falls back to JsonData when Data missing', () => {
    const payload: CloudPaymentsWebhookPayload = {
      JsonData: '{"rememberCard": true}',
    }
    expect(readRememberCardConsent(payload, null)).toBe(true)
  })

  it('defaults to false when Data is invalid JSON', () => {
    expect(readRememberCardConsent({ Data: 'not-json' }, null)).toBe(false)
  })

  it('defaults to false when Data has no rememberCard field', () => {
    expect(readRememberCardConsent({ Data: '{"foo":1}' }, null)).toBe(false)
  })

  it('defaults to false when nothing is provided', () => {
    expect(readRememberCardConsent({}, null)).toBe(false)
    expect(readRememberCardConsent({}, buildOrder(undefined))).toBe(false)
  })
})

describe('toPublicSavedCard', () => {
  it('strips the token from public projection', () => {
    const saved: SavedCardToken = {
      customerEmail: 'user@example.com',
      token: 'tk_secret',
      cardLastFour: '1234',
      cardType: 'Visa',
      createdAt: '2026-04-29T00:00:00.000Z',
      lastUsedAt: '2026-04-29T00:00:00.000Z',
    }
    const result = toPublicSavedCard(saved)
    expect(result).not.toHaveProperty('token')
    expect(result.cardLastFour).toBe('1234')
    expect(result.cardType).toBe('Visa')
  })
})
