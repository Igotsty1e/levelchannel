// SBP self-service: учительский СБП-номер. Russian format strictly:
// `+7XXXXXXXXXX` (11 digits incl. country code).
//
// Normalize accepts:
//   - +7 (912) 345-67-89
//   - 8 912 345 67 89
//   - 89123456789
//   - +79123456789
// Returns `+7XXXXXXXXXX` or null if invalid.

const RU_PHONE_RE = /^\+7\d{10}$/

export function normalizePhoneRu(input: string): string | null {
  if (typeof input !== 'string') return null
  const digits = input.replace(/\D/g, '')
  if (digits.length === 0) return null
  let body: string
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    body = digits.slice(1)
  } else if (digits.length === 10) {
    body = digits
  } else {
    return null
  }
  if (body.length !== 10) return null
  const result = '+7' + body
  return RU_PHONE_RE.test(result) ? result : null
}

// Display format: `+7 (XXX) XXX-XX-XX`. Accepts E.164 input.
export function formatPhoneRu(e164: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164)
  if (!m) return e164
  return `+7 (${m[1]}) ${m[2]}-${m[3]}-${m[4]}`
}

export function isValidPhoneRu(e164: string): boolean {
  return RU_PHONE_RE.test(e164)
}

export const KNOWN_BANKS_RU = [
  'Тинькофф',
  'Сбер',
  'Альфа-Банк',
  'ВТБ',
  'Райффайзенбанк',
  'Газпромбанк',
  'Открытие',
  'Совкомбанк',
] as const
