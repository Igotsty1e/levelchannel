// Integration test for `computeTeacherSetupChecklist` + dismiss flow.
//
// Per `docs/plans/onboarding-tooltips-spec-2026-05-31.md §1.1`:
//   - SSR helper returns per-item booleans + `allComplete` + `dismissed`.
//   - Render contract (in the component) hides the card when
//     `allComplete || dismissed`.
//
// Test cases:
//   1. Fresh teacher (no profile, no tariff, no calendar, no invite)
//      → all four false, allComplete=false, dismissed=false.
//   2. After dismissing via the API → dismissed=true.
//   3. After creating a profile + tariff + invite (3 of 4 done) →
//      respective booleans flip true, allComplete=false.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as registerHandler } from '@/app/api/auth/register/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as dismissHandler } from '@/app/api/onboarding/dismiss-hint/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { upsertAccountProfile } from '@/lib/auth/profiles'
import { getDbPool } from '@/lib/db/pool'
import { computeTeacherSetupChecklist } from '@/lib/onboarding/teacher-setup-checklist'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

const TEST_SECRET = 'tsc-test-auth-rate-limit-secret-aaaaaaaaaaaaaaaaaaa'

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

describe('computeTeacherSetupChecklist', () => {
  it('fresh teacher → all four items false, allComplete=false, dismissed=false', async () => {
    const teacher = await regTeacher('tsc-fresh@example.com')
    const state = await computeTeacherSetupChecklist(teacher.accountId)
    expect(state.profileFilled).toBe(false)
    expect(state.tariffCreated).toBe(false)
    expect(state.calendarConnected).toBe(false)
    expect(state.inviteSent).toBe(false)
    expect(state.allComplete).toBe(false)
    expect(state.dismissed).toBe(false)
  })

  it('after dismissing via API → dismissed=true', async () => {
    const teacher = await regTeacher('tsc-dismissed@example.com')
    const dismissRes = await dismissHandler(
      buildRequest('/api/onboarding/dismiss-hint', {
        cookie: teacher.cookie,
        body: { hintKey: 'teacher_setup_checklist' },
      }),
    )
    expect(dismissRes.status).toBe(200)

    const state = await computeTeacherSetupChecklist(teacher.accountId)
    expect(state.dismissed).toBe(true)
    // Items themselves are still incomplete; dismissed is independent.
    expect(state.profileFilled).toBe(false)
    expect(state.allComplete).toBe(false)
  })

  it('after profile + tariff + invite → 3 of 4 items flip true, allComplete still false (calendar gating)', async () => {
    const teacher = await regTeacher('tsc-partial@example.com')

    // 1. Profile.
    await upsertAccountProfile(teacher.accountId, {
      displayName: 'Test Teacher',
      firstName: 'Test',
      lastName: 'Teacher',
      timezone: 'Europe/Moscow',
    })

    // 2. Tariff (direct DB insert — UI-level create is out of scope here).
    // Schema per mig 0018 + 0075 (teacher_id added later).
    const pool = getDbPool()
    await pool.query(
      `insert into pricing_tariffs (teacher_id, slug, title_ru, amount_kopecks, duration_minutes)
       values ($1::uuid, 'tsc-test-${Math.random().toString(36).slice(2, 8)}', 'Test tariff', 100000, 60)`,
      [teacher.accountId],
    )

    // 4. Invite — direct DB insert.
    await pool.query(
      `insert into teacher_invites (teacher_account_id, expires_at)
       values ($1::uuid, now() + interval '14 days')`,
      [teacher.accountId],
    )

    const state = await computeTeacherSetupChecklist(teacher.accountId)
    expect(state.profileFilled).toBe(true)
    expect(state.tariffCreated).toBe(true)
    // Calendar requires google_calendar_integrations row; not seeded here.
    expect(state.calendarConnected).toBe(false)
    expect(state.inviteSent).toBe(true)
    expect(state.allComplete).toBe(false)
  })
})
