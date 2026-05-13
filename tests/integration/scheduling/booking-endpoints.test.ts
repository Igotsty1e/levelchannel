import { describe, expect, it } from 'vitest'

import { GET as bookingDaysHandler } from '@/app/api/slots/booking-days/route'
import { GET as bookingTimesHandler } from '@/app/api/slots/booking-times/route'
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

async function assignTeacher(
  learnerAccountId: string,
  teacherAccountId: string,
): Promise<void> {
  await getDbPool().query(
    `update accounts set assigned_teacher_id = $2 where id = $1`,
    [learnerAccountId, teacherAccountId],
  )
}

describe('BCS-B.2 — GET /api/slots/booking-days', () => {
  it('returns days with open slots for assigned teacher', async () => {
    const teacher = await registerAndCookie('t-days-1@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('a-days-1@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('l-days-1@example.com', {
      verifyEmail: true,
    })
    await assignTeacher(learner.accountId, teacher.accountId)

    // Two slots on different days (futureSlotIso gives MSK-aligned futures).
    const slot1 = futureIsoMinutes(60 * 24) // ~1 day ahead
    const slot2 = futureIsoMinutes(60 * 48) // ~2 days ahead
    for (const startAt of [slot1, slot2]) {
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
      expect([200, 201]).toContain(created.status)
    }

    // Wide range covering both days.
    const today = new Date().toISOString().slice(0, 10)
    const future = new Date(Date.now() + 14 * 86_400_000)
      .toISOString()
      .slice(0, 10)

    const res = await bookingDaysHandler(
      buildRequest(
        `/api/slots/booking-days?from=${today}&to=${future}&tz=Europe/Moscow`,
        { cookie: learner.cookie },
      ),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.days)).toBe(true)
    expect(json.days.length).toBeGreaterThanOrEqual(1)
    // Each day matches YYYY-MM-DD
    for (const ymd of json.days) {
      expect(ymd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('empty days when learner has no assigned teacher', async () => {
    const learner = await registerAndCookie('l-days-2@example.com', {
      verifyEmail: true,
    })
    const today = new Date().toISOString().slice(0, 10)
    const future = new Date(Date.now() + 14 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const res = await bookingDaysHandler(
      buildRequest(
        `/api/slots/booking-days?from=${today}&to=${future}&tz=Europe/Moscow`,
        { cookie: learner.cookie },
      ),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.days).toEqual([])
  })

  it('400 on invalid from/to', async () => {
    const learner = await registerAndCookie('l-days-3@example.com', {
      verifyEmail: true,
    })
    const res = await bookingDaysHandler(
      buildRequest(
        `/api/slots/booking-days?from=junk&to=2026-12-31&tz=Europe/Moscow`,
        { cookie: learner.cookie },
      ),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_from')
  })

  it('400 on range > 92 days', async () => {
    const learner = await registerAndCookie('l-days-4@example.com', {
      verifyEmail: true,
    })
    const res = await bookingDaysHandler(
      buildRequest(
        `/api/slots/booking-days?from=2026-01-01&to=2026-12-31&tz=Europe/Moscow`,
        { cookie: learner.cookie },
      ),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('range_too_wide')
  })

  it('400 on invalid tz', async () => {
    const learner = await registerAndCookie('l-days-5@example.com', {
      verifyEmail: true,
    })
    const res = await bookingDaysHandler(
      buildRequest(
        `/api/slots/booking-days?from=2026-05-13&to=2026-05-20&tz=Mars/Olympus`,
        { cookie: learner.cookie },
      ),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_tz')
  })

  it('403 for authenticated admin (wrong role)', async () => {
    const admin = await registerAndCookie('a-days-6@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const today = new Date().toISOString().slice(0, 10)
    const future = new Date(Date.now() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const res = await bookingDaysHandler(
      buildRequest(
        `/api/slots/booking-days?from=${today}&to=${future}&tz=Europe/Moscow`,
        { cookie: admin.cookie },
      ),
    )
    expect([401, 403]).toContain(res.status)
  })
})

describe('BCS-B.2 — GET /api/slots/booking-times', () => {
  it('returns open slots for the requested day in assigned teacher tz', async () => {
    const teacher = await registerAndCookie('t-times-1@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('a-times-1@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('l-times-1@example.com', {
      verifyEmail: true,
    })
    await assignTeacher(learner.accountId, teacher.accountId)

    const startAt = futureIsoMinutes(60 * 26) // tomorrow
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
    expect([200, 201]).toContain(created.status)
    const slotJson = await created.json()
    // The created slot's start_at, projected into Europe/Moscow date.
    const startDate = new Date(slotJson.slot.startAt)
    const mskYmd = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(startDate)

    const res = await bookingTimesHandler(
      buildRequest(
        `/api/slots/booking-times?ymd=${mskYmd}&tz=Europe/Moscow`,
        { cookie: learner.cookie },
      ),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.slots)).toBe(true)
    expect(json.slots.length).toBeGreaterThanOrEqual(1)
    // Public DTO shape
    const slot = json.slots[0]
    expect(slot).toHaveProperty('id')
    expect(slot).toHaveProperty('startAt')
    expect(slot).toHaveProperty('durationMinutes')
    expect(slot).not.toHaveProperty('teacherEmail')
    expect(slot).not.toHaveProperty('notes')
  })

  it('empty slots when teacher has none on that day', async () => {
    const teacher = await registerAndCookie('t-times-2@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const learner = await registerAndCookie('l-times-2@example.com', {
      verifyEmail: true,
    })
    await assignTeacher(learner.accountId, teacher.accountId)

    // Pick a date far in the future with no slots seeded.
    const futureYmd = '2027-01-15'
    const res = await bookingTimesHandler(
      buildRequest(
        `/api/slots/booking-times?ymd=${futureYmd}&tz=Europe/Moscow`,
        { cookie: learner.cookie },
      ),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.slots).toEqual([])
  })

  it('400 on invalid ymd', async () => {
    const learner = await registerAndCookie('l-times-3@example.com', {
      verifyEmail: true,
    })
    const res = await bookingTimesHandler(
      buildRequest(`/api/slots/booking-times?ymd=junk&tz=Europe/Moscow`, {
        cookie: learner.cookie,
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_ymd')
  })

  it('400 on invalid tz', async () => {
    const learner = await registerAndCookie('l-times-4@example.com', {
      verifyEmail: true,
    })
    const res = await bookingTimesHandler(
      buildRequest(
        `/api/slots/booking-times?ymd=2026-05-20&tz=Foo/Bar`,
        { cookie: learner.cookie },
      ),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_tz')
  })

  it('empty slots when learner has no assigned teacher', async () => {
    const learner = await registerAndCookie('l-times-5@example.com', {
      verifyEmail: true,
    })
    const res = await bookingTimesHandler(
      buildRequest(
        `/api/slots/booking-times?ymd=2026-05-20&tz=Europe/Moscow`,
        { cookie: learner.cookie },
      ),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.slots).toEqual([])
  })
})
