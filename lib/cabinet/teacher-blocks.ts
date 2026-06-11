// SAAS-PIVOT Epic 7 Day 7 — per-teacher block data fetcher for the
// multi-teacher cabinet view.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 7 + §5 Day 7.
//
// Given a learner and the resolved set of active teacher account_ids
// (caller already ran `getActiveTeacherIdsForLearner`), batch-fetch the
// per-teacher render payload:
//   - teacher display name + email (label fallback)
//   - upcoming booked slot count (next 7 days, status='booked', start
//     in the future) — small list for the inline summary, not the full
//     timeline (which `listSlotsForLearner` already returns merged)
//   - balance owed (kopecks) — sum of `pricing_tariffs.amount_kopecks`
//     across this learner's debt slots scoped to THIS teacher. Uses the
//     same predicate as `listAccountPostpaidDebt` from
//     lib/billing/packages/debt.ts to stay aligned with /cabinet's "К
//     оплате" surface. Day 5B will rewrite that predicate to consume
//     `lesson_completions` — this helper consumes the SAME source so it
//     auto-migrates when Day 5B lands.
//   - active package count (own purchases). Per-teacher since mig
//     0089 flipped `package_purchases.teacher_id` NOT NULL and the
//     security-audit HIGH-3 closure (2026-05-23) updated this helper
//     to GROUP BY teacher_id. Previous v0 (pre-2026-05-23) returned
//     the learner-WIDE count for every teacher block, which leaked
//     cross-tenant information ("Teacher A has 3 active packages"
//     when 2 of them were Teacher B's).
//
// Why a single helper not 4× separate queries: the cabinet page already
// awaits 7+ promises in parallel for v1. Adding 4×N more (where N =
// teacher count) would balloon the SSR latency. This helper batches:
//   - one accounts/profiles fetch for ALL teacher ids
//   - one slot-summary query keyed on (learner, teacher_id)
//   - one debt-summary query keyed on (learner, teacher_id)
// resulting in 3 round-trips total regardless of N.
//
// Read-only. No mutations. SSR-safe (no client imports).

import { getAuthPool } from '@/lib/auth/pool'
import type { PaymentMethod } from '@/lib/billing/learner-payment-method'
import { getDbPool } from '@/lib/db/pool'

export type TeacherBlock = {
  teacherId: string
  teacherDisplayName: string
  // Upcoming booked slots scoped to THIS (learner, teacher) pair, next
  // 7 days, ordered by start_at asc. Capped at 5 — the unified timeline
  // section above is the authoritative full list; this is a "что у
  // тебя с этим учителем" inline preview.
  upcomingSlots: Array<{
    slotId: string
    startAt: string
    durationMinutes: number
    tariffTitleRu: string | null
  }>
  // Sum of tariff amounts for this learner's debt slots scoped to
  // this teacher. Mirrors the `listAccountPostpaidDebt` predicate.
  balanceOwedKopecks: number
  debtSlotCount: number
  // Active package count for THIS (learner, teacher) pair. Per-teacher
  // since security-audit HIGH-3 closure (2026-05-23). Counts non-voided
  // unexpired purchases owned by THIS teacher with remaining units.
  activePackageCount: number
  // Bug #1 (2026-06-02). Per-pair payment method from
  // `learner_billing_preferences`. Default 'none' when no row exists
  // (matches `getPaymentMethodForPair`'s contract). The cabinet uses
  // this to render the «учитель не выбрал способ оплаты» banner above
  // the per-block «Записаться» CTA. Plan: docs/plans/bug-1-payment-
  // method-banner.md.
  paymentMethod: PaymentMethod
}

