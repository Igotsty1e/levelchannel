export type PaymentProvider = 'mock' | 'cloudpayments'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled'

export type PaymentOrderEvent = {
  type: string
  at: string
  payload?: Record<string, unknown>
}

export type PaymentReceiptItem = {
  label: string
  price: number
  quantity: number
  amount: number
  vat: number
  method: number
  object: number
}

export type PaymentReceipt = {
  items: PaymentReceiptItem[]
  email: string
  isBso: boolean
  amounts: {
    electronic: number
    advancePayment: number
    credit: number
    provision: number
  }
}

export type PaymentOrder = {
  invoiceId: string
  amountRub: number
  currency: 'RUB'
  description: string
  provider: PaymentProvider
  status: PaymentStatus
  createdAt: string
  updatedAt: string
  paidAt?: string
  failedAt?: string
  providerTransactionId?: string
  providerMessage?: string
  customerEmail: string
  receiptEmail: string
  receipt: PaymentReceipt
  metadata?: Record<string, unknown>
  mockAutoConfirmAt?: string
  events: PaymentOrderEvent[]
  // Free-text payment note from the customer ("за урок 26 апреля").
  // Server-validated to ≤128 chars after trim, control characters
  // stripped. Persisted separately from `description`; description is
  // composed server-side as PAYMENT_DESCRIPTION + comment + amount.
  customerComment?: string | null
  // Wave 6.1 #4 — sha256 hex of the plain receipt_token issued at
  // create-order time. The plain token is returned ONCE in the
  // create-order response and never persisted. Routes that need to
  // gate on token will hash the incoming token and compare against
  // this column. Phase 1.5 (this wave) only mints + persists; the
  // gate is Phase 2.
  receiptTokenHash?: string | null
}

export type PublicPaymentOrder = Pick<
  PaymentOrder,
  | 'invoiceId'
  | 'amountRub'
  | 'currency'
  | 'description'
  | 'provider'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'paidAt'
  | 'failedAt'
  | 'providerMessage'
>

export type SavedCardToken = {
  customerEmail: string
  token: string
  cardLastFour?: string
  cardType?: string
  cardExpMonth?: string
  cardExpYear?: string
  createdAt: string
  lastUsedAt: string
}

export type PublicSavedCard = {
  cardLastFour?: string
  cardType?: string
  createdAt: string
}

export type CloudPaymentsWidgetIntent = {
  publicTerminalId: string
  amount: number
  currency: 'RUB'
  description: string
  externalId: string
  paymentSchema: 'Single'
  skin: 'modern'
  culture: 'ru-RU'
  emailBehavior: 'Hidden'
  receiptEmail: string
  userInfo: {
    accountId: string
    email: string
  }
  receipt: PaymentReceipt
  items: Array<{
    id: string
    name: string
    count: number
    price: number
  }>
  metadata: {
    invoiceId: string
    customerEmail: string
    rememberCard: boolean
  }
  // Виджет CloudPayments принимает tokenize: false, чтобы вообще не
  // сохранять карту в этой транзакции. Это работает как локальный override
  // даже если в кабинете включено «сохранять по умолчанию».
  tokenize?: boolean
  successRedirectUrl: string
  failRedirectUrl: string
  retryPayment: false
}
