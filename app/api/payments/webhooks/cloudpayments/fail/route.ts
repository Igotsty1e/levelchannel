import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { handleCloudPaymentsWebhook } from '@/lib/payments/cloudpayments-route'
import { getCloudPaymentsInvoiceId } from '@/lib/payments/cloudpayments-webhook'
import { markOrderFailed } from '@/lib/payments/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleCloudPaymentsWebhook(request, async (payload) => {
    const order = await markOrderFailed(getCloudPaymentsInvoiceId(payload), {
      transactionId: payload.TransactionId,
      reason: payload.Reason,
      reasonCode: payload.ReasonCode,
    })

    if (order) {
      await recordPaymentAuditEvent({
        eventType: 'webhook.fail.received',
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
    }
  })
}
