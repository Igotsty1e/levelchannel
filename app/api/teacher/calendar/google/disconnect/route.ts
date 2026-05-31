import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { disconnectGoogleIntegration } from '@/lib/calendar/integrations'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/teacher/calendar/google/disconnect
//
// Disconnects the teacher's Google Calendar integration. Per plan
// §4.12: tokens cleared, sync_state='disconnected'. We do NOT cascade-
// delete the Google events that LC pushed — reconciliation handles
// drift on a future reconnect via the epoch field.
//
// Returns { ok: true, disconnected } where `disconnected` is true if
// a row was updated, false if no integration existed or it was
// already disconnected.

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:calendar:google:disconnect:ip',
    5,
    60_000,
  )
  if (rl) return rl

  const auth = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!auth.ok) return auth.response

  const disconnected = await disconnectGoogleIntegration(auth.account.id)
  return NextResponse.json(
    { ok: true, disconnected },
    { status: 200, headers: NO_STORE },
  )
}
