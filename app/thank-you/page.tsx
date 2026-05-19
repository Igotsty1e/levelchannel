import { cookies } from 'next/headers'

import { SESSION_COOKIE_NAME } from '@/lib/auth/sessions'

import { ThankYouContent } from './thank-you-content'

// BUG-2026-05-13-1 fix: /thank-you was a flat 'use client' page with a
// hardcoded `primaryHref: '/'` for paid orders. An authenticated learner
// who just bought a package landed there and the only forward
// affordance dropped them on the public landing page. The /pay and
// /checkout/[tariffSlug] surfaces already solve the same issue with a
// session-cookie-presence check on the server; we mirror that contract
// here. Cookie-presence-only — /cabinet itself handles invalid sessions
// + admin redirect.
//
// Server-wrapper + client-island pattern: the polling + status logic
// stays in `thank-you-content.tsx` (client); session detection happens
// here before the island renders. `hasSession` flows down as a prop.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Спасибо за оплату — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function ThankYouPage() {
  const cookieStore = await cookies()
  const hasSession = Boolean(cookieStore.get(SESSION_COOKIE_NAME)?.value)
  return <ThankYouContent hasSession={hasSession} />
}
