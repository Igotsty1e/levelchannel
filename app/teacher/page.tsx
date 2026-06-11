// Mobile-first cabinet restructure (2026-05-31, refined 2026-06-07).
// Главная учительского кабинета: один primary CTA — «Открыть календарь».
// Приглашение учеников переехало на /teacher/learners (логически
// ближе к разделу «Ученики»). Список учеников на главной не
// дублируется — он живёт целиком на /teacher/learners.
//
// 2 блока на главной (порядок 2026-06-07):
//   1. Дайджест на сегодня   — DigestPreviewTile (today_local)
//   2. Ближайшие занятия    — превью + кнопка «Открыть календарь»
//
// Бывший контент /teacher (full-week calendar) переехал в
// /teacher/calendar. Настройки календаря / интеграции / дайджест
// доступны через /teacher/settings.
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { TeacherSetupChecklist } from '@/components/onboarding/teacher-setup-checklist'
import { DigestPreviewTile } from '@/components/teacher/digest-preview-tile'
import { TeacherFinanceSummary } from '@/components/teacher/home/finance-summary'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getTeacherFinanceSnapshot } from '@/lib/billing/teacher-finance'
import { getDbPool } from '@/lib/db/pool'
import { getTeacherDigestPreview } from '@/lib/notifications/teacher-digest-preview'
import { computeTeacherSetupChecklist } from '@/lib/onboarding/teacher-setup-checklist'
import { greetingForHour } from '@/lib/util/greeting'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Кабинет — LevelChannel',
  robots: { index: false, follow: false },
}

type UpcomingSlot = {
  id: string
  startAt: string
  durationMinutes: number
  learnerLabel: string
  status: string
}

async function listUpcomingSlotsForTeacher(
  teacherAccountId: string,
  limit = 3,
): Promise<UpcomingSlot[]> {
  const r = await getDbPool().query<{
    id: string
    start_at: string
    duration_minutes: number
    learner_email: string | null
    display_name: string | null
    first_name: string | null
    last_name: string | null
    status: string
  }>(
    `select s.id,
            s.start_at::text as start_at,
            s.duration_minutes,
            s.status,
            la.email as learner_email,
            ap.display_name,
            ap.first_name,
            ap.last_name
       from lesson_slots s
       left join accounts la on la.id = s.learner_account_id
       left join account_profiles ap on ap.account_id = la.id
      where s.teacher_account_id = $1
        and s.status in ('booked')
        and s.start_at > now()
      order by s.start_at asc
      limit $2`,
    [teacherAccountId, limit],
  )
  return r.rows.map((row) => {
    const composed =
      row.first_name || row.last_name
        ? [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
        : ''
    const learnerLabel = composed
      || row.display_name
      || row.learner_email
      || 'Ученик'
    return {
      id: row.id,
      startAt: row.start_at,
      durationMinutes: row.duration_minutes,
      learnerLabel,
      status: row.status,
    }
  })
}

function formatSlotDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return iso
  }
}

async function loadTeacherFirstName(teacherAccountId: string): Promise<string | null> {
  const r = await getDbPool().query<{
    first_name: string | null
    display_name: string | null
  }>(
    `select first_name, display_name
       from account_profiles
      where account_id = $1`,
    [teacherAccountId],
  )
  const row = r.rows[0]
  if (!row) return null
  const first = (row.first_name || '').trim()
  if (first) return first
  const display = (row.display_name || '').trim()
  if (display) return display.split(/\s+/)[0] || null
  return null
}

export default async function TeacherHomePage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const current = await lookupSession(cookieValue)
  if (!current) redirect('/login')

  const teacherAccountId = current.account.id

  const todayYmd = new Date().toISOString().slice(0, 10)
  const [
    upcomingSlots,
    digestPreview,
    setupChecklist,
    teacherFirstName,
    financeSnapshot,
  ] = await Promise.all([
    listUpcomingSlotsForTeacher(teacherAccountId, 3),
    getTeacherDigestPreview(teacherAccountId),
    computeTeacherSetupChecklist(teacherAccountId),
    loadTeacherFirstName(teacherAccountId),
    getTeacherFinanceSnapshot(teacherAccountId, todayYmd),
  ])

  const teacherTz = digestPreview.teacherTz || 'Europe/Moscow'
  const now = new Date()
  const greeting = greetingForHour(now, teacherTz)

  return (
    <main style={{ maxWidth: 880, margin: '0 auto' }}>
      <header style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          {teacherFirstName ? `${greeting}, ${teacherFirstName}` : greeting}
        </h1>
        {/* Дата/день недели намеренно убраны: они дублируют шапку
            «Сегодня, N <месяц>» внутри DigestPreviewTile ниже. */}
      </header>

      {/* Onboarding Sub-PR B1 — teacher setup checklist hint.
          SSR-rendered when not all 4 setup items are done AND user
          hasn't dismissed. */}
      <TeacherSetupChecklist state={setupChecklist} />

      {/* Finance summary — plan docs/plans/finance-on-teacher-home-2026-06-09.md.
          4 cards: this-month confirmed / unpaid / active packages /
          expected this week. When all-zero — Variant D empty-state:
          skeleton 4-grid + sequential coach-hint («next step»), only
          if the setup checklist above is already complete (avoids
          duplicating activation prompts). Plan: docs/plans/finance-
          empty-state-2026-06-10. */}
      <TeacherFinanceSummary
        snapshot={financeSnapshot}
        setupChecklist={setupChecklist}
      />

      {/* Дайджест на сегодня — Sub-PR D из teacher-cabinet-polish.
          Превью today_local списка занятий, тот же предикат, что и у
          08:00 cron-дайджеста. 2026-06-07: переехал НАД «Ближайшие
          занятия» — сегодняшний день важнее ближайшего будущего. */}
      <DigestPreviewTile preview={digestPreview} />

      {/* Блок: Ближайшие занятия */}
      <section
        className="card"
        style={{ padding: 24, marginBottom: 24 }}
        aria-labelledby="upcoming-heading"
      >
        <h2
          id="upcoming-heading"
          style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}
        >
          Ближайшие занятия
        </h2>
        {upcomingSlots.length === 0 ? (
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 14,
              lineHeight: 1.6,
              marginBottom: 16,
            }}
          >
            Пока ничего не запланировано. Откройте календарь, чтобы добавить занятие.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px' }}>
            {upcomingSlots.map((s) => (
              <li
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 14,
                }}
              >
                {/* learnerLabel длинный (часто email вида user@domain.tld).
                    min-width:0 нужен flex-child'у чтобы overflow:hidden
                    сработал; иначе flexbox сохраняет intrinsic width. */}
                <span
                  title={s.learnerLabel}
                  style={{
                    fontWeight: 500,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.learnerLabel}
                </span>
                <span
                  style={{
                    color: 'var(--secondary)',
                    fontSize: 13,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatSlotDateTime(s.startAt)} · {s.durationMinutes} мин
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/teacher/calendar"
          className="btn-primary"
          style={{ display: 'inline-flex', minHeight: 44 }}
        >
          Открыть календарь
        </Link>
      </section>
    </main>
  )
}
