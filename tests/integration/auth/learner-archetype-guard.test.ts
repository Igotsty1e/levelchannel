import { describe, expect, it } from 'vitest'

import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  disableAccount,
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { requireLearnerArchetypeAndVerified } from '@/lib/auth/guards'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

// AUDIT-SEC-3 (2026-05-17) — request-time learner-archetype guard
// must align with the canonical predicate from
// `lib/auth/learner-archetype.ts`. Before this fix, a user inside
// the deletion grace period (scheduled_purge_at set) could still
// hit /api/slots/[id]/book and other learner-write endpoints; the
// role check alone was insufficient.

async function makeLearnerWithSession(prefix: string): Promise<{ cookie: string; accountId: string }> {
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

describe('requireLearnerArchetypeAndVerified — canonical-predicate alignment (AUDIT-SEC-3)', () => {
  it('happy path: verified learner-archetype account passes', async () => {
    const { cookie } = await makeLearnerWithSession('learner-happy')
    const result = await requireLearnerArchetypeAndVerified(
      buildRequest('/anything', { cookie }),
    )
    expect(result.ok).toBe(true)
  })

  it('admin role → 403 (existing role gate)', async () => {
    const { cookie, accountId } = await makeLearnerWithSession('learner-admin-elevated')
    await grantAccountRole(accountId, 'admin', null)
    const result = await requireLearnerArchetypeAndVerified(
      buildRequest('/anything', { cookie }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
  })

  it('teacher role → 403 (existing role gate)', async () => {
    const { cookie, accountId } = await makeLearnerWithSession('learner-teacher-elevated')
    await grantAccountRole(accountId, 'teacher', null)
    const result = await requireLearnerArchetypeAndVerified(
      buildRequest('/anything', { cookie }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
  })

  it('disabled_at IS NOT NULL → 401 from layered auth gate (lookupSession blocks first)', async () => {
    // Post-merge paranoia round 1 WARN #4 closure: this test was
    // accepting [401, 403] which masked whether the canonical
    // predicate actually fired. In reality, `lookupSession`
    // (lib/auth/sessions.ts:68) checks `a.disabled_at` in the join,
    // so the auth gate ALWAYS bounces first with 401 for this
    // column. The canonical predicate's `disabled_at` clause is
    // defense-in-depth (covers a hypothetical future where
    // lookupSession drops the column) but is unreachable through
    // requireLearnerArchetypeAndVerified today. Asserting 401
    // exactly makes the layering explicit.
    //
    // The canonical predicate's disabled_at clause IS unit-tested
    // separately via `isLearnerArchetypeCandidate(id)` in
    // tests/integration/auth/learner-archetype-predicate.test.ts
    // (drift detector against listLearnerCandidates).
    const { cookie, accountId } = await makeLearnerWithSession('learner-disabled')
    await disableAccount(accountId)
    const result = await requireLearnerArchetypeAndVerified(
      buildRequest('/anything', { cookie }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(401)
  })

  it('scheduled_purge_at IS NOT NULL → 403 (canonical predicate, NEW)', async () => {
    const { cookie, accountId } = await makeLearnerWithSession('learner-grace')
    await getDbPool().query(
      `update accounts set scheduled_purge_at = now() + interval '30 days' where id = $1`,
      [accountId],
    )
    const result = await requireLearnerArchetypeAndVerified(
      buildRequest('/anything', { cookie }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
    const body = await result.response.json()
    expect(body.error).toBe('learner_target_unavailable')
  })

  it('purged_at IS NOT NULL → 403 (canonical predicate, NEW)', async () => {
    const { cookie, accountId } = await makeLearnerWithSession('learner-purged')
    await getDbPool().query(
      `update accounts set purged_at = now() where id = $1`,
      [accountId],
    )
    const result = await requireLearnerArchetypeAndVerified(
      buildRequest('/anything', { cookie }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(403)
    const body = await result.response.json()
    expect(body.error).toBe('learner_target_unavailable')
  })

  it('anonymous → 401 (auth gate fires first)', async () => {
    const result = await requireLearnerArchetypeAndVerified(
      buildRequest('/anything'),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(401)
  })
})
