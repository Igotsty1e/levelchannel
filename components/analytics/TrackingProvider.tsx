'use client'

/**
 * TrackingProvider — mounted in app/layout.tsx.
 *
 * Responsibilities:
 *   1. Fire `page_view` on pathname/search change (deduped via ref).
 *   2. Respect PAGE_VIEW_BLOCKLIST (admin, _next, api).
 *   3. Fire `scroll_depth` once per 25/50/75/100 % on the current page.
 *   4. Fire `time_on_page` on page unload / pathname change.
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

function ScrollDepthWatcher() {
  const pathname = usePathname()
  const firedRef = useRef<Set<'25' | '50' | '75' | '100'>>(new Set())
  const pathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname) return
    if (!isPageViewAllowed(pathname)) return
    if (pathRef.current !== pathname) {
      firedRef.current = new Set()
      pathRef.current = pathname
    }

    const compute = () => {
      const doc = document.documentElement
      const max = Math.max(0, doc.scrollHeight - window.innerHeight)
      if (max <= 0) return
      const pct = Math.min(100, Math.round((window.scrollY / max) * 100))
      const thresholds: Array<'25' | '50' | '75' | '100'> = ['25', '50', '75', '100']
      for (const t of thresholds) {
        if (pct >= Number(t) && !firedRef.current.has(t)) {
          firedRef.current.add(t)
          track('scroll_depth', { depth: t })
        }
      }
    }

    let raf: number | null = null
    const onScroll = () => {
      if (raf != null) return
      raf = window.requestAnimationFrame(() => {
        raf = null
        compute()
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    compute()

    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf != null) window.cancelAnimationFrame(raf)
    }
  }, [pathname])

  return null
}

function TimeOnPageWatcher() {
  const pathname = usePathname()
  const startRef = useRef<number>(Date.now())

  useEffect(() => {
    if (!pathname) return
    if (!isPageViewAllowed(pathname)) return
    startRef.current = Date.now()

    const flush = () => {
      const seconds = Math.min(86400, Math.max(0, Math.round((Date.now() - startRef.current) / 1000)))
      if (seconds <= 1) return
      track('time_on_page', { seconds })
    }

    const onPageHide = () => flush()
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      flush()
    }
  }, [pathname])

  return null
}

export function TrackingProvider() {
  return (
    <Suspense fallback={null}>
      <PageViewWatcher />
      <ScrollDepthWatcher />
      <TimeOnPageWatcher />
    </Suspense>
  )
}
