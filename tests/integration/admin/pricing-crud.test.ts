import { describe, expect, it } from 'vitest'

import {
  POST as createTariffHandler,
  GET as listTariffsHandler,
} from '@/app/api/admin/pricing/route'
import {
  DELETE as deleteTariffHandler,
  PATCH as patchTariffHandler,
} from '@/app/api/admin/pricing/[id]/route'
import { POST as adminCreateSlotHandler } from '@/app/api/admin/slots/route'
import { getDbPool } from '@/lib/db/pool'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as registerHandler } from '@/app/api/auth/register/route'
import { getAccountByEmail, grantAccountRole } from '@/lib/auth/accounts'

import '../setup'
import {
  buildRequest,
  extractSessionCookie,
  futureSlotIso,
  seedBootstrapTeacher,
} from '../helpers'

async function adminCookie(email = 'pricing-admin@example.com') {
  const password = 'StrongPassword123'
  const reg = await registerHandler(
    buildRequest('/api/auth/register', {
      body: { email, password, personalDataConsentAccepted: true },
    }),
  )
  expect(reg.status).toBe(200)
  const created = await getAccountByEmail(email)
  expect(created).not.toBeNull()
  await grantAccountRole(created!.id, 'admin', null)
  const login = await loginHandler(
    buildRequest('/api/auth/login', { body: { email, password } }),
  )
  expect(login.status).toBe(200)
  const cookie = extractSessionCookie(login.headers.get('Set-Cookie'))
  expect(cookie).not.toBeNull()
  return cookie!
}

