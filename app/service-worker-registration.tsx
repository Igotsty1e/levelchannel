'use client'

import { useEffect } from 'react'

// BCS-DEF-4-PUSH (2026-06-06) — client island that registers the
// classic service worker at /sw.js with scope=/. Mounted from
// app/layout.tsx so the SW is available on every route.
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.4

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  }, [])
  return null
}
