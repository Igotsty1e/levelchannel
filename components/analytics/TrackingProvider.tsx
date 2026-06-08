'use client'

/**
 * TrackingProvider — mounted in app/layout.tsx.
 *
 * Responsibilities:
 *   1. Fire `page_view` on pathname/search change (deduped via ref).
 *   2. Respect PAGE_VIEW_BLOCKLIST (admin, _next, api).
 *
 * Note: `usePathname` + `useSearchParams` require Suspense boundary in
 * Next.js 14+. Caller wraps this component in <Suspense fallback={null}>.
 */

import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef } from 'react'

import { track } from '@/lib/analytics/track'
import { isPageViewAllowed } from '@/lib/analytics/registry'

function PageViewWatcher() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastFiredRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname) return
    if (!isPageViewAllowed(pathname)) return
    const key = `${pathname}?${searchParams?.toString() ?? ''}`
    if (lastFiredRef.current === key) return
    lastFiredRef.current = key
    track('page_view', { title: typeof document !== 'undefined' ? document.title : undefined })
  }, [pathname, searchParams])

  return null
}

export function TrackingProvider() {
  return (
    <Suspense fallback={null}>
      <PageViewWatcher />
    </Suspense>
  )
}
