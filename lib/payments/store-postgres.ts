import { Pool } from 'pg'

import { paymentConfig } from '@/lib/payments/config'
import type { PaymentOrder } from '@/lib/payments/types'

declare global {
  // eslint-disable-next-line no-var
  var __levelchannelPaymentsPool: Pool | undefined
}

let initPromise: Promise<void> | null = null

function getPool() {
  if (!paymentConfig.databaseUrl) {
    throw new Error('DATABASE_URL is not configured for PostgreSQL storage.')
  }

  if (!global.__levelchannelPaymentsPool) {
    global.__levelchannelPaymentsPool = new Pool({
      connectionString: paymentConfig.databaseUrl,
    })
  }

  return global.__levelchannelPaymentsPool
}

async function ensureSchema() {
  if (!initPromise) {
    initPromise = (async () => {
      const pool = getPool()
      await pool.query(`
        create table if not exists payment_orders (
          invoice_id text primary key,
          amount_rub numeric(12, 2) not null,
          currency text not null,
          description text not null,
          provider text not null,
          status text not null,
          created_at timestamptz not null,
          updated_at timestamptz not null,
          paid_at timestamptz null,
          failed_at timestamptz null,
          provider_transaction_id text null,
          provider_message text null,
          customer_email text not null,
          receipt_email text not null,
          receipt jsonb not null,
          metadata jsonb null,
          mock_auto_confirm_at timestamptz null,
          events jsonb not null default '[]'::jsonb
        )
      `)
    })().catch((error) => {
      initPromise = null
      throw error
    })
  }

  await initPromise
}

function mapRowToOrder(row: Record<string, unknown>): PaymentOrder {
  return {
    invoiceId: String(row.invoice_id),
    amountRub: Number(row.amount_rub),
    currency: row.currency === 'RUB' ? 'RUB' : 'RUB',
    description: String(row.description),
    provider: row.provider === 'cloudpayments' ? 'cloudpayments' : 'mock',
    status:
      row.status === 'paid' ||
      row.status === 'failed' ||
      row.status === 'cancelled'
        ? row.status
        : 'pending',
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    paidAt: row.paid_at ? new Date(String(row.paid_at)).toISOString() : undefined,
    failedAt: row.failed_at ? new Date(String(row.failed_at)).toISOString() : undefined,
    providerTransactionId: row.provider_transaction_id
      ? String(row.provider_transaction_id)
      : undefined,
    providerMessage: row.provider_message ? String(row.provider_message) : undefined,
    customerEmail: String(row.customer_email),
    receiptEmail: String(row.receipt_email),
    receipt: row.receipt as PaymentOrder['receipt'],
    metadata: (row.metadata as Record<string, unknown> | null) || undefined,
    mockAutoConfirmAt: row.mock_auto_confirm_at
      ? new Date(String(row.mock_auto_confirm_at)).toISOString()
      : undefined,
    events: Array.isArray(row.events) ? (row.events as PaymentOrder['events']) : [],
  }
}

function toInsertValues(order: PaymentOrder) {
  return [
    order.invoiceId,
    order.amountRub,
    order.currency,
    order.description,
    order.provider,
    order.status,
    order.createdAt,
    order.updatedAt,
    order.paidAt || null,
    order.failedAt || null,
    order.providerTransactionId || null,
    order.providerMessage || null,
    order.customerEmail,
    order.receiptEmail,
    JSON.stringify(order.receipt),
    order.metadata ? JSON.stringify(order.metadata) : null,
    order.mockAutoConfirmAt || null,
    JSON.stringify(order.events),
  ]
}

export async function listOrdersPostgres() {
  await ensureSchema()
  const pool = getPool()
  const result = await pool.query(
    `select * from payment_orders order by created_at desc`,
  )

  return result.rows.map(mapRowToOrder)
}

export async function getOrderPostgres(invoiceId: string) {
  await ensureSchema()
  const pool = getPool()
  const result = await pool.query(`select * from payment_orders where invoice_id = $1`, [invoiceId])
  return result.rows[0] ? mapRowToOrder(result.rows[0]) : undefined
}

export async function createOrderPostgres(order: PaymentOrder) {
  await ensureSchema()
  const pool = getPool()
  await pool.query(
    `insert into payment_orders (
      invoice_id,
      amount_rub,
      currency,
      description,
      provider,
      status,
      created_at,
      updated_at,
      paid_at,
      failed_at,
      provider_transaction_id,
      provider_message,
      customer_email,
      receipt_email,
      receipt,
      metadata,
      mock_auto_confirm_at,
      events
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18::jsonb
    )`,
    toInsertValues(order),
  )

  return order
}

export async function updateOrderPostgres(
  invoiceId: string,
  updater: (order: PaymentOrder) => PaymentOrder,
) {
  await ensureSchema()
  const pool = getPool()
  const current = await getOrderPostgres(invoiceId)

  if (!current) {
    return null
  }

  const next = updater(current)
  await pool.query(
    `update payment_orders set
      amount_rub = $2,
      currency = $3,
      description = $4,
      provider = $5,
      status = $6,
      created_at = $7,
      updated_at = $8,
      paid_at = $9,
      failed_at = $10,
      provider_transaction_id = $11,
      provider_message = $12,
      customer_email = $13,
      receipt_email = $14,
      receipt = $15::jsonb,
      metadata = $16::jsonb,
      mock_auto_confirm_at = $17,
      events = $18::jsonb
    where invoice_id = $1`,
    toInsertValues(next),
  )

  return next
}
