import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
})

// SAAS-PIVOT Epic 8 Day 7 (2026-05-22) — root-layout default metadata
// flipped to the SaaS-positioning ("кабинет преподавателя"). The old
// learner-targeted operator-instance copy ("8 лет опыта, 10 000+
// часов преподавания") is dropped per owner decision 2026-05-21
// ("только для учителей"). Per-route `metadata` exports (e.g.
// `/pay`, `/offer`, `/privacy`) override these defaults as before.
export const metadata: Metadata = {
  title: 'LevelChannel — кабинет преподавателя',
  description:
    'Расписание, ученики и оплаты в одном кабинете. Личный кабинет для преподавателей английского и репетиторов. Бесплатный тариф навсегда.',
  keywords:
    'CRM для репетитора, расписание для преподавателя, онлайн-запись для репетитора, кабинет преподавателя английского',
  openGraph: {
    title: 'LevelChannel — кабинет преподавателя',
    description:
      'Расписание, ученики и оплаты — без Excel и переписок. Free тариф навсегда.',
    type: 'website',
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
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
  return (
    <html lang="ru" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
