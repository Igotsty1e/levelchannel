import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'

import { ServiceWorkerRegistration } from './service-worker-registration'

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
})

// metadataBase fixes og:image/twitter:image generation in prod —
// without it Next.js falls back to localhost:3000 (broken unfurls
// on LinkedIn/Telegram/FB). Pulls from NEXT_PUBLIC_SITE_URL env so
// staging vs prod resolve correctly.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://levelchannel.ru'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Neutral default for routes that don't set their own metadata
  // (e.g. /login, /register, /thank-you). Anastasia + landing-v3
  // override via page-level metadata exports.
  title: 'LevelChannel',
  description:
    'LevelChannel — продукты для онлайн-обучения: CRM-кабинет для частного репетитора и индивидуальные занятия английским.',
  openGraph: {
    title: 'LevelChannel',
    description: 'CRM-кабинет для частного репетитора и индивидуальные занятия английским.',
    type: 'website',
    url: SITE_URL,
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
  manifest: '/manifest.webmanifest',
}

// BCS-DEF-4-PUSH (2026-06-06) — PWA theme color (matches manifest
// background_color + cabinet design system var). Lives in viewport
// per Next.js 14+ metadata API rules.
export const viewport: Viewport = {
  themeColor: '#0a0c10',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Wave 11 PR 1.2 — read the per-request nonce from the request
  // headers (set by `proxy.ts`). The READ itself is the load-bearing
  // side-effect: it puts the layout into dynamic-render mode, which
  // is what activates Next.js's auto-stamping of `nonce=` on the
  // framework-emitted RSC hydration payload `<script>` blocks. See
  // closed upstream issue vercel/next.js#43743 (closed in 13.4.0)
  // where Vercel maintainers confirmed the trick.
  //
  // The variable is intentionally unused after the read — the read is
  // what matters. Future code that needs the nonce explicitly (e.g. a
  // manual `<Script nonce={nonce}>` for a third-party loader) can use
  // it directly.
  const nonce = (await headers()).get('x-nonce') ?? undefined
  void nonce

  // Codex 2026-05-08 (Wave 10 #5 / MEDIUM legal) — CloudPayments
  // widget script is loaded ONLY on the payment-stage pages
  // (`/pay`, `/checkout/[tariffSlug]`) instead of globally. Privacy
  // text frames CloudPayments as a payment-stage processor; loading
  // their script on /offer / /privacy / / etc. contradicted that
  // framing AND added a third-party connection on every page view.
  // Page-level injection keeps the script next to its only consumers
  // (PricingSection, CheckoutForm).
  // Organization schema — global JSON-LD for entire site. Each
  // page can stack additional schema (e.g. SoftwareApplication for
  // SEO learn-pages via SeoArticle, Service for Anastasia page).
  const orgSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'LevelChannel',
    url: SITE_URL,
    logo: `${SITE_URL}/favicon.svg`,
    sameAs: [],
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'support@levelchannel.ru',
      contactType: 'customer support',
      areaServed: 'RU',
      availableLanguage: ['ru'],
    },
  }

  return (
    <html lang="ru" className={inter.variable}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  )
}
