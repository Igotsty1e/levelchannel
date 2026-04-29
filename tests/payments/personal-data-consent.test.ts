import { describe, expect, it, vi } from 'vitest'

import {
  buildPersonalDataConsentSnapshot,
  PERSONAL_DATA_CONSENT_PATH,
  PERSONAL_DATA_DOCUMENT_VERSION,
  PERSONAL_DATA_POLICY_PATH,
} from '@/lib/legal/personal-data'
import { createMockOrder } from '@/lib/payments/mock'

describe('buildPersonalDataConsentSnapshot', () => {
  it('builds a stable consent proof payload', () => {
    const snapshot = buildPersonalDataConsentSnapshot({
      acceptedAt: '2026-04-29T10:00:00.000Z',
      ipAddress: '203.0.113.10',
      userAgent: 'Mozilla/5.0',
    })

    expect(snapshot).toMatchObject({
      accepted: true,
      acceptedAt: '2026-04-29T10:00:00.000Z',
      documentVersion: PERSONAL_DATA_DOCUMENT_VERSION,
      documentPath: PERSONAL_DATA_CONSENT_PATH,
      policyPath: PERSONAL_DATA_POLICY_PATH,
      ipAddress: '203.0.113.10',
      userAgent: 'Mozilla/5.0',
      source: 'checkout',
    })
  })
})

describe('payment order consent persistence', () => {
  const consent = buildPersonalDataConsentSnapshot({
    acceptedAt: '2026-04-29T10:00:00.000Z',
    ipAddress: '203.0.113.10',
    userAgent: 'Mozilla/5.0',
  })

  it('stores consent snapshot in mock orders', () => {
    const order = createMockOrder(100, 'user@example.com', {
      personalDataConsent: consent,
    })

    expect(order.metadata).toMatchObject({
      personalDataConsent: consent,
    })
    expect(order.events[0]).toMatchObject({
      type: 'legal.personal_data_consent_accepted',
      at: consent.acceptedAt,
    })
  })

  it('stores consent snapshot in cloudpayments orders', async () => {
    vi.resetModules()
    const previousPublicId = process.env.CLOUDPAYMENTS_PUBLIC_ID
    const previousApiSecret = process.env.CLOUDPAYMENTS_API_SECRET
    process.env.CLOUDPAYMENTS_PUBLIC_ID = 'pk_test'
    process.env.CLOUDPAYMENTS_API_SECRET = 'sk_test'

    try {
      const { createCloudPaymentsOrder } = await import('@/lib/payments/cloudpayments')
      const order = createCloudPaymentsOrder(100, 'user@example.com', 'lc_test_invoice', {
        personalDataConsent: consent,
      })

      expect(order.metadata).toMatchObject({
        personalDataConsent: consent,
      })
      expect(order.events[0]).toMatchObject({
        type: 'legal.personal_data_consent_accepted',
        at: consent.acceptedAt,
      })
    } finally {
      process.env.CLOUDPAYMENTS_PUBLIC_ID = previousPublicId
      process.env.CLOUDPAYMENTS_API_SECRET = previousApiSecret
    }
  })
})
