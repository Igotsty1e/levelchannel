// BCS-OP-ROLLOUT plan §4.6 — token-retry helpers.
//
// Google API clients in this repo return 401 as a RESULT VARIANT, not
// an exception (see citations in pull.ts:202-210, 432-436;
// push.ts:198-201, 315-318, 353-356; channels.ts:82-90, 157-164).
// `ensureFreshAccessToken` reuses a still-by-timestamp-valid cached
// token; if Google has revoked it server-side, every consumer sees a
// 401 and skips its cycle indefinitely.
//
// `withTokenRetry` is the standard wrap:
//   - try with current token
//   - on REAL Google 401 (auth401: true) → force-refresh, retry
//   - on 2nd REAL Google 401 → flip integration to disconnected
//
// `tryRefreshOnce` is the inert variant used ONLY by channel-renewer's
// stopChannel-of-old call site (plan §4.6.4 — disconnecting on stop-
// channel 401 would self-break since the NEW channel is already
// authoritative).

import {
  disconnectGoogleIntegration,
} from '@/lib/calendar/integrations'
import { ensureFreshAccessToken } from '@/lib/calendar/google/token-refresh'

// CallResult is the contract every consumer adapter must satisfy.
// auth401 discriminant lets the helper distinguish a Google-side 401
// (requires force-refresh) from any other failure (transient / 5xx /
// 4xx-non-auth / parse / network).
export type CallResult<T> =
  | { ok: true; value: T }
  | { ok: false; auth401: boolean; raw: unknown }

export async function withTokenRetry<T>(
  accountId: string,
  exec: (token: string) => Promise<CallResult<T>>,
): Promise<CallResult<T>> {
  const first = await ensureFreshAccessToken({ accountId })
  if (!first.ok) {
    // ensureFreshAccessToken already handles its own disconnect on
    // permanent refresh-token failure (see token-refresh.ts:104-114).
    // We just surface.
    return { ok: false, auth401: false, raw: first }
  }

  let result = await exec(first.accessToken)
  if (result.ok || !result.auth401) {
    return result
  }

  // 1st real Google 401 → force-refresh, retry.
  const second = await ensureFreshAccessToken({
    accountId,
    forceRefresh: true,
  })
  if (!second.ok) {
    // The refresh attempt itself failed. ensureFreshAccessToken has
    // already disconnected on permanent failure; don't double-act.
    return { ok: false, auth401: false, raw: second }
  }

  result = await exec(second.accessToken)
  if (!result.ok && result.auth401) {
    // 2nd real Google 401 in a row → the access_token IS fresh (Google
    // accepted our refresh_token) but Google itself rejects it. The
    // OAuth grant is dead in Google's view. Flip integration to
    // disconnected per plan §4.11.
    await disconnectGoogleIntegration(accountId).catch(() => {})
  }
  return result
}

// tryRefreshOnce — channel-renewer's stopChannel-of-old special case
// (plan §4.6.4). Does ONE refresh attempt on 401 but does NOT call
// disconnectGoogleIntegration on a 2nd 401, because at that point the
// NEW channel is already authoritative on our side; disconnecting
// would self-break.
export async function tryRefreshOnce<T>(
  accountId: string,
  exec: (token: string) => Promise<CallResult<T>>,
): Promise<CallResult<T>> {
  const first = await ensureFreshAccessToken({ accountId })
  if (!first.ok) {
    return { ok: false, auth401: false, raw: first }
  }

  let result = await exec(first.accessToken)
  if (result.ok || !result.auth401) {
    return result
  }

  const second = await ensureFreshAccessToken({
    accountId,
    forceRefresh: true,
  })
  if (!second.ok) {
    return { ok: false, auth401: false, raw: second }
  }

  result = await exec(second.accessToken)
  // Crucially: NO disconnect side effect even on 2nd 401.
  return result
}
