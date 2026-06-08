import type { ReactNode } from 'react'

import { LandingHeader } from '@/components/saas/landing-v4/_shared/header'
import { LandingFooter } from '@/components/saas/landing-v4/_shared/footer'
import { ScrollProgress } from '@/components/saas/landing-v4/_shared/scroll-progress'
import {
  LEGAL_BANK_ACCOUNT,
  LEGAL_BANK_BIK,
  LEGAL_BANK_NAME,
  LEGAL_OPERATOR_DISPLAY,
  LEGAL_OPERATOR_OGRN,
  LEGAL_OPERATOR_TAX_ID,
} from '@/lib/legal/public-profile'

import '@/components/saas/landing-v4/_shared/tokens.css'

export default function LearnLayout({ children }: { children: ReactNode }) {
  const legalProfile = {
    legalBankAccount: LEGAL_BANK_ACCOUNT,
    legalBankBik: LEGAL_BANK_BIK,
    legalBankName: LEGAL_BANK_NAME,
    legalOperatorDisplay: LEGAL_OPERATOR_DISPLAY,
    legalOperatorTaxId: LEGAL_OPERATOR_TAX_ID,
    legalOperatorOgrn: LEGAL_OPERATOR_OGRN,
  }
  return (
    <main className="landing-v4">
      <ScrollProgress />
      <LandingHeader />
      {children}
      <LandingFooter legalProfile={legalProfile} />
    </main>
  )
}
