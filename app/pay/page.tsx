import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import Script from 'next/script'

import { BrandMark } from '@/components/brand/brand-mark'
import { PricingSection } from '@/components/payments/pricing-section'
import { SESSION_COOKIE_NAME } from '@/lib/auth/sessions'

// Standalone payment page. The same `<PricingSection />` that renders
// inside the landing also lives here at a clean, shareable URL —
// e.g. operator can DM "https://levelchannel.ru/pay" instead of
// "https://levelchannel.ru/#pricing" which jumps mid-scroll.
//
// CloudPayments registration accepts a domain, not a specific URL,
// so this page works under the existing terminal without any
// merchant-side reconfiguration. Webhook handlers live on
// /api/payments/webhooks/... and are URL-stable.
//
// SEO: noindex by default. The landing is the discoverable surface;
// /pay is for direct links and from-landing navigation.

export const metadata: Metadata = {
  title: 'Оплата — LevelChannel',
  description: 'Оплата индивидуальных занятий по английскому языку.',
  robots: {
    index: false,
    follow: false,
  },
}

export default async function PayPage() {
  // BUG-1 (2026-05-14): logged-in learners arriving on /pay from a path
  // where the cabinet isn't in browser history (e.g. landing → /pay,
  // login flow → /pay) were confused that the only visible back-affordance
  // sent them to / (home). For authenticated users, point the back link
  // at /cabinet instead. We only check cookie PRESENCE — the cabinet page
  // itself handles invalid/expired sessions by redirecting to /login.
  const cookieStore = await cookies()
  const hasSession = Boolean(cookieStore.get(SESSION_COOKIE_NAME)?.value)
  const backHref = hasSession ? '/cabinet' : '/'
  const backLabel = hasSession ? '← В кабинет' : '← На главную'

  return (
    <>
      <main style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Codex 2026-05-08 (Wave 10 #5) — платёжный виджет грузится
          только здесь (и на /checkout/[tariffSlug]), не из layout. */}
      <Script
        src="https://widget.cloudpayments.ru/bundles/cloudpayments.js"
        strategy="beforeInteractive"
      />
      <header
        style={{
          padding: '20px 0',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg)',
        }}
      >
        <div
          className="container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <Link
            href="/"
            style={{
              color: 'var(--text)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
            aria-label="LevelChannel — на главную"
          >
            <BrandMark variant="full" width={150} />
          </Link>
          <Link
            href={backHref}
            style={{
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              fontSize: 13,
            }}
          >
            {backLabel}
          </Link>
        </div>
      </header>

      <PricingSection />
      </main>
    </>
  )
}
