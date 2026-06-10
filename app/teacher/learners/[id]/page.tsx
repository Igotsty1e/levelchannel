import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { LearnerPackagesCard } from '@/components/teacher/learners/learner-packages-card'
import { LearnerTariffAccessCard } from '@/components/teacher/learners/learner-tariff-access-card'
import { Button, EmptyState, Pill } from '@/components/ui/primitives'
import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listLearnerTariffAccessByTeacher } from '@/lib/billing/learner-tariff-access'
import { listPackagesByTeacher } from '@/lib/billing/packages/catalog'
import { listLearnerPackagesByTeacher } from '@/lib/billing/packages/purchases'
import { getDbPool } from '@/lib/db/pool'
import { listTariffsForTeacher } from '@/lib/pricing/tariffs'

import { PaymentMethodToggle } from './payment-method-toggle'
import { RenameLearnerForm } from './rename-form'
import UncompleteButton from './uncomplete-button'

// SAAS-PIVOT Epic 5A Day 5A — teacher learner-detail page.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 5 + §5 Day 5A.
//
// Lists every completion (lesson_completions) for the learner ×
// teacher pair, plus the outstanding balance (sum of completion
// amounts minus sum of allocated settlement coverage). The settle
// button is wired to a client action that POSTs to the (forthcoming
// Day-5B) settle route; this page surfaces the data needed for it.
//
// Server-side guards re-verify the learner is in the teacher's
// links — defense-in-depth against URL guessing. The layout already
// enforces teacher + verified.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Ученик — LevelChannel',
  robots: { index: false, follow: false },
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type CompletionRow = {
  id: string
  slotId: string
  startAt: string
  durationMinutes: number
  wasNoShow: boolean
  amountKopecks: number
  createdAt: string
  immutableAt: string | null
  coveredKopecks: number
}

type PageProps = { params: Promise<{ id: string }> }

