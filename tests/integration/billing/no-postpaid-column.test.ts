import { describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'

import '../setup'

// Quality Sub-PR A (2026-06-02) — regression guard for mig 0103.
//
// mig 0103_drop_accounts_postpaid_allowed.sql drops the dead
// accounts.postpaid_allowed column that used to gate the postpaid
// preview banner in BookConfirmModal. After mig 0101 the booking
// layer consults learner_billing_preferences per (teacher, learner)
// pair instead; the column read no callers.
//
// This test pins the absence so a future consumer can't quietly
// re-introduce it.
describe('mig 0103 — accounts.postpaid_allowed dropped', () => {
  it('accounts.postpaid_allowed column does NOT exist', async () => {
    const pool = getDbPool()
    const r = await pool.query(
      "select column_name from information_schema.columns where table_name = 'accounts' and column_name = 'postpaid_allowed'",
    )
    expect(r.rows).toHaveLength(0)
  })
})
