'use client'

// Wave-2 lesson-history Sub-PR 3 (2026-06-16) — клиентский client island
// для /teacher/lessons. Содержит filters bar (period + status + learner)
// + responsive list (table desktop, card-list mobile) + pagination.
//
// 2026-06-19 post-deploy bug bash — kind state удалён, теперь URL
// (searchParams.kind) — single source of truth, page.tsx ветвится
// по kind, LessonHistoryClient рендерится только для kind=lessons.

import { useEffect, useRef, useState } from 'react'

import { Button, EmptyState, Pill } from '@/components/ui/primitives'

type PaymentStatus = 'paid_package' | 'paid_direct' | 'unpaid' | null

type Row = {
  id: string
  startAt: string
  durationMinutes: number
  status: string
  learnerAccountId: string | null
  tariffSlug?: string | null
  tariffAmountKopecks?: number | null
  isMarked: boolean
  paymentStatus?: PaymentStatus
}

type Learner = { id: string; label: string }

type Props = {
  initialRows: Row[]
  /** Map learnerAccountId → display label. Server hydrate. */
  learnerLabels: Record<string, string>
  /** Map learnerAccountId → name pair for combobox. */
  learnerOptions: Learner[]
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

function statusLabel(
  status: string,
  paymentStatus?: PaymentStatus,
): { label: string; tone: 'success' | 'warning' | 'danger' | 'default' } {
  switch (status) {
    case 'completed':
      if (paymentStatus === 'paid_package') {
        return { label: 'Проведено · оплачено (пакет)', tone: 'success' }
      }
      if (paymentStatus === 'paid_direct') {
        return { label: 'Проведено · оплачено', tone: 'success' }
      }
      return { label: 'Проведено', tone: 'success' }
    case 'no_show_learner':
      return { label: 'Не пришёл', tone: 'warning' }
    case 'no_show_teacher':
      return { label: 'Учитель не пришёл', tone: 'warning' }
    case 'cancelled':
      return { label: 'Отменено', tone: 'default' }
    case 'booked':
      if (paymentStatus === 'paid_package') {
        return { label: 'Оплачено (пакет)', tone: 'success' }
      }
      if (paymentStatus === 'paid_direct') {
        return { label: 'Оплачено', tone: 'success' }
      }
      return { label: 'Не оплачено', tone: 'warning' }
    default:
      return { label: status, tone: 'default' }
  }
}

function periodForChip(chip: 'week' | 'month' | 'all'): { from?: string; to?: string } {
  const now = new Date()
  if (chip === 'week') {
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    return { from: from.toISOString() }
  }
  if (chip === 'month') {
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    return { from: from.toISOString() }
  }
  return {}
}

export function LessonHistoryClient({
  initialRows,
  learnerLabels,
  learnerOptions,
}: Props) {
  const [rows, setRows] = useState<Row[]>(initialRows)
  const [busy, setBusy] = useState(false)
  const [periodChip, setPeriodChip] = useState<'week' | 'month' | 'all'>('month')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [learnerFilter, setLearnerFilter] = useState<string>('')
  const [unmarkedOnly, setUnmarkedOnly] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // wave-paranoia 2026-06-19: AbortController защищает от race — старый
  // ответ не перезатирает rows если пользователь быстро поменял фильтры.
  const inflightRef = useRef<AbortController | null>(null)

  function buildQs(): URLSearchParams {
    const qs = new URLSearchParams()
    const period = periodForChip(periodChip)
    if (period.from) qs.set('from', period.from)
    if (statusFilter) qs.set('status', statusFilter)
    if (learnerFilter) qs.set('learnerId', learnerFilter)
    if (unmarkedOnly) qs.set('unmarked', '1')
    qs.set('limit', '100')
    return qs
  }

  async function refresh() {
    inflightRef.current?.abort()
    const controller = new AbortController()
    inflightRef.current = controller
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/teacher/lessons/history?${buildQs().toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data?.message ?? 'Не удалось загрузить занятия.')
        return
      }
      setRows((data?.rows as Row[]) ?? [])
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить занятия.')
    } finally {
      if (inflightRef.current === controller) {
        setBusy(false)
        inflightRef.current = null
      }
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodChip, statusFilter, learnerFilter, unmarkedOnly])

  async function mark(slotId: string, kind: 'completed' | 'no-show') {
    const endpoint =
      kind === 'completed'
        ? `/api/teacher/slots/${slotId}/mark-completed`
        : `/api/teacher/slots/${slotId}/mark-no-show`
    const res = await fetch(endpoint, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setErr(data?.message ?? 'Не удалось отметить.')
      return
    }
    await refresh()
  }

  const csvHref = `/api/teacher/lessons/export.csv?${buildQs().toString()}`

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', paddingBottom: 80 }}>
      <section
        className="card lc-section"
        style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ChipBtn active={periodChip === 'week'} onClick={() => setPeriodChip('week')}>
            За 7 дней
          </ChipBtn>
          <ChipBtn active={periodChip === 'month'} onClick={() => setPeriodChip('month')}>
            За месяц
          </ChipBtn>
          <ChipBtn active={periodChip === 'all'} onClick={() => setPeriodChip('all')}>
            Все
          </ChipBtn>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={selectStyle}
            disabled={busy}
          >
            <option value="">Все статусы</option>
            <option value="completed">Проведено</option>
            <option value="no_show_learner">Ученик не пришёл</option>
            <option value="no_show_teacher">Учитель не пришёл</option>
            <option value="cancelled">Отменено</option>
            <option value="booked">Не оплачено</option>
          </select>
          <select
            value={learnerFilter}
            onChange={(e) => setLearnerFilter(e.target.value)}
            style={selectStyle}
            disabled={busy || learnerOptions.length === 0}
          >
            <option value="">Все ученики</option>
            {learnerOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
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
              checked={unmarkedOnly}
              onChange={(e) => setUnmarkedOnly(e.target.checked)}
              disabled={busy}
            />
            Только без отметки
          </label>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" href={csvHref}>
            Экспорт CSV
          </Button>
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
            title="Прошедших занятий пока нет."
            body="Попробуйте поменять фильтры или вернитесь позже."
          />
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {rows.map((row) => {
              const learner = row.learnerAccountId
                ? learnerLabels[row.learnerAccountId] ?? '—'
                : '—'
              const st = statusLabel(row.status, row.paymentStatus)
              const canMark = row.status === 'booked' && !row.isMarked
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
                    <span style={{ fontWeight: 500 }}>{learner}</span>
                    <span
                      style={{
                        color: 'var(--secondary)',
                        fontSize: 13,
                        marginLeft: 8,
                      }}
                    >
                      {formatDate(row.startAt)} · {row.durationMinutes} мин
                    </span>
                  </span>
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Pill tone={st.tone} size="sm">
                      {st.label}
                    </Pill>
                    {canMark ? (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => mark(row.id, 'completed')}
                          disabled={busy}
                        >
                          Провёл
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => mark(row.id, 'no-show')}
                          disabled={busy}
                        >
                          Не пришёл
                        </Button>
                      </>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
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
        color: active ? 'var(--accent)' : 'var(--primary)',
        fontSize: 14,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}
