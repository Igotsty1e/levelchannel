import { NextResponse } from 'next/server'

import { requireTeacherAndVerified } from '@/lib/auth/guards'
import { moveOpenSlotByTeacher } from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

type RouteParams = { params: Promise<{ id: string }> }

// Wave C — teacher-owned move. Mirrors the admin variant but the
// data layer's atomic UPDATE WHERE clause includes
// `teacher_account_id = session.account.id`, so a teacher cannot
// move another teacher's slot even with a guessed UUID. The route
// returns 403 not_owner to make the failure mode auditable.

const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params

  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'teacher:slots:move:ip', 60, 60_000)
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  // Move requires a body (newStartAt). Empty body → 400 below.
  // Malformed body → 400 here so we don't pass garbage downstream.
  let body: unknown = {}
  const raw = await request.text().catch(() => '')
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body.' },
        { status: 400, headers: NO_STORE },
      )
    }
  }
  const newStartAt =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<string, unknown>).newStartAt === 'string'
      ? ((body as Record<string, unknown>).newStartAt as string)
      : null

  if (!newStartAt || !ISO_INSTANT_PATTERN.test(newStartAt)) {
    return NextResponse.json(
      { error: 'bad_new_start_at', message: 'newStartAt must be an ISO instant.' },
      { status: 400, headers: NO_STORE },
    )
  }

  // Mirror DB invariants in JS for structured 400s.
  const startMs = Date.parse(newStartAt)
  if (Number.isNaN(startMs)) {
    return NextResponse.json(
      { error: 'bad_new_start_at' },
      { status: 400, headers: NO_STORE },
    )
  }
  const mskWall = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(startMs))
  const mskParts: Record<string, number> = {}
  for (const p of mskWall) {
    if (p.type === 'literal') continue
    mskParts[p.type] = Number(p.value)
  }
  const mskHour = mskParts.hour === 24 ? 0 : mskParts.hour
  const mskMinute = mskParts.minute
  const mskSecond = mskParts.second

  if (mskHour < 6 || mskHour > 22 || (mskHour === 22 && mskMinute > 0)) {
    return NextResponse.json(
      {
        error: 'slot/start_out_of_band',
        message: 'Slot start must be 06:00–22:00 MSK.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  if ((mskMinute !== 0 && mskMinute !== 30) || mskSecond !== 0) {
    return NextResponse.json(
      {
        error: 'slot/start_not_30min_aligned',
        message: 'Slot start must be on a 30-min boundary in MSK.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const result = await moveOpenSlotByTeacher(id, newStartAt, guard.account.id)
    if (result.ok) {
      return NextResponse.json(
        { slot: result.slot },
        { status: 200, headers: NO_STORE },
      )
    }
    if (result.reason === 'not_found') {
      return NextResponse.json(
        { error: 'not_found' },
        { status: 404, headers: NO_STORE },
      )
    }
    if (result.reason === 'not_owner') {
      return NextResponse.json(
        {
          error: 'not_owner',
          message: 'Этот слот не принадлежит вашему аккаунту.',
        },
        { status: 403, headers: NO_STORE },
      )
    }
    if (result.reason === 'slot_collision') {
      return NextResponse.json(
        {
          error: 'slot_collision',
          message: 'У вас уже есть слот на это время.',
        },
        { status: 409, headers: NO_STORE },
      )
    }
    // not_open
    return NextResponse.json(
      {
        error: 'not_open',
        message:
          'Перемещать можно только свободные слоты. Забронированный — отмените и создайте новый.',
      },
      { status: 409, headers: NO_STORE },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    if (msg.includes('lesson_slots_within_msk_day')) {
      return NextResponse.json(
        { error: 'slot/cross_midnight' },
        { status: 400, headers: NO_STORE },
      )
    }
    // Codex 2026-05-08 review fix: unknown errors → 500. The
    // structured 4xx cases above are the only client-error mappings.
    console.error('[teacher.slots.move] unexpected error', err)
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
