import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { listOrphanSelfSlotsForTeacher } from '@/lib/calendar/orphan-cleanup'
import { enforceRateLimit } from '@/lib/security/request'

// BCS-G.4 — GET /api/teacher/calendar/orphan-slots
//
// Plan §4.12 surface. Lists slots whose binding's integration_epoch
// no longer matches the teacher's current integration epoch — i.e.
// the teacher reconnected Google since this slot was pushed.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const rl = await enforceRateLimit(
    request,
    'teacher:orphan-slots:ip',
    60,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const slots = await listOrphanSelfSlotsForTeacher(guard.account.id)
  return NextResponse.json({ slots }, { headers: NO_STORE })
}
