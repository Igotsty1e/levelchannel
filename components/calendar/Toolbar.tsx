'use client'

// Wave A — week navigation + lastUpdatedAt + refresh button.
// Codex round 1 #21 + round 4: `lastUpdatedAt` shown prominently,
// refresh forces a refetch, mutation paths trigger forced refetch
// (wired in PR3).
//
// 2026-06-23 — single-row header epic. CTAs from page client
// (`+ Назначить ученику` / `+ Слоты` / `+ Дело`) теперь приходят
// через `headerActions` slot и рендерятся справа от tools cluster,
// одной строкой с range + nav + refresh. Mobile: Альтернатива A —
// 4 stacked rows (range + refresh / nav / updated / actions grid).

import type { ReactNode } from 'react'

export type ToolbarProps = {
  fromYmd: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onRefresh: () => void
  lastUpdatedAt: Date | null
  loading: boolean
  /** Page-level CTAs rendered справа от tools cluster (right cluster). */
  headerActions?: ReactNode
}

export function Toolbar({
  fromYmd,
  onPrev,
  onNext,
  onToday,
  onRefresh,
  lastUpdatedAt,
  loading,
  headerActions,
}: ToolbarProps) {
  const lastLabel = lastUpdatedAt
    ? `Обновлено ${formatRelative(lastUpdatedAt)}`
    : '—'

  return (
    <div
      role="toolbar"
      aria-label="Управление календарём"
      className="calendar-header"
    >
      {/* Left cluster: range + nav + updated + refresh */}
      <div className="calendar-header-left">
        <h2 className="calendar-header-range" aria-live="polite">
          {formatWeekRangeRu(fromYmd)}
        </h2>
        <div className="calendar-header-nav">
          <button
            type="button"
            onClick={onPrev}
            disabled={loading}
            style={btnStyle()}
            aria-label="Предыдущая неделя"
          >
            ←
          </button>
          <button type="button" onClick={onToday} disabled={loading} style={btnStyle()}>
            Сегодня
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={loading}
            style={btnStyle()}
            aria-label="Следующая неделя"
          >
            →
          </button>
        </div>
        <span className="calendar-header-updated">{lastLabel}</span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          style={btnStyle()}
          aria-label="Обновить календарь"
          className="calendar-header-refresh-btn"
        >
          {loading ? 'Загружаем…' : '↻'}
        </button>
      </div>

      {/* Right cluster: page-level CTA buttons (optional) */}
      {headerActions ? (
        <div className="calendar-header-actions">{headerActions}</div>
      ) : null}
    </div>
  )
}

function btnStyle(): React.CSSProperties {
  return {
    padding: '6px 12px',
    fontSize: 13,
    background: 'var(--surface-2, rgba(255,255,255,0.05))',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text)',
    cursor: 'pointer',
    lineHeight: 1.2,
  }
}

function formatWeekRangeRu(fromYmd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromYmd)
  if (!m) return fromYmd
  const [, ys, ms, ds] = m
  const start = new Date(Date.UTC(Number(ys), Number(ms) - 1, Number(ds)))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const sameMonth = start.getUTCMonth() === end.getUTCMonth()
  const sameYear = new Date().getUTCFullYear() === start.getUTCFullYear()

  // Intl.DateTimeFormat with { day, month } in ru-RU returns the
  // genitive form ("7 июня"), which is what we want for date ranges
  // — { month: 'long' } alone returns the nominative ("июнь").
  const formatDayMonth = (d: Date) =>
    new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(d) // → "7 июня"

  if (sameMonth) {
    const startDay = start.getUTCDate()
    const endDayMonth = formatDayMonth(end) // → "13 июня"
    const yearTail = sameYear ? '' : ` ${end.getUTCFullYear()}`
    return `${startDay}–${endDayMonth}${yearTail}`
  }
  const yearTail = sameYear ? '' : ` ${end.getUTCFullYear()}`
  return `${formatDayMonth(start)} – ${formatDayMonth(end)}${yearTail}`
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime()
  const sec = Math.round(ms / 1000)
  if (sec < 5) return 'только что'
  if (sec < 60) return `${sec} сек назад`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} мин назад`
  const hr = Math.round(min / 60)
  return `${hr} ч назад`
}
