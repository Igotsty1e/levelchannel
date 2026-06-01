import { randomUUID } from 'crypto'

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { recordPaymentAuditEvent, rublesToKopecks } from '@/lib/audit/payment-events'
import { requireLearnerArchetypeAndVerified } from '@/lib/auth/guards'
import { isLearnerArchetypeCandidate } from '@/lib/auth/learner-archetype'
import { mintToken } from '@/lib/auth/tokens'
import {
  countPackagesBySlug,
  getPackageById,
  getPackageBySlug,
  getPackageBySlugForTeacher,
} from '@/lib/billing/packages'
import { learnerHasActivePackageOfDuration } from '@/lib/billing/packages'
import { accountHasPendingPackageGrantForDuration } from '@/lib/billing/packages'
import { buildCloudPaymentsWidgetIntent } from '@/lib/payments/cloudpayments'
import { getOrder } from '@/lib/payments/store'
import {
  deriveTeacherAccountIdForOrder,
  isOperatorManagedTeacher,
} from '@/lib/payments/teacher-derivation'
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
// authored. Client request body is empty; the row's resolution is
// driven by:
//   - URL param `slug` (always)
//   - Optional `?packageId=<uuid>` (preferred — canonical row id,
//     refused if it points at a different slug)
//   - Optional `?teacher=<uuid>` (composite teacher,slug lookup)
//   - Authenticated session (accountId, email)
//
//   metadata.accountId             = session.account.id
//   metadata.packageSlug           = lesson_packages.slug (resolved row)
//   metadata.packageDurationMinutes = lesson_packages.duration_minutes
//   metadata.packageId             = lesson_packages.id (resolved row)
//   customer_email                 = session.account.email (NEVER body)
//
// SAAS-PIVOT security-audit HIGH-1 (2026-05-23): without one of the
// query disambiguators, the route refuses with 400
// `package_slug_ambiguous` when two teachers share the same slug.
// SAAS-PIVOT security-audit HIGH-2 (2026-05-23): refuses with 422
// `plan_4_required` when the resolved package's owning teacher is
// not on the operator-managed (plan-4) subscription.
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

  // SAAS-PIVOT security-audit HIGH-1 (2026-05-23) closure — multi-
  // tenant disambiguation. Mig 0089 retired global UNIQUE(slug) in
  // favour of UNIQUE(teacher_id, slug). The legacy `getPackageBySlug`
  // returns ONE row when multiple teachers ship the same slug, which
  // is non-deterministic. Resolution order:
  //   1. `?packageId=<uuid>` — direct row lookup (canonical, audit
  //      recommends this over the slug). Slug from URL is verified
  //      against the row's actual slug to refuse confused-deputy where
  //      the client points one packageId at a different URL slug.
  //   2. `?teacher=<uuid>` — disambiguating teacher scope; slug lookup
  //      is composite (teacher_id, slug). UUID-typed.
  //   3. Bare slug — only safe when the slug occurs at most once in
  //      lesson_packages. `countPackagesBySlug` > 1 → 400
  //      `package_slug_ambiguous` with explicit guidance.
  const queryUrl = new URL(request.url)
  const explicitPackageId = queryUrl.searchParams.get('packageId')
  const explicitTeacherId = queryUrl.searchParams.get('teacher')
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let pkg: Awaited<ReturnType<typeof getPackageBySlug>> = null
  if (explicitPackageId && UUID_RE.test(explicitPackageId)) {
    pkg = await getPackageById(explicitPackageId)
    if (pkg && pkg.slug !== slug) {
      // Refuse confused-deputy: client supplied packageId pointing at
      // a different slug than the URL claims. Treat as not-found so
      // no information leaks about other packages.
      pkg = null
    }
  } else if (explicitTeacherId && UUID_RE.test(explicitTeacherId)) {
    pkg = await getPackageBySlugForTeacher(explicitTeacherId, slug)
  } else {
    const matchCount = await countPackagesBySlug(slug)
    if (matchCount > 1) {
      return NextResponse.json(
        {
          error: 'package_slug_ambiguous',
          message:
            'Этот slug пакета принадлежит нескольким учителям. Перейдите по ссылке вида ?packageId=<uuid> или ?teacher=<uuid>, чтобы выбрать нужного учителя.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    pkg = await getPackageBySlug(slug)
  }
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
  // receiptToken.
  //
  // SAAS-PIVOT security-audit HIGH-1 (2026-05-23) — round-1 BLOCKER:
  // since mig 0089 retired global UNIQUE(slug), two teachers can ship
  // the same `slug`. The previous scope `checkout:package:${slug}:${acct}`
  // would let one Idempotency-Key replay across DIFFERENT teachers'
  // packages that happen to share a slug. We now key on the RESOLVED
  // `pkg.id` (UUID — unique per teacher) so the cache cannot bridge
  // tenants. The slug is kept in the scope string for grep-ability
  // and human readability but pkg.id is the load-bearing portion.
  const rawBody = await request.text()
  const accountId = session.account.id
  const customerEmail = session.account.email
  const idempotencyScope = `checkout:package:${pkg.id}:${pkg.slug}:${accountId}`

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

    // SAAS-PIVOT Epic 6 Day 6 — derive owning teacher account from
    // the package. lesson_packages.teacher_id was backfilled in mig 0083
    // and Day-4 mig 0076b enforces NOT NULL, so this is reliable;
    // bootstrap fallback covers fresh-DB / test scenarios where the
    // package was created without a teacher_id.
    const teacherAccountId = await deriveTeacherAccountIdForOrder({
      packageId: pkg.id,
      packageSlug: pkg.slug,
    })
    if (!teacherAccountId) {
      return {
        status: 500,
        body: {
          error: 'teacher_resolution_failed',
          message: 'Не удалось определить учителя пакета.',
        },
      }
    }

    // SAAS-PIVOT security-audit HIGH-2 round-1 BLOCKER#2 closure
    // (2026-05-23). The create-side gate on POST /api/teacher/packages
    // refuses NEW packages by non-plan-4 teachers, but does not retire
    // packages an non-plan-4 teacher might already own from before
    // the gate landed (or that they shipped in a window where their
    // subscription state flipped). Mirror the gate the audit demands
    // on every money writer: refuse the BUY here if the owning teacher
    // is non-plan-4. Same 422 `plan_4_required` contract as
    // /api/teacher/packages POST + the SBP / charge-token surfaces.
    const isPlan4 = await isOperatorManagedTeacher(teacherAccountId)
    if (!isPlan4) {
      return {
        status: 422,
        body: {
          error: 'plan_4_required',
          message:
            'Этот учитель не использует платформенную оплату. Оплатите занятия напрямую учителю.',
        },
      }
    }

    const receiptTokenPair = mintToken()

    // PKG-LEARNER-BUY LBL.0 — race-safe gate + INSERT. The lock is keyed
    // by (accountId, durationMinutes) so two parallel POSTs from the
    // same learner for packages of the same duration serialise; the
    // loser observes the winner's pending order and gets 409
    // pending_package_in_flight. Different-duration purchases proceed
    // concurrently.
    //
    // PKG-ADMIN-GRANT epic-end paranoia BLOCKER #1 (2026-05-16): shared
    // `pkg-stack:` prefix lines this lock up with the admin-grant flow
    // so a concurrent operator grant + learner buy on the same
    // (account, duration) serialise against each other. Previous
    // `pkg-buy:` prefix let the two flows run in parallel and a
    // duplicate package_purchases row could appear when the learner's
    // webhook grant fired AFTER the admin grant had already committed.
    const pool = getDbPool()
    const lockClient = await pool.connect()
    try {
      await lockClient.query('begin')
      await lockClient.query(
        `select pg_advisory_xact_lock(hashtextextended('pkg-stack:' || $1 || ':' || $2, 0))`,
        [accountId, pkg.durationMinutes],
      )

      // Gate 1: pending order in the last 15 min for the same
      // (account, duration, teacher)? PKG-TEACHER-SCOPE: per-pair gate.
      const hasPending = await accountHasPendingPackageGrantForDuration(
        accountId,
        pkg.durationMinutes,
        pkg.teacherId,
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
      // duration with units remaining? PKG-TEACHER-SCOPE: scoped to
      // pkg.teacherId so the gate applies per-pair (teacher, learner),
      // not globally per-learner — buying from teacher B when you
      // already have an active package from teacher A is allowed.
      const ownedActive = await learnerHasActivePackageOfDuration(
        accountId,
        pkg.durationMinutes,
        pkg.teacherId,
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
            receipt, metadata, receipt_token_hash, teacher_account_id)
         values ($1, $2, 'RUB', $3, $4, $5,
                 now(), now(),
                 case when $5 = 'paid' then now() else null end,
                 $6, $6,
                 $7::jsonb, $8::jsonb, $9, $10::uuid)`,
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
          teacherAccountId,
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
