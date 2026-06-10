// Wave 42 — per-account package purchases (package_purchases).
// Per-learner instances created by the webhook on `pay.processed`
// (Wave 12 wired the writer). Idempotent insert: UNIQUE on
// payment_order_id catches replays AND concurrent webhook deliveries.

import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

export type PackagePurchase = {
  id: string
  accountId: string
  packageId: string
  paymentOrderId: string
  amountKopecks: number
  currency: string
  titleSnapshot: string
  durationMinutes: number
  countInitial: number
  expiresAt: string
  createdAt: string
  // SAAS-PIVOT Epic 3 Day 4 (2026-05-22) — owning teacher (NOT NULL
  // post-mig-0076b). Denormalised from lesson_packages.teacher_id at
  // purchase time.
  teacherId: string
}

const PURCHASE_COLS =
  'id, account_id, package_id, payment_order_id, amount_kopecks, currency, ' +
  'title_snapshot, duration_minutes, count_initial, expires_at, created_at, ' +
  'teacher_id'

function rowToPurchase(row: Record<string, unknown>): PackagePurchase {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    packageId: String(row.package_id),
    paymentOrderId: String(row.payment_order_id),
    amountKopecks: Number(row.amount_kopecks),
    currency: String(row.currency),
    titleSnapshot: String(row.title_snapshot),
    durationMinutes: Number(row.duration_minutes),
    countInitial: Number(row.count_initial),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    teacherId: String(row.teacher_id),
  }
}

// Idempotent insert. Webhook calls this on `pay.processed` for a
// package order. UNIQUE on payment_order_id catches replays AND
// concurrent webhook deliveries — `ON CONFLICT DO NOTHING` returns
// 0 rows on a dup. Caller treats that as "already granted, no-op".
//
// Idempotent vs the consumption ledger: two purchases of the same
// package by the same learner are TWO purchases (different orders);
// the unique constraint is per-order, not per-(account, package).
export async function createPackagePurchase(
  client: PoolClient,
  input: {
    accountId: string
    packageId: string
    paymentOrderId: string
    amountKopecks: number
    titleSnapshot: string
    durationMinutes: number
    countInitial: number
    expiresAt: Date
    // SAAS-PIVOT Epic 3 Day 4 (2026-05-22): mig 0076b flipped
    // package_purchases.teacher_id NOT NULL. New callers pass it
    // explicitly (denormalised from the package row's owning teacher
    // — webhook + admin grant + teacher_grant all do this). Legacy
    // callers that omit it fall back to the package row's
    // teacher_id read in the same tx; if the package row has been
    // deleted (impossible — FK is ON DELETE RESTRICT), the underlying
    // NOT NULL constraint raises.
    teacherId?: string
  },
): Promise<PackagePurchase | null> {
  let teacherId = input.teacherId ?? null
  if (!teacherId) {
    const pkgRow = await client.query<{ teacher_id: string }>(
      `select teacher_id from lesson_packages where id = $1`,
      [input.packageId],
    )
    teacherId = pkgRow.rows[0]?.teacher_id ?? null
  }
  const result = await client.query(
    `insert into package_purchases
       (account_id, package_id, payment_order_id, amount_kopecks, currency,
        title_snapshot, duration_minutes, count_initial, expires_at, teacher_id)
     values ($1, $2, $3, $4, 'RUB', $5, $6, $7, $8, $9::uuid)
     on conflict (payment_order_id) do nothing
     returning ${PURCHASE_COLS}`,
    [
      input.accountId,
      input.packageId,
      input.paymentOrderId,
      input.amountKopecks,
      input.titleSnapshot,
      input.durationMinutes,
      input.countInitial,
      input.expiresAt.toISOString(),
      teacherId,
    ],
  )
  return result.rows[0] ? rowToPurchase(result.rows[0]) : null
}

// Read-only: list this account's purchases that are still active
// (`expires_at > now()`) and have at least one consumable unit
// remaining. Used by /api/account/packages and the cabinet "Мои
// пакеты" section.
export async function listAccountActivePackages(
  accountId: string,
): Promise<
  Array<PackagePurchase & { countRemaining: number; countConsumed: number }>
> {
  const pool = getDbPool()
  const result = await pool.query(
    `select pp.${PURCHASE_COLS.replace(/, /g, ', pp.')},
            pp.count_initial - (
              select count(*) from package_consumptions pc
               where pc.package_purchase_id = pp.id
                 and pc.restored_at is null
            ) as count_remaining,
            (
              select count(*) from package_consumptions pc
               where pc.package_purchase_id = pp.id
                 and pc.restored_at is null
            ) as count_consumed
       from package_purchases pp
      where pp.account_id = $1
        and pp.expires_at > now()
        -- Refund Phase 7 follow-up. Voided purchases hide from cabinet
        -- "Мои пакеты" — the learner shouldn't see a refunded package
        -- with restored units as if it were still available.
        and pp.voided_at is null
      order by pp.expires_at asc, pp.id`,
    [accountId],
  )
  return result.rows
    .map((row) => {
      const purchase = rowToPurchase(row as Record<string, unknown>)
      const countRemaining = Number(
        (row as Record<string, unknown>).count_remaining,
      )
      const countConsumed = Number(
        (row as Record<string, unknown>).count_consumed,
      )
      return { ...purchase, countRemaining, countConsumed }
    })
    .filter((p) => p.countRemaining > 0)
}

