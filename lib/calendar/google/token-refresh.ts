// BCS-D.complete — token refresh wrapper.
//
// Caller hands us an integration row (with potentially-stale tokens);
// we return a fresh access token (or a `disconnected` signal if the
// refresh fails terminally).
//
// Behaviour:
//   - If `accessToken` is present AND `tokenExpiresAt` is at least
//     60 seconds in the future → return current token (no refresh).
//   - Else call refreshAccessToken via the stored refresh_token.
//     - 200 → upsertGoogleIntegration({ reason: 'token_refresh' })
//       (preserves epoch + last_reconnected_at), return new token.
//     - 400/401/403 → caller-visible `disconnected` — refresh_token
//       likely revoked or stale. Side effect: integration is flipped
//       to sync_state='disconnected' so future pulls short-circuit
//       cleanly.
//     - 5xx / network → caller-visible `transient` — leave integration
//       alone, caller retries later (worker uses next_run_at + backoff).
//   - When integration has no refresh_token (post-disconnect or
//     pre-connect state) → `no_refresh_token`.

import {
  getGoogleCalendarOauthConfig,
} from '@/lib/calendar/google/config'
import { refreshAccessToken } from '@/lib/calendar/google/oauth'
import {
  disconnectGoogleIntegration,
  getGoogleIntegration,
  upsertGoogleIntegration,
  type TeacherCalendarIntegrationWithTokens,
} from '@/lib/calendar/integrations'

const REFRESH_SKEW_MS = 60_000 // 1 minute

export type FreshTokenResult =
  | {
      ok: true
      accessToken: string
      integration: TeacherCalendarIntegrationWithTokens
      refreshed: boolean
    }
  | {
      ok: false
      reason:
        | 'integration_missing'
        | 'disconnected'
        | 'no_refresh_token'
        | 'config_missing'
        | 'transient'
        | 'permanent'
      detail?: string
    }

export async function ensureFreshAccessToken(opts: {
  accountId: string
  nowMs?: number
  fetchImpl?: typeof fetch
  // BCS-OP-ROLLOUT plan §4.6.1 — when true, skip the cached-token
  // branch and force a refresh via refresh_token. Used by
  // withTokenRetry after a real Google 401 to recover from a
  // server-side revoke that the timestamp cache wouldn't catch.
  forceRefresh?: boolean
}): Promise<FreshTokenResult> {
  const nowMs = opts.nowMs ?? Date.now()

  const integration = await getGoogleIntegration(opts.accountId)
  if (!integration) {
    return { ok: false, reason: 'integration_missing' }
  }
  if (integration.syncState === 'disconnected') {
    return { ok: false, reason: 'disconnected' }
  }
  // If token isn't expired yet (within skew) and we have it, reuse —
  // unless the caller is forcing a refresh after a Google-side 401.
  if (
    !opts.forceRefresh
    && integration.accessToken
    && integration.tokenExpiresAt
    && new Date(integration.tokenExpiresAt).getTime() > nowMs + REFRESH_SKEW_MS
  ) {
    return {
      ok: true,
      accessToken: integration.accessToken,
      integration,
      refreshed: false,
    }
  }
  if (!integration.refreshToken) {
    return { ok: false, reason: 'no_refresh_token' }
  }

  let config
  try {
    config = getGoogleCalendarOauthConfig()
  } catch (e) {
    return {
      ok: false,
      reason: 'config_missing',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
  if (!config) {
    return { ok: false, reason: 'config_missing' }
  }

  const refresh = await refreshAccessToken(
    config,
    integration.refreshToken,
    opts.fetchImpl,
  )
  if (!refresh.ok) {
    // Disambiguate permanent vs transient.
    if (refresh.error.kind === 'http') {
      if ([400, 401, 403].includes(refresh.error.status)) {
        // refresh_token revoked / stale → integration must move to
        // disconnected so the rest of the system stops hitting Google
        // with a doomed credential.
        await disconnectGoogleIntegration(opts.accountId).catch(() => {})
        return { ok: false, reason: 'permanent', detail: refresh.error.body }
      }
      return { ok: false, reason: 'transient', detail: refresh.error.body }
    }
    return {
      ok: false,
      reason: 'transient',
      detail: refresh.error.kind === 'network'
        ? refresh.error.message
        : refresh.error.message,
    }
  }

  // Persist the refreshed tokens. Note: Google may omit refresh_token
  // (the typical refresh shape). upsertGoogleIntegration in
  // 'token_refresh' mode keeps the stored one when null is passed.
  const expiresAt = new Date(
    nowMs + refresh.tokens.expiresInSeconds * 1000,
  )
  const upsert = await upsertGoogleIntegration({
    accountId: opts.accountId,
    accessToken: refresh.tokens.accessToken,
    refreshToken: refresh.tokens.refreshToken, // null = keep stored
    scope: refresh.tokens.scope || integration.scope || '',
    tokenExpiresAt: expiresAt,
    readCalendarIds: integration.readCalendarIds,
    writeCalendarId: integration.writeCalendarId,
    reason: 'token_refresh',
  })
  if (!upsert.ok) {
    return { ok: false, reason: 'transient', detail: upsert.error.message }
  }
  // Re-read to get the freshly-decrypted record.
  const refreshed = await getGoogleIntegration(opts.accountId)
  if (!refreshed || !refreshed.accessToken) {
    return { ok: false, reason: 'transient', detail: 'refreshed integration row missing token' }
  }
  return {
    ok: true,
    accessToken: refreshed.accessToken,
    integration: refreshed,
    refreshed: true,
  }
}
