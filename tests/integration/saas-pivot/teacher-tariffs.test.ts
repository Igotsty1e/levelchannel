import { beforeAll, describe, expect, it, vi } from 'vitest'

import { POST as adminSlotsCreate } from '@/app/api/admin/slots/route'
import { POST as teacherTariffsCreate, GET as teacherTariffsList } from '@/app/api/teacher/tariffs/route'
import {
  DELETE as teacherTariffsDelete,
  GET as teacherTariffsGet,
  PATCH as teacherTariffsPatch,
} from '@/app/api/teacher/tariffs/[id]/route'
import { POST as teacherSlotsCreate } from '@/app/api/teacher/slots/route'
import { grantAccountRole } from '@/lib/auth/accounts'
import { getAuthPool } from '@/lib/auth/pool'
import { createSession } from '@/lib/auth/sessions'
import {
  TariffNotActiveError,
  TariffOwnershipError,
  assertTariffActive,
  assertTariffOwnedByTeacher,
  createTariffForTeacher,
  getTariffForTeacher,
  listActiveTariffs,
  listAllTariffs,
  listTariffsForTeacher,
  softDeleteTariffForTeacher,
} from '@/lib/pricing/tariffs'
import { createSlot } from '@/lib/scheduling/slots'

import '../setup'
import { buildRequest, futureSlotIso } from '../helpers'

// SAAS-PIVOT Epic 2 Day 3 — teacher-owned tariffs + soft-delete tests.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 2.
//
// Pins:
//   - createTariffForTeacher scopes by teacher_id.
//   - listTariffsForTeacher rejects cross-teacher reads (no rows for B).
//   - softDeleteTariffForTeacher sets deleted_at and is idempotent.
//   - assertTariffActive throws on soft-deleted / unknown tariffs.
//   - assertTariffOwnedByTeacher throws on cross-teacher binding.
//   - createSlot rejects cross-teacher tariff binding (TariffOwnershipError).
//   - createSlot rejects soft-deleted tariff binding (TariffNotActiveError).
//   - PATCH /api/teacher/tariffs/[id] 404 from teacher B against teacher A's row.
//   - DELETE /api/teacher/tariffs/[id] returns 200 + sets deleted_at.
//   - Historical slot reads still join unfiltered after soft-delete.
//   - listAllTariffs (admin-global) surfaces every teacher.
//   - After mig 0088 INSERT WITHOUT teacher_id fails NOT NULL.

vi.mock('@/lib/email/dispatch', () => ({
  sendVerifyEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendAlreadyRegisteredEmail: vi.fn().mockResolvedValue({ ok: true }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true }),
}))

async function makeTeacher(suffix: string): Promise<string> {
  const email = `tariff-${suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
  const pool = getAuthPool()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'fake-hash-for-tariffs-tests', now())
     returning id`,
    [email],
  )
  const id = r.rows[0].id
  await grantAccountRole(id, 'teacher', null)
  return id
}

async function withTeacherSession(
  teacherId: string,
): Promise<{ cookie: string }> {
  const result = await createSession({
    accountId: teacherId,
    ip: null,
    userAgent: 'test-ua',
  })
  return { cookie: `lc_session=${result.cookieValue}` }
}

