import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'

import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { getAuthPool } from '@/lib/auth/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

async function registerOne(email: string, password: string) {
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
}

describe('POST /api/auth/login', () => {
  it('returns session cookie + account on success', async () => {
    await registerOne('login-ok@example.com', 'a real password value')

    const res = await loginHandler(
      buildRequest('/api/auth/login', {
        body: { email: 'login-ok@example.com', password: 'a real password value' },
      }),
    )

    expect(res.status).toBe(200)
    const cookie = extractSessionCookie(res.headers.get('Set-Cookie'))
    expect(cookie).toMatch(/^lc_session=/)

    const json = await res.json()
    expect(json.account.email).toBe('login-ok@example.com')
    expect(json.account.emailVerifiedAt).toBeNull()
    expect(json.account.roles).toEqual([])
  })

  it('rejects wrong password with identical 401', async () => {
    await registerOne('login-wrong@example.com', 'correct password')
    const res = await loginHandler(
      buildRequest('/api/auth/login', {
        body: { email: 'login-wrong@example.com', password: 'incorrect' },
      }),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('rejects unknown email with identical 401 body', async () => {
    const wrongPasswordRes = await loginHandler(
      buildRequest('/api/auth/login', {
        body: { email: 'unknown@example.com', password: 'whatever' },
      }),
    )
    expect(wrongPasswordRes.status).toBe(401)
    const json = await wrongPasswordRes.json()
    expect(json.error).toBeTruthy()
  })

  it('login with unknown email and known-but-wrong-password take similar time (constant-time D3)', async () => {
    await registerOne('time-known@example.com', 'real password value')

    async function timeOne(email: string, password: string) {
      const start = performance.now()
      const res = await loginHandler(
        buildRequest('/api/auth/login', { body: { email, password } }),
      )
      await res.json()
      return performance.now() - start
    }

    // Warm up dummy hash module-load
    await timeOne('warmup@example.com', 'whatever')

    const unknownDurations: number[] = []
    const knownWrongDurations: number[] = []
    for (let i = 0; i < 3; i++) {
      unknownDurations.push(await timeOne(`unknown-${i}@example.com`, 'whatever'))
      knownWrongDurations.push(
        await timeOne('time-known@example.com', `bad-pwd-${i}`),
      )
    }

    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const delta = Math.abs(avg(unknownDurations) - avg(knownWrongDurations))

    // ±100ms per /plan-eng-review mech-6, with retry headroom.
    expect(delta).toBeLessThan(150)
  })

  it('silently upgrades a legacy lower-cost password hash on successful login', async () => {
    const email = 'rehash@example.com'
    const password = 'CorrectHorse77!'
    const pool = getAuthPool()

    // Plant an account with a legacy bcrypt hash (cost=10, current is 12).
    // We bypass register so we can control the hash.
    const legacyHash = await bcrypt.hash(password, 10)
    await pool.query(
      `insert into accounts (id, email, password_hash, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, now(), now())`,
      [email, legacyHash],
    )

    // Login. Should succeed and silently re-hash.
    const res = await loginHandler(
      buildRequest('/api/auth/login', { body: { email, password } }),
    )
    expect(res.status).toBe(200)

    // Verify the stored hash is no longer cost=10.
    const { rows } = await pool.query(
      `select password_hash from accounts where email = $1`,
      [email],
    )
    const storedHash = rows[0].password_hash as string
    expect(storedHash).not.toBe(legacyHash)
    expect(storedHash).toMatch(/^\$2[aby]\$12\$/) // upgraded to current cost
  })
})
