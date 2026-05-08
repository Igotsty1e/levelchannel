import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'LevelChannel — Индивидуальный английский под вашу цель',
  description:
    'Индивидуальные онлайн-занятия по английскому 1:1. Подготовка к IELTS, английский для работы, разговорный английский. 8 лет опыта, 10 000+ часов преподавания.',
  keywords: 'английский онлайн, репетитор английского, IELTS подготовка, индивидуальные занятия, английский для работы',
  openGraph: {
    title: 'LevelChannel — Индивидуальный английский под вашу цель',
    description:
      'Индивидуальные занятия 1:1. 8 лет опыта, 10 000+ часов преподавания.',
    type: 'website',
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
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
