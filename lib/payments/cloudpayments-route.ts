import { NextResponse } from 'next/server'

import type { CloudPaymentsWebhookPayload } from '@/lib/payments/cloudpayments-webhook'
import {
  parseCloudPaymentsPayload,
  validateCloudPaymentsOrder,
  verifyCloudPaymentsSignature,
} from '@/lib/payments/cloudpayments-webhook'

type WebhookHandler = (payload: CloudPaymentsWebhookPayload) => Promise<void>

export async function handleCloudPaymentsWebhook(
  request: Request,
  handler?: WebhookHandler,
) {
  const rawBody = await request.text()
  const xContentHmac = request.headers.get('x-content-hmac')
  const contentHmac = request.headers.get('content-hmac')
  const contentType = request.headers.get('content-type')

  if (!verifyCloudPaymentsSignature(rawBody, xContentHmac, contentHmac)) {
    return NextResponse.json({ code: 13 }, { status: 401 })
  }

  let payload: CloudPaymentsWebhookPayload

  try {
    payload = parseCloudPaymentsPayload(rawBody, contentType)
  } catch {
    return NextResponse.json({ code: 13 }, { status: 400 })
  }

  const validation = await validateCloudPaymentsOrder(payload)

  if (!validation.ok) {
    return NextResponse.json({ code: validation.code })
  }

  if (handler) {
    await handler(payload)
  }

  return NextResponse.json({ code: 0 })
}
