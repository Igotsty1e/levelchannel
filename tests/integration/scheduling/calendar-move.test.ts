import { describe, expect, it } from 'vitest'

import { PATCH as moveHandler } from '@/app/api/admin/slots/[id]/move/route'
import {
  PATCH as adminEditHandler,
  DELETE as adminDeleteHandler,
} from '@/app/api/admin/slots/[id]/route'
import { POST as adminCancelHandler } from '@/app/api/admin/slots/[id]/cancel/route'
import { POST as adminCreateHandler } from '@/app/api/admin/slots/route'
import { POST as bookHandler } from '@/app/api/slots/[id]/book/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
  setAssignedTeacher,
} from '@/lib/auth/accounts'

import '../setup'
import {
  buildRequest,
  extractSessionCookie,
  futureSlotIso,
} from '../helpers'

async function registerAndCookie(
  email: string,
  opts: { role?: 'admin' | 'teacher' | 'student' } = {},
): Promise<{ cookie: string; accountId: string }> {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const acc = (await getAccountByEmail(email))!
  await markAccountVerified(acc.id)
  if (opts.role) await grantAccountRole(acc.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: acc.id,
  }
}

async function createOpenSlot(
  cookie: string,
  teacherAccountId: string,
  startAt: string,
): Promise<string> {
  const r = await adminCreateHandler(
    buildRequest('/api/admin/slots', {
      cookie,
      body: { teacherAccountId, startAt, durationMinutes: 60 },
    }),
  )
  expect(r.status).toBe(201)
  return (await r.json()).slot.id
}

