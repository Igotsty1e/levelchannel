import { Pool } from 'pg'

import { paymentConfig } from '@/lib/payments/config'
import type { CheckoutTelemetryEvent } from '@/lib/telemetry/store'

declare global {
  // eslint-disable-next-line no-var
  var __levelchannelTelemetryPool: Pool | undefined
}

let initPromise: Promise<void> | null = null

function getPool() {
  if (!paymentConfig.databaseUrl) {
    throw new Error('DATABASE_URL is not configured for PostgreSQL storage.')
  }

  if (!global.__levelchannelTelemetryPool) {
    global.__levelchannelTelemetryPool = new Pool({
      connectionString: paymentConfig.databaseUrl,
    })
  }

  return global.__levelchannelTelemetryPool
}

export async function ensureTelemetrySchemaPostgres() {
  if (!initPromise) {
    initPromise = (async () => {
      const pool = getPool()
      await pool.query(`
        create table if not exists payment_telemetry (
          id bigserial primary key,
          at timestamptz not null,
          type text not null,
          invoice_id text null,
          amount_rub numeric(12, 2) null,
          email_domain text null,
          email_hash text null,
          email_valid boolean null,
          reason text null,
          message text null,
          path text null,
          user_agent text null,
          ip text null
        )
      `)
      await pool.query(`
        create index if not exists payment_telemetry_at_idx
          on payment_telemetry (at desc)
      `)
      await pool.query(`
        create index if not exists payment_telemetry_type_idx
          on payment_telemetry (type)
      `)
    })().catch((error) => {
      initPromise = null
      throw error
    })
  }

  await initPromise
}

export async function insertTelemetryEventPostgres(event: CheckoutTelemetryEvent) {
  const pool = getPool()
  await pool.query(
    `insert into payment_telemetry (
      at, type, invoice_id, amount_rub, email_domain, email_hash, email_valid,
      reason, message, path, user_agent, ip
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      event.at,
      event.type,
      event.invoiceId || null,
      typeof event.amountRub === 'number' && Number.isFinite(event.amountRub)
        ? event.amountRub
        : null,
      event.emailDomain || null,
      event.emailHash || null,
      typeof event.emailValid === 'boolean' ? event.emailValid : null,
      event.reason || null,
      event.message || null,
      event.path || null,
      event.userAgent || null,
      event.ip || null,
    ],
  )
}
