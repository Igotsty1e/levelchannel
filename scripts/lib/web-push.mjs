// BCS-DEF-4-PUSH (2026-06-06) — thin wrapper around the `web-push` npm
// lib. Handles VAPID setup (one-shot per process), encrypted payload
// encoding (RFC 8291 via the lib), and 410/404 detection for auto-
// unsubscribe of stale endpoints.
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.6

import webpush from 'web-push'

let vapidConfigured = false

export function configureVapidIfNeeded(env = process.env) {
  if (vapidConfigured) return true
  const publicKey = String(env.PUSH_VAPID_PUBLIC_KEY ?? '').trim()
  const privateKey = String(env.PUSH_VAPID_PRIVATE_KEY ?? '').trim()
  const subject = String(env.PUSH_VAPID_SUBJECT ?? '').trim()
  if (!publicKey || !privateKey || !subject) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
  return true
}

export async function sendWebPush(subscription, payload, env = process.env) {
  if (!configureVapidIfNeeded(env)) {
    return { ok: false, reason: 'vapid_unconfigured' }
  }
  try {
    const res = await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh_b64url,
          auth: subscription.auth_b64url,
        },
      },
      JSON.stringify(payload),
      { TTL: 60 * 30 },
    )
    return { ok: true, statusCode: res.statusCode }
  } catch (err) {
    const sc = err?.statusCode ?? 0
    const isGone = sc === 410 || sc === 404
    return {
      ok: false,
      reason: isGone ? 'endpoint_gone' : 'send_failed',
      statusCode: sc,
      error: err?.body ?? String(err?.message ?? err),
    }
  }
}

export function _resetVapidConfigForTests() {
  vapidConfigured = false
}
