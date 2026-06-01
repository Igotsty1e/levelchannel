import { describe, expect, it } from 'vitest'

import { GET as availableHandler } from '@/app/api/slots/available/route'
import { getDbPool } from '@/lib/db/pool'

import '../setup'
import { buildRequest } from '../helpers'

// T3 Sub-PR C — anonymous endpoint visibility gate.
// Closes paranoia round-1 BLOCKER#3: private-tariff slots must not
// enumerate to anonymous (or non-authorised) viewers.

async function seedTeacherAndSlots(args: {
  prefix: string
  catalogCount: number
  privateCount: number
}) {
  const pool = getDbPool()
  const t = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [`${args.prefix}-t-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`],
  )
  const teacherId = String(t.rows[0].id)
  await pool.query(
    `insert into account_roles (account_id, role) values ($1, 'teacher')`,
    [teacherId],
  )

  const mkTariff = async (
    visibility: 'catalog' | 'private',
    n: number,
  ): Promise<string> => {
    const r = await pool.query<{ id: string }>(
      `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes, teacher_id, visibility)
       values ($1, '60 мин', 150000, 60, $2, $3) returning id`,
      [
        `${args.prefix}-${visibility}-${n}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        teacherId,
        visibility,
      ],
    )
    return String(r.rows[0].id)
  }

  const tariffIds: { catalog: string[]; private: string[] } = {
    catalog: [],
    private: [],
  }
  for (let i = 0; i < args.catalogCount; i++) {
    tariffIds.catalog.push(await mkTariff('catalog', i))
  }
  for (let i = 0; i < args.privateCount; i++) {
    tariffIds.private.push(await mkTariff('private', i))
  }

  // Seed an open slot for each tariff. 30-min aligned future time.
  const slotIds: string[] = []
  let i = 0
  for (const tariffId of [...tariffIds.catalog, ...tariffIds.private]) {
    const startAt = new Date()
    startAt.setUTCHours(10 - 3 + i, 0, 0, 0)
    startAt.setUTCDate(startAt.getUTCDate() + 1 + i)
    const slot = await pool.query<{ id: string }>(
      `insert into lesson_slots
         (teacher_account_id, start_at, duration_minutes, status, tariff_id)
       values ($1, $2, 60, 'open', $3) returning id`,
      [teacherId, startAt, tariffId],
    )
    slotIds.push(String(slot.rows[0].id))
    i++
  }
  return { teacherId, tariffIds, slotIds }
}

describe('T3 Sub-PR C: /api/slots/available anonymous visibility filter', () => {
  it('anonymous viewer sees ONLY catalog-tariff slots; private hidden', async () => {
    const { teacherId, tariffIds } = await seedTeacherAndSlots({
      prefix: 'anon-cat',
      catalogCount: 2,
      privateCount: 3,
    })
    const r = await availableHandler(
      buildRequest(`/api/slots/available?teacher=${encodeURIComponent(teacherId)}`),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    const returnedTariffIds = new Set(
      body.slots.map((s: { tariffId: string | null }) => s.tariffId),
    )
    for (const id of tariffIds.catalog) expect(returnedTariffIds.has(id)).toBe(true)
    for (const id of tariffIds.private) expect(returnedTariffIds.has(id)).toBe(false)
  })

  it('authenticated learner with active access for a private tariff sees that slot', async () => {
    const { teacherId, tariffIds } = await seedTeacherAndSlots({
      prefix: 'auth-grant',
      catalogCount: 1,
      privateCount: 2,
    })
    const pool = getDbPool()
    const learner = await pool.query<{ id: string }>(
      `insert into accounts (email, password_hash, email_verified_at)
       values ($1, 'dummy', now()) returning id`,
      [`auth-grant-l-${Date.now()}@example.com`],
    )
    const learnerId = String(learner.rows[0].id)
    await pool.query(
      `insert into learner_teacher_links (teacher_account_id, learner_account_id)
       values ($1, $2)`,
      [teacherId, learnerId],
    )
    // Grant access to the FIRST private tariff only.
    await pool.query(
      `insert into learner_tariff_access (teacher_id, learner_account_id, tariff_id)
       values ($1, $2, $3)`,
      [teacherId, learnerId, tariffIds.private[0]],
    )

    // Session cookie for the learner; skip full register flow.
    const { createSession, SESSION_COOKIE_NAME } = await import('@/lib/auth/sessions')
    const { cookieValue } = await createSession({ accountId: learnerId })
    const cookie = `${SESSION_COOKIE_NAME}=${cookieValue}`

    const r = await availableHandler(
      buildRequest(
        `/api/slots/available?teacher=${encodeURIComponent(teacherId)}`,
        { cookie },
      ),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    const returnedTariffIds = new Set(
      body.slots.map((s: { tariffId: string | null }) => s.tariffId),
    )
    expect(returnedTariffIds.has(tariffIds.catalog[0])).toBe(true)
    expect(returnedTariffIds.has(tariffIds.private[0])).toBe(true)
    // The OTHER private tariff (no grant) is excluded.
    expect(returnedTariffIds.has(tariffIds.private[1])).toBe(false)
  })
})
