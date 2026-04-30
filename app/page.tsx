import {
  LEGAL_BANK_ACCOUNT,
  LEGAL_BANK_BIK,
  LEGAL_BANK_NAME,
  LEGAL_OPERATOR_DISPLAY,
  LEGAL_OPERATOR_TAX_ID,
} from '@/lib/legal/public-profile'
import { HomePageClient } from '@/components/home/home-page-client'

export default function HomePage() {
  return (
    <HomePageClient
      legalProfile={{
        legalBankAccount: LEGAL_BANK_ACCOUNT,
        legalBankBik: LEGAL_BANK_BIK,
        legalBankName: LEGAL_BANK_NAME,
        legalOperatorDisplay: LEGAL_OPERATOR_DISPLAY,
        legalOperatorTaxId: LEGAL_OPERATOR_TAX_ID,
      }}
    />
  )
}
