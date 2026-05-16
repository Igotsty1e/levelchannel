// Wave 41 — checkout-flow half of the former lib/payments/provider.ts
// (Codex Wave 13 Pass 1 #10).
//
// Owns the surfaces that mint new orders or drive saved-card / 3DS
// flows: createPayment, chargeWithSavedCard, confirmThreeDsAndFinalize.
// All terminal state writes delegate to the markOrderPaid /
// markOrderFailed helpers in ./lifecycle.ts.

import { randomUUID } from 'crypto'

import { mintToken } from '@/lib/auth/tokens'
import type { PersonalDataConsentSnapshot } from '@/lib/legal/personal-data'
import {
  chargeWithSavedToken,
  confirmThreeDs,
} from '@/lib/payments/cloudpayments-api'
import {
  buildCloudPaymentsWidgetIntent,
  createCloudPaymentsOrder,
} from '@/lib/payments/cloudpayments'
import { paymentConfig } from '@/lib/payments/config'
import { createMockOrder } from '@/lib/payments/mock'
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

import {
  appendEvent,
  markOrderFailed,
  markOrderPaid,
  nowIso,
  toPublicOrder,
} from './lifecycle'

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

  // Wave 6.1 #4 Phase 1.5 — mint a receipt token. Hash is persisted on
  // the order; plain token is returned ONCE in this response and never
  // stored. Phase 2 gates `/api/payments/[invoiceId]/{,cancel,stream}`
  // on this token; the plain token must thread into both the widget
  // intent's `successRedirectUrl` (CP-provider success path) AND any
  // client-side redirect (mock + cancel path).
  const receiptTokenPair = mintToken()

  if (paymentConfig.provider === 'cloudpayments') {
    const invoiceId = `lc_${randomUUID().replace(/-/g, '').slice(0, 18)}`
    order = createCloudPaymentsOrder(amountRub, customerEmail, invoiceId, {
      rememberCard: Boolean(options.rememberCard),
      personalDataConsent: options.personalDataConsent,
      customerComment: options.customerComment ?? null,
      slotId: options.slotId ?? null,
    })
    // Epic-end paranoia BLOCKER #2 closure: pass the plain token into
    // the widget builder so the CloudPayments server-side success
    // redirect carries `&token=`. Without it /thank-you's polling
    // 401s on /api/payments/[invoiceId].
    checkoutIntent = buildCloudPaymentsWidgetIntent(order, {
      receiptToken: receiptTokenPair.plain,
    })
  } else {
    order = createMockOrder(amountRub, customerEmail, {
      personalDataConsent: options.personalDataConsent,
      customerComment: options.customerComment ?? null,
      slotId: options.slotId ?? null,
    })
  }

  order.receiptTokenHash = receiptTokenPair.hash

  await createOrder(order)

  return {
    order: toPublicOrder(order),
    checkoutIntent,
    receiptToken: receiptTokenPair.plain,
  }
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
  // RECEIPT-3DS-TOKEN (2026-05-16) — caller's authenticated session
  // account id. Persisted as `metadata.accountId` so the receipt-
  // token gate's session-fallback path can match when the 3DS
  // server-side callback redirects the buyer back to /thank-you
  // without the plain token in the URL.
  accountId?: string
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

  // Wave 6.1 #4 Phase 1.5 — mint receipt token for the one-click path
  // too, so Phase 2's gate on [invoiceId]/{,cancel,stream} works
  // uniformly for both regular and one-click orders.
  const oneClickReceiptToken = mintToken()
  const orderWithMetadata: PaymentOrder = {
    ...order,
    receiptTokenHash: oneClickReceiptToken.hash,
    metadata: {
      ...(order.metadata || {}),
      source: 'one_click',
      // RECEIPT-3DS-TOKEN: see params.accountId comment above.
      ...(params.accountId ? { accountId: params.accountId } : {}),
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