// Package issuance UX (plan 2026-06-10 v3) — list one learner's
// active purchases owned by this teacher, augmented with the
// `hasActiveConsumptions` flag so the UI can disable the `[Отозвать]`
// button when revoking would orphan booked slots. (R7-3, R15-6.)
//
// Used by `/teacher/learners/[id]` LearnerPackagesSection.
export async function listLearnerPackagesByTeacher(
  teacherId: string,
  learnerAccountId: string,
): Promise<
  Array<
    PackagePurchase & {
      countRemaining: number
      countConsumed: number
      hasActiveConsumptions: boolean
      titleRu: string
    }
  >
> {
  const pool = getDbPool()
  const result = await pool.query(
    `select pp.${PURCHASE_COLS.replace(/, /g, ', pp.')},
            lp.title_ru as title_ru,
            pp.count_initial - coalesce(consumed.n, 0) as count_remaining,
            coalesce(consumed.n, 0) as count_consumed,
            coalesce(active.n, 0) > 0 as has_active_consumptions
       from package_purchases pp
       join lesson_packages lp on lp.id = pp.package_id
       left join lateral (
         select count(*)::int as n
           from package_consumptions pc
          where pc.package_purchase_id = pp.id
            and pc.restored_at is null
       ) consumed on true
       left join lateral (
         select count(*)::int as n
           from package_consumptions pc
           join lesson_slots ls on ls.id = pc.slot_id
          where pc.package_purchase_id = pp.id
            and pc.restored_at is null
            and ls.status in ('open', 'booked')
            and ls.start_at > now()
       ) active on true
      where pp.teacher_id = $1::uuid
        and pp.account_id = $2::uuid
        and pp.expires_at > now()
        and pp.voided_at is null
      order by pp.expires_at asc, pp.id`,
    [teacherId, learnerAccountId],
  )
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>
    const purchase = rowToPurchase(r)
    return {
      ...purchase,
      titleRu: String(r.title_ru),
      countRemaining: Number(r.count_remaining),
      countConsumed: Number(r.count_consumed),
      hasActiveConsumptions: Boolean(r.has_active_consumptions),
    }
  })
}

// Single aggregated SQL that returns the distinct learner-count for
// EVERY package owned by this teacher. Used by the catalog tile
// footer pill «Выдан N ученикам» without N round-trips. (R8-3.)
export async function aggregateActiveLearnersByPackage(
  teacherId: string,
): Promise<Map<string, number>> {
  const pool = getDbPool()
  const r = await pool.query<{ package_id: string; n: string }>(
    `select pp.package_id, count(distinct pp.account_id)::text as n
       from package_purchases pp
      where pp.teacher_id = $1::uuid
        and pp.expires_at > now()
        and pp.voided_at is null
      group by pp.package_id`,
    [teacherId],
  )
  const out = new Map<string, number>()
  for (const row of r.rows) out.set(row.package_id, Number(row.n))
  return out
}

// PKG-RECON RECON.1 — bulk load purchases by id for admin payment
// detail rendering. Used by `app/admin/(gated)/payments/[invoiceId]`
// to surface `title_snapshot` + `count_initial` + `duration_minutes`
// for `payment_allocations.kind='package'` rows (instead of the raw
// UUID). Returns a Map for cheap lookup.
export async function listPackagePurchasesByIds(
  ids: string[],
): Promise<Map<string, PackagePurchase>> {
  if (ids.length === 0) return new Map()
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PURCHASE_COLS}
       from package_purchases
      where id = any($1::uuid[])`,
    [ids],
  )
  const map = new Map<string, PackagePurchase>()
  for (const row of result.rows) {
    const purchase = rowToPurchase(row as Record<string, unknown>)
    map.set(purchase.id, purchase)
  }
  return map
}

// Helper: does this account have a PENDING package order matching
// the given duration in the last 15 minutes? Used by the booking
// flow's pending-package gate (Codex round 2 HIGH 2).
//
// PKG-TEACHER-SCOPE (2026-06-01): teacherId is now passed by callers
// so a pending 60-min package order from teacher A doesn't falsely
// block a checkout/booking related to teacher B's 60-min package.
// The mig 0094 NOT NULL teacher_account_id column gives us a direct
// predicate. Optional for backward compat.
export async function accountHasPendingPackageGrantForDuration(
  accountId: string,
  durationMinutes: number,
  teacherId?: string,
): Promise<boolean> {
  const pool = getDbPool()
  const result = await pool.query(
    `select 1
       from payment_orders
      where metadata->>'accountId' = $1::text
        and metadata->>'packageSlug' is not null
        and metadata->>'packageDurationMinutes' = $2::text
        and ($3::uuid is null or teacher_account_id = $3::uuid)
        and status in ('pending', '3ds_required')
        and created_at > now() - interval '15 minutes'
      limit 1`,
    [accountId, durationMinutes, teacherId ?? null],
  )
  return result.rows.length > 0
}
