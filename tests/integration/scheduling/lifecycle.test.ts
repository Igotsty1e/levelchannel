import { describe, expect, it } from 'vitest'

import { POST as bookHandler } from '@/app/api/slots/[id]/book/route'
import { POST as cancelHandler } from '@/app/api/slots/[id]/cancel/route'
import { POST as adminCancelHandler } from '@/app/api/admin/slots/[id]/cancel/route'
import { POST as adminMarkHandler } from '@/app/api/admin/slots/[id]/mark/route'
import { POST as adminCreateHandler } from '@/app/api/admin/slots/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'
import { autoCompletePastBookedSlots } from '@/lib/scheduling/slots'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

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

function futureIsoMinutes(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString()
}

// Helper: backdate a slot's start_at directly in the DB so the
// 24h-rule and auto-complete tests can hit conditions that the route
// layer would refuse on insert (start_at must be in future at insert).
async function backdateSlot(slotId: string, minutesAgo: number) {
  await getDbPool().query(
    `update lesson_slots
        set start_at = now() - make_interval(mins => $2)
      where id = $1`,
    [slotId, minutesAgo],
  )
}

describe('Phase 5 lifecycle + 24h rule', () => {
  it('learner cancel refused with <24h to go', async () => {
    const teacher = await registerAndCookie('teacher-l1@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-l1@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('learner-l1@example.com', {
      verifyEmail: true,
    })

    // Create a slot in the future, book it, then backdate start_at to
    // 1h from now so the 24h rule fires.
    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(48 * 60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string

    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    // Squeeze start_at to 1h from now (still future, but inside the
    // 24h window).
    await getDbPool().query(
      `update lesson_slots set start_at = now() + interval '1 hour' where id = $1`,
      [slotId],
    )

    const cancel = await cancelHandler(
      buildRequest(`/api/slots/${slotId}/cancel`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(cancel.status).toBe(403)
    const json = await cancel.json()
    expect(json.error).toBe('too_late_to_cancel')
    expect(typeof json.minutesUntilStart).toBe('number')
  })

  it('admin cancel works inside 24h window (override)', async () => {
    const teacher = await registerAndCookie('teacher-l2@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-l2@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('learner-l2@example.com', {
      verifyEmail: true,
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(48 * 60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    // <24h to go.
    await getDbPool().query(
      `update lesson_slots set start_at = now() + interval '1 hour' where id = $1`,
      [slotId],
    )

    const cancel = await adminCancelHandler(
      buildRequest(`/api/admin/slots/${slotId}/cancel`, {
        cookie: admin.cookie,
        body: { reason: 'emergency' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(cancel.status).toBe(200)
  })

  it('admin marks past-booked slot as completed', async () => {
    const teacher = await registerAndCookie('teacher-l3@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-l3@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('learner-l3@example.com', {
      verifyEmail: true,
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    // Push start_at into the past so mark is allowed.
    await backdateSlot(slotId, 90)

    const mark = await adminMarkHandler(
      buildRequest(`/api/admin/slots/${slotId}/mark`, {
        cookie: admin.cookie,
        body: { status: 'completed' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(mark.status).toBe(200)
    const json = await mark.json()
    expect(json.slot.status).toBe('completed')
    expect(json.slot.markedAt).toBeTruthy()
  })

  it('admin mark refused on future booked slot (not_yet_started)', async () => {
    const teacher = await registerAndCookie('teacher-l4@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-l4@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('learner-l4@example.com', {
      verifyEmail: true,
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(48 * 60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    const mark = await adminMarkHandler(
      buildRequest(`/api/admin/slots/${slotId}/mark`, {
        cookie: admin.cookie,
        body: { status: 'completed' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(mark.status).toBe(400)
  })

  it('admin mark refused on open slot (not_booked)', async () => {
    const teacher = await registerAndCookie('teacher-l5@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-l5@example.com', {
      verifyEmail: true,
      role: 'admin',
    })

    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(60),
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id as string
    // Backdate so the not-yet-started gate doesn't fire — leaves
    // not_booked as the only refusal reason.
    await backdateSlot(slotId, 90)

    const mark = await adminMarkHandler(
      buildRequest(`/api/admin/slots/${slotId}/mark`, {
        cookie: admin.cookie,
        body: { status: 'completed' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(mark.status).toBe(400)
  })

  it('autoCompletePastBookedSlots flips matching rows', async () => {
    const teacher = await registerAndCookie('teacher-l6@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('admin-l6@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('learner-l6@example.com', {
      verifyEmail: true,
    })

    // Two slots: one booked-and-past (should be completed), one
    // booked-and-future (should be left alone).
    const past = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(60),
          durationMinutes: 30,
        },
      }),
    )
    const pastId = (await past.json()).slot.id as string
    await bookHandler(
      buildRequest(`/api/slots/${pastId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: pastId }) },
    )
    // Backdate so start_at + duration is in the past.
    await backdateSlot(pastId, 90)

    const future = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt: futureIsoMinutes(48 * 60),
          durationMinutes: 60,
        },
      }),
    )
    const futureId = (await future.json()).slot.id as string
    await bookHandler(
      buildRequest(`/api/slots/${futureId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: futureId }) },
    )

    const result = await autoCompletePastBookedSlots()
    expect(result.completed).toBeGreaterThanOrEqual(1)

    const after = await getDbPool().query(
      `select id, status from lesson_slots where id in ($1, $2)`,
      [pastId, futureId],
    )
    const map = new Map(after.rows.map((r) => [r.id, r.status]))
    expect(map.get(pastId)).toBe('completed')
    expect(map.get(futureId)).toBe('booked')
  })
})
