import { randomUUID } from 'crypto'

import {
  buildCloudPaymentsWidgetIntent,
  createCloudPaymentsOrder,
} from '@/lib/payments/cloudpayments'
import { paymentConfig } from '@/lib/payments/config'
import { createMockOrder } from '@/lib/payments/mock'
import { createOrder, getOrder, updateOrder } from '@/lib/payments/store'
import type {
  CloudPaymentsWidgetIntent,
  PaymentOrder,
  PublicPaymentOrder,
} from '@/lib/payments/types'

function nowIso() {
  return new Date().toISOString()
}

function getPayloadString(
  payload: Record<string, unknown> | undefined,
  key: string,
) {
  const value = payload?.[key]

  if (typeof value === 'string' && value) {
    return value
  }

  if (typeof value === 'number') {
    return String(value)
  }

  return undefined
}

function appendEvent(
  order: PaymentOrder,
  type: string,
  payload?: Record<string, unknown>,
): PaymentOrder {
  const timestamp = nowIso()

  return {
    ...order,
    updatedAt: timestamp,
    events: [
      {
        type,
        at: timestamp,
        payload,
      },
      ...order.events,
    ].slice(0, 50),
  }
}

export function toPublicOrder(order: PaymentOrder): PublicPaymentOrder {
  return {
    invoiceId: order.invoiceId,
    amountRub: order.amountRub,
    currency: order.currency,
    description: order.description,
    provider: order.provider,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt,
    failedAt: order.failedAt,
    providerMessage: order.providerMessage,
  }
}

export async function createPayment(amountRub: number, customerEmail: string) {
  let order: PaymentOrder
  let checkoutIntent: CloudPaymentsWidgetIntent | null = null

  if (paymentConfig.provider === 'cloudpayments') {
    const invoiceId = `lc_${randomUUID().replace(/-/g, '').slice(0, 18)}`
    order = createCloudPaymentsOrder(amountRub, customerEmail, invoiceId)
    checkoutIntent = buildCloudPaymentsWidgetIntent(order)
  } else {
    order = createMockOrder(amountRub, customerEmail)
  }

  await createOrder(order)

  return {
    order: toPublicOrder(order),
    checkoutIntent,
  }
}

export async function syncMockOrderState(invoiceId: string) {
  const current = await getOrder(invoiceId)

  if (!current || current.provider !== 'mock') {
    return current
  }

  if (
    current.status === 'pending' &&
    current.mockAutoConfirmAt &&
    new Date(current.mockAutoConfirmAt).getTime() <= Date.now()
  ) {
    return updateOrder(invoiceId, (order) =>
      appendEvent(
        {
          ...order,
          status: 'paid',
          paidAt: nowIso(),
          providerMessage: 'Mock-режим: платёж автоматически подтверждён.',
        },
        'mock.auto_paid',
      ),
    )
  }

  return current
}

export async function getPublicPayment(invoiceId: string) {
  const order = await syncMockOrderState(invoiceId)
  return order ? toPublicOrder(order) : null
}

export async function markOrderPaid(
  invoiceId: string,
  payload?: Record<string, unknown>,
) {
  return updateOrder(invoiceId, (order) => {
    if (order.status === 'paid') {
      return appendEvent(order, 'payment.paid_duplicate', payload)
    }

    return appendEvent(
      {
        ...order,
        status: 'paid',
        paidAt: order.paidAt || nowIso(),
        providerTransactionId:
          getPayloadString(payload, 'transactionId') || order.providerTransactionId,
        providerMessage: 'Платёж подтверждён.',
      },
      'payment.paid',
      payload,
    )
  })
}

export async function markOrderFailed(
  invoiceId: string,
  payload?: Record<string, unknown>,
) {
  return updateOrder(invoiceId, (order) => {
    const reason = getPayloadString(payload, 'reason')

    if (order.status === 'paid') {
      return appendEvent(order, 'payment.fail_ignored_after_paid', payload)
    }

    if (order.status === 'failed') {
      return appendEvent(order, 'payment.fail_duplicate', payload)
    }

    return appendEvent(
      {
        ...order,
        status: 'failed',
        failedAt: order.failedAt || nowIso(),
        providerTransactionId:
          getPayloadString(payload, 'transactionId') || order.providerTransactionId,
        providerMessage: reason || 'Платёж отклонён или отменён.',
      },
      'payment.failed',
      payload,
    )
  })
}

export async function markOrderCancelled(
  invoiceId: string,
  payload?: Record<string, unknown>,
) {
  return updateOrder(invoiceId, (order) => {
    if (order.status === 'paid') {
      return appendEvent(order, 'payment.cancel_ignored_after_paid', payload)
    }

    if (order.status === 'cancelled') {
      return appendEvent(order, 'payment.cancel_duplicate', payload)
    }

    if (order.status === 'failed') {
      return appendEvent(order, 'payment.cancel_ignored_after_failed', payload)
    }

    return appendEvent(
      {
        ...order,
        status: 'cancelled',
        providerMessage: 'Платёжная форма была закрыта без завершения оплаты.',
      },
      'payment.cancelled',
      payload,
    )
  })
}
