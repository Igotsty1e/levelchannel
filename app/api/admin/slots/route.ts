import { NextResponse } from 'next/server'

import { requireAdminRole } from '@/lib/auth/guards'
import {
  type CreateSlotInput,
  createSlot,
  listAllSlotsForAdmin,
} from '@/lib/scheduling/slots'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

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
  return NextResponse.json({ slots }, { status: 200, headers: noStore })
}

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'admin:slots:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400, headers: noStore },
    )
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Body must be a JSON object.' },
      { status: 400, headers: noStore },
    )
  }
  const raw = body as Record<string, unknown>
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
      { status: 400, headers: noStore },
    )
  }

  try {
    const slot = await createSlot(input as CreateSlotInput)
    return NextResponse.json({ slot }, { status: 201, headers: noStore })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    if (msg.includes('lesson_slots_teacher_start_unique')) {
      return NextResponse.json(
        { error: 'У этого учителя уже есть слот в это время.' },
        { status: 409, headers: noStore },
      )
    }
    return NextResponse.json(
      { error: msg },
      { status: 400, headers: noStore },
    )
  }
}
