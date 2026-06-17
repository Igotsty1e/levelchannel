'use client'

// Wave-2 lesson-history Sub-PR 2 (2026-06-16) — карточка «Недавние
// прошедшие» на /teacher home. Показывает last N past booked-слотов
// БЕЗ completion-row + 2 quick-actions: «Провёл» / «Не пришёл».
//
// На выпадение row из списка после клика: optimistic update + refresh
// после успешного ответа.
//
// 2026-06-16 polish:
//   - `embedded` prop: при true компонент рендерит ТОЛЬКО список
//     (без `<section className="card">` + без h2 + без footer-link),
//     чтобы DigestPreviewTile мог хостить его как подсекцию.
//   - «Провёл» переведён с `primary` на `secondary` (outline без
//     заливки) — менее акцентно по owner-feedback.

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
  /** Когда true — рендерится без card-обёртки/заголовка для встраивания. */
  embedded?: boolean
}

export function RecentPastCard({
  initialSlots,
  learnerLabels,
  embedded = false,
}: Props) {
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

  const listAndError = (
    <>
      {err ? (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>
          {err}
        </p>
      ) : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
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
              {/* 2026-06-17 fix (owner image): имя+дата на одной строке через
                  inline flex с whitespace nowrap и общим выравниванием. */}
              <span
                style={{
                  minWidth: 0,
                  flex: '1 1 240px',
                  display: 'inline-flex',
                  alignItems: 'baseline',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  title={learner}
                  style={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {learner}
                </span>
                <span
                  style={{
                    color: 'var(--secondary)',
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatDate(s.startAt)} · {s.durationMinutes} мин
                </span>
              </span>
              <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  variant="secondary"
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
                {/* 2026-06-17 fix (owner image): кнопка «Перенести» — link на
                    календарь с фокусом на слоте (slot-detail-modal там
                    доступен). */}
                <Link
                  href={`/teacher/calendar?focusSlot=${s.id}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0 12px',
                    height: 32,
                    borderRadius: 8,
                    border: '1px solid transparent',
                    color: 'var(--secondary)',
                    textDecoration: 'none',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  Перенести
                </Link>
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )

  if (embedded) {
    // DigestPreviewTile сам рендерит divider + sub-heading + footer-link.
    return listAndError
  }

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
      {listAndError}
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
