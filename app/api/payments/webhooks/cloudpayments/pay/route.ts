import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { handleCloudPaymentsWebhook } from '@/lib/payments/cloudpayments-route'
import { getCloudPaymentsInvoiceId } from '@/lib/payments/cloudpayments-webhook'
import { markOrderPaid } from '@/lib/payments/provider'
import { maybePersistTokenFromWebhook } from '@/lib/payments/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleCloudPaymentsWebhook(request, async (payload) => {
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
    }
  })
}
