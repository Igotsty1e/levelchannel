import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { rescheduleSlotByTeacher } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

// teacher-reschedule-ui-wave-b (2026-06-16). Учитель переносит занятие
// с ученика на новое время. Atomic cancel-original + insert-new под
// per-learner advisory lock; учительский reason обязателен (учitель
// должен сказать ученику что произошло). Wave-A dispatch уведомляет
// ученика (email + TG).
//
// Body: { newStartAt: string (ISO), reason: string (>= 5 chars) }

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:slots:reschedule:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const raw = await request.text().catch(() => '')
  let body: unknown = {}
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json(
        { error: 'invalid_json_body', message: 'Invalid JSON body.' },
        { status: 400, headers: NO_STORE },
      )
    }
  }
  const obj =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {}
  const newStartAt = typeof obj.newStartAt === 'string' ? obj.newStartAt : null
  const reasonRaw = typeof obj.reason === 'string' ? obj.reason : null
  if (!newStartAt) {
    return NextResponse.json(
      { error: 'new_start_required' },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const result = await rescheduleSlotByTeacher(
      id,
      guard.account.id,
      newStartAt,
      reasonRaw,
    )
    if (result.ok) {
      return NextResponse.json(
        { oldSlot: result.oldSlot, newSlot: result.newSlot },
        { status: 200, headers: NO_STORE },
      )
    }
    const map: Record<string, { status: number; message: string }> = {
      not_found: { status: 404, message: 'Слот не найден.' },
      not_owner: {
        status: 403,
        message: 'Этот слот не принадлежит вашему аккаунту.',
      },
      already_terminal: {
        status: 409,
        message: 'Слот уже отменён или завершён.',
      },
      in_past: { status: 400, message: 'Новое время должно быть в будущем.' },
      start_out_of_band: {
        status: 400,
        message: 'Время должно быть в рабочем диапазоне 06:00–22:00 МСК.',
      },
      reason_required: {
        status: 400,
        message:
          'Укажите причину — ученик должен понять, что произошло (минимум 5 символов).',
      },
      slot_collision: {
        status: 409,
        message: 'У вас уже есть занятие в это время. Выберите другой час.',
      },
      external_conflict: {
        status: 409,
        message:
          'В Google Календаре есть конфликт на это время. Уберите событие или выберите другой час.',
      },
    }
    const mapped = map[result.reason]
    if (mapped) {
      return NextResponse.json(
        { error: result.reason, message: mapped.message },
        { status: mapped.status, headers: NO_STORE },
      )
    }
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  } catch (err) {
    console.error('[teacher.slots.reschedule] unexpected error', err)
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
