// Stub для prototype landing-v3 (in-progress, не на branch). Реальный
// loader находится в отдельной landing-v2 ветке — этот стаб нужен лишь
// чтобы build на `feat/teacher-payments-sbp-self-service-clean` не падал
// из-за импортов untracked-файлов в components/saas/landing-v3.

export type LandingLegalProfile = {
  legalOperatorDisplay: string
  legalOperatorTaxId: string
  legalOperatorOgrn: string
  legalBankAccount: string
  legalBankName: string
  legalBankBik: string
}

export function loadLegalProfile(): LandingLegalProfile {
  return {
    legalOperatorDisplay: '',
    legalOperatorTaxId: '',
    legalOperatorOgrn: '',
    legalBankAccount: '',
    legalBankName: '',
    legalBankBik: '',
  }
}
