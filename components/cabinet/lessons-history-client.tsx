'use client'

// 2026-06-17 — client-island для /cabinet/lessons. Аналог
// LessonHistoryClient из teacher cabinet.
//
// Фильтры: период (chip group) + статус (select) + только без оплаты
// (checkbox). Рефетчит /api/learner/lessons/history при изменении.

import { useEffect, useState } from 'react'

import { Button, EmptyState, Pill } from '@/components/ui/primitives'

type Row = {
  id: string
  startAt: string
  durationMinutes: number
  status: string
  teacherEmail: string | null
  tariffTitleRu: string | null
  tariffAmountKopecks: number | null
  isPaid: boolean
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

function statusLabel(status: string, isPaid: boolean): { label: string; tone: 'success' | 'warning' | 'danger' | 'default' } {
  switch (status) {
    case 'completed':
      return { label: isPaid ? 'Проведено · оплачено' : 'Проведено', tone: 'success' }
    case 'no_show_learner':
      return { label: 'Вы не пришли', tone: 'warning' }
    case 'no_show_teacher':
      return { label: 'Учитель не пришёл', tone: 'warning' }
    case 'cancelled':
      return { label: 'Отменено', tone: 'default' }
    case 'booked':
      if (isPaid) return { label: 'Оплачено', tone: 'success' }
      if (new Date().getTime() > Date.now()) return { label: 'Запланировано', tone: 'default' }
      return { label: 'Не оплачено', tone: 'warning' }
    default:
      return { label: status, tone: 'default' }
  }
}

function periodForChip(chip: 'week' | 'month' | 'all'): { from?: string } {
  const now = Date.now()
  if (chip === 'week') return { from: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString() }
  if (chip === 'month') return { from: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString() }
  return {}
}

export function LessonHistoryClient({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initialRows)
  const [busy, setBusy] = useState(false)
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('month')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [unpaidOnly, setUnpaidOnly] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function buildQs(): URLSearchParams {
    const qs = new URLSearchParams()
    const p = periodForChip(period)
    if (p.from) qs.set('from', p.from)
    if (statusFilter) qs.set('status', statusFilter)
    if (unpaidOnly) qs.set('unpaid', '1')
    qs.set('limit', '200')
    return qs
  }

  async function refresh() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/learner/lessons/history?${buildQs().toString()}`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data?.message ?? 'Не удалось загрузить занятия.')
        return
      }
      setRows((data?.rows as Row[]) ?? [])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, statusFilter, unpaidOnly])

  return (
    <>
      <section
        className="card lc-section"
        style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ChipBtn active={period === 'week'} onClick={() => setPeriod('week')}>
            За 7 дней
          </ChipBtn>
          <ChipBtn active={period === 'month'} onClick={() => setPeriod('month')}>
            За месяц
          </ChipBtn>
          <ChipBtn active={period === 'all'} onClick={() => setPeriod('all')}>
            Все
          </ChipBtn>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={selectStyle}
            disabled={busy}
          >
            <option value="">Все статусы</option>
            <option value="completed">Проведено</option>
            <option value="cancelled">Отменено</option>
            <option value="booked">Запланировано</option>
            <option value="no_show_learner">Вы не пришли</option>
            <option value="no_show_teacher">Учитель не пришёл</option>
          </select>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 14,
              color: 'var(--secondary)',
            }}
          >
            <input
              type="checkbox"
              checked={unpaidOnly}
              onChange={(e) => setUnpaidOnly(e.target.checked)}
              disabled={busy}
            />
            Только без оплаты
          </label>
        </div>
      </section>

      {err ? (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>
          {err}
        </p>
      ) : null}

      <section className="lc-section">
        {rows.length === 0 ? (
          <EmptyState
            title="Занятий не найдено."
            body="Попробуйте поменять фильтры или вернитесь позже."
          />
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {rows.map((row) => {
              const st = statusLabel(row.status, row.isPaid)
              return (
                <li
                  key={row.id}
                  className="card"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 12,
                    padding: 16,
                    marginBottom: 8,
                    fontSize: 14,
                  }}
                >
                  <span style={{ minWidth: 0, flex: '1 1 200px' }}>
                    <span style={{ fontWeight: 500 }}>
                      {formatDate(row.startAt)} · {row.durationMinutes} мин
                    </span>
                    {row.tariffTitleRu ? (
                      <span
                        style={{
                          color: 'var(--secondary)',
                          fontSize: 13,
                          marginLeft: 8,
                        }}
                      >
                        · {row.tariffTitleRu}
                      </span>
                    ) : null}
                  </span>
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                    <Pill tone={st.tone} size="sm">
                      {st.label}
                    </Pill>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

const selectStyle: React.CSSProperties = {
  height: 36,
  padding: '0 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontSize: 14,
}

function ChipBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 36,
        padding: '0 14px',
        borderRadius: 18,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'var(--accent-soft, rgba(0,0,0,0.05))' : 'var(--surface)',
        color: active ? 'var(--accent)' : 'var(--text)',
        fontSize: 14,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}
