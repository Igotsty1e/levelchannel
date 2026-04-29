import { describe, expect, it } from 'vitest'

import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as resendVerifyHandler } from '@/app/api/auth/resend-verify/route'
import { GET as verifyHandler } from '@/app/api/auth/verify/route'
import { getAuthPool } from '@/lib/auth/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

async function registerWithSession(email: string, password: string): Promise<string> {
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const loginRes = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  const cookie = extractSessionCookie(loginRes.headers.get('Set-Cookie'))
  if (!cookie) throw new Error('login did not set a session cookie')
  return cookie
}

async function countVerificationTokens(email: string): Promise<number> {
  const { rows } = await getAuthPool().query(
    `select count(*)::int as n from email_verifications v
     join accounts a on a.id = v.account_id where a.email = $1`,
    [email],
  )
  return rows[0]?.n || 0
}

describe('POST /api/auth/resend-verify', () => {
  it('rejects unauthenticated callers with 401', async () => {
    const res = await resendVerifyHandler(
      buildRequest('/api/auth/resend-verify', { body: {} }),
    )
    expect(res.status).toBe(401)
  })

  it('issues a fresh verify token and sends email when authenticated and unverified', async () => {
    const email = 'resend-1@example.com'
    const cookie = await registerWithSession(email, 'CorrectHorse77!')

    // After register: 1 token already exists.
    expect(await countVerificationTokens(email)).toBe(1)

    const res = await resendVerifyHandler(
      buildRequest('/api/auth/resend-verify', { body: {}, cookie }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // After resend: a second token is in the table; the old one is NOT
    // pre-emptively invalidated (single-use enforcement at consume time
    // covers that). 2 tokens valid simultaneously is intentional.
    expect(await countVerificationTokens(email)).toBe(2)
  })

  it('is a no-op (still 200) when the account is already verified', async () => {
    const email = 'resend-2@example.com'
    const cookie = await registerWithSession(email, 'CorrectHorse77!')

    // Fast-forward: pull the token, consume it via /verify.
    const { rows } = await getAuthPool().query(
      `select v.token_hash from email_verifications v
       join accounts a on a.id = v.account_id where a.email = $1`,
      [email],
    )
    expect(rows.length).toBeGreaterThan(0)

    // We can't easily reconstruct the plaintext token from the hash,
    // so consume by mass-marking the account as verified directly.
    // The behavioural property under test here is "endpoint returns
    // 200 ok and does NOT mint a new token when emailVerifiedAt is
    // non-null", which is independent of how verification was reached.
    await getAuthPool().query(
      `update accounts set email_verified_at = now() where email = $1`,
      [email],
    )
    const before = await countVerificationTokens(email)

    const res = await resendVerifyHandler(
      buildRequest('/api/auth/resend-verify', { body: {}, cookie }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // No new token was minted — idempotent on already-verified.
    expect(await countVerificationTokens(email)).toBe(before)
  })

  it('rate-limits the same account to 3 sends per hour', async () => {
    const email = 'resend-3@example.com'
    const cookie = await registerWithSession(email, 'CorrectHorse77!')

    // First call after register is the 1st explicit resend.
    // 2 more should pass (3 total per the per-account hourly cap).
    for (let i = 1; i <= 2; i++) {
      const res = await resendVerifyHandler(
        buildRequest('/api/auth/resend-verify', { body: {}, cookie }),
      )
      expect(res.status, `attempt #${i}`).toBe(200)
    }
    // 3rd explicit resend should still pass (since register's automatic
    // first send doesn't go through the resend-verify rate-limit scope).
    const ok3 = await resendVerifyHandler(
      buildRequest('/api/auth/resend-verify', { body: {}, cookie }),
    )
    expect(ok3.status).toBe(200)

    // 4th must be rate-limited (429).
    const tooMany = await resendVerifyHandler(
      buildRequest('/api/auth/resend-verify', { body: {}, cookie }),
    )
    expect(tooMany.status).toBe(429)
  })
})

// Suppress unused-import warning for verifyHandler (kept for symmetry
// with the rest of the suite — useful if a follow-up wants to test the
// full re-verify chain end-to-end).
void verifyHandler
