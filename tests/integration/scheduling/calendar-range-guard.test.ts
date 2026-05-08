import { describe, expect, it } from 'vitest'

import { GET as calendarHandler } from '@/app/api/slots/calendar/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'

import '../setup'
import { buildRequest, extractSessionCookie } from '../helpers'

async function adminCookie(email: string): Promise<string> {
  const password = 'StrongPassword123'
  await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  const acc = (await getAccountByEmail(email))!
  await markAccountVerified(acc.id)
  await grantAccountRole(acc.id, 'admin', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  return extractSessionCookie(login.headers.get('Set-Cookie'))!
}

const FAKE_TEACHER_ID = '11111111-2222-3333-4444-555555555555'

function callCalendar(
  cookie: string,
  query: { from?: string; to?: string; teacherId?: string },
) {
  const params = new URLSearchParams()
  if (query.from !== undefined) params.set('from', query.from)
  if (query.to !== undefined) params.set('to', query.to)
  if (query.teacherId !== undefined) params.set('teacherId', query.teacherId)
  return calendarHandler(
    buildRequest(`/api/slots/calendar?${params.toString()}`, {
      method: 'GET',
      cookie,
    }),
  )
}

describe('GET /api/slots/calendar — range guard', () => {
  it('to-from = 8 days returns 400 bad_range', async () => {
    const cookie = await adminCookie('rg-1@example.com')
    const r = await callCalendar(cookie, {
      from: '2026-05-10',
      to: '2026-05-18',
      teacherId: FAKE_TEACHER_ID,
    })
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toBe('bad_range')
  })

  it('to-from = 6 days returns 400 bad_range', async () => {
    const cookie = await adminCookie('rg-2@example.com')
    const r = await callCalendar(cookie, {
      from: '2026-05-10',
      to: '2026-05-16',
      teacherId: FAKE_TEACHER_ID,
    })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('bad_range')
  })

  it('from > to returns 400 bad_range', async () => {
    const cookie = await adminCookie('rg-3@example.com')
    const r = await callCalendar(cookie, {
      from: '2026-05-17',
      to: '2026-05-10',
      teacherId: FAKE_TEACHER_ID,
    })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('bad_range')
  })

  it('from = ISO timestamp returns 400 bad_from_format', async () => {
    const cookie = await adminCookie('rg-4@example.com')
    const r = await callCalendar(cookie, {
      from: '2026-05-10T00:00:00Z',
      to: '2026-05-17',
      teacherId: FAKE_TEACHER_ID,
    })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('bad_from_format')
  })

  it('from = invalid date 2026-13-01 returns 400 bad_from_format', async () => {
    const cookie = await adminCookie('rg-5@example.com')
    const r = await callCalendar(cookie, {
      from: '2026-13-01',
      to: '2026-13-08',
      teacherId: FAKE_TEACHER_ID,
    })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('bad_from_format')
  })

  it('from = "yesterday" returns 400 bad_from_format', async () => {
    const cookie = await adminCookie('rg-6@example.com')
    const r = await callCalendar(cookie, {
      from: 'yesterday',
      to: '2026-05-17',
      teacherId: FAKE_TEACHER_ID,
    })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('bad_from_format')
  })

  it('happy: from=2026-05-10, to=2026-05-17, teacherId=UUID returns 200', async () => {
    const cookie = await adminCookie('rg-7@example.com')
    const r = await callCalendar(cookie, {
      from: '2026-05-10',
      to: '2026-05-17',
      teacherId: FAKE_TEACHER_ID,
    })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.slots).toEqual([])
    expect(body.teacherId).toBe(FAKE_TEACHER_ID)
    expect(body.rangeStart).toMatch(/2026-05-09T21:00:00/)
    expect(body.rangeEnd).toMatch(/2026-05-16T21:00:00/)
  })

  it('teacherId not a UUID returns 400 bad_teacher_id', async () => {
    const cookie = await adminCookie('rg-8@example.com')
    const r = await callCalendar(cookie, {
      from: '2026-05-10',
      to: '2026-05-17',
      teacherId: 'not-a-uuid',
    })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('bad_teacher_id')
  })

  it('anonymous → 401', async () => {
    const r = await callCalendar('', {
      from: '2026-05-10',
      to: '2026-05-17',
      teacherId: FAKE_TEACHER_ID,
    })
    expect(r.status).toBe(401)
  })
})
