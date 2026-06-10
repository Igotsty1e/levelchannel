import { NextResponse } from 'next/server'

import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'
import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  grantLearnerTariffAccess,
  revokeLearnerTariffAccess,
} from '@/lib/billing/learner-tariff-access'
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
// Plan: docs/plans/tariffs-packages-learner-scope.md §API surface.
//
// 2026-06-02 (security-audit Sub-PR 1, F1 closure): swapped the
// inline session+role check onto the canonical
// `requireTeacherWithCurrentSaasOfferConsent` guard +
// `enforceTrustedBrowserOrigin` + `enforceRateLimit`, matching the
// rest of /api/teacher/* (A1.1 #455). The DB ownership trigger
// enforces tariff↔teacher binding redundantly; the
// `assertTeacherOwnsTariff` SELECT below is the fast 404 path.

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
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(
    request,
    'teacher:tariff-access:ip',
    30,
    60_000,
  )
  if (rl) return rl
  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response
  const teacherId = guard.account.id

  const { id: tariffId } = await params
  if (!UUID_PATTERN.test(tariffId)) {
    return NextResponse.json(
      {
        error: 'invalid_tariff_id',
        message: 'Тариф не найден. Обновите страницу.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!(await assertTeacherOwnsTariff(teacherId, tariffId))) {
    return NextResponse.json(
      {
        error: 'tariff_not_owned',
        message: 'Этот тариф не привязан к вам. Обновите страницу.',
      },
      { status: 404, headers: NO_STORE },
    )
  }
  let body: { learnerId?: string; overrideAmountKopecks?: number | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      {
        error: 'invalid_json',
        message: 'Что-то пошло не так. Попробуйте ещё раз.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  const learnerId = body.learnerId
  if (!learnerId || !UUID_PATTERN.test(learnerId)) {
    return NextResponse.json(
      {
        error: 'invalid_learner_id',
        message:
          'Не получилось определить ученика. Обновите страницу и попробуйте ещё раз.',
      },
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
      {
        error: 'invalid_override_amount',
        message: 'Цена должна быть от 1 ₽ до 1 000 000 ₽.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  try {
    const granted = await grantLearnerTariffAccess(null, {
      teacherId: teacherId,
      learnerAccountId: learnerId,
      tariffId,
      overrideAmountKopecks: override,
      grantedByAccountId: teacherId,
    })
    return NextResponse.json(
      { ok: true, access: granted },
      { status: 200, headers: NO_STORE },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/no active link/.test(msg)) {
      return NextResponse.json(
        {
          error: 'learner_unlinked',
          message:
            'Этот ученик больше не привязан к вам. Откройте список учеников и выпустите новый инвайт.',
        },
        { status: 409, headers: NO_STORE },
      )
    }
    if (/owned by/.test(msg)) {
      return NextResponse.json(
        {
          error: 'tariff_not_owned',
          message: 'Этот тариф не привязан к вам. Обновите страницу.',
        },
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
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate
  const rl = await enforceRateLimit(
    request,
    'teacher:tariff-access:ip',
    30,
    60_000,
  )
  if (rl) return rl
  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response
  const teacherId = guard.account.id

  const { id: tariffId } = await params
  if (!UUID_PATTERN.test(tariffId)) {
    return NextResponse.json(
      {
        error: 'invalid_tariff_id',
        message: 'Тариф не найден. Обновите страницу.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!(await assertTeacherOwnsTariff(teacherId, tariffId))) {
    return NextResponse.json(
      {
        error: 'tariff_not_owned',
        message: 'Этот тариф не привязан к вам. Обновите страницу.',
      },
      { status: 404, headers: NO_STORE },
    )
  }
  const url = new URL(request.url)
  const learnerId = url.searchParams.get('learnerId')
  if (!learnerId || !UUID_PATTERN.test(learnerId)) {
    return NextResponse.json(
      {
        error: 'invalid_learner_id',
        message:
          'Не получилось определить ученика. Обновите страницу и попробуйте ещё раз.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  const revoked = await revokeLearnerTariffAccess(null, {
    teacherId: teacherId,
    learnerAccountId: learnerId,
    tariffId,
  })
  return NextResponse.json(
    { ok: true, revoked: revoked !== null },
    { status: 200, headers: NO_STORE },
  )
}
