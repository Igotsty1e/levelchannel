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
import { createTariffForTeacher } from '@/lib/pricing/tariffs'

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

// SAAS-PIVOT Day 2 (2026-05-22) — dual-write fixture: tests that need
// a learner pinned to a teacher must now seed BOTH the legacy column
// (accounts.assigned_teacher_id, kept through MVP for the back-compat
// alias) AND the canonical learner_teacher_links row (plan §2.5).
// Without the link-row insert, /api/slots/booking-* reads — which
// switched to getActiveTeacherForLearner() — would see the learner
// as unbound and 200-with-empty.
async function assignTeacher(
  learnerAccountId: string,
  teacherAccountId: string,
): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `update accounts set assigned_teacher_id = $2 where id = $1`,
    [learnerAccountId, teacherAccountId],
  )
  await pool.query(
    `insert into learner_teacher_links (learner_account_id, teacher_account_id, linked_at)
       values ($1, $2, now())
     on conflict (learner_account_id, teacher_account_id) do update
       set unlinked_at = null`,
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

  it('400 on impossible calendar date (2026-02-31)', async () => {
    // Codex B.2 review: shape-only regex pre-fix accepted this and
    // it crashed Postgres ::date cast as 500. Real validation now.
    const learner = await registerAndCookie('l-days-3b@example.com', {
      verifyEmail: true,
    })
    const res = await bookingDaysHandler(
      buildRequest(
        `/api/slots/booking-days?from=2026-02-31&to=2026-03-15&tz=Europe/Moscow`,
        { cookie: learner.cookie },
      ),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_from')
  })

  it('400 on impossible month (2026-13-01)', async () => {
    const learner = await registerAndCookie('l-days-3c@example.com', {
      verifyEmail: true,
    })
    const res = await bookingDaysHandler(
      buildRequest(
        `/api/slots/booking-days?from=2026-05-13&to=2026-13-01&tz=Europe/Moscow`,
        { cookie: learner.cookie },
      ),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_to')
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

  // BUG 2026-05-15 regression — a learner with a legacy non-IANA
  // profile.timezone (e.g. plain 'Moscow') was getting 400 invalid_tz
  // on every booking-days call because the route fell back to
  // `profile?.timezone ?? 'Europe/Moscow'` and `'Moscow'` is not a
  // valid IANA name. After the fix, the route sanitises the profile
  // default via safeTimezone() and the call succeeds (no tz param).
  //
  // BCS-DEF-5 (2026-05-19) — migration 0069 added a DB-side CHECK
  // constraint (account_profiles_timezone_iana_check) that REJECTS the
  // raw 'Moscow' insert. The application-level safeTimezone() defence
  // remains; we now exercise the same fallback by setting timezone =
  // NULL (the normalized state migration 0048+0064 settled on). The
  // route still hits `profile?.timezone ?? 'Europe/Moscow'` and lands
  // on the safeTimezone() fallback.
  it('null profile.timezone is silently filled by safeTimezone fallback (no invalid_tz)', async () => {
    const learner = await registerAndCookie('l-tz-bad@example.com', {
      verifyEmail: true,
    })
    await getDbPool().query(
      `insert into account_profiles (account_id, display_name, timezone, locale)
       values ($1, 'Тест', NULL, 'ru')
       on conflict (account_id) do update set timezone = excluded.timezone`,
      [learner.accountId],
    )
    const today = new Date().toISOString().slice(0, 10)
    const future = new Date(Date.now() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    // NB: NO `tz=` query param — relies on profile fallback path.
    const res = await bookingDaysHandler(
      buildRequest(`/api/slots/booking-days?from=${today}&to=${future}`, {
        cookie: learner.cookie,
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.days).toEqual([]) // no slots, but the call succeeded
  })

  // BCS-DEF-5 (2026-05-19) regression pin — migration 0069 prevents
  // non-IANA inserts from reaching account_profiles in the first place.
  // The application-level safeTimezone() defence is a backstop only.
  it('DB CHECK rejects non-IANA timezone insert (migration 0069)', async () => {
    const learner = await registerAndCookie('l-tz-rejected@example.com', {
      verifyEmail: true,
    })
    let raised: string | null = null
    try {
      await getDbPool().query(
        `insert into account_profiles (account_id, display_name, timezone, locale)
         values ($1, 'Тест', 'Moscow', 'ru')
         on conflict (account_id) do update set timezone = excluded.timezone`,
        [learner.accountId],
      )
    } catch (err) {
      raised = err instanceof Error ? err.message : String(err)
    }
    expect(raised).toMatch(/account_profiles_timezone_iana_check/)
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

  // Bug #3 fix (2026-06-02) — anti-hardcode pin. The booking-times API
  // must surface the REAL slot.durationMinutes and the REAL tariff
  // title from pricing_tariffs, not the placeholder «50 мин» /
  // «Занятие по английскому» that lived on /cabinet/book[/ymd] before
  // this fix. Seeds a tariff with title 'Индивидуальный урок 60 мин'
  // and duration 60, binds a slot to it, and asserts the wire DTO
  // carries both real values (NOT the placeholders).
  it('returns real tariff title + duration on the wire (Bug #3 pin)', async () => {
    const teacher = await registerAndCookie('t-times-bug3@example.com', {
      verifyEmail: true,
      role: 'teacher',
    })
    const admin = await registerAndCookie('a-times-bug3@example.com', {
      verifyEmail: true,
      role: 'admin',
    })
    const learner = await registerAndCookie('l-times-bug3@example.com', {
      verifyEmail: true,
    })
    await assignTeacher(learner.accountId, teacher.accountId)

    // Seed a tariff with a concrete, recognisable title + duration.
    // Slug is teacher-prefixed to dodge the global UNIQUE on slug.
    const tariff = await createTariffForTeacher({
      teacherId: teacher.accountId,
      slug: `bug3-${teacher.accountId.slice(0, 8)}`,
      titleRu: 'Индивидуальный урок 60 мин',
      amountKopecks: 250_000,
      durationMinutes: 60,
    })
    expect(tariff.titleRu).toBe('Индивидуальный урок 60 мин')
    expect(tariff.durationMinutes).toBe(60)

    const startAt = futureIsoMinutes(60 * 26)
    const created = await adminCreateHandler(
      buildRequest('/api/admin/slots', {
        cookie: admin.cookie,
        body: {
          teacherAccountId: teacher.accountId,
          startAt,
          durationMinutes: 60,
          tariffId: tariff.id,
        },
      }),
    )
    expect([200, 201]).toContain(created.status)
    const slotJson = await created.json()
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
    const bug3Slot = (json.slots as Array<{
      id: string
      durationMinutes: number
      tariffTitleRu?: string | null
    }>).find((s) => s.id === slotJson.slot.id)
    expect(bug3Slot).toBeTruthy()
    // Real duration from the slot snapshot — explicit anti-placeholder.
    expect(bug3Slot!.durationMinutes).toBe(60)
    expect(bug3Slot!.durationMinutes).not.toBe(50)
    // Real tariff title via the booking-times SQL join.
    expect(bug3Slot!.tariffTitleRu).toBe('Индивидуальный урок 60 мин')
    expect(bug3Slot!.tariffTitleRu).not.toBe('Занятие по английскому')
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

  it('400 on impossible ymd date (2026-02-31)', async () => {
    const learner = await registerAndCookie('l-times-3b@example.com', {
      verifyEmail: true,
    })
    const res = await bookingTimesHandler(
      buildRequest(
        `/api/slots/booking-times?ymd=2026-02-31&tz=Europe/Moscow`,
        { cookie: learner.cookie },
      ),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_ymd')
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
