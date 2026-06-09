'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import { track } from '@/lib/analytics/track'

/**
 * Footer / landing link с tracked-event на клик. Сохраняет поведение
 * next/link (prefetch + client-side navigation), но эмитит analytics-event
 * `footer_link_clicked` с `target` (короткий идентификатор, не PII).
 */
export function TrackedLink({
  href,
  className,
  target,
  children,
}: {
  href: string
  className?: string
  target: string
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => track('footer_link_clicked', { target: target.slice(0, 64) })}
    >
      {children}
    </Link>
  )
}

export function TrackedAnchor({
  href,
  className,
  target,
  children,
}: {
  href: string
  className?: string
  target: string
  children: ReactNode
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={() => track('footer_link_clicked', { target: target.slice(0, 64) })}
    >
      {children}
    </a>
  )
}
