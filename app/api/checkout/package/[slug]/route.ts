import { randomUUID } from 'crypto'

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { requireLearnerArchetypeAndVerified } from '@/lib/auth/guards'
import { isLearnerArchetypeCandidate } from '@/lib/auth/learner-archetype'
import { mintToken } from '@/lib/auth/tokens'
import { getPackageBySlug } from '@/lib/billing/packages'
import { learnerHasActivePackageOfDuration } from '@/lib/billing/packages/eligibility'
import { accountHasPendingPackageGrantForDuration } from '@/lib/billing/packages/purchases'
import { buildCloudPaymentsWidgetIntent } from '@/lib/payments/cloudpayments'
import { getOrder } from '@/lib/payments/store'
import { getDbPool } from '@/lib/db/pool'
import { withIdempotency } from '@/lib/security/idempotency'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


type RouteParams = { params: Promise<{ slug: string }> }

// Billing wave PR 2 — package checkout init.
//
// Authoritative-source guarantees per design v9 trust-boundary
// section: ALL fields written to payment_orders.metadata are server-
// authored. Client request body is empty; nothing influences the row
// except the URL param `slug` and the authenticated session.
//
//   metadata.accountId             = session.account.id
//   metadata.packageSlug           = lesson_packages.slug (resolved row)
//   metadata.packageDurationMinutes = lesson_packages.duration_minutes
//   customer_email                 = session.account.email (NEVER body)
//
// The webhook handler (/api/payments/webhooks/cloudpayments/pay) then
// reads these fields and grants the package via dual-source ownership
// corroboration.
//
// Mock-mode auto-confirm: in PAYMENTS_PROVIDER=mock, the order is
// inserted with status='paid' immediately so test integration can
// observe the grant flow in one round-trip without simulating a
// full webhook payload. Production CloudPayments path inserts as
// 'pending' and the real webhook fires on pay.processed.

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'checkout:package:ip', 10, 60_000)
  if (rl) return rl

  // PKG-LEARNER-BUY LBL.0 — auth guard swap. Canonical learner-archetype
  // gate kicks admin + teacher + unverified in one contract. Plus a
  // post-guard `isLearnerArchetypeCandidate` SoT check for
  // deletion-grace coverage (scheduled_purge_at; round-1 RISK-1).
  const auth = await requireLearnerArchetypeAndVerified(request)
  if (!auth.ok) return auth.response
  const session = { account: auth.account, session: auth.session }

  const candidate = await isLearnerArchetypeCandidate(session.account.id)
  if (!candidate) {
    return NextResponse.json(
      { error: 'learner_target_unavailable' },
      { status: 403, headers: NO_STORE },
    )
  }

  const { slug } = await params
  const pkg = await getPackageBySlug(slug)
  if (!pkg || !pkg.isActive) {
    return NextResponse.json(
      { error: 'package_not_found' },
      { status: 404, headers: NO_STORE },
    )
  }

  // Wave 45 — wrap money-moving init in withIdempotency. A duplicate
  // submit (network retry, double-click, etc.) would otherwise mint a
  // second pending order under the same idempotency-key, both pointing
  // at the same package. Mirrors the gate on /api/payments.
  //
  // Codex post-review HIGH. Scope MUST include the slug AND the
  // account id — withIdempotency hashes scope + body, body is empty
  // here, and a constant 'checkout:package' scope would let one
  // Idempotency-Key replay across DIFFERENT packages AND different
  // accounts. The cache row then leaks another buyer's invoiceId and
  // receiptToken. The scope strings below namespace the cache by
  // (slug, accountId) so a same-key submit on /package/b with the
  // /package/a cache entry is a miss, not a leak.
  const rawBody = await request.text()
  const accountId = session.account.id
  const customerEmail = session.account.email
  const idempotencyScope = `checkout:package:${pkg.slug}:${accountId}`

  return withIdempotency(request, idempotencyScope, rawBody, async () => {
    const amountRub = (pkg.amountKopecks / 100).toFixed(2)
    const description = `Пакет: ${pkg.titleRu}`
    const provider = process.env.PAYMENTS_PROVIDER === 'cloudpayments'
      ? 'cloudpayments'
      : 'mock'

    // Wave 45 / Wave 24 — collision-free invoice id.
    const invoiceId = `lc_pkg_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const isMockAutoConfirm =
      provider === 'mock' && process.env.PAYMENTS_ALLOW_MOCK_CONFIRM === 'true'
    const initialStatus = isMockAutoConfirm ? 'paid' : 'pending'

    const metadata = {
      accountId,
      packageSlug: pkg.slug,
      packageDurationMinutes: pkg.durationMinutes,
      packageId: pkg.id,
    }

    const receiptTokenPair = mintToken()

    // PKG-LEARNER-BUY LBL.0 — race-safe gate + INSERT. The lock is keyed
    // by (accountId, durationMinutes) so two parallel POSTs from the
    // same learner for packages of the same duration serialise; the
    // loser observes the winner's pending order and gets 409
    // pending_package_in_flight. Different-duration purchases proceed
    // concurrently. Namespace `pkg-buy:` does not collide with
    // `pkg-recon:`, `pkg_consume:`, `cp:`, or `legal:` (verified
    // 2026-05-16).
    const pool = getDbPool()
    const lockClient = await pool.connect()
    try {
      await lockClient.query('begin')
      await lockClient.query(
        `select pg_advisory_xact_lock(hashtextextended('pkg-buy:' || $1 || ':' || $2, 0))`,
        [accountId, pkg.durationMinutes],
      )

      // Gate 1: pending order in the last 15 min for the same
      // (account, duration)? Existing helper.
      const hasPending = await accountHasPendingPackageGrantForDuration(
        accountId,
        pkg.durationMinutes,
      )
      if (hasPending) {
        await lockClient.query('commit')
        return {
          status: 409,
          body: {
            error: 'pending_package_in_flight',
            message:
              'У вас уже есть незавершённый платёж на пакет такой же длительности. Дождитесь подтверждения первой оплаты или попробуйте позже.',
          },
        }
      }

      // Gate 2: account already owns an active package of the same
      // duration with units remaining? New LBL.0 helper.
      const ownedActive = await learnerHasActivePackageOfDuration(
        accountId,
        pkg.durationMinutes,
      )
      if (ownedActive) {
        await lockClient.query('commit')
        return {
          status: 409,
          body: {
            error: 'already_owns_active_package',
            existingPurchaseId: ownedActive.purchaseId,
            message: `У вас уже есть активный пакет такой же длительности (${ownedActive.titleSnapshot}). Дождитесь его завершения.`,
          },
        }
      }

      // INSERT on the same lockClient, inside the lock TX. Both gates
      // committed nothing yet — the lock alone protected the read +
      // write critical section.
      await lockClient.query(
        `insert into payment_orders
           (invoice_id, amount_rub, currency, description, provider, status,
            created_at, updated_at, paid_at, customer_email, receipt_email,
            receipt, metadata, receipt_token_hash)
         values ($1, $2, 'RUB', $3, $4, $5,
                 now(), now(),
                 case when $5 = 'paid' then now() else null end,
                 $6, $6,
                 $7::jsonb, $8::jsonb, $9)`,
        [
          invoiceId,
          amountRub,
          description,
          provider,
          initialStatus,
          customerEmail,
          JSON.stringify({
            items: [
              {
                label: description,
                price: Number(amountRub),
                quantity: 1,
                amount: Number(amountRub),
                vat: 0,
                method: 0,
                object: 0,
              },
            ],
            email: customerEmail,
            isBso: false,
            amounts: {
              electronic: Number(amountRub),
              advancePayment: 0,
              credit: 0,
              provision: 0,
            },
          }),
          JSON.stringify(metadata),
          receiptTokenPair.hash,
        ],
      )
      await lockClient.query('commit')
    } catch (e) {
      await lockClient.query('rollback').catch(() => {})
      throw e
    } finally {
      lockClient.release()
    }

    // Post-commit best-effort audit (matches existing dispatch pattern).
    await recordPaymentAuditEvent({
      eventType: 'order.created',
      invoiceId,
      customerEmail,
      amountKopecks: rublesToKopecks(Number(amountRub)),
      toStatus: initialStatus,
      actor: 'checkout:package',
      payload: { packageSlug: pkg.slug, durationMinutes: pkg.durationMinutes },
    })

    // PKG-LEARNER-BUY LBL.0 — production widget intent. Read back the
    // committed row via getOrder (safer than reconstructing inline)
    // and call buildCloudPaymentsWidgetIntent on it. Mock provider has
    // no widget; return null.
    let checkoutIntent: ReturnType<typeof buildCloudPaymentsWidgetIntent> | null =
      null
    if (provider === 'cloudpayments') {
      const order = await getOrder(invoiceId)
      if (order) {
        // Epic-end paranoia BLOCKER #2 closure: thread the plain
        // receipt token through so the CP server-side success redirect
        // carries `&token=`. Mock provider skips the widget entirely
        // so this branch is cloudpayments-only.
        checkoutIntent = buildCloudPaymentsWidgetIntent(order, {
          receiptToken: receiptTokenPair.plain,
        })
      }
    }

    // In mock-auto-confirm mode, fire the package-grant flow inline
    // (mirrors what the real webhook would do on pay.processed).
    if (isMockAutoConfirm) {
      const { processPackageGrantInline } = await import('@/lib/billing/package-grant')
      await processPackageGrantInline(invoiceId)
    }

    return {
      status: 200,
      body: {
        invoiceId,
        provider,
        status: initialStatus,
        amountRub: Number(amountRub),
        packageSlug: pkg.slug,
        receiptToken: receiptTokenPair.plain,
        checkoutIntent,
      },
    }
  })
}
