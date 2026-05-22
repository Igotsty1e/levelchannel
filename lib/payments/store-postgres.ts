import { getDbPool } from '@/lib/db/pool'
import { paymentConfig } from '@/lib/payments/config'
import type { PaymentOrder, SavedCardToken } from '@/lib/payments/types'

let initPromise: Promise<void> | null = null

// Payment storage now shares the single Postgres pool from
// `lib/db/pool.ts`. The `paymentConfig.databaseUrl` reference is
// kept above the import only because it's still consulted elsewhere
// in this file via paymentConfig.* (storage backend selection etc).
function getPool() {
  if (!paymentConfig.databaseUrl) {
    throw new Error('DATABASE_URL is not configured for PostgreSQL storage.')
  }
  return getDbPool()
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
          events jsonb not null default '[]'::jsonb,
          customer_comment text null,
          payment_method text null
            check (payment_method is null
                   or payment_method in (
                     'card', 'sbp', 'admin_grant', 'teacher_grant'
                   ))
        )
      `)
      // Legacy safety net for DBs that ran the older ensureSchema before
      // migration 0015 landed. ALTER ADD COLUMN IF NOT EXISTS so it's a
      // no-op on freshly-migrated databases.
      await pool.query(
        `alter table payment_orders add column if not exists customer_comment text null`,
      )
      // SBP-PAY (2026-05-19) — same legacy-safety pattern. Bootstrapped
      // dev DBs that ran ensureSchema BEFORE migration 0062 landed
      // need the column added here too. No-op on freshly-migrated DBs.
      await pool.query(
        `alter table payment_orders add column if not exists payment_method text null`,
      )
      await pool.query(`
        create table if not exists payment_card_tokens (
          customer_email text primary key,
          token text not null,
          card_last_four text null,
          card_type text null,
          card_exp_month text null,
          card_exp_year text null,
          created_at timestamptz not null,
          last_used_at timestamptz not null
        )
      `)
    })().catch((error) => {
      initPromise = null
      throw error
    })
  }

  await initPromise
}

// PKG-ADMIN-GRANT (2026-05-16) — explicit accept-list, no coercion.
//
// Previous shape coerced unknown `provider` → 'mock' and unknown
// `status` → 'pending', which historically hid '3ds_required' rows
// as 'pending' and would silently mis-classify a future
// 'admin_grant' row as 'mock' + 'pending'. Loud-fail on unknown is
// the operational-safe behaviour — a row not matching the union is
// data corruption, not a recoverable condition.
const KNOWN_PROVIDERS = new Set<PaymentOrder['provider']>([
  'cloudpayments',
  'mock',
  'admin_grant',
  // SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-driven non-money
  // grant. See lib/payments/types.ts PaymentProvider union for the
  // semantics contract.
  'teacher_grant',
])
const KNOWN_STATUSES = new Set<PaymentOrder['status']>([
  'pending',
  '3ds_required',
  'paid',
  'failed',
  'cancelled',
  'granted',
  // SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher_grant lifecycle.
  'teacher_granted',
  'teacher_revoked',
])

// SBP-PAY (2026-05-19) — loud-fail accept-list for payment_method,
// mirrors KNOWN_PROVIDERS / KNOWN_STATUSES (PKG-ADMIN-GRANT 2026-05-16
// coercion-removal pattern). Unknown column value = data corruption,
// not a recoverable condition.
const KNOWN_PAYMENT_METHODS = new Set<NonNullable<PaymentOrder['paymentMethod']>>([
  'card',
  'sbp',
  'admin_grant',
  // SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — teacher-driven non-money
  // grant. Mirrors admin_grant slot.
  'teacher_grant',
])

function mapRowToOrder(row: Record<string, unknown>): PaymentOrder {
  const provider = String(row.provider) as PaymentOrder['provider']
  if (!KNOWN_PROVIDERS.has(provider)) {
    throw new Error(
      `Unexpected provider in payment_orders row: ${String(row.provider)}`,
    )
  }
  const status = String(row.status) as PaymentOrder['status']
  if (!KNOWN_STATUSES.has(status)) {
    throw new Error(
      `Unexpected status in payment_orders row: ${String(row.status)}`,
    )
  }
  return {
    invoiceId: String(row.invoice_id),
    amountRub: Number(row.amount_rub),
    // Currency пока поддерживаем только RUB. Если в DB прилетит что-то иное —
    // это сигнал поломки данных, лучше явно бросить, чем тихо переписать.
    currency: ((): 'RUB' => {
      if (row.currency !== 'RUB') {
        throw new Error(`Unexpected currency in payment_orders row: ${String(row.currency)}`)
      }
      return 'RUB'
    })(),
    description: String(row.description),
    provider,
    status,
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
    customerComment:
      row.customer_comment == null ? null : String(row.customer_comment),
    receiptTokenHash:
      row.receipt_token_hash == null ? null : String(row.receipt_token_hash),
    grantedByOperatorId:
      row.granted_by_operator_id == null ? null : String(row.granted_by_operator_id),
    grantedByTeacherId:
      row.granted_by_teacher_id == null ? null : String(row.granted_by_teacher_id),
    paymentMethod: ((): PaymentOrder['paymentMethod'] => {
      if (row.payment_method == null) return null
      const value = String(row.payment_method) as NonNullable<PaymentOrder['paymentMethod']>
      if (!KNOWN_PAYMENT_METHODS.has(value)) {
        throw new Error(
          `Unexpected payment_method in payment_orders row: ${String(row.payment_method)}`,
        )
      }
      return value
    })(),
    teacherAccountId:
      row.teacher_account_id == null ? null : String(row.teacher_account_id),
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
    order.customerComment ?? null,
    order.receiptTokenHash ?? null,
    order.grantedByOperatorId ?? null,
    order.paymentMethod ?? null,
    order.grantedByTeacherId ?? null,
    order.teacherAccountId ?? null,
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
      events,
      customer_comment,
      receipt_token_hash,
      granted_by_operator_id,
      payment_method,
      granted_by_teacher_id,
      teacher_account_id
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18::jsonb,$19,$20,$21::uuid,$22,$23::uuid,$24::uuid
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
  const client = await pool.connect()

  try {
    await client.query('begin')

    const result = await client.query(
      `select * from payment_orders where invoice_id = $1 for update`,
      [invoiceId],
    )

    if (result.rows.length === 0) {
      await client.query('rollback')
      return null
    }

    const current = mapRowToOrder(result.rows[0])
    const next = updater(current)

    await client.query(
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
        events = $18::jsonb,
        customer_comment = $19,
        receipt_token_hash = $20,
        granted_by_operator_id = $21::uuid,
        payment_method = $22,
        granted_by_teacher_id = $23::uuid,
        teacher_account_id = $24::uuid
      where invoice_id = $1`,
      toInsertValues(next),
    )

    await client.query('commit')
    return next
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

