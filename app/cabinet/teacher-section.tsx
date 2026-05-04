import type { LessonSlot } from '@/lib/scheduling/slots'

const TZ_DEFAULT = 'Europe/Moscow'

type Props = {
  initialSlots: LessonSlot[]
  teacherTimezone: string | null
}

// Phase 7+: read-only teacher schedule stub. Operator manages slots
// in /admin/slots; the teacher just sees what's been put on their
// calendar. Self-management (teachers creating their own slots)
// ships when the workflow demands it.

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
      return 'свободен — ждём ученика'
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
  const upcoming = initialSlots.filter(
    (s) => new Date(s.startAt).getTime() > now,
  )
  const past = initialSlots.filter(
    (s) => new Date(s.startAt).getTime() <= now,
  )

  return (
    <div className="card" style={{ padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
        Мои занятия как учитель
      </h2>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          lineHeight: 1.6,
          marginBottom: 16,
        }}
      >
        Расписание ведёт оператор в админке. Когда понадобится
        самостоятельно создавать слоты — добавим интерфейс.
      </p>

      {initialSlots.length === 0 ? (
        <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
          У вас пока нет назначенных занятий. Когда оператор создаст
          слоты с вашим аккаунтом как учителем — они появятся здесь.
        </p>
      ) : (
        <>
          {upcoming.length > 0 ? (
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
                Предстоящие
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {upcoming.map((s) => (
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
          ) : null}
          {past.length > 0 ? (
            <>
              <p
                style={{
                  color: 'var(--secondary)',
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  marginTop: upcoming.length > 0 ? 16 : 0,
                  marginBottom: 4,
                }}
              >
                Прошедшие
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {past.slice(0, 10).map((s) => (
                  <li
                    key={s.id}
                    style={{
                      padding: '10px 0',
                      borderTop: '1px solid var(--border)',
                      fontSize: 14,
                      color: 'var(--secondary)',
                    }}
                  >
                    {fmt(s.startAt, tz)} · {s.durationMinutes} мин ·{' '}
                    {statusLabel(s.status)}
                    {s.learnerEmail ? ` · ${s.learnerEmail}` : ''}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
