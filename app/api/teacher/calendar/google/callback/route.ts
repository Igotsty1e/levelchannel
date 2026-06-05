import { NextResponse } from 'next/server'

import { resolveCanonicalOrigin } from '@/lib/api/origin'
import { listAccountRoles } from '@/lib/auth/accounts'
import { evaluateSaasOfferGate } from '@/lib/auth/guards'
import { getAccountProfile } from '@/lib/auth/profiles'
import { getCurrentSession } from '@/lib/auth/sessions'
import { setupChannelForIntegration } from '@/lib/calendar/channel-renewer'
import { getGoogleCalendarOauthConfig } from '@/lib/calendar/google/config'
import { exchangeCodeForTokens } from '@/lib/calendar/google/oauth'
import { verifyOauthState } from '@/lib/calendar/google/state'
import { upsertGoogleIntegration } from '@/lib/calendar/integrations'
import { enqueuePullJob } from '@/lib/calendar/pull-worker'
import { isCalendarRequireTimezoneError } from '@/lib/calendar/timezone-trigger-errors'
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

// Canonical-origin resolution lives in lib/api/origin.ts so the same
// helper covers the 3DS termURL in payments/charge-token. Behind nginx,
// `new URL(request.url).origin` returns `http://localhost:3000` instead
// of the public `https://levelchannel.ru` — silently breaks the
// callback Location header (ERR_SSL_PROTOCOL_ERROR in user's browser).

export async function GET(request: Request) {
  // 2026-06-06 calendar-onboarding-followup (round-6 WARN 2): wrap
  // resolveCanonicalOrigin in try/catch. In production it throws on
  // bad/missing NEXT_PUBLIC_SITE_URL — we can't redirect because we
  // don't have a valid origin; return a generic 500 instead.
  let origin: string
  try {
    origin = resolveCanonicalOrigin(request)
  } catch (err) {
    console.error('[calendar/oauth] resolveCanonicalOrigin failed:', err)
    return new NextResponse(
      'Calendar OAuth callback unavailable. Operator action required.',
      { status: 500 },
    )
  }

  // Codex C.3b review: enforceRateLimit emits JSON 429 by default,
  // which would dead-end the browser mid-OAuth flow with a raw JSON
  // body. The callback contract requires every failure to redirect
  // to /teacher/settings/calendar. Translate the throttle response
  // into a redirect.
  const rl = await enforceRateLimit(
    request,
    'teacher:calendar:google:callback:ip',
    30,
    60_000,
  )
  if (rl) return redirectToSettings(origin, { error: 'rate_limited' })

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

  // SAAS-OFFER A1.1 (2026-05-31) — inline SaaS-оферта consent gate.
  // OAuth callback doesn't go through requireTeacherWithCurrentSaasOfferConsent
  // wrapper because it needs to redirect (not return JSON).
  const saasOfferVerdict = await evaluateSaasOfferGate(session.account.id)
  if (saasOfferVerdict.kind === 'awaiting_publication') {
    return redirectToSettings(origin, { error: 'saas_offer_awaiting_publication' })
  }
  if (saasOfferVerdict.kind === 'consent_required') {
    return redirectToSettings(origin, { error: 'saas_offer_consent_required' })
  }

  // calendar-onboarding-cleanup (2026-06-05) — timezone gate. Without
  // a saved timezone the pull worker would fall back to MSK via
  // safeTimezone — silent misrender for non-MSK teachers. Refuse to
  // activate the integration; redirect with localized error.
  const profile = await getAccountProfile(session.account.id)
  if (profile?.timezone == null) {
    return redirectToSettings(origin, { error: 'timezone_required' })
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
  //
  // 2026-06-06 calendar-onboarding-followup (round-4 BLOCKER 2 +
  // round-9 BLOCKER 1): catch the mig 0107 trigger raising 23514 when
  // a concurrent PATCH /api/account/profile cleared the timezone
  // between our gate-check and this upsert. Narrow-match by message
  // prefix so unrelated 23514 sources still propagate as 500.
  let upsert: Awaited<ReturnType<typeof upsertGoogleIntegration>>
  try {
    upsert = await upsertGoogleIntegration({
      accountId: session.account.id,
      accessToken,
      refreshToken,
      scope,
      tokenExpiresAt: expiresAt,
      readCalendarIds: ['primary'],
      writeCalendarId: 'primary',
      reason: 'initial_connect',
    })
  } catch (err) {
    if (isCalendarRequireTimezoneError(err)) {
      console.warn(
        '[calendar/oauth] upsert hit DB timezone-required trigger (TOCTOU race):',
        err,
      )
      return redirectToSettings(origin, { error: 'timezone_required' })
    }
    throw err
  }
  if (!upsert.ok) {
    console.error('[calendar/oauth] upsert failed:', upsert.error)
    return redirectToSettings(origin, {
      error: 'persist_failed',
      kind: upsert.error.code,
    })
  }

  // BCS-D.4 — set up the Google push-notification channel for the
  // primary read calendar. Failure here is non-fatal: the periodic
  // cron sweep + the 5-min pull cron will still keep busy-cache
  // fresh. We log + carry on so the user doesn't dead-end in the
  // OAuth flow over a renewal hiccup.
  try {
    const channelRes = await setupChannelForIntegration({
      accountId: session.account.id,
      externalCalendarId: 'primary',
    })
    if (!channelRes.ok) {
      console.warn(
        '[calendar/oauth] channel setup failed after connect:',
        channelRes.reason,
        channelRes.detail,
      )
    }
  } catch (e) {
    console.error('[calendar/oauth] channel setup threw:', e)
  }

  // SaaS-pivot multi-tenant audit 2026-05-23 — close GAP-1.
  //
  // Google's channels.watch handshake fires `X-Goog-Resource-State:
  // sync`, which the webhook deliberately skips for pull-enqueue
  // (it's just the channel-created marker, not a real change). In
  // the single-tenant era the operator's calendar was constantly
  // active so the first real event always pulled within minutes.
  // With multi-tenant onboarding, a quiet calendar would silently
  // leave `teacher_external_busy_intervals` empty until the next
  // real change — meaning the conflict detector finds zero
  // conflicts and free-slot freshness gates pass on a stale
  // (empty) cache.
  //
  // Fix: enqueue a priority=2 pull job per read calendar after the
  // channel is wired up. Best-effort (non-fatal). Default
  // readCalendarIds=['primary'] at upsert time, but iterate in case
  // a later flow changes that default.
  try {
    for (const calendarId of upsert.record.readCalendarIds) {
      await enqueuePullJob({
        teacherAccountId: session.account.id,
        externalCalendarId: calendarId,
        priority: 2,
      })
    }
  } catch (e) {
    console.warn(
      '[calendar/oauth] initial pull enqueue failed:',
      e instanceof Error ? e.message : String(e),
    )
  }

  return redirectToSettings(origin, { connected: '1' })
}
