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
import { RecentPastCard } from '@/components/teacher/home/recent-past-card'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getTeacherFinanceSnapshot } from '@/lib/billing/teacher-finance'
import { getDbPool } from '@/lib/db/pool'
import { getTeacherDigestPreview } from '@/lib/notifications/teacher-digest-preview'
import { computeTeacherSetupChecklist } from '@/lib/onboarding/teacher-setup-checklist'
import { listRecentPastUnmarkedSlots } from '@/lib/scheduling/slots'
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
  teacherTz: string,
  limit = 3,
): Promise<UpcomingSlot[]> {
  // 2026-06-16 polish: исключаем сегодняшние занятия — они уже видны
  // внутри DigestPreviewTile. Фильтр по началу СЛЕДУЮЩИХ суток в
  // часовом поясе учителя (`teacherTz`). Fallback на Europe/Moscow
  // если tz пустой.
  const tz = teacherTz && teacherTz.length > 0 ? teacherTz : 'Europe/Moscow'
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
        and s.start_at >= ((date_trunc('day', now() at time zone $3) + interval '1 day') at time zone $3)
      order by s.start_at asc
      limit $2`,
    [teacherAccountId, limit, tz],
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

// Wave-2 lesson-history (2026-06-16) — для карточки «Недавние прошедшие»
// нам нужны не только slot-ы (через listRecentPastUnmarkedSlots), но и
// learner display labels per slotId. Один SQL вместо N+1.
async function loadRecentPastLearnerLabels(
  slotIds: string[],
): Promise<Record<string, string>> {
  if (slotIds.length === 0) return {}
  const r = await getDbPool().query<{
    id: string
    learner_email: string | null
    display_name: string | null
    first_name: string | null
    last_name: string | null
  }>(
    `select s.id,
            la.email as learner_email,
            ap.display_name,
            ap.first_name,
            ap.last_name
       from lesson_slots s
       left join accounts la on la.id = s.learner_account_id
       left join account_profiles ap on ap.account_id = la.id
      where s.id = any($1::uuid[])`,
    [slotIds],
  )
  const map: Record<string, string> = {}
  for (const row of r.rows) {
    const composed =
      row.first_name || row.last_name
        ? [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
        : ''
    map[row.id] =
      composed || row.display_name || row.learner_email || 'Ученик'
  }
  return map
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
  // Сначала digest (для teacherTz), затем остальное параллельно.
  // listUpcomingSlotsForTeacher теперь принимает tz чтобы фильтровать
  // СЕГОДНЯШНИЕ занятия — они уже в дайджесте.
  const digestPreview = await getTeacherDigestPreview(teacherAccountId)
  const teacherTz = digestPreview.teacherTz || 'Europe/Moscow'
  const [
    upcomingSlots,
    recentPastSlots,
    setupChecklist,
    teacherFirstName,
    financeSnapshot,
  ] = await Promise.all([
    listUpcomingSlotsForTeacher(teacherAccountId, teacherTz, 3),
    listRecentPastUnmarkedSlots(teacherAccountId, 5),
    computeTeacherSetupChecklist(teacherAccountId),
    loadTeacherFirstName(teacherAccountId),
    getTeacherFinanceSnapshot(teacherAccountId, todayYmd),
  ])
  const recentPastLearnerLabels = await loadRecentPastLearnerLabels(
    recentPastSlots.map((s) => s.id),
  )
  const now = new Date()
  const greeting = greetingForHour(now, teacherTz)

  return (
    <main style={{ maxWidth: 880, margin: '0 auto' }}>
      <header className="lc-section">
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
      <div className="lc-section">
        <TeacherSetupChecklist state={setupChecklist} />
      </div>

      {/* Дайджест на сегодня — Sub-PR D из teacher-cabinet-polish.
          2026-06-12 (Задача 4): переехал НАВЕРХ под checklist. Что
          важно прямо сейчас — главное; финансы — справа внизу.
          2026-06-16 polish: «Недавние прошедшие» теперь подсекция
          дайджеста, а не отдельная карточка. */}
      <div className="lc-section">
        <DigestPreviewTile
          preview={digestPreview}
          pastUnmarkedSection={
            recentPastSlots.length > 0 ? (
              <RecentPastCard
                initialSlots={recentPastSlots}
                learnerLabels={recentPastLearnerLabels}
                embedded
              />
            ) : null
          }
        />
      </div>

      {/* Блок: Ближайшие занятия */}
      <section
        className="card lc-section"
        style={{ padding: 24 }}
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

      {/* Финансы — Hero-вариант. 2026-06-12 (Задача 4): переехал
          ВНИЗ под расписание. Полезная справка, но не первое что
          нужно учителю при открытии кабинета (это не банк). Скрывается
          полностью при отсутствии слотов. */}
      <div className="lc-section">
        <TeacherFinanceSummary snapshot={financeSnapshot} />
      </div>
    </main>
  )
}
