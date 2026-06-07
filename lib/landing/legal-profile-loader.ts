// Legal-profile loader per saas-landing-tier1-v2 plan §0z (round-2 WARN #5 closure).
// Wraps the existing public-profile consts into one structured object.
// Eliminates inline-object duplication across landing surfaces.
//
// Prod boot-time guard: imports from @/lib/legal/public-profile which throws
// if NEXT_PUBLIC_LEGAL_* env vars are missing in production (see lib/legal/public-profile.ts:21).
// No new boot-time risk introduced.

import {
  LEGAL_BANK_ACCOUNT,
  LEGAL_BANK_BIK,
  LEGAL_BANK_NAME,
  LEGAL_OPERATOR_DISPLAY,
  LEGAL_OPERATOR_OGRN,
  LEGAL_OPERATOR_TAX_ID,
  PUBLIC_CONTACT_EMAIL,
} from '@/lib/legal/public-profile'

export type LandingLegalProfile = {
  legalOperatorDisplay: string
  legalOperatorTaxId: string
  legalOperatorOgrn: string
  legalBankAccount: string
  legalBankName: string
  legalBankBik: string
  publicContactEmail: string
}

export function loadLegalProfile(): LandingLegalProfile {
  return {
    legalOperatorDisplay: LEGAL_OPERATOR_DISPLAY,
    legalOperatorTaxId: LEGAL_OPERATOR_TAX_ID,
    legalOperatorOgrn: LEGAL_OPERATOR_OGRN,
    legalBankAccount: LEGAL_BANK_ACCOUNT,
    legalBankName: LEGAL_BANK_NAME,
    legalBankBik: LEGAL_BANK_BIK,
    publicContactEmail: PUBLIC_CONTACT_EMAIL,
  }
}
