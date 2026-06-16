'use client'

// Wave-2 lesson-history Sub-PR 2 (2026-06-16) — карточка «Недавние
// прошедшие» на /teacher home. Показывает last N past booked-слотов
// БЕЗ completion-row + 2 quick-actions: «Провёл» / «Не пришёл».
//
// На выпадение row из списка после клика: optimistic update + refresh
// после успешного ответа.
//
// «Оплачено наличкой» quick-action ИЗ Sub-PR 2 НЕ входит — это поле
// делается на Sub-PR 3 через существующий createTeacherMarkPaid (модал
// уже есть в /teacher/payments).

import Link from 'next/link'
import { useState } from 'react'

import { Button } from '@/components/ui/primitives'
import type { LessonSlot } from '@/lib/scheduling/slots'

function formatDate(iso: string): string {
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

type Props = {
  initialSlots: LessonSlot[]
  /** Map slotId → learner display label (отображается в строке). */
  learnerLabels: Record<string, string>
}

export function RecentPastCard({ initialSlots, learnerLabels }: Props) {
  const [slots, setSlots] = useState<LessonSlot[]>(initialSlots)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)

  async function mark(slotId: string, kind: 'completed' | 'no-show') {
    if (busy.has(slotId)) return
    setBusy((prev) => new Set(prev).add(slotId))
    setErr(null)
    try {
      const endpoint =
        kind === 'completed'
          ? `/api/teacher/slots/${slotId}/mark-completed`
          : `/api/teacher/slots/${slotId}/mark-no-show`
      const res = await fetch(endpoint, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErr(data?.message ?? 'Не удалось отметить занятие.')
        return
      }
      setSlots((prev) => prev.filter((s) => s.id !== slotId))
    } finally {
      setBusy((prev) => {
        const next = new Set(prev)
        next.delete(slotId)
        return next
      })
    }
  }

  if (slots.length === 0) return null

  return (
    <section
      className="card lc-section"
      style={{ padding: 24 }}
      aria-labelledby="recent-past-heading"
    >
      <h2
        id="recent-past-heading"
        style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}
      >
        Недавние прошедшие
      </h2>
      {err ? (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>
          {err}
        </p>
      ) : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px' }}>
        {slots.map((s) => {
          const isBusy = busy.has(s.id)
          const learner = learnerLabels[s.id] ?? '—'
          return (
            <li
              key={s.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                padding: '10px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: 14,
              }}
            >
              <span style={{ minWidth: 0, flex: '1 1 200px' }}>
                <span
                  title={learner}
                  style={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'inline-block',
                    maxWidth: '100%',
                  }}
                >
                  {learner}
                </span>
                <span
                  style={{
                    color: 'var(--secondary)',
                    fontSize: 13,
                    marginLeft: 8,
                  }}
                >
                  {formatDate(s.startAt)} · {s.durationMinutes} мин
                </span>
              </span>
              <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => mark(s.id, 'completed')}
                  disabled={isBusy}
                >
                  Провёл
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => mark(s.id, 'no-show')}
                  disabled={isBusy}
                >
                  Не пришёл
                </Button>
              </span>
            </li>
          )
        })}
      </ul>
      <Link
        href="/teacher/lessons"
        className="btn-ghost"
        style={{ display: 'inline-flex', minHeight: 44 }}
      >
        Все прошедшие занятия →
      </Link>
    </section>
  )
}
