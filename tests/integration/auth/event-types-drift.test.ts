import { describe, expect, it } from 'vitest'

import { AUTH_AUDIT_EVENT_TYPES } from '@/lib/audit/auth-events'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// T3 Sub-PR A — bidirectional TS↔SQL parity test for the
// auth_audit_events.event_type CHECK constraint vs the TS
// AUTH_AUDIT_EVENT_TYPES tuple. R8-WARN#3 + R9-WARN#3 closure: an
// insert-per-TS-value test catches TS→SQL drift only; SQL→TS drift
// (SQL adds a value, TS forgets) needs to read pg_get_constraintdef().

/**
 * Extract quoted literals from the constraint's CHECK definition.
 * Postgres rewrites `IN (...)` to `ANY (ARRAY[...])` for text columns,
 * so the def is typically:
 *   CHECK ((event_type = ANY (ARRAY['a'::text, 'b'::text, ...])))
 * We pull every quoted literal, regardless of inner form.
 */
function parseCheckConstraintValues(def: string): Set<string> {
  const values = new Set<string>()
  for (const lit of def.matchAll(/'([^']+)'/g)) {
    values.add(lit[1])
  }
  return values
}

describe('auth_audit_events event_type TS↔SQL drift', () => {
  it('TS AUTH_AUDIT_EVENT_TYPES exactly matches SQL CHECK enum', async () => {
    const pool = getDbPool()
    const r = await pool.query<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conname = 'auth_audit_events_event_type_check'`,
    )
    expect(r.rows.length).toBe(1)
    const sqlSet = parseCheckConstraintValues(r.rows[0].def)
    const tsSet = new Set(AUTH_AUDIT_EVENT_TYPES)

    const sqlSorted = [...sqlSet].sort()
    const tsSorted = [...tsSet].sort()
    expect(tsSorted).toEqual(sqlSorted)
  })
})
