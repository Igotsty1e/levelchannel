import type { Metadata } from 'next'
import Link from 'next/link'

import { PricingSection } from '@/components/payments/pricing-section'

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

export default function PayPage() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header
        style={{
          padding: '20px 0',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(11, 11, 12, 0.85)',
          backdropFilter: 'blur(12px)',
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
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            LevelChannel
          </Link>
          <Link
            href="/"
            style={{
              color: 'var(--secondary)',
              textDecoration: 'none',
              fontSize: 14,
            }}
          >
            ← На главную
          </Link>
        </div>
      </header>

      <PricingSection />
    </main>
  )
}
