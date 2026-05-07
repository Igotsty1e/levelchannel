import { createHash } from 'crypto'

import { NextResponse } from 'next/server'
import type { PoolClient } from 'pg'

import {
  recordPaymentAuditEvent,
  rublesToKopecks,
  type PaymentAuditEventType,
} from '@/lib/audit/payment-events'
import { getDbPool } from '@/lib/db/pool'
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
  lookupWebhookDeliveryClient,
  recordWebhookDelivery,
  recordWebhookDeliveryClient,
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

// Wave 2.3 — fingerprint over the cross-check fields so the dedup
// gate can detect a TxId-collision attack. The chosen fields mirror
// the inputs `validateCloudPaymentsOrder` actually checks (invoice +
// amount + email/account); a webhook with a different invoice or
// amount but the same TxId would fingerprint differently and bypass
// the cache. Empty values normalised to empty string so the hash
// stays stable; the canonical separator '\x1f' (Unit Separator) is a
// non-printable ASCII byte that cannot appear in invoice / email /
// amount strings. Returns hex sha256.
function computeRequestFingerprint(
  payload: CloudPaymentsWebhookPayload,
): string {
  const invoice = String(getCloudPaymentsInvoiceId(payload) ?? '')
  const amount = String(payload.Amount ?? '')
  const email = String(payload.Email ?? '')
  const accountId = String(payload.AccountId ?? '')
  return createHash('sha256')
    .update([invoice, amount, email, accountId].join('\x1f'))
    .digest('hex')
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

// The audit + validate + run-handler chain. Reused by both the dedup-
// serialized path (Wave 3.2) and the legacy non-dedup path. Returns
// the WebhookDeliveryOutcome that the caller persists / replies with.
async function runWebhookPipeline(
  payload: CloudPaymentsWebhookPayload,
  options: { kind: WebhookKind; handler?: WebhookHandler },
): Promise<{
  outcome: WebhookDeliveryOutcome
  invoiceId: string | null
  orderInvoiceId: string | null
}> {
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
    return {
      outcome: { status: 200, body: { code: validation.code } },
      invoiceId,
      orderInvoiceId: order?.invoiceId ?? null,
    }
  }

  if (options.handler) {
    await options.handler(payload)
  }
  return {
    outcome: { status: 200, body: { code: 0 } },
    invoiceId,
    orderInvoiceId: order?.invoiceId ?? null,
  }
}

// Wave 3.2 — serialised dedup-aware pipeline.
//
// Holds a sticky pool client. Inside one transaction:
//   1. acquire `pg_advisory_xact_lock(hashtext("cp:<kind>:<txId>"))`
//      — second concurrent retry waits at this point;
//   2. re-check the cache (the first retry may have committed
//      while we were waiting for the lock);
//   3. if hit → COMMIT, return cached;
//      if mismatch → log + run handler;
//      if miss → run handler;
//   4. record outcome on the same client (in-tx);
//   5. COMMIT — releases the advisory lock atomically.
//
// The handler's own DB writes (markOrderPaid, audit, allocation, ...)
// happen on DIFFERENT pool connections — they are NOT inside this
// transaction. That's intentional: the lock just serialises "who runs
// the pipeline"; per-op atomicity stays at the data layer.
// Codex 2026-05-07 — acquisition-timeout DoS amplifier.
//
// `pool.connect()` queues without a deadline. When the shared pool is
// saturated by application traffic, every CloudPayments retry stacks
// on top of the previous one waiting for a slot. The provider's own
// HTTP timeout fires (~30 s) and CP retries — which lands the next
// retry in the same queue. Webhooks are money-moving traffic; they
// must fail FAST when infra is overloaded so CP's retry budget
// surfaces a real outage, not a silent hang.
//
// 2.5 s is well below CP's request timeout (≈30 s per provider docs)
// and below their retry cadence (minutes), so a healthy pool never
// trips this. A tripped acquisition throws — caught by the outer
// `try/catch` in `handleCloudPaymentsWebhook` and falls through to
// the legacy non-dedup path. That path also uses the shared pool, so
// it isn't a true escape hatch under sustained saturation; but it
// avoids the lock-then-process queue and reduces the per-request
// latency floor while ops investigate.
const POOL_ACQUIRE_TIMEOUT_MS = 2500

