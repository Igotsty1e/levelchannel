import { paymentConfig } from '@/lib/payments/config'

// https://developers.cloudpayments.ru/#oplata-po-tokenu-odnostadiynaya
const TOKENS_CHARGE_URL = 'https://api.cloudpayments.ru/payments/tokens/charge'

// https://developers.cloudpayments.ru/#zavershenie-platezha-posle-3-d-secure
const POST3DS_URL = 'https://api.cloudpayments.ru/payments/cards/post3ds'

// https://developers.cloudpayments.ru/#vozvrat-deneg
const REFUND_URL = 'https://api.cloudpayments.ru/payments/refund'

// SBP-PAY (2026-05-19) — server-to-server SBP QR creation endpoint.
// https://developers.cloudpayments.ru/#sozdanie-platezha-cherez-sbp
const SBP_QR_CREATE_URL =
  'https://api.cloudpayments.ru/payments/qr/sbp/create'

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

// Wave 62 — bounded fetch helper for CloudPayments calls.
// Codex Wave 60 round 2 RESIDUAL pre-existing concern: every CP call
// (tokens/charge, post3ds, refund) used a plain `fetch()` with no
// timeout, so a stuck/hung gateway could leave a request thread
// blocked indefinitely. Wrap fetch in an AbortController-based
// timeout; default 10 s mirrors the 8–10 s upper bound CP themselves
// quote on synchronous endpoints.
//
// Override per call site (or globally via CLOUDPAYMENTS_FETCH_TIMEOUT_MS
// env var) for tests or future endpoints that need different bounds.
function defaultTimeoutMs(): number {
  const envVal = process.env.CLOUDPAYMENTS_FETCH_TIMEOUT_MS
  if (envVal) {
    const n = Number(envVal)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return 10_000
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs, ...rest } = init
  const ms = timeoutMs ?? defaultTimeoutMs()
  // Compose with any signal the caller already passed in — when both
  // exist, AbortSignal.any aborts on whichever fires first.
  const controller = new AbortController()
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`CloudPayments call timed out after ${ms}ms`),
      ),
    ms,
  )
  const signal =
    typeof (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any === 'function' && rest.signal
      ? (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([rest.signal, controller.signal])
      : controller.signal
  try {
    return await fetch(url, { ...rest, signal })
  } finally {
    clearTimeout(timer)
  }
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
    response = await fetchWithTimeout(TOKENS_CHARGE_URL, {
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
    response = await fetchWithTimeout(POST3DS_URL, {
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
    response = await fetchWithTimeout(REFUND_URL, {
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

// SBP-PAY (2026-05-19) — server-to-server SBP QR creation. §0a WARN#4
// closure: SBP route does NOT do raw fetch + Authorization; it goes
// through this centralised client so timeout policy + Basic Auth +
// JSON-error handling stays consistent with chargeWithSavedToken /
// confirmThreeDs / refundTransaction.

export type CloudPaymentsSbpQrRequest = {
  amount: number
  invoiceId: string
  accountId: string
  description: string
  // Free-form JSON string the CP gateway echoes back on the Pay
  // webhook (echoed in payload.Data / payload.JsonData). We use it to
  // surface invoiceId + customerEmail in webhook payloads for
  // operator forensics.
  jsonData?: string
}

export type CloudPaymentsSbpQrResult =
  | {
      kind: 'success'
      transactionId: string
      qrUrl: string
      // Some CP terminals also return a base64-encoded PNG (`Image`)
      // alongside the QrUrl. We surface both; the modal prefers the
      // URL for cache-friendliness (browsers cache the PNG) and only
      // falls back to the base64 image if the URL is missing.
      image?: string
      raw: unknown
    }
  | {
      kind: 'declined'
      message: string
      reasonCode?: string
      raw: unknown
    }
  | {
      kind: 'error'
      message: string
      raw: unknown
    }

export async function createSbpQr(
  request: CloudPaymentsSbpQrRequest,
): Promise<CloudPaymentsSbpQrResult> {
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

  // Wire body matches CP docs. Amount is integer ruble (existing CP
  // helpers like chargeWithSavedToken also pass integer; CP accepts
  // integer for the QR endpoint). Currency is hard-coded RUB matching
  // the rest of the product.
  const body: Record<string, unknown> = {
    Amount: request.amount,
    Currency: 'RUB',
    InvoiceId: request.invoiceId,
    AccountId: request.accountId,
    Description: request.description,
  }
  if (request.jsonData) {
    body.JsonData = request.jsonData
  }

  let response: Response

  try {
    response = await fetchWithTimeout(SBP_QR_CREATE_URL, {
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
      message:
        error instanceof Error ? error.message : 'Invalid JSON response.',
      raw: null,
    }
  }

  const success = payload.Success === true
  const message = pickString(payload.Message) || ''
  const model = (payload.Model as Record<string, unknown> | undefined) || {}

  const transactionId = pickString(model.TransactionId)
  const qrUrl = pickString(model.QrUrl)
  const image = pickString(model.Image)
  const reasonCode =
    pickString(model.ReasonCode) || pickString(payload.ReasonCode)

  if (success && transactionId && qrUrl) {
    return {
      kind: 'success',
      transactionId,
      qrUrl,
      image,
      raw: payload,
    }
  }

  // Success=true with no TransactionId / QrUrl is a malformed-gateway
  // response — treat as 'error' so the caller leaves the order
  // pending and the user can retry with a fresh Idempotency-Key.
  // Mirrors refundTransaction's MEDIUM #3 defensive parse.
  if (success && (!transactionId || !qrUrl)) {
    return {
      kind: 'error',
      message:
        'CloudPayments returned Success=true without a Model.TransactionId or Model.QrUrl on the SBP QR response.',
      raw: payload,
    }
  }

  return {
    kind: 'declined',
    message: pickString(model.CardHolderMessage) || message || 'СБП-платёж отклонён.',
    reasonCode,
    raw: payload,
  }
}
