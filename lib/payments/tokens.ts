import type { CloudPaymentsWebhookPayload } from '@/lib/payments/cloudpayments-webhook'
import { upsertCardToken } from '@/lib/payments/store'
import type { PaymentOrder, PublicSavedCard, SavedCardToken } from '@/lib/payments/types'

// CardExpDate приходит в формате "MM/YY".
function parseCardExp(value: string | undefined) {
  if (!value || !/^\d{2}\/\d{2}$/.test(value)) {
    return { month: undefined, year: undefined }
  }

  const [month, year] = value.split('/')
  return { month, year }
}

// Достаём согласие пользователя на сохранение карты. Источники по приоритету:
// 1. metadata ордера (то, что мы сами пометили при создании платежа) —
//    это наш source of truth, его пользователь подтвердил чекбоксом.
// 2. Data / JsonData в payload вебхука — на случай, если ордер недоступен
//    (хотя такой кейс мы стараемся исключить через атомарную выборку).
export function readRememberCardConsent(
  payload: CloudPaymentsWebhookPayload,
  order: PaymentOrder | null,
): boolean {
  if (order?.metadata && typeof order.metadata.rememberCard === 'boolean') {
    return order.metadata.rememberCard
  }

  const raw =
    typeof payload.Data === 'string'
      ? payload.Data
      : typeof payload.JsonData === 'string'
        ? payload.JsonData
        : null

  if (!raw) {
    return false
  }

  try {
    const parsed = JSON.parse(raw) as { rememberCard?: unknown }
    return parsed.rememberCard === true
  } catch {
    return false
  }
}

export function extractTokenFromWebhookPayload(
  payload: CloudPaymentsWebhookPayload,
  customerEmail: string,
): SavedCardToken | null {
  const token = typeof payload.Token === 'string' ? payload.Token.trim() : ''

  if (!token || !customerEmail) {
    return null
  }

  const exp = parseCardExp(
    typeof payload.CardExpDate === 'string' ? payload.CardExpDate : undefined,
  )
  const now = new Date().toISOString()

  return {
    customerEmail,
    token,
    cardLastFour:
      typeof payload.CardLastFour === 'string' ? payload.CardLastFour : undefined,
    cardType:
      typeof payload.CardType === 'string' ? payload.CardType : undefined,
    cardExpMonth: exp.month,
    cardExpYear: exp.year,
    createdAt: now,
    lastUsedAt: now,
  }
}

// Сохраняем токен ТОЛЬКО если пользователь явно согласился (rememberCard=true).
// Дефолт — не сохранять, даже если CloudPayments прислал Token.
// Это требование 152-ФЗ + ожидание пользователя.
export async function maybePersistTokenFromWebhook(
  payload: CloudPaymentsWebhookPayload,
  customerEmail: string,
  order: PaymentOrder | null,
) {
  const consented = readRememberCardConsent(payload, order)

  if (!consented) {
    return null
  }

  const next = extractTokenFromWebhookPayload(payload, customerEmail)

  if (!next) {
    return null
  }

  return upsertCardToken(next)
}

export function toPublicSavedCard(token: SavedCardToken): PublicSavedCard {
  return {
    cardLastFour: token.cardLastFour,
    cardType: token.cardType,
    createdAt: token.createdAt,
  }
}
