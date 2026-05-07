import { NextResponse } from 'next/server'

import {
  recordPaymentAuditEvent,
  rublesToKopecks,
  type PaymentAuditEventType,
} from '@/lib/audit/payment-events'
import {
  getCloudPaymentsInvoiceId,
  parseCloudPaymentsPayload,
  validateCloudPaymentsOrder,
  verifyCloudPaymentsSignature,
  type CloudPaymentsWebhookPayload,
} from '@/lib/payments/cloudpayments-webhook'
import { paymentConfig } from '@/lib/payments/config'
import { getOrder } from '@/lib/payments/store'
import {
  ensureWebhookDeliveriesSchema,
  lookupWebhookDelivery,
  recordWebhookDelivery,
  type WebhookDeliveryOutcome,
} from '@/lib/payments/webhook-dedup'
import { enforceRateLimit } from '@/lib/security/request'

type WebhookHandler = (payload: CloudPaymentsWebhookPayload) => Promise<void>

type WebhookKind = 'check' | 'pay' | 'fail'

const PROVIDER = 'cloudpayments'

// Audit event names per phase per kind. The pre-validation `received`
// phase fires after HMAC verify + parse (we have a payload we trust
// the SOURCE of) but BEFORE order cross-check (we haven't decided
// whether amount/email/status are consistent with our records).
const RECEIVED_EVENT: Record<WebhookKind, PaymentAuditEventType> = {
  check: 'webhook.check.received',
  pay: 'webhook.pay.received',
  fail: 'webhook.fail.received',
}

const VALIDATION_FAILED_EVENT: Record<WebhookKind, PaymentAuditEventType> = {
  check: 'webhook.check.declined',
  pay: 'webhook.pay.validation_failed',
  fail: 'webhook.fail.declined',
}

// Read CloudPayments TransactionId for dedup. The provider sends it
// as a number; we coerce to string so the dedup key is uniform across
// numeric / string-y deliveries (legacy retries, manual replays).
// Returns null when the field is missing or empty — in that case we
// skip dedup (no key to dedup ON) and let the request fall through.
function readTransactionId(
  payload: CloudPaymentsWebhookPayload,
): string | null {
  const raw = payload.TransactionId
  if (raw === null || raw === undefined) return null
  const str = String(raw).trim()
  if (str.length === 0) return null
  return str
}

function jsonResponse(outcome: WebhookDeliveryOutcome, replay: boolean) {
  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: replay
      ? {
          'Cache-Control': 'no-store, max-age=0',
          'Webhook-Replay': 'true',
        }
      : { 'Cache-Control': 'no-store, max-age=0' },
  })
}

