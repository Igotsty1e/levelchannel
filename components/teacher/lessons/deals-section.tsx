'use client'

// Deals section для /teacher/lessons?kind=deals.
// Извлечён из PersonalEventsList в lesson-history-client.tsx
// (post-deploy bug bash 2026-06-19 — Sub-PR 2 consolidation).

import { useEffect, useRef, useState } from 'react'

import { EmptyState, Pill } from '@/components/ui/primitives'

import { StatusChangeConfirmModal } from './status-change-confirm-modal'
import { StatusChangeMenu, type DealTargetStatus } from './status-change-menu'

type PersonalEventRow = {
  id: string
  startAt: string
  durationMinutes: number
  status: 'personal_event' | 'completed' | 'cancelled'
  title: string
  body: string | null
  updatedAt?: string
}

const DEAL_STATUS_LABEL: Record<PersonalEventRow['status'], string> = {
  personal_event: 'Активно',
  completed: 'Выполнено',
  cancelled: 'Отменено',
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
  // teacher-lessons-edit-status epic (2026-06-24) — kebab confirm state.
  const [pendingChange, setPendingChange] = useState<{
    row: PersonalEventRow
    toStatus: DealTargetStatus
  } | null>(null)
  const [changeBusy, setChangeBusy] = useState(false)
  // AbortController защита от race при mutation refetch (R3-#5 fix).
  const inflightRef = useRef<AbortController | null>(null)

  async function refresh() {
    inflightRef.current?.abort()
    const controller = new AbortController()
    inflightRef.current = controller
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/teacher/personal-events/history', {
        cache: 'no-store',
        signal: controller.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data?.message ?? 'Не удалось загрузить дела.')
        setRows([])
        return
      }
      setRows((data?.rows as PersonalEventRow[]) ?? [])
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить дела.')
    } finally {
      if (inflightRef.current === controller) {
        setBusy(false)
        inflightRef.current = null
      }
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  function openConfirm(row: PersonalEventRow, toStatus: DealTargetStatus) {
    setErr(null)
    setPendingChange({ row, toStatus })
  }

  async function submitChange() {
    if (!pendingChange) return
    const { row, toStatus } = pendingChange
    setChangeBusy(true)
    try {
      const res = await fetch(`/api/teacher/personal-events/${row.id}/change-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: toStatus, expectedUpdatedAt: row.updatedAt }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // B-4 fix: на 409 stale закрываем модалку и refetchим.
        if (res.status === 409) {
          setErr('Кто-то уже изменил статус. Обновляем…')
          setPendingChange(null)
          setChangeBusy(false)
          await refresh()
          return
        }
        setErr(data?.message ?? 'Не удалось изменить статус.')
        setChangeBusy(false)
        return
      }
      setPendingChange(null)
      setChangeBusy(false)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось изменить статус.')
      setChangeBusy(false)
    }
  }

  if (busy) {
    return (
      <section className="lc-section" data-testid="lesson-history-deals-loading">
        <p style={{ color: 'var(--secondary)', fontSize: 13 }}>Загружаем…</p>
      </section>
    )
  }

  // B-4 fix: ошибка показывается inline под list (см. ниже в return),
  // НЕ заменяет весь список через early return — раньше при 409 stale
  // весь список дел исчезал.

  if (rows.length === 0) {
    return (
      <section className="lc-section" data-testid="lesson-history-deals-empty">
        <EmptyState
          title="Дел пока нет"
          body="Добавьте дело из календаря — оно появится здесь, когда выполните или отмените."
        />
        {err ? (
          <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{err}</p>
        ) : null}
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
              {/* teacher-lessons-edit-status epic (2026-06-24) — kebab
                  для всех row статусов (нет gates для дел). */}
              {row.updatedAt ? (
                <StatusChangeMenu
                  kind="deal"
                  currentStatus={row.status}
                  onSelect={(target) => openConfirm(row, target)}
                />
              ) : null}
            </li>
          )
        })}
      </ul>

      {err ? (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>
          {err}
        </p>
      ) : null}

      {pendingChange ? (
        <StatusChangeConfirmModal
          kind="deal"
          subject={pendingChange.row.title}
          startAtFormatted={`${formatDate(pendingChange.row.startAt)} · ${pendingChange.row.durationMinutes} мин`}
          fromLabel={DEAL_STATUS_LABEL[pendingChange.row.status]}
          toLabel={DEAL_STATUS_LABEL[pendingChange.toStatus]}
          toStatus={pendingChange.toStatus}
          busy={changeBusy}
          onConfirm={() => void submitChange()}
          onCancel={() => {
            if (!changeBusy) setPendingChange(null)
          }}
        />
      ) : null}
    </section>
  )
}
