import { createHmac, timingSafeEqual } from 'crypto'

import { paymentConfig } from '@/lib/payments/config'
import { getOrder } from '@/lib/payments/store'

export type CloudPaymentsWebhookPayload = {
  InvoiceId?: string
  ExternalId?: string
  AccountId?: string
  Email?: string
  Amount?: number | string
  TransactionId?: number | string
  Status?: string
  PaymentMethod?: string
  Reason?: string
  ReasonCode?: number | string
  [key: string]: unknown
}

export function getCloudPaymentsInvoiceId(payload: CloudPaymentsWebhookPayload) {
  return String(payload.InvoiceId || payload.ExternalId || '')
}

export function getCloudPaymentsAccountId(payload: CloudPaymentsWebhookPayload) {
  return String(payload.AccountId || '')
}

export function getCloudPaymentsEmail(payload: CloudPaymentsWebhookPayload) {
  return String(payload.Email || '')
}

export function verifyCloudPaymentsSignature(rawBody: string, signature: string | null) {
  if (!signature || !paymentConfig.cloudpayments.apiSecret) {
    return false
  }

  const expected = createHmac('sha256', paymentConfig.cloudpayments.apiSecret)
    .update(rawBody, 'utf8')
    .digest('base64')

  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)

  if (actualBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(actualBuffer, expectedBuffer)
}

export function parseCloudPaymentsPayload(
  rawBody: string,
  contentType: string | null,
): CloudPaymentsWebhookPayload {
  if (contentType?.includes('application/json')) {
    return JSON.parse(rawBody) as CloudPaymentsWebhookPayload
  }

  const params = new URLSearchParams(rawBody)
  const payload: CloudPaymentsWebhookPayload = {}

  params.forEach((value, key) => {
    payload[key] = value
  })

  return payload
}

export async function validateCloudPaymentsOrder(
  payload: CloudPaymentsWebhookPayload,
) {
  const invoiceId = getCloudPaymentsInvoiceId(payload)

  if (!invoiceId) {
    return { ok: false as const, code: 10, message: 'InvoiceId is required.' }
  }

  const order = await getOrder(invoiceId)

  if (!order) {
    return { ok: false as const, code: 10, message: 'Unknown InvoiceId.' }
  }

  const amount = Number(payload.Amount)

  if (!Number.isFinite(amount) || amount !== order.amountRub) {
    return { ok: false as const, code: 12, message: 'Amount mismatch.' }
  }

  const accountId = getCloudPaymentsAccountId(payload)

  if (accountId && accountId !== order.customerEmail) {
    return { ok: false as const, code: 11, message: 'AccountId mismatch.' }
  }

  const email = getCloudPaymentsEmail(payload)

  if (email && email !== order.customerEmail) {
    return { ok: false as const, code: 11, message: 'Email mismatch.' }
  }

  if (order.provider !== 'cloudpayments') {
    return { ok: false as const, code: 10, message: 'Order provider mismatch.' }
  }

  return { ok: true as const, order }
}