// HMAC and parse failures NEVER produce audit rows or dedup rows: at
// that point we don't trust the body's invoice_id or transaction_id.
// The audit table's invoice_id column has a FK on payment_orders, so
// writing a fabricated value would either fail or pollute the index;
// the dedup table has no FK but we still don't want attacker-supplied
// transaction_ids cluttering it.
//
// Cross-check (validateCloudPaymentsOrder) failures DO produce audit
// rows because we have a parsed payload from a verified-HMAC source —
// the invoice_id, even if it doesn't match a real order, is what
// CloudPayments said it was. We attach as much context as we can
// (look up the order; if not found, leave email/amount nulls and
// pass null invoice_id... actually no — FK requires a real order;
// so if order not found we can only console-warn, not audit).
//
// This trade-off is documented because it surprises: a fail webhook
// for an unknown invoice_id won't show up in audit, only in journald.
// The uptime/webhook-flow alerts catch the broader pattern.
//
// Wave 1 (security) — webhook delivery dedup:
//
// After HMAC + parse pass and we have a verified-source TransactionId,
// look up `webhook_deliveries`. If we've already processed this
// (provider, kind, transactionId), return the cached response with
// a `Webhook-Replay: true` header and skip the rest of the pipeline.
// If TransactionId is missing or storage is non-Postgres, fall
// through to the legacy non-dedup path.
export async function handleCloudPaymentsWebhook(
  request: Request,
  options: { kind: WebhookKind; handler?: WebhookHandler },
) {
  const rawBody = await request.text()
  const xContentHmac = request.headers.get('x-content-hmac')
  const contentHmac = request.headers.get('content-hmac')
  const contentType = request.headers.get('content-type')

  if (!verifyCloudPaymentsSignature(rawBody, xContentHmac, contentHmac)) {
    return NextResponse.json({ code: 13 }, { status: 401 })
  }

  // Wave 2.2 — secondary rate limit on verified webhooks. Bucket is
  // applied AFTER HMAC so unauth flood attempts (HMAC-fail → 401)
  // never consume the budget, leaving CloudPayments' own retries
  // unaffected. The ceiling (60/min per IP per kind) sits ~1000x
  // above the legitimate CloudPayments retry cadence (minutes apart
  // per provider docs), so this only fires on a key-leak flood —
  // which is the exact scenario this bucket guards against.
  const rl = await enforceRateLimit(
    request,
    `webhook:cloudpayments:${options.kind}:ip`,
    60,
    60_000,
  )
  if (rl) return rl

  let payload: CloudPaymentsWebhookPayload
  try {
    payload = parseCloudPaymentsPayload(rawBody, contentType)
  } catch {
    return NextResponse.json({ code: 13 }, { status: 400 })
  }

  const transactionId = readTransactionId(payload)
  const dedupEnabled =
    paymentConfig.storageBackend === 'postgres' && transactionId !== null

  // Replay short-circuit. We trust the source (HMAC verified) and the
  // transaction key, so a hit here is a legitimate retry — return the
  // bit-for-bit response we returned the first time.
  if (dedupEnabled && transactionId) {
    try {
      await ensureWebhookDeliveriesSchema()
      const cached = await lookupWebhookDelivery(
        PROVIDER,
        options.kind,
        transactionId,
      )
      if (cached) {
        return jsonResponse(cached, true)
      }
    } catch (error) {
      // Dedup is best-effort: a Postgres outage cannot block a real
      // webhook from being processed (CloudPayments would just retry
      // forever). Log and fall through.
      console.warn(
        '[webhook-dedup] lookup failed; proceeding without dedup:',
        error instanceof Error ? error.message : error,
      )
    }
  }

  // Phase 0: parsed payload, source verified. Audit the receipt — but
  // ONLY if the invoice_id matches a real order (FK constraint). If
  // the invoice is unknown, skip audit and let validation produce the
  // expected `code: <nonzero>` response; the unknown-invoice case is
  // expected and not worth a polluted audit row.
  const invoiceId = getCloudPaymentsInvoiceId(payload)
  const order = invoiceId ? await getOrder(invoiceId) : null

  if (order) {
    await recordPaymentAuditEvent({
      eventType: RECEIVED_EVENT[options.kind],
      invoiceId: order.invoiceId,
      customerEmail: order.customerEmail,
      amountKopecks: rublesToKopecks(order.amountRub),
      fromStatus: order.status,
      actor: `webhook:cloudpayments:${options.kind}`,
      payload: {
        transactionId: payload.TransactionId,
        amountInPayload: payload.Amount,
        emailInPayload: payload.Email,
      },
    })
  }

  let outcome: WebhookDeliveryOutcome

  const validation = await validateCloudPaymentsOrder(payload)
  if (!validation.ok) {
    if (order) {
      await recordPaymentAuditEvent({
        eventType: VALIDATION_FAILED_EVENT[options.kind],
        invoiceId: order.invoiceId,
        customerEmail: order.customerEmail,
        amountKopecks: rublesToKopecks(order.amountRub),
        fromStatus: order.status,
        actor: `webhook:cloudpayments:${options.kind}`,
        payload: { code: validation.code },
      })
    }
    outcome = { status: 200, body: { code: validation.code } }
  } else {
    if (options.handler) {
      await options.handler(payload)
    }
    outcome = { status: 200, body: { code: 0 } }
  }

  // Persist the dedup row AFTER the handler ran so a retry that
  // arrives during processing falls through and re-runs (acceptable
  // — handler-level operations are individually idempotent per the
  // module-level comment in webhook-dedup). Best-effort: if the
  // insert fails, the response we just produced is still correct;
  // the next retry will simply re-process.
  if (dedupEnabled && transactionId) {
    try {
      await recordWebhookDelivery({
        provider: PROVIDER,
        kind: options.kind,
        transactionId,
        invoiceId: order?.invoiceId ?? invoiceId ?? null,
        outcome,
      })
    } catch (error) {
      console.warn(
        '[webhook-dedup] persist failed; response still returned:',
        error instanceof Error ? error.message : error,
      )
    }
  }

  return jsonResponse(outcome, false)
}
