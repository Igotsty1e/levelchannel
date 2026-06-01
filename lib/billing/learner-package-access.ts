// T3 Sub-PR A (2026-06-01) — learner_package_access helper.
//
// Symmetric to learner-tariff-access.ts. Schema in
// migrations/0102_t3_tariffs_packages_learner_scope.sql.

import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

export type LearnerPackageAccess = {
  teacherId: string
  learnerAccountId: string
  packageId: string
  overrideAmountKopecks: number | null
  priority: number
  grantedAt: string
  grantedByAccountId: string | null
  revokedAt: string | null
}

type Row = {
  teacher_id: string
  learner_account_id: string
  package_id: string
  override_amount_kopecks: number | null
  priority: number
  granted_at: Date
  granted_by_account_id: string | null
  revoked_at: Date | null
}

function rowToAccess(r: Row): LearnerPackageAccess {
  return {
    teacherId: String(r.teacher_id),
    learnerAccountId: String(r.learner_account_id),
    packageId: String(r.package_id),
    overrideAmountKopecks: r.override_amount_kopecks ?? null,
    priority: Number(r.priority),
    grantedAt: r.granted_at.toISOString(),
    grantedByAccountId: r.granted_by_account_id
      ? String(r.granted_by_account_id)
      : null,
    revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
  }
}

export async function grantLearnerPackageAccess(
  client: PoolClient | null,
  args: {
    teacherId: string
    learnerAccountId: string
    packageId: string
    overrideAmountKopecks?: number | null
    priority?: number
    grantedByAccountId?: string | null
  },
): Promise<LearnerPackageAccess> {
  const q = client ?? getDbPool()
  const r = await q.query<Row>(
    `insert into learner_package_access
       (teacher_id, learner_account_id, package_id,
        override_amount_kopecks, priority, granted_by_account_id)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (teacher_id, learner_account_id, package_id)
     do update set
       revoked_at = null,
       override_amount_kopecks = excluded.override_amount_kopecks,
       priority = excluded.priority,
       granted_at = case
         when learner_package_access.revoked_at is not null then now()
         else learner_package_access.granted_at
       end,
       granted_by_account_id = excluded.granted_by_account_id
     returning *`,
    [
      args.teacherId,
      args.learnerAccountId,
      args.packageId,
      args.overrideAmountKopecks ?? null,
      args.priority ?? 0,
      args.grantedByAccountId ?? null,
    ],
  )
  return rowToAccess(r.rows[0])
}

export async function revokeLearnerPackageAccess(
  client: PoolClient | null,
  args: { teacherId: string; learnerAccountId: string; packageId: string },
): Promise<LearnerPackageAccess | null> {
  const q = client ?? getDbPool()
  const r = await q.query<Row>(
    `update learner_package_access
        set revoked_at = now()
      where teacher_id = $1
        and learner_account_id = $2
        and package_id = $3
        and revoked_at is null
      returning *`,
    [args.teacherId, args.learnerAccountId, args.packageId],
  )
  return r.rows[0] ? rowToAccess(r.rows[0]) : null
}

export async function listActivePackageAccessForPair(
  teacherId: string,
  learnerAccountId: string,
): Promise<LearnerPackageAccess[]> {
  const r = await getDbPool().query<Row>(
    `select * from learner_package_access
      where teacher_id = $1
        and learner_account_id = $2
        and revoked_at is null
      order by granted_at asc`,
    [teacherId, learnerAccountId],
  )
  return r.rows.map(rowToAccess)
}
