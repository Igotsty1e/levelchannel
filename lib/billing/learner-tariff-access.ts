// T3 Sub-PR A (2026-06-01) — learner_tariff_access helper.
//
// CRUD facade for the per-(teacher, learner, tariff) ACL row. Schema
// in migrations/0102_t3_tariffs_packages_learner_scope.sql.
//
// Plan: docs/plans/tariffs-packages-learner-scope.md.
//
// The DB BEFORE-INSERT/UPDATE trigger
// `learner_tariff_access_invariants` enforces two invariants:
//   (1) tariff owned by claimed teacher
//   (2) learner-teacher link active (skipped on revoke-only UPDATE)
// — callers do NOT need to pre-check these.

import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

export type LearnerTariffAccess = {
  teacherId: string
  learnerAccountId: string
  tariffId: string
  overrideAmountKopecks: number | null
  grantedAt: string
  grantedByAccountId: string | null
  revokedAt: string | null
}

type Row = {
  teacher_id: string
  learner_account_id: string
  tariff_id: string
  override_amount_kopecks: number | null
  granted_at: Date
  granted_by_account_id: string | null
  revoked_at: Date | null
}

function rowToAccess(r: Row): LearnerTariffAccess {
  return {
    teacherId: String(r.teacher_id),
    learnerAccountId: String(r.learner_account_id),
    tariffId: String(r.tariff_id),
    overrideAmountKopecks: r.override_amount_kopecks ?? null,
    grantedAt: r.granted_at.toISOString(),
    grantedByAccountId: r.granted_by_account_id
      ? String(r.granted_by_account_id)
      : null,
    revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
  }
}

/**
 * Grant or re-grant access for one (teacher, learner, tariff) triple.
 * Idempotent via ON CONFLICT: a re-grant after revoke clears
 * `revoked_at`, refreshes `granted_at`, and updates `granted_by`.
 * A pure override edit (junction-row active) preserves `granted_at`.
 */
export async function grantLearnerTariffAccess(
  client: PoolClient | null,
  args: {
    teacherId: string
    learnerAccountId: string
    tariffId: string
    overrideAmountKopecks?: number | null
    grantedByAccountId?: string | null
  },
): Promise<LearnerTariffAccess> {
  const q = client ?? getDbPool()
  const r = await q.query<Row>(
    `insert into learner_tariff_access
       (teacher_id, learner_account_id, tariff_id,
        override_amount_kopecks, granted_by_account_id)
     values ($1, $2, $3, $4, $5)
     on conflict (teacher_id, learner_account_id, tariff_id)
     do update set
       revoked_at = null,
       override_amount_kopecks = excluded.override_amount_kopecks,
       granted_at = case
         when learner_tariff_access.revoked_at is not null then now()
         else learner_tariff_access.granted_at
       end,
       granted_by_account_id = excluded.granted_by_account_id
     returning *`,
    [
      args.teacherId,
      args.learnerAccountId,
      args.tariffId,
      args.overrideAmountKopecks ?? null,
      args.grantedByAccountId ?? null,
    ],
  )
  return rowToAccess(r.rows[0])
}

/** Revoke an existing junction row. No-op if already revoked. */
export async function revokeLearnerTariffAccess(
  client: PoolClient | null,
  args: { teacherId: string; learnerAccountId: string; tariffId: string },
): Promise<LearnerTariffAccess | null> {
  const q = client ?? getDbPool()
  const r = await q.query<Row>(
    `update learner_tariff_access
        set revoked_at = now()
      where teacher_id = $1
        and learner_account_id = $2
        and tariff_id = $3
        and revoked_at is null
      returning *`,
    [args.teacherId, args.learnerAccountId, args.tariffId],
  )
  return r.rows[0] ? rowToAccess(r.rows[0]) : null
}

/** Read all active access rows for one (teacher, learner) pair. */
export async function listActiveTariffAccessForPair(
  teacherId: string,
  learnerAccountId: string,
): Promise<LearnerTariffAccess[]> {
  const r = await getDbPool().query<Row>(
    `select * from learner_tariff_access
      where teacher_id = $1
        and learner_account_id = $2
        and revoked_at is null
      order by granted_at asc`,
    [teacherId, learnerAccountId],
  )
  return r.rows.map(rowToAccess)
}
