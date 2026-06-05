import { describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as roleHandler } from '@/app/api/admin/accounts/[id]/role/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

// free-tier-saas-card-and-subscription-row plan §0b-1 + §0c-1 closure
// (2026-06-05).
//
// Pins the admin-grant writer-path: when admin POSTs
// /api/admin/accounts/[id]/role with role=teacher, the route MUST
// insert teacher_subscriptions{plan_slug='free', state='active'} for
// the target. Without this INSERT, admin-promoted teachers would hit
// EMPTY_CAPS (same bug as the self-register path before this fix).

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

async function makeLearner(prefix: string): Promise<{ accountId: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password: 'StrongPassword123', personalDataConsentAccepted: true },
    }),
  )
  const acc = await getAccountByEmail(email)
  await markAccountVerified(acc!.id)
  return { accountId: acc!.id }
}

describe('POST /api/admin/accounts/[id]/role — teacher grant inserts free-row', () => {
  it('admin grants teacher role → teacher_subscriptions{plan_slug:"free", state:"active"} inserted', async () => {
    const admin = await makeAdmin('admin-grant-free-row')
    const target = await makeLearner('admin-grant-free-row-target')

    // Pre-condition: target has NO teacher_subscriptions row.
    const pool = getAuthPool()
    const pre = await pool.query<{ count: string }>(
      `select count(*)::text as count from teacher_subscriptions where account_id = $1`,
      [target.accountId],
    )
    expect(pre.rows[0].count).toBe('0')

    const res = await roleHandler(
      buildRequest(`/api/admin/accounts/${target.accountId}/role`, {
        cookie: admin.cookie,
        body: { role: 'teacher', op: 'grant' },
        headers: { 'Idempotency-Key': `admin-grant-free-row-${Date.now()}` },
      }),
      { params: Promise.resolve({ id: target.accountId }) },
    )
    expect(res.status).toBe(200)

    const post = await pool.query<{ plan_slug: string; state: string }>(
      `select plan_slug, state from teacher_subscriptions where account_id = $1`,
      [target.accountId],
    )
    expect(post.rows).toHaveLength(1)
    expect(post.rows[0].plan_slug).toBe('free')
    expect(post.rows[0].state).toBe('active')
  })

  it('admin grants admin role → NO teacher_subscriptions row inserted (negative pin)', async () => {
    // Wave-paranoia R1 WARN #2 closure: explicit negative pin for the
    // admin role grant (the only grant type besides teacher that the
    // route accepts; per plan §0c-1).
    const admin = await makeAdmin('admin-grant-admin-no-row')
    const target = await makeLearner('admin-grant-admin-no-row-target')

    const res = await roleHandler(
      buildRequest(`/api/admin/accounts/${target.accountId}/role`, {
        cookie: admin.cookie,
        body: { role: 'admin', op: 'grant' },
        headers: { 'Idempotency-Key': `admin-grant-admin-no-row-${Date.now()}` },
      }),
      { params: Promise.resolve({ id: target.accountId }) },
    )
    expect(res.status).toBe(200)

    const pool = getAuthPool()
    const rows = await pool.query<{ count: string }>(
      `select count(*)::text as count from teacher_subscriptions where account_id = $1`,
      [target.accountId],
    )
    expect(rows.rows[0].count).toBe('0')
  })

  it('admin grants student role → NO teacher_subscriptions row inserted (negative pin)', async () => {
    const admin = await makeAdmin('admin-grant-student-no-row')
    const target = await makeLearner('admin-grant-student-no-row-target')

    const res = await roleHandler(
      buildRequest(`/api/admin/accounts/${target.accountId}/role`, {
        cookie: admin.cookie,
        body: { role: 'student', op: 'grant' },
        headers: { 'Idempotency-Key': `admin-grant-student-no-row-${Date.now()}` },
      }),
      { params: Promise.resolve({ id: target.accountId }) },
    )
    expect(res.status).toBe(200)

    const pool = getAuthPool()
    const rows = await pool.query<{ count: string }>(
      `select count(*)::text as count from teacher_subscriptions where account_id = $1`,
      [target.accountId],
    )
    expect(rows.rows[0].count).toBe('0')
  })
})
