import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'

import '../setup'

// free-tier-saas-card-and-subscription-row plan §0b-4 + §0c-2 + §0d-3
// (2026-06-05). Pins backfill mig 0105:
//   1. INSERTs a free row for every teacher-role account without a
//      teacher_subscriptions row.
//   2. Is idempotent on re-run (ON CONFLICT DO NOTHING).
//   3. Selection rules:
//      - purged accounts: excluded.
//      - disabled accounts: INCLUDED (re-enabled teachers must keep
//        their row per reenableAccount contract).
//      - non-teacher (student-only) accounts: excluded.
//
// Pattern: read the migration file BY EXACT FILENAME (no glob) and
// run it via pool.query(raw). NEW pattern in tests/integration/migrations/
// — no existing precedent in the repo (round-3 §0c-2 + round-5 §0d-3).

const REPO_ROOT = resolvePath(__dirname, '..', '..', '..')
const MIG_PATH = resolvePath(
  REPO_ROOT,
  'migrations',
  '0105_teacher_subscriptions_free_backfill.sql',
)
const MIG_SQL = readFileSync(MIG_PATH, 'utf8')

async function makeAccount(opts: {
  emailSuffix: string
  role: 'teacher' | 'student' | null
  purged?: boolean
  disabled?: boolean
}): Promise<string> {
  const pool = getDbPool()
  const email = `mig0105-${opts.emailSuffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at, purged_at, disabled_at)
       values ($1, 'mig0105-hash', now(),
               $2::timestamptz, $3::timestamptz)
     returning id`,
    [
      email,
      opts.purged ? 'now()' : null,
      opts.disabled ? 'now()' : null,
    ],
  )
  const id = r.rows[0].id
  if (opts.role !== null) {
    await pool.query(
      `insert into account_roles (account_id, role)
         values ($1::uuid, $2)
         on conflict (account_id, role) do nothing`,
      [id, opts.role],
    )
  }
  return id
}

async function hasSubRow(accountId: string): Promise<boolean> {
  const pool = getDbPool()
  const r = await pool.query<{ count: string }>(
    `select count(*)::text as count from teacher_subscriptions where account_id = $1`,
    [accountId],
  )
  return r.rows[0].count !== '0'
}

describe('migration 0105 — teacher_subscriptions free backfill', () => {
  it('inserts a free row for a teacher account lacking a subscription row', async () => {
    const id = await makeAccount({ emailSuffix: 'teacher-noRow', role: 'teacher' })
    expect(await hasSubRow(id)).toBe(false)

    await getDbPool().query(MIG_SQL)

    const pool = getDbPool()
    const post = await pool.query<{ plan_slug: string; state: string }>(
      `select plan_slug, state from teacher_subscriptions where account_id = $1`,
      [id],
    )
    expect(post.rows).toHaveLength(1)
    expect(post.rows[0].plan_slug).toBe('free')
    expect(post.rows[0].state).toBe('active')
  })

  it('does NOT insert for non-teacher (student-only) accounts', async () => {
    const id = await makeAccount({ emailSuffix: 'student-only', role: 'student' })
    await getDbPool().query(MIG_SQL)
    expect(await hasSubRow(id)).toBe(false)
  })

  it('does NOT insert for purged accounts (even with teacher role)', async () => {
    const id = await makeAccount({
      emailSuffix: 'purged-teacher',
      role: 'teacher',
      purged: true,
    })
    await getDbPool().query(MIG_SQL)
    expect(await hasSubRow(id)).toBe(false)
  })

  it('INSERTS for disabled-but-not-purged teacher accounts (re-enable safety)', async () => {
    const id = await makeAccount({
      emailSuffix: 'disabled-teacher',
      role: 'teacher',
      disabled: true,
    })
    await getDbPool().query(MIG_SQL)
    expect(await hasSubRow(id)).toBe(true)
  })

  it('is idempotent on re-run (ON CONFLICT DO NOTHING)', async () => {
    const id = await makeAccount({ emailSuffix: 'teacher-idempotent', role: 'teacher' })

    // First run.
    await getDbPool().query(MIG_SQL)
    const pool = getDbPool()
    const after1 = await pool.query<{ count: string }>(
      `select count(*)::text as count from teacher_subscriptions where account_id = $1`,
      [id],
    )
    expect(after1.rows[0].count).toBe('1')

    // Second run — must not error, must not double-insert.
    await getDbPool().query(MIG_SQL)
    const after2 = await pool.query<{ count: string }>(
      `select count(*)::text as count from teacher_subscriptions where account_id = $1`,
      [id],
    )
    expect(after2.rows[0].count).toBe('1')
  })
})
