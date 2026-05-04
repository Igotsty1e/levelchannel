import { getDbPool } from '@/lib/db/pool'
import type { PaymentStatus } from '@/lib/payments/types'

// Operator-side payment listing for /admin/payments. Mirrors the
// listAccounts shape from lib/auth/accounts.ts: paginated, filterable,
// returns { orders, total } so the page can render a "page X of Y"
// pager without a second count query.

export type AdminPaymentOrder = {
  invoiceId: string
  amountRub: number
  currency: string
  status: PaymentStatus
  provider: string
  createdAt: string
  updatedAt: string
  paidAt: string | null
  failedAt: string | null
  customerEmail: string
  providerMessage: string | null
  customerComment: string | null
  // Phase 6: derived from order metadata, surfaced here for the
  // admin list "this payment was for slot X" column.
  slotId: string | null
}

export type AdminPaymentListPage = {
  orders: AdminPaymentOrder[]
  total: number
}

function rowToAdmin(row: Record<string, unknown>): AdminPaymentOrder {
  const meta = (row.metadata as Record<string, unknown> | null) ?? null
  const slotIdRaw = meta?.slotId
  return {
    invoiceId: String(row.invoice_id),
    amountRub: Number(row.amount_rub),
    currency: String(row.currency),
    status: String(row.status) as PaymentStatus,
    provider: String(row.provider),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    paidAt: row.paid_at ? new Date(String(row.paid_at)).toISOString() : null,
    failedAt: row.failed_at ? new Date(String(row.failed_at)).toISOString() : null,
    customerEmail: String(row.customer_email),
    providerMessage: row.provider_message ? String(row.provider_message) : null,
    customerComment: row.customer_comment ? String(row.customer_comment) : null,
    slotId: typeof slotIdRaw === 'string' && slotIdRaw ? slotIdRaw : null,
  }
}

export async function listPaymentOrdersForAdmin(params: {
  status?: PaymentStatus | 'all'
  email?: string
  fromIso?: string
  toIso?: string
  limit?: number
  offset?: number
}): Promise<AdminPaymentListPage> {
  const pool = getDbPool()
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200)
  const offset = Math.max(params.offset ?? 0, 0)

  const args: unknown[] = []
  const clauses: string[] = []

  if (params.status && params.status !== 'all') {
    args.push(params.status)
    clauses.push(`status = $${args.length}`)
  }
  if (params.email && params.email.trim()) {
    args.push(`%${params.email.trim().toLowerCase()}%`)
    clauses.push(`lower(customer_email) like $${args.length}`)
  }
  if (params.fromIso) {
    args.push(params.fromIso)
    clauses.push(`created_at >= $${args.length}`)
  }
  if (params.toIso) {
    args.push(params.toIso)
    clauses.push(`created_at <= $${args.length}`)
  }
  const where = clauses.length ? `where ${clauses.join(' and ')}` : ''
  const filterArgs = args.slice()

  args.push(limit, offset)
  const limitArg = `$${args.length - 1}`
  const offsetArg = `$${args.length}`

  const rowsResult = await pool.query(
    `select invoice_id, amount_rub, currency, status, provider,
            created_at, updated_at, paid_at, failed_at,
            customer_email, provider_message, customer_comment, metadata
       from payment_orders
       ${where}
       order by created_at desc
       limit ${limitArg} offset ${offsetArg}`,
    args,
  )
  const countResult = await pool.query(
    `select count(*)::int as n from payment_orders ${where}`,
    filterArgs,
  )

  return {
    orders: rowsResult.rows.map(rowToAdmin),
    total: Number(countResult.rows[0]?.n ?? 0),
  }
}
