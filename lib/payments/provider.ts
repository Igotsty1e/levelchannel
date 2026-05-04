import { randomUUID } from 'crypto'

import {
  chargeWithSavedToken,
  confirmThreeDs,
} from '@/lib/payments/cloudpayments-api'
import {
  buildCloudPaymentsWidgetIntent,
  createCloudPaymentsOrder,
} from '@/lib/payments/cloudpayments'
import type { PersonalDataConsentSnapshot } from '@/lib/legal/personal-data'
import { paymentConfig } from '@/lib/payments/config'
import { createMockOrder } from '@/lib/payments/mock'
import { emitStatusChange } from '@/lib/payments/status-bus'
import {
  createOrder,
  deleteCardToken,
  getCardTokenByEmail,
  getOrder,
  touchCardTokenUsedAt,
  updateOrder,
  upsertCardToken,
} from '@/lib/payments/store'
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

// Real-transition event names produced by markOrderPaid /
// markOrderFailed / markOrderCancelled. Duplicates (paid_duplicate,
// fail_duplicate, etc.) are appended with different names; if we see
// only those, no SSE emit happens — the listener already saw the
// terminal status on the prior call.
const TRANSITION_EVENT_TYPES = new Set([
  'payment.paid',
  'payment.failed',
  'payment.cancelled',
])

function maybeEmitStatusChange(order: PaymentOrder | null) {
  if (!order) return
  const latest = order.events[0]
  if (!latest || !TRANSITION_EVENT_TYPES.has(latest.type)) return
  emitStatusChange({
    invoiceId: order.invoiceId,
    status: order.status,
    order: toPublicOrder(order),
  })
}

