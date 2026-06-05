import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireAuthenticated } from '@/lib/auth/guards'
import {
  type AccountProfileUpdate,
  getAccountProfile,
  upsertAccountProfile,
  validateProfileUpdate,
} from '@/lib/auth/profiles'
import { getGoogleIntegrationMeta } from '@/lib/calendar/integrations'
import { isAccountProfilesClearTimezoneError } from '@/lib/calendar/timezone-trigger-errors'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET  /api/account/profile  → current profile, null fields if none
// PATCH /api/account/profile → set / clear named fields. Omit a key to
//                              keep current value; pass null to clear.
//
// Origin gate on PATCH only — GET is a same-origin cabinet bootstrap
// like /api/auth/me. The PATCH side mutates state.


export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'account:profile:ip', 60, 60_000)
  if (rl) return rl

  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth.response

  const profile = await getAccountProfile(auth.account.id)
  return NextResponse.json(
    {
      profile: profile ?? {
        accountId: auth.account.id,
        displayName: null,
        firstName: null,
        lastName: null,
        timezone: null,
        locale: null,
        createdAt: null,
        updatedAt: null,
      },
    },
    { status: 200, headers: NO_STORE },
  )
}

export async function PATCH(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'account:profile:ip', 30, 60_000)
  if (rl) return rl

  const auth = await requireAuthenticated(request)
  if (!auth.ok) return auth.response

  const parsed = await readJsonObjectOr400(request)
  if (!parsed.ok) return parsed.response

  const update: AccountProfileUpdate = {}
  const raw = parsed.body
  if ('displayName' in raw) {
    if (raw.displayName !== null && typeof raw.displayName !== 'string') {
      return NextResponse.json(
        { error: 'displayName must be string or null.' },
        { status: 400, headers: NO_STORE },
      )
    }
    update.displayName = raw.displayName as string | null
  }
  // TASK-5 (mig 0095) — firstName / lastName. Both optional; null
  // clears, omitted keeps. When passed, the writer recomputes the
  // storage display_name via computeDisplayNameForStorage (NULL on
  // empty).
  if ('firstName' in raw) {
    if (raw.firstName !== null && typeof raw.firstName !== 'string') {
      return NextResponse.json(
        { error: 'firstName must be string or null.' },
        { status: 400, headers: NO_STORE },
      )
    }
    update.firstName = raw.firstName as string | null
  }
  if ('lastName' in raw) {
    if (raw.lastName !== null && typeof raw.lastName !== 'string') {
      return NextResponse.json(
        { error: 'lastName must be string or null.' },
        { status: 400, headers: NO_STORE },
      )
    }
    update.lastName = raw.lastName as string | null
  }
  if ('timezone' in raw) {
    if (raw.timezone !== null && typeof raw.timezone !== 'string') {
      return NextResponse.json(
        { error: 'timezone must be string or null.' },
        { status: 400, headers: NO_STORE },
      )
    }
    update.timezone = raw.timezone as string | null
  }
  if ('locale' in raw) {
    if (raw.locale !== null && typeof raw.locale !== 'string') {
      return NextResponse.json(
        { error: 'locale must be string or null.' },
        { status: 400, headers: NO_STORE },
      )
    }
    update.locale = raw.locale as string | null
  }

  const validation = validateProfileUpdate(update)
  if (validation) {
    return NextResponse.json(
      { error: `${validation.field}/${validation.reason}` },
      { status: 400, headers: NO_STORE },
    )
  }

  // calendar-onboarding-cleanup (2026-06-05) — refuse to clear timezone
  // while an active|degraded Google Calendar integration exists.
  // Otherwise the integration would keep pushing/pulling against MSK
  // fallback while the teacher's saved tz reads as unset. The teacher
  // must disconnect first.
  if ('timezone' in update && update.timezone === null) {
    const integration = await getGoogleIntegrationMeta(auth.account.id)
    if (
      integration
      && (integration.syncState === 'active'
        || integration.syncState === 'degraded')
    ) {
      return NextResponse.json(
        {
          error: 'timezone_required_while_calendar_connected',
          message:
            'Невозможно очистить часовой пояс, пока Google Calendar подключён. Отключите интеграцию и попробуйте снова.',
        },
        { status: 409, headers: NO_STORE },
      )
    }
  }

  // 2026-06-06 calendar-onboarding-followup (round-3 BLOCKER 1 +
  // round-9 BLOCKER 1): catch the mig 0107 trigger raising 23514 when
  // the app-layer guard above missed (TOCTOU race where the
  // integration row got created between the meta-read and the upsert).
  // Narrow-match by message prefix so unrelated 23514 sources
  // (display_name length, mig 0069 IANA, mig 0095 column CHECKs)
  // propagate as 500.
  let profile
  try {
    profile = await upsertAccountProfile(auth.account.id, update)
  } catch (err) {
    if (isAccountProfilesClearTimezoneError(err)) {
      console.warn(
        '[account/profile] upsert hit DB timezone-clear trigger (TOCTOU race):',
        err,
      )
      return NextResponse.json(
        {
          error: 'timezone_required_while_calendar_connected',
          message:
            'Невозможно очистить часовой пояс, пока Google Calendar подключён. Отключите интеграцию и попробуйте снова.',
        },
        { status: 409, headers: NO_STORE },
      )
    }
    throw err
  }
  return NextResponse.json({ profile }, { status: 200, headers: NO_STORE })
}
