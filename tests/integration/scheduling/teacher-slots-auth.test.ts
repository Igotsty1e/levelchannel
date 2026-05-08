import { describe, expect, it } from 'vitest'

import { POST as teacherCreateHandler } from '@/app/api/teacher/slots/route'
import { POST as teacherBulkCreateHandler } from '@/app/api/teacher/slots/bulk-create/route'
import { POST as teacherCancelHandler } from '@/app/api/teacher/slots/[id]/cancel/route'
import { PATCH as teacherMoveHandler } from '@/app/api/teacher/slots/[id]/move/route'
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
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest, extractSessionCookie, futureSlotIso } from '../helpers'

// Wave C — auth matrix + ownership pins for /api/teacher/slots/*.
// Codex 2026-05-08 prescription:
//   - anonymous → 401
//   - learner / student → 403 wrong_role
//   - admin / hybrid admin+teacher → 403 admin_precedence
//   - unverified teacher → 403 email_not_verified
//   - teacher → 200 (own slot only)
//   - teacher A vs teacher B's slot → 403 not_owner

async function reg(
  email: string,
  opts: {
    role?: 'admin' | 'teacher' | 'student'
    verifyEmail?: boolean
  } = {},
) {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const created = await getAccountByEmail(email)
  expect(created).not.toBeNull()
  if (opts.verifyEmail !== false) await markAccountVerified(created!.id)
  if (opts.role) await grantAccountRole(created!.id, opts.role, null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return {
    cookie: extractSessionCookie(login.headers.get('Set-Cookie'))!,
    accountId: created!.id,
  }
}

async function makeOpenSlotForTeacher(
  adminCookie: string,
  teacherAccountId: string,
  startAt: string,
): Promise<string> {
  const r = await adminCreateHandler(
    buildRequest('/api/admin/slots', {
      cookie: adminCookie,
      body: {
        teacherAccountId,
        startAt,
        durationMinutes: 60,
      },
    }),
  )
  expect(r.status).toBe(201)
  const body = await r.json()
  return body.slot.id as string
}

describe('POST /api/teacher/slots — auth matrix', () => {
  it('anonymous → 401', async () => {
    const r = await teacherCreateHandler(
      buildRequest('/api/teacher/slots', {
        body: { startAt: futureSlotIso(60 * 24 * 3), durationMinutes: 60 },
      }),
    )
    expect(r.status).toBe(401)
  })

  it('unverified teacher → 403 email_not_verified', async () => {
    const t = await reg('tc-create-unv@example.com', {
      role: 'teacher',
      verifyEmail: false,
    })
    const r = await teacherCreateHandler(
      buildRequest('/api/teacher/slots', {
        cookie: t.cookie,
        body: { startAt: futureSlotIso(60 * 24 * 3), durationMinutes: 60 },
      }),
    )
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('email_not_verified')
  })

  it('learner (no role) → 403 wrong_role', async () => {
    const l = await reg('tc-create-learner@example.com')
    const r = await teacherCreateHandler(
      buildRequest('/api/teacher/slots', {
        cookie: l.cookie,
        body: { startAt: futureSlotIso(60 * 24 * 3), durationMinutes: 60 },
      }),
    )
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('wrong_role')
  })

  it('pure admin → 403 admin_precedence', async () => {
    const a = await reg('tc-create-admin@example.com', { role: 'admin' })
    const r = await teacherCreateHandler(
      buildRequest('/api/teacher/slots', {
        cookie: a.cookie,
        body: { startAt: futureSlotIso(60 * 24 * 3), durationMinutes: 60 },
      }),
    )
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('admin_precedence')
  })

  it('hybrid admin+teacher → 403 admin_precedence', async () => {
    const h = await reg('tc-create-hybrid@example.com', { role: 'admin' })
    await getDbPool().query(
      `insert into account_roles (account_id, role, granted_by_account_id)
       values ($1, 'teacher', null) on conflict do nothing`,
      [h.accountId],
    )
    const r = await teacherCreateHandler(
      buildRequest('/api/teacher/slots', {
        cookie: h.cookie,
        body: { startAt: futureSlotIso(60 * 24 * 3), durationMinutes: 60 },
      }),
    )
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('admin_precedence')
  })

  it('verified teacher → 201 with own teacherAccountId', async () => {
    const t = await reg('tc-create-ok@example.com', { role: 'teacher' })
    const r = await teacherCreateHandler(
      buildRequest('/api/teacher/slots', {
        cookie: t.cookie,
        body: { startAt: futureSlotIso(60 * 24 * 3), durationMinutes: 60 },
      }),
    )
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body.slot.teacherAccountId).toBe(t.accountId)
  })

  it('teacher CANNOT impersonate another teacher via body teacherAccountId', async () => {
    const t1 = await reg('tc-create-impA@example.com', { role: 'teacher' })
    const t2 = await reg('tc-create-impB@example.com', { role: 'teacher' })
    const r = await teacherCreateHandler(
      buildRequest('/api/teacher/slots', {
        cookie: t1.cookie,
        body: {
          teacherAccountId: t2.accountId, // attempt to impersonate
          startAt: futureSlotIso(60 * 24 * 3),
          durationMinutes: 60,
        },
      }),
    )
    expect(r.status).toBe(201)
    const body = await r.json()
    // Session-bound teacherAccountId wins; body field is ignored.
    expect(body.slot.teacherAccountId).toBe(t1.accountId)
    expect(body.slot.teacherAccountId).not.toBe(t2.accountId)
  })
})

