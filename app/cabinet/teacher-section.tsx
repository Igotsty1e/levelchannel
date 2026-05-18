import Link from 'next/link'

import type { LessonSlot } from '@/lib/scheduling/slots'

const TZ_DEFAULT = 'Europe/Moscow'

type Props = {
  initialSlots: LessonSlot[]
  teacherTimezone: string | null
}

// Wave A PR4 — compact teacher summary card on /cabinet.
//
// Replaces the previous full-list view (157 lines, two scrolling
// sections). Now: up to 3 nearest upcoming slots + a single CTA to
// /teacher (the full-week calendar surface). The empty state still
// reads like a help line so first-time teachers know operators
// populate the schedule.

function fmt(iso: string, tz: string): string {
  const candidate = tz
  let safeTz = TZ_DEFAULT
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: candidate })
    safeTz = candidate
  } catch {
    safeTz = TZ_DEFAULT
  }
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: safeTz,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(s: string): string {
  switch (s) {
    case 'open':
      return 'свободен'
    case 'booked':
      return 'забронирован'
    case 'cancelled':
      return 'отменён'
    case 'completed':
      return 'проведён'
    case 'no_show_learner':
      return 'не пришёл ученик'
    case 'no_show_teacher':
      return 'не пришёл (вы)'
    default:
      return s
  }
}

export function TeacherSection({ initialSlots, teacherTimezone }: Props) {
  const tz = teacherTimezone ?? TZ_DEFAULT
  const now = Date.now()
  const upcomingPreview = initialSlots
    .filter((s) => new Date(s.startAt).getTime() > now)
    .slice(0, 3)

  return (
    <div className="card" style={{ padding: 24, marginBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 4,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          Мои занятия как учитель
        </h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link
            href="/teacher/settings/calendar"
            style={{
              color: 'var(--secondary)',
              fontSize: 13,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Настройки календаря →
          </Link>
          <Link
            href="/teacher"
            style={{
              color: 'var(--accent, #6ea8fe)',
              fontSize: 13,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Полный календарь →
          </Link>
        </div>
      </div>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          lineHeight: 1.6,
          marginBottom: 16,
        }}
      >
        Расписание ведёт оператор в админке. Полный недельный обзор —
        в учительском календаре по ссылке выше.
      </p>

      {upcomingPreview.length === 0 ? (
        <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
          Ближайших занятий нет. Когда оператор создаст или назначит
          новое занятие — оно появится здесь и в полном календаре.
        </p>
      ) : (
        <>
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              marginBottom: 4,
            }}
          >
            Ближайшие
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {upcomingPreview.map((s) => (
              <li
                key={s.id}
                style={{
                  padding: '10px 0',
                  borderTop: '1px solid var(--border)',
                  fontSize: 14,
                }}
              >
                {fmt(s.startAt, tz)} ·{' '}
                <span style={{ color: 'var(--secondary)' }}>
                  {s.durationMinutes} мин · {statusLabel(s.status)}
                  {s.learnerEmail ? ` · ${s.learnerEmail}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
