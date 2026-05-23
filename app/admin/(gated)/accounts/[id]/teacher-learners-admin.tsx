'use client'

// Wave 14.1 — admin-side "Назначенные ученики" block on a teacher's
// account page. Two-action surface:
//   1. List current learners assigned to this teacher (each row has
//      a "Отвязать" button that calls POST /api/admin/accounts/<learnerId>/
//      teacher with `teacherAccountId: null`).
//   2. Pick an unassigned candidate from a dropdown and "Привязать"
//      (same endpoint with `teacherAccountId: this teacher`).
//
// Why this lives on the TEACHER's profile (not just the learner's):
// the operator's daily question is "who is this teacher teaching?",
// and reassigning learners between teachers is faster from this side
// than walking the full learner list.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import type { TeacherLearnerSummary } from '@/lib/scheduling/teacher-learners'

type Candidate = { id: string; email: string }

type Props = {
  teacherAccountId: string
  currentLearners: TeacherLearnerSummary[]
  // Eligible to be (re)assigned to this teacher: verified, not
  // disabled, holds the student role (or no role), and currently
  // either unassigned or assigned to a DIFFERENT teacher.
  candidates: Candidate[]
}

export function TeacherLearnersAdmin({
  teacherAccountId,
  currentLearners,
  candidates,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [pickedCandidateId, setPickedCandidateId] = useState<string>(
    candidates[0]?.id ?? '',
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function callTeacherEndpoint(
    learnerAccountId: string,
    nextTeacherId: string | null,
  ) {
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const res = await fetch(
        `/api/admin/accounts/${learnerAccountId}/teacher`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacherAccountId: nextTeacherId }),
        },
      )
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        setErr(data.message || data.error || `HTTP ${res.status}`)
        return
      }
      setInfo(nextTeacherId ? 'Привязано.' : 'Отвязано.')
      // Refresh server data for the section without a hard reload.
      startTransition(() => {
        router.refresh()
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 12,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        Здесь видны ученики, у которых в профиле выставлен этот учитель,
        и те, с кем у учителя есть проведённые занятия. Ученик видит
        свободные слоты только своего назначенного учителя — поэтому
        привязка управляет тем, кому какие слоты вообще видны.
      </p>

      {currentLearners.length === 0 ? (
        <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
          Пока никто не привязан и нет проведённых занятий.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {currentLearners.map((l) => {
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
                gridTemplateColumns: '1fr auto auto',
                gap: 12,
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
              }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>
                  {renderedName}
                  {hasName ? (
                    <span
                      style={{
                        color: 'var(--secondary)',
                        marginLeft: 8,
                        fontSize: 12,
                        fontWeight: 400,
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
                      архив
                    </span>
                  ) : null}
                </div>
              </div>
              <span style={{ color: 'var(--secondary)', fontSize: 12 }}>
                ближайшие <strong style={{ color: 'var(--text)' }}>{l.upcomingCount}</strong>
                {' · '}
                проведено <strong style={{ color: 'var(--text)' }}>{l.completedCount}</strong>
              </span>
              {l.isAssigned ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => callTeacherEndpoint(l.learnerId, null)}
                  style={smallGhostStyle}
                  title="Отвязать ученика от этого учителя"
                >
                  Отвязать
                </button>
              ) : (
                <span style={{ width: 80 }} />
              )}
            </li>
            )
          })}
        </ul>
      )}

      {candidates.length > 0 ? (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            paddingTop: 8,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--secondary)' }}>
            Привязать ученика:
          </span>
          <select
            value={pickedCandidateId}
            onChange={(e) => setPickedCandidateId(e.target.value)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 10px',
              color: 'var(--text)',
              fontSize: 13,
              minWidth: 240,
            }}
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.email}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !pickedCandidateId}
            onClick={() =>
              callTeacherEndpoint(pickedCandidateId, teacherAccountId)
            }
            style={primaryBtnStyle}
          >
            Привязать
          </button>
        </div>
      ) : (
        <p style={{ color: 'var(--secondary)', fontSize: 12, margin: 0 }}>
          Все доступные ученики уже привязаны к этому учителю.
        </p>
      )}

      {info ? (
        <span style={{ color: '#9bdf9b', fontSize: 12 }}>{info}</span>
      ) : null}
      {err ? <span style={{ color: '#ff8a8a', fontSize: 12 }}>{err}</span> : null}
      {pending ? (
        <span style={{ color: 'var(--secondary)', fontSize: 12 }}>
          Обновляется…
        </span>
      ) : null}
    </div>
  )
}

const smallGhostStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 12,
  cursor: 'pointer',
}

const primaryBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: 'rgba(34, 197, 94, 0.18)',
  border: '1px solid rgba(34, 197, 94, 0.55)',
  color: '#bbf7d0',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
}
