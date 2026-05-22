// SAAS-PIVOT Epic 2 Day 3 — bootstrap teacher account lookup helper.
//
// Plan: docs/plans/saas-pivot-master.md §2.9 (row-MOVE migration) +
// §3 Epic 2 ("The bootstrap teacher account from mig 0083 owns all
// pre-existing pricing_tariffs rows").
//
// Mig 0083 stamps the NEW pure-teacher account with
// teacher_account_migration_marker = 'bootstrap-2026-05-22'. That row
// is the SoT for "the legacy operator-as-teacher account". The /admin/pricing
// surface — now legacy after /teacher/tariffs ships — uses this helper
// to default INSERTs to the bootstrap teacher so the existing operator
// workflow stays green during the n:m transition.
//
// In integration tests where mig 0083 was a no-op (no admin pre-seeded),
// this helper returns null; the caller then errors with a clear
// "missing bootstrap teacher" message rather than blowing up the
// NOT NULL constraint cryptically.

import { getDbPool } from '@/lib/db/pool'

export const BOOTSTRAP_MARKER = 'bootstrap-2026-05-22'

let cached: { value: string | null; at: number } | null = null
const CACHE_TTL_MS = 30_000

export async function getBootstrapTeacherId(): Promise<string | null> {
  const now = Date.now()
  if (cached !== null && now - cached.at < CACHE_TTL_MS) {
    return cached.value
  }
  const pool = getDbPool()
  const result = await pool.query<{ id: string }>(
    `select id
       from accounts
      where teacher_account_migration_marker = $1
      limit 1`,
    [BOOTSTRAP_MARKER],
  )
  const value = result.rows[0]?.id ? String(result.rows[0].id) : null
  cached = { value, at: now }
  return value
}

// Test helper — flush the cache so per-test seeded marker rows are
// observable without waiting for the 30-second TTL. Not exported as a
// public name on purpose: integration tests reach in by file path.
export function __resetBootstrapTeacherCacheForTesting(): void {
  cached = null
}
