import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireLearnerArchetypeAndVerified } from '@/lib/auth/guards'
import {
  getActiveTeacherForLearner,
  getActiveTeacherIdsForLearner,
} from '@/lib/auth/teacher-scope'
import { bookSlot } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


type RouteParams = { params: Promise<{ id: string }> }

// POST /api/slots/[id]/book — learner books an open slot.
// Phase 4 D2: requires authenticated + email verified.
//
// Body is optional. BCS-B.1 adds `{ agenda?: string }` for Calendly-
// confirm comment capture; legacy clients sending empty bodies stay
// supported (agenda → null). Invalid JSON in the body is tolerated —
// we degrade to "no agenda" rather than reject the booking; the
// learner's intent (book this slot) outranks the optional comment.
//
// The atomic UPDATE in the store re-asserts status='open' in WHERE so
// two concurrent POSTs can't both win — the loser gets 409 with a
// friendly hint.

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'slots:book:ip', 30, 60_000)
  if (rl) return rl

  const auth = await requireLearnerArchetypeAndVerified(request)
  if (!auth.ok) return auth.response

  // BCS-B.1 soft body parse — tolerant of empty body or malformed JSON.
  // sanitizeAgenda inside bookSlot defends against over-cap input.
  let agenda: string | null = null
  try {
    const raw = await request.text()
    if (raw && raw.trim().length > 0) {
      const parsed = JSON.parse(raw) as unknown
      if (
        typeof parsed === 'object'
        && parsed !== null
        && !Array.isArray(parsed)
        && typeof (parsed as { agenda?: unknown }).agenda === 'string'
      ) {
        agenda = (parsed as { agenda: string }).agenda
      }
    }
  } catch {
    // Invalid JSON → agenda stays null; do not block the booking.
  }

  // BCS-B.frontend Codex #1: pin booking to learner's assigned teacher
  // so a verified learner who knows a foreign teacher's open slot id
  // cannot book it. The atomic UPDATE inside bookSlot re-asserts
  // teacher_account_id = $expectedTeacherId; a mismatch collapses to
  // the same not_found outcome (no enumeration of foreign slots).
  //
  // BCS-HARDEN-1 (2026-05-14) — the legacy null bypass is closed.
  // When the learner has no active teacher link, refuse the booking
  // at the route layer with a 404 that matches the not_found shape.
  //
  // SAAS-PIVOT Day 2 (2026-05-22) — n:m teacher context (plan §2.5).
  // Multi-link learners must specify `?teacher=<id>` (validated against
  // their link set); a multi-link booking without disambiguation
  // returns 400 needs_teacher_picker so the client can surface the
  // chooser. Zero-link learners still collapse to 404 (no
  // enumeration of the teacher-binding shape). 404 (not 403) on the
  // zero-link branch is deliberate: it matches "this slot doesn't
  // exist for you" and defends against learner-enumeration probes.
  const url = new URL(request.url)
  const teacherFromQuery = url.searchParams.get('teacher')
  const resolved = await getActiveTeacherForLearner(auth.account.id)
  let expectedTeacherId: string | null
  if (resolved.needsPicker) {
    if (!teacherFromQuery) {
      return NextResponse.json(
        {
          error: 'needs_teacher_picker',
          message:
            'У вас несколько учителей. Укажите учителя через параметр ?teacher=<id>.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    const allowed = await getActiveTeacherIdsForLearner(auth.account.id)
    if (!allowed.includes(teacherFromQuery)) {
      return NextResponse.json(
        {
          error: 'needs_teacher_picker',
          message: 'Этот учитель не привязан к вашему аккаунту.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    expectedTeacherId = teacherFromQuery
  } else {
    expectedTeacherId = resolved.teacherId
  }
  if (!expectedTeacherId) {
    return NextResponse.json(
      { error: 'Slot not found.' },
      { status: 404, headers: NO_STORE },
    )
  }

  const result = await bookSlot(id, auth.account.id, 'learner', {
    agenda,
    expectedTeacherId,
  })
  if (result.ok) {
    // BCS-E.worker — fire-and-forget enqueue of the create push job
    // if the teacher has an active/degraded integration. F9″
    // reconcile sweep catches the rare gap if this fails.
    try {
      const { enqueueCreatePushIfIntegrationActive } = await import(
        '@/lib/calendar/push-worker'
      )
      await enqueueCreatePushIfIntegrationActive({
        slotId: result.slot.id,
        teacherAccountId: result.slot.teacherAccountId,
      })
    } catch (e) {
      console.warn('[calendar/book] enqueue push failed:', e)
    }
    return NextResponse.json(
      { slot: result.slot, billing: result.billing },
      { status: 200, headers: NO_STORE },
    )
  }
  if (result.reason === 'not_found') {
    return NextResponse.json(
      { error: 'Slot not found.' },
      { status: 404, headers: NO_STORE },
    )
  }
  if (result.reason === 'in_past') {
    return NextResponse.json(
      { error: 'Это время уже прошло.' },
      { status: 410, headers: NO_STORE },
    )
  }
  if (result.reason === 'self_booking_blocked') {
    return NextResponse.json(
      { error: 'Нельзя записаться на занятие, где вы числитесь преподавателем.' },
      { status: 403, headers: NO_STORE },
    )
  }
  // Billing wave PR 1 — new failure shapes.
  if (result.reason === 'package_required') {
    return NextResponse.json(
      {
        error: 'package_required',
        message: 'Чтобы записаться, купите пакет занятий.',
        availablePackages: result.availablePackages ?? [],
      },
      { status: 402, headers: NO_STORE },
    )
  }
  if (result.reason === 'tariff_required') {
    return NextResponse.json(
      {
        error: 'tariff_required',
        message:
          'У этого занятия не указана цена. Свяжитесь с оператором.',
      },
      { status: 402, headers: NO_STORE },
    )
  }
  if (result.reason === 'pending_package_grant') {
    return NextResponse.json(
      {
        error: 'pending_package_grant',
        message:
          'У вас оформляется пакет — подождите минуту и обновите.',
      },
      { status: 409, headers: NO_STORE },
    )
  }
  if (result.reason === 'external_conflict') {
    return NextResponse.json(
      {
        error: 'external_conflict',
        message:
          'Это время занято у учителя в его внешнем календаре. Выберите другое время.',
      },
      { status: 409, headers: NO_STORE },
    )
  }
  // not_open — race with another booking or operator-side state change.
  return NextResponse.json(
    { error: 'Это время только что забронировал кто-то другой. Обновите список.' },
    { status: 409, headers: NO_STORE },
  )
}