function mapRowToToken(row: Record<string, unknown>): SavedCardToken {
  return {
    customerEmail: String(row.customer_email),
    token: String(row.token),
    cardLastFour: row.card_last_four ? String(row.card_last_four) : undefined,
    cardType: row.card_type ? String(row.card_type) : undefined,
    cardExpMonth: row.card_exp_month ? String(row.card_exp_month) : undefined,
    cardExpYear: row.card_exp_year ? String(row.card_exp_year) : undefined,
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastUsedAt: new Date(String(row.last_used_at)).toISOString(),
  }
}

export async function getCardTokenByEmailPostgres(email: string) {
  await ensureSchema()
  const pool = getPool()
  const result = await pool.query(
    `select * from payment_card_tokens where customer_email = $1`,
    [email],
  )
  return result.rows[0] ? mapRowToToken(result.rows[0]) : undefined
}

export async function upsertCardTokenPostgres(token: SavedCardToken) {
  await ensureSchema()
  const pool = getPool()
  await pool.query(
    `insert into payment_card_tokens (
      customer_email, token, card_last_four, card_type,
      card_exp_month, card_exp_year, created_at, last_used_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (customer_email) do update set
      token = excluded.token,
      card_last_four = excluded.card_last_four,
      card_type = excluded.card_type,
      card_exp_month = excluded.card_exp_month,
      card_exp_year = excluded.card_exp_year,
      last_used_at = excluded.last_used_at`,
    [
      token.customerEmail,
      token.token,
      token.cardLastFour || null,
      token.cardType || null,
      token.cardExpMonth || null,
      token.cardExpYear || null,
      token.createdAt,
      token.lastUsedAt,
    ],
  )
  return token
}

export async function touchCardTokenUsedAtPostgres(email: string, usedAt: string) {
  await ensureSchema()
  const pool = getPool()
  await pool.query(
    `update payment_card_tokens set last_used_at = $2 where customer_email = $1`,
    [email, usedAt],
  )
}

export async function deleteCardTokenPostgres(email: string) {
  await ensureSchema()
  const pool = getPool()
  await pool.query(`delete from payment_card_tokens where customer_email = $1`, [email])
}
