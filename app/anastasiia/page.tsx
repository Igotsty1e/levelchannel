import type { Metadata } from 'next'

import {
  LEGAL_BANK_ACCOUNT,
  LEGAL_BANK_BIK,
  LEGAL_BANK_NAME,
  LEGAL_OPERATOR_DISPLAY,
  LEGAL_OPERATOR_OGRN,
  LEGAL_OPERATOR_TAX_ID,
} from '@/lib/legal/public-profile'
import { HomePageClient } from '@/components/home/home-page-client'

export const metadata: Metadata = {
  title: 'Анастасия — преподаватель английского',
  description:
    'Уроки английского с Анастасией. Уровни C1–C2, разговорная практика, подготовка к экзаменам.',
  alternates: { canonical: '/anastasiia' },
}

export default function AnastasiiaPage() {
  return (
    <HomePageClient
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
