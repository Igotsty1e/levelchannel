import bcrypt from 'bcryptjs'
import { describe, expect, it, vi } from 'vitest'

import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import * as dummyHash from '@/lib/auth/dummy-hash'
import * as password from '@/lib/auth/password'
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
    // 2026-06-02: register now grants `student` role explicitly for
    // learner registrations (was implicit-no-role before).
    expect(json.account.roles).toEqual(['student'])
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

  // Codex Wave 13 Pass 3 #4. Constant-time D3 parity via structural
  // assertion instead of wall-clock measurement. See register.test.ts
  // for the same reasoning — wall-clock bcrypt timings are inherently
  // flaky under variable IO/load. The contract is "both rejection
  // paths invoke exactly one bcrypt cycle through
  // constantTimeVerifyPassword", which we can verify directly with a
  // spy.
  it('login rejection paths both call constantTimeVerifyPassword exactly once (anti-enumeration)', async () => {
    await registerOne('parity-known@example.com', 'real password value')

    const wrapperSpy = vi.spyOn(dummyHash, 'constantTimeVerifyPassword')
    try {
      // Unknown email path — getAccountByEmail returns null, route
      // falls through with accountUsableHash=null, the helper hashes
      // against the dummy.
      await loginHandler(
        buildRequest('/api/auth/login', {
          body: { email: 'parity-unknown@example.com', password: 'whatever' },
        }),
      )
      expect(wrapperSpy).toHaveBeenCalledOnce()
      const unknownArgs = wrapperSpy.mock.calls[0]
      expect(unknownArgs[1]).toBeNull()

      wrapperSpy.mockClear()

      // Known email + wrong password — getAccountByEmail returns the
      // row, route passes the real hash, the helper verifies against
      // it. Same single-call signature, just with a non-null hash arg.
      await loginHandler(
        buildRequest('/api/auth/login', {
          body: { email: 'parity-known@example.com', password: 'wrong-pwd' },
        }),
      )
      expect(wrapperSpy).toHaveBeenCalledOnce()
      const knownArgs = wrapperSpy.mock.calls[0]
      expect(knownArgs[1]).toBeTruthy()
      expect(typeof knownArgs[1]).toBe('string')
      expect(knownArgs[1]).toMatch(/^\$2[aby]\$/)
    } finally {
      wrapperSpy.mockRestore()
    }
  })

  // Codex Wave 38 review HIGH. The above test proves the route calls
  // constantTimeVerifyPassword; it does NOT prove the helper actually
  // runs one bcrypt cycle. A regression to "if (!realHash) return false"
  // would keep the route test green while erasing the constant-time
  // contract. Pin the helper internals directly: both branches must
  // delegate to verifyPassword exactly once.
  it('constantTimeVerifyPassword invokes one bcrypt cycle for null + non-null realHash', async () => {
    const verifySpy = vi.spyOn(password, 'verifyPassword')
    try {
      // Falsy realHash → helper must fetch the dummy and call
      // verifyPassword against IT, not short-circuit return false.
      verifySpy.mockClear()
      await dummyHash.constantTimeVerifyPassword('any-password', null)
      expect(verifySpy).toHaveBeenCalledOnce()
      const nullCallArgs = verifySpy.mock.calls[0]
      expect(typeof nullCallArgs[1]).toBe('string')
      expect(nullCallArgs[1]).toMatch(/^\$2[aby]\$/)
      expect(nullCallArgs[1]!.length).toBeGreaterThan(40)

      // Real realHash → helper must call verifyPassword against the
      // supplied hash, not against the dummy.
      verifySpy.mockClear()
      const realHash = '$2b$12$0000000000000000000000000000000000000000000000000000'
      await dummyHash.constantTimeVerifyPassword('any-password', realHash)
      expect(verifySpy).toHaveBeenCalledOnce()
      expect(verifySpy.mock.calls[0][1]).toBe(realHash)
    } finally {
      verifySpy.mockRestore()
    }
  })

  it('allows login when email is not yet verified (Phase 1B D4)', async () => {
    // Phase 1B D4: login MUST succeed even when account.emailVerifiedAt
    // is null. Cabinet stays accessible (banner shown); payment routes
    // gate on email_verified_at separately. The invariant under test is
    // that login itself does NOT pre-block based on verification state.
    const email = 'unverified@example.com'
    const password = 'CorrectHorse77!'

    await registerOne(email, password)

    // Sanity check: register did NOT mark the account as verified.
    const pool = getAuthPool()
    const before = await pool.query(
      `select email_verified_at from accounts where email = $1`,
      [email],
    )
    expect(before.rows[0].email_verified_at).toBeNull()

    const res = await loginHandler(
      buildRequest('/api/auth/login', { body: { email, password } }),
    )
    expect(res.status).toBe(200)

    const setCookie = res.headers.get('Set-Cookie')
    expect(extractSessionCookie(setCookie)).not.toBeNull()

    const body = await res.json()
    expect(body.account.emailVerifiedAt).toBeNull()
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