export async function createPayment(
  amountRub: number,
  customerEmail: string,
  options: {
    rememberCard?: boolean
    personalDataConsent: PersonalDataConsentSnapshot
    customerComment?: string | null
    // Phase 6: optional binding to a lesson_slot. Persisted on the
    // order's metadata; the webhook handler reads this on `paid` and
    // writes the corresponding payment_allocations row.
    slotId?: string | null
  },
) {
  let order: PaymentOrder
  let checkoutIntent: CloudPaymentsWidgetIntent | null = null

  if (paymentConfig.provider === 'cloudpayments') {
    const invoiceId = `lc_${randomUUID().replace(/-/g, '').slice(0, 18)}`
    order = createCloudPaymentsOrder(amountRub, customerEmail, invoiceId, {
      rememberCard: Boolean(options.rememberCard),
      personalDataConsent: options.personalDataConsent,
      customerComment: options.customerComment ?? null,
      slotId: options.slotId ?? null,
    })
    checkoutIntent = buildCloudPaymentsWidgetIntent(order)
  } else {
    order = createMockOrder(amountRub, customerEmail, {
      personalDataConsent: options.personalDataConsent,
      customerComment: options.customerComment ?? null,
      slotId: options.slotId ?? null,
    })
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
  const order = await updateOrder(invoiceId, (order) => {
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
  maybeEmitStatusChange(order)
  return order
}

export async function markOrderFailed(
  invoiceId: string,
  payload?: Record<string, unknown>,
) {
  const order = await updateOrder(invoiceId, (order) => {
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
  maybeEmitStatusChange(order)
  return order
}

export type ChargeWithSavedCardOutcome =
  | { kind: 'no_saved_card' }
  | { kind: 'paid'; order: PublicPaymentOrder }
  | {
      kind: 'requires_3ds'
      order: PublicPaymentOrder
      threeDs: {
        transactionId: string
        paReq: string
        acsUrl: string
        threeDsCallbackId?: string
      }
    }
  | { kind: 'declined'; order: PublicPaymentOrder; reason: string }

export type ConfirmThreeDsOutcome =
  | { kind: 'paid'; order: PublicPaymentOrder }
  | { kind: 'declined'; order: PublicPaymentOrder; reason: string }
  | { kind: 'unknown_invoice' }
  | { kind: 'invalid_state'; order: PublicPaymentOrder }

export async function chargeWithSavedCard(params: {
  amountRub: number
  customerEmail: string
  ipAddress?: string
  personalDataConsent: PersonalDataConsentSnapshot
}): Promise<ChargeWithSavedCardOutcome> {
  if (paymentConfig.provider !== 'cloudpayments') {
    return { kind: 'no_saved_card' }
  }

  const saved = await getCardTokenByEmail(params.customerEmail)

  if (!saved) {
    return { kind: 'no_saved_card' }
  }

  const invoiceId = `lc_${randomUUID().replace(/-/g, '').slice(0, 18)}`
  const order = createCloudPaymentsOrder(
    params.amountRub,
    params.customerEmail,
    invoiceId,
    { personalDataConsent: params.personalDataConsent },
  )

  const orderWithMetadata: PaymentOrder = {
    ...order,
    metadata: {
      ...(order.metadata || {}),
      source: 'one_click',
    },
    events: [
      ...order.events,
      { type: 'one_click.charge_attempt', at: nowIso() },
    ],
  }

  await createOrder(orderWithMetadata)

  const result = await chargeWithSavedToken({
    amount: orderWithMetadata.amountRub,
    token: saved.token,
    accountId: saved.customerEmail,
    invoiceId: orderWithMetadata.invoiceId,
    description: orderWithMetadata.description,
    ipAddress: params.ipAddress,
    email: saved.customerEmail,
  })

  if (result.kind === 'success') {
    const paid = await markOrderPaid(orderWithMetadata.invoiceId, {
      transactionId: result.transactionId,
      source: 'one_click',
    })
    await touchCardTokenUsedAt(saved.customerEmail, nowIso())
    return {
      kind: 'paid',
      order: toPublicOrder(paid || orderWithMetadata),
    }
  }

  if (result.kind === 'requires_3ds') {
    const updated = await updateOrder(orderWithMetadata.invoiceId, (current) =>
      appendEvent(
        {
          ...current,
          providerMessage:
            'Подтвердите оплату в окне 3-D Secure вашего банка.',
          metadata: {
            ...(current.metadata || {}),
            threeDs: {
              transactionId: result.transactionId,
              acsUrl: result.acsUrl,
              threeDsCallbackId: result.threeDsCallbackId,
              startedAt: nowIso(),
            },
          },
        },
        'one_click.requires_3ds',
        {
          transactionId: result.transactionId,
          threeDsCallbackId: result.threeDsCallbackId,
        },
      ),
    )
    return {
      kind: 'requires_3ds',
      order: toPublicOrder(updated || orderWithMetadata),
      threeDs: {
        transactionId: result.transactionId,
        paReq: result.paReq,
        acsUrl: result.acsUrl,
        threeDsCallbackId: result.threeDsCallbackId,
      },
    }
  }

  if (result.kind === 'declined') {
    const failed = await markOrderFailed(orderWithMetadata.invoiceId, {
      transactionId: result.transactionId,
      reason: result.message,
      reasonCode: result.reasonCode,
      source: 'one_click',
    })

    // Если карта помечена банком как недействительная — удаляем токен,
    // чтобы пользователь не видел "оплатить сохранённой картой" впустую.
    if (
      result.reasonCode === '5051' ||
      result.reasonCode === '5054' ||
      result.reasonCode === '5057'
    ) {
      await deleteCardToken(saved.customerEmail)
    }

    return {
      kind: 'declined',
      order: toPublicOrder(failed || orderWithMetadata),
      reason: result.message,
    }
  }

  const failed = await markOrderFailed(orderWithMetadata.invoiceId, {
    reason: result.message,
    source: 'one_click',
  })

  return {
    kind: 'declined',
    order: toPublicOrder(failed || orderWithMetadata),
    reason: result.message,
  }
}

export async function confirmThreeDsAndFinalize(params: {
  invoiceId: string
  paRes: string
}): Promise<ConfirmThreeDsOutcome> {
  const order = await getOrder(params.invoiceId)

  if (!order) {
    return { kind: 'unknown_invoice' }
  }

  if (order.status === 'paid') {
    // Двойной коллбэк банка (или пользователь рефрешнул) — отдаём как есть.
    return { kind: 'paid', order: toPublicOrder(order) }
  }

  const threeDs = (order.metadata?.threeDs as
    | {
        transactionId?: string
      }
    | undefined) || undefined
  const transactionId = threeDs?.transactionId

  if (!transactionId || order.status !== 'pending') {
    return { kind: 'invalid_state', order: toPublicOrder(order) }
  }

  const result = await confirmThreeDs({
    transactionId,
    paRes: params.paRes,
  })

  if (result.kind === 'success') {
    const paid = await markOrderPaid(order.invoiceId, {
      transactionId: result.transactionId,
      source: 'one_click_3ds',
    })

    if (order.customerEmail && order.metadata?.rememberCard === true && result.token) {
      // post3ds может вернуть свежий Token — обновляем сохранённую карту.
      await upsertCardToken({
        customerEmail: order.customerEmail,
        token: result.token,
        cardLastFour: result.cardLastFour,
        cardType: result.cardType,
        cardExpMonth: result.cardExpDate?.split('/')?.[0],
        cardExpYear: result.cardExpDate?.split('/')?.[1],
        createdAt: nowIso(),
        lastUsedAt: nowIso(),
      })
    } else if (order.customerEmail) {
      await touchCardTokenUsedAt(order.customerEmail, nowIso())
    }

    return {
      kind: 'paid',
      order: toPublicOrder(paid || order),
    }
  }

  if (result.kind === 'declined') {
    const failed = await markOrderFailed(order.invoiceId, {
      transactionId: result.transactionId,
      reason: result.message,
      reasonCode: result.reasonCode,
      source: 'one_click_3ds',
    })

    return {
      kind: 'declined',
      order: toPublicOrder(failed || order),
      reason: result.message,
    }
  }

  // result.kind === 'error' — не помечаем ордер как failed, чтобы пользователь
  // мог попробовать ещё раз. Логируем как событие.
  await updateOrder(order.invoiceId, (current) =>
    appendEvent(current, 'one_click.3ds_error', { message: result.message }),
  )

  return {
    kind: 'declined',
    order: toPublicOrder(order),
    reason: result.message,
  }
}

export async function markOrderCancelled(
  invoiceId: string,
  payload?: Record<string, unknown>,
) {
  const order = await updateOrder(invoiceId, (order) => {
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
  maybeEmitStatusChange(order)
  return order
}
