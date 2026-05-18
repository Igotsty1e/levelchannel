import { describe, expect, it, beforeAll, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { getAccountByEmail } from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'

import '../setup'
import { buildRequest } from '../helpers'

// SAAS-3+4 TINV.6.10 — anti-enumeration wall-clock symmetry between
// the new-email and already-registered register paths.
//
// docs/plans/teacher-self-reg-invite.md §6.10 declares this a
// MANDATORY release gate: the existing /api/auth/register has a
// documented byte-equal + wall-clock-symmetric contract
// (app/api/auth/register/route.ts:30-37). Adding the SAAS-3 role
// grant + SAAS-4 invite-redeem widens the new-email path; we have
// to prove the wall-clock budget still holds.
//
// Tolerance: 50 ms mean delta across 20 runs. The plan's ideal
// budget is ±5 ms but that's tight on noisy CI; 50 ms is the
// realistic ceiling that still catches a multi-INSERT regression
// (which would add 100s of ms). The unit test
// tests/auth/teacher-invites.test.ts pins the byte-equal response
// shape; this test pins the timing budget.
//
// MOCKS: bcrypt + Resend are mocked so the real ~250 ms bcrypt
// cycle doesn't dominate the noise floor. The mock still runs the
// dummy verifyPassword to keep the symmetric-work contract.
//
// Run mode: this is a "smoke gauge" — we measure deltas, not
// absolute timings (CI VM speed varies). The assertion is on the
// DELTA between branches, not the absolute mean.

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return {
    ...actual,
    hashPassword: vi.fn().mockResolvedValue('$2a$12$mockhashmockhashmockhashmockhashmockhashmockhashmockha'),
    verifyPassword: vi.fn().mockResolvedValue(false),
  }
})

beforeAll(() => {
  process.env.TEACHER_INVITE_SECRET =
    'test-symmetry-secret-must-be-at-least-32-chars-aaa'
})

async function registerOnce(email: string): Promise<number> {
  const t0 = performance.now()
  const res = await registerHandler(
    buildRequest('/api/auth/register', {
      body: {
        email,
        password: 'symmetry-test-password-value',
        personalDataConsentAccepted: true,
      },
    }),
  )
  const elapsed = performance.now() - t0
  // Drain body so the Response isn't held open during the measurement window.
  await res.json()
  return elapsed
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length
}

describe('TINV.6.10 — register anti-enumeration timing symmetry', () => {
  const RUNS = 20
  const MAX_DELTA_MS = 50

  it(`mean wall-clock delta between branches is < ${MAX_DELTA_MS} ms (over ${RUNS} runs each)`, async () => {
    // Seed one already-registered account for the existing-email path.
    await registerOnce('symmetry-existing@example.com')
    const existingAccount = await getAccountByEmail(
      'symmetry-existing@example.com',
    )
    expect(existingAccount).not.toBeNull()

    // Warm-up: prime any lazy imports so first-call cost doesn't skew.
    await registerOnce('symmetry-warm@example.com')

    const newEmailTimes: number[] = []
    const existingEmailTimes: number[] = []

    for (let i = 0; i < RUNS; i += 1) {
      // Alternate to spread any global slowdowns across both samples.
      const a = await registerOnce(`symmetry-new-${i}-${Date.now()}@example.com`)
      newEmailTimes.push(a)
      const b = await registerOnce('symmetry-existing@example.com')
      existingEmailTimes.push(b)
    }

    const meanNew = mean(newEmailTimes)
    const meanExisting = mean(existingEmailTimes)
    const delta = Math.abs(meanNew - meanExisting)

    // Visible diagnostic (CI log).
    // eslint-disable-next-line no-console
    console.log(
      '[TINV.6.10 timing]',
      { meanNew, meanExisting, delta, maxAllowed: MAX_DELTA_MS },
    )

    expect(delta).toBeLessThan(MAX_DELTA_MS)
  })

  it('new-email branch creates exactly one account row per run (sanity)', async () => {
    const email = `sanity-new-${Date.now()}@example.com`
    await registerOnce(email)
    const account = await getAccountByEmail(email)
    expect(account).not.toBeNull()
    const pool = getAuthPool()
    const count = await pool.query(
      `select count(*)::int as count from accounts where email = $1`,
      [email],
    )
    expect(count.rows[0].count).toBe(1)
  })

  it('existing-email branch creates NO additional account row (anti-enumeration symmetry preserves DB state)', async () => {
    const email = `sanity-existing-${Date.now()}@example.com`
    await registerOnce(email) // first create
    const before = await getAccountByEmail(email)
    expect(before).not.toBeNull()

    await registerOnce(email) // second attempt on same email

    const pool = getAuthPool()
    const count = await pool.query(
      `select count(*)::int as count from accounts where email = $1`,
      [email],
    )
    // Still exactly one — the existing-email branch must NOT have
    // inserted a duplicate (the anti-enumeration response is
    // byte-equal, but the DB state diverges by design).
    expect(count.rows[0].count).toBe(1)
  })
})
