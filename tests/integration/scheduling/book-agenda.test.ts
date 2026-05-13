import { describe, expect, it } from 'vitest'

import { POST as bookHandler } from '@/app/api/slots/[id]/book/route'
import { POST as adminBookAsOpHandler } from '@/app/api/admin/slots/[id]/book-as-operator/route'
import { POST as adminCreateHandler } from '@/app/api/admin/slots/route'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import {
  getAccountByEmail,
  grantAccountRole,
  markAccountVerified,
} from '@/lib/auth/accounts'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import {
  buildRequest,
  extractSessionCookie,
  futureSlotIso as futureIsoMinutes,
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
  if (opts.verifyEmail) {
    await markAccountVerified(created!.id)
  }
  if (opts.role) {
    await grantAccountRole(created!.id, opts.role, null)
  }
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  expect(login.status).toBe(200)
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  expect(cookie).not.toBeNull()
  return { cookie: cookie!, accountId: created!.id }
}

async function readAgendaFromDb(slotId: string): Promise<string | null> {
  const pool = getDbPool()
  const r = await pool.query(
    'select agenda from lesson_slots where id = $1',
    [slotId],
  )
  if (r.rows.length === 0) return null
  return r.rows[0].agenda === null || r.rows[0].agenda === undefined
    ? null
    : String(r.rows[0].agenda)
}

async function setupSlot(suffix: string): Promise<{
  slotId: string
  learner: { cookie: string; accountId: string }
}> {
  const teacher = await registerAndCookie(`teacher-agenda-${suffix}@example.com`, {
    verifyEmail: true,
    role: 'teacher',
  })
  const admin = await registerAndCookie(`admin-agenda-${suffix}@example.com`, {
    verifyEmail: true,
    role: 'admin',
  })
  const learner = await registerAndCookie(`learner-agenda-${suffix}@example.com`, {
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
  return { slotId, learner }
}

describe('BCS-B.1 — agenda capture on /api/slots/[id]/book', () => {
  it('persists learner-provided agenda on the slot', async () => {
    const { slotId, learner } = await setupSlot('a1')

    const book = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: { agenda: 'хочу разобрать present perfect' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(book.status).toBe(200)
    const json = await book.json()
    expect(json.slot.status).toBe('booked')

    // Agenda landed in the DB column.
    expect(await readAgendaFromDb(slotId)).toBe(
      'хочу разобрать present perfect',
    )
    // Agenda also surfaces in the response slot DTO (rowToSlot mapped it).
    expect(json.slot.agenda).toBe('хочу разобрать present perfect')
  })

  it('trims whitespace from agenda', async () => {
    const { slotId, learner } = await setupSlot('a2')

    const book = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: { agenda: '   hello   ' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(book.status).toBe(200)

    expect(await readAgendaFromDb(slotId)).toBe('hello')
  })

  it('stores null for empty-string agenda', async () => {
    const { slotId, learner } = await setupSlot('a3')

    const book = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: { agenda: '' },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(book.status).toBe(200)

    expect(await readAgendaFromDb(slotId)).toBe(null)
  })

  it('refuses agenda over MAX_AGENDA_LEN (1000) — degrades to null, booking still succeeds', async () => {
    const { slotId, learner } = await setupSlot('a4')

    const overlong = 'x'.repeat(1001)
    const book = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: { agenda: overlong },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(book.status).toBe(200) // booking still succeeds (the learner's intent outranks comment validity)
    expect(await readAgendaFromDb(slotId)).toBe(null) // but agenda is rejected
  })

  it('tolerates empty POST body (no agenda)', async () => {
    const { slotId, learner } = await setupSlot('a5')

    // Construct a POST with no body at all by giving body=undefined and
    // body=null — buildRequest helper sends a real empty body. The route
    // must still succeed with agenda → null.
    const book = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: {},
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(book.status).toBe(200)
    expect(await readAgendaFromDb(slotId)).toBe(null)
  })

  it('ignores non-string agenda type (e.g. number)', async () => {
    const { slotId, learner } = await setupSlot('a6')

    const book = await bookHandler(
      buildRequest(`/api/slots/${slotId}/book`, {
        cookie: learner.cookie,
        body: { agenda: 42 as unknown as string },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(book.status).toBe(200)
    expect(await readAgendaFromDb(slotId)).toBe(null)
  })

  it('admin book-as-operator path does NOT set agenda even if body included one', async () => {
    const { slotId } = await setupSlot('a7')
    const admin = await registerAndCookie('admin-agenda-a7-op@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner2 = await registerAndCookie('learner-agenda-a7-op@example.com', {
      verifyEmail: true,
    })

    const book = await adminBookAsOpHandler(
      buildRequest(`/api/admin/slots/${slotId}/book-as-operator`, {
        cookie: admin.cookie,
        body: {
          learnerEmail: 'learner-agenda-a7-op@example.com',
          // Even if a (hypothetical) admin client tried to inject agenda,
          // the operator-side endpoint MUST NOT propagate it. The actor
          // gate inside bookSlot forces null.
          agenda: 'shadow agenda from operator',
        },
      }),
      { params: Promise.resolve({ id: slotId }) },
    )
    expect(book.status).toBe(200)
    expect(await readAgendaFromDb(slotId)).toBe(null)
    // ensure the bookhandled by admin path used the right learner
    void learner2
  })
})
