import { cookies } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getDbPool } from '@/lib/db/pool'

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
  }>(
    `select a.id, a.email, p.display_name
       from accounts a
       left join account_profiles p on p.account_id = a.id
      where a.id = $1`,
    [learnerId],
  )
  if (learnerRow.rows.length === 0) {
    notFound()
  }
  const learner = learnerRow.rows[0]

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

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/teacher"
          style={{ color: 'var(--secondary)', textDecoration: 'none', fontSize: 14 }}
        >
          ← Назад в календарь
        </Link>
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        {learner.display_name || learner.email}
      </h1>
      <p style={{ color: 'var(--secondary)', marginBottom: 24 }}>
        {learner.email}
      </p>

      <section
        style={{
          padding: 16,
          background: 'var(--surface)',
          borderRadius: 8,
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          Баланс
        </h2>
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          {balanceKopecks > 0
            ? `Долг: ${fmtRub(balanceKopecks)}`
            : balanceKopecks < 0
              ? `Переплата: ${fmtRub(-balanceKopecks)}`
              : 'Долгов нет.'}
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--secondary)' }}>
          Всего проведено: {fmtRub(totalAmount)} ·{' '}
          оплачено: {fmtRub(totalCovered)}
        </div>
        {balanceKopecks > 0 && (
          // SAAS-PIVOT Epic 5B Day 5B — wire to /settle page (was a
          // disabled placeholder during Day 5A). The page hosts the
          // amount input + per-completion checkboxes; POST lands on
          // /api/teacher/learners/[id]/settle.
          <div style={{ marginTop: 16 }}>
            <Link
              href={`/teacher/learners/${learnerId}/settle`}
              style={{
                display: 'inline-block',
                padding: '8px 16px',
                background: 'var(--accent)',
                color: 'var(--accent-fg)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Отметить оплату
            </Link>
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          История уроков ({completions.length})
        </h2>
        {completions.length === 0 ? (
          <p style={{ color: 'var(--secondary)' }}>Пока ничего не отмечено.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 4px' }}>Дата</th>
                <th style={{ textAlign: 'left', padding: '8px 4px' }}>Статус</th>
                <th style={{ textAlign: 'right', padding: '8px 4px' }}>Стоимость</th>
                <th style={{ textAlign: 'right', padding: '8px 4px' }}>Оплачено</th>
                <th style={{ textAlign: 'right', padding: '8px 4px' }}></th>
              </tr>
            </thead>
            <tbody>
              {completions.map((c) => {
                const createdMs = new Date(c.createdAt).getTime()
                const elapsed = Date.now() - createdMs
                const isImmutable = c.immutableAt !== null || elapsed >= 48 * 60 * 60 * 1000
                // Round-1 paranoia WARN #4 closure: ANY settlement coverage
                // blocks uncomplete (the DB BEFORE DELETE trigger rejects on
                // first lesson_settlement_completions row, partial or full).
                // Previous gate used `>= amount` which surfaced an action
                // that would deterministically 409 on partial coverage.
                const hasAnySettlement = c.coveredKopecks > 0
                const canUncomplete = !isImmutable && !hasAnySettlement
                return (
                  <tr
                    key={c.id}
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <td style={{ padding: '8px 4px' }}>
                      {new Date(c.startAt).toLocaleString('ru-RU', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      {c.wasNoShow ? 'Не пришёл' : 'Проведён'}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 4px' }}>
                      {fmtRub(c.amountKopecks)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 4px' }}>
                      {fmtRub(c.coveredKopecks)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 4px' }}>
                      {canUncomplete ? (
                        <UncompleteButton completionId={c.id} />
                      ) : (
                        <span style={{ color: 'var(--secondary)', fontSize: 12 }}>
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
