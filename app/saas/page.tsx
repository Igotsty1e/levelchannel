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
  title: 'LevelChannel — кабинет для репетитора',
  description:
    'Расписание, ученики, балансы и пакеты — в одном кабинете. Free навсегда; Mid и Pro — когда учеников становится больше.',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
  openGraph: {
    title: 'LevelChannel — кабинет для репетитора',
    description:
      'Расписание, ученики, балансы и пакеты — в одном кабинете. Free навсегда; Mid и Pro — когда учеников становится больше.',
    type: 'website',
  },
}

export default function SaasPage() {
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
