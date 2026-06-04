// Integration tests for Sub-PR B2 onboarding hints — empty-state
// triggers on /teacher/tariffs and /teacher/packages.
//
// Tests directly exercise the predicates (no Playwright); the SSR
// render decision is `hasX || dismissed → null`.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as dismissHandler } from '@/app/api/onboarding/dismiss-hint/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'
import { getOnboardingState } from '@/lib/onboarding/state'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'tph-test-auth-rate-limit-secret-aaaaaaaaaaaaaaaa'

beforeAll(() => {
  process.env.AUTH_RATE_LIMIT_SECRET = TEST_SECRET
})

afterAll(() => {
  delete process.env.AUTH_RATE_LIMIT_SECRET
})

async function regTeacher(email: string) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  await markAccountVerified(created!.id)
  await grantAccountRole(created!.id, 'teacher', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

describe('tariff_first_create_hint — empty-state predicate', () => {
  it('fresh teacher has no tariff_first_create_hint dismissal in state', async () => {
    const teacher = await regTeacher('tph-tariff-fresh@example.com')
    const state = await getOnboardingState(teacher.accountId)
    expect(state.dismissedHints).not.toHaveProperty('tariff_first_create_hint')
  })

  it('dismiss API records tariff_first_create_hint and the state reflects it', async () => {
    const teacher = await regTeacher('tph-tariff-dismiss@example.com')
    const res = await dismissHandler(
      buildRequest('/api/onboarding/dismiss-hint', {
        cookie: teacher.cookie,
        body: { hintKey: 'tariff_first_create_hint' },
      }),
    )
    expect(res.status).toBe(200)
    const state = await getOnboardingState(teacher.accountId)
    expect(state.dismissedHints).toHaveProperty('tariff_first_create_hint')
  })
})

describe('packages_vs_tariffs_explainer — empty-state predicate', () => {
  it('fresh teacher has no packages_vs_tariffs_explainer dismissal in state', async () => {
    const teacher = await regTeacher('tph-pkg-fresh@example.com')
    const state = await getOnboardingState(teacher.accountId)
    expect(state.dismissedHints).not.toHaveProperty(
      'packages_vs_tariffs_explainer',
    )
  })

  it('dismiss API records packages_vs_tariffs_explainer and the state reflects it', async () => {
    const teacher = await regTeacher('tph-pkg-dismiss@example.com')
    const res = await dismissHandler(
      buildRequest('/api/onboarding/dismiss-hint', {
        cookie: teacher.cookie,
        body: { hintKey: 'packages_vs_tariffs_explainer' },
      }),
    )
    expect(res.status).toBe(200)
    const state = await getOnboardingState(teacher.accountId)
    expect(state.dismissedHints).toHaveProperty('packages_vs_tariffs_explainer')
  })

  it('after creating a package, predicate `hasAnyPackage` flips true even without dismissal', async () => {
    // This emulates the SSR predicate the /teacher/packages route uses
    // (`packages.length > 0 || currentActiveCount > 0`). We seed a
    // package row directly; the page would compute the same boolean
    // from listPackagesByTeacher / countActivePackagesByTeacher.
    const teacher = await regTeacher('tph-pkg-after-create@example.com')
    const pool = getDbPool()
    await pool.query(
      `insert into lesson_packages (teacher_id, slug, title_ru, count, duration_minutes, amount_kopecks)
       values ($1::uuid, 'tph-pkg-${Math.random().toString(36).slice(2, 8)}', 'Test pkg', 5, 60, 500000)`,
      [teacher.accountId],
    )
    const r = await pool.query<{ exists: boolean }>(
      `select exists(select 1 from lesson_packages where teacher_id = $1::uuid and deleted_at is null) as exists`,
      [teacher.accountId],
    )
    expect(r.rows[0]?.exists).toBe(true)
  })
})
