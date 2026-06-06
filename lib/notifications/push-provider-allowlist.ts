// BCS-DEF-4-PUSH (2026-06-06) — host + path-prefix allowlist for Web Push
// subscription endpoints. Tighter than suffix regex: blocks
// attacker.googleapis.com / attacker.windows.com / etc.
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.8 (subscribe route).
// Unsubscribe path INTENTIONALLY skips this check — see round-10 self-
// review WARN 1: legacy endpoints whose host is later removed from the
// allowlist must remain deletable by their owner.

const ALLOWED_PUSH_ENDPOINTS: ReadonlyArray<{
  host: string
  pathPrefix: string
}> = [
  { host: 'fcm.googleapis.com', pathPrefix: '/fcm/send/' },
  { host: 'updates.push.services.mozilla.com', pathPrefix: '/wpush/' },
  { host: 'web.push.apple.com', pathPrefix: '/' },
]

export function isAllowedPushEndpoint(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (!url.hostname) return false
  for (const allowed of ALLOWED_PUSH_ENDPOINTS) {
    if (
      url.hostname === allowed.host &&
      url.pathname.startsWith(allowed.pathPrefix)
    ) {
      return true
    }
  }
  return false
}
