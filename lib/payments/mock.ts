import { randomUUID } from 'crypto'

import {
  buildPaymentDescription,
  normalizePaymentAmount,
  PAYMENT_DESCRIPTION,
} from '@/lib/payments/catalog'
import { paymentConfig } from '@/lib/payments/config'
import type { PersonalDataConsentSnapshot } from '@/lib/legal/personal-data'
import type { PaymentOrder } from '@/lib/payments/types'

export function createMockOrder(
  amountRub: number,
  customerEmail: string,
  options: {
    personalDataConsent?: PersonalDataConsentSnapshot
    customerComment?: string | null
    slotId?: string | null
  } = {},
): PaymentOrder {
  const now = new Date()
  const invoiceId = `lc_${now.toISOString().slice(0, 10).replace(/-/g, '')}_${randomUUID().slice(0, 8)}`
  const autoConfirmAt = new Date(
    now.getTime() + paymentConfig.mockAutoConfirmSeconds * 1000,
  ).toISOString()
  const normalizedAmount = normalizePaymentAmount(amountRub)
  const customerComment = options.customerComment ?? null

  return {
    invoiceId,
    amountRub: normalizedAmount,
    currency: 'RUB',
    description: buildPaymentDescription(normalizedAmount, customerComment),
    provider: 'mock',
    status: 'pending',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    customerEmail,
    receiptEmail: customerEmail,
    receipt: {
      items: [
        {
          label: PAYMENT_DESCRIPTION,
          price: normalizedAmount,
          quantity: 1,
          amount: normalizedAmount,
          vat: 0,
          method: 0,
          object: 0,
        },
      ],
      email: customerEmail,
      isBso: false,
      amounts: {
        electronic: normalizedAmount,
        advancePayment: 0,
        credit: 0,
        provision: 0,
      },
    },
    mockAutoConfirmAt: autoConfirmAt,
    providerMessage: 'Mock-режим: оплата будет автоматически подтверждена.',
    customerComment,
    metadata: {
      mockBankSessionId: randomUUID(),
      personalDataConsent: options.personalDataConsent,
      customerComment,
      ...(options.slotId ? { slotId: options.slotId } : {}),
    },
    events: [
      ...(options.personalDataConsent
        ? [
            {
              type: 'legal.personal_data_consent_accepted',
              at: options.personalDataConsent.acceptedAt,
              payload: {
                documentVersion: options.personalDataConsent.documentVersion,
                documentPath: options.personalDataConsent.documentPath,
                policyPath: options.personalDataConsent.policyPath,
                source: options.personalDataConsent.source,
                ipAddress: options.personalDataConsent.ipAddress,
                userAgent: options.personalDataConsent.userAgent,
              },
            },
          ]
        : []),
      {
        type: 'order.created',
        at: now.toISOString(),
      },
    ],
  }
}
