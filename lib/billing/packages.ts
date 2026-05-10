// Billing wave PR 1 — packages catalog + purchases.
//
// Catalog (`lesson_packages`) is the operator-managed template:
// "10 lessons × 60 min for 35000₽". Per-account purchases
// (`package_purchases`) are the per-learner instances created by
// the webhook on `pay.processed` (PR 2 ships the writer).
//
// All economic fields on lesson_packages are immutable after first
// purchase via DB trigger (migration 0033).

import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

export type LessonPackage = {
  id: string
  slug: string
  titleRu: string
  descriptionRu: string | null
  durationMinutes: number
  count: number
  amountKopecks: number
  currency: string
  isActive: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string
}

const PACKAGE_COLS =
  'id, slug, title_ru, description_ru, duration_minutes, count, amount_kopecks, ' +
  'currency, is_active, display_order, created_at, updated_at'

function rowToPackage(row: Record<string, unknown>): LessonPackage {
  return {
    id: String(row.id),
    slug: String(row.slug),
    titleRu: String(row.title_ru),
    descriptionRu: row.description_ru ? String(row.description_ru) : null,
    durationMinutes: Number(row.duration_minutes),
    count: Number(row.count),
    amountKopecks: Number(row.amount_kopecks),
    currency: String(row.currency),
    isActive: Boolean(row.is_active),
    displayOrder: Number(row.display_order),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export async function listActivePackages(): Promise<LessonPackage[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS}
       from lesson_packages
      where is_active = true
      order by display_order asc, id asc`,
  )
  return result.rows.map((r) => rowToPackage(r as Record<string, unknown>))
}

export async function listActivePackagesByDuration(
  durationMinutes: number,
  limit = 3,
): Promise<LessonPackage[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS}
       from lesson_packages
      where is_active = true
        and duration_minutes = $1
      order by display_order asc, id asc
      limit $2`,
    [durationMinutes, Math.min(Math.max(limit, 1), 20)],
  )
  return result.rows.map((r) => rowToPackage(r as Record<string, unknown>))
}

export async function getPackageBySlug(slug: string): Promise<LessonPackage | null> {
  const pool = getDbPool()
  const result = await pool.query(
    `select ${PACKAGE_COLS} from lesson_packages where slug = $1`,
    [slug],
  )
  return result.rows[0] ? rowToPackage(result.rows[0]) : null
}

// Admin-side create. Used by the future /admin/packages catalog UI
// (PR 4). Validation lives at the call site; this just inserts.
export async function createPackage(input: {
  slug: string
  titleRu: string
  descriptionRu?: string | null
  durationMinutes: number
  count: number
  amountKopecks: number
  isActive?: boolean
  displayOrder?: number
}): Promise<LessonPackage> {
  const pool = getDbPool()
  const result = await pool.query(
    `insert into lesson_packages
       (slug, title_ru, description_ru, duration_minutes, count, amount_kopecks,
        is_active, display_order)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning ${PACKAGE_COLS}`,
    [
      input.slug,
      input.titleRu,
      input.descriptionRu ?? null,
      input.durationMinutes,
      input.count,
      input.amountKopecks,
      input.isActive ?? true,
      input.displayOrder ?? 100,
    ],
  )
  return rowToPackage(result.rows[0])
}

// ---------------------------------------------------------------------
// PURCHASES
// ---------------------------------------------------------------------

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
}

const PURCHASE_COLS =
  'id, account_id, package_id, payment_order_id, amount_kopecks, currency, ' +
  'title_snapshot, duration_minutes, count_initial, expires_at, created_at'

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
  },
): Promise<PackagePurchase | null> {
  const result = await client.query(
    `insert into package_purchases
       (account_id, package_id, payment_order_id, amount_kopecks, currency,
        title_snapshot, duration_minutes, count_initial, expires_at)
     values ($1, $2, $3, $4, 'RUB', $5, $6, $7, $8)
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

// Read-only: list this account's POSTPAID DEBT slots — slots that
// are completed/no_show_learner, not consumed from a package, and
// not yet paid via /checkout/?slot=. Used by /api/account/postpaid-debt
// and the cabinet "К оплате" section.
export type PostpaidDebtSlot = {
  slotId: string
  startAt: string
  durationMinutes: number
  status: string
  tariffId: string | null
  expectedAmountKopecks: number | null
  legacyGrandfathered: boolean
}

export async function listAccountPostpaidDebt(
  accountId: string,
): Promise<PostpaidDebtSlot[]> {
  const pool = getDbPool()
  const result = await pool.query(
    `select s.id, s.start_at, s.duration_minutes, s.status, s.tariff_id,
            t.amount_kopecks as expected_amount_kopecks,
            s.legacy_grandfathered
       from lesson_slots s
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.learner_account_id = $1
        and s.status in ('completed', 'no_show_learner')
        and not exists (
          select 1 from package_consumptions pc
           where pc.slot_id = s.id and pc.restored_at is null
        )
        and not exists (
          select 1 from payment_allocations pa
           join payment_orders po on po.invoice_id = pa.payment_order_id
          where pa.kind = 'lesson_slot'
            and pa.target_id = s.id::text
            and po.status = 'paid'
        )
      order by s.start_at desc`,
    [accountId],
  )
  return result.rows.map((r) => ({
    slotId: String(r.id),
    startAt: new Date(String(r.start_at)).toISOString(),
    durationMinutes: Number(r.duration_minutes),
    status: String(r.status),
    tariffId: r.tariff_id ? String(r.tariff_id) : null,
    expectedAmountKopecks:
      r.expected_amount_kopecks !== null && r.expected_amount_kopecks !== undefined
        ? Number(r.expected_amount_kopecks)
        : null,
    legacyGrandfathered: Boolean(r.legacy_grandfathered),
  }))
}

// Helper: does this account have a PENDING package order matching
// the given duration in the last 15 minutes? Used by the booking
// flow's pending-package gate (Codex round 2 HIGH 2).
export async function accountHasPendingPackageGrantForDuration(
  accountId: string,
  durationMinutes: number,
): Promise<boolean> {
  const pool = getDbPool()
  const result = await pool.query(
    `select 1
       from payment_orders
      where metadata->>'accountId' = $1::text
        and metadata->>'packageSlug' is not null
        and metadata->>'packageDurationMinutes' = $2::text
        and status in ('pending', '3ds_required')
        and created_at > now() - interval '15 minutes'
      limit 1`,
    [accountId, durationMinutes],
  )
  return result.rows.length > 0
}

