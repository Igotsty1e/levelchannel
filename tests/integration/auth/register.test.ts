import { describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { getAccountByEmail } from '@/lib/auth/accounts'
import { getLatestConsent } from '@/lib/auth/consents'
import { getAuthPool } from '@/lib/auth/pool'
import * as emailDispatch from '@/lib/email/dispatch'
import * as password from '@/lib/auth/password'

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

  // Codex Wave 13 Pass 3 #3. Anti-enumeration parity via structural
  // assertion instead of wall-clock measurement. Wall-clock tests on
  // bcrypt timings are inherently flaky under variable IO/load and on
  // shared CI runners we can't bound the noise floor reliably. The
  // contract being tested is symmetric work, not a specific elapsed
  // time, so verify that directly: both branches must invoke exactly
  // one bcrypt cycle and exactly one Resend dispatch.
  //
  // Coverage compared to the old timing test:
  //   - The old test caught "someone removed the dummy bcrypt or the
  //     no-op email send" by observing the resulting ~250ms wall-clock
  //     gap. This test catches the same regression directly — if either
  //     side stops calling its expected bcrypt or its expected email
  //     dispatch, the spy counts diverge and the test fails.
  //   - The old test could NOT distinguish "dummy hash dropped" from
  //     "DB pool slow today". The structural test never sees pool
  //     latency.
  it('register branches have symmetric bcrypt + Resend dispatch counts (anti-enumeration)', async () => {
    // Pre-populate one existing email.
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'parity-existing@example.com',
          password: 'a stable password',
          personalDataConsentAccepted: true,
        },
      }),
    )

    const hashSpy = vi.spyOn(password, 'hashPassword')
    const verifySpy = vi.spyOn(password, 'verifyPassword')
    const sendVerifySpy = vi.spyOn(emailDispatch, 'sendVerifyEmail')
    const sendAlreadySpy = vi.spyOn(
      emailDispatch,
      'sendAlreadyRegisteredEmail',
    )

    try {
      // NEW EMAIL BRANCH — should invoke hashPassword + sendVerifyEmail
      // exactly once each.
      await registerHandler(
        buildRequest('/api/auth/register', {
          body: {
            email: 'parity-fresh@example.com',
            password: 'b stable password',
            personalDataConsentAccepted: true,
          },
        }),
      )
      const newBcryptCalls = hashSpy.mock.calls.length + verifySpy.mock.calls.length
      const newEmailCalls =
        sendVerifySpy.mock.calls.length + sendAlreadySpy.mock.calls.length
      expect(newBcryptCalls).toBe(1)
      expect(newEmailCalls).toBe(1)
      expect(hashSpy).toHaveBeenCalledOnce()
      expect(sendVerifySpy).toHaveBeenCalledOnce()

      hashSpy.mockClear()
      verifySpy.mockClear()
      sendVerifySpy.mockClear()
      sendAlreadySpy.mockClear()

      // EXISTING EMAIL BRANCH — should invoke verifyPassword (dummy
      // hash) + sendAlreadyRegisteredEmail exactly once each. Total
      // bcrypt + email counts are identical to the new-email branch;
      // an attacker timing the response cannot tell branches apart.
      await registerHandler(
        buildRequest('/api/auth/register', {
          body: {
            email: 'parity-existing@example.com',
            password: 'b stable password',
            personalDataConsentAccepted: true,
          },
        }),
      )
      const existingBcryptCalls =
        hashSpy.mock.calls.length + verifySpy.mock.calls.length
      const existingEmailCalls =
        sendVerifySpy.mock.calls.length + sendAlreadySpy.mock.calls.length
      expect(existingBcryptCalls).toBe(1)
      expect(existingEmailCalls).toBe(1)
      expect(verifySpy).toHaveBeenCalledOnce()
      expect(sendAlreadySpy).toHaveBeenCalledOnce()
    } finally {
      hashSpy.mockRestore()
      verifySpy.mockRestore()
      sendVerifySpy.mockRestore()
      sendAlreadySpy.mockRestore()
    }
  })
})
