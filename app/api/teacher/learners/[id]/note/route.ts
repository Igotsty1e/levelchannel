// Epic C — учительская заметка о ученике: PATCH endpoint.
//
// Plan: docs/plans/clever-sprouting-floyd.md Epic C.
//
// PATCH /api/teacher/learners/{learnerId}/note
//   Body: { note: string | null }
//   Auth: requireTeacherWithCurrentSaasOfferConsent + UUID format check
//         + helper-side учитель-учения проверка (см. upsertLearnerTeacherNote).
//
// Не GET — заметка возвращается со страницы профиля SSR'ом, отдельный
// GET роут не нужен (страница и так делает 6 параллельных запросов).
//
// Per-teacher: учительский id берётся ТОЛЬКО из session. learnerId из
// URL. Body validation: note должен быть string или null; max 2000 char.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  MAX_TEACHER_NOTE_LENGTH,
  upsertLearnerTeacherNote,
} from '@/lib/learners/teacher-note'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import { enforceTrustedBrowserOrigin } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id: learnerId } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  // 30/час: typing & save — пакетная редакция допустима. Burst-friendly.
  const rl = await enforceAccountRateLimit(
    guard.account.id,
    'teacher:learner-note',
    30,
    60 * 60 * 1000,
  )
  if (rl) return rl

  if (!UUID_PATTERN.test(learnerId)) {
    return NextResponse.json(
      { error: 'not_found' },
      { status: 404, headers: NO_STORE },
    )
  }

  const parsed = await readJsonObjectOr400(request, { coded: true })
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  if (!('note' in body)) {
    return NextResponse.json(
      {
        error: 'invalid_body',
        message: 'Поле note обязательно (string или null).',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  const rawNote = body.note
  if (rawNote !== null && typeof rawNote !== 'string') {
    return NextResponse.json(
      {
        error: 'invalid_body',
        message: 'Поле note должно быть строкой или null.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  if (typeof rawNote === 'string' && rawNote.length > MAX_TEACHER_NOTE_LENGTH) {
    return NextResponse.json(
      {
        error: 'note_too_long',
        message: `Длина заметки не должна превышать ${MAX_TEACHER_NOTE_LENGTH} символов.`,
      },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await upsertLearnerTeacherNote(
    guard.account.id,
    learnerId,
    rawNote,
  )

  if (!result.ok) {
    if (result.reason === 'not_linked') {
      return NextResponse.json(
        { error: 'not_found' },
        { status: 404, headers: NO_STORE },
      )
    }
    if (result.reason === 'note_too_long') {
      return NextResponse.json(
        {
          error: 'note_too_long',
          message: `Длина заметки не должна превышать ${MAX_TEACHER_NOTE_LENGTH} символов.`,
        },
        { status: 400, headers: NO_STORE },
      )
    }
  }

  return NextResponse.json(
    { ok: true, note: result.ok ? result.note : null },
    { headers: NO_STORE },
  )
}
