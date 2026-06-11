// GET /api/teacher/learners/[id]/billing-state
//
// Returns the per-pair billing state the teacher needs to render the
// AssignDirectModal's payment-choice selector (epic-b Sub-PR B.2,
// 2026-06-11):
//   {
//     paymentMethod: 'postpaid' | 'none',
//     postpaidAllowed: boolean,             // method === 'postpaid'
//     activePackages: Array<{
//       id, titleRu, durationMinutes,
//       countRemaining, expiresAt
//     }>,
//   }
//
// Read-only. Same authz model as the PATCH .../billing handler:
// requireTeacherWithCurrentSaasOfferConsent + enforceTrustedBrowserOrigin
// + enforceRateLimit. Pair-ownership re-checked via the same
// `learner_teacher_links` predicate. The endpoint never enumerates
// other teachers' learners or packages.

import { NextResponse } from 'next/server'

import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'
import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { getPaymentMethodForPair } from '@/lib/billing/learner-payment-method'
import { listLearnerPackagesByTeacher } from '@/lib/billing/packages/purchases'
import { getDbPool } from '@/lib/db/pool'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function isTeacherOfLearner(
  teacherId: string,
  learnerId: string,
): Promise<boolean> {
  const pool = getDbPool()
  const r = await pool.query<{ exists: boolean }>(
    `select exists(
       select 1 from learner_teacher_links
        where teacher_account_id = $1::uuid
          and learner_account_id = $2::uuid
          and unlinked_at is null
     ) as exists`,
    [teacherId, learnerId],
  )
  return Boolean(r.rows[0]?.exists)
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(
    request,
    'teacher:learner-billing-state:ip',
    60,
    60_000,
  )
  if (rl) return rl
  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response
  const teacherId = guard.account.id

  const { id: learnerId } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(learnerId)) {
    return NextResponse.json(
      { error: 'invalid_learner_id' },
      { status: 422, headers: NO_STORE },
    )
  }

  if (!(await isTeacherOfLearner(teacherId, learnerId))) {
    return NextResponse.json(
      { error: 'not_your_learner' },
      { status: 403, headers: NO_STORE },
    )
  }

  const [paymentMethod, packages] = await Promise.all([
    getPaymentMethodForPair(teacherId, learnerId),
    listLearnerPackagesByTeacher(teacherId, learnerId),
  ])

  return NextResponse.json(
    {
      paymentMethod,
      postpaidAllowed: paymentMethod === 'postpaid',
      activePackages: packages
        .filter((p) => p.countRemaining > 0)
        .map((p) => ({
          id: p.id,
          titleRu: p.titleRu,
          durationMinutes: p.durationMinutes,
          countRemaining: p.countRemaining,
          // PackagePurchase.expiresAt is already an ISO string (see
          // lib/billing/packages/purchases.ts:44).
          expiresAt: p.expiresAt,
        })),
    },
    { headers: NO_STORE },
  )
}
