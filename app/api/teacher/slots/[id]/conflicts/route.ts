import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { listConflictsForSlot } from '@/lib/calendar/conflict-detector'
import { getSlotById } from '@/lib/scheduling/slots'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/teacher/slots/[id]/conflicts
// Lists all foreign overlapping busy intervals for the slot — used
// by the "+N other conflicts" picker in the F.4 resolution UI.
//
// Auth: teacher of this slot.

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: RouteParams) {
  const rl = await enforceRateLimit(
    request,
    'teacher:slot:conflicts:ip',
    60,
    60_000,
  )
  if (rl) return rl

  const auth = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!auth.ok) return auth.response

  const { id } = await params
  const slot = await getSlotById(id)
  if (!slot) {
    return NextResponse.json(
      { error: 'not_found', message: 'Slot not found.' },
      { status: 404, headers: NO_STORE },
    )
  }
  if (slot.teacherAccountId !== auth.account.id) {
    // Don't disclose existence of foreign slots.
    return NextResponse.json(
      { error: 'not_found', message: 'Slot not found.' },
      { status: 404, headers: NO_STORE },
    )
  }

  const result = await listConflictsForSlot({ slotId: id })
  return NextResponse.json(
    {
      slot: result.slot,
      overlaps: result.overlaps,
    },
    { status: 200, headers: NO_STORE },
  )
}