describe('SAAS-PIVOT Epic 2 Day 3 — teacher-owned tariffs', () => {
  it('createTariffForTeacher persists teacher_id', async () => {
    const teacherA = await makeTeacher('a-persist')
    const created = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'A 60 min',
      amountKopecks: 3500_00,
      durationMinutes: 60,
    })
    expect(created.teacherId).toBe(teacherA)
    expect(created.deletedAt).toBeNull()
  })

  it('listTariffsForTeacher scopes by teacher_id', async () => {
    const teacherA = await makeTeacher('a-list')
    const teacherB = await makeTeacher('b-list')
    await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'A tariff',
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    await createTariffForTeacher({
      teacherId: teacherB,
      slug: `t-b-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'B tariff',
      amountKopecks: 2000_00,
      durationMinutes: 60,
    })

    const aList = await listTariffsForTeacher(teacherA)
    const bList = await listTariffsForTeacher(teacherB)
    expect(aList.map((t) => t.teacherId)).toEqual([teacherA])
    expect(bList.map((t) => t.teacherId)).toEqual([teacherB])
  })

  it('teacher B cannot fetch teacher A tariff via GET (404)', async () => {
    const teacherA = await makeTeacher('a-get')
    const teacherB = await makeTeacher('b-get')
    const aTariff = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'A only',
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })

    const aFromB = await getTariffForTeacher(aTariff.id, teacherB)
    expect(aFromB).toBeNull()
    const aFromA = await getTariffForTeacher(aTariff.id, teacherA)
    expect(aFromA?.id).toBe(aTariff.id)
  })

  it('teacher B PATCH on A tariff returns 404 via route', async () => {
    const teacherA = await makeTeacher('a-patch')
    const teacherB = await makeTeacher('b-patch')
    const aTariff = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'A tariff',
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })

    const { cookie } = await withTeacherSession(teacherB)
    const req = buildRequest(`/api/teacher/tariffs/${aTariff.id}`, {
      method: 'PATCH',
      cookie,
      body: { titleRu: 'evil overwrite' },
    })
    const res = await teacherTariffsPatch(req, {
      params: Promise.resolve({ id: aTariff.id }),
    })
    expect(res.status).toBe(404)

    // A's row in DB is untouched.
    const stillA = await getTariffForTeacher(aTariff.id, teacherA)
    expect(stillA?.titleRu).toBe('A tariff')
  })

  it('soft-delete hides from teacher list + historical slot retains JOIN', async () => {
    const teacherA = await makeTeacher('a-soft')
    const tariff = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'Soon-archived',
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    // Create a slot referencing the tariff (historical) — direct insert
    // bypasses createSlot's ownership gate so we don't have to also
    // teach the slot helper about the tariff before archive. We're
    // exercising the read JOIN here, not the create gate.
    await getAuthPool().query(
      `insert into lesson_slots (teacher_account_id, start_at, duration_minutes, tariff_id)
       values ($1, $2, 60, $3)`,
      [teacherA, futureSlotIso(120), tariff.id],
    )

    const archived = await softDeleteTariffForTeacher(tariff.id, teacherA)
    expect(archived.ok).toBe(true)

    // Teacher list (active-only by default) no longer shows the tariff.
    const teacherList = await listTariffsForTeacher(teacherA)
    expect(teacherList.map((t) => t.id)).not.toContain(tariff.id)

    // Teacher list with archived includes it.
    const withArchive = await listTariffsForTeacher(teacherA, {
      includeArchived: true,
    })
    expect(withArchive.map((t) => t.id)).toContain(tariff.id)
    const found = withArchive.find((t) => t.id === tariff.id)
    expect(found?.deletedAt).toBeTruthy()

    // Historical slot read STILL resolves the tariff (LEFT JOIN unfiltered).
    const slotRead = await getAuthPool().query<{
      tariff_id: string
      title_ru: string
      amount_kopecks: number
    }>(
      `select s.tariff_id, t.title_ru, t.amount_kopecks
         from lesson_slots s
         left join pricing_tariffs t on t.id = s.tariff_id
        where s.teacher_account_id = $1 and s.tariff_id = $2`,
      [teacherA, tariff.id],
    )
    expect(slotRead.rows.length).toBe(1)
    expect(slotRead.rows[0].title_ru).toBe('Soon-archived')
    expect(Number(slotRead.rows[0].amount_kopecks)).toBe(1500_00)
  })

  it('soft-delete is idempotent (second call → not_found)', async () => {
    const teacherA = await makeTeacher('a-soft2')
    const tariff = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'Once',
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    const first = await softDeleteTariffForTeacher(tariff.id, teacherA)
    expect(first.ok).toBe(true)
    const second = await softDeleteTariffForTeacher(tariff.id, teacherA)
    expect(second.ok).toBe(false)
  })

  it('assertTariffActive throws TariffNotActiveError on archived', async () => {
    const teacherA = await makeTeacher('a-active')
    const tariff = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'Archived',
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    await softDeleteTariffForTeacher(tariff.id, teacherA)
    await expect(assertTariffActive(tariff.id)).rejects.toBeInstanceOf(
      TariffNotActiveError,
    )
  })

  it('assertTariffOwnedByTeacher throws on cross-teacher binding', async () => {
    const teacherA = await makeTeacher('a-own')
    const teacherB = await makeTeacher('b-own')
    const tariff = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: "A's",
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    await expect(
      assertTariffOwnedByTeacher(tariff.id, teacherB),
    ).rejects.toBeInstanceOf(TariffOwnershipError)
    // Same teacher passes.
    await expect(
      assertTariffOwnedByTeacher(tariff.id, teacherA),
    ).resolves.toBeUndefined()
  })

  it('createSlot rejects soft-deleted tariff', async () => {
    const teacherA = await makeTeacher('a-create-slot-arch')
    const tariff = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'Will be archived',
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    await softDeleteTariffForTeacher(tariff.id, teacherA)
    await expect(
      createSlot({
        teacherAccountId: teacherA,
        startAt: futureSlotIso(240),
        durationMinutes: 60,
        tariffId: tariff.id,
      }),
    ).rejects.toBeInstanceOf(TariffNotActiveError)
  })

  it('createSlot rejects cross-teacher tariff binding', async () => {
    const teacherA = await makeTeacher('a-create-cross')
    const teacherB = await makeTeacher('b-create-cross')
    const aTariff = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: "A's tariff",
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    await expect(
      createSlot({
        teacherAccountId: teacherB,
        startAt: futureSlotIso(300),
        durationMinutes: 60,
        tariffId: aTariff.id,
      }),
    ).rejects.toBeInstanceOf(TariffOwnershipError)
  })

  it('teacher POST /api/teacher/slots with another teacher tariff → 403', async () => {
    const teacherA = await makeTeacher('a-route-cross')
    const teacherB = await makeTeacher('b-route-cross')
    const aTariff = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: "A's tariff",
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    const { cookie } = await withTeacherSession(teacherB)
    const req = buildRequest('/api/teacher/slots', {
      method: 'POST',
      cookie,
      body: {
        startAt: futureSlotIso(360),
        durationMinutes: 60,
        tariffId: aTariff.id,
      },
    })
    const res = await teacherSlotsCreate(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('slot/tariffId/wrong_teacher')
  })

  it('admin POST /api/admin/slots with mismatched tariff → 400', async () => {
    const teacherA = await makeTeacher('a-admin-mismatch')
    const teacherB = await makeTeacher('b-admin-mismatch')
    const aTariff = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: "A's tariff",
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    // Need an admin session for admin route. Create an admin and session.
    const adminEmail = `admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
    const adminRes = await getAuthPool().query<{ id: string }>(
      `insert into accounts (email, password_hash, email_verified_at)
         values ($1, 'fake-hash', now()) returning id`,
      [adminEmail],
    )
    const adminId = adminRes.rows[0].id
    await grantAccountRole(adminId, 'admin', null)
    const { cookie } = await withTeacherSession(adminId)

    const req = buildRequest('/api/admin/slots', {
      method: 'POST',
      cookie,
      body: {
        teacherAccountId: teacherB,
        startAt: futureSlotIso(420),
        durationMinutes: 60,
        tariffId: aTariff.id,
      },
    })
    const res = await adminSlotsCreate(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('slot/tariffId/wrong_teacher')
  })

  it('admin listAllTariffs surfaces every teacher (admin-global)', async () => {
    const teacherA = await makeTeacher('a-admin-all')
    const teacherB = await makeTeacher('b-admin-all')
    const aT = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'A',
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    const bT = await createTariffForTeacher({
      teacherId: teacherB,
      slug: `t-b-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'B',
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })

    const all = await listAllTariffs()
    const ids = all.map((t) => t.id)
    expect(ids).toContain(aT.id)
    expect(ids).toContain(bT.id)

    // listActiveTariffs({ teacherId: null }) is admin-global too.
    const activeGlobal = await listActiveTariffs({ teacherId: null })
    const activeIds = activeGlobal.map((t) => t.id)
    expect(activeIds).toContain(aT.id)
    expect(activeIds).toContain(bT.id)

    // listActiveTariffs({ teacherId: A }) returns only A's.
    const justA = await listActiveTariffs({ teacherId: teacherA })
    expect(justA.map((t) => t.id)).toEqual([aT.id])
  })

  it('admin listAllTariffs default hides soft-deleted; includeArchived shows them', async () => {
    const teacherA = await makeTeacher('a-admin-archived')
    const tariff = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'A archived',
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    await softDeleteTariffForTeacher(tariff.id, teacherA)

    const defaultList = await listAllTariffs()
    expect(defaultList.map((t) => t.id)).not.toContain(tariff.id)
    const includeArchived = await listAllTariffs({ includeArchived: true })
    expect(includeArchived.map((t) => t.id)).toContain(tariff.id)
  })

  it('pricing_tariffs.teacher_id is NOT NULL after mig 0088', async () => {
    // Plan: §2.1 row 0075, §5 line 916. Direct INSERT without
    // teacher_id must fail with NOT NULL violation.
    await expect(
      getAuthPool().query(
        `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes)
         values ('day3-no-teacher-' || floor(random()*1e9)::text, 'X', 1500, 60)`,
      ),
    ).rejects.toThrow(/null value in column "teacher_id"|not-null/i)
  })

  it('teacher POST /api/teacher/tariffs creates row owned by session teacher', async () => {
    const teacher = await makeTeacher('a-route-create')
    const { cookie } = await withTeacherSession(teacher)
    const req = buildRequest('/api/teacher/tariffs', {
      method: 'POST',
      cookie,
      body: {
        titleRu: 'My 60-min',
        amountKopecks: 2500_00,
        durationMinutes: 60,
      },
    })
    const res = await teacherTariffsCreate(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.tariff.teacherId).toBe(teacher)
    expect(body.tariff.titleRu).toBe('My 60-min')

    // GET list confirms.
    const listReq = buildRequest('/api/teacher/tariffs', { method: 'GET', cookie })
    const listRes = await teacherTariffsList(listReq)
    const listBody = await listRes.json()
    expect(listBody.tariffs.map((t: { id: string }) => t.id)).toContain(
      body.tariff.id,
    )
  })

  it('teacher POST /api/teacher/tariffs ignores body teacherId (anti-spoof)', async () => {
    const teacherA = await makeTeacher('a-antispoof')
    const teacherB = await makeTeacher('b-antispoof')
    const { cookie } = await withTeacherSession(teacherA)
    const req = buildRequest('/api/teacher/tariffs', {
      method: 'POST',
      cookie,
      body: {
        titleRu: 'A tries to plant on B',
        amountKopecks: 1500_00,
        durationMinutes: 60,
        // Adversarial body — should be silently dropped.
        teacherId: teacherB,
      },
    })
    const res = await teacherTariffsCreate(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    // Created tariff belongs to session teacher (A), NOT body teacher (B).
    expect(body.tariff.teacherId).toBe(teacherA)
  })

  it('DELETE /api/teacher/tariffs/[id] soft-deletes the row', async () => {
    const teacher = await makeTeacher('a-route-delete')
    const tariff = await createTariffForTeacher({
      teacherId: teacher,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'Delete me',
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    const { cookie } = await withTeacherSession(teacher)
    const req = buildRequest(`/api/teacher/tariffs/${tariff.id}`, {
      method: 'DELETE',
      cookie,
    })
    const res = await teacherTariffsDelete(req, {
      params: Promise.resolve({ id: tariff.id }),
    })
    expect(res.status).toBe(200)
    // Row is soft-deleted (deleted_at set).
    const afterArchive = await getTariffForTeacher(tariff.id, teacher, {
      includeArchived: true,
    })
    expect(afterArchive?.deletedAt).toBeTruthy()
    // Default (active-only) get returns null.
    const defaultGet = await getTariffForTeacher(tariff.id, teacher)
    expect(defaultGet).toBeNull()
  })

  it('DELETE /api/teacher/tariffs/[id] from non-owner returns 404', async () => {
    const teacherA = await makeTeacher('a-route-del-cross')
    const teacherB = await makeTeacher('b-route-del-cross')
    const aTariff = await createTariffForTeacher({
      teacherId: teacherA,
      slug: `t-a-${Math.floor(Math.random() * 1e9)}`,
      titleRu: 'A only',
      amountKopecks: 1500_00,
      durationMinutes: 60,
    })
    const { cookie } = await withTeacherSession(teacherB)
    const req = buildRequest(`/api/teacher/tariffs/${aTariff.id}`, {
      method: 'DELETE',
      cookie,
    })
    const res = await teacherTariffsDelete(req, {
      params: Promise.resolve({ id: aTariff.id }),
    })
    expect(res.status).toBe(404)
    // A's row remains visible.
    const stillA = await getTariffForTeacher(aTariff.id, teacherA)
    expect(stillA?.deletedAt).toBeNull()
  })
})