async function acquireClientWithTimeout(
  pool: ReturnType<typeof getDbPool>,
): Promise<PoolClient> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  const connectPromise = pool.connect()
  try {
    return await Promise.race([
      connectPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          reject(
            new Error(
              `pool.connect() timed out after ${POOL_ACQUIRE_TIMEOUT_MS}ms — webhook pool is saturated`,
            ),
          )
        }, POOL_ACQUIRE_TIMEOUT_MS)
      }),
    ])
  } catch (err) {
    // If the timeout fires first, the underlying connect() may still
    // resolve later with a real client. Release it back to the pool so
    // we don't leak a connection slot every time this path trips.
    if (timedOut) {
      void connectPromise
        .then((client) => {
          try {
            client.release()
          } catch {
            // best-effort
          }
        })
        .catch(() => {
          // best-effort
        })
    }
    throw err
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

async function processSerialized(
  payload: CloudPaymentsWebhookPayload,
  transactionId: string,
  requestFingerprint: string,
  options: { kind: WebhookKind; handler?: WebhookHandler },
): Promise<NextResponse> {
  await ensureWebhookDeliveriesSchema()

  const pool = getDbPool()
  const client = await acquireClientWithTimeout(pool)
  // Track whether the handler ran so the post-handler error path
  // doesn't fall through to the legacy pipeline (which would re-run
  // the handler and duplicate side effects). Pre-handler errors fall
  // through; post-handler errors swallow and return the outcome.
  let handlerResult: Awaited<ReturnType<typeof runWebhookPipeline>> | null =
    null
  try {
    await client.query('BEGIN')
    try {
      const lockKey = `${PROVIDER}:${options.kind}:${transactionId}`
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        lockKey,
      ])

      const cached = await lookupWebhookDeliveryClient(
        client,
        PROVIDER,
        options.kind,
        transactionId,
        requestFingerprint,
      )
      if (cached.kind === 'hit') {
        await client.query('COMMIT')
        return jsonResponse(cached.outcome, true)
      }
      if (cached.kind === 'fingerprint_mismatch') {
        console.warn(
          '[webhook-dedup] fingerprint mismatch on cache hit; running handler:',
          {
            kind: options.kind,
            transactionId,
            cachedFingerprint: cached.cachedFingerprint,
            incomingFingerprint: requestFingerprint,
          },
        )
      }

      handlerResult = await runWebhookPipeline(payload, options)

      try {
        await recordWebhookDeliveryClient(client, {
          provider: PROVIDER,
          kind: options.kind,
          transactionId,
          invoiceId:
            handlerResult.orderInvoiceId ?? handlerResult.invoiceId ?? null,
          outcome: handlerResult.outcome,
          requestFingerprint,
        })
        await client.query('COMMIT')
      } catch (recordErr) {
        // Handler already ran; record failed. Roll back to release the
        // lock; the dedup row is missing — the next retry from
        // CloudPayments will re-run the handler (operator email may
        // duplicate). Acceptable: better than re-running the handler
        // RIGHT NOW via fall-through, which is guaranteed duplication.
        try {
          await client.query('ROLLBACK')
        } catch {
          // best-effort
        }
        console.warn(
          '[webhook-dedup] record failed after handler ran; outcome returned, dedup row missing:',
          recordErr instanceof Error ? recordErr.message : recordErr,
        )
      }

      return jsonResponse(handlerResult.outcome, false)
    } catch (err) {
      // Pre-handler error (lock acquire, lookup, schema). Roll back.
      try {
        await client.query('ROLLBACK')
      } catch {
        // best-effort
      }
      if (handlerResult !== null) {
        // Handler ran AND a downstream operation threw — return the
        // outcome; do NOT fall through. This branch should not be
        // reachable today (the only post-handler op is record, which
        // is wrapped in its own try/catch above), but the guard is
        // load-bearing if a future change adds a post-handler op.
        console.warn(
          '[webhook-dedup] unexpected post-handler error swallowed:',
          err instanceof Error ? err.message : err,
        )
        return jsonResponse(handlerResult.outcome, false)
      }
      throw err
    }
  } finally {
    client.release()
  }
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
// Wave 1.2 (security) — webhook delivery dedup.
// Wave 2.2 (security) — secondary IP rate limit AFTER HMAC.
// Wave 2.3 (security) — TxId-collision-proof fingerprint check.
// Wave 3.2 (security) — pg_advisory_xact_lock serialises concurrent
//                       retries so the handler runs exactly once.
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

  // Codex 2026-05-07 — replay-protection bypass via missing TransactionId.
  //
  // CloudPayments always sends a non-empty `TransactionId` on legitimate
  // check / pay / fail webhooks (per provider docs). A verified-HMAC
  // request that omits or blanks the field cannot be a real CP delivery —
  // it can only be an attacker holding the HMAC secret who wants the
  // dedup gate to silently disable so the paid handler runs N times. We
  // refuse rather than fall through to the legacy non-dedup path. 400
  // matches the parse-failure shape; CloudPayments interprets non-200 as
  // "retry later", which is harmless here because their next retry will
  // carry a real TransactionId.
  if (transactionId === null) {
    console.warn(
      '[cloudpayments] verified webhook with missing/blank TransactionId rejected (kind=%s)',
      options.kind,
    )
    return NextResponse.json({ code: 13 }, { status: 400 })
  }

  const dedupEnabled = paymentConfig.storageBackend === 'postgres'
  const requestFingerprint = dedupEnabled
    ? computeRequestFingerprint(payload)
    : null

  // Serialised dedup path. A Postgres outage on the lock acquire or
  // the lookup is reported via console.warn and we fall through to
  // the legacy non-dedup path so a real CloudPayments retry is never
  // blocked by dedup infra.
  if (dedupEnabled && requestFingerprint) {
    try {
      return await processSerialized(
        payload,
        transactionId,
        requestFingerprint,
        options,
      )
    } catch (error) {
      console.warn(
        '[webhook-dedup] serialised path failed; falling back to non-dedup processing:',
        error instanceof Error ? error.message : error,
      )
      // Fall through to legacy path below.
    }
  }

  // Legacy non-dedup / fall-through path. Runs the same pipeline
  // without the lock or the dedup row. Compatible with file-storage
  // backends; also the failure recovery path when the dedup-aware
  // code throws (rare). Missing-TransactionId requests are no longer
  // routed here — they are rejected at the entry guard above.
  const result = await runWebhookPipeline(payload, options)

  // If dedup is theoretically enabled but the locked path threw, we
  // STILL try to record the outcome with the pool-based recorder so
  // future retries can short-circuit. Best-effort.
  if (dedupEnabled && requestFingerprint) {
    try {
      // Re-check cache one more time (defensive; in case a parallel
      // request stored a result while we were processing).
      const cached = await lookupWebhookDelivery(
        PROVIDER,
        options.kind,
        transactionId,
        requestFingerprint,
      )
      if (cached.kind !== 'hit') {
        await recordWebhookDelivery({
          provider: PROVIDER,
          kind: options.kind,
          transactionId,
          invoiceId: result.orderInvoiceId ?? result.invoiceId ?? null,
          outcome: result.outcome,
          requestFingerprint,
        })
      }
    } catch (error) {
      console.warn(
        '[webhook-dedup] persist-after-fallback failed; response still returned:',
        error instanceof Error ? error.message : error,
      )
    }
  }

  return jsonResponse(result.outcome, false)
}
