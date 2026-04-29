import { Pool } from 'pg'

import { paymentConfig } from '@/lib/payments/config'

declare global {
  // eslint-disable-next-line no-var
  var __levelchannelIdempotencyPool: Pool | undefined
}

let initPromise: Promise<void> | null = null

function getPool() {
  if (!paymentConfig.databaseUrl) {
    throw new Error('DATABASE_URL is not configured for PostgreSQL storage.')
  }

  if (!global.__levelchannelIdempotencyPool) {
    global.__levelchannelIdempotencyPool = new Pool({
      connectionString: paymentConfig.databaseUrl,
    })
  }

  return global.__levelchannelIdempotencyPool
}

export async function ensureIdempotencySchemaPostgres() {
  if (!initPromise) {
    initPromise = (async () => {
      const pool = getPool()
      await pool.query(`
        create table if not exists idempotency_records (
          scope text not null,
          key text not null,
          request_hash text not null,
          response_status int not null,
          response_body jsonb not null,
          created_at timestamptz not null default now(),
          primary key (scope, key)
        )
      `)
      await pool.query(`
        create index if not exists idempotency_records_created_at_idx
          on idempotency_records (created_at)
      `)
    })().catch((error) => {
      initPromise = null
      throw error
    })
  }

  await initPromise
}

export type IdempotencyRecord = {
  scope: string
  key: string
  requestHash: string
  responseStatus: number
  responseBody: unknown
}

export async function getIdempotencyRecordPostgres(
  scope: string,
  key: string,
): Promise<IdempotencyRecord | undefined> {
  const pool = getPool()
  const result = await pool.query(
    `select scope, key, request_hash, response_status, response_body
     from idempotency_records
     where scope = $1 and key = $2`,
    [scope, key],
  )

  if (result.rows.length === 0) {
    return undefined
  }

  const row = result.rows[0]
  return {
    scope: String(row.scope),
    key: String(row.key),
    requestHash: String(row.request_hash),
    responseStatus: Number(row.response_status),
    responseBody: row.response_body as unknown,
  }
}

export async function saveIdempotencyRecordPostgres(record: IdempotencyRecord) {
  const pool = getPool()
  // ON CONFLICT — стандартная гонка: два запроса с одним ключом приходят
  // одновременно. Тот, кто проиграл, обнаружит это уже на следующем чтении.
  await pool.query(
    `insert into idempotency_records (
      scope, key, request_hash, response_status, response_body
    ) values ($1, $2, $3, $4, $5::jsonb)
    on conflict (scope, key) do nothing`,
    [
      record.scope,
      record.key,
      record.requestHash,
      record.responseStatus,
      JSON.stringify(record.responseBody),
    ],
  )
}

export async function purgeStaleIdempotencyRecordsPostgres(maxAgeHours = 24) {
  const pool = getPool()
  await pool.query(
    `delete from idempotency_records where created_at < now() - ($1::int || ' hours')::interval`,
    [maxAgeHours],
  )
}
