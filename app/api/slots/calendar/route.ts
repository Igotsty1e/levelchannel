import { NextResponse } from 'next/server'

import { listAccountRoles } from '@/lib/auth/accounts'
import { requireAuthenticated } from '@/lib/auth/guards'
import { isValidYmd, mskMidnightUtc, ymdDaysDiff } from '@/lib/calendar/dates'
import {
  type CalendarResponse,
  type CalendarSlot,
  pickActiveCalendarRole,
} from '@/lib/calendar/types'
import { listSlotsForCalendarRange } from '@/lib/scheduling/slots'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

// Wave A — calendar range query for the operator + read-only teacher
// surfaces (Wave B will add learner-side projection branches).
//
// Auth matrix per `pickActiveCalendarRole(roles[])`:
//   - admin → any teacherId
//   - teacher → only own session.account.id
//   - learner → only own session.account.assignedTeacherId (Wave B)
//
// Range guard:
//   - `from` and `to` MUST be `YYYY-MM-DD` format (no ISO timestamps,
//     no slashed dates, no words)
//   - `to - from` MUST equal exactly 7 days (a single MSK week)
//   - `teacherId` MUST be a UUID
//
// DTO projection per role: see `lib/calendar/types.ts` discriminated
// union. Every kind has a fixed field set — no optional/undefined
// fields on shape; absence is part of the type.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? ''
  const teacherId = url.searchParams.get('teacherId') ?? ''

  // 1. Range params — strict YYYY-MM-DD
  if (!isValidYmd(from)) {
    return NextResponse.json(
      { error: 'bad_from_format', message: 'from must be YYYY-MM-DD' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!isValidYmd(to)) {
    return NextResponse.json(
      { error: 'bad_to_format', message: 'to must be YYYY-MM-DD' },
      { status: 400, headers: NO_STORE },
    )
  }
  const days = ymdDaysDiff(from, to)
  if (days !== 7) {
    return NextResponse.json(
      { error: 'bad_range', message: 'to - from must equal exactly 7 days' },
      { status: 400, headers: NO_STORE },
    )
  }

  // 2. teacherId — UUID
  if (!UUID_PATTERN.test(teacherId)) {
    return NextResponse.json(
      { error: 'bad_teacher_id', message: 'teacherId must be a UUID' },
      { status: 400, headers: NO_STORE },
    )
  }

  // 3. Auth matrix — role precedence + teacherId binding
  const roles = await listAccountRoles(auth.account.id)
  const activeRole = pickActiveCalendarRole(roles)
  if (!activeRole) {
    return NextResponse.json(
      { error: 'wrong_role', message: 'No calendar-eligible role on account.' },
      { status: 403, headers: NO_STORE },
    )
  }

  if (activeRole === 'teacher') {
    if (teacherId !== auth.account.id) {
      return NextResponse.json(
        { error: 'teacher_id_mismatch', message: 'Teacher can only view own calendar.' },
        { status: 403, headers: NO_STORE },
      )
    }
  } else if (activeRole === 'learner') {
    // Wave A guard: learner role exists but the calendar surface is
    // not yet wired in /cabinet (that's Wave B). The auth-matrix
    // contract is pinned now so Wave B inherits it without rework.
    const assigned = auth.account.assignedTeacherId
    if (!assigned || teacherId !== assigned) {
      return NextResponse.json(
        { error: 'teacher_id_mismatch', message: 'Learner can only view assigned teacher.' },
        { status: 403, headers: NO_STORE },
      )
    }
  }
  // admin: any teacherId allowed.

  // 4. Range → MSK midnight UTC instants
  const fromIso = mskMidnightUtc(from)
  const toIso = mskMidnightUtc(to)
  if (!fromIso || !toIso) {
    // Unreachable given isValidYmd above, but defensive.
    return NextResponse.json(
      { error: 'bad_range' },
      { status: 400, headers: NO_STORE },
    )
  }

  // 5. Fetch slots
  const slots = await listSlotsForCalendarRange({ teacherId, fromIso, toIso })

  // 6. Project to discriminated DTO per role.
  // Wave 14 #1 — cancelled slots are excluded from the calendar
  // surface entirely. Operator workflow: create slot → cancel → put
  // a slot back at the same time. Without this filter the cancelled
  // row kept rendering as "Прошедшее" forever, even after migration
  // 0035 freed the (teacher,start_at) UNIQUE cell. The cancelled
  // row stays in the DB for audit and is reachable via /admin/slots
  // list view; calendar = clean "what's happening" view.
  const calendarSlots: CalendarSlot[] = slots
    .filter((s) => s.status !== 'cancelled')
    .map((s) => projectSlot(s, activeRole, auth.account.id))

  const response: CalendarResponse = {
    slots: calendarSlots,
    rangeStart: fromIso,
    rangeEnd: toIso,
    teacherId,
    generatedAt: new Date().toISOString(),
  }

  return NextResponse.json(response, { headers: NO_STORE })
}

type SlotRow = Awaited<ReturnType<typeof listSlotsForCalendarRange>>[number]

function projectSlot(
  s: SlotRow,
  role: 'admin' | 'teacher' | 'learner',
  callerAccountId: string,
): CalendarSlot {
  const startAt = new Date(s.startAt).toISOString()
  const status = s.status

  // PAST states: completed / no_show_* / cancelled
  if (
    status === 'completed' ||
    status === 'no_show_learner' ||
    status === 'no_show_teacher' ||
    status === 'cancelled'
  ) {
    if (role === 'admin' || role === 'teacher') {
      return {
        kind: 'past-full',
        id: s.id,
        startAt,
        durationMinutes: s.durationMinutes,
        status,
        learnerAccountId: s.learnerAccountId ?? null,
        learnerEmail: s.learnerEmail ?? null,
      }
    }
    // learner — past-redacted
    return {
      kind: 'past-redacted',
      id: s.id,
      startAt,
      durationMinutes: s.durationMinutes,
      status,
    }
  }

  // OPEN
  if (status === 'open') {
    return {
      kind: 'open',
      id: s.id,
      startAt,
      durationMinutes: s.durationMinutes,
      tariffId: s.tariffId ?? null,
      tariffAmountKopecks: s.tariffAmountKopecks ?? null,
    }
  }

  // BOOKED — admin / teacher get full identity; learner gets self vs other
  if (role === 'admin' || role === 'teacher') {
    return {
      kind: 'booked-full',
      id: s.id,
      startAt,
      durationMinutes: s.durationMinutes,
      learnerAccountId: s.learnerAccountId ?? '',
      learnerEmail: s.learnerEmail ?? '',
      tariffId: s.tariffId ?? null,
      tariffAmountKopecks: s.tariffAmountKopecks ?? null,
    }
  }
  // learner
  if (s.learnerAccountId === callerAccountId) {
    return {
      kind: 'booked-self',
      id: s.id,
      startAt,
      durationMinutes: s.durationMinutes,
      tariffId: s.tariffId ?? null,
      tariffAmountKopecks: s.tariffAmountKopecks ?? null,
    }
  }
  return {
    kind: 'booked-other',
    startAt,
    durationMinutes: s.durationMinutes,
  }
}
