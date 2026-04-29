export const PERSONAL_DATA_DOCUMENT_VERSION = '2026-04-29'
export const PERSONAL_DATA_CONSENT_PATH = '/consent/personal-data'
export const PERSONAL_DATA_POLICY_PATH = '/privacy'

export const PERSONAL_DATA_CONSENT_LABEL =
  'Я даю согласие на обработку моих персональных данных в целях оплаты, связи по заказу и исполнения договора.'

export type PersonalDataConsentSnapshot = {
  accepted: true
  acceptedAt: string
  documentVersion: string
  documentPath: string
  policyPath: string
  checkboxLabel: string
  source: 'checkout'
  ipAddress?: string
  userAgent?: string
}

export function buildPersonalDataConsentSnapshot(params: {
  acceptedAt?: string
  ipAddress?: string
  userAgent?: string
}): PersonalDataConsentSnapshot {
  return {
    accepted: true,
    acceptedAt: params.acceptedAt || new Date().toISOString(),
    documentVersion: PERSONAL_DATA_DOCUMENT_VERSION,
    documentPath: PERSONAL_DATA_CONSENT_PATH,
    policyPath: PERSONAL_DATA_POLICY_PATH,
    checkboxLabel: PERSONAL_DATA_CONSENT_LABEL,
    source: 'checkout',
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  }
}
