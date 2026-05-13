// BCS-D.4 — Google Calendar push-notification channel primitives.
//
// `channels.watch` subscribes our webhook to a calendar; Google sends
// POSTs on resource changes for up to 7 days, then we must renew. We
// pair `channels.watch` with `channels.stop` (called when rotating /
// disconnecting).
//
// Reference: https://developers.google.com/workspace/calendar/api/guides/push
//
// Pure HTTP wrappers — no DB writes here. The channel-renewer module
// orchestrates these with the integration store.

const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3'

export type WatchChannelOutcome =
  | {
      ok: true
      channelId: string
      resourceId: string
      expirationMs: number
    }
  | { ok: false; error: WatchChannelError }

export type WatchChannelError =
  | { kind: 'http'; status: number; body: string }
  | { kind: 'shape'; message: string }
  | { kind: 'network'; message: string }

export type StopChannelOutcome =
  | { ok: true }
  | { ok: false; error: WatchChannelError }

// Subscribes the LC webhook to receive events.list-relevant changes
// on the given calendar. The caller provides:
//   - a fresh accessToken (BCS-D.complete ensureFreshAccessToken)
//   - the externalCalendarId
//   - a freshly minted channel id + token (per-subscription random)
//   - the webhook URL the integration should call back on
//
// Google rejects channels.watch unless the webhook URL is HTTPS.
// expirationMs is optional; Google sets a default (~7 days for
// calendar events).
export async function watchChannel(opts: {
  accessToken: string
  externalCalendarId: string
  channelId: string
  channelToken: string
  webhookUrl: string
  expirationMs?: number
  fetchImpl?: typeof fetch
}): Promise<WatchChannelOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const url = `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(opts.externalCalendarId)}/events/watch`
  const body: Record<string, unknown> = {
    id: opts.channelId,
    type: 'web_hook',
    address: opts.webhookUrl,
    token: opts.channelToken,
  }
  if (opts.expirationMs) body.expiration = String(opts.expirationMs)

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
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
    let respBody = ''
    try {
      respBody = await res.text()
    } catch {
      // ignore
    }
    return { ok: false, error: { kind: 'http', status: res.status, body: respBody } }
  }
  let parsed: unknown
  try {
    parsed = await res.json()
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'shape',
        message: `channels.watch JSON parse failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
    }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: { kind: 'shape', message: 'channels.watch response not object' } }
  }
  const r = parsed as Record<string, unknown>
  if (typeof r.resourceId !== 'string' || !r.resourceId) {
    return { ok: false, error: { kind: 'shape', message: 'channels.watch response missing resourceId' } }
  }
  if (typeof r.expiration !== 'string' && typeof r.expiration !== 'number') {
    return { ok: false, error: { kind: 'shape', message: 'channels.watch response missing expiration' } }
  }
  const expirationMs = Number(r.expiration)
  if (!Number.isFinite(expirationMs) || expirationMs <= 0) {
    return { ok: false, error: { kind: 'shape', message: 'channels.watch expiration not numeric' } }
  }
  return {
    ok: true,
    channelId: opts.channelId,
    resourceId: r.resourceId,
    expirationMs,
  }
}

// Stops a previously-watched channel. Idempotent at the LC layer:
// 404 (already gone) returns ok. Other 4xx — permanent. 5xx/network
// — transient (caller retries).
export async function stopChannel(opts: {
  accessToken: string
  channelId: string
  resourceId: string
  fetchImpl?: typeof fetch
}): Promise<StopChannelOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(`${GOOGLE_API_BASE}/channels/stop`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ id: opts.channelId, resourceId: opts.resourceId }),
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
  if (res.ok || res.status === 404) return { ok: true }
  let body = ''
  try {
    body = await res.text()
  } catch {
    // ignore
  }
  return { ok: false, error: { kind: 'http', status: res.status, body } }
}
