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
  }
  successRedirectUrl: string
  failRedirectUrl: string
  retryPayment: false
}
