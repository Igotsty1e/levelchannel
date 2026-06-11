// POST /api/teacher/settings/calendar/slot-mode
//
// teacher-no-slots-mode epic (Задача 2.1, Sub-PR A, 2026-06-11).
// Teacher flips the global calendar slot-mode toggle:
//   'open_slots'    — learners pick from open slots (default).
//   'direct_assign' — teacher assigns concrete time per learner.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  type CalendarSlotMode,
  isCalendarSlotMode,
  setCalendarSlotMode,
} from '@/lib/scheduling/slot-mode'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  // Settings flip is rare — 5 hits / minute / IP is plenty for legit
  // toggling + blocks scripted abuse.
  const rl = await enforceRateLimit(
    request,
    'teacher:settings:slot-mode:ip',
    5,
    60_000,
  )
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const parsed = await readJsonObjectOr400(request, { coded: true })
  if (!parsed.ok) return parsed.response
  const raw = parsed.body

  if (!isCalendarSlotMode(raw.mode)) {
    return NextResponse.json(
      { error: 'mode/invalid' },
      { status: 400, headers: NO_STORE },
    )
  }
  const mode: CalendarSlotMode = raw.mode

  await setCalendarSlotMode(guard.account.id, mode)

  return NextResponse.json(
    { mode },
    { status: 200, headers: NO_STORE },
  )
}
