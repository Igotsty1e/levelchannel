import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  grantLearnerTariffAccess,
  listActiveTariffAccessForPair,
  revokeLearnerTariffAccess,
} from '@/lib/billing/learner-tariff-access'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// T3 Sub-PR A foundation tests — exercise the junction helper +
// the BEFORE-trigger invariants from mig 0102.

async function seedTeacher(prefix: string): Promise<string> {
  const pool = getDbPool()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [`${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`],
  )
  const id = String(r.rows[0].id)
  await pool.query(
    `insert into account_roles (account_id, role) values ($1, 'teacher')`,
    [id],
  )
  return id
}

async function seedLearner(prefix: string): Promise<string> {
  const pool = getDbPool()
  const r = await pool.query<{ id: string }>(
    `insert into accounts (email, password_hash, email_verified_at)
     values ($1, 'dummy', now()) returning id`,
    [`${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`],
  )
  return String(r.rows[0].id)
}

async function seedLink(teacherId: string, learnerId: string) {
  await getDbPool().query(
    `insert into learner_teacher_links (teacher_account_id, learner_account_id)
     values ($1, $2) on conflict do nothing`,
    [teacherId, learnerId],
  )
}

async function seedTariff(teacherId: string, prefix: string): Promise<string> {
  const r = await getDbPool().query<{ id: string }>(
    `insert into pricing_tariffs (slug, title_ru, amount_kopecks, duration_minutes, teacher_id)
     values ($1, '60 мин', 150000, 60, $2) returning id`,
    [`${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, teacherId],
  )
  return String(r.rows[0].id)
}

describe('learner_tariff_access helper + mig 0102 invariants', () => {
  it('grants and lists active access for a pair', async () => {
    const teacher = await seedTeacher('lta-grant-t')
    const learner = await seedLearner('lta-grant-l')
    await seedLink(teacher, learner)
    const tariff = await seedTariff(teacher, 'lta-grant-tariff')

    const granted = await grantLearnerTariffAccess(null, {
      teacherId: teacher,
      learnerAccountId: learner,
      tariffId: tariff,
      overrideAmountKopecks: 120000,
      grantedByAccountId: teacher,
    })
    expect(granted.tariffId).toBe(tariff)
    expect(granted.overrideAmountKopecks).toBe(120000)
    expect(granted.revokedAt).toBeNull()

    const active = await listActiveTariffAccessForPair(teacher, learner)
    expect(active).toHaveLength(1)
    expect(active[0].tariffId).toBe(tariff)
  })

  it('rejects insert when tariff belongs to a different teacher', async () => {
    const teacherA = await seedTeacher('lta-owner-a')
    const teacherB = await seedTeacher('lta-owner-b')
    const learner = await seedLearner('lta-owner-l')
    await seedLink(teacherB, learner)
    const tariffA = await seedTariff(teacherA, 'lta-owner-tariff-a')

    await expect(
      grantLearnerTariffAccess(null, {
        teacherId: teacherB,
        learnerAccountId: learner,
        tariffId: tariffA,
      }),
    ).rejects.toThrow(/owned by/)
  })

  it('rejects insert when no active learner-teacher link', async () => {
    const teacher = await seedTeacher('lta-nolink-t')
    const learner = await seedLearner('lta-nolink-l')
    // Intentionally NO seedLink.
    const tariff = await seedTariff(teacher, 'lta-nolink-tariff')

    await expect(
      grantLearnerTariffAccess(null, {
        teacherId: teacher,
        learnerAccountId: learner,
        tariffId: tariff,
      }),
    ).rejects.toThrow(/no active link/)
  })

  it('revoke-only UPDATE succeeds even after link is unlinked', async () => {
    // R3-BLOCKER#4 closure: archive/teacher-unlink flows need to be
    // able to revoke an existing junction row even after the link
    // itself has become historical.
    const teacher = await seedTeacher('lta-revunl-t')
    const learner = await seedLearner('lta-revunl-l')
    await seedLink(teacher, learner)
    const tariff = await seedTariff(teacher, 'lta-revunl-tariff')

    await grantLearnerTariffAccess(null, {
      teacherId: teacher,
      learnerAccountId: learner,
      tariffId: tariff,
    })
    // Now unlink the pair.
    await getDbPool().query(
      `update learner_teacher_links set unlinked_at = now()
        where teacher_account_id = $1 and learner_account_id = $2`,
      [teacher, learner],
    )
    // Revoke must still work.
    const revoked = await revokeLearnerTariffAccess(null, {
      teacherId: teacher,
      learnerAccountId: learner,
      tariffId: tariff,
    })
    expect(revoked).not.toBeNull()
    expect(revoked!.revokedAt).not.toBeNull()
  })

  it('non-revoke-only UPDATE on unlinked pair still rejects', async () => {
    // The exemption is narrow: ONLY revoke-only updates (revoked_at
    // transition NULL → not NULL with no other field changes) are
    // permitted on historical links.
    const teacher = await seedTeacher('lta-narrow-t')
    const learner = await seedLearner('lta-narrow-l')
    await seedLink(teacher, learner)
    const tariff = await seedTariff(teacher, 'lta-narrow-tariff')

    await grantLearnerTariffAccess(null, {
      teacherId: teacher,
      learnerAccountId: learner,
      tariffId: tariff,
      overrideAmountKopecks: 120000,
    })
    await getDbPool().query(
      `update learner_teacher_links set unlinked_at = now()
        where teacher_account_id = $1 and learner_account_id = $2`,
      [teacher, learner],
    )
    // An override-edit (not pure revoke) must reject.
    await expect(
      getDbPool().query(
        `update learner_tariff_access
            set override_amount_kopecks = 130000
          where teacher_id = $1 and learner_account_id = $2 and tariff_id = $3`,
        [teacher, learner, tariff],
      ),
    ).rejects.toThrow(/no active link/)
  })

  it('re-grant after revoke clears revoked_at and refreshes granted_at', async () => {
    const teacher = await seedTeacher('lta-regrant-t')
    const learner = await seedLearner('lta-regrant-l')
    await seedLink(teacher, learner)
    const tariff = await seedTariff(teacher, 'lta-regrant-tariff')

    await grantLearnerTariffAccess(null, {
      teacherId: teacher,
      learnerAccountId: learner,
      tariffId: tariff,
    })
    await revokeLearnerTariffAccess(null, {
      teacherId: teacher,
      learnerAccountId: learner,
      tariffId: tariff,
    })
    const re = await grantLearnerTariffAccess(null, {
      teacherId: teacher,
      learnerAccountId: learner,
      tariffId: tariff,
      overrideAmountKopecks: 100000,
    })
    expect(re.revokedAt).toBeNull()
    expect(re.overrideAmountKopecks).toBe(100000)
  })
})