describe('POST /api/teacher/slots/bulk-create — auth matrix', () => {
  it('anonymous → 401', async () => {
    const r = await teacherBulkCreateHandler(
      buildRequest('/api/teacher/slots/bulk-create', {
        body: {
          durationMinutes: 60,
          slots: [{ startAt: futureSlotIso(60 * 24 * 3) }],
        },
      }),
    )
    expect(r.status).toBe(401)
  })

  it('teacher → 201 with all slots assigned to session id', async () => {
    const t = await reg('tc-bulk-ok@example.com', { role: 'teacher' })
    const r = await teacherBulkCreateHandler(
      buildRequest('/api/teacher/slots/bulk-create', {
        cookie: t.cookie,
        body: {
          durationMinutes: 60,
          slots: [
            { startAt: futureSlotIso(60 * 24 * 3) },
            { startAt: futureSlotIso(60 * 24 * 3 + 60) },
          ],
        },
      }),
    )
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body.created.length).toBe(2)
    for (const s of body.created) {
      expect(s.teacherAccountId).toBe(t.accountId)
    }
  })

  it('hybrid admin+teacher → 403 admin_precedence', async () => {
    const h = await reg('tc-bulk-hybrid@example.com', { role: 'admin' })
    await getDbPool().query(
      `insert into account_roles (account_id, role, granted_by_account_id)
       values ($1, 'teacher', null) on conflict do nothing`,
      [h.accountId],
    )
    const r = await teacherBulkCreateHandler(
      buildRequest('/api/teacher/slots/bulk-create', {
        cookie: h.cookie,
        body: {
          durationMinutes: 60,
          slots: [{ startAt: futureSlotIso(60 * 24 * 3) }],
        },
      }),
    )
    expect(r.status).toBe(403)
  })
})

