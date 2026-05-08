'use client'

import type { CalendarRow } from '@/lib/calendar/view-model'

// Wave A — single slot block, kind-aware visuals. Uses absolute
// positioning with pixel math from view-model so a 50-min slot is
// rendered as a 50px-tall block (PX_PER_MIN = 1px) regardless of
// half-hour grid alignment.
//
// Click → onClick(slot) — modal in the parent decides what to show.

export type SlotBlockProps = {
  row: CalendarRow
  onClick?: (row: CalendarRow) => void
}

export function SlotBlock({ row, onClick }: SlotBlockProps) {
  const kind = row.slot.kind
  const palette = paletteForKind(kind)

  return (
    <button
      type="button"
      onClick={() => onClick?.(row)}
      className={`calendar-slot-block calendar-slot-${kind}`}
      style={{
        position: 'absolute',
        top: `${row.topPx}px`,
        height: `${row.heightPx}px`,
        left: '4px',
        right: '4px',
        background: palette.background,
        border: `1px solid ${palette.border}`,
        borderRadius: 6,
        padding: '4px 8px',
        cursor: 'pointer',
        textAlign: 'left',
        color: palette.text,
        fontSize: 12,
        lineHeight: 1.3,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        overflow: 'hidden',
      }}
      title={`${row.startLabel} – ${row.endLabel}`}
      aria-label={`Слот ${row.startLabel}–${row.endLabel}, ${kindLabel(kind)}`}
    >
      <div style={{ fontWeight: 600 }}>
        {row.startLabel} – {row.endLabel}
      </div>
      {tariffBadge(row) && (
        <div style={{ fontSize: 11, opacity: 0.85 }}>{tariffBadge(row)}</div>
      )}
      <div style={{ fontSize: 11, opacity: 0.7 }}>{kindLabel(kind)}</div>
    </button>
  )
}

function paletteForKind(kind: CalendarRow['slot']['kind']) {
  switch (kind) {
    case 'open':
      return {
        background: 'rgba(34, 197, 94, 0.15)',
        border: 'rgba(34, 197, 94, 0.5)',
        text: '#bbf7d0',
      }
    case 'booked-self':
      return {
        background: 'rgba(59, 130, 246, 0.18)',
        border: 'rgba(59, 130, 246, 0.55)',
        text: '#bfdbfe',
      }
    case 'booked-other':
    case 'booked-full':
      return {
        background: 'rgba(107, 114, 128, 0.18)',
        border: 'rgba(107, 114, 128, 0.5)',
        text: '#d1d5db',
      }
    case 'past-full':
    case 'past-redacted':
      return paletteForPast(kind === 'past-full' ? (undefined as unknown as 'completed') : 'completed')
  }
}

function paletteForPast(_status: string) {
  return {
    background: 'rgba(75, 85, 99, 0.15)',
    border: 'rgba(75, 85, 99, 0.4)',
    text: '#9ca3af',
  }
}

function kindLabel(kind: CalendarRow['slot']['kind']): string {
  switch (kind) {
    case 'open':
      return 'Доступен'
    case 'booked-self':
      return 'Ваше занятие'
    case 'booked-other':
      return 'Занято'
    case 'booked-full':
      return 'Забронировано'
    case 'past-full':
    case 'past-redacted':
      return 'Прошедшее'
  }
}

function tariffBadge(row: CalendarRow): string | null {
  const slot = row.slot
  if (slot.kind === 'booked-other' || slot.kind === 'past-redacted') return null
  if (
    'tariffAmountKopecks' in slot &&
    slot.tariffAmountKopecks !== null &&
    slot.tariffAmountKopecks !== undefined
  ) {
    const rub = Math.round(slot.tariffAmountKopecks / 100)
    return `${rub.toLocaleString('ru-RU')} ₽`
  }
  return null
}
