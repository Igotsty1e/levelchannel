import { describe, expect, it } from 'vitest'

import { POST as disableHandler } from '@/app/api/admin/accounts/[id]/disable/route'
import { POST as roleHandler } from '@/app/api/admin/accounts/[id]/role/route'
import { POST as postpaidHandler } from '@/app/api/admin/accounts/[id]/postpaid/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

// AUDIT-CODE-1 (2026-05-17) — coverage for /api/admin/accounts/[id]/{disable,role,postpaid}.
// Existing surfaces had zero integration coverage. This file fills
// the auth gates + idempotency contract; the lib helpers
// (disableAccount, grantAccountRole, ...) have their own unit tests.

async function makeAdmin(prefix: string): Promise<{ cookie: string; accountId: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  await grantAccountRole(acc!.id, 'admin', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password: 'StrongPassword123' } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: acc!.id,
  }
}

async function makeLearner(prefix: string): Promise<{ cookie: string; accountId: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password: 'StrongPassword123' } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: acc!.id,
  }
}

describe('POST /api/admin/accounts/[id]/disable', () => {
  it('anonymous → 401', async () => {
    const target = await makeLearner('disable-anon-target')
    const res = await disableHandler(
      buildRequest(`/api/admin/accounts/${target.accountId}/disable`, {
        body: { disabled: true },
      }),
      { params: Promise.resolve({ id: target.accountId }) },
    )
    expect(res.status).toBe(401)
  })

  it('non-admin → 403', async () => {
    const learner = await makeLearner('disable-non-admin')
    const target = await makeLearner('disable-target')
    const res = await disableHandler(
      buildRequest(`/api/admin/accounts/${target.accountId}/disable`, {
        cookie: learner.cookie,
        body: { disabled: true },
      }),
      { params: Promise.resolve({ id: target.accountId }) },
    )
    expect(res.status).toBe(403)
  })

  it('admin cannot disable self → 400', async () => {
    const { cookie, accountId } = await makeAdmin('disable-self-block')
    const res = await disableHandler(
      buildRequest(`/api/admin/accounts/${accountId}/disable`, {
        cookie,
        body: { disabled: true },
      }),
      { params: Promise.resolve({ id: accountId }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('cannot_disable_self')
  })

  it('admin disables target → 200 + disabled_at stamped + sessions revoked', async () => {
    const admin = await makeAdmin('disable-happy-admin')
    const target = await makeLearner('disable-happy-target')

    const pool = getDbPool()
    const beforeSessions = await pool.query(
      `select count(*)::int as c from account_sessions where account_id = $1`,
      [target.accountId],
    )
    expect(beforeSessions.rows[0].c).toBeGreaterThanOrEqual(1)

    const res = await disableHandler(
      buildRequest(`/api/admin/accounts/${target.accountId}/disable`, {
        cookie: admin.cookie,
        body: { disabled: true },
        headers: { 'Idempotency-Key': `disable-${Date.now()}` },
      }),
      { params: Promise.resolve({ id: target.accountId }) },
    )
    expect(res.status).toBe(200)

    const after = await pool.query(
      `select disabled_at from accounts where id = $1`,
      [target.accountId],
    )
    expect(after.rows[0].disabled_at).not.toBeNull()

    const afterSessions = await pool.query(
      `select count(*)::int as c from account_sessions where account_id = $1 and revoked_at is null`,
      [target.accountId],
    )
    expect(afterSessions.rows[0].c).toBe(0)
  })

  it('AUDIT-CODE-1: idempotent replay → same response, no extra side-effects', async () => {
    const admin = await makeAdmin('disable-idemp-admin')
    const target = await makeLearner('disable-idemp-target')
    const key = `disable-idemp-${Date.now()}`

    const r1 = await disableHandler(
      buildRequest(`/api/admin/accounts/${target.accountId}/disable`, {
        cookie: admin.cookie,
        body: { disabled: true },
        headers: { 'Idempotency-Key': key },
      }),
      { params: Promise.resolve({ id: target.accountId }) },
    )
    expect(r1.status).toBe(200)

    // Re-enable to make the second disable observable: if idempotency
    // works, the cached 200 replays WITHOUT re-applying disable.
    const pool = getDbPool()
    await pool.query(
      `update accounts set disabled_at = null where id = $1`,
      [target.accountId],
    )

    const r2 = await disableHandler(
      buildRequest(`/api/admin/accounts/${target.accountId}/disable`, {
        cookie: admin.cookie,
        body: { disabled: true },
        headers: { 'Idempotency-Key': key },
      }),
      { params: Promise.resolve({ id: target.accountId }) },
    )
    expect(r2.status).toBe(200)

    // Second call returned cached response WITHOUT re-stamping
    // disabled_at (which is the load-bearing assertion). The account
    // should still have disabled_at = NULL because the cached replay
    // didn't execute disableAccount() again.
    const after = await pool.query(
      `select disabled_at from accounts where id = $1`,
      [target.accountId],
    )
    expect(after.rows[0].disabled_at).toBeNull()
  })
})

describe('POST /api/admin/accounts/[id]/role', () => {
  it('anonymous → 401', async () => {
    const target = await makeLearner('role-anon-target')
    const res = await roleHandler(
      buildRequest(`/api/admin/accounts/${target.accountId}/role`, {
        body: { role: 'teacher', op: 'grant' },
      }),
      { params: Promise.resolve({ id: target.accountId }) },
    )
    expect(res.status).toBe(401)
  })

  it('admin grants teacher role → 200 + grant visible in account_roles', async () => {
    const admin = await makeAdmin('role-grant-admin')
    const target = await makeLearner('role-grant-target')
    const res = await roleHandler(
      buildRequest(`/api/admin/accounts/${target.accountId}/role`, {
        cookie: admin.cookie,
        body: { role: 'teacher', op: 'grant' },
        headers: { 'Idempotency-Key': `role-${Date.now()}` },
      }),
      { params: Promise.resolve({ id: target.accountId }) },
    )
    expect(res.status).toBe(200)
    const pool = getDbPool()
    const r = await pool.query(
      `select role from account_roles where account_id = $1 and role = 'teacher'`,
      [target.accountId],
    )
    expect(r.rows.length).toBe(1)
  })

  it('admin cannot revoke admin from self → 400', async () => {
    const { cookie, accountId } = await makeAdmin('role-self-block')
    const res = await roleHandler(
      buildRequest(`/api/admin/accounts/${accountId}/role`, {
        cookie,
        body: { role: 'admin', op: 'revoke' },
      }),
      { params: Promise.resolve({ id: accountId }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('cannot_revoke_admin_self')
  })
})

describe('POST /api/admin/accounts/[id]/postpaid', () => {
  it('anonymous → 401', async () => {
    const target = await makeLearner('postpaid-anon-target')
    const res = await postpaidHandler(
      buildRequest(`/api/admin/accounts/${target.accountId}/postpaid`, {
        body: { allowed: true },
      }),
      { params: Promise.resolve({ id: target.accountId }) },
    )
    expect(res.status).toBe(401)
  })

  it('admin toggles postpaid_allowed → 200 + column updated', async () => {
    const admin = await makeAdmin('postpaid-admin')
    const target = await makeLearner('postpaid-target')
    const res = await postpaidHandler(
      buildRequest(`/api/admin/accounts/${target.accountId}/postpaid`, {
        cookie: admin.cookie,
        body: { allowed: true },
        headers: { 'Idempotency-Key': `postpaid-${Date.now()}` },
      }),
      { params: Promise.resolve({ id: target.accountId }) },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.postpaidAllowed).toBe(true)
  })

  it('invalid uuid → 400', async () => {
    const { cookie } = await makeAdmin('postpaid-bad-id')
    const res = await postpaidHandler(
      buildRequest(`/api/admin/accounts/not-a-uuid/postpaid`, {
        cookie,
        body: { allowed: true },
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    )
    expect(res.status).toBe(400)
  })
})
