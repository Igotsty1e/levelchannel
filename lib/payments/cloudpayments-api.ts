import { paymentConfig } from '@/lib/payments/config'

// https://developers.cloudpayments.ru/#oplata-po-tokenu-odnostadiynaya
const TOKENS_CHARGE_URL = 'https://api.cloudpayments.ru/payments/tokens/charge'

// https://developers.cloudpayments.ru/#zavershenie-platezha-posle-3-d-secure
const POST3DS_URL = 'https://api.cloudpayments.ru/payments/cards/post3ds'

// https://developers.cloudpayments.ru/#vozvrat-deneg
const REFUND_URL = 'https://api.cloudpayments.ru/payments/refund'

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

export type CloudPaymentsRefundRequest = {
  // Original successful charge's TransactionId, as returned by
  // /payments/tokens/charge or captured from the Check/Pay webhook.
  transactionId: string
  // Decimal RUB amount (omit for full refund of the original).
  // The CP API accepts partial refunds against the same transaction
  // until SUM(refunds) reaches the captured amount.
  amount?: number
  // Optional metadata stamped on the refund record on the CP side.
  // We pass a JSON string with our invoiceId + reversal context so
  // the refund is traceable in their dashboard.
  jsonData?: string
}

export type CloudPaymentsRefundResult =
  | {
      kind: 'success'
      // CP returns a fresh transactionId for the refund operation.
      // We store it on the reversal row as the gateway breadcrumb.
      transactionId: string
      raw: Record<string, unknown> | null
    }
  | {
      kind: 'declined'
      message: string
      reasonCode: string | undefined
      raw: Record<string, unknown> | null
    }
  | {
      kind: 'error'
      message: string
      raw: Record<string, unknown> | null
    }

// POST https://api.cloudpayments.ru/payments/refund
// Basic auth (PublicID:APISecret). On Success=true the bank-side
// refund is queued; the actual money settlement is asynchronous and
// surfaces via the `Refund` webhook notification.
export async function refundTransaction(
  request: CloudPaymentsRefundRequest,
): Promise<CloudPaymentsRefundResult> {
  if (
    !paymentConfig.cloudpayments.publicId ||
    !paymentConfig.cloudpayments.apiSecret
  ) {
    return {
      kind: 'error',
      message: 'CloudPayments credentials are not configured.',
      raw: null,
    }
  }
  // Empty/whitespace transactionId would cause CP to 400 with a
  // useless message; catch it up front so the operator sees a clean
  // "no TransactionId on this order" rather than a gateway error.
  if (!request.transactionId.trim()) {
    return {
      kind: 'error',
      message: 'TransactionId is required for a gateway refund.',
      raw: null,
    }
  }
  // Wave 60 guard rail. Use parametric body so additional optional
  // fields (Amount, JsonData) only land on the wire when set.
  const body: Record<string, unknown> = {
    TransactionId: request.transactionId,
  }
  if (typeof request.amount === 'number') {
    body.Amount = request.amount
  }
  if (request.jsonData) {
    body.JsonData = request.jsonData
  }

  let response: Response
  try {
    response = await fetch(REFUND_URL, {
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
  const reasonCode = pickString(model.ReasonCode) || pickString(payload.ReasonCode)

  if (success && transactionId) {
    return {
      kind: 'success',
      transactionId,
      raw: payload,
    }
  }
  // Codex Wave 60 MEDIUM #3 — defensive parse. `Success=true` with a
  // missing TransactionId is a malformed-gateway response, not a
  // decline; the caller must treat it as 'error' so the refund-attempt
  // row lands in the 'error' (or reconcile) bucket, not 'declined'.
  // Operator looks at gateway dashboard to confirm whether money
  // actually moved.
  if (success && !transactionId) {
    return {
      kind: 'error',
      message:
        'CloudPayments returned Success=true without a Model.TransactionId on the refund response.',
      raw: payload,
    }
  }
  return {
    kind: 'declined',
    message: pickString(model.CardHolderMessage) || message || 'Возврат отклонён.',
    reasonCode,
    raw: payload,
  }
}