describe('PATCH /api/teacher/slots/[id]/move — ownership matrix', () => {
  it('teacher A moving teacher B\'s open slot → 403 not_owner', async () => {
    const admin = await reg('tc-mv-admin@example.com', { role: 'admin' })
    const tA = await reg('tc-mv-A@example.com', { role: 'teacher' })
    const tB = await reg('tc-mv-B@example.com', { role: 'teacher' })
    const slotId = await makeOpenSlotForTeacher(
      admin.cookie,
      tB.accountId,
      futureSlotIso(60 * 24 * 3),
    )
    const r = await teacherMoveHandler(
      buildRequest(`/api/teacher/slots/${slotId}/move`, {
        method: 'PATCH',
        cookie: tA.cookie,
        body: { newStartAt: futureSlotIso(60 * 24 * 3 + 90) },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('not_owner')
  })

  it('teacher moving own open slot → 200', async () => {
    const admin = await reg('tc-mv-own-admin@example.com', { role: 'admin' })
    const t = await reg('tc-mv-own-t@example.com', { role: 'teacher' })
    const slotId = await makeOpenSlotForTeacher(
      admin.cookie,
      t.accountId,
      futureSlotIso(60 * 24 * 3),
    )
    const r = await teacherMoveHandler(
      buildRequest(`/api/teacher/slots/${slotId}/move`, {
        method: 'PATCH',
        cookie: t.cookie,
        body: { newStartAt: futureSlotIso(60 * 24 * 3 + 90) },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(200)
  })

  it('teacher moving own BOOKED slot → 409 not_open', async () => {
    const admin = await reg('tc-mv-booked-admin@example.com', { role: 'admin' })
    const t = await reg('tc-mv-booked-t@example.com', { role: 'teacher' })
    const learner = await reg('tc-mv-booked-l@example.com')
    await setAssignedTeacher(learner.accountId, t.accountId)
    const slotId = await makeOpenSlotForTeacher(
      admin.cookie,
      t.accountId,
      futureSlotIso(60 * 24 * 3),
    )
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    const r = await teacherMoveHandler(
      buildRequest(`/api/teacher/slots/${slotId}/move`, {
        method: 'PATCH',
        cookie: t.cookie,
        body: { newStartAt: futureSlotIso(60 * 24 * 3 + 90) },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('not_open')
  })

  it('hybrid admin+teacher trying to move via /api/teacher → 403 admin_precedence', async () => {
    const admin = await reg('tc-mv-hyb-admin@example.com', { role: 'admin' })
    const h = await reg('tc-mv-hyb@example.com', { role: 'admin' })
    await getDbPool().query(
      `insert into account_roles (account_id, role, granted_by_account_id)
       values ($1, 'teacher', null) on conflict do nothing`,
      [h.accountId],
    )
    const slotId = await makeOpenSlotForTeacher(
      admin.cookie,
      h.accountId,
      futureSlotIso(60 * 24 * 3),
    )
    const r = await teacherMoveHandler(
      buildRequest(`/api/teacher/slots/${slotId}/move`, {
        method: 'PATCH',
        cookie: h.cookie,
        body: { newStartAt: futureSlotIso(60 * 24 * 3 + 90) },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('admin_precedence')
  })
})

describe('POST /api/teacher/slots/[id]/cancel — ownership + reason matrix', () => {
  it('teacher cancelling own open slot WITHOUT reason → 200', async () => {
    const admin = await reg('tc-c-open-admin@example.com', { role: 'admin' })
    const t = await reg('tc-c-open-t@example.com', { role: 'teacher' })
    const slotId = await makeOpenSlotForTeacher(
      admin.cookie,
      t.accountId,
      futureSlotIso(60 * 24 * 3),
    )
    const r = await teacherCancelHandler(
      buildRequest(`/api/teacher/slots/${slotId}/cancel`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(200)
    expect((await r.json()).slot.status).toBe('cancelled')
  })

  it('teacher cancelling own BOOKED slot WITHOUT reason → 400 reason_required_for_booked', async () => {
    const admin = await reg('tc-c-booked-admin@example.com', { role: 'admin' })
    const t = await reg('tc-c-booked-t@example.com', { role: 'teacher' })
    const learner = await reg('tc-c-booked-l@example.com')
    await setAssignedTeacher(learner.accountId, t.accountId)
    const slotId = await makeOpenSlotForTeacher(
      admin.cookie,
      t.accountId,
      futureSlotIso(60 * 24 * 3),
    )
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    const r = await teacherCancelHandler(
      buildRequest(`/api/teacher/slots/${slotId}/cancel`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('reason_required_for_booked')
  })

  it('teacher cancelling own BOOKED slot WITH reason → 200', async () => {
    const admin = await reg('tc-c-bok2-admin@example.com', { role: 'admin' })
    const t = await reg('tc-c-bok2-t@example.com', { role: 'teacher' })
    const learner = await reg('tc-c-bok2-l@example.com')
    await setAssignedTeacher(learner.accountId, t.accountId)
    const slotId = await makeOpenSlotForTeacher(
      admin.cookie,
      t.accountId,
      futureSlotIso(60 * 24 * 3),
    )
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    const r = await teacherCancelHandler(
      buildRequest(`/api/teacher/slots/${slotId}/cancel`, {
        cookie: t.cookie,
        body: { reason: 'Заболел, переноси с оператором' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(200)
    expect((await r.json()).slot.status).toBe('cancelled')
  })

  it('teacher A cancelling teacher B\'s slot → 403 not_owner', async () => {
    const admin = await reg('tc-c-cross-admin@example.com', { role: 'admin' })
    const tA = await reg('tc-c-cross-A@example.com', { role: 'teacher' })
    const tB = await reg('tc-c-cross-B@example.com', { role: 'teacher' })
    const slotId = await makeOpenSlotForTeacher(
      admin.cookie,
      tB.accountId,
      futureSlotIso(60 * 24 * 3),
    )
    const r = await teacherCancelHandler(
      buildRequest(`/api/teacher/slots/${slotId}/cancel`, {
        cookie: tA.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('not_owner')
  })

  it('cancelling already-cancelled slot → 409 already_terminal', async () => {
    const admin = await reg('tc-c-twice-admin@example.com', { role: 'admin' })
    const t = await reg('tc-c-twice-t@example.com', { role: 'teacher' })
    const slotId = await makeOpenSlotForTeacher(
      admin.cookie,
      t.accountId,
      futureSlotIso(60 * 24 * 3),
    )
    // First cancel → 200
    await teacherCancelHandler(
      buildRequest(`/api/teacher/slots/${slotId}/cancel`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    // Second cancel → 409
    const r = await teacherCancelHandler(
      buildRequest(`/api/teacher/slots/${slotId}/cancel`, {
        cookie: t.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('already_terminal')
  })
})
