// BCS-C.2 — Google OAuth 2.0 client primitives.
//
// Three operations: build consent URL, exchange auth code for tokens,
// refresh access token. Each is a pure-functional wrapper around
// node-fetch / global fetch; the route handlers consume these and
// own state nonce + token persistence.
//
// No retries / backoff here — the route handler decides the retry
// policy (typically: surface the error to the teacher, ask them to
// reconnect). Refresh-token usage in the long-running push worker
// will use a different code path with bounded retries.
//
// Reference: https://developers.google.com/identity/protocols/oauth2/web-server

import type { GoogleCalendarOauthConfig } from './config'
import { GOOGLE_CALENDAR_OAUTH_SCOPES } from './config'

const GOOGLE_AUTH_URL =
  'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export type GoogleTokenResponse = {
  accessToken: string
  refreshToken: string | null
  expiresInSeconds: number
  scope: string
  tokenType: string
}

export type GoogleOauthError =
  | { kind: 'http'; status: number; body: string }
  | { kind: 'shape'; message: string }
  | { kind: 'network'; message: string }

// Builds the URL the teacher's browser should be redirected to to
// initiate the OAuth consent flow.
//
// `access_type=offline` + `prompt=consent` together force Google to
// return a refresh_token on every consent — critical because we need
// to pull/push long after the access token expires. Without `prompt`,
// Google may return only an access_token on a repeat consent.
export function buildAuthorizationUrl(
  config: GoogleCalendarOauthConfig,
  state: string,
): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_CALENDAR_OAUTH_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)
  return url.toString()
}

// Exchange the authorization code received on the OAuth callback for
// a token pair. Caller passes the literal `code` value from the URL.
export async function exchangeCodeForTokens(
  config: GoogleCalendarOauthConfig,
  code: string,
  // For deterministic tests. Defaults to global fetch.
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; tokens: GoogleTokenResponse } | { ok: false; error: GoogleOauthError }> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUrl,
    grant_type: 'authorization_code',
  }).toString()
  return postToken(body, fetchImpl)
}

// Refresh the access token using a stored refresh_token. Google's
// refresh response does NOT always include a new refresh_token —
// the existing one stays valid. The returned shape preserves that:
// `refreshToken` is null on refresh, present on initial exchange.
export async function refreshAccessToken(
  config: GoogleCalendarOauthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; tokens: GoogleTokenResponse } | { ok: false; error: GoogleOauthError }> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  }).toString()
  return postToken(body, fetchImpl)
}

async function postToken(
  body: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; tokens: GoogleTokenResponse } | { ok: false; error: GoogleOauthError }> {
  let res: Response
  try {
    res = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    })
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'network',
        message: e instanceof Error ? e.message : String(e),
      },
    }
  }

  if (!res.ok) {
    let errorBody = ''
    try {
      errorBody = await res.text()
    } catch {
      // ignore — we'll report the status code alone.
    }
    return {
      ok: false,
      error: { kind: 'http', status: res.status, body: errorBody },
    }
  }

  let parsed: unknown
  try {
    parsed = await res.json()
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'shape',
        message: `failed to parse Google token JSON: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
    }
  }

  const shaped = shapeTokenResponse(parsed)
  if ('error' in shaped) {
    return { ok: false, error: { kind: 'shape', message: shaped.error } }
  }
  return { ok: true, tokens: shaped }
}

function shapeTokenResponse(raw: unknown): GoogleTokenResponse | { error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'Google token response must be a JSON object' }
  }
  const r = raw as Record<string, unknown>
  if (typeof r.access_token !== 'string' || r.access_token.length === 0) {
    return { error: 'Google token response missing access_token' }
  }
  if (typeof r.expires_in !== 'number' || r.expires_in <= 0) {
    return { error: 'Google token response missing valid expires_in' }
  }
  return {
    accessToken: r.access_token,
    refreshToken:
      typeof r.refresh_token === 'string' && r.refresh_token.length > 0
        ? r.refresh_token
        : null,
    expiresInSeconds: r.expires_in,
    scope: typeof r.scope === 'string' ? r.scope : '',
    tokenType:
      typeof r.token_type === 'string' ? r.token_type : 'Bearer',
  }
}