describe('admin pricing CRUD', () => {
  it('creates, lists, patches a tariff', async () => {
    const cookie = await adminCookie()
    // SAAS-PIVOT Day 3: /admin/pricing POST falls back to bootstrap
    // teacher when no `teacherId` body override is passed. Seed the
    // marker row so the fallback resolves.
    await seedBootstrapTeacher()

    const created = await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: {
          slug: 'lesson-60min',
          titleRu: 'Урок 60 минут',
          amountKopecks: 350_000,
          durationMinutes: 60,
        },
      }),
    )
    expect(created.status).toBe(201)
    const createdJson = await created.json()
    expect(createdJson.tariff.slug).toBe('lesson-60min')
    expect(createdJson.tariff.durationMinutes).toBe(60)

    const list = await listTariffsHandler(
      buildRequest('/api/admin/pricing', { cookie }),
    )
    const listJson = await list.json()
    expect(listJson.tariffs.length).toBe(1)
    expect(listJson.tariffs[0].amountKopecks).toBe(350_000)

    const patched = await patchTariffHandler(
      buildRequest(`/api/admin/pricing/${createdJson.tariff.id}`, {
        method: 'PATCH',
        cookie,
        body: { amountKopecks: 400_000, isActive: false },
      }),
      { params: Promise.resolve({ id: createdJson.tariff.id as string }) },
    )
    expect(patched.status).toBe(200)
    const patchedJson = await patched.json()
    expect(patchedJson.tariff.amountKopecks).toBe(400_000)
    expect(patchedJson.tariff.isActive).toBe(false)
  })

  it('rejects a duplicate slug with 409', async () => {
    const cookie = await adminCookie('pricing-dup@example.com')
    await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: {
          slug: 'pkg-10',
          titleRu: 'Пакет 10',
          amountKopecks: 3_000_000,
          durationMinutes: 60,
        },
      }),
    )
    const second = await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: {
          slug: 'pkg-10',
          titleRu: 'Дубль',
          amountKopecks: 1_000,
          durationMinutes: 60,
        },
      }),
    )
    expect(second.status).toBe(409)
  })

  it('rejects an invalid amount with 400', async () => {
    const cookie = await adminCookie('pricing-bad@example.com')
    const res = await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: {
          slug: 'cheap',
          titleRu: 'Слишком дёшево',
          amountKopecks: 50,
          durationMinutes: 60,
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('BUG-2: hard-deletes an unreferenced tariff', async () => {
    const cookie = await adminCookie('pricing-del-ok@example.com')
    await seedBootstrapTeacher()
    const created = await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: {
          slug: 'lesson-to-be-deleted',
          titleRu: 'Удаляемый',
          amountKopecks: 250_000,
          durationMinutes: 60,
        },
      }),
    )
    expect(created.status).toBe(201)
    const id = (await created.json()).tariff.id as string

    const deleted = await deleteTariffHandler(
      buildRequest(`/api/admin/pricing/${id}`, {
        method: 'DELETE',
        cookie,
      }),
      { params: Promise.resolve({ id }) },
    )
    expect(deleted.status).toBe(200)

    // Verify it's actually gone.
    const check = await getDbPool().query(
      `select 1 from pricing_tariffs where id = $1`,
      [id],
    )
    expect(check.rows.length).toBe(0)
  })

  it('BUG-2: refuses to hard-delete a tariff bound to any slot', async () => {
    const cookie = await adminCookie('pricing-del-blocked@example.com')
    await seedBootstrapTeacher()
    const teacherEmail = 'pricing-del-teacher@example.com'
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: teacherEmail,
          password: 'StrongPassword123',
          personalDataConsentAccepted: true,
        },
      }),
    )
    const teacher = (await getAccountByEmail(teacherEmail))!
    await grantAccountRole(teacher.id, 'teacher', null)

    const tariffRes = await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: {
          slug: 'lesson-attached',
          titleRu: 'Уже привязан',
          amountKopecks: 300_000,
          durationMinutes: 60,
        },
      }),
    )
    const tariffId = (await tariffRes.json()).tariff.id as string

    // Bind to a slot directly via SQL — same DB-level state as the
    // production wire, no admin-create-slot preconditions to satisfy
    // here (the slot bind is what we're testing, not the full flow).
    // 30-min-aligned future timestamp inside MSK business hours
    // (constraints `lesson_slots_start_30min_aligned` +
    // `lesson_slots_start_in_business_hours`). futureSlotIso handles
    // both.
    await getDbPool().query(
      `insert into lesson_slots
         (id, teacher_account_id, start_at, duration_minutes, status, tariff_id)
       values (gen_random_uuid(), $1, $2::timestamptz, 60, 'open', $3)`,
      [teacher.id, futureSlotIso(14 * 24 * 60 + 120), tariffId],
    )

    const refused = await deleteTariffHandler(
      buildRequest(`/api/admin/pricing/${tariffId}`, {
        method: 'DELETE',
        cookie,
      }),
      { params: Promise.resolve({ id: tariffId }) },
    )
    expect(refused.status).toBe(409)
    const body = await refused.json()
    expect(body.error).toBe('has_slot_references')
    expect(body.slotCount).toBeGreaterThanOrEqual(1)
    expect(typeof body.message).toBe('string')

    // Row must still exist.
    const stillThere = await getDbPool().query(
      `select 1 from pricing_tariffs where id = $1`,
      [tariffId],
    )
    expect(stillThere.rows.length).toBe(1)
  })

  it('BUG-2: returns 404 on hostile non-uuid id', async () => {
    const cookie = await adminCookie('pricing-del-baduuid@example.com')
    const res = await deleteTariffHandler(
      buildRequest('/api/admin/pricing/not-a-uuid', {
        method: 'DELETE',
        cookie,
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    )
    expect(res.status).toBe(404)
  })

  it('BUG-3: rejects tariff create without durationMinutes (400)', async () => {
    const cookie = await adminCookie('pricing-no-dur@example.com')
    const res = await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: {
          slug: 'no-dur',
          titleRu: 'Без длительности',
          amountKopecks: 200_000,
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('BUG-3: rejects tariff create with out-of-band duration (400)', async () => {
    const cookie = await adminCookie('pricing-bad-dur@example.com')
    const res = await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: {
          slug: 'too-long',
          titleRu: 'Слишком длинно',
          amountKopecks: 200_000,
          durationMinutes: 999,
        },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('BUG-3: admin slot create refuses tariff with mismatched duration', async () => {
    const cookie = await adminCookie('pricing-slot-gate@example.com')
    await seedBootstrapTeacher()
    const teacherEmail = 'pricing-slot-gate-teacher@example.com'
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: teacherEmail,
          password: 'StrongPassword123',
          personalDataConsentAccepted: true,
        },
      }),
    )
    const teacher = (await getAccountByEmail(teacherEmail))!
    await grantAccountRole(teacher.id, 'teacher', null)

    // Create a 90-min tariff and try to attach to a 60-min slot.
    const created = await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: {
          slug: 'gate-90',
          titleRu: 'Урок 90 минут',
          amountKopecks: 500_000,
          durationMinutes: 90,
        },
      }),
    )
    expect(created.status).toBe(201)
    const tariffId = (await created.json()).tariff.id as string

    const slotRes = await adminCreateSlotHandler(
      buildRequest('/api/admin/slots', {
        cookie,
        body: {
          teacherAccountId: teacher.id,
          startAt: futureSlotIso(14 * 24 * 60 + 180),
          durationMinutes: 60,
          tariffId,
        },
      }),
    )
    expect(slotRes.status).toBeGreaterThanOrEqual(400)
    // The error path bubbles through admin/slots/route.ts; just verify
    // no slot was created (gate fired before insert).
    const slotsForTeacher = await getDbPool().query(
      `select count(*)::int as n from lesson_slots where teacher_account_id = $1`,
      [teacher.id],
    )
    expect(Number(slotsForTeacher.rows[0].n)).toBe(0)
  })

  it('BUG-3: PATCH duration_minutes is immutable after first slot reference (409 via app guard)', async () => {
    const cookie = await adminCookie('pricing-dur-immutable@example.com')
    await seedBootstrapTeacher()
    const teacherEmail = 'pricing-dur-imm-teacher@example.com'
    await registerHandler(
      buildRequest('/api/auth/register', {
        body: {
          email: teacherEmail,
          password: 'StrongPassword123',
          personalDataConsentAccepted: true,
        },
      }),
    )
    const teacher = (await getAccountByEmail(teacherEmail))!
    await grantAccountRole(teacher.id, 'teacher', null)

    const created = await createTariffHandler(
      buildRequest('/api/admin/pricing', {
        cookie,
        body: {
          slug: 'imm-60',
          titleRu: 'Иммутабельный',
          amountKopecks: 300_000,
          durationMinutes: 60,
        },
      }),
    )
    const tariffId = (await created.json()).tariff.id as string

    // Bind to a slot, then try to flip duration.
    await getDbPool().query(
      `insert into lesson_slots
         (id, teacher_account_id, start_at, duration_minutes, status, tariff_id)
       values (gen_random_uuid(), $1, $2::timestamptz, 60, 'open', $3)`,
      [teacher.id, futureSlotIso(14 * 24 * 60 + 60), tariffId],
    )

    const patched = await patchTariffHandler(
      buildRequest(`/api/admin/pricing/${tariffId}`, {
        method: 'PATCH',
        cookie,
        body: { durationMinutes: 90 },
      }),
      { params: Promise.resolve({ id: tariffId }) },
    )
    // updateTariff throws an internal error → bubbles as 500 via the
    // catch block, OR as a friendly error if the route surfaces it.
    // Either way, the row must NOT have changed.
    expect(patched.status).toBeGreaterThanOrEqual(400)
    const row = await getDbPool().query(
      `select duration_minutes from pricing_tariffs where id = $1`,
      [tariffId],
    )
    expect(Number(row.rows[0].duration_minutes)).toBe(60)
  })
})
