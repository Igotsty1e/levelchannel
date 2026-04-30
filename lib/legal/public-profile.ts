const env = process.env

const legalProfileKeys = [
  'NEXT_PUBLIC_LEGAL_OPERATOR_NAME',
  'NEXT_PUBLIC_LEGAL_OPERATOR_DISPLAY',
  'NEXT_PUBLIC_LEGAL_OPERATOR_TAX_ID',
  'NEXT_PUBLIC_PUBLIC_CONTACT_EMAIL',
  'NEXT_PUBLIC_LEGAL_BANK_ACCOUNT',
  'NEXT_PUBLIC_LEGAL_BANK_NAME',
  'NEXT_PUBLIC_LEGAL_BANK_BIK',
  'NEXT_PUBLIC_LEGAL_BANK_CORR_ACCOUNT',
  'NEXT_PUBLIC_LEGAL_BANK_CITY',
] as const

const isProdLike =
  env.NODE_ENV === 'production' || env.NEXT_PHASE === 'phase-production-build'

if (isProdLike) {
  const missingKeys = legalProfileKeys.filter((key) => !env[key]?.trim())

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required public legal profile env vars: ${missingKeys.join(', ')}`
    )
  }
}

export const LEGAL_OPERATOR_NAME =
  env.NEXT_PUBLIC_LEGAL_OPERATOR_NAME || 'Individual Entrepreneur Example Operator'

export const LEGAL_OPERATOR_DISPLAY =
  env.NEXT_PUBLIC_LEGAL_OPERATOR_DISPLAY || LEGAL_OPERATOR_NAME

export const LEGAL_OPERATOR_TAX_ID =
  env.NEXT_PUBLIC_LEGAL_OPERATOR_TAX_ID || '000000000000'

export const PUBLIC_CONTACT_EMAIL =
  env.NEXT_PUBLIC_PUBLIC_CONTACT_EMAIL || 'contact@example.com'

export const LEGAL_BANK_ACCOUNT =
  env.NEXT_PUBLIC_LEGAL_BANK_ACCOUNT || '00000000000000000000'

export const LEGAL_BANK_NAME =
  env.NEXT_PUBLIC_LEGAL_BANK_NAME || 'Example Bank LLC'

export const LEGAL_BANK_BIK =
  env.NEXT_PUBLIC_LEGAL_BANK_BIK || '000000000'

export const LEGAL_BANK_CORR_ACCOUNT =
  env.NEXT_PUBLIC_LEGAL_BANK_CORR_ACCOUNT || '00000000000000000000'

export const LEGAL_BANK_CITY =
  env.NEXT_PUBLIC_LEGAL_BANK_CITY || 'Moscow'
