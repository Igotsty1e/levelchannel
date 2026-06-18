import type { Metadata } from 'next'

import { LandingV3 } from '@/components/saas/landing-v3/landing-v3'
import {
  LEGAL_BANK_ACCOUNT,
  LEGAL_BANK_BIK,
  LEGAL_BANK_CITY,
  LEGAL_BANK_NAME,
  LEGAL_OPERATOR_DISPLAY,
  LEGAL_OPERATOR_OGRN,
  LEGAL_OPERATOR_TAX_ID,
} from '@/lib/legal/public-profile'

export const metadata: Metadata = {
  title: 'LevelChannel — CRM для частного репетитора. Стартовый — бесплатно, навсегда',
  description:
    'Кабинет для частного репетитора: расписание, ученики, балансы, СБП и месячный отчёт. Стартовый — 0 ₽ навсегда, до 3 учеников. Оптимальный — 399 ₽/мес, без ограничения по ученикам. Без карты при регистрации.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'LevelChannel — CRM для частного репетитора',
    description: 'Стартовый навсегда бесплатный, до 3 учеников. Оптимальный 399 ₽/мес, без ограничения.',
    type: 'website',
  },
}

export default function HomePage() {
  return (
    <LandingV3
      legalProfile={{
        legalBankAccount: LEGAL_BANK_ACCOUNT,
        legalBankBik: LEGAL_BANK_BIK,
        legalBankName: LEGAL_BANK_NAME,
        legalBankCity: LEGAL_BANK_CITY,
        legalOperatorDisplay: LEGAL_OPERATOR_DISPLAY,
        legalOperatorTaxId: LEGAL_OPERATOR_TAX_ID,
        legalOperatorOgrn: LEGAL_OPERATOR_OGRN,
      }}
    />
  )
}
