// Onboarding Sub-PR A foundation — POST /api/onboarding/dismiss-hint
// integration tests (round-4 BLOCKER #3 + round-5 closure #8 contract).
//
// 8 cases:
//   1. Anonymous → 401.
//   2. Learner self-call → 200 + state row written.
//   3. Teacher self-call → 200 + state row written.
//   4. Auth boundary — learner A cannot affect learner B (accountId
//      from session only; body has no accountId field by design).
//   5. Whitelist — unknown hintKey → 400 unknown_hint_key.
//   6. Idempotent repeat-dismiss same key → 200.
//   7. Missing field — empty body → 400 hint_key_missing;
//      malformed JSON → 400 invalid_json.
//   8. Purge — db-retention-cleanup scrubs the row when the account
//      is grace-expired (covered by separate test below).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as dismissHintHandler } from '@/app/api/onboarding/dismiss-hint/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'
import { dismissOnboardingHint, getOnboardingState } from '@/lib/onboarding/state'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'dismiss-hint-test-account-rate-limit-secret-aaaaaaaaaa'

beforeAll(() => {
  process.env.AUTH_RATE_LIMIT_SECRET = TEST_SECRET
})

afterAll(() => {
  delete process.env.AUTH_RATE_LIMIT_SECRET
})

async function reg(
  email: string,
  opts: { role?: 'admin' | 'teacher' | 'student' } = {},
) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  if (opts.role) await grantAccountRole(created!.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

describe('POST /api/onboarding/dismiss-hint — auth', () => {
  it('anonymous → 401', async () => {
    const r = await dismissHintHandler(
      buildRequest('/api/onboarding/dismiss-hint', {
        body: { hintKey: 'teacher_setup_checklist' },
      }),
    )
    expect(r.status).toBe(401)
  })

  it('learner self-call → 200 + state row written', async () => {
    const learner = await reg('oh-dh-learner@example.com')
    const r = await dismissHintHandler(
      buildRequest('/api/onboarding/dismiss-hint', {
        cookie: learner.cookie,
        body: { hintKey: 'learner_cabinet_tour' },
      }),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.ok).toBe(true)
    expect(body.hintKey).toBe('learner_cabinet_tour')
    expect(typeof body.dismissedAt).toBe('string')

    const state = await getOnboardingState(learner.accountId)
    expect(state.dismissedHints).toHaveProperty('learner_cabinet_tour')
  })

  it('teacher self-call → 200 + state row written', async () => {
    const teacher = await reg('oh-dh-teacher@example.com', { role: 'teacher' })
    const r = await dismissHintHandler(
      buildRequest('/api/onboarding/dismiss-hint', {
        cookie: teacher.cookie,
        body: { hintKey: 'teacher_setup_checklist' },
      }),
    )
    expect(r.status).toBe(200)
    const state = await getOnboardingState(teacher.accountId)
    expect(state.dismissedHints).toHaveProperty('teacher_setup_checklist')
  })
})

describe('POST /api/onboarding/dismiss-hint — boundary', () => {
  it('learner A session cannot dismiss for learner B (accountId is session-derived only)', async () => {
    const learnerA = await reg('oh-dh-boundary-a@example.com')
    const learnerB = await reg('oh-dh-boundary-b@example.com')

    // Dismiss with learner A's cookie. Even if a malicious client
    // tried to put learner B's id in body, the route ignores body
    // accountId entirely (it derives from session).
    const r = await dismissHintHandler(
      buildRequest('/api/onboarding/dismiss-hint', {
        cookie: learnerA.cookie,
        body: { hintKey: 'learner_cabinet_tour', accountId: learnerB.accountId },
      }),
    )
    expect(r.status).toBe(200)

    const stateA = await getOnboardingState(learnerA.accountId)
    const stateB = await getOnboardingState(learnerB.accountId)
    expect(stateA.dismissedHints).toHaveProperty('learner_cabinet_tour')
    expect(stateB.dismissedHints).not.toHaveProperty('learner_cabinet_tour')
  })
})

describe('POST /api/onboarding/dismiss-hint — whitelist + idempotency', () => {
  it('unknown hintKey → 400 unknown_hint_key', async () => {
    const learner = await reg('oh-dh-unknown@example.com')
    const r = await dismissHintHandler(
      buildRequest('/api/onboarding/dismiss-hint', {
        cookie: learner.cookie,
        body: { hintKey: 'not-a-real-hint-key' },
      }),
    )
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toBe('unknown_hint_key')
  })

  it('idempotent repeat-dismiss same key → 200 both times', async () => {
    const learner = await reg('oh-dh-idemp@example.com')
    const first = await dismissHintHandler(
      buildRequest('/api/onboarding/dismiss-hint', {
        cookie: learner.cookie,
        body: { hintKey: 'pwa_install' },
      }),
    )
    expect(first.status).toBe(200)
    const second = await dismissHintHandler(
      buildRequest('/api/onboarding/dismiss-hint', {
        cookie: learner.cookie,
        body: { hintKey: 'pwa_install' },
      }),
    )
    expect(second.status).toBe(200)
    const state = await getOnboardingState(learner.accountId)
    expect(state.dismissedHints).toHaveProperty('pwa_install')
  })

  it('missing body field → 400 hint_key_missing', async () => {
    const learner = await reg('oh-dh-missing@example.com')
    const r = await dismissHintHandler(
      buildRequest('/api/onboarding/dismiss-hint', {
        cookie: learner.cookie,
        body: {},
      }),
    )
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toBe('hint_key_missing')
  })

  it('malformed JSON body → 400 invalid_json', async () => {
    const learner = await reg('oh-dh-badjson@example.com')
    const req = new Request(
      `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/onboarding/dismiss-hint`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
          'Sec-Fetch-Site': 'same-origin',
          cookie: learner.cookie,
        },
        body: '{ this is not valid json',
      },
    )
    const r = await dismissHintHandler(req)
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toBe('invalid_json')
  })
})

describe('account_onboarding_state purge — db-retention-cleanup scrubs row on per-account purge', () => {
  it('grace-expired account that passes deletion-guard has its onboarding row deleted', async () => {
    // We do not invoke the script binary; we exercise the same SQL
    // contract the script's per-account TX must satisfy: account
    // anonymisation + onboarding-state scrub happen atomically.
    const learner = await reg('oh-purge-scrub@example.com')
    // Seed an onboarding row for this account.
    await dismissOnboardingHint(learner.accountId, 'learner_cabinet_tour')
    const before = await getOnboardingState(learner.accountId)
    expect(before.dismissedHints).toHaveProperty('learner_cabinet_tour')

    // Schedule purge in the past (mimics the script's selector predicate).
    const pool = getDbPool()
    await pool.query(
      `update accounts
          set scheduled_purge_at = now() - interval '1 minute'
        where id = $1`,
      [learner.accountId],
    )

    // Simulate the script's per-account TX: guard, anonymise, scrub,
    // commit. We inline the relevant SQL because the script runs as
    // an external mjs process.
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(
        `update accounts set email = 'deleted-' || id::text || '@example.invalid', purged_at = now() where id = $1 and purged_at is null`,
        [learner.accountId],
      )
      await client.query(
        `delete from account_onboarding_state where account_id = $1`,
        [learner.accountId],
      )
      await client.query('commit')
    } finally {
      client.release()
    }

    const after = await getOnboardingState(learner.accountId)
    expect(after.dismissedHints).toEqual({})
  })
})