export default async function TeacherLearnerDetailPage({ params }: PageProps) {
  const { id: learnerId } = await params
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  if (!UUID_PATTERN.test(learnerId)) {
    notFound()
  }
  const teacherId = session.account.id
  const pool = getDbPool()

  // Server-side guard: learner must be in the teacher's active links,
  // OR have any historical slot booked with this teacher (covers
  // unlinked-but-still-historical case).
  const guard = await pool.query<{ in_link: boolean; has_slot: boolean }>(
    `select
       exists (
         select 1 from learner_teacher_links
          where learner_account_id = $1
            and teacher_account_id = $2
            and unlinked_at is null
       ) as in_link,
       exists (
         select 1 from lesson_slots
          where teacher_account_id = $2
            and learner_account_id = $1
       ) as has_slot`,
    [learnerId, teacherId],
  )
  const ok = guard.rows[0]?.in_link === true || guard.rows[0]?.has_slot === true
  if (!ok) {
    notFound()
  }

  const learnerRow = await pool.query<{
    id: string
    email: string
    display_name: string | null
    first_name: string | null
    last_name: string | null
  }>(
    `select a.id, a.email, p.display_name, p.first_name, p.last_name
       from accounts a
       left join account_profiles p on p.account_id = a.id
      where a.id = $1`,
    [learnerId],
  )
  if (learnerRow.rows.length === 0) {
    notFound()
  }
  const learner = learnerRow.rows[0]
  const learnerNameForRender = formatProfileNameForRender({
    firstName: learner.first_name,
    lastName: learner.last_name,
    displayName: learner.display_name,
    fallbackEmail: learner.email,
  })

  // Completions for this teacher × learner. JOIN slots for start_at +
  // duration. LEFT JOIN settlement coverage so partially-settled rows
  // get the right balance.
  const completionsResult = await pool.query<{
    id: string
    slot_id: string
    start_at: string
    duration_minutes: number
    was_no_show: boolean
    amount_kopecks: number
    created_at: string
    immutable_at: string | null
    covered_kopecks: string | null
  }>(
    `select lc.id,
            lc.slot_id,
            s.start_at,
            s.duration_minutes,
            lc.was_no_show,
            lc.amount_kopecks,
            lc.created_at,
            lc.immutable_at,
            (
              select coalesce(sum(lsc.amount_kopecks), 0)::bigint
                from lesson_settlement_completions lsc
               where lsc.completion_id = lc.id
            ) as covered_kopecks
       from lesson_completions lc
       join lesson_slots s on s.id = lc.slot_id
      where lc.teacher_id = $1
        and s.learner_account_id = $2
      order by lc.created_at desc, lc.id desc`,
    [teacherId, learnerId],
  )

  // mig 0101 — read current payment_method для (teacher, learner) пары.
  // Default 'none' if no row.
  const billingPrefsResult = await pool.query<{ payment_method: string }>(
    `select payment_method from learner_billing_preferences
       where teacher_account_id = $1::uuid
         and learner_account_id = $2::uuid
       limit 1`,
    [teacherId, learnerId],
  )
  const currentPaymentMethod =
    (billingPrefsResult.rows[0]?.payment_method as
      | 'postpaid'
      | 'prepaid_packages'
      | 'none'
      | undefined) ?? 'none'

  // Plan v3 §3.3 — learner-card sections need:
  //   * the teacher's full active catalog (for the «Выдать пакет» and
  //     «Открыть доступ к тарифу» picker options)
  //   * this learner's active package_purchases and tariff_access rows
  // All 4 reads run in parallel via the helpers landed in Phase A.
  const [
    teacherPackages,
    teacherTariffs,
    learnerPackages,
    learnerTariffAccess,
  ] = await Promise.all([
    listPackagesByTeacher(teacherId),
    listTariffsForTeacher(teacherId),
    listLearnerPackagesByTeacher(teacherId, learnerId),
    listLearnerTariffAccessByTeacher(teacherId, learnerId),
  ])
  const availablePackages = teacherPackages
    .filter((p) => p.isActive)
    .map((p) => ({
      id: p.id,
      titleRu: p.titleRu,
      count: p.count,
      durationMinutes: p.durationMinutes,
      amountKopecks: p.amountKopecks,
    }))
  const availableTariffs = teacherTariffs
    .filter((t) => t.isActive)
    .map((t) => ({
      id: t.id,
      titleRu: t.titleRu,
      amountKopecks: t.amountKopecks,
      durationMinutes: t.durationMinutes,
    }))
  const packageRows = learnerPackages.map((p) => ({
    purchaseId: p.id,
    titleRu: p.titleRu,
    countRemaining: p.countRemaining,
    countInitial: p.countInitial,
    expiresAt: p.expiresAt,
    grantedAt: p.createdAt,
    hasActiveConsumptions: p.hasActiveConsumptions,
  }))

  const completions: CompletionRow[] = completionsResult.rows.map((r) => ({
    id: String(r.id),
    slotId: String(r.slot_id),
    startAt: new Date(String(r.start_at)).toISOString(),
    durationMinutes: Number(r.duration_minutes),
    wasNoShow: Boolean(r.was_no_show),
    amountKopecks: Number(r.amount_kopecks),
    createdAt: new Date(String(r.created_at)).toISOString(),
    immutableAt: r.immutable_at ? new Date(String(r.immutable_at)).toISOString() : null,
    coveredKopecks: r.covered_kopecks ? Number(r.covered_kopecks) : 0,
  }))

  const totalAmount = completions.reduce((s, c) => s + c.amountKopecks, 0)
  const totalCovered = completions.reduce((s, c) => s + c.coveredKopecks, 0)
  const balanceKopecks = totalAmount - totalCovered

  const fmtRub = (kopecks: number) =>
    `${(kopecks / 100).toLocaleString('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })} ₽`

  // Cabinet polish 2026-06-07 (B4) — unified date format per
  // docs/design-system.md §10.4: «7 июня, 19:00» (без года для текущего).
  const CURRENT_YEAR = new Date().getFullYear()
  const fmtLessonDate = (iso: string): string => {
    const d = new Date(iso)
    const dateOpts: Intl.DateTimeFormatOptions =
      d.getFullYear() === CURRENT_YEAR
        ? { day: 'numeric', month: 'long' }
        : { day: 'numeric', month: 'long', year: 'numeric' }
    const datePart = d.toLocaleDateString('ru-RU', dateOpts)
    const timePart = d.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    })
    return `${datePart}, ${timePart}`
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/teacher/learners"
          style={{ color: 'var(--secondary)', textDecoration: 'none', fontSize: 14 }}
        >
          ← Назад к ученикам
        </Link>
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        {learnerNameForRender}
      </h1>
      <p style={{ color: 'var(--secondary)', marginBottom: 24 }}>
        {learner.email}
      </p>

      <RenameLearnerForm
        learnerId={learnerId}
        initialFirstName={learner.first_name ?? ''}
        initialLastName={learner.last_name ?? ''}
        initialEmail={learner.email}
      />

