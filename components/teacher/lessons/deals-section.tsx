'use client'

// Deals section для /teacher/lessons?kind=deals.
// Извлечён из PersonalEventsList в lesson-history-client.tsx
// (post-deploy bug bash 2026-06-19 — Sub-PR 2 consolidation).

import { useEffect, useState } from 'react'

import { EmptyState, Pill } from '@/components/ui/primitives'

type PersonalEventRow = {
  id: string
  startAt: string
  durationMinutes: number
  status: 'personal_event' | 'completed' | 'cancelled'
  title: string
  body: string | null
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return iso
  }
}

export function DealsSection() {
  const [rows, setRows] = useState<PersonalEventRow[]>([])
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setBusy(true)
    fetch('/api/teacher/personal-events/history', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!live) return
        if (!res.ok) {
          setErr(data?.message ?? 'Не удалось загрузить дела.')
          setRows([])
          return
        }
        setRows((data?.rows as PersonalEventRow[]) ?? [])
      })
      .catch((e) => {
        if (!live) return
        setErr(e instanceof Error ? e.message : 'Не удалось загрузить дела.')
      })
      .finally(() => {
        if (live) setBusy(false)
      })
    return () => {
      live = false
    }
  }, [])

  if (busy) {
    return (
      <section className="lc-section" data-testid="lesson-history-deals-loading">
        <p style={{ color: 'var(--secondary)', fontSize: 13 }}>Загружаем…</p>
      </section>
    )
  }

  if (err) {
    return (
      <section className="lc-section">
        <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p>
      </section>
    )
  }

  if (rows.length === 0) {
    return (
      <section className="lc-section" data-testid="lesson-history-deals-empty">
        <EmptyState
          title="Дел пока нет"
          body="Добавьте дело из календаря — оно появится здесь, когда выполните или отмените."
        />
      </section>
    )
  }

  return (
    <section className="lc-section" data-testid="lesson-history-deals-list">
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((row) => {
          const tone =
            row.status === 'completed'
              ? 'success'
              : row.status === 'cancelled'
                ? 'danger'
                : 'warning'
          const label =
            row.status === 'completed'
              ? '✓ Выполнено'
              : row.status === 'cancelled'
                ? 'Отменено'
                : '● Активно'
          return (
            <li
              key={row.id}
              className="card"
              data-testid={`personal-event-row-${row.id}`}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                padding: 16,
                marginBottom: 8,
                fontSize: 14,
                alignItems: 'center',
              }}
            >
              <span style={{ minWidth: 0, flex: '1 1 200px' }}>
                <span style={{ fontWeight: 500 }}>{row.title}</span>
                <span
                  style={{
                    color: 'var(--secondary)',
                    fontSize: 13,
                    marginLeft: 8,
                  }}
                >
                  {formatDate(row.startAt)} · {row.durationMinutes} мин
                </span>
                {row.body ? (
                  <div
                    style={{
                      color: 'var(--secondary)',
                      fontSize: 13,
                      marginTop: 4,
                    }}
                  >
                    {row.body}
                  </div>
                ) : null}
              </span>
              <Pill tone={tone} size="sm">
                {label}
              </Pill>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
