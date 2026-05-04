import { afterAll, afterEach, beforeAll } from 'vitest'

import { getDbPool } from '@/lib/db/pool'
import { __resetRateLimitsForTesting } from '@/lib/security/rate-limit'

// Per-suite setup for payment-route integration tests. Distinct from
// `tests/integration/setup.ts` (auth domain) because the truncate set
// is different — payment tests want a clean payment_orders +
// payment_audit_events + idempotency_records, but they don't care
// about accounts.
//
// We run inside the same Docker Postgres as auth tests; vitest config
// already has fileParallelism=false so the truncates don't race.

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must be set for integration tests. Run via npm run test:integration.',
    )
  }
  await getDbPool().query('select 1')
})

afterEach(async () => {
  const pool = getDbPool()
  // Order matters: payment_audit_events FK to payment_orders ON DELETE
  // NO ACTION, so we delete audit rows first, then orders. CASCADE on
  // payment_card_tokens / idempotency_records is fine independently.
  await pool.query(`
    truncate table
      payment_allocations,
      payment_audit_events,
      payment_orders,
      payment_card_tokens,
      idempotency_records,
      payment_telemetry
    restart identity cascade
  `)
  await __resetRateLimitsForTesting()
})

afterAll(async () => {
  // Pool.end() shared with auth setup — both files own a `afterAll`
  // that calls it. Calling .end() twice on an already-ended pool
  // throws. We skip — the auth setup or vitest's process exit will
  // take care of it.
})
