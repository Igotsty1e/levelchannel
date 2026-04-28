import fs from 'fs/promises'
import path from 'path'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL
const sourceFile = process.env.PAYMENTS_STORAGE_FILE || 'payment-orders.json'

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}

const sourcePath = path.join(process.cwd(), 'data', path.basename(sourceFile))
const pool = new Pool({ connectionString: databaseUrl })

async function ensureSchema() {
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
}

async function main() {
  await ensureSchema()

  const raw = await fs.readFile(sourcePath, 'utf8')
  const parsed = JSON.parse(raw)
  const orders = Array.isArray(parsed.orders) ? parsed.orders : []

  let inserted = 0

  for (const order of orders) {
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
      )
      on conflict (invoice_id) do update set
        amount_rub = excluded.amount_rub,
        currency = excluded.currency,
        description = excluded.description,
        provider = excluded.provider,
        status = excluded.status,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        paid_at = excluded.paid_at,
        failed_at = excluded.failed_at,
        provider_transaction_id = excluded.provider_transaction_id,
        provider_message = excluded.provider_message,
        customer_email = excluded.customer_email,
        receipt_email = excluded.receipt_email,
        receipt = excluded.receipt,
        metadata = excluded.metadata,
        mock_auto_confirm_at = excluded.mock_auto_confirm_at,
        events = excluded.events`,
      [
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
        JSON.stringify(order.events || []),
      ],
    )

    inserted += 1
  }

  console.log(`Migrated ${inserted} payment orders into PostgreSQL.`)
}

main()
  .finally(async () => {
    await pool.end()
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
