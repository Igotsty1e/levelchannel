export const MIN_PAYMENT_AMOUNT_RUB = 10
export const MAX_PAYMENT_AMOUNT_RUB = 10000

export const PAYMENT_DESCRIPTION = 'Оплата услуг LevelChannel'
export const PAYMENT_ITEM_NAME = 'Оплата услуг LevelChannel'

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
