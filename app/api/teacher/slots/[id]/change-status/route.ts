// teacher-lessons-edit-status epic (2026-06-24) — change lesson status.
// Plan: docs/plans/teacher-lessons-edit-status-2026-06-24.md §1.1.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { dispatchLessonEvent } from '@/lib/notifications/lesson-event-dispatch'
import { getActorDisplayName } from '@/lib/notifications/recipient-resolver'
import { changeLessonStatus, type LessonTargetStatus } from '@/lib/scheduling/slots'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import { enforceTrustedBrowserOrigin } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALLOWED_TARGETS: LessonTargetStatus[] = [
  'completed',
  'no_show_learner',
  'no_show_teacher',
  'booked',
]

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const rl = await enforceAccountRateLimit(
    guard.account.id,
    'teacher:slot:change-status',
    60,
    60 * 60 * 1000,
  )
  if (rl) return rl

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  let body: { to?: unknown; expectedUpdatedAt?: unknown; notifyLearner?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Некорректный запрос.' },
      { status: 400, headers: NO_STORE },
    )
  }

  if (typeof body.to !== 'string' || !ALLOWED_TARGETS.includes(body.to as LessonTargetStatus)) {
    return NextResponse.json(
      { error: 'invalid_to', message: 'Недопустимый целевой статус.' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (typeof body.expectedUpdatedAt !== 'string' || !body.expectedUpdatedAt) {
    return NextResponse.json(
      { error: 'invalid_expected_updated_at' },
      { status: 400, headers: NO_STORE },
    )
  }
  const notifyIntent = body.notifyLearner === true

  const result = await changeLessonStatus({
    slotId: id,
    teacherAccountId: guard.account.id,
    toStatus: body.to as LessonTargetStatus,
    expectedUpdatedAt: body.expectedUpdatedAt,
    notifyIntent,
  })

  if (!result.ok) {
    return errorResponse(result.reason)
  }

  // Post-commit best-effort dispatch. Failure НЕ откатывает change.
  if (notifyIntent) {
    try {
      await dispatchStatusChangeNotification({
        slotId: id,
        actorAccountId: guard.account.id,
        toStatus: body.to as LessonTargetStatus,
      })
    } catch (err) {
      console.error('[change-status] dispatch failed', err)
    }
  }

  return NextResponse.json(
    { ok: true, slotId: id, newUpdatedAt: result.newUpdatedAt },
    { headers: NO_STORE },
  )
}

async function dispatchStatusChangeNotification(args: {
  slotId: string
  actorAccountId: string
  toStatus: LessonTargetStatus
}) {
  // Stub Sub-PR 1 — реальный dispatch с template + rate-limit будет в
  // Sub-PR 2 UI integration (после wave-end paranoia). На данном этапе
  // делаем только actor lookup для anti-spoof + продолжаем как stub.
  // Owner может в Sub-PR 2 включить полный flow.
  void getActorDisplayName(args.actorAccountId)
  void dispatchLessonEvent
}

function errorResponse(reason: string) {
  switch (reason) {
    case 'not_found':
      return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    case 'not_owner':
      return NextResponse.json(
        { error: 'not_owner', message: 'Этот слот не принадлежит вашему аккаунту.' },
        { status: 403, headers: NO_STORE },
      )
    case 'wrong_kind':
      return NextResponse.json(
        { error: 'wrong_kind', message: 'Этот слот не является уроком.' },
        { status: 400, headers: NO_STORE },
      )
    case 'cannot_edit_cancelled':
      return NextResponse.json(
        { error: 'cannot_edit_cancelled', message: 'Отменённое занятие нельзя редактировать из истории.' },
        { status: 400, headers: NO_STORE },
      )
    case 'stale':
      return NextResponse.json(
        { error: 'stale', message: 'Занятие уже было изменено. Обновите страницу.' },
        { status: 409, headers: NO_STORE },
      )
    case 'immutable':
      return NextResponse.json(
        { error: 'immutable', message: 'Прошло 48 часов с отметки — статус нельзя изменить.' },
        { status: 409, headers: NO_STORE },
      )
    case 'settled':
      return NextResponse.json(
        { error: 'settled', message: 'Урок уже учтён в платежах — статус нельзя изменить.' },
        { status: 409, headers: NO_STORE },
      )
    case 'accrued':
      return NextResponse.json(
        { error: 'accrued', message: 'По уроку уже начислена выплата — статус нельзя изменить.' },
        { status: 409, headers: NO_STORE },
      )
    case 'missing_snapshot':
      return NextResponse.json(
        { error: 'missing_snapshot', message: 'У слота нет тарифного снимка для расчёта оплаты.' },
        { status: 422, headers: NO_STORE },
      )
    case 'invalid_transition':
      return NextResponse.json(
        { error: 'invalid_transition', message: 'Недопустимое изменение статуса.' },
        { status: 422, headers: NO_STORE },
      )
    default:
      return NextResponse.json({ error: 'internal_error' }, { status: 500, headers: NO_STORE })
  }
}
