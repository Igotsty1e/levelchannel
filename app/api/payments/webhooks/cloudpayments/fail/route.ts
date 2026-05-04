import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { sendOperatorPaymentFailureNotification } from '@/lib/email/dispatch'
import { handleCloudPaymentsWebhook } from '@/lib/payments/cloudpayments-route'
import { getCloudPaymentsInvoiceId } from '@/lib/payments/cloudpayments-webhook'
import { markOrderFailed } from '@/lib/payments/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleCloudPaymentsWebhook(request, {
    kind: 'fail',
    handler: async (payload) => {
      const order = await markOrderFailed(getCloudPaymentsInvoiceId(payload), {
        transactionId: payload.TransactionId,
        reason: payload.Reason,
        reasonCode: payload.ReasonCode,
      })

      if (order) {
        await recordPaymentAuditEvent({
          // Migration 0014 renamed the finalize event from
          // `webhook.fail.received` to `webhook.fail.processed` to
          // make room for a true post-parse pre-validation phase
          // event under the original name.
          eventType: 'webhook.fail.processed',
          invoiceId: order.invoiceId,
          customerEmail: order.customerEmail,
          amountKopecks: rublesToKopecks(order.amountRub),
          toStatus: order.status,
          actor: 'webhook:cloudpayments:fail',
          payload: {
            transactionId: payload.TransactionId,
            reason: payload.Reason,
            reasonCode: payload.ReasonCode,
          },
        })

        // Per-event operator notification. Best-effort: a Resend
        // outage cannot block the webhook ack to CloudPayments.
        try {
          await sendOperatorPaymentFailureNotification({
            invoiceId: order.invoiceId,
            amountRub: order.amountRub,
            customerEmail: order.customerEmail,
            source: 'CloudPayments Fail webhook',
            reason: payload.Reason ?? null,
            reasonCode: payload.ReasonCode ?? null,
            transactionId: payload.TransactionId ?? null,
            customerComment: order.customerComment ?? null,
          })
        } catch (err) {
          console.warn('[notify] operator failure email failed:', {
            invoiceId: order.invoiceId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    },
  })
}
