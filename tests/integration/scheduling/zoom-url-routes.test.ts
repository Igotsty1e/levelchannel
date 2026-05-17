import { describe, expect, it } from 'vitest'

import { PATCH as adminPatchHandler } from '@/app/api/admin/slots/[id]/zoom-url/route'
import { PATCH as teacherPatchHandler } from '@/app/api/teacher/slots/[id]/zoom-url/route'
import { POST as bookHandler } from '@/app/api/slots/[id]/book/route'
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
import { buildRequest, extractSessionCookie, futureSlotIso } from '../helpers'

// BCS-DEF-3 (2026-05-18) — integration tests for the admin + teacher
// zoom-url PATCH routes.

async function registerAndCookie(opts: {
  email: string
  verified?: boolean
  role?: 'admin' | 'teacher'
}): Promise<{ cookie: string; accountId: string }> {
  const password = 'StrongPassword123'
  const reg = await registerHandler(
    buildRequest('/api/auth/register', {
      body: {
        email: opts.email,
        password,
        personalDataConsentAccepted: true,
      },
    }),
  )
  expect(reg.status).toBe(200)
  const created = await getAccountByEmail(opts.email)
  expect(created).not.toBeNull()
  if (opts.verified) await markAccountVerified(created!.id)
  if (opts.role) await grantAccountRole(created!.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', {
      body: { email: opts.email, password },
    }),
  )
  expect(login.status).toBe(200)
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  expect(cookie).not.toBeNull()
  return { cookie: cookie!, accountId: created!.id }
}

async function createBookedSlot(opts: {
  teacherCookie: string
  teacherId: string
  learnerCookie: string
  adminCookie: string
}): Promise<string> {
  const slotRes = await adminCreateHandler(
    buildRequest('/api/admin/slots', {
      cookie: opts.adminCookie,
      body: {
        teacherAccountId: opts.teacherId,
        startAt: futureSlotIso(48 * 60),
        durationMinutes: 60,
      },
    }),
  )
  expect([200, 201]).toContain(slotRes.status)
  const slotId = (await slotRes.json()).slot.id as string
  const book = await bookHandler(
    buildRequest(`/api/slots/${slotId}/book`, {
      cookie: opts.learnerCookie,
      body: {},
    }),
    { params: Promise.resolve({ id: slotId }) },
  )
  expect(book.status).toBe(200)
  return slotId
}

