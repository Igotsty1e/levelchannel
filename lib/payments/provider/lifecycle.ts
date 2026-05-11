// Wave 41 — order-state-machine half of the former
// lib/payments/provider.ts (Codex Wave 13 Pass 1 #10).
//
// Owns the read + state-transition surface: toPublicOrder projection,
// the three terminal mark* helpers, syncMockOrderState (mock-only
// auto-confirm), and the private event-bookkeeping helpers (nowIso,
// getPayloadString, appendEvent, maybeEmitStatusChange).
//
// The checkout flow (createPayment / chargeWithSavedCard /
// confirmThreeDsAndFinalize) lives in ./checkout.ts and DOES depend on
// these helpers — saved-card decline calls markOrderFailed, etc.

import { emitStatusChange } from '@/lib/payments/status-bus'
import { getOrder, updateOrder } from '@/lib/payments/store'
import type { PaymentOrder, PublicPaymentOrder } from '@/lib/payments/types'

export function nowIso() {
  return new Date().toISOString()
}

export function getPayloadString(
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

export function appendEvent(
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