export async function loadTeacherBlocks(
  learnerAccountId: string,
  teacherIds: string[],
): Promise<TeacherBlock[]> {
  if (teacherIds.length === 0) return []

  const authPool = getAuthPool()
  const dbPool = getDbPool()

  // 1. Resolve teacher display labels in one query.
  const teacherRows = await authPool.query<{
    id: string
    email: string
    display_name: string | null
    first_name: string | null
    last_name: string | null
  }>(
    `select a.id, a.email, p.display_name, p.first_name, p.last_name
       from accounts a
       left join account_profiles p on p.account_id = a.id
      where a.id = any($1::uuid[])`,
    [teacherIds],
  )
  // TASK-5 (mig 0095) — first/last name preferred, then display_name,
  // then email.
  const { formatProfileNameForRender } = await import(
    '@/lib/auth/profile-name'
  )
  const teacherLabel = new Map<string, string>()
  for (const r of teacherRows.rows) {
    const label = formatProfileNameForRender({
      firstName: r.first_name ? String(r.first_name) : null,
      lastName: r.last_name ? String(r.last_name) : null,
      displayName: r.display_name ? String(r.display_name) : null,
      fallbackEmail: String(r.email),
    })
    teacherLabel.set(String(r.id), label)
  }

  // 2. Upcoming booked slots per (learner, teacher), next 7 days.
  const upcomingRows = await dbPool.query<{
    id: string
    teacher_account_id: string
    start_at: string
    duration_minutes: number
    tariff_title_ru: string | null
  }>(
    `select s.id,
            s.teacher_account_id,
            s.start_at,
            s.duration_minutes,
            t.title_ru as tariff_title_ru
       from lesson_slots s
       left join pricing_tariffs t on t.id = s.tariff_id
      where s.learner_account_id = $1
        and s.teacher_account_id = any($2::uuid[])
        and s.status = 'booked'
        and s.start_at >= now()
        and s.start_at < now() + interval '7 days'
      order by s.start_at asc`,
    [learnerAccountId, teacherIds],
  )

  const upcomingByTeacher = new Map<string, TeacherBlock['upcomingSlots']>()
  for (const id of teacherIds) upcomingByTeacher.set(id, [])
  for (const r of upcomingRows.rows) {
    const arr = upcomingByTeacher.get(String(r.teacher_account_id))
    if (!arr) continue
    if (arr.length >= 5) continue
    arr.push({
      slotId: String(r.id),
      startAt: new Date(String(r.start_at)).toISOString(),
      durationMinutes: Number(r.duration_minutes),
      tariffTitleRu: r.tariff_title_ru ? String(r.tariff_title_ru) : null,
    })
  }
  // 3. Debt aggregate per teacher. Mirrors lib/billing/packages/debt.ts
  // `listAccountPostpaidDebt` predicate, grouped by teacher_account_id.
  // Day 5B will switch the underlying predicate to consume
  // `lesson_completions`; this CTE auto-follows when that file ships.
  const debtRows = await dbPool.query<{
    teacher_account_id: string
    total_debt_kopecks: string | number | null
    slot_count: number
  }>(
    // T3 Sub-PR B (2026-06-01) R1-WARN#1 closure: debt aggregate reads
    // snapshot first (frozen at booking time, mig 0102 §d). Fallback to
    // live tariff preserves behavior for legacy rows the backfill missed.
    `select s.teacher_account_id,
            coalesce(sum(coalesce(s.snapshot_amount_kopecks, t.amount_kopecks)), 0)::bigint as total_debt_kopecks,
            count(*)::int as slot_count
       from lesson_slots s
       left join pricing_tariffs t
              on t.id = s.tariff_id and t.is_active = true
      where s.learner_account_id = $1
        and s.teacher_account_id = any($2::uuid[])
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
            and (
              select coalesce(sum(par.refunded_kopecks), 0)::bigint
                from payment_allocation_reversals par
               where par.payment_order_id = pa.payment_order_id
                 and par.kind = pa.kind
                 and par.target_id = pa.target_id
            ) < pa.amount_kopecks
        )
      group by s.teacher_account_id`,
    [learnerAccountId, teacherIds],
  )

  const debtByTeacher = new Map<
    string,
    { totalDebtKopecks: number; slotCount: number }
  >()
  for (const id of teacherIds) {
    debtByTeacher.set(id, { totalDebtKopecks: 0, slotCount: 0 })
  }
  for (const r of debtRows.rows) {
    debtByTeacher.set(String(r.teacher_account_id), {
      totalDebtKopecks: Number(r.total_debt_kopecks ?? 0),
      slotCount: Number(r.slot_count ?? 0),
    })
  }

  // 4. Active package count — per (learner, teacher). HIGH-3 closure
  // (2026-05-23): mig 0089 flipped `package_purchases.teacher_id` NOT
  // NULL and the previous learner-wide query leaked the same count
  // into every teacher block. Same `expires_at`/`voided_at`/units-
  // remaining predicate as `listAccountActivePackages`, plus
  // `teacher_id = $teacher`, GROUP BY teacher_id.
  //
  // Defensive nullability: `expires_at` is nullable on the schema, so
  // we accept rows where `expires_at IS NULL` (no expiry) — matches
  // the audit's spec literal. The previous learner-wide query relied
  // on `expires_at > now()` which silently dropped null-expiry rows;
  // the per-teacher branch keeps the bug closed by including them.
  const pkgRows = await dbPool.query<{
    teacher_id: string
    count: number
  }>(
    `select pp.teacher_id::text as teacher_id, count(*)::int as count
       from package_purchases pp
      where pp.account_id = $1
        and pp.teacher_id = any($2::uuid[])
        and pp.voided_at is null
        and (pp.expires_at is null or pp.expires_at > now())
        and (pp.count_initial - (
          select count(*) from package_consumptions pc
           where pc.package_purchase_id = pp.id
             and pc.restored_at is null
        )) > 0
      group by pp.teacher_id`,
    [learnerAccountId, teacherIds],
  )
  const activePackageCountByTeacher = new Map<string, number>()
  for (const id of teacherIds) activePackageCountByTeacher.set(id, 0)
  for (const r of pkgRows.rows) {
    activePackageCountByTeacher.set(
      String(r.teacher_id),
      Number(r.count ?? 0),
    )
  }

  // 5. Per-pair payment method (Bug #1, 2026-06-02). Same SoT as the
  // booking-side `getPaymentMethodForPair` helper — keep the predicate
  // single. `learner_billing_preferences` lives in the main DB (mig
  // 0101), so this query goes through `dbPool`, not `authPool`. A
  // missing row collapses to 'none' to match the helper's default.
  const paymentMethodRows = await dbPool.query<{
    teacher_account_id: string
    payment_method: string
  }>(
    `select teacher_account_id, payment_method
       from learner_billing_preferences
      where learner_account_id = $1::uuid
        and teacher_account_id = any($2::uuid[])`,
    [learnerAccountId, teacherIds],
  )
  const paymentMethodByTeacher = new Map<string, PaymentMethod>()
  for (const id of teacherIds) paymentMethodByTeacher.set(id, 'none')
  for (const r of paymentMethodRows.rows) {
    const raw = String(r.payment_method)
    // epic-b Sub-PR B.1 (2026-06-11): dropped 'prepaid_packages';
    // legacy rows after migration 0126 = 'postpaid'.
    if (raw === 'postpaid' || raw === 'none') {
      paymentMethodByTeacher.set(String(r.teacher_account_id), raw)
    }
    // Unknown / future enum values silently collapse to the existing
    // 'none' default — better to over-block than to under-block.
  }

  // 6. Assemble blocks in the order teacherIds was given (caller's
  // contract: linked_at asc from getActiveTeacherIdsForLearner).
  return teacherIds.map((teacherId) => {
    const debt = debtByTeacher.get(teacherId) ?? {
      totalDebtKopecks: 0,
      slotCount: 0,
    }
    return {
      teacherId,
      teacherDisplayName:
        teacherLabel.get(teacherId) ?? 'учитель',
      upcomingSlots: upcomingByTeacher.get(teacherId) ?? [],
      balanceOwedKopecks: debt.totalDebtKopecks,
      debtSlotCount: debt.slotCount,
      activePackageCount: activePackageCountByTeacher.get(teacherId) ?? 0,
      paymentMethod: paymentMethodByTeacher.get(teacherId) ?? 'none',
    }
  })
}