<PaymentMethodToggle
        learnerId={learnerId}
        initialMethod={currentPaymentMethod}
      />

      {/* Plan v3 §3.3 — package + tariff-access management for this
          learner. Both sections are mounted unconditionally; they
          render their own EmptyState when the list is empty, with a
          context-aware CTA that points at /teacher/{packages,tariffs}
          if the teacher hasn't created anything yet. */}
      <LearnerPackagesCard
        teacherId={teacherId}
        learnerId={learnerId}
        learnerLabel={learnerNameForRender}
        rows={packageRows}
        availablePackages={availablePackages}
      />
      <LearnerTariffAccessCard
        teacherId={teacherId}
        learnerId={learnerId}
        learnerLabel={learnerNameForRender}
        rows={learnerTariffAccess}
        availableTariffs={availableTariffs}
      />

      <section
        style={{
          padding: 16,
          background: 'var(--surface-1)',
          borderRadius: 12,
          marginBottom: 24,
          border: '1px solid var(--border)',
        }}
      >
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          Баланс
        </h2>
        <div
          style={{
            fontSize: 24,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color:
              balanceKopecks > 0
                ? 'var(--danger)'
                : balanceKopecks < 0
                  ? 'var(--warning)'
                  : 'var(--text)',
          }}
        >
          {balanceKopecks > 0
            ? `Долг: ${fmtRub(balanceKopecks)}`
            : balanceKopecks < 0
              ? `Переплата: ${fmtRub(-balanceKopecks)}`
              : 'Долгов нет'}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            color: 'var(--secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          Всего проведено: {fmtRub(totalAmount)} · оплачено: {fmtRub(totalCovered)}
        </div>
        {balanceKopecks > 0 && (
          <div style={{ marginTop: 16 }}>
            <Button href={`/teacher/learners/${learnerId}/settle`}>
              Отметить оплату
            </Button>
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 12 }}>
          История занятий ({completions.length})
        </h2>
        {completions.length === 0 ? (
          <EmptyState
            title="Пока ничего не отмечено"
            body="Когда отметите занятие проведённым в календаре, оно появится здесь."
          />
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 4px',
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--secondary)',
                  }}
                >
                  Дата
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '8px 4px',
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--secondary)',
                  }}
                >
                  Статус
                </th>
                <th
                  style={{
                    textAlign: 'right',
                    padding: '8px 4px',
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--secondary)',
                  }}
                >
                  Стоимость
                </th>
                <th
                  style={{
                    textAlign: 'right',
                    padding: '8px 4px',
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--secondary)',
                  }}
                >
                  Оплачено
                </th>
                <th style={{ textAlign: 'right', padding: '8px 4px' }}></th>
              </tr>
            </thead>
            <tbody>
              {completions.map((c) => {
                const createdMs = new Date(c.createdAt).getTime()
                const elapsed = Date.now() - createdMs
                const isImmutable = c.immutableAt !== null || elapsed >= 48 * 60 * 60 * 1000
                const hasAnySettlement = c.coveredKopecks > 0
                const canUncomplete = !isImmutable && !hasAnySettlement
                return (
                  <tr
                    key={c.id}
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <td style={{ padding: '10px 4px', fontSize: 13 }}>
                      {fmtLessonDate(c.startAt)}
                    </td>
                    <td style={{ padding: '10px 4px' }}>
                      {c.wasNoShow ? (
                        <Pill tone="warning" size="sm">Не пришёл</Pill>
                      ) : (
                        <Pill tone="success" size="sm">Проведено</Pill>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 4px', fontSize: 13 }}>
                      {fmtRub(c.amountKopecks)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 4px', fontSize: 13 }}>
                      {fmtRub(c.coveredKopecks)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 4px' }}>
                      {canUncomplete ? (
                        <UncompleteButton completionId={c.id} />
                      ) : (
                        <span style={{ color: 'var(--text-tertiary, var(--secondary))', fontSize: 12 }}>
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
