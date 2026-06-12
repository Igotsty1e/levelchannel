// PATCH /api/teacher/learners/[id]/billing
// Body: { method: 'postpaid' | 'none' }
//        (epic-b Sub-PR B.1, 2026-06-11: dropped 'prepaid_packages';
//         mix billing = method='postpaid' tries package consume first
//         and falls back to postpaid debt.)
//
// Authorization: caller must be the teacher of this learner (via
// learner_teacher_links.teacher_account_id = currentTeacher, unlinked_at
// IS NULL). Q5 в spec'е — только учитель, no admin override.
//
// Errors:
//   401 — anonymous / no teacher role
//   403 — not the teacher of this learner
//   404 — learner not found OR no active link
//   422 — invalid method value
//
// 2026-06-02 (security-audit Sub-PR 1, F1 closure): swapped the
// inline session+role check onto the canonical
// `requireTeacherWithCurrentSaasOfferConsent` guard +
// `enforceTrustedBrowserOrigin` + `enforceRateLimit`, matching the
// rest of /api/teacher/* (A1.1 #455).

import { NextResponse } from 'next/server'

import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'
import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  setPaymentMethodForPair,
  type PaymentMethod,
} from '@/lib/billing/learner-payment-method'
import { getDbPool } from '@/lib/db/pool'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// epic-b Sub-PR B.1 (2026-06-11): dropped 'prepaid_packages'.
const VALID_METHODS: ReadonlyArray<PaymentMethod> = ['postpaid', 'none']

function isValidMethod(value: unknown): value is PaymentMethod {
  return (
    typeof value === 'string'
    && (VALID_METHODS as ReadonlyArray<string>).includes(value)
  )
}

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

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(
    request,
    'teacher:learner-billing:ip',
    30,
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

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 422, headers: NO_STORE },
    )
  }
  const method = (body as { method?: unknown })?.method
  if (!isValidMethod(method)) {
    return NextResponse.json(
      { error: 'invalid_method', valid: VALID_METHODS },
      { status: 422, headers: NO_STORE },
    )
  }

  if (!(await isTeacherOfLearner(teacherId, learnerId))) {
    return NextResponse.json(
      { error: 'not_your_learner' },
      { status: 403, headers: NO_STORE },
    )
  }

  const result = await setPaymentMethodForPair({
    teacherId,
    learnerId,
    method,
    byAccountId: teacherId,
  })

  return NextResponse.json(
    {
      previousMethod: result.previousMethod,
      method: result.method,
      ok: true,
    },
    { headers: NO_STORE },
  )
}
