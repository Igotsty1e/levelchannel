export const MIN_PAYMENT_AMOUNT_RUB = 10
export const MAX_PAYMENT_AMOUNT_RUB = 50000

export const PAYMENT_DESCRIPTION = 'Оплата дополнительных занятий по английскому языку'
export const PAYMENT_ITEM_NAME = 'Оплата дополнительных занятий по английскому языку'

export const PAYMENT_COMMENT_MAX_LENGTH = 128

// Validate and normalize the optional customer comment field. Returns
// the cleaned string (≤128 chars after trim, control chars stripped),
// or `null` for empty/unset, or an error object for too-long input.
//
// Why strip control chars: the comment ends up in the CloudPayments
// `description` field and on the bank statement / chek; control bytes
// in those fields cause unpredictable rendering and are a tiny info-
// channel for someone trying to embed steering bytes into a receipt.
// Visible Unicode (cyrillic, emoji, etc) is fine.
export function validateCustomerComment(
  value: unknown,
):
  | { ok: true; comment: string | null }
  | { ok: false; reason: 'too_long'; message: string } {
  if (value == null || value === '') {
    return { ok: true, comment: null }
  }
  if (typeof value !== 'string') {
    return { ok: true, comment: null } // be lenient on bad type — treat as empty
  }
  // Strip C0 / C1 control characters before measuring length so a
  // sneaky `\u0000` * 200 doesn't flag the user's 50-char text.
  const stripped = value.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim()
  if (!stripped) {
    return { ok: true, comment: null }
  }
  if (stripped.length > PAYMENT_COMMENT_MAX_LENGTH) {
    return {
      ok: false,
      reason: 'too_long',
      message: `Комментарий не должен превышать ${PAYMENT_COMMENT_MAX_LENGTH} символов.`,
    }
  }
  return { ok: true, comment: stripped }
}

// Compose the human-readable description shown on the bank statement /
// chek. Always begins with the canonical PAYMENT_DESCRIPTION; if the
// customer supplied a comment, append it; always append the amount so
// even contextless statements read clearly.
export function buildPaymentDescription(
  amountRub: number,
  customerComment: string | null,
): string {
  const formatted = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amountRub)
  const parts = [PAYMENT_DESCRIPTION]
  if (customerComment) {
    parts.push(customerComment)
  }
  parts.push(`${formatted} ₽`)
  return parts.join(' — ')
}

export function normalizePaymentAmount(amount: number) {
  return Math.round(amount * 100) / 100
}

export function isValidPaymentAmount(amount: number) {
  return (
    Number.isFinite(amount) &&
    amount >= MIN_PAYMENT_AMOUNT_RUB &&
    amount <= MAX_PAYMENT_AMOUNT_RUB
  )
}

export function normalizeCustomerEmail(value: string) {
  return value.trim().toLowerCase()
}

export function validateCustomerEmail(value: string) {
  const email = normalizeCustomerEmail(value)

  if (!email) {
    return { ok: false as const, reason: 'required', message: 'Укажите e-mail.' }
  }

  if (email.length > 254) {
    return { ok: false as const, reason: 'too_long', message: 'E-mail слишком длинный.' }
  }

  if (/\s/.test(email)) {
    return { ok: false as const, reason: 'spaces', message: 'E-mail не должен содержать пробелы.' }
  }

  const parts = email.split('@')
  if (parts.length !== 2) {
    return { ok: false as const, reason: 'format', message: 'Введите e-mail в формате name@example.com.' }
  }

  const [localPart, domainPart] = parts

  if (!localPart || !domainPart) {
    return { ok: false as const, reason: 'format', message: 'Введите e-mail в формате name@example.com.' }
  }

  if (localPart.length > 64) {
    return { ok: false as const, reason: 'local_too_long', message: 'Слишком длинная часть e-mail до @.' }
  }

  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return { ok: false as const, reason: 'local_dots', message: 'В e-mail некорректно расставлены точки.' }
  }

  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)) {
    return { ok: false as const, reason: 'local_chars', message: 'В e-mail есть недопустимые символы.' }
  }

  if (domainPart.includes('..') || !domainPart.includes('.')) {
    return { ok: false as const, reason: 'domain_format', message: 'Укажите корректный домен e-mail.' }
  }

  const domainLabels = domainPart.split('.')

  if (
    domainLabels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith('-') ||
        label.endsWith('-') ||
        !/^[a-z0-9-]+$/i.test(label),
    )
  ) {
    return { ok: false as const, reason: 'domain_label', message: 'Укажите корректный домен e-mail.' }
  }

  const tld = domainLabels[domainLabels.length - 1]
  if (tld.length < 2) {
    return { ok: false as const, reason: 'tld', message: 'Укажите корректный домен e-mail.' }
  }

  return { ok: true as const, email }
}

export function isValidCustomerEmail(value: string) {
  return validateCustomerEmail(value).ok
}

export function formatRubles(amount: number) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}
