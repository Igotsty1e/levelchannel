import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { Button, EmptyState, Pill } from '@/components/ui/primitives'
import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getDbPool } from '@/lib/db/pool'
import { formatDateInTz, formatTimeInTz } from '@/lib/util/format-date'

// SAAS-PIVOT Epic 5B Day 5B — teacher settle page.
//
// Plan: docs/plans/saas-pivot-master.md §5 Day 5B.
//
// GET: list outstanding completions FIFO with a checkbox per row + a
// total-amount input. The form POSTs to
// /api/teacher/learners/[id]/settle, which performs the actual
// `settleLessons()` call and 303-redirects back to the parent
// learner-detail page on success.
//
// Partial-sum support per Q-3 owner decision: amountKopecks is the
// total the learner just paid. If completionIds are checked, the
// budget is allocated across that explicit set in FIFO order; if
// nothing is checked, the helper walks ALL outstanding completions in
// the same order. The helper drains the budget; any remainder is
// recorded as `unallocatedKopecks` (overpayment).
//
// Server-side guards mirror /teacher/learners/[id]: learner must be in
// active links OR have any historical slot with this teacher.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Отметить оплату — LevelChannel',
  robots: { index: false, follow: false },
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type OutstandingRow = {
  id: string
  startAt: string
  wasNoShow: boolean
  amountKopecks: number
  coveredKopecks: number
  remainingKopecks: number
}

type PageProps = { params: Promise<{ id: string }> }

export default async function TeacherSettlePage({ params }: PageProps) {
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

  // FIFO list (oldest first) of completions that still have remaining
  // balance. Mirrors the candidate query in settleLessons so the UI
  // shows exactly the rows the helper would walk.
  const outstandingResult = await pool.query<{
    id: string
    start_at: string
    was_no_show: boolean
    amount_kopecks: number
    covered_kopecks: string | null
  }>(
    `select lc.id,
            s.start_at,
            lc.was_no_show,
            lc.amount_kopecks,
            (
              select coalesce(sum(lsc.amount_kopecks), 0)::bigint
                from lesson_settlement_completions lsc
               where lsc.completion_id = lc.id
            ) as covered_kopecks
       from lesson_completions lc
       join lesson_slots s on s.id = lc.slot_id
      where lc.teacher_id = $1
        and s.learner_account_id = $2
      order by lc.created_at asc, lc.id asc`,
    [teacherId, learnerId],
  )

  const outstanding: OutstandingRow[] = outstandingResult.rows
    .map((r) => {
      const amount = Number(r.amount_kopecks)
      const covered = r.covered_kopecks ? Number(r.covered_kopecks) : 0
      return {
        id: String(r.id),
        startAt: new Date(String(r.start_at)).toISOString(),
        wasNoShow: Boolean(r.was_no_show),
        amountKopecks: amount,
        coveredKopecks: covered,
        remainingKopecks: Math.max(0, amount - covered),
      }
    })
    .filter((r) => r.remainingKopecks > 0)

  const totalRemaining = outstanding.reduce(
    (s, r) => s + r.remainingKopecks,
    0,
  )

  const fmtRub = (kopecks: number) =>
    `${(kopecks / 100).toLocaleString('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })} ₽`

  // Cabinet polish 2026-06-07 (B5) — unified date format «7 июня, 19:00».
  // 2026-06-17 fix: явный timeZone MSK через formatDateInTz/formatTimeInTz —
  // раньше на сервере вне MSK время плыло.
  const fmtLessonDate = (iso: string): string => {
    return `${formatDateInTz(iso, 'Europe/Moscow')}, ${formatTimeInTz(iso, 'Europe/Moscow')}`
  }

  const totalRemainingRub = (totalRemaining / 100).toFixed(2)

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/teacher/learners/${learnerId}`}
          style={{
            color: 'var(--secondary)',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          ← Назад к ученику
        </Link>
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 8 }}>
        Отметить оплату
      </h1>
      <p style={{ color: 'var(--secondary)', marginBottom: 24 }}>
        {learnerNameForRender} · долг{' '}
        <strong
          style={{
            color: totalRemaining > 0 ? 'var(--danger)' : 'var(--text)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmtRub(totalRemaining)}
        </strong>
      </p>

      {outstanding.length === 0 ? (
        <EmptyState
          title="Долгов нет"
          body="Все проведённые занятия оплачены."
          action={
            <Button variant="secondary" href={`/teacher/learners/${learnerId}`}>
              Вернуться к ученику
            </Button>
          }
        />
      ) : (
        <form
          method="post"
          action={`/api/teacher/learners/${learnerId}/settle`}
          style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          {/* 2026-06-17 UX fix: ввод в рублях (с дробной частью), не в
              копейках. Серверный route принимает поле amountRub. */}
          <div>
            <label
              htmlFor="amountRub"
              style={{
                display: 'block',
                fontWeight: 600,
                marginBottom: 4,
                fontSize: 14,
              }}
            >
              Сумма оплаты, ₽
            </label>
            <input
              id="amountRub"
              name="amountRub"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              defaultValue={totalRemainingRub}
              required
              style={{
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 14,
                width: '100%',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                fontVariantNumeric: 'tabular-nums',
              }}
            />
            <p
              style={{
                fontSize: 12,
                color: 'var(--secondary)',
                marginTop: 4,
              }}
            >
              По умолчанию — полный долг {totalRemainingRub} ₽. Можно
              указать частичную сумму с копейками (например 2150,50).
            </p>
          </div>

          <div>
            <p
              style={{
                fontWeight: 600,
                marginBottom: 8,
                fontSize: 14,
              }}
            >
              Покрыть конкретные занятия
            </p>
            <p
              style={{
                fontSize: 12,
                color: 'var(--secondary)',
                marginBottom: 8,
              }}
            >
              Без выбора — оплата ляжет на самые старые занятия по очереди.
              С выбором — только на отмеченные.
            </p>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ width: 32 }}></th>
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
                    Уже оплачено
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
                    Остаток
                  </th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((row) => (
                  <tr
                    key={row.id}
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <td style={{ padding: '10px 4px' }}>
                      <input
                        type="checkbox"
                        name="completionId"
                        value={row.id}
                        aria-label={`Покрыть занятие ${fmtLessonDate(row.startAt)}`}
                      />
                    </td>
                    <td style={{ padding: '10px 4px', fontSize: 13 }}>
                      {fmtLessonDate(row.startAt)}
                    </td>
                    <td style={{ padding: '10px 4px', fontSize: 13 }}>
                      {row.wasNoShow ? (
                        <Pill tone="warning" size="sm">Не пришёл</Pill>
                      ) : (
                        <Pill tone="success" size="sm">Проведено</Pill>
                      )}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 4px',
                        fontSize: 13,
                      }}
                    >
                      {fmtRub(row.amountKopecks)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 4px',
                        fontSize: 13,
                      }}
                    >
                      {fmtRub(row.coveredKopecks)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 4px',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {fmtRub(row.remainingKopecks)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <Button type="submit">Отметить оплату</Button>
            <Button variant="secondary" href={`/teacher/learners/${learnerId}`}>
              Отмена
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
