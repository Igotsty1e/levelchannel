import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
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
  return (
    <html lang="ru" className={inter.variable}>
      <body>
        <Script
          src="https://widget.cloudpayments.ru/bundles/cloudpayments.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  )
}
