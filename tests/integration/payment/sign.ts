import { createHmac } from 'node:crypto'

// Test-side HMAC signer for CloudPayments webhooks. Uses the same
// `base64(HMAC-SHA256(rawBody, apiSecret))` shape that
// lib/payments/cloudpayments-webhook.ts verifies.
//
// Reads CLOUDPAYMENTS_API_SECRET from env at call time (NOT module
// load) so a test that mutates the env between cases stays in sync.

export function signCloudPaymentsBody(rawBody: string, secret?: string): string {
  const key = secret ?? process.env.CLOUDPAYMENTS_API_SECRET ?? ''
  if (!key) {
    throw new Error('CLOUDPAYMENTS_API_SECRET must be set for HMAC signing.')
  }
  return createHmac('sha256', key).update(rawBody, 'utf8').digest('base64')
}

// Build a Pay webhook body in the standard urlencoded form CloudPayments
// uses by default. Caller supplies invoiceId, amount, email, plus any
// extras (TransactionId, PaymentMethod, etc).
export function buildCloudPaymentsBody(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) usp.set(k, String(v))
  }
  return usp.toString()
}
