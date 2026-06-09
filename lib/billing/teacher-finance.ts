/**
 * Teacher finance snapshot for the cabinet home page.
 *
 * Plan: docs/plans/finance-on-teacher-home-2026-06-09.md
 *
 * Returns the 4 numbers shown at-a-glance on `/teacher`. Deliberately
 * lightweight (4 small SELECTs, in parallel) — refreshes on every
 * page render. If load profile changes, add a 60s in-memory cache
 * keyed by teacher id.
 *
 * SOURCES OF TRUTH (per plan §6 owner Q1=a):
 *   - thisMonth.confirmed = SUM(payment_claims.amount_kopecks)
 *     WHERE status='confirmed' AND resolved_at >= local-month-start.
 *     Reflects cash-in-hand, mirrors what /teacher/payments tab shows.
 *   - lastMonth = same query, shifted one month back.
 *   - unpaid.totalKopecks + learnerCount = reuse listLearnersWithUnpaidSlots.
 *   - unpaid.oldestDaysOverdue = oldest unpaid lesson_slot.start_at age.
 *   - activePackages.sumOfRemainingKopecks =
 *       SUM((count_initial - consumed) * amount_kopecks / count_initial)
 *       per non-expired non-voided package.
 *   - expected this week = reuse getTeacherCalendarSummary's
 *     weekEarningsKopecks (booked slots × snapshot price).
 */

import { getDbPool } from '@/lib/db/pool'
import { getTeacherCalendarSummary } from '@/lib/calendar/summary'
import { listLearnersWithUnpaidSlots } from '@/lib/payments/sbp-claims'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const EXPIRING_PACKAGE_DAYS = 14
const LOW_LESSONS_THRESHOLD = 2

export type TeacherFinanceSnapshot = {
  thisMonth: {
    confirmedKopecks: number
    claimsCount: number
    monthLabel: string
    deltaPercent: number | null
  }
  unpaid: {
    totalKopecks: number
    learnerCount: number
    oldestDaysOverdue: number
  }
  activePackages: {
    sumOfRemainingKopecks: number
    learnersWithPackages: number
    expiringSoonCount: number
  }
  expectedThisWeek: {
    kopecks: number
    bookedSlotsCount: number
  }
}

function monthStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function monthLabelRu(date: Date): string {
  const month = date.toLocaleString('ru-RU', { month: 'long', timeZone: 'UTC' })
  return `${month} ${date.getUTCFullYear()}`
}

async function fetchMonthlyConfirmed(
  teacherAccountId: string,
  fromIso: string,
  toIso: string,
): Promise<{ kopecks: number; count: number }> {
  const r = await getDbPool().query<{ kopecks: string; count: string }>(
    `select coalesce(sum(amount_kopecks), 0)::text as kopecks,
            count(*)::text as count
       from payment_claims
      where teacher_account_id = $1::uuid
        and status = 'confirmed'
        and resolved_at >= $2::timestamptz
        and resolved_at < $3::timestamptz`,
    [teacherAccountId, fromIso, toIso],
  )
  return {
    kopecks: Number(r.rows[0]?.kopecks ?? '0'),
    count: Number(r.rows[0]?.count ?? '0'),
  }
}

