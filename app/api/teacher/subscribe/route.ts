// A2 — Mid/Pro teacher-subscription init route.
//
// Plan: docs/plans/saas-offer-and-landing-redesign.md A2.
//
// POST /api/teacher/subscribe
//   Body: { tier: 'mid' | 'pro' }
//   Auth: requireTeacherWithCurrentSaasOfferConsent (teacher + verified
//         + SaaS-оферта acceptance, when the gate flag is ON).
//
// Returns: { invoiceId, amountRub, tier, checkoutIntent } where
// checkoutIntent is the CloudPayments widget config (null in mock mode).
//
// Mock mode: when PAYMENTS_PROVIDER is unset / not 'cloudpayments', the
// route writes the order with provider='mock' and auto-activates the
// subscription inline so dev/test flows work without a real webhook.
import { randomUUID } from 'crypto'

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { recordPaymentAuditEvent } from '@/lib/audit/payment-events'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { mintToken } from '@/lib/auth/tokens'
import {
  createOrRenewTeacherSubscription,
  getSubscriptionTariff,
  type TeacherSubscriptionTier,
} from '@/lib/billing/teacher-subscription'
import { buildCloudPaymentsWidgetIntent } from '@/lib/payments/cloudpayments'
import { PAYMENT_ITEM_NAME, normalizePaymentAmount } from '@/lib/payments/catalog'
import { getOrder } from '@/lib/payments/store'
import { getDbPool } from '@/lib/db/pool'
import { withIdempotency } from '@/lib/security/idempotency'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'teacher:subscribe:ip', 10, 60_000)
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const account = guard.account
  const rawBody = await request.text()

  let parsedBody: { tier?: unknown }
  try {
    parsedBody = rawBody ? (JSON.parse(rawBody) as { tier?: unknown }) : {}
  } catch {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }

  const tierRaw = parsedBody.tier
  if (tierRaw !== 'mid' && tierRaw !== 'pro') {
    return NextResponse.json(
      {
        error: 'invalid_tier',
        message: 'Поле tier должно быть "mid" или "pro".',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  const tier: TeacherSubscriptionTier = tierRaw

  const tariff = getSubscriptionTariff(tier)
  if (!tariff) {
    return NextResponse.json(
      { error: 'invalid_tier' },
      { status: 400, headers: NO_STORE },
    )
  }

  const idempotencyScope = `teacher:subscribe:${account.id}:${tier}`

  return withIdempotency(request, idempotencyScope, rawBody, async () => {
    const amountRub = normalizePaymentAmount(tariff.amountKopecks / 100)
    const provider =
      process.env.PAYMENTS_PROVIDER === 'cloudpayments' ? 'cloudpayments' : 'mock'
    const isMockAutoConfirm =
      provider === 'mock' && process.env.PAYMENTS_ALLOW_MOCK_CONFIRM === 'true'
    const initialStatus = isMockAutoConfirm ? 'paid' : 'pending'

    const invoiceId = `lc_sub_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const customerEmail = account.email
    const description = tariff.description
    const productKind = `saas_subscription_${tier}`
    const metadata = {
      accountId: account.id,
      productKind,
      saasSubscriptionTier: tier,
      saasAmountKopecks: tariff.amountKopecks,
    }

    const receiptTokenPair = mintToken()

    const pool = getDbPool()
    const lockClient = await pool.connect()
    try {
      await lockClient.query('begin')
      // Serialise concurrent subscribe attempts from the same teacher.
      // Two parallel clicks would otherwise insert two pending orders;
      // the webhook would then race-grant twice. Lock keyed on the
      // teacher account id only — different tiers serialise too, which
      // is intentional (you can't subscribe to Mid and Pro at once).
      await lockClient.query(
        `select pg_advisory_xact_lock(hashtextextended('teacher-subscribe:' || $1, 0))`,
        [account.id],
      )

      await lockClient.query(
        `insert into payment_orders
           (invoice_id, amount_rub, currency, description, provider, status,
            created_at, updated_at, paid_at, customer_email, receipt_email,
            receipt, metadata, receipt_token_hash, teacher_account_id,
            payment_method)
         values ($1, $2, 'RUB', $3, $4, $5,
                 now(), now(),
                 case when $5 = 'paid' then now() else null end,
                 $6, $6,
                 $7::jsonb, $8::jsonb, $9, $10::uuid,
                 'card')`,
        [
          invoiceId,
          amountRub.toFixed(2),
          description,
          provider,
          initialStatus,
          customerEmail,
          JSON.stringify({
            items: [
              {
                label: PAYMENT_ITEM_NAME,
                price: amountRub,
                quantity: 1,
                amount: amountRub,
                vat: 0,
                method: 0,
                object: 0,
              },
            ],
            email: customerEmail,
            isBso: false,
            amounts: {
              electronic: amountRub,
              advancePayment: 0,
              credit: 0,
              provision: 0,
            },
          }),
          JSON.stringify(metadata),
          receiptTokenPair.hash,
          account.id,
        ],
      )
      await lockClient.query('commit')
    } catch (err) {
      await lockClient.query('rollback').catch(() => {})
      throw err
    } finally {
      lockClient.release()
    }

    await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId,
      customerEmail,
      amountKopecks: tariff.amountKopecks,
      toStatus: initialStatus,
      actor: 'teacher:subscribe',
      payload: { tier, productKind },
    })

    let checkoutIntent: ReturnType<typeof buildCloudPaymentsWidgetIntent> | null =
      null
    if (provider === 'cloudpayments') {
      const order = await getOrder(invoiceId)
      if (order) {
        checkoutIntent = buildCloudPaymentsWidgetIntent(order, {
          receiptToken: receiptTokenPair.plain,
        })
      }
    }

    // Mock-auto-confirm: activate the subscription inline so dev flows
    // can verify the UI without a real webhook fire.
    if (isMockAutoConfirm) {
      await createOrRenewTeacherSubscription({
        accountId: account.id,
        tier,
        amountKopecks: tariff.amountKopecks,
        paymentOrderId: invoiceId,
      })
    }

    return {
      status: 200,
      body: {
        invoiceId,
        provider,
        status: initialStatus,
        amountRub,
        tier,
        receiptToken: receiptTokenPair.plain,
        checkoutIntent,
      },
    }
  })
}