describe('PATCH /api/admin/slots/[id]/move', () => {
  it('move open slot succeeds', async () => {
    const admin = await registerAndCookie('mv-admin1@example.com', { role: 'admin' })
    const teacher = await registerAndCookie('mv-t1@example.com', { role: 'teacher' })
    const original = futureSlotIso(7 * 24 * 60 + 60)
    const newAt = futureSlotIso(7 * 24 * 60 + 120)
    const slotId = await createOpenSlot(admin.cookie, teacher.accountId, original)

    const r = await moveHandler(
      buildRequest(`/api/admin/slots/${slotId}/move`, {
        method: 'PATCH',
        cookie: admin.cookie,
        body: { newStartAt: newAt },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.slot.startAt).toBeDefined()
  })

  it('move booked slot returns 409 not_open', async () => {
    const admin = await registerAndCookie('mv-admin2@example.com', { role: 'admin' })
    const teacher = await registerAndCookie('mv-t2@example.com', { role: 'teacher' })
    const learner = await registerAndCookie('mv-learner2@example.com')
    await setAssignedTeacher(learner.accountId, teacher.accountId)

    const original = futureSlotIso(7 * 24 * 60 + 180)
    const slotId = await createOpenSlot(admin.cookie, teacher.accountId, original)
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    const newAt = futureSlotIso(7 * 24 * 60 + 240)
    const r = await moveHandler(
      buildRequest(`/api/admin/slots/${slotId}/move`, {
        method: 'PATCH',
        cookie: admin.cookie,
        body: { newStartAt: newAt },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('not_open')
  })

  it('move with newStartAt outside business hours returns 400 slot/start_out_of_band', async () => {
    const admin = await registerAndCookie('mv-admin3@example.com', { role: 'admin' })
    const teacher = await registerAndCookie('mv-t3@example.com', { role: 'teacher' })
    const slotId = await createOpenSlot(
      admin.cookie,
      teacher.accountId,
      futureSlotIso(7 * 24 * 60 + 60),
    )
    // 04:00 MSK = 01:00 UTC — out of band.
    const tooEarly = (() => {
      const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      d.setUTCHours(1, 0, 0, 0)
      return d.toISOString()
    })()
    const r = await moveHandler(
      buildRequest(`/api/admin/slots/${slotId}/move`, {
        method: 'PATCH',
        cookie: admin.cookie,
        body: { newStartAt: tooEarly },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('slot/start_out_of_band')
  })

  it('move with minute-precision newStartAt succeeds (minute-start epic 2026-06-11)', async () => {
    // Был 30-min grid check; теперь minute-precision allowed. Test
    // обновлён: 18:17 MSK теперь валидное время.
    const admin = await registerAndCookie('mv-admin4@example.com', { role: 'admin' })
    const teacher = await registerAndCookie('mv-t4@example.com', { role: 'teacher' })
    const slotId = await createOpenSlot(
      admin.cookie,
      teacher.accountId,
      futureSlotIso(7 * 24 * 60 + 60),
    )
    // 18:17 MSK = 15:17 UTC — minute-level precision (was 'misaligned').
    const minutePrecise = (() => {
      const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      d.setUTCHours(15, 17, 0, 0)
      return d.toISOString()
    })()
    const r = await moveHandler(
      buildRequest(`/api/admin/slots/${slotId}/move`, {
        method: 'PATCH',
        cookie: admin.cookie,
        body: { newStartAt: minutePrecise },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(200)
  })

  it('move cancelled slot returns 409 not_open', async () => {
    const admin = await registerAndCookie('mv-admin5@example.com', { role: 'admin' })
    const teacher = await registerAndCookie('mv-t5@example.com', { role: 'teacher' })
    const slotId = await createOpenSlot(
      admin.cookie,
      teacher.accountId,
      futureSlotIso(7 * 24 * 60 + 60),
    )
    await adminCancelHandler(
      buildRequest(`/api/admin/slots/${slotId}/cancel`, {
        cookie: admin.cookie,
        body: { reason: 'test' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    const r = await moveHandler(
      buildRequest(`/api/admin/slots/${slotId}/move`, {
        method: 'PATCH',
        cookie: admin.cookie,
        body: { newStartAt: futureSlotIso(7 * 24 * 60 + 120) },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('not_open')
  })

  it('move into a colliding (teacher_account_id, start_at) returns 409 slot_collision', async () => {
    const admin = await registerAndCookie('mv-admin6@example.com', { role: 'admin' })
    const teacher = await registerAndCookie('mv-t6@example.com', { role: 'teacher' })
    const a = futureSlotIso(7 * 24 * 60 + 60)
    const b = futureSlotIso(7 * 24 * 60 + 120)
    await createOpenSlot(admin.cookie, teacher.accountId, a)
    const slotB = await createOpenSlot(admin.cookie, teacher.accountId, b)
    // Try to move B onto A.
    const r = await moveHandler(
      buildRequest(`/api/admin/slots/${slotB}/move`, {
        method: 'PATCH',
        cookie: admin.cookie,
        body: { newStartAt: a },
      }),
      { params: Promise.resolve({ id: slotB }) },
    )
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('slot_collision')
  })

  it('non-admin caller gets 403', async () => {
    const learner = await registerAndCookie('mv-learner7@example.com')
    const r = await moveHandler(
      buildRequest(`/api/admin/slots/00000000-0000-0000-0000-000000000000/move`, {
        method: 'PATCH',
        cookie: learner.cookie,
        body: { newStartAt: futureSlotIso(60) },
      }),
      { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) },
    )
    expect(r.status).toBe(403)
  })
})

// Wave 26 — match move route's 404/409 contract on PATCH/DELETE
// (Codex Wave 13 Pass 2 #11). Before: both routes collapsed
// "missing" and "not open" into 404. After: 404 = missing, 409 =
// wrong state.
describe('Wave 26 — PATCH/DELETE /api/admin/slots/[id] status semantics', () => {
  const NIL_UUID = '99999999-9999-9999-9999-999999999999'

  it('PATCH returns 404 not_found for an unknown slot', async () => {
    const admin = await registerAndCookie('w26-admin-pn@example.com', { role: 'admin' })
    const r = await adminEditHandler(
      buildRequest(`/api/admin/slots/${NIL_UUID}`, {
        method: 'PATCH',
        cookie: admin.cookie,
        body: { notes: 'noop' },
      }),
      { params: Promise.resolve({ id: NIL_UUID }) },
    )
    expect(r.status).toBe(404)
    expect((await r.json()).error).toBe('not_found')
  })

  it('PATCH returns 409 not_open for a booked slot (was 404 before Wave 26)', async () => {
    const admin = await registerAndCookie('w26-admin-pb@example.com', { role: 'admin' })
    const teacher = await registerAndCookie('w26-t-pb@example.com', { role: 'teacher' })
    const learner = await registerAndCookie('w26-l-pb@example.com')
    await setAssignedTeacher(learner.accountId, teacher.accountId)

    const slotId = await createOpenSlot(
      admin.cookie,
      teacher.accountId,
      futureSlotIso(7 * 24 * 60 + 60),
    )
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    const r = await adminEditHandler(
      buildRequest(`/api/admin/slots/${slotId}`, {
        method: 'PATCH',
        cookie: admin.cookie,
        body: { notes: 'edit-after-booking' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('not_open')
  })

  it('DELETE returns 404 not_found for an unknown slot', async () => {
    const admin = await registerAndCookie('w26-admin-dn@example.com', { role: 'admin' })
    const r = await adminDeleteHandler(
      buildRequest(`/api/admin/slots/${NIL_UUID}`, {
        method: 'DELETE',
        cookie: admin.cookie,
      }),
      { params: Promise.resolve({ id: NIL_UUID }) },
    )
    expect(r.status).toBe(404)
    expect((await r.json()).error).toBe('not_found')
  })

  it('DELETE returns 409 not_open for a booked slot (was 404 before Wave 26)', async () => {
    const admin = await registerAndCookie('w26-admin-db@example.com', { role: 'admin' })
    const teacher = await registerAndCookie('w26-t-db@example.com', { role: 'teacher' })
    const learner = await registerAndCookie('w26-l-db@example.com')
    await setAssignedTeacher(learner.accountId, teacher.accountId)

    const slotId = await createOpenSlot(
      admin.cookie,
      teacher.accountId,
      futureSlotIso(7 * 24 * 60 + 60),
    )
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    const r = await adminDeleteHandler(
      buildRequest(`/api/admin/slots/${slotId}`, {
        method: 'DELETE',
        cookie: admin.cookie,
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('not_open')
  })
})
