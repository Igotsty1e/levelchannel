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
  setAssignedTeacher,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'
import { autoCompletePastBookedSlots } from '@/lib/scheduling/slots'

import '../setup'
import {
  buildRequest,
  extractSessionCookie,
  futureSlotIso as futureIsoMinutes,
  nearFutureBusinessBandIso,
  pastBusinessBandIso,
} from '../helpers'

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

// futureIsoMinutes imported from ../helpers as futureSlotIso (Wave A:
// snapped to 30-min MSK boundary).

// Helper: backdate a slot's start_at directly in the DB so the
// 24h-rule and auto-complete tests can hit conditions that the route
// layer would refuse on insert (start_at must be in future at insert).
//
// Wave A: snap to 30-min MSK boundary AND keep within the 06:00–22:00
// MSK business band to satisfy migration 0031 CHECK. Raw `now -
// minutesAgo` lands in 03:00 MSK on early-morning CI runs and breaks
// the constraint; pastBusinessBandIso walks backward to the most
// recent in-band 30-min slot.
async function backdateSlot(slotId: string, minutesAgo: number) {
  await getDbPool().query(
    `update lesson_slots set start_at = $2 where id = $1`,
    [slotId, pastBusinessBandIso(minutesAgo)],
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
    await setAssignedTeacher(learner.accountId, teacher.accountId)

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

    // Squeeze start_at to a near-future 30-min-aligned slot that
    // still fits the business band (Wave A migration 0031). Always
    // strictly less than 24h from now, so the 24h rule fires.
    await getDbPool().query(
      `update lesson_slots set start_at = $2 where id = $1`,
      [slotId, nearFutureBusinessBandIso()],
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
    await setAssignedTeacher(learner.accountId, teacher.accountId)

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
    const bookRes = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    // Codex round 2 WARN — anchor that the slot was ACTUALLY booked
    // before we test the admin-override path. Without this, admin
    // cancel of an `open` slot also returns 200, so the test name
    // ("admin cancel works inside 24h window") could pass vacuously.
    expect(bookRes.status).toBe(200)
    const bookJson = await bookRes.json()
    expect(bookJson.slot.status).toBe('booked')

    // <24h to go (business-band-safe; same as test 1).
    await getDbPool().query(
      `update lesson_slots set start_at = $2 where id = $1`,
      [slotId, nearFutureBusinessBandIso()],
    )

    const cancel = await adminCancelHandler(
      buildRequest(`/api/admin/slots/${slotId}/cancel`, {
        cookie: admin.cookie,
        body: { reason: 'emergency' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(cancel.status).toBe(200)
    const cancelJson = await cancel.json()
    expect(cancelJson.slot.status).toBe('cancelled')
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
    await setAssignedTeacher(learner.accountId, teacher.accountId)

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
    await setAssignedTeacher(learner.accountId, teacher.accountId)

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

  // SAAS-PIVOT Day 5A (2026-05-22) — auto-cron DISABLED per Owner Q-2.
  // The function now logs + returns zero unconditionally. Test inverted
  // to anchor the disabled contract: past-booked rows STAY booked
  // (the manual mark path is the only way to drive completion now).
  it('autoCompletePastBookedSlots is a no-op (disabled per Day 5A)', async () => {
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
    await setAssignedTeacher(learner.accountId, teacher.accountId)

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
    await backdateSlot(pastId, 90)

    const result = await autoCompletePastBookedSlots()
    expect(result.completed).toBe(0)

    const after = await getDbPool().query(
      `select status from lesson_slots where id = $1`,
      [pastId],
    )
    // Still 'booked' — the disabled cron did NOT flip it.
    expect(after.rows[0].status).toBe('booked')
  })

  // Wave 25 — malformed-JSON consistency on cancel routes (Codex
  // Wave 13 Pass 2 #14). The teacher-cancel route already rejects
  // malformed bodies with 400; admin and learner now match. Empty
  // body is acceptable (no reason supplied); a corrupt JSON body
  // must NOT silently cancel the slot — that would lose the reason
  // payload from the audit.
  describe('Wave 25 — malformed JSON body on cancel routes', () => {
    async function makeBookedSlot(): Promise<{
      slotId: string
      learner: { cookie: string; accountId: string }
      admin: { cookie: string; accountId: string }
    }> {
      const teacher = await registerAndCookie(`teacher-w25-${crypto.randomUUID()}@example.com`, {
        verifyEmail: true,
        role: 'teacher',
      })
      const admin = await registerAndCookie(`admin-w25-${crypto.randomUUID()}@example.com`, {
        verifyEmail: true,
        role: 'admin',
      })
      const learner = await registerAndCookie(
        `learner-w25-${crypto.randomUUID()}@example.com`,
        { verifyEmail: true },
      )
      await setAssignedTeacher(learner.accountId, teacher.accountId)
      const created = await adminCreateHandler(
        buildRequest('/api/admin/slots', {
          cookie: admin.cookie,
          body: {
            teacherAccountId: teacher.accountId,
            startAt: futureIsoMinutes(48 * 60),
            durationMinutes: 30,
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
      return { slotId, learner, admin }
    }

    function malformedRequest(path: string, cookie: string): Request {
      return new Request(`http://localhost:3000${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:3000',
          'Sec-Fetch-Site': 'same-origin',
          cookie,
        },
        // Truncated JSON — opening brace, no close.
        body: '{ "reason": "broke',
      })
    }

    it('admin cancel rejects malformed JSON with 400, slot stays booked', async () => {
      const { slotId, admin } = await makeBookedSlot()
      const res = await adminCancelHandler(
        malformedRequest(`/api/admin/slots/${slotId}/cancel`, admin.cookie),
        { params: Promise.resolve({ id: slotId }) },
      )
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_json_body')
      expect(json.message).toBe('Invalid JSON body.')
      const { rows } = await getDbPool().query(
        `select status from lesson_slots where id = $1`,
        [slotId],
      )
      expect(rows[0].status).toBe('booked')
    })

    it('learner cancel rejects malformed JSON with 400, slot stays booked', async () => {
      const { slotId, learner } = await makeBookedSlot()
      const res = await cancelHandler(
        malformedRequest(`/api/slots/${slotId}/cancel`, learner.cookie),
        { params: Promise.resolve({ id: slotId }) },
      )
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('invalid_json_body')
      expect(json.message).toBe('Invalid JSON body.')
      const { rows } = await getDbPool().query(
        `select status from lesson_slots where id = $1`,
        [slotId],
      )
      expect(rows[0].status).toBe('booked')
    })
  })
})
