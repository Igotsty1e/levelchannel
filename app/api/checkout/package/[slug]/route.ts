import { NextResponse } from 'next/server'

import {
  getCurrentSession,
} from '@/lib/auth/sessions'
import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { getPackageBySlug } from '@/lib/billing/packages'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

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

  const session = await getCurrentSession(request)
  if (!session) {
    return NextResponse.json(
      { error: 'Not authenticated.' },
      { status: 401, headers: NO_STORE },
    )
  }
  if (!session.account.emailVerifiedAt) {
    return NextResponse.json(
      { error: 'email_not_verified' },
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

  const accountId = session.account.id
  const customerEmail = session.account.email
  const amountRub = (pkg.amountKopecks / 100).toFixed(2)
  const description = `Пакет: ${pkg.titleRu}`
  const provider = process.env.PAYMENTS_PROVIDER === 'cloudpayments'
    ? 'cloudpayments'
    : 'mock'

  // Direct insert keeps the metadata trust boundary tight: every
  // field is server-authored. Reusing the generic createPayment(...)
  // would require threading extraMetadata through three layers; the
  // package flow is narrow enough to justify a direct path.
  const invoiceId = `lc_pkg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  const isMockAutoConfirm =
    provider === 'mock' && process.env.PAYMENTS_ALLOW_MOCK_CONFIRM === 'true'
  const initialStatus = isMockAutoConfirm ? 'paid' : 'pending'

  const metadata = {
    accountId,
    packageSlug: pkg.slug,
    packageDurationMinutes: pkg.durationMinutes,
    packageId: pkg.id,
  }

  const pool = getDbPool()
  await pool.query(
    `insert into payment_orders
       (invoice_id, amount_rub, currency, description, provider, status,
        created_at, updated_at, paid_at, customer_email, receipt_email,
        receipt, metadata)
     values ($1, $2, 'RUB', $3, $4, $5,
             now(), now(),
             case when $5 = 'paid' then now() else null end,
             $6, $6,
             $7::jsonb, $8::jsonb)`,
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
    ],
  )

  await recordPaymentAuditEvent({
    eventType: 'order.created',
    invoiceId,
    customerEmail,
    amountKopecks: rublesToKopecks(Number(amountRub)),
    toStatus: initialStatus,
    actor: 'checkout:package',
    payload: { packageSlug: pkg.slug, durationMinutes: pkg.durationMinutes },
  })

  // In mock-auto-confirm mode, fire the package-grant flow inline
  // (mirrors what the real webhook would do on pay.processed).
  if (isMockAutoConfirm) {
    const { processPackageGrantInline } = await import('@/lib/billing/package-grant')
    await processPackageGrantInline(invoiceId)
  }

  return NextResponse.json(
    {
      invoiceId,
      provider,
      status: initialStatus,
      amountRub: Number(amountRub),
      packageSlug: pkg.slug,
    },
    { status: 200, headers: NO_STORE },
  )
}
