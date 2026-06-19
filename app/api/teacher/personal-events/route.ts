// Epic B (2026-06-19) — POST /api/teacher/personal-events.
//
// Plan: docs/plans/clever-sprouting-floyd.md Epic B.
//
// Body: { startAt: ISO, durationMinutes: int 15..180, title: string<=80,
//         body?: string<=2000 }
// Auth: requireTeacherWithCurrentSaasOfferConsent.
// Rate-limit: 60/час/account.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  MAX_PERSONAL_EVENT_BODY_LEN,
  MAX_PERSONAL_EVENT_TITLE_LEN,
  createPersonalEvent,
} from '@/lib/scheduling/slots'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import { enforceTrustedBrowserOrigin } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const rl = await enforceAccountRateLimit(
    guard.account.id,
    'teacher:personal-event:create',
    60,
    60 * 60 * 1000,
  )
  if (rl) return rl

  const parsed = await readJsonObjectOr400(request, { coded: true })
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  if (typeof body.startAt !== 'string') {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Поле startAt обязательно (ISO).' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (typeof body.durationMinutes !== 'number') {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Поле durationMinutes обязательно (15..180).' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (typeof body.title !== 'string') {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Поле title обязательно.' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (body.title.length > MAX_PERSONAL_EVENT_TITLE_LEN) {
    return NextResponse.json(
      {
        error: 'title_too_long',
        message: `Длина названия — до ${MAX_PERSONAL_EVENT_TITLE_LEN} символов.`,
      },
      { status: 400, headers: NO_STORE },
    )
  }
  if (
    body.body !== undefined &&
    body.body !== null &&
    typeof body.body !== 'string'
  ) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Поле body должно быть строкой.' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (typeof body.body === 'string' && body.body.length > MAX_PERSONAL_EVENT_BODY_LEN) {
    return NextResponse.json(
      {
        error: 'body_too_long',
        message: `Длина заметки — до ${MAX_PERSONAL_EVENT_BODY_LEN} символов.`,
      },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await createPersonalEvent(guard.account.id, {
    startAt: body.startAt,
    durationMinutes: body.durationMinutes,
    title: body.title,
    body: typeof body.body === 'string' ? body.body : null,
  })

  if (!result.ok) {
    if (result.reason === 'conflict') {
      return NextResponse.json(
        {
          error: 'slot_conflict',
          message:
            'На это время уже есть другой слот — выберите другое время или удалите занятый.',
        },
        { status: 409, headers: NO_STORE },
      )
    }
    return NextResponse.json(
      { error: result.reason, message: 'Не удалось создать дело.' },
      { status: 400, headers: NO_STORE },
    )
  }

  return NextResponse.json(
    { ok: true, slot: result.slot },
    { status: 201, headers: NO_STORE },
  )
}
