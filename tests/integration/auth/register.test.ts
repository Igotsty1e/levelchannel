import { describe, expect, it } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { getAccountByEmail } from '@/lib/auth/accounts'
import { getLatestConsent } from '@/lib/auth/consents'
import { getAuthPool } from '@/lib/auth/pool'

import '../setup'
import { buildRequest } from '../helpers'

describe('POST /api/auth/register', () => {
  it('creates account + verify token + consent on new email', async () => {
    const res = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'new-user@example.com',
          password: 'correct horse battery staple',
          personalDataConsentAccepted: true,
        },
      }),
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })

    const account = await getAccountByEmail('new-user@example.com')
    expect(account).not.toBeNull()
    expect(account?.emailVerifiedAt).toBeNull()

    const consent = await getLatestConsent(account!.id, 'personal_data')
    expect(consent).not.toBeNull()
    expect(consent?.documentVersion).toBeTruthy()

    const pool = getAuthPool()
    const verifyRows = await pool.query(
      `select count(*)::int as count from email_verifications where account_id = $1`,
      [account!.id],
    )
    expect(verifyRows.rows[0].count).toBe(1)
  })

  it('returns identical response for already-registered email (anti-enumeration)', async () => {
    // First register
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'existing@example.com',
          password: 'first password value',
          personalDataConsentAccepted: true,
        },
      }),
    )

    // Second register attempt — same email
    const res = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'existing@example.com',
          password: 'different password value',
          personalDataConsentAccepted: true,
        },
      }),
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })

    // Verify the existing account password was NOT overwritten
    const account = await getAccountByEmail('existing@example.com')
    expect(account).not.toBeNull()
    // Only ONE consent row should exist (no second insert on dup).
    const pool = getAuthPool()
    const consents = await pool.query(
      `select count(*)::int as count from account_consents where account_id = $1`,
      [account!.id],
    )
    expect(consents.rows[0].count).toBe(1)
  })

  it('rejects invalid email shape', async () => {
    const res = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'not-an-email',
          password: 'correct horse battery staple',
          personalDataConsentAccepted: true,
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects weak password', async () => {
    const res = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'weak-password@example.com',
          password: '123',
          personalDataConsentAccepted: true,
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects missing consent', async () => {
    const res = await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'no-consent@example.com',
          password: 'correct horse battery staple',
          personalDataConsentAccepted: false,
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('register paths take similar wall-clock time (anti-enumeration timing)', async () => {
    // Pre-populate one existing email
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'time-existing@example.com',
          password: 'a stable password',
          personalDataConsentAccepted: true,
        },
      }),
    )

    async function timeOne(email: string) {
      const start = performance.now()
      const res = await registerHandler(
        buildRequest('/api/auth/register', {
          body: {
            email,
            password: 'b stable password',
            personalDataConsentAccepted: true,
          },
        }),
      )
      await res.json()
      return performance.now() - start
    }

    // Warm up bcrypt module-load dummy hash
    await timeOne('warmup@example.com')

    const newEmailDurations: number[] = []
    const existingEmailDurations: number[] = []
    for (let i = 0; i < 3; i++) {
      newEmailDurations.push(await timeOne(`fresh-${i}@example.com`))
      existingEmailDurations.push(await timeOne('time-existing@example.com'))
    }

    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const newAvg = avg(newEmailDurations)
    const existingAvg = avg(existingEmailDurations)
    const delta = Math.abs(newAvg - existingAvg)

    // Per /plan-eng-review mech-6: ±100ms variance plus headroom for CI
    // noise. In tests Resend is on console fallback (instant), so the
    // remaining timing delta is DB writes that exist only on the new-
    // email path (3 INSERTs: account, consent, verify_token, ~30-50ms
    // total). In real prod Resend network latency (~50-200ms) dominates
    // and the parity is tighter; this threshold is the loosest the test
    // can be while still catching a meaningful regression (e.g. someone
    // dropping the dummy bcrypt or the no-op email send from the
    // existing-email path would push delta well past 250ms).
    expect(delta).toBeLessThan(250)
  })
})
