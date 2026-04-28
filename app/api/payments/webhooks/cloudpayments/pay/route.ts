import { handleCloudPaymentsWebhook } from '@/lib/payments/cloudpayments-route'
import { getCloudPaymentsInvoiceId } from '@/lib/payments/cloudpayments-webhook'
import { markOrderPaid } from '@/lib/payments/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleCloudPaymentsWebhook(request, async (payload) => {
    await markOrderPaid(getCloudPaymentsInvoiceId(payload), {
      transactionId: payload.TransactionId,
      paymentMethod: payload.PaymentMethod,
      status: payload.Status,
    })
  })
}
