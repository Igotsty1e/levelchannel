import { describe, expect, it } from 'vitest'

import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as logoutHandler } from '@/app/api/auth/logout/route'
import { GET as meHandler } from '@/app/api/auth/me/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { GET as verifyHandler } from '@/app/api/auth/verify/route'
import { getAuthPool } from '@/lib/auth/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

async function registerAndGetVerifyToken(email: string, password: string) {
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  // Pull the just-issued verify token directly from the DB by joining on
  // accounts. Token's plaintext is in the email body (console fallback);
  // we don't parse logs, we mint a fresh test-side token instead.
  const pool = getAuthPool()
  const result = await pool.query(
    `select v.token_hash
     from email_verifications v
     join accounts a on a.id = v.account_id
     where a.email = $1`,
    [email],
  )
  return result.rows[0]?.token_hash as string | undefined
}

async function loginAndGetCookie(email: string, password: string) {
  const res = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return extractSessionCookie(res.headers.get('Set-Cookie'))
}

describe('GET /api/auth/me', () => {
  it('returns 401 without cookie', async () => {
    const res = await meHandler(buildRequest('/api/auth/me'))
    expect(res.status).toBe(401)
  })

  it('returns account payload with valid session cookie', async () => {
    await registerAndGetVerifyToken('me-user@example.com', 'a real password')
    const cookie = await loginAndGetCookie('me-user@example.com', 'a real password')

    const res = await meHandler(buildRequest('/api/auth/me', { cookie: cookie! }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.account.email).toBe('me-user@example.com')
    expect(json.session.id).toBeTruthy()
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes session and clears cookie', async () => {
    await registerAndGetVerifyToken('logout-user@example.com', 'a real password')
    const cookie = await loginAndGetCookie('logout-user@example.com', 'a real password')

    const logoutRes = await logoutHandler(
      buildRequest('/api/auth/logout', { method: 'POST', body: {}, cookie: cookie! }),
    )
    expect(logoutRes.status).toBe(200)
    expect(logoutRes.headers.get('Set-Cookie')).toMatch(/lc_session=;[\s\S]*Max-Age=0/)

    // Subsequent /me with the old cookie should return 401
    const meRes = await meHandler(buildRequest('/api/auth/me', { cookie: cookie! }))
    expect(meRes.status).toBe(401)
  })

  it('is replay-safe: repeated logout returns 200', async () => {
    await registerAndGetVerifyToken('logout-replay@example.com', 'a real password')
    const cookie = await loginAndGetCookie('logout-replay@example.com', 'a real password')

    const first = await logoutHandler(
      buildRequest('/api/auth/logout', { method: 'POST', body: {}, cookie: cookie! }),
    )
    const second = await logoutHandler(
      buildRequest('/api/auth/logout', { method: 'POST', body: {}, cookie: cookie! }),
    )
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })
})

describe('GET /api/auth/verify', () => {
  it('redirects to /verify-failed on bad token', async () => {
    const res = await verifyHandler(
      buildRequest('/api/auth/verify', { searchParams: { token: 'not-a-real-token' } }),
    )
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toContain('/verify-failed')
  })

  it('verifies account + creates session on valid token', async () => {
    // We need the plaintext token. The simplest path: re-derive by minting
    // a new one through the lib — bypasses email console fallback.
    const { createEmailVerification } = await import('@/lib/auth/verifications')
    const { createAccount } = await import('@/lib/auth/accounts')
    const { hashPassword } = await import('@/lib/auth/password')

    const account = await createAccount({
      email: 'verify-flow@example.com',
      passwordHash: await hashPassword('test password'),
    })
    const { token } = await createEmailVerification(account.id)

    const res = await verifyHandler(
      buildRequest('/api/auth/verify', { searchParams: { token } }),
    )

    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toContain('/cabinet')
    expect(res.headers.get('Set-Cookie')).toMatch(/^lc_session=/)

    // Account is now verified
    const pool = getAuthPool()
    const row = await pool.query(
      `select email_verified_at from accounts where id = $1`,
      [account.id],
    )
    expect(row.rows[0].email_verified_at).not.toBeNull()
  })

  it('replay returns /verify-failed (single-use enforced)', async () => {
    const { createEmailVerification } = await import('@/lib/auth/verifications')
    const { createAccount } = await import('@/lib/auth/accounts')
    const { hashPassword } = await import('@/lib/auth/password')

    const account = await createAccount({
      email: 'verify-replay@example.com',
      passwordHash: await hashPassword('test password'),
    })
    const { token } = await createEmailVerification(account.id)

    const first = await verifyHandler(
      buildRequest('/api/auth/verify', { searchParams: { token } }),
    )
    expect(first.headers.get('Location')).toContain('/cabinet')

    const second = await verifyHandler(
      buildRequest('/api/auth/verify', { searchParams: { token } }),
    )
    expect(second.headers.get('Location')).toContain('/verify-failed')
  })
})