async function fetchActivePackages(teacherAccountId: string): Promise<{
  sumOfRemainingKopecks: number
  learnersWithPackages: number
  expiringSoonCount: number
}> {
  const r = await getDbPool().query<{
    learner_id: string
    amount_kopecks: number
    count_initial: number
    count_remaining: string
    expires_at: string
  }>(
    `select pp.account_id as learner_id,
            pp.amount_kopecks,
            pp.count_initial,
            (pp.count_initial - coalesce((
              select count(*) from package_consumptions pc
               where pc.package_purchase_id = pp.id
                 and pc.restored_at is null
            ), 0))::text as count_remaining,
            pp.expires_at::text as expires_at
       from package_purchases pp
      where pp.teacher_id = $1::uuid
        and pp.voided_at is null
        and pp.expires_at > now()`,
    [teacherAccountId],
  )
  let sumRemaining = 0
  const learnerSet = new Set<string>()
  let expiringSoon = 0
  const now = Date.now()
  const cutoff14d = now + EXPIRING_PACKAGE_DAYS * MS_PER_DAY
  for (const row of r.rows) {
    const remaining = Number(row.count_remaining)
    if (remaining <= 0) continue
    const perLesson = row.amount_kopecks / Math.max(1, row.count_initial)
    sumRemaining += Math.round(perLesson * remaining)
    learnerSet.add(row.learner_id)
    const expiresMs = new Date(row.expires_at).getTime()
    if (expiresMs <= cutoff14d || remaining <= LOW_LESSONS_THRESHOLD) {
      expiringSoon += 1
    }
  }
  return {
    sumOfRemainingKopecks: sumRemaining,
    learnersWithPackages: learnerSet.size,
    expiringSoonCount: expiringSoon,
  }
}

async function fetchOldestUnpaidDays(
  teacherAccountId: string,
): Promise<number> {
  // Cheapest signal: how many days has the oldest unpaid booked slot
  // been past its start_at? listLearnersWithUnpaidSlots returns the
  // structured list but does not surface this; rather than thread a
  // new shape, we run a tiny side-query.
  const r = await getDbPool().query<{ oldest: string | null }>(
    `select extract(epoch from (now() - min(ls.start_at))) as oldest
       from lesson_slots ls
      where ls.teacher_account_id = $1::uuid
        and ls.status in ('completed', 'no_show')
        and ls.start_at < now()
        and not exists (
          select 1 from payment_claim_items pci
            join payment_claims pc on pc.id = pci.claim_id
           where pci.slot_id = ls.id
             and pc.status in ('claimed', 'confirmed')
        )
        and not exists (
          select 1 from package_consumptions pcn
           where pcn.slot_id = ls.id
             and pcn.restored_at is null
        )`,
    [teacherAccountId],
  )
  const seconds = Number(r.rows[0]?.oldest ?? 0)
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.floor(seconds / (24 * 60 * 60))
}

export async function getTeacherFinanceSnapshot(
  teacherAccountId: string,
  todayYmd: string,
): Promise<TeacherFinanceSnapshot> {
  const now = new Date()
  const thisMonthStart = monthStartUtc(now)
  const nextMonthStart = monthStartUtc(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  )
  const lastMonthStart = monthStartUtc(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
  )

  const [
    thisMonth,
    lastMonth,
    unpaidLearners,
    oldestDays,
    packages,
    calendar,
  ] = await Promise.all([
    fetchMonthlyConfirmed(
      teacherAccountId,
      thisMonthStart.toISOString(),
      nextMonthStart.toISOString(),
    ),
    fetchMonthlyConfirmed(
      teacherAccountId,
      lastMonthStart.toISOString(),
      thisMonthStart.toISOString(),
    ),
    listLearnersWithUnpaidSlots(teacherAccountId),
    fetchOldestUnpaidDays(teacherAccountId),
    fetchActivePackages(teacherAccountId),
    getTeacherCalendarSummary(teacherAccountId, todayYmd),
  ])

  const unpaidTotal = unpaidLearners.reduce((acc, r) => acc + r.unpaidAmount, 0)
  let deltaPercent: number | null = null
  if (lastMonth.kopecks > 0) {
    deltaPercent = Math.round(
      ((thisMonth.kopecks - lastMonth.kopecks) / lastMonth.kopecks) * 100,
    )
  }

  return {
    thisMonth: {
      confirmedKopecks: thisMonth.kopecks,
      claimsCount: thisMonth.count,
      monthLabel: monthLabelRu(now),
      deltaPercent,
    },
    unpaid: {
      totalKopecks: unpaidTotal,
      learnerCount: unpaidLearners.length,
      oldestDaysOverdue: oldestDays,
    },
    activePackages: packages,
    expectedThisWeek: {
      kopecks: calendar.weekEarningsKopecks ?? 0,
      bookedSlotsCount: calendar.weekBookedCount ?? 0,
    },
  }
}
