import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST as bookHandler } from '@/app/api/slots/[id]/book/route'
import { POST as cancelHandler } from '@/app/api/slots/[id]/cancel/route'
import { POST as adminCreateHandler } from '@/app/api/admin/slots/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
  setAssignedTeacher,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import {
  buildRequest,
  extractSessionCookie,
  futureSlotIso,
  nearFutureBusinessBandIso,
} from '../helpers'

// POLICY-KNOBS (2026-05-17) — end-to-end pin of the env-tunable
// learner cancel window. canLearnerCancel + the SQL gate in
// cancelLearnerSlot both call getLearnerCancelWindowHours() at
// request time, so vi.stubEnv per test drives the whole request
// path to the value under test.
//
// `tests/integration/scheduling/lifecycle.test.ts:71-127` already
// pins the default-24h fast-path (slot ~1h away → 403). This file
// pins the DIFFERENTIATING behaviours: window=0 (no gate) and
// malformed env (strict-reject → default-24h).

async function registerAndCookie(
  email: string,
  opts: { verifyEmail?: boolean; role?: 'admin' | 'teacher' } = {},
): Promise<{ cookie: string; accountId: string }> {
  const password = 'StrongPassword123'
  const reg = await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  expect(reg.status).toBe(200)
  const created = await getAccountByEmail(email)
  expect(created).not.toBeNull()
  if (opts.verifyEmail) await markAccountVerified(created!.id)
  if (opts.role) await grantAccountRole(created!.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  expect(login.status).toBe(200)
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  expect(cookie).not.toBeNull()
  return { cookie: cookie!, accountId: created!.id }
}

async function setSlotStartAt(slotId: string, isoUtc: string): Promise<void> {
  await getDbPool().query(
    `update lesson_slots set start_at = $2 where id = $1`,
    [slotId, isoUtc],
  )
}

beforeEach(() => {
  vi.unstubAllEnvs()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POLICY-KNOBS — learner cancel window is env-tunable', () => {
  it('LEARNER_CANCEL_WINDOW_HOURS=0 disables the gate (cancel allowed ~1h before start)', async () => {
    vi.stubEnv('LEARNER_CANCEL_WINDOW_HOURS', '0')

    const teacher = await registerAndCookie('pk-teacher-0h@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    // 2026-06-17: per-teacher cancel-window now lives in DB
    // (accounts.teacher_cancel_window_minutes, default 1440). Env-var
    // is fallback only. Test must explicitly set teacher's value.
    await getDbPool().query(
      `update accounts set teacher_cancel_window_minutes = 0 where id = $1`,
      [teacher.accountId],
    )
    const admin = await registerAndCookie('pk-admin-0h@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('pk-learner-0h@example.com', {
      verifyEmail: true,
    })
    await setAssignedTeacher(learner.accountId, teacher.accountId)

    // Create a slot far in the future (so insert passes the route's
    // future-only check), book it, then backdate start_at to the
    // next valid grid slot in the MSK band — ~30-90 min from now.
    // Under window=0, the SQL gate `start_at - now() >= 0 hours` is
    // satisfied, so the cancel succeeds. Under the default 24h, the
    // same slot would 403 (proves the env bind reached the SQL).
    const slotRes = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureSlotIso(48 * 60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await slotRes.json()).slot.id as string
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    await setSlotStartAt(slotId, nearFutureBusinessBandIso())

    const cancel = await cancelHandler(
      buildRequest(`/api/slots/${slotId}/cancel`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(cancel.status).toBe(200)

    const row = await getDbPool().query(
      `select status from lesson_slots where id = $1`,
      [slotId],
    )
    expect(row.rows[0].status).toBe('cancelled')
  })

  it('LEARNER_CANCEL_WINDOW_HOURS=0 still allows cancel on a far-future slot', async () => {
    vi.stubEnv('LEARNER_CANCEL_WINDOW_HOURS', '0')

    const teacher = await registerAndCookie('pk-teacher-0h-far@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    await getDbPool().query(
      `update accounts set teacher_cancel_window_minutes = 0 where id = $1`,
      [teacher.accountId],
    )
    const admin = await registerAndCookie('pk-admin-0h-far@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('pk-learner-0h-far@example.com', {
      verifyEmail: true,
    })
    await setAssignedTeacher(learner.accountId, teacher.accountId)

    const slotRes = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureSlotIso(72 * 60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await slotRes.json()).slot.id as string
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    // Leave start_at at its far-future value (~7+ days). Under
    // window=0 the gate is still satisfied. Smoke that the bind
    // doesn't break the happy path.
    const cancel = await cancelHandler(
      buildRequest(`/api/slots/${slotId}/cancel`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(cancel.status).toBe(200)
  })

  it('malformed env value silently falls back to 24h — late cancel rejected', async () => {
    // Round-1 BLOCKER #2 + Round-2 BLOCKER #1 end-to-end pin: a
    // slightly-malformed value like ' 12 ' (with surrounding spaces)
    // is rejected by the strict regex → default 24h. Under default
    // 24h, a ~1h-away slot is rejected (would be cancellable under
    // window=12 if the parser had been sloppy).
    vi.stubEnv('LEARNER_CANCEL_WINDOW_HOURS', ' 12 ')

    const teacher = await registerAndCookie('pk-teacher-malf@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('pk-admin-malf@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('pk-learner-malf@example.com', {
      verifyEmail: true,
    })
    await setAssignedTeacher(learner.accountId, teacher.accountId)

    const slotRes = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureSlotIso(48 * 60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await slotRes.json()).slot.id as string
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    await setSlotStartAt(slotId, nearFutureBusinessBandIso())

    const cancel = await cancelHandler(
      buildRequest(`/api/slots/${slotId}/cancel`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    // Malformed env → fallback to default 24h. ~1h-away < 24h → reject.
    expect(cancel.status).toBe(403)
    const json = await cancel.json()
    expect(json.error).toBe('too_late_to_cancel')
  })
})
