// BCS-C.2 — env-bound configuration for the Google Calendar OAuth flow.
//
// 2026-06-06 calendar-onboarding-followup: redirect URL validation
// tightened — exact path + same-origin as NEXT_PUBLIC_SITE_URL +
// https-only + non-loopback in production. Otherwise a misconfigured
// GOOGLE_CALENDAR_REDIRECT_URL could send the teacher to the wrong
// host (or attacker-controlled host) when Google completes the
// consent step. Plan: docs/plans/calendar-onboarding-followup-2026-06-06.md
//
// Four env vars participate in this contract:
//
//   GOOGLE_CALENDAR_CLIENT_ID
//   GOOGLE_CALENDAR_CLIENT_SECRET
//     Created in Google Cloud Console → APIs & Services → Credentials
//     → OAuth client ID (Web application). The redirect URI configured
//     there must match GOOGLE_CALENDAR_REDIRECT_URL below.
//
//   GOOGLE_CALENDAR_REDIRECT_URL
//     The callback URL Google will 302 to after the user grants
//     consent. Typically `${NEXT_PUBLIC_SITE_URL}/api/teacher/calendar/google/callback`.
//
//   GOOGLE_OAUTH_STATE_SECRET
//     HMAC key for the OAuth `state` nonce (CSRF defense). 32+ char.
//     Independent of CALENDAR_ENCRYPTION_KEY for blast-radius
//     separation. Rotation of this secret invalidates in-flight OAuth
//     redirects only (failed state verification → user retries
//     the connect button); no persistent data depends on it.
//
// Resolver shape mirrors `lib/calendar/encryption.ts`:
//   - missing in NODE_ENV=production → throw on first use;
//   - missing in dev/test → returns null (the integration UI surfaces
//     a "не настроено" hint instead of broken OAuth);
//   - cached on first use against process.env.

import { isLoopbackOriginUrl } from '@/lib/security/local-host'

const STATE_SECRET_MIN_LENGTH = 32
const EXPECTED_REDIRECT_PATH = '/api/teacher/calendar/google/callback'

export type GoogleCalendarOauthConfig = {
  clientId: string
  clientSecret: string
  redirectUrl: string
  stateSecret: string
}

let cached: GoogleCalendarOauthConfig | null | undefined = undefined

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return env[key]?.trim() ?? ''
}

export function getGoogleCalendarOauthConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleCalendarOauthConfig | null {
  if (cached !== undefined && env === process.env) return cached

  const clientId = readEnv(env, 'GOOGLE_CALENDAR_CLIENT_ID')
  const clientSecret = readEnv(env, 'GOOGLE_CALENDAR_CLIENT_SECRET')
  const redirectUrl = readEnv(env, 'GOOGLE_CALENDAR_REDIRECT_URL')
  const stateSecret = readEnv(env, 'GOOGLE_OAUTH_STATE_SECRET')

  const missing: string[] = []
  if (!clientId) missing.push('GOOGLE_CALENDAR_CLIENT_ID')
  if (!clientSecret) missing.push('GOOGLE_CALENDAR_CLIENT_SECRET')
  if (!redirectUrl) missing.push('GOOGLE_CALENDAR_REDIRECT_URL')
  if (!stateSecret) missing.push('GOOGLE_OAUTH_STATE_SECRET')

  if (missing.length > 0) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        `Google Calendar OAuth not configured: missing ${missing.join(', ')}. ` +
          'Set these env vars before enabling the integration in production.',
      )
    }
    if (env === process.env) cached = null
    return null
  }

  if (stateSecret.length < STATE_SECRET_MIN_LENGTH) {
    throw new Error(
      `GOOGLE_OAUTH_STATE_SECRET must be at least ${STATE_SECRET_MIN_LENGTH} characters. ` +
        `Got ${stateSecret.length}.`,
    )
  }

  // Redirect URL validation. Must be a valid URL with the exact
  // callback path. In production: https + non-loopback + same origin
  // as NEXT_PUBLIC_SITE_URL.
  let parsedRedirect: URL
  try {
    parsedRedirect = new URL(redirectUrl)
  } catch {
    throw new Error(
      `GOOGLE_CALENDAR_REDIRECT_URL must be a valid URL. Got: ${redirectUrl}`,
    )
  }
  if (
    parsedRedirect.protocol !== 'http:'
    && parsedRedirect.protocol !== 'https:'
  ) {
    throw new Error(
      `GOOGLE_CALENDAR_REDIRECT_URL must use http(s)://. Got: ${redirectUrl}`,
    )
  }
  if (parsedRedirect.pathname !== EXPECTED_REDIRECT_PATH) {
    throw new Error(
      `GOOGLE_CALENDAR_REDIRECT_URL must end with path ${EXPECTED_REDIRECT_PATH}. Got pathname: ${parsedRedirect.pathname}`,
    )
  }
  if (env.NODE_ENV === 'production') {
    if (parsedRedirect.protocol !== 'https:') {
      throw new Error(
        `GOOGLE_CALENDAR_REDIRECT_URL must use https:// in production. Got: ${redirectUrl}`,
      )
    }
    if (isLoopbackOriginUrl(parsedRedirect)) {
      throw new Error(
        `GOOGLE_CALENDAR_REDIRECT_URL must not be a loopback hostname in production. Got: ${redirectUrl}`,
      )
    }
    // Same-origin invariant: redirectUrl.origin MUST match
    // NEXT_PUBLIC_SITE_URL.origin. Otherwise Google can land the
    // teacher on the wrong host even though the URL is "valid https".
    const expectedSiteUrl = (env.NEXT_PUBLIC_SITE_URL ?? '').trim()
    if (!expectedSiteUrl) {
      throw new Error(
        'GOOGLE_CALENDAR_REDIRECT_URL same-origin check requires NEXT_PUBLIC_SITE_URL to be set in production.',
      )
    }
    let expectedOrigin: string
    try {
      expectedOrigin = new URL(expectedSiteUrl).origin
    } catch {
      throw new Error(
        'GOOGLE_CALENDAR_REDIRECT_URL same-origin check requires NEXT_PUBLIC_SITE_URL to be a valid URL in production.',
      )
    }
    if (parsedRedirect.origin !== expectedOrigin) {
      throw new Error(
        `GOOGLE_CALENDAR_REDIRECT_URL must have the same origin as NEXT_PUBLIC_SITE_URL in production. ` +
          `Redirect origin: ${parsedRedirect.origin}; site origin: ${expectedOrigin}.`,
      )
    }
  }

  const config: GoogleCalendarOauthConfig = {
    clientId,
    clientSecret,
    redirectUrl,
    stateSecret,
  }
  if (env === process.env) cached = config
  return config
}

// Test hook. Don't call from production code.
export function __resetGoogleCalendarOauthConfigCache(): void {
  cached = undefined
}

// Scopes the integration requests during OAuth consent. Codex r2
// review fixed: `calendar.readonly` is NOT in this list — `events`
// scope already permits `events.list`, and `calendar.calendarlist.readonly`
// is the minimum needed for the `calendarList.list` + accessRole
// surface (used by the pull worker to discover the teacher's calendars
// and derive `is_writable_in_source`).
export const GOOGLE_CALENDAR_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const

export type GoogleCalendarScope =
  (typeof GOOGLE_CALENDAR_OAUTH_SCOPES)[number]
