// BCS-DEF-4-PUSH (2026-06-06) — classic service worker for Web Push
// notifications + PWA install scaffolding. Loaded via
// `navigator.serviceWorker.register('/sw.js', { scope: '/' })` (NO
// `type: 'module'` — Safari 16.4+ supports module workers but the
// classic shape is portable and lets us share the open-url resolver
// via importScripts).
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.4

importScripts('/sw-lib/resolve-open-url.js')

const SW_VERSION = '1'

self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', function (event) {
  var payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (_e) {
    payload = {}
  }
  var title = typeof payload.title === 'string' ? payload.title : 'LevelChannel'
  var body = typeof payload.body === 'string' ? payload.body : ''
  var url = typeof payload.url === 'string' ? payload.url : '/cabinet'
  var options = {
    body: body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: url },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  var rawUrl = event.notification.data && event.notification.data.url
  var resolved = self.resolveOpenUrl(rawUrl, self.location.origin)
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i += 1) {
        var c = clientList[i]
        if (c.url.indexOf(resolved) !== -1 && 'focus' in c) {
          return c.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(resolved)
      }
      return null
    }),
  )
})

self.SW_VERSION = SW_VERSION
