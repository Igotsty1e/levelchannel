import { NextResponse } from 'next/server'

import { requireTeacherAndVerified } from '@/lib/auth/guards'
import {
  type CreateSlotInput,
  createSlot,
  SlotTeacherRoleError,
} from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

// Wave C — teacher single-create. Mirrors POST /api/admin/slots but
// gates with `requireTeacherAndVerified` and binds `teacherAccountId`
// from the session, NOT from the request body. The teacher cannot
// create a slot under another teacher's name (the body field is
// IGNORED if present).
//
// Body: { startAt: string, durationMinutes: number, notes?, tariffId? }

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'teacher:slots:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireTeacherAndVerified(request)
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Body must be a JSON object.' },
      { status: 400, headers: NO_STORE },
    )
  }
  const raw = body as Record<string, unknown>

  const input: Partial<CreateSlotInput> = {
    teacherAccountId: guard.account.id, // bound to session; body is ignored
  }
  if (typeof raw.startAt === 'string') input.startAt = raw.startAt
  if (typeof raw.durationMinutes === 'number') {
    input.durationMinutes = raw.durationMinutes
  }
  if (typeof raw.notes === 'string' || raw.notes === null) {
    input.notes = raw.notes as string | null
  }
  if (typeof raw.tariffId === 'string' || raw.tariffId === null) {
    input.tariffId = raw.tariffId as string | null
  }

  if (
    typeof input.startAt !== 'string' ||
    typeof input.durationMinutes !== 'number'
  ) {
    return NextResponse.json(
      { error: 'startAt and durationMinutes are required.' },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const slot = await createSlot(input as CreateSlotInput)
    return NextResponse.json(
      { slot },
      { status: 201, headers: NO_STORE },
    )
  } catch (err) {
    if (err instanceof SlotTeacherRoleError) {
      // Should be unreachable: the guard already pinned `teacher`
      // role; the create function re-verifies as defense in depth.
      // If it fires, treat as a server error rather than a 400 on
      // the user's input — they didn't lie.
      return NextResponse.json(
        { error: 'Внутренняя ошибка проверки роли.' },
        { status: 500, headers: NO_STORE },
      )
    }
    const msg = err instanceof Error ? err.message : 'unknown'
    if (msg.includes('lesson_slots_within_msk_day')) {
      return NextResponse.json(
        { error: 'slot/cross_midnight' },
        { status: 400, headers: NO_STORE },
      )
    }
    if (msg.includes('lesson_slots_start_in_business_hours')) {
      return NextResponse.json(
        { error: 'slot/start_out_of_band' },
        { status: 400, headers: NO_STORE },
      )
    }
    if (msg.includes('lesson_slots_start_30min_aligned')) {
      return NextResponse.json(
        { error: 'slot/start_not_30min_aligned' },
        { status: 400, headers: NO_STORE },
      )
    }
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      return NextResponse.json(
        {
          error: 'slot_collision',
          message: 'У вас уже есть слот на это время.',
        },
        { status: 409, headers: NO_STORE },
      )
    }
    // Codex 2026-05-08 review fix: don't 400 on unknown errors —
    // it conflates DB outages / coding bugs with user-input errors
    // AND leaks raw exception messages to the client. Log and 500.
    console.error('[teacher.slots.create] unexpected error', err)
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
