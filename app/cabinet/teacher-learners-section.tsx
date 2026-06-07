// Wave 14 #2 — teacher-side "Мои ученики" block. Read-only summary
// of every learner the teacher has slots with (or who is currently
// assigned to them). Mini-dashboard: per-learner counts of
// upcoming / completed / cancelled / no-show slots.
//
// Future expansion (per backlog): paid-vs-unpaid counters once the
// billing wave's allocation rollups are wired into a per-learner
// view. Today this block answers "who am I teaching, how often" —
// the load-bearing question the teacher asks every Monday morning.

import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import type { TeacherLearnerSummary } from '@/lib/scheduling/teacher-learners'

export function TeacherLearnersSection({
  learners,
}: {
  learners: TeacherLearnerSummary[]
}) {
  if (learners.length === 0) {
    return (
      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          Мои ученики
        </h2>
        <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6 }}>
          Пока учеников нет. Создайте приглашение выше — ссылка действует 7 дней.
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
        Мои ученики
      </h2>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {learners.map((l) => {
          const renderedName = formatProfileNameForRender({
            firstName: l.firstName ?? null,
            lastName: l.lastName ?? null,
            displayName: l.displayName,
            fallbackEmail: l.learnerEmail,
          })
          const hasName = renderedName !== l.learnerEmail
          return (
          <li
            key={l.learnerId}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 12,
              padding: '12px 0',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>
                {renderedName}
                {hasName ? (
                  <span
                    style={{
                      color: 'var(--secondary)',
                      fontSize: 12,
                      fontWeight: 400,
                      marginLeft: 8,
                    }}
                  >
                    {l.learnerEmail}
                  </span>
                ) : null}
                {!l.isAssigned ? (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      color: 'var(--secondary)',
                      padding: '1px 6px',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                    }}
                  >
                    в архиве
                  </span>
                ) : null}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 12,
                fontSize: 13,
                color: 'var(--secondary)',
                alignItems: 'center',
              }}
            >
              <Stat label="ближайшие" n={l.upcomingCount} />
              <Stat label="проведено" n={l.completedCount} />
              {l.cancelledCount > 0 ? (
                <Stat label="отменено" n={l.cancelledCount} />
              ) : null}
              {l.noShowCount > 0 ? (
                <Stat label="пропущено" n={l.noShowCount} muted />
              ) : null}
            </div>
          </li>
          )
        })}
      </ul>
    </div>
  )
}

function Stat({
  label,
  n,
  muted,
}: {
  label: string
  n: number
  muted?: boolean
}) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
      <span
        style={{
          color: muted ? 'var(--secondary)' : 'var(--text)',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 11, color: 'var(--secondary)' }}>{label}</span>
    </span>
  )
}
