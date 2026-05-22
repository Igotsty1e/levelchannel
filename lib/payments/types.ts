// PKG-ADMIN-GRANT (2026-05-16): 'admin_grant' is a NON-MONEY provider
// for operator-driven package grants (refund-credits, comps, make-
// goods). Money-side queries (admin-list, refunds, paid-state, debt)
// filter on provider/status to exclude these from revenue aggregations.
//
// SAAS-PIVOT Epic 3 Day 4 (2026-05-22): 'teacher_grant' is the
// teacher-driven analogue. Same NON-MONEY semantics: never reaches
// CloudPayments, never books a payment_allocation_reversals row on
// revoke. Differs from admin_grant on the actor column
// (granted_by_teacher_id) and on the status pair
// (teacher_granted / teacher_revoked).
export type PaymentProvider =
  | 'mock'
  | 'cloudpayments'
  | 'admin_grant'
  | 'teacher_grant'

// SBP-PAY (2026-05-19): canonical method discriminator. ''card''
// (default for the widget + saved-token flow), ''sbp'' (SBP QR via
// CloudPayments server API), ''admin_grant'' (non-money operator-
// driven package grant). Top-level column on payment_orders is the
// single source of truth; metadata.payment_method is NOT used (see
// §0a BLOCKER#6 + §0b BLOCKER#2 closures in docs/plans/sbp-payments.md).
//
// SAAS-PIVOT Epic 3 Day 4 (2026-05-22): 'teacher_grant' added for the
// teacher-cabinet "issue a package to a learner" flow. Mirrors the
// admin_grant slot in the provider/status/payment_method triad.
export type PaymentMethod = 'card' | 'sbp' | 'admin_grant' | 'teacher_grant'

// PKG-ADMIN-GRANT (2026-05-16): 'granted' is a terminal status for
// admin grants — distinct from 'paid' so existing money-side recovery
// paths (paid_not_granted, deletion-guard) don't see admin grants.
// '3ds_required' was always persisted but missing from this union;
// added here as a follow-up fix (a separate hardening of mapRowToOrder
// surfaced it).
//
// SAAS-PIVOT Epic 3 Day 4 (2026-05-22): 'teacher_granted' and
// 'teacher_revoked' added for the teacher-driven grant lifecycle.
// teacher_granted = freshly issued; teacher_revoked = teacher (or
// admin override) voided the grant before any consumption was
// completed. Quadruple-CHECK in mig 0087 enforces the consistency.
export type PaymentStatus =
  | 'pending'
  | '3ds_required'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'granted'
  | 'teacher_granted'
  | 'teacher_revoked'

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
  // PKG-ADMIN-GRANT (2026-05-16): operator account id for admin
  // grants. NULL for paid orders. Triple-CHECK in migration 0051
  // enforces provider='admin_grant' iff this is NOT NULL iff
  // status='granted'.
  grantedByOperatorId?: string | null
  // SAAS-PIVOT Epic 3 Day 4 (2026-05-22): teacher account id for
  // teacher_grant orders. NULL for everything else (card, sbp,
  // admin_grant). Quadruple-CHECK in mig 0087 enforces
  // provider='teacher_grant' iff this is NOT NULL iff
  // status in ('teacher_granted','teacher_revoked') iff
  // payment_method='teacher_grant'.
  grantedByTeacherId?: string | null
  // SBP-PAY (2026-05-19): canonical method discriminator (top-level
  // column on payment_orders). NULL for legacy pre-migration-0062
  // rows that haven't been backfilled; every new row written through
  // `createCloudPaymentsOrder` / `createMockOrder` carries a value.
  // Webhook handler reads/writes this — NOT metadata.payment_method.
  paymentMethod?: PaymentMethod | null
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
