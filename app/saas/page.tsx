import type { Metadata } from 'next'

import {
  LEGAL_BANK_ACCOUNT,
  LEGAL_BANK_BIK,
  LEGAL_BANK_NAME,
  LEGAL_OPERATOR_DISPLAY,
  LEGAL_OPERATOR_OGRN,
  LEGAL_OPERATOR_TAX_ID,
} from '@/lib/legal/public-profile'
import { TeacherLandingClient } from '@/components/home/teacher-landing-client'

export const metadata: Metadata = {
  title: 'LevelChannel для преподавателей — тестовый SaaS-лендинг',
  description:
    'Тестовый SaaS-лендинг для преподавателей: расписание, ученики и оплаты в одном кабинете.',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
  openGraph: {
    title: 'LevelChannel — кабинет преподавателя',
    description:
      'Тестовый SaaS-лендинг для преподавателей. Расписание, ученики и оплаты в одном кабинете.',
    type: 'website',
  },
}

export default function SaasPage() {
  console.log('[landing] view', {
    ts: new Date().toISOString(),
    page: '/saas',
    epic: 'saas-pivot-epic-8-temp-surface',
  })

  return (
    <TeacherLandingClient
      legalProfile={{
        legalBankAccount: LEGAL_BANK_ACCOUNT,
        legalBankBik: LEGAL_BANK_BIK,
        legalBankName: LEGAL_BANK_NAME,
        legalOperatorDisplay: LEGAL_OPERATOR_DISPLAY,
        legalOperatorTaxId: LEGAL_OPERATOR_TAX_ID,
        legalOperatorOgrn: LEGAL_OPERATOR_OGRN,
      }}
    />
  )
}
