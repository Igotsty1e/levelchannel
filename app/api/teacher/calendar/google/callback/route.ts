import { NextResponse } from 'next/server'

import { listAccountRoles } from '@/lib/auth/accounts'
import { getCurrentSession } from '@/lib/auth/sessions'
import { getGoogleCalendarOauthConfig } from '@/lib/calendar/google/config'
import { exchangeCodeForTokens } from '@/lib/calendar/google/oauth'
import { verifyOauthState } from '@/lib/calendar/google/state'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/teacher/calendar/google/callback?code=...&state=...
//
// Google redirects the teacher's browser here after consent. The
// teacher's session cookie ride along (top-level navigation from
// Google → same-origin callback), so we resolve the session, verify
// the state nonce is bound to that account, exchange the code for
// tokens, and persist via upsertGoogleIntegration({ reason:
// 'initial_connect' }).
//
// Failure modes are all rendered as 302 redirects to
// /teacher/settings/calendar with a ?error= query param. Surfacing
// JSON would dead-end the user mid-browser-flow.
//
// Origin gate: NOT applied. Google has no way to attach our trusted
// Origin header. The state nonce is the CSRF defense (HMAC-bound to
// the issuing account_id, 10-min TTL).
//
// Rate limit: per-IP at the very start to bound brute-force replay of
// stolen state tokens (constant-time HMAC compare already defeats
// guessing, but we don't want a flood of pgcrypto encrypt calls).

function redirectToSettings(
  origin: string,
  query: Record<string, string>,
): NextResponse {
  const url = new URL('/teacher/settings/calendar', origin)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return NextResponse.redirect(url, { status: 302 })
}

function redirectToLogin(origin: string): NextResponse {
  return NextResponse.redirect(new URL('/login', origin), { status: 302 })
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin

  const rl = await enforceRateLimit(
    request,
    'teacher:calendar:google:callback:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorFromGoogle = url.searchParams.get('error')

  // User clicked "Cancel" on Google's consent screen.
  if (errorFromGoogle) {
    return redirectToSettings(origin, {
      error: 'consent_denied',
      detail: errorFromGoogle,
    })
  }
  if (!code || !state) {
    return redirectToSettings(origin, { error: 'invalid_callback' })
  }

  const session = await getCurrentSession(request)
  if (!session) {
    // Session expired during the OAuth round-trip. Send to login;
    // user can retry after re-auth.
    return redirectToLogin(origin)
  }

  // The state nonce is bound to the issuing account. If the cookie
  // session points at a different account (cookie swap, hijack, or
  // user logged out + in as someone else mid-flow), refuse.
  let config
  try {
    config = getGoogleCalendarOauthConfig()
  } catch (e) {
    console.error('[calendar/oauth] callback misconfigured:', e)
    return redirectToSettings(origin, { error: 'oauth_misconfigured' })
  }
  if (!config) {
    return redirectToSettings(origin, { error: 'oauth_not_configured' })
  }

  const verified = verifyOauthState(state, {
    accountId: session.account.id,
    secret: config.stateSecret,
  })
  if (!verified.ok) {
    return redirectToSettings(origin, {
      error: 'state_invalid',
      reason: verified.reason,
    })
  }

  // Role recheck: teacher only. Same precedence rules as the start
  // route. We don't reuse requireTeacherAndVerified() here because it
  // returns JSON on failure; we want a redirect.
  const roles = await listAccountRoles(session.account.id)
  if (roles.includes('admin') || !roles.includes('teacher')) {
    return redirectToSettings(origin, { error: 'wrong_role' })
  }
  if (!session.account.emailVerifiedAt) {
    return redirectToSettings(origin, { error: 'email_unverified' })
  }

  // Exchange code → tokens.
  const exchange = await exchangeCodeForTokens(config, code)
  if (!exchange.ok) {
    console.error('[calendar/oauth] code exchange failed:', exchange.error)
    return redirectToSettings(origin, {
      error: 'token_exchange_failed',
      kind: exchange.error.kind,
    })
  }
  const { accessToken, refreshToken, scope, expiresInSeconds } = exchange.tokens
  if (!refreshToken) {
    // Plan §4.11: we set access_type=offline + prompt=consent so
    // Google MUST return a refresh_token on initial consent. If it
    // didn't, something's off — refuse rather than store half-state.
    return redirectToSettings(origin, { error: 'no_refresh_token' })
  }
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)

  // Persist. Default read=['primary'], write='primary'. C.4 UI will
  // let the teacher refine which calendars to read and which to push
  // into via calendarList.list.
  const upsert = await upsertGoogleIntegration({
    accountId: session.account.id,
    accessToken,
    refreshToken,
    scope,
    tokenExpiresAt: expiresAt,
    readCalendarIds: ['primary'],
    writeCalendarId: 'primary',
    reason: 'initial_connect',
  })
  if (!upsert.ok) {
    console.error('[calendar/oauth] upsert failed:', upsert.error)
    return redirectToSettings(origin, {
      error: 'persist_failed',
      kind: upsert.error.code,
    })
  }

  return redirectToSettings(origin, { connected: '1' })
}
