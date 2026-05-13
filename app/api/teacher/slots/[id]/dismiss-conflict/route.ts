import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherAndVerified } from '@/lib/auth/guards'
import { getDbPool } from '@/lib/db/pool'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/teacher/slots/[id]/dismiss-conflict
//
// Action a) "Я разрулю сам" — clears the conflict stamp on the slot.
// Optimistic: if the busy interval still overlaps on the next pull,
// the conflict detector will re-stamp it. This is the "let me handle
// it manually outside the system" path.
//
// Plan §4.7.

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:slot:dismiss-conflict:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const auth = await requireTeacherAndVerified(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const pool = getDbPool()
  const result = await pool.query(
    `update lesson_slots
        set external_conflict_at = null,
            external_conflict_kind = null,
            conflict_source_calendar_id = null,
            conflict_source_event_id = null,
            updated_at = now()
      where id = $1
        and teacher_account_id = $2
        and external_conflict_at is not null
      returning id`,
    [id, auth.account.id],
  )
  if (result.rows.length === 0) {
    // Either slot not owned, doesn't exist, or no conflict to dismiss.
    return NextResponse.json(
      { error: 'not_found_or_no_conflict' },
      { status: 404, headers: NO_STORE },
    )
  }
  return NextResponse.json(
    { ok: true, dismissed: id },
    { status: 200, headers: NO_STORE },
  )
}
