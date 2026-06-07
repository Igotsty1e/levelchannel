// Server-rendered summary that sits between the page header and the
// calendar grid. Replaces the old «Тяните по сетке…» instructional
// paragraph + two stacked banners with a single information-dense row
// that answers the questions a tutor opens the calendar to ask:
//
//   - Что у меня сегодня?
//   - Когда ближайшее занятие?
//   - Сколько занятий и сколько ожидается денег?
//   - Есть ли конфликты / скрытые от учеников окна?
//   - Где настройки календаря?
//
// Pure read; no mutations, no client state.

import Link from 'next/link'

import { Pill } from '@/components/ui/primitives'

export type CalendarSummaryProps = {
  todayCount: number
  nextSlot: { label: string; hhmm: string; dayLabel: string } | null
  weekBookedCount: number
  weekOpenCount: number
  weekEarningsKopecks: number | null
  conflictCount: number
  hiddenCount: number
  todayLabel: string // «воскресенье, 7 июня»
}

export function CalendarSummary({
  todayCount,
  nextSlot,
  weekBookedCount,
  weekOpenCount,
  weekEarningsKopecks,
  conflictCount,
  hiddenCount,
  todayLabel,
}: CalendarSummaryProps) {
  const earningsLabel =
    weekEarningsKopecks !== null && weekEarningsKopecks > 0
      ? `${Math.round(weekEarningsKopecks / 100).toLocaleString('ru-RU')} ₽`
      : null

  return (
    <section
      aria-label="Сводка по календарю"
      className="calendar-summary"
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
        gap: 16,
        padding: '14px 18px',
        marginBottom: 16,
        background: 'var(--surface-1, #141416)',
        border: '1px solid var(--border)',
        borderRadius: 12,
      }}
    >
      {/* Top-right settings link — replaces the standalone "⚙ Настройки"
          button that used to live above the toolbar. */}
      <Link
        href="/teacher/settings/calendar"
        className="calendar-summary-settings"
        aria-label="Настройки календаря"
        title="Настройки календаря"
        style={{
          position: 'absolute',
          top: 10,
          right: 12,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 999,
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'var(--secondary)',
          fontSize: 12,
          fontWeight: 500,
          textDecoration: 'none',
          lineHeight: 1.2,
        }}
      >
        <span aria-hidden="true">⚙</span>
        Настройки
      </Link>

      {/* Block 1 — today */}
      <div>
        <div style={{ fontSize: 12, color: 'var(--secondary)', marginBottom: 4 }}>
          {todayLabel}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
          {todayCount === 0
            ? 'На сегодня занятий нет'
            : `Сегодня ${todayCount} ${pluralRu(todayCount, 'занятие', 'занятия', 'занятий')}`}
        </div>
      </div>

      {/* Block 2 — next */}
      <div>
        <div style={{ fontSize: 12, color: 'var(--secondary)', marginBottom: 4 }}>
          Следующее
        </div>
        {nextSlot ? (
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
            <span>{nextSlot.dayLabel}, </span>
            <span>{nextSlot.hhmm}</span>
            <span style={{ marginLeft: 8, fontWeight: 500, color: 'var(--secondary)' }}>
              · {nextSlot.label}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 14, color: 'var(--secondary)' }}>
            Ближайших занятий нет
          </div>
        )}
      </div>

      {/* Block 3 — week + earnings + pills */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--secondary)', marginBottom: 4 }}>
          На неделе
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text)',
            fontVariantNumeric: 'tabular-nums',
            display: 'flex',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          <span>
            {weekBookedCount} {pluralRu(weekBookedCount, 'занятие', 'занятия', 'занятий')}
          </span>
          {earningsLabel ? (
            <span style={{ color: 'var(--accent, #D88A82)' }}>· {earningsLabel}</span>
          ) : null}
        </div>
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
            fontSize: 12,
            color: 'var(--secondary)',
          }}
        >
          {weekOpenCount > 0 ? (
            <span>
              {weekOpenCount} {pluralRu(weekOpenCount, 'свободное окно', 'свободных окна', 'свободных окон')}
            </span>
          ) : null}
          {conflictCount > 0 ? (
            <Link
              href="/teacher/settings/calendar"
              style={{ textDecoration: 'none' }}
              title="Открыть настройки календаря"
            >
              <Pill tone="danger" size="sm">
                ⚠ {conflictCount} {pluralRu(conflictCount, 'конфликт', 'конфликта', 'конфликтов')}
              </Pill>
            </Link>
          ) : null}
          {hiddenCount > 0 ? (
            <Link
              href="/teacher/settings/calendar"
              style={{ textDecoration: 'none' }}
              title="Свободные окна, пересекающиеся с Google — ученики их не видят"
            >
              <Pill tone="warning" size="sm">
                🗓 {hiddenCount} скрыто
              </Pill>
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
