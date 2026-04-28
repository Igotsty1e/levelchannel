import { handleCloudPaymentsWebhook } from '@/lib/payments/cloudpayments-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleCloudPaymentsWebhook(request)
}
