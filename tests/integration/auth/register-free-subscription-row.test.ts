import { describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { getAccountByEmail } from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'

import '../setup'
import { buildRequest } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

// free-tier-saas-card-and-subscription-row plan §4 + §7 (2026-06-05).
//
// Pins the register-time INSERT shape (plan §0a-4 closure + §1 item 3):
// when /api/auth/register is invoked with role=teacher, the route MUST
// insert a teacher_subscriptions row with plan_slug='free', state='active'.
// Student registrations MUST NOT insert any teacher_subscriptions row.
//
// This is the active half of the fix for the "Создание тарифов
// недоступно на вашем тарифе" regression — without this INSERT, new
// teachers hit resolveTeacherWriteCaps EMPTY_CAPS and the /teacher/tariffs
// + /teacher/packages forms refuse all writes.

describe('POST /api/auth/register — teacher_subscriptions free-row INSERT', () => {
  it('teacher registration inserts {plan_slug:"free", state:"active"} row', async () => {
    const email = `free-row-teacher-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
    const res = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'correct horse battery staple',
          personalDataConsentAccepted: true,
          role: 'teacher',
        },
      }),
    )
    expect(res.status).toBe(200)

    const account = await getAccountByEmail(email)
    expect(account).not.toBeNull()

    const pool = getAuthPool()
    const subRows = await pool.query<{ plan_slug: string; state: string }>(
      `select plan_slug, state from teacher_subscriptions where account_id = $1`,
      [account!.id],
    )
    expect(subRows.rows).toHaveLength(1)
    expect(subRows.rows[0].plan_slug).toBe('free')
    expect(subRows.rows[0].state).toBe('active')
  })

  it('student registration does NOT insert any teacher_subscriptions row', async () => {
    const email = `free-row-student-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
    const res = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'correct horse battery staple',
          personalDataConsentAccepted: true,
          // No role → defaults to learner/student. Negative pin.
        },
      }),
    )
    expect(res.status).toBe(200)

    const account = await getAccountByEmail(email)
    expect(account).not.toBeNull()

    const pool = getAuthPool()
    const subRows = await pool.query<{ count: string }>(
      `select count(*)::text as count from teacher_subscriptions where account_id = $1`,
      [account!.id],
    )
    expect(subRows.rows[0].count).toBe('0')
  })

  it('heals half-provisioned teacher account on retry (wave-paranoia R1 BLOCKER #1)', async () => {
    // Simulates the failure scenario: account + teacher role exist,
    // but teacher_subscriptions row is missing (e.g. INSERT crashed
    // mid-register on the first call). The retry on the same email
    // lands in the existing-email branch — must heal the missing row,
    // not silently leave the teacher in EMPTY_CAPS.
    const email = `heal-half-provisioned-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
    // First register — happy path inserts the row.
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'correct horse battery staple',
          personalDataConsentAccepted: true,
          role: 'teacher',
        },
      }),
    )
    const account = await getAccountByEmail(email)
    expect(account).not.toBeNull()
    const pool = getAuthPool()
    // Simulate the half-provisioned state: delete the row, leave the role.
    await pool.query(
      `delete from teacher_subscriptions where account_id = $1`,
      [account!.id],
    )
    const mid = await pool.query<{ count: string }>(
      `select count(*)::text as count from teacher_subscriptions where account_id = $1`,
      [account!.id],
    )
    expect(mid.rows[0].count).toBe('0')

    // Second register on the same email — lands in existing-email branch.
    // MUST heal the missing row.
    const res2 = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'whatever',
          personalDataConsentAccepted: true,
          role: 'teacher',
        },
      }),
    )
    expect(res2.status).toBe(200)

    const post = await pool.query<{ plan_slug: string; state: string }>(
      `select plan_slug, state from teacher_subscriptions where account_id = $1`,
      [account!.id],
    )
    expect(post.rows).toHaveLength(1)
    expect(post.rows[0].plan_slug).toBe('free')
    expect(post.rows[0].state).toBe('active')
  })

  it('does NOT insert a free row on existing-email retry for non-teacher accounts (negative pin)', async () => {
    const email = `heal-not-teacher-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
    // First register as student.
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'correct horse battery staple',
          personalDataConsentAccepted: true,
        },
      }),
    )
    // Second register — existing-email branch. Heal must skip (no teacher role).
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'whatever',
          personalDataConsentAccepted: true,
        },
      }),
    )
    const account = await getAccountByEmail(email)
    const pool = getAuthPool()
    const rows = await pool.query<{ count: string }>(
      `select count(*)::text as count from teacher_subscriptions where account_id = $1`,
      [account!.id],
    )
    expect(rows.rows[0].count).toBe('0')
  })

  it('re-registering with the same email is idempotent (ON CONFLICT DO NOTHING)', async () => {
    // The anti-enumeration shape returns identical responses for new vs
    // existing emails. This test ensures the INSERT path doesn't fail
    // a second time even if hit twice for the same account.
    const email = `free-row-double-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'correct horse battery staple',
          personalDataConsentAccepted: true,
          role: 'teacher',
        },
      }),
    )
    // Second register on the same email — anti-enumeration symmetry,
    // but the existing row must NOT cause INSERT to fail.
    const res2 = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email,
          password: 'different password',
          personalDataConsentAccepted: true,
          role: 'teacher',
        },
      }),
    )
    expect(res2.status).toBe(200)

    const account = await getAccountByEmail(email)
    const pool = getAuthPool()
    const subRows = await pool.query<{ count: string }>(
      `select count(*)::text as count from teacher_subscriptions where account_id = $1`,
      [account!.id],
    )
    expect(subRows.rows[0].count).toBe('1')
  })
})
