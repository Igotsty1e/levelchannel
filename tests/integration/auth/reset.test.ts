import { describe, expect, it } from 'vitest'

import { POST as loginHandler } from '@/app/api/auth/login/route'
import { GET as meHandler } from '@/app/api/auth/me/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as resetConfirmHandler } from '@/app/api/auth/reset-confirm/route'
import { POST as resetRequestHandler } from '@/app/api/auth/reset-request/route'
import { createPasswordReset } from '@/lib/auth/resets'
import { getAuthPool } from '@/lib/auth/pool'
import { getAccountByEmail } from '@/lib/auth/accounts'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

describe('POST /api/auth/reset-request', () => {
  it('returns 200 ok for unknown email (anti-enumeration)', async () => {
    const res = await resetRequestHandler(
      buildRequest('/api/auth/reset-request', {
        body: { email: 'unknown-reset@example.com' },
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })
  })

  it('returns 200 ok for known email + creates a reset token', async () => {
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'known-reset@example.com',
          password: 'a real password',
          personalDataConsentAccepted: true,
        },
      }),
    )

    const res = await resetRequestHandler(
      buildRequest('/api/auth/reset-request', {
        body: { email: 'known-reset@example.com' },
      }),
    )
    expect(res.status).toBe(200)

    const account = await getAccountByEmail('known-reset@example.com')
    const pool = getAuthPool()
    const tokens = await pool.query(
      `select count(*)::int as count from password_resets where account_id = $1`,
      [account!.id],
    )
    expect(tokens.rows[0].count).toBe(1)
  })

  it('returns identical body for known and unknown emails', async () => {
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'identical-known@example.com',
          password: 'real password',
          personalDataConsentAccepted: true,
        },
      }),
    )

    const a = await resetRequestHandler(
      buildRequest('/api/auth/reset-request', {
        body: { email: 'identical-known@example.com' },
      }),
    )
    const b = await resetRequestHandler(
      buildRequest('/api/auth/reset-request', {
        body: { email: 'identical-unknown@example.com' },
      }),
    )
    expect(a.status).toBe(b.status)
    expect(await a.json()).toEqual(await b.json())
  })
})

describe('POST /api/auth/reset-confirm', () => {
  it('rejects bad token', async () => {
    const res = await resetConfirmHandler(
      buildRequest('/api/auth/reset-confirm', {
        body: { token: 'not-real', password: 'new password value' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects weak password without consuming token', async () => {
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'weak-reset@example.com',
          password: 'old password',
          personalDataConsentAccepted: true,
        },
      }),
    )
    const account = await getAccountByEmail('weak-reset@example.com')
    const { token } = await createPasswordReset(account!.id)

    const res = await resetConfirmHandler(
      buildRequest('/api/auth/reset-confirm', {
        body: { token, password: '123' },
      }),
    )
    expect(res.status).toBe(400)

    // Token should NOT be consumed — try again with valid password
    const retry = await resetConfirmHandler(
      buildRequest('/api/auth/reset-confirm', {
        body: { token, password: 'valid new password' },
      }),
    )
    expect(retry.status).toBe(200)
  })

  it('signs out everywhere on success (mech-5 invariant)', async () => {
    // Register + log in twice (two devices)
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: 'sign-out@example.com',
          password: 'old password value',
          personalDataConsentAccepted: true,
        },
      }),
    )

    const loginA = await loginHandler(
      buildRequest('/api/auth/login', {
        body: { email: 'sign-out@example.com', password: 'old password value' },
      }),
    )
    const cookieA = extractSessionCookie(loginA.headers.get('Set-Cookie'))!

    const loginB = await loginHandler(
      buildRequest('/api/auth/login', {
        body: { email: 'sign-out@example.com', password: 'old password value' },
      }),
    )
    const cookieB = extractSessionCookie(loginB.headers.get('Set-Cookie'))!

    // Both sessions valid before reset
    const meA1 = await meHandler(buildRequest('/api/auth/me', { cookie: cookieA }))
    const meB1 = await meHandler(buildRequest('/api/auth/me', { cookie: cookieB }))
    expect(meA1.status).toBe(200)
    expect(meB1.status).toBe(200)

    // Reset password
    const account = await getAccountByEmail('sign-out@example.com')
    const { token } = await createPasswordReset(account!.id)

    const resetRes = await resetConfirmHandler(
      buildRequest('/api/auth/reset-confirm', {
        body: { token, password: 'new password value' },
      }),
    )
    expect(resetRes.status).toBe(200)

    // Get the freshly-issued session cookie for the actor who just reset
    const cookieNew = extractSessionCookie(resetRes.headers.get('Set-Cookie'))!

    // Both old sessions revoked
    const meA2 = await meHandler(buildRequest('/api/auth/me', { cookie: cookieA }))
    const meB2 = await meHandler(buildRequest('/api/auth/me', { cookie: cookieB }))
    expect(meA2.status).toBe(401)
    expect(meB2.status).toBe(401)

    // New session works
    const meNew = await meHandler(buildRequest('/api/auth/me', { cookie: cookieNew }))
    expect(meNew.status).toBe(200)

    // Old password no longer accepted
    const oldLogin = await loginHandler(
      buildRequest('/api/auth/login', {
        body: { email: 'sign-out@example.com', password: 'old password value' },
      }),
    )
    expect(oldLogin.status).toBe(401)

    // New password accepted
    const newLogin = await loginHandler(
      buildRequest('/api/auth/login', {
        body: { email: 'sign-out@example.com', password: 'new password value' },
      }),
    )
    expect(newLogin.status).toBe(200)
  })
})
