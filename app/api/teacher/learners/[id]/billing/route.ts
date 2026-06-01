// PATCH /api/teacher/learners/[id]/billing
// Body: { method: 'postpaid' | 'prepaid_packages' | 'none' }
//
// Authorization: caller must be the teacher of this learner (via
// learner_teacher_links.teacher_account_id = currentTeacher, unlinked_at
// IS NULL). Q5 в spec'е — только учитель, no admin override.
//
// Errors:
//   401 — anonymous / no teacher role
//   403 — not the teacher of this learner
//   404 — learner not found OR no active link
//   409 — { error: 'debt_open' } если переключение postpaid→packages
//         с открытым postpaid-долгом (Q1 invariant в helper)
//   422 — invalid method value

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { listAccountRoles } from '@/lib/auth/accounts'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import {
  setPaymentMethodForPair,
  type PaymentMethod,
} from '@/lib/billing/learner-payment-method'
import { getDbPool } from '@/lib/db/pool'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_METHODS: ReadonlyArray<PaymentMethod> = [
  'postpaid',
  'prepaid_packages',
  'none',
]

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
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const current = await lookupSession(cookieValue)
  if (!current) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const roles = await listAccountRoles(current.account.id)
  if (!roles.includes('teacher')) {
    return NextResponse.json({ error: 'not_teacher' }, { status: 403 })
  }

  const { id: learnerId } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(learnerId)) {
    return NextResponse.json({ error: 'invalid_learner_id' }, { status: 422 })
  }

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 422 })
  }
  const method = (body as { method?: unknown })?.method
  if (!isValidMethod(method)) {
    return NextResponse.json(
      { error: 'invalid_method', valid: VALID_METHODS },
      { status: 422 },
    )
  }

  const teacherId = current.account.id
  if (!(await isTeacherOfLearner(teacherId, learnerId))) {
    return NextResponse.json({ error: 'not_your_learner' }, { status: 403 })
  }

  const result = await setPaymentMethodForPair({
    teacherId,
    learnerId,
    method,
    byAccountId: teacherId,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, message: 'Closes postpaid debt before switching to prepaid packages.' },
      { status: 409 },
    )
  }

  return NextResponse.json({
    ok: true,
    previousMethod: result.previousMethod,
    method: result.method,
  })
}
