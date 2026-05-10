import { NextResponse } from 'next/server'

import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  type CreateSlotInput,
  createSlot,
  listAllSlotsForAdmin,
  SlotTeacherRoleError,
} from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'admin:slots:ip', 60, 60_000)
  if (rl) return rl
  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const slots = await listAllSlotsForAdmin({
    status:
      status === 'open' || status === 'booked' || status === 'cancelled'
        ? status
        : 'all',
    fromIso: url.searchParams.get('from') ?? undefined,
    toIso: url.searchParams.get('to') ?? undefined,
  })
  return NextResponse.json({ slots }, { status: 200, headers: NO_STORE })
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:slots:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response
  const raw = parsed.body
  const input: Partial<CreateSlotInput> = {}
  if (typeof raw.teacherAccountId === 'string') {
    input.teacherAccountId = raw.teacherAccountId
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
    typeof input.teacherAccountId !== 'string' ||
    typeof input.startAt !== 'string' ||
    typeof input.durationMinutes !== 'number'
  ) {
    return NextResponse.json(
      { error: 'teacherAccountId, startAt, durationMinutes are required.' },
      { status: 400, headers: NO_STORE },
    )
  }

  try {
    const slot = await createSlot(input as CreateSlotInput)
    return NextResponse.json({ slot }, { status: 201, headers: NO_STORE })
  } catch (err) {
    if (err instanceof SlotTeacherRoleError) {
      // Codex 2026-05-08 (MEDIUM-LOW) — target account does not have
      // the `teacher` role. Surface as 400 with a translated message.
      return NextResponse.json(
        {
          error:
            'Этот аккаунт не зарегистрирован как преподаватель. Сначала выдайте роль teacher.',
        },
        { status: 400, headers: NO_STORE },
      )
    }
    const msg = err instanceof Error ? err.message : 'unknown'
    if (msg.includes('lesson_slots_teacher_start_unique')) {
      return NextResponse.json(
        { error: 'У этого учителя уже есть слот в это время.' },
        { status: 409, headers: NO_STORE },
      )
    }
    // lib/scheduling/slots.ts intentionally throws `slot/<field>/<reason>`
    // for known input-validation failures (Codex 2026-05-10 round 2 —
    // BLOCK on 4xx-as-500 regression). Pass these through as 400 with
    // the stable code in `error`.
    if (msg.startsWith('slot/')) {
      return NextResponse.json(
        { error: msg },
        { status: 400, headers: NO_STORE },
      )
    }
    console.warn('[admin.slots.create] unexpected error', { error: msg })
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
