import {
  normalizePaymentAmount,
  PAYMENT_DESCRIPTION,
  PAYMENT_ITEM_NAME,
} from '@/lib/payments/catalog'
import { isCloudPaymentsConfigured, paymentConfig } from '@/lib/payments/config'
import type {
  CloudPaymentsWidgetIntent,
  PaymentOrder,
  PaymentReceipt,
} from '@/lib/payments/types'

function buildReceipt(amountRub: number, email: string): PaymentReceipt {
  const normalizedAmount = normalizePaymentAmount(amountRub)

  return {
    items: [
      {
        label: PAYMENT_ITEM_NAME,
        price: normalizedAmount,
        quantity: 1,
        amount: normalizedAmount,
        vat: 0,
        method: 0,
        object: 0,
      },
    ],
    email,
    isBso: false,
    amounts: {
      electronic: normalizedAmount,
      advancePayment: 0,
      credit: 0,
      provision: 0,
    },
  }
}

export function createCloudPaymentsOrder(
  amountRub: number,
  customerEmail: string,
  invoiceId: string,
  options: { rememberCard?: boolean; source?: string } = {},
): PaymentOrder {
  if (!isCloudPaymentsConfigured()) {
    throw new Error('CloudPayments credentials are not configured.')
  }

  const now = new Date().toISOString()
  const normalizedAmount = normalizePaymentAmount(amountRub)
  const receipt = buildReceipt(normalizedAmount, customerEmail)

  return {
    invoiceId,
    amountRub: normalizedAmount,
    currency: 'RUB',
    description: PAYMENT_DESCRIPTION,
    provider: 'cloudpayments',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    customerEmail,
    receiptEmail: customerEmail,
    receipt,
    providerMessage: 'Ожидаем завершения оплаты в CloudPayments.',
    metadata: {
      source: options.source || 'widget',
      rememberCard: Boolean(options.rememberCard),
    },
    events: [
      {
        type: 'order.created',
        at: now,
      },
    ],
  }
}

export function buildCloudPaymentsWidgetIntent(
  order: PaymentOrder,
): CloudPaymentsWidgetIntent {
  const rememberCard =
    typeof order.metadata?.rememberCard === 'boolean'
      ? order.metadata.rememberCard
      : false

  return {
    publicTerminalId: paymentConfig.cloudpayments.publicId,
    amount: order.amountRub,
    currency: 'RUB',
    description: order.description,
    externalId: order.invoiceId,
    paymentSchema: 'Single',
    skin: 'modern',
    culture: 'ru-RU',
    emailBehavior: 'Hidden',
    receiptEmail: order.receiptEmail,
    userInfo: {
      accountId: order.customerEmail,
      email: order.customerEmail,
    },
    receipt: order.receipt,
    items: [
      {
        id: order.invoiceId,
        name: PAYMENT_ITEM_NAME,
        count: 1,
        price: order.amountRub,
      },
    ],
    metadata: {
      invoiceId: order.invoiceId,
      customerEmail: order.customerEmail,
      rememberCard,
    },
    tokenize: rememberCard,
    successRedirectUrl: `${paymentConfig.siteUrl}/thank-you?invoiceId=${encodeURIComponent(order.invoiceId)}`,
    failRedirectUrl: `${paymentConfig.siteUrl}/?payment=failed&invoiceId=${encodeURIComponent(order.invoiceId)}`,
    retryPayment: false,
  }
}
