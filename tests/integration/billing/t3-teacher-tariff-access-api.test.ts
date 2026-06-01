import { describe, expect, it } from 'vitest'

import {
  POST as grantHandler,
  DELETE as revokeHandler,
} from '@/app/api/teacher/tariffs/[id]/access/route'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest } from '../helpers'

// T3 Sub-PR D — API tests for /api/teacher/tariffs/[id]/access.

async function seedAccount(prefix: string): Promise<string> {
  const r = await getDbPool().query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [`${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`],
  )
  return String(r.rows[0].id)
}

async function makeTeacherSession(teacherId: string): Promise<string> {
  const { createSession, SESSION_COOKIE_NAME } = await import(
    '@/lib/auth/sessions'
  )
  const { cookieValue } = await createSession({ accountId: teacherId })
  return `${SESSION_COOKIE_NAME}=${cookieValue}`
}

async function seedTeacherAndTariff(prefix: string) {
  const teacherId = await seedAccount(`${prefix}-t`)
  await getDbPool().query(
    `insert into account_roles (account_id, role) values ($1, 'teacher')`,
    [teacherId],
  )
  const t = await getDbPool().query<{ id: string }>(
    `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes, teacher_id)
     values ($1, '60 мин', 150000, 60, $2) returning id`,
    [
      `${prefix}-tariff-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      teacherId,
    ],
  )
  return { teacherId, tariffId: String(t.rows[0].id) }
}

async function seedLinkedLearner(teacherId: string, prefix: string) {
  const learnerId = await seedAccount(`${prefix}-l`)
  await getDbPool().query(
    `insert into learner_teacher_links (teacher_account_id, learner_account_id)
     values ($1, $2)`,
    [teacherId, learnerId],
  )
  return learnerId
}

describe('T3 Sub-PR D — POST /api/teacher/tariffs/[id]/access', () => {
  it('grants access for a linked learner with optional override', async () => {
    const { teacherId, tariffId } = await seedTeacherAndTariff('grant-ok')
    const learnerId = await seedLinkedLearner(teacherId, 'grant-ok')
    const cookie = await makeTeacherSession(teacherId)
    const r = await grantHandler(
      buildRequest(`/api/teacher/tariffs/${tariffId}/access`, {
        cookie,
        body: { learnerId, overrideAmountKopecks: 120000 },
      }),
      { params: Promise.resolve({ id: tariffId }) },
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.ok).toBe(true)
    expect(body.access.overrideAmountKopecks).toBe(120000)
  })

  it('rejects 409 when learner is not linked', async () => {
    const { teacherId, tariffId } = await seedTeacherAndTariff('grant-nolink')
    const learnerId = await seedAccount('grant-nolink-l') // no link
    const cookie = await makeTeacherSession(teacherId)
    const r = await grantHandler(
      buildRequest(`/api/teacher/tariffs/${tariffId}/access`, {
        cookie,
        body: { learnerId },
      }),
      { params: Promise.resolve({ id: tariffId }) },
    )
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('learner_unlinked')
  })

  it('rejects 404 when teacher does not own the tariff', async () => {
    const { teacherId, tariffId } = await seedTeacherAndTariff('grant-owned-a')
    const learnerId = await seedLinkedLearner(teacherId, 'grant-owned')
    // Different teacher.
    const otherTeacher = await seedAccount('grant-owned-other')
    await getDbPool().query(
      `insert into account_roles (account_id, role) values ($1, 'teacher')`,
      [otherTeacher],
    )
    const cookie = await makeTeacherSession(otherTeacher)
    const r = await grantHandler(
      buildRequest(`/api/teacher/tariffs/${tariffId}/access`, {
        cookie,
        body: { learnerId },
      }),
      { params: Promise.resolve({ id: tariffId }) },
    )
    expect(r.status).toBe(404)
    expect((await r.json()).error).toBe('tariff_not_owned')
  })

  it('rejects 400 for invalid override amount', async () => {
    const { teacherId, tariffId } = await seedTeacherAndTariff('grant-badamt')
    const learnerId = await seedLinkedLearner(teacherId, 'grant-badamt')
    const cookie = await makeTeacherSession(teacherId)
    const r = await grantHandler(
      buildRequest(`/api/teacher/tariffs/${tariffId}/access`, {
        cookie,
        body: { learnerId, overrideAmountKopecks: 50 }, // below 100 floor
      }),
      { params: Promise.resolve({ id: tariffId }) },
    )
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('invalid_override_amount')
  })

  it('rejects 401 without session', async () => {
    const { tariffId } = await seedTeacherAndTariff('grant-noauth')
    const r = await grantHandler(
      buildRequest(`/api/teacher/tariffs/${tariffId}/access`, {
        body: { learnerId: '11111111-1111-1111-1111-111111111111' },
      }),
      { params: Promise.resolve({ id: tariffId }) },
    )
    expect(r.status).toBe(401)
  })
})

describe('T3 Sub-PR D — DELETE /api/teacher/tariffs/[id]/access', () => {
  it('revokes existing access', async () => {
    const { teacherId, tariffId } = await seedTeacherAndTariff('rev-ok')
    const learnerId = await seedLinkedLearner(teacherId, 'rev-ok')
    const cookie = await makeTeacherSession(teacherId)
    await grantHandler(
      buildRequest(`/api/teacher/tariffs/${tariffId}/access`, {
        cookie,
        body: { learnerId },
      }),
      { params: Promise.resolve({ id: tariffId }) },
    )
    const r = await revokeHandler(
      buildRequest(
        `/api/teacher/tariffs/${tariffId}/access?learnerId=${encodeURIComponent(learnerId)}`,
        { cookie },
      ),
      { params: Promise.resolve({ id: tariffId }) },
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.ok).toBe(true)
    expect(body.revoked).toBe(true)
  })

  it('returns revoked=false when no active row exists', async () => {
    const { teacherId, tariffId } = await seedTeacherAndTariff('rev-none')
    const learnerId = await seedLinkedLearner(teacherId, 'rev-none')
    const cookie = await makeTeacherSession(teacherId)
    const r = await revokeHandler(
      buildRequest(
        `/api/teacher/tariffs/${tariffId}/access?learnerId=${encodeURIComponent(learnerId)}`,
        { cookie },
      ),
      { params: Promise.resolve({ id: tariffId }) },
    )
    expect(r.status).toBe(200)
    expect((await r.json()).revoked).toBe(false)
  })
})
