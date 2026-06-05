import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { getAccountProfile } from '@/lib/auth/profiles'
import { getGoogleCalendarOauthConfig } from '@/lib/calendar/google/config'
import { buildAuthorizationUrl } from '@/lib/calendar/google/oauth'
import { generateOauthState } from '@/lib/calendar/google/state'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/teacher/calendar/google/start
//
// Initiates the Google Calendar OAuth consent flow. Returns
// { authorizationUrl } — the client navigates window.location to it.
//
// Auth: teacher-only (admin-precedence rejects hybrid admin+teacher).
// Rate-limit: 5/min/account-IP combo so an attacker can't brute the
// state-nonce generation surface.
// Origin gate: same trusted-browser-origin pattern as other POST
// routes — defense against cross-site form posts.
//
// Plan §4.11 — OAuth scopes are fixed by config (calendar.events +
// calendar.calendarlist.readonly). access_type=offline + prompt=consent
// in buildAuthorizationUrl guarantee a refresh_token on initial consent.

export async function POST(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'teacher:calendar:google:start:ip',
    5,
    60_000,
  )
  if (rl) return rl

  const auth = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!auth.ok) return auth.response

  // calendar-onboarding-cleanup (2026-06-05) — timezone gate. Calendar
  // runtime relies on profile.timezone for slot rendering / push event
  // labels. Refuse to start OAuth without it; SSR page surfaces a
  // banner with link to profile.
  const profile = await getAccountProfile(auth.account.id)
  if (profile?.timezone == null) {
    return NextResponse.json(
      {
        error: 'timezone_required',
        message:
          'Укажите часовой пояс в профиле перед подключением Google Calendar.',
      },
      { status: 422, headers: NO_STORE },
    )
  }

  let config
  try {
    config = getGoogleCalendarOauthConfig()
  } catch (e) {
    // In production with missing env, the resolver throws. Surface a
    // 503 so the UI can render a "оператор ещё не подключил OAuth"
    // hint rather than crashing the cabinet.
    return NextResponse.json(
      {
        error: 'oauth_misconfigured',
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 503, headers: NO_STORE },
    )
  }
  if (!config) {
    return NextResponse.json(
      {
        error: 'oauth_not_configured',
        message:
          'Google Calendar OAuth не настроен на этом окружении (dev).',
      },
      { status: 503, headers: NO_STORE },
    )
  }

  const state = generateOauthState({
    accountId: auth.account.id,
    secret: config.stateSecret,
  })
  const authorizationUrl = buildAuthorizationUrl(config, state)

  return NextResponse.json(
    { authorizationUrl },
    { status: 200, headers: NO_STORE },
  )
}
