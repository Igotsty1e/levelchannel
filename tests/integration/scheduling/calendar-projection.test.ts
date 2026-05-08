import { describe, expect, it } from 'vitest'

import { GET as calendarHandler } from '@/app/api/slots/calendar/route'
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

function nextWeekFrom(): string {
  // Pick a date 7+ days out so it falls in the calendar window.
  const target = new Date(Date.now() + 7 * 86_400_000)
  return target.toISOString().slice(0, 10)
}
function nextWeekTo(): string {
  const target = new Date(Date.now() + 14 * 86_400_000)
  return target.toISOString().slice(0, 10)
}

describe('GET /api/slots/calendar — DTO projection per role', () => {
  it('admin response of an open slot: kind=open with id, durationMinutes, tariff fields', async () => {
    const teacher = await registerAndCookie('proj-t1@example.com', { role: 'teacher' })
    const admin = await registerAndCookie('proj-admin1@example.com', { role: 'admin' })
    const startAt = futureSlotIso(7 * 24 * 60 + 60) // ~7d future + 1h
    await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt,
          durationMinutes: 60,
        },
      }),
    )
    const r = await calendarHandler(
      buildRequest(
        `/api/slots/calendar?from=${nextWeekFrom()}&to=${nextWeekTo()}&teacherId=${teacher.accountId}`,
        { method: 'GET', cookie: admin.cookie },
      ),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.slots.length).toBeGreaterThanOrEqual(1)
    const open = body.slots.find((s: { kind: string }) => s.kind === 'open')
    expect(open).toBeDefined()
    expect(open).toHaveProperty('id')
    expect(open).toHaveProperty('startAt')
    expect(open).toHaveProperty('durationMinutes', 60)
    // No leak fields on open
    expect(open).not.toHaveProperty('learnerEmail')
    expect(open).not.toHaveProperty('learnerAccountId')
  })

  it('admin response of a booked slot: kind=booked-full with learnerEmail visible', async () => {
    const teacher = await registerAndCookie('proj-t2@example.com', { role: 'teacher' })
    const admin = await registerAndCookie('proj-admin2@example.com', { role: 'admin' })
    const learner = await registerAndCookie('proj-learner2@example.com')
    await setAssignedTeacher(learner.accountId, teacher.accountId)

    const startAt = futureSlotIso(7 * 24 * 60 + 120)
    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt,
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id

    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    const r = await calendarHandler(
      buildRequest(
        `/api/slots/calendar?from=${nextWeekFrom()}&to=${nextWeekTo()}&teacherId=${teacher.accountId}`,
        { method: 'GET', cookie: admin.cookie },
      ),
    )
    const body = await r.json()
    const booked = body.slots.find((s: { kind: string }) => s.kind === 'booked-full')
    expect(booked).toBeDefined()
    expect(booked.learnerEmail).toBe('proj-learner2@example.com')
    expect(booked).toHaveProperty('learnerAccountId')
    expect(booked).toHaveProperty('id')
  })

  it('learner response of own booking: kind=booked-self with id and tariff but NO learnerAccountId/learnerEmail visible', async () => {
    const teacher = await registerAndCookie('proj-t3@example.com', { role: 'teacher' })
    const admin = await registerAndCookie('proj-admin3@example.com', { role: 'admin' })
    const learner = await registerAndCookie('proj-learner3@example.com')
    await setAssignedTeacher(learner.accountId, teacher.accountId)

    const startAt = futureSlotIso(7 * 24 * 60 + 180)
    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt,
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id

    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    const r = await calendarHandler(
      buildRequest(
        `/api/slots/calendar?from=${nextWeekFrom()}&to=${nextWeekTo()}&teacherId=${teacher.accountId}`,
        { method: 'GET', cookie: learner.cookie },
      ),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    const own = body.slots.find((s: { kind: string }) => s.kind === 'booked-self')
    expect(own).toBeDefined()
    expect(own).toHaveProperty('id')
    expect(own).not.toHaveProperty('learnerAccountId')
    expect(own).not.toHaveProperty('learnerEmail')
  })

  it('learner response of booked-by-other slot: kind=booked-other with NO id, NO email, NO tariff', async () => {
    const teacher = await registerAndCookie('proj-t4@example.com', { role: 'teacher' })
    const admin = await registerAndCookie('proj-admin4@example.com', { role: 'admin' })
    const learnerA = await registerAndCookie('proj-learnerA@example.com')
    const learnerB = await registerAndCookie('proj-learnerB@example.com')
    await setAssignedTeacher(learnerA.accountId, teacher.accountId)
    await setAssignedTeacher(learnerB.accountId, teacher.accountId)

    const startAt = futureSlotIso(7 * 24 * 60 + 240)
    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt,
          durationMinutes: 60,
        },
      }),
    )
    const slotId = (await created.json()).slot.id

    // Learner A books it
    await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learnerA.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )

    // Learner B requests calendar — should see booked-other (redacted)
    const r = await calendarHandler(
      buildRequest(
        `/api/slots/calendar?from=${nextWeekFrom()}&to=${nextWeekTo()}&teacherId=${teacher.accountId}`,
        { method: 'GET', cookie: learnerB.cookie },
      ),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    const other = body.slots.find((s: { kind: string }) => s.kind === 'booked-other')
    expect(other).toBeDefined()
    // Strict ABSENCE checks per Codex round 1 #2.
    expect(other).not.toHaveProperty('id')
    expect(other).not.toHaveProperty('learnerAccountId')
    expect(other).not.toHaveProperty('learnerEmail')
    expect(other).not.toHaveProperty('tariffAmountKopecks')
    expect(other).not.toHaveProperty('tariffId')
    // What it DOES have:
    expect(other).toHaveProperty('startAt')
    expect(other).toHaveProperty('durationMinutes')
  })
})
