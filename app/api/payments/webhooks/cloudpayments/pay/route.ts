import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { sendOperatorPaymentNotification } from '@/lib/email/dispatch'
import { recordAllocation } from '@/lib/payments/allocations'
import { handleCloudPaymentsWebhook } from '@/lib/payments/cloudpayments-route'
import { getCloudPaymentsInvoiceId } from '@/lib/payments/cloudpayments-webhook'
import { getOrder } from '@/lib/payments/store'
import { markOrderPaid } from '@/lib/payments/provider'
import { maybePersistTokenFromWebhook } from '@/lib/payments/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleCloudPaymentsWebhook(request, { kind: 'pay', handler: async (payload) => {
    const order = await markOrderPaid(getCloudPaymentsInvoiceId(payload), {
      transactionId: payload.TransactionId,
      paymentMethod: payload.PaymentMethod,
      status: payload.Status,
    })

    if (order?.customerEmail) {
      // Сохраняем токен только если пользователь явно согласился на чекбоксе
      // и terminal вернул Token. Согласие читаем из metadata ордера (наш
      // source of truth) с fallback на Data/JsonData в payload.
      await maybePersistTokenFromWebhook(payload, order.customerEmail, order)
    }

    if (order) {
      await recordPaymentAuditEvent({
        eventType: 'webhook.pay.processed',
        invoiceId: order.invoiceId,
        customerEmail: order.customerEmail,
        amountKopecks: rublesToKopecks(order.amountRub),
        toStatus: order.status,
        actor: 'webhook:cloudpayments:pay',
        payload: {
          transactionId: payload.TransactionId,
          paymentMethod: payload.PaymentMethod,
          providerStatus: payload.Status,
        },
      })

      // Operator notification — best-effort. A Resend outage must NOT
      // break the webhook ACK to CloudPayments (which would make CP
      // re-fire the Pay webhook, double-marking the order). All errors
      // get swallowed + warn'd here; the order is already paid in DB
      // and audit captured the transition, so the operator can still
      // see the event by other means even if email never arrives.
      try {
        const result = await sendOperatorPaymentNotification({
          invoiceId: order.invoiceId,
          amountRub: order.amountRub,
          customerEmail: order.customerEmail,
          transactionId: payload.TransactionId ?? null,
          paymentMethod: payload.PaymentMethod ?? null,
          customerComment: order.customerComment ?? null,
        })
        if (!result.ok && result.reason === 'no_recipient') {
          // No-op path — OPERATOR_NOTIFY_EMAIL not configured. Don't
          // log to keep webhook journal noise low.
        } else if (!result.ok) {
          console.warn('[notify] operator payment email failed:', result)
        }
      } catch (err) {
        console.warn('[notify] operator payment email threw:', {
          invoiceId: order.invoiceId,
          error: err instanceof Error ? err.message : String(err),
        })
      }

      // Phase 6: if the order's metadata names a slotId, write a
      // payment_allocations row binding this paid invoice to that
      // slot. Best-effort: a failed allocation insert MUST NOT block
      // the webhook ack — the order is already paid in DB and audit
      // captured the transition, so the operator can stitch the slot
      // ↔ payment link manually if needed.
      try {
        const fullOrder = await getOrder(order.invoiceId)
        const metaSlotId = fullOrder?.metadata?.slotId
        if (typeof metaSlotId === 'string' && metaSlotId) {
          await recordAllocation({
            paymentOrderId: order.invoiceId,
            kind: 'lesson_slot',
            targetId: metaSlotId,
            amountKopecks: rublesToKopecks(order.amountRub),
          })
        }
      } catch (err) {
        console.warn('[allocations] webhook recordAllocation threw:', {
          invoiceId: order.invoiceId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } })
}
