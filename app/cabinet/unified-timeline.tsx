// SAAS-PIVOT Epic 7 Day 7 — unified booking timeline for multi-teacher
// learners.
//
// Server-rendered: reads from `listSlotsForLearner` (which already
// returns all slots regardless of teacher) and groups by upcoming /
// past. Adds a teacher-name column so a learner with 2+ teachers can
// disambiguate at a glance.
//
// Why a separate component (vs reusing LessonsSection): LessonsSection
// owns the "single-teacher" v1 surface — booking CTA, paid pill, pay
// CTA, cancel button, etc. The multi-teacher polish replaces the bare
// list with a teacher-aware version; the existing component stays
// untouched for the 1-link case (no regression).

import { listSlotsForLearner } from '@/lib/scheduling/slots'

import { TZ_DEFAULT, safeTz } from '@/lib/util/tz'

function fmtSlot(iso: string, tz: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status: string): string {
  switch (status) {
    case 'open':
      return 'свободен'
    case 'booked':
      return 'забронирован'
    case 'cancelled':
      return 'отменён'
    case 'completed':
      return 'проведён'
    case 'no_show_learner':
      return 'не пришёл (вы)'
    case 'no_show_teacher':
      return 'не пришёл учитель'
    default:
      return status
  }
}

export async function UnifiedTimeline({
  learnerAccountId,
  teacherLabelById,
  learnerTimezone,
}: {
  learnerAccountId: string
  teacherLabelById: Map<string, string>
  learnerTimezone: string | null
}) {
  const tz = safeTz(learnerTimezone)
  const slots = await listSlotsForLearner(learnerAccountId, 50)
  const now = Date.now()
  // Upcoming = future booked. Past = anything earlier OR non-booked
  // terminal states. Cancelled future stays in "past" (visually) so
  // the upcoming list isn't polluted with cancelled rows.
  const upcoming = slots
    .filter((s) => new Date(s.startAt).getTime() > now && s.status === 'booked')
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  const past = slots
    .filter((s) => !(new Date(s.startAt).getTime() > now && s.status === 'booked'))
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())

  return (
    <div className="card" style={{ padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
        Мои занятия — общая лента
      </h2>
      {slots.length === 0 ? (
        <p style={{ color: 'var(--secondary)', fontSize: 14, margin: 0 }}>
          Пока нет занятий ни с одним из учителей.
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
                    <span style={{ color: 'var(--text)' }}>
                      {fmtSlot(s.startAt, tz)}
                    </span>{' '}
                    <span style={{ color: 'var(--secondary)' }}>
                      · {s.durationMinutes} мин ·{' '}
                      {teacherLabelById.get(s.teacherAccountId) ?? '—'}
                      {s.tariffTitleRu ? ` · ${s.tariffTitleRu}` : ''}
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
                Прошедшие и отменённые
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {past.map((s) => (
                  <li
                    key={s.id}
                    style={{
                      padding: '10px 0',
                      borderTop: '1px solid var(--border)',
                      fontSize: 14,
                      color: 'var(--secondary)',
                    }}
                  >
                    {fmtSlot(s.startAt, tz)} · {s.durationMinutes} мин ·{' '}
                    {teacherLabelById.get(s.teacherAccountId) ?? '—'} ·{' '}
                    {statusLabel(s.status)}
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