describe('PATCH /api/admin/slots/[id]/zoom-url', () => {
  it('admin sets zoomUrl on a booked slot', async () => {
    const teacher = await registerAndCookie({
      email: 'zu-admin-set-t@example.com',
      verified: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie({
      email: 'zu-admin-set-a@example.com',
      verified: true,
      role: 'admin',
    })
    const learner = await registerAndCookie({
      email: 'zu-admin-set-l@example.com',
      verified: true,
    })
    await setAssignedTeacher(learner.accountId, teacher.accountId)
    const slotId = await createBookedSlot({
      teacherCookie: teacher.cookie,
      teacherId: teacher.accountId,
      learnerCookie: learner.cookie,
      adminCookie: admin.cookie,
    })

    const res = await adminPatchHandler(
      buildRequest(`/api/admin/slots/${slotId}/zoom-url`, {
        cookie: admin.cookie,
        body: { zoomUrl: 'https://zoom.us/j/123456789' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(200)
    const row = await getDbPool().query(
      `select zoom_url from lesson_slots where id = $1`,
      [slotId],
    )
    expect(row.rows[0].zoom_url).toBe('https://zoom.us/j/123456789')
  })

  it('admin clears zoomUrl via empty string', async () => {
    const teacher = await registerAndCookie({
      email: 'zu-admin-clr-t@example.com',
      verified: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie({
      email: 'zu-admin-clr-a@example.com',
      verified: true,
      role: 'admin',
    })
    const learner = await registerAndCookie({
      email: 'zu-admin-clr-l@example.com',
      verified: true,
    })
    await setAssignedTeacher(learner.accountId, teacher.accountId)
    const slotId = await createBookedSlot({
      teacherCookie: teacher.cookie,
      teacherId: teacher.accountId,
      learnerCookie: learner.cookie,
      adminCookie: admin.cookie,
    })
    await adminPatchHandler(
      buildRequest(`/api/admin/slots/${slotId}/zoom-url`, {
        cookie: admin.cookie,
        body: { zoomUrl: 'https://zoom.us/j/x' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    const clear = await adminPatchHandler(
      buildRequest(`/api/admin/slots/${slotId}/zoom-url`, {
        cookie: admin.cookie,
        body: { zoomUrl: '' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(clear.status).toBe(200)
    const row = await getDbPool().query(
      `select zoom_url from lesson_slots where id = $1`,
      [slotId],
    )
    expect(row.rows[0].zoom_url).toBeNull()
  })

  it('400 on invalid scheme (http://)', async () => {
    const teacher = await registerAndCookie({
      email: 'zu-admin-bad-t@example.com',
      verified: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie({
      email: 'zu-admin-bad-a@example.com',
      verified: true,
      role: 'admin',
    })
    const learner = await registerAndCookie({
      email: 'zu-admin-bad-l@example.com',
      verified: true,
    })
    await setAssignedTeacher(learner.accountId, teacher.accountId)
    const slotId = await createBookedSlot({
      teacherCookie: teacher.cookie,
      teacherId: teacher.accountId,
      learnerCookie: learner.cookie,
      adminCookie: admin.cookie,
    })
    const res = await adminPatchHandler(
      buildRequest(`/api/admin/slots/${slotId}/zoom-url`, {
        cookie: admin.cookie,
        body: { zoomUrl: 'http://example.com' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(400)
  })

  it('409 not_booked on open slot', async () => {
    const teacher = await registerAndCookie({
      email: 'zu-admin-open-t@example.com',
      verified: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie({
      email: 'zu-admin-open-a@example.com',
      verified: true,
      role: 'admin',
    })
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
    // No learner / no book → status stays 'open'.
    const res = await adminPatchHandler(
      buildRequest(`/api/admin/slots/${slotId}/zoom-url`, {
        cookie: admin.cookie,
        body: { zoomUrl: 'https://zoom.us/j/x' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(409)
  })

  it('learner cannot set zoomUrl (admin gate)', async () => {
    const teacher = await registerAndCookie({
      email: 'zu-admin-learner-t@example.com',
      verified: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie({
      email: 'zu-admin-learner-a@example.com',
      verified: true,
      role: 'admin',
    })
    const learner = await registerAndCookie({
      email: 'zu-admin-learner-l@example.com',
      verified: true,
    })
    await setAssignedTeacher(learner.accountId, teacher.accountId)
    const slotId = await createBookedSlot({
      teacherCookie: teacher.cookie,
      teacherId: teacher.accountId,
      learnerCookie: learner.cookie,
      adminCookie: admin.cookie,
    })
    const res = await adminPatchHandler(
      buildRequest(`/api/admin/slots/${slotId}/zoom-url`, {
        cookie: learner.cookie,
        body: { zoomUrl: 'https://zoom.us/j/x' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/teacher/slots/[id]/zoom-url', () => {
  it('teacher sets zoomUrl on their own booked slot', async () => {
    const teacher = await registerAndCookie({
      email: 'zu-tch-own-t@example.com',
      verified: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie({
      email: 'zu-tch-own-a@example.com',
      verified: true,
      role: 'admin',
    })
    const learner = await registerAndCookie({
      email: 'zu-tch-own-l@example.com',
      verified: true,
    })
    await setAssignedTeacher(learner.accountId, teacher.accountId)
    const slotId = await createBookedSlot({
      teacherCookie: teacher.cookie,
      teacherId: teacher.accountId,
      learnerCookie: learner.cookie,
      adminCookie: admin.cookie,
    })
    const res = await teacherPatchHandler(
      buildRequest(`/api/teacher/slots/${slotId}/zoom-url`, {
        cookie: teacher.cookie,
        body: { zoomUrl: 'https://meet.example.com/abc' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(200)
  })

  it('teacher cannot set zoomUrl on another teachers slot (403 not_owner)', async () => {
    const teacherA = await registerAndCookie({
      email: 'zu-tch-fg-ta@example.com',
      verified: true,
      role: 'teacher',
    })
    const teacherB = await registerAndCookie({
      email: 'zu-tch-fg-tb@example.com',
      verified: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie({
      email: 'zu-tch-fg-ad@example.com',
      verified: true,
      role: 'admin',
    })
    const learner = await registerAndCookie({
      email: 'zu-tch-fg-ln@example.com',
      verified: true,
    })
    await setAssignedTeacher(learner.accountId, teacherA.accountId)
    const slotId = await createBookedSlot({
      teacherCookie: teacherA.cookie,
      teacherId: teacherA.accountId,
      learnerCookie: learner.cookie,
      adminCookie: admin.cookie,
    })
    // teacherB tries to set zoomUrl on teacherA's slot.
    const res = await teacherPatchHandler(
      buildRequest(`/api/teacher/slots/${slotId}/zoom-url`, {
        cookie: teacherB.cookie,
        body: { zoomUrl: 'https://attacker.example.com/' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(403)
  })

  it('learner gets 403 on teacher route', async () => {
    const teacher = await registerAndCookie({
      email: 'zu-tch-learner-t@example.com',
      verified: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie({
      email: 'zu-tch-learner-a@example.com',
      verified: true,
      role: 'admin',
    })
    const learner = await registerAndCookie({
      email: 'zu-tch-learner-l@example.com',
      verified: true,
    })
    await setAssignedTeacher(learner.accountId, teacher.accountId)
    const slotId = await createBookedSlot({
      teacherCookie: teacher.cookie,
      teacherId: teacher.accountId,
      learnerCookie: learner.cookie,
      adminCookie: admin.cookie,
    })
    const res = await teacherPatchHandler(
      buildRequest(`/api/teacher/slots/${slotId}/zoom-url`, {
        cookie: learner.cookie,
        body: { zoomUrl: 'https://x.com' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(res.status).toBe(403)
  })
})

describe('DB CHECK constraint (last-line safety)', () => {
  it('rejects direct INSERT of zoom_url that violates the CHECK', async () => {
    const pool = getDbPool()
    // The CHECK requires https:// prefix and ≤512 chars.
    // First create a slot so we have an id to UPDATE.
    const teacher = await registerAndCookie({
      email: 'zu-check-t@example.com',
      verified: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie({
      email: 'zu-check-a@example.com',
      verified: true,
      role: 'admin',
    })
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
    await expect(
      pool.query(
        `update lesson_slots set zoom_url = $2 where id = $1`,
        [slotId, 'javascript:alert(1)'],
      ),
    ).rejects.toThrow(/lesson_slots_zoom_url_shape|check constraint/i)
  })
})
