// BCS-DEF-4-PUSH (2026-06-06) — same-origin URL resolver helper used by
// the service worker on `notificationclick` to safely open the deep
// link from the push payload. Lives in its own file so unit tests
// can load it directly via the test framework (the SW itself uses
// classic `importScripts(...)` which jsdom does not implement).
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.4 + §4 (sw-open-url test)

;(function attach(self) {
  function resolveOpenUrl(rawUrl, ownOrigin) {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) return '/cabinet'
    try {
      var u = new URL(rawUrl, ownOrigin)
      if (u.origin !== ownOrigin) return '/cabinet'
      return u.pathname + u.search + u.hash
    } catch (_e) {
      return '/cabinet'
    }
  }
  self.resolveOpenUrl = resolveOpenUrl
})(typeof self !== 'undefined' ? self : globalThis)
