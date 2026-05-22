import { randomUUID } from 'crypto'

import { NextResponse } from 'next/server'

import {
  recordPaymentAuditEvent,
  rublesToKopecks,
} from '@/lib/audit/payment-events'
import { mintToken } from '@/lib/auth/tokens'
import { buildPersonalDataConsentSnapshot } from '@/lib/legal/personal-data'
import {
  formatRubles,
  isValidPaymentAmount,
  MAX_PAYMENT_AMOUNT_RUB,
  MIN_PAYMENT_AMOUNT_RUB,
  normalizeCustomerEmail,
  normalizePaymentAmount,
  validateCustomerComment,
  validateCustomerEmail,
} from '@/lib/payments/catalog'
import { createSbpQr } from '@/lib/payments/cloudpayments-api'
import { createCloudPaymentsOrder } from '@/lib/payments/cloudpayments'
import { resolveOrderAccountIdForCreate } from '@/lib/payments/order-account-resolver'
import { createOrder, updateOrder } from '@/lib/payments/store'
import { markOrderFailed } from '@/lib/payments/provider'
import { deriveTeacherAccountIdForOrder } from '@/lib/payments/teacher-derivation'
import { withIdempotency } from '@/lib/security/idempotency'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
  getClientIp,
} from '@/lib/security/request'
import { appendCheckoutTelemetryEvent } from '@/lib/telemetry/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SBP-PAY (2026-05-19) — server endpoint that creates a `payment_orders`
// row with provider='cloudpayments' + payment_method='sbp', then calls
// the CloudPayments SBP QR API and returns the QR url + receipt token
// to the client modal. See docs/plans/sbp-payments.md §2.1.
//
// Contract overview (mirrors /api/payments card-flow):
//   1. enforceRateLimit + enforceTrustedBrowserOrigin (CSRF).
//   2. Read raw body once (idempotency hash + business logic).
//   3. withIdempotency('sbp:create-qr', rawBody, executor) — fixed
//      scope. Idempotency-Key header REQUIRED (400 'idempotency_key_required'
//      if missing); the modal generates a fresh UUID per click.
//   4. Inside executor: validate body, build consent snapshot from
//      server-side request provenance, resolve session-attach-account-id,
//      create order, mint receipt token, persist, call CP API,
//      record audit. Failure paths leave order pending on transient
//      errors (502); mark failed only on affirmative declines (422).
//
// Single source of truth: payment_orders.payment_method is the
// top-level column (set to 'sbp' here at create-qr time). Webhook
// detection serves only legacy / migration-edge fallback rows.

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(
    request,
    'sbp:create-qr',
    10,
    60_000,
  )
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  // PAY-SBP-REMOVAL (2026-05-20) — operator-disabled gate. The SBP UI
  // button was removed because the CloudPayments merchant terminal
  // doesn't have SBP activated. Setting SBP_ENABLED=true revives the
  // route without re-shipping (when CP-side activation lands).
  // Exact-match guard: truthy strings other than 'true' are rejected.
  // Placed between rate-limit and origin-check so cross-site no-Origin
  // probes get a semantic 503 instead of leaking a 403 (operator-
  // disabled state shouldn't depend on browser origin).
  if (process.env.SBP_ENABLED !== 'true') {
    return NextResponse.json(
      {
        error: 'sbp_disabled',
        message: 'СБП-оплата временно недоступна.',
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'Retry-After': '3600',
        },
      },
    )
  }

  const originResponse = enforceTrustedBrowserOrigin(request)
  if (originResponse) {
    return originResponse
  }

  // §0a BLOCKER#1 closure — Idempotency-Key is REQUIRED on this route
  // (vs optional on /api/payments). The modal generates a fresh UUID
  // per click; absence = malformed client.
  const idempotencyKey = request.headers.get('idempotency-key')
  if (!idempotencyKey) {
    return NextResponse.json(
      {
        error: 'idempotency_key_required',
        message: 'Missing Idempotency-Key header.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  }

  // Read body once — needed for idempotency hash AND for business
  // logic. Mirrors app/api/payments/route.ts:41.
  const rawBody = await request.text()

  return withIdempotency(request, 'sbp:create-qr', rawBody, async () => {
    let body: {
      amountRub?: number | string
      customerEmail?: string
      customerComment?: string | null
      personalDataConsentAccepted?: boolean
    }

    try {
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      return { status: 400, body: { error: 'Invalid request body.' } }
    }

    const amountRub = normalizePaymentAmount(Number(body.amountRub))
    const customerEmail = normalizeCustomerEmail(
      String(body.customerEmail || ''),
    )
    const emailValidation = validateCustomerEmail(customerEmail)

    const commentValidation = validateCustomerComment(body.customerComment)
    if (!commentValidation.ok) {
      await appendCheckoutTelemetryEvent({
        type: 'checkout_submit_rejected',
        amountRub,
        email: customerEmail,
        emailValid: emailValidation.ok,
        reason: 'invalid_comment',
        message: commentValidation.message,
        path: '/api/payments/sbp/create-qr',
        userAgent: request.headers.get('user-agent') || undefined,
        ip: getClientIp(request),
      })
      return { status: 400, body: { error: commentValidation.message } }
    }
    const customerComment = commentValidation.comment

    if (!isValidPaymentAmount(amountRub)) {
      await appendCheckoutTelemetryEvent({
        type: 'checkout_submit_rejected',
        amountRub,
        email: customerEmail,
        emailValid: emailValidation.ok,
        reason: 'invalid_amount',
        path: '/api/payments/sbp/create-qr',
        userAgent: request.headers.get('user-agent') || undefined,
        ip: getClientIp(request),
      })
      return {
        status: 400,
        body: {
          error: `Введите сумму от ${formatRubles(MIN_PAYMENT_AMOUNT_RUB)} до ${formatRubles(MAX_PAYMENT_AMOUNT_RUB)} ₽.`,
        },
      }
    }

    if (!emailValidation.ok) {
      await appendCheckoutTelemetryEvent({
        type: 'checkout_submit_rejected',
        amountRub,
        email: customerEmail,
        emailValid: false,
        reason: emailValidation.reason,
        message: emailValidation.message,
        path: '/api/payments/sbp/create-qr',
        userAgent: request.headers.get('user-agent') || undefined,
        ip: getClientIp(request),
      })
      return { status: 400, body: { error: emailValidation.message } }
    }

    if (body.personalDataConsentAccepted !== true) {
      return {
        status: 400,
        body: {
          error: 'Подтвердите согласие на обработку персональных данных.',
        },
      }
    }

    // §0a BLOCKER#5 closure — server-side consent provenance (IP, UA,
    // monotonic acceptedAt timestamp). Mirrors card-flow line 181-184.
    const personalDataConsent = buildPersonalDataConsentSnapshot({
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent') || undefined,
    })

    // §0a BLOCKER#4 + §0b WARN#2 closure — resolve account-id for
    // metadata.accountId so deep-link-back to /thank-you (no token
    // in URL) is covered by receipt-gate session-fallback. Helper
    // rejects ONLY admin; learner and learner-with-teacher hybrid
    // sessions both accepted.
    const sessionAccountId = await resolveOrderAccountIdForCreate(request)
    const accountIdAttached = sessionAccountId !== null

    // Fresh invoiceId per click (product-owner §5: no QR reuse).
    // Matches INVOICE_ID_PATTERN in lib/security/request.ts:9 —
    // `lc_<18 hex>` (21 chars). Card-flow uses the same pattern.
    const invoiceId = `lc_${randomUUID().replace(/-/g, '').slice(0, 18)}`

    // Mint receipt token BEFORE order persistence so the hash lands
    // in the same INSERT (§0c BLOCKER#3 closure — same pattern as
    // lib/payments/provider/checkout.ts:62-95 createPayment).
    const receiptTokenPair = mintToken()

    // SAAS-PIVOT Epic 6 Day 6 — derive owning teacher. SBP create-qr
    // is the custom-amount entry surface (no slot/package context),
    // so the resolver falls through to the bootstrap teacher unless
    // a `?t=<slug>` query is present (we accept that on the same
    // surface as /api/payments).
    const sbpUrl = new URL(request.url)
    const sbpTeacherSlug = sbpUrl.searchParams.get('t')
    const teacherAccountId = await deriveTeacherAccountIdForOrder({
      teacherSlug: sbpTeacherSlug,
    })
    if (!teacherAccountId) {
      return {
        status: 500,
        body: {
          error: 'teacher_resolution_failed',
          message: 'Не удалось определить учителя для платежа.',
        },
      }
    }

    // Build the order in-memory. createCloudPaymentsOrder writes
    // paymentMethod='sbp' onto the top-level column (single source
    // of truth, §0a BLOCKER#6 + §0b BLOCKER#2 closures).
    const order = createCloudPaymentsOrder(
      amountRub,
      emailValidation.email,
      invoiceId,
      {
        paymentMethod: 'sbp',
        source: 'sbp-button',
        personalDataConsent,
        customerComment,
        teacherAccountId,
      },
    )

    // Stamp metadata.accountId for the session-fallback path (logged-in)
    // and the receipt-token hash for the gate (every order).
    order.metadata = {
      ...(order.metadata || {}),
      ...(accountIdAttached ? { accountId: sessionAccountId } : {}),
    }
    order.receiptTokenHash = receiptTokenPair.hash

    // Persist before calling CloudPayments. On CP-side success we
    // updateOrder() with the providerTransactionId; on declined the
    // markOrderFailed lifecycle helper transitions to status='failed';
    // on transient error (timeout / 5xx) the order stays 'pending'
    // and the user retries with a new Idempotency-Key (§2.8).
    try {
      await createOrder(order)
    } catch (error) {
      // Postgres-side INSERT failure (e.g. duplicate invoice_id under
      // a partial-CDN failure that retried + flushed both writes).
      // Surface as 500; client can retry with fresh key. We don't
      // emit a partial audit row here because no row landed in
      // payment_orders for the audit FK to anchor against.
      console.warn('[sbp.create-qr] createOrder failed', {
        invoiceId,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        status: 500,
        body: {
          error: 'internal_error',
          message: 'Не удалось зарегистрировать платёж. Попробуйте позже.',
        },
      }
    }

    // §0a WARN#2 closure — order-created audit event mirrors card-flow.
    // Best-effort fail-open: a Postgres hiccup must not block the
    // happy path (operator can reconstruct from payment_orders.events).
    try {
      await recordPaymentAuditEvent({
        eventType: 'order.created',
        invoiceId: order.invoiceId,
        customerEmail: emailValidation.email,
        clientIp: getClientIp(request),
        userAgent: request.headers.get('user-agent') || null,
        amountKopecks: rublesToKopecks(order.amountRub),
        toStatus: order.status,
        actor: 'user',
        idempotencyKey,
        payload: {
          provider: order.provider,
          paymentMethod: 'sbp',
          source: 'sbp-button',
          accountIdAttached,
          ...(customerComment ? { customerComment } : {}),
        },
      })
    } catch (error) {
      console.warn('[sbp.create-qr] audit-event recordPaymentAuditEvent failed', {
        invoiceId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // §0a WARN#4 closure — call CP via the centralised client. Raw
    // fetch + Authorization is NOT used; createSbpQr handles Basic
    // Auth + fetchWithTimeout uniformly with chargeWithSavedToken.
    const result = await createSbpQr({
      amount: order.amountRub,
      invoiceId: order.invoiceId,
      accountId: emailValidation.email,
      description: order.description,
      jsonData: JSON.stringify({
        invoiceId: order.invoiceId,
        customerEmail: emailValidation.email,
      }),
    })

    if (result.kind === 'success') {
      // Persist the gateway transactionId via updater callback (§0c
      // BLOCKER#3 closure — real signature `updateOrder(invoiceId, updater)`).
      await updateOrder(order.invoiceId, (current) => ({
        ...current,
        providerTransactionId: result.transactionId,
        updatedAt: new Date().toISOString(),
      }))

      return {
        status: 201,
        body: {
          invoiceId: order.invoiceId,
          qrUrl: result.qrUrl,
          image: result.image ?? null,
          receiptToken: receiptTokenPair.plain,
          transactionId: result.transactionId,
          accountIdAttached,
        },
      }
    }

    if (result.kind === 'declined') {
      // §0a WARN#1 closure — affirmative decline (CP returned
      // Success:false). Mark failed + telemetry. markOrderFailed
      // appends a 'payment.failed' lifecycle event into the order's
      // events log; admin reconciliation reads that. No
      // payment_audit_events row here because the audit-events
      // taxonomy doesn't have an 'order.failed' type — the lifecycle
      // event + telemetry below are the canonical signals.
      await markOrderFailed(order.invoiceId, {
        reason: result.message,
        reasonCode: result.reasonCode,
        source: 'sbp-create-qr',
      })
      await appendCheckoutTelemetryEvent({
        type: 'checkout_submit_rejected',
        amountRub,
        email: emailValidation.email,
        emailValid: true,
        reason: 'sbp_declined',
        message: result.message,
        path: '/api/payments/sbp/create-qr',
        userAgent: request.headers.get('user-agent') || undefined,
        ip: getClientIp(request),
      })
      return {
        status: 422,
        body: {
          error: 'sbp_api_rejected',
          message: result.message,
        },
      }
    }

    // kind === 'error' — transient CP API failure (timeout / 5xx).
    // §0a WARN#1 closure: order stays 'pending'; client retries with
    // a new Idempotency-Key. 5xx outcomes are NOT cached by
    // withIdempotency, so the retry triggers a fresh CP call.
    return {
      status: 502,
      body: {
        error: 'sbp_api_unavailable',
        message:
          'Сервис СБП временно недоступен. Попробуйте ещё раз через минуту.',
      },
    }
  })
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method Not Allowed' },
    { status: 405 },
  )
}
