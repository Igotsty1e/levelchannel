import { paymentConfig } from '@/lib/payments/config'

// https://developers.cloudpayments.ru/#oplata-po-tokenu-odnostadiynaya
const TOKENS_CHARGE_URL = 'https://api.cloudpayments.ru/payments/tokens/charge'

// https://developers.cloudpayments.ru/#zavershenie-platezha-posle-3-d-secure
const POST3DS_URL = 'https://api.cloudpayments.ru/payments/cards/post3ds'

export type CloudPaymentsTokenChargeRequest = {
  amount: number
  token: string
  accountId: string
  invoiceId: string
  description: string
  ipAddress?: string
  email?: string
}

export type CloudPaymentsTokenChargeResult =
  | {
      kind: 'success'
      transactionId: string
      token?: string
      cardLastFour?: string
      cardType?: string
      cardExpDate?: string
      raw: unknown
    }
  | {
      kind: 'requires_3ds'
      transactionId: string
      paReq: string
      acsUrl: string
      threeDsCallbackId?: string
      raw: unknown
    }
  | {
      kind: 'declined'
      transactionId?: string
      message: string
      reasonCode?: number | string
      raw: unknown
    }
  | {
      kind: 'error'
      message: string
      raw: unknown
    }

export type CloudPaymentsConfirmThreeDsResult =
  | {
      kind: 'success'
      transactionId: string
      token?: string
      cardLastFour?: string
      cardType?: string
      cardExpDate?: string
      raw: unknown
    }
  | {
      kind: 'declined'
      transactionId?: string
      message: string
      reasonCode?: number | string
      raw: unknown
    }
  | {
      kind: 'error'
      message: string
      raw: unknown
    }

function basicAuthHeader() {
  const { publicId, apiSecret } = paymentConfig.cloudpayments
  const token = Buffer.from(`${publicId}:${apiSecret}`).toString('base64')
  return `Basic ${token}`
}

function pickString(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number') {
    return String(value)
  }

  return undefined
}

export async function chargeWithSavedToken(
  request: CloudPaymentsTokenChargeRequest,
): Promise<CloudPaymentsTokenChargeResult> {
  if (!paymentConfig.cloudpayments.publicId || !paymentConfig.cloudpayments.apiSecret) {
    return {
      kind: 'error',
      message: 'CloudPayments credentials are not configured.',
      raw: null,
    }
  }

  const body = {
    Amount: request.amount,
    Currency: 'RUB',
    Token: request.token,
    AccountId: request.accountId,
    InvoiceId: request.invoiceId,
    Description: request.description,
    IpAddress: request.ipAddress,
    Email: request.email,
  }

  let response: Response

  try {
    response = await fetch(TOKENS_CHARGE_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Network error.',
      raw: null,
    }
  }

  if (!response.ok) {
    return {
      kind: 'error',
      message: `CloudPayments responded with HTTP ${response.status}.`,
      raw: null,
    }
  }

  let payload: Record<string, unknown>

  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Invalid JSON response.',
      raw: null,
    }
  }

  const success = payload.Success === true
  const message = pickString(payload.Message) || ''
  const model = (payload.Model as Record<string, unknown> | undefined) || {}

  const transactionId = pickString(model.TransactionId)
  const paReq = pickString(model.PaReq)
  const acsUrl = pickString(model.AcsUrl)
  const threeDsCallbackId = pickString(model.ThreeDsCallbackId)
  const reasonCode = pickString(model.ReasonCode) || pickString(payload.ReasonCode)

  if (success && transactionId) {
    return {
      kind: 'success',
      transactionId,
      token: pickString(model.Token),
      cardLastFour: pickString(model.CardLastFour),
      cardType: pickString(model.CardType),
      cardExpDate: pickString(model.CardExpDate),
      raw: payload,
    }
  }

  if (paReq && acsUrl && transactionId) {
    return {
      kind: 'requires_3ds',
      transactionId,
      paReq,
      acsUrl,
      threeDsCallbackId,
      raw: payload,
    }
  }

  return {
    kind: 'declined',
    transactionId,
    message: pickString(model.CardHolderMessage) || message || 'Платёж отклонён.',
    reasonCode,
    raw: payload,
  }
}

export type CloudPaymentsConfirmThreeDsRequest = {
  transactionId: string
  paRes: string
}

export async function confirmThreeDs(
  request: CloudPaymentsConfirmThreeDsRequest,
): Promise<CloudPaymentsConfirmThreeDsResult> {
  if (!paymentConfig.cloudpayments.publicId || !paymentConfig.cloudpayments.apiSecret) {
    return {
      kind: 'error',
      message: 'CloudPayments credentials are not configured.',
      raw: null,
    }
  }

  let response: Response

  try {
    response = await fetch(POST3DS_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        TransactionId: request.transactionId,
        PaRes: request.paRes,
      }),
      cache: 'no-store',
    })
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Network error.',
      raw: null,
    }
  }

  if (!response.ok) {
    return {
      kind: 'error',
      message: `CloudPayments responded with HTTP ${response.status}.`,
      raw: null,
    }
  }

  let payload: Record<string, unknown>

  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Invalid JSON response.',
      raw: null,
    }
  }

  const success = payload.Success === true
  const message = pickString(payload.Message) || ''
  const model = (payload.Model as Record<string, unknown> | undefined) || {}

  const transactionId = pickString(model.TransactionId)
  const reasonCode = pickString(model.ReasonCode) || pickString(payload.ReasonCode)

  if (success && transactionId) {
    return {
      kind: 'success',
      transactionId,
      token: pickString(model.Token),
      cardLastFour: pickString(model.CardLastFour),
      cardType: pickString(model.CardType),
      cardExpDate: pickString(model.CardExpDate),
      raw: payload,
    }
  }

  return {
    kind: 'declined',
    transactionId,
    message: pickString(model.CardHolderMessage) || message || 'Платёж отклонён банком.',
    reasonCode,
    raw: payload,
  }
}
