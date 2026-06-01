import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import {
  grantLearnerTariffAccess,
  revokeLearnerTariffAccess,
} from '@/lib/billing/learner-tariff-access'
import { lookupSession, SESSION_COOKIE_NAME } from '@/lib/auth/sessions'
import { listAccountRoles } from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// T3 Sub-PR D (2026-06-02) — teacher-side junction CRUD.
//
// POST /api/teacher/tariffs/[id]/access — grant (or re-grant) access
// for ONE learner. Body: `{ learnerId, overrideAmountKopecks? }`.
//
// DELETE /api/teacher/tariffs/[id]/access?learnerId=<uuid> — revoke.
//
// Plan: docs/plans/tariffs-packages-learner-scope.md §API surface +
// §"R2-self #13" (bulk path validates first; this endpoint is the
// single-learner shape — bulk PATCH /learners variant lands later).
//
// Auth: caller must be the teacher who owns the tariff. The DB
// ownership trigger enforces this redundantly; the route's role
// check fail-fasts on session-level role.

async function readSessionAndTeacher(
  request: Request,
): Promise<{ teacherId: string } | { error: NextResponse }> {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const m = cookieHeader.match(
    new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]+)`),
  )
  const cookieValue = m ? decodeURIComponent(m[1]) : null
  if (!cookieValue) {
    return {
      error: NextResponse.json(
        { error: 'not_authenticated' },
        { status: 401, headers: NO_STORE },
      ),
    }
  }
  const session = await lookupSession(cookieValue)
  if (!session) {
    return {
      error: NextResponse.json(
        { error: 'not_authenticated' },
        { status: 401, headers: NO_STORE },
      ),
    }
  }
  const roles = await listAccountRoles(session.account.id)
  if (!roles.includes('teacher')) {
    return {
      error: NextResponse.json(
        { error: 'wrong_role' },
        { status: 403, headers: NO_STORE },
      ),
    }
  }
  return { teacherId: session.account.id }
}

async function assertTeacherOwnsTariff(
  teacherId: string,
  tariffId: string,
): Promise<boolean> {
  const r = await getDbPool().query<{ teacher_id: string | null }>(
    `select teacher_id from pricing_tariffs where id = $1`,
    [tariffId],
  )
  return r.rows[0]?.teacher_id === teacherId
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tariffId } = await params
  if (!UUID_PATTERN.test(tariffId)) {
    return NextResponse.json(
      { error: 'invalid_tariff_id' },
      { status: 400, headers: NO_STORE },
    )
  }
  const auth = await readSessionAndTeacher(request)
  if ('error' in auth) return auth.error
  if (!(await assertTeacherOwnsTariff(auth.teacherId, tariffId))) {
    return NextResponse.json(
      { error: 'tariff_not_owned' },
      { status: 404, headers: NO_STORE },
    )
  }
  let body: { learnerId?: string; overrideAmountKopecks?: number | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 400, headers: NO_STORE },
    )
  }
  const learnerId = body.learnerId
  if (!learnerId || !UUID_PATTERN.test(learnerId)) {
    return NextResponse.json(
      { error: 'invalid_learner_id' },
      { status: 400, headers: NO_STORE },
    )
  }
  const override =
    body.overrideAmountKopecks === undefined
      ? null
      : body.overrideAmountKopecks
  if (
    override !== null &&
    (typeof override !== 'number' || override < 100 || override > 100_000_000)
  ) {
    return NextResponse.json(
      { error: 'invalid_override_amount' },
      { status: 400, headers: NO_STORE },
    )
  }
  try {
    const granted = await grantLearnerTariffAccess(null, {
      teacherId: auth.teacherId,
      learnerAccountId: learnerId,
      tariffId,
      overrideAmountKopecks: override,
      grantedByAccountId: auth.teacherId,
    })
    return NextResponse.json(
      { ok: true, access: granted },
      { status: 200, headers: NO_STORE },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/no active link/.test(msg)) {
      return NextResponse.json(
        { error: 'learner_unlinked' },
        { status: 409, headers: NO_STORE },
      )
    }
    if (/owned by/.test(msg)) {
      return NextResponse.json(
        { error: 'tariff_not_owned' },
        { status: 404, headers: NO_STORE },
      )
    }
    throw e
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tariffId } = await params
  if (!UUID_PATTERN.test(tariffId)) {
    return NextResponse.json(
      { error: 'invalid_tariff_id' },
      { status: 400, headers: NO_STORE },
    )
  }
  const auth = await readSessionAndTeacher(request)
  if ('error' in auth) return auth.error
  if (!(await assertTeacherOwnsTariff(auth.teacherId, tariffId))) {
    return NextResponse.json(
      { error: 'tariff_not_owned' },
      { status: 404, headers: NO_STORE },
    )
  }
  const url = new URL(request.url)
  const learnerId = url.searchParams.get('learnerId')
  if (!learnerId || !UUID_PATTERN.test(learnerId)) {
    return NextResponse.json(
      { error: 'invalid_learner_id' },
      { status: 400, headers: NO_STORE },
    )
  }
  const revoked = await revokeLearnerTariffAccess(null, {
    teacherId: auth.teacherId,
    learnerAccountId: learnerId,
    tariffId,
  })
  return NextResponse.json(
    { ok: true, revoked: revoked !== null },
    { status: 200, headers: NO_STORE },
  )
}
