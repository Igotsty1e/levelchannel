'use client'

import type { CalendarRow } from '@/lib/calendar/view-model'

// Wave A — single slot block, kind-aware visuals. Uses absolute
// positioning with pixel math from view-model so a 50-min slot is
// rendered as a 50px-tall block (PX_PER_MIN = 1px) regardless of
// half-hour grid alignment.
//
// Click → onClick(slot) — modal in the parent decides what to show.
//
// BCS-F.3: a `booked-full` slot with `externalConflictAt` set renders
// with a red outline + ⚠ glyph. The conflict palette overrides the
// grey "booked" palette so the teacher can spot conflicts at a glance.

export type SlotBlockProps = {
  row: CalendarRow
  onClick?: (row: CalendarRow) => void
  // PR3b — when present, fires on mousedown to start a drag-move.
  // Parent decides via threshold whether the mouseup ends as a click
  // (no drift) or a move commit (drift past origin cell).
  onMouseDown?: (row: CalendarRow, e: React.MouseEvent<HTMLButtonElement>) => void
}

export function SlotBlock({ row, onClick, onMouseDown }: SlotBlockProps) {
  const kind = row.slot.kind
  const hasConflict = slotHasConflict(row)
  const palette = hasConflict ? CONFLICT_PALETTE : paletteForKind(kind)
  // Only `open` slots are movable per the data layer (booked /
  // completed / cancelled are immovable). Wiring layer mirrors this:
  // we ONLY emit onMouseDown when the slot is `open` AND the parent
  // is interested. Click handler still fires for every kind.
  const draggable = kind === 'open' && onMouseDown !== undefined
  const label = hasConflict ? `${kindLabel(kind)} · конфликт` : kindLabel(kind)

  return (
    <button
      type="button"
      onClick={() => onClick?.(row)}
      onMouseDown={draggable ? (e) => onMouseDown!(row, e) : undefined}
      className={`calendar-slot-block calendar-slot-${kind}${
        hasConflict ? ' calendar-slot-conflict' : ''
      }`}
      style={{
        position: 'absolute',
        top: `${row.topPx}px`,
        height: `${row.heightPx}px`,
        left: '4px',
        right: '4px',
        background: palette.background,
        border: `${hasConflict ? '2px' : '1px'} solid ${palette.border}`,
        borderRadius: 6,
        padding: '4px 8px',
        cursor: draggable ? 'grab' : 'pointer',
        textAlign: 'left',
        color: palette.text,
        fontSize: 12,
        lineHeight: 1.3,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        overflow: 'hidden',
        zIndex: 2, // above grid background so highlights render under
      }}
      title={
        hasConflict
          ? `${row.startLabel} – ${row.endLabel} · конфликт с событием в Google Calendar`
          : `${row.startLabel} – ${row.endLabel}`
      }
      aria-label={`Слот ${row.startLabel}–${row.endLabel}, ${label}`}
    >
      <div style={{ fontWeight: 600 }}>
        {hasConflict && (
          <span aria-hidden="true" style={{ marginRight: 4 }}>
            ⚠
          </span>
        )}
        {row.startLabel} – {row.endLabel}
      </div>
      {tariffBadge(row) && (
        <div style={{ fontSize: 11, opacity: 0.85 }}>{tariffBadge(row)}</div>
      )}
      <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
    </button>
  )
}

function slotHasConflict(row: CalendarRow): boolean {
  const slot = row.slot
  return (
    slot.kind === 'booked-full' &&
    'externalConflictAt' in slot &&
    slot.externalConflictAt !== null
  )
}

const CONFLICT_PALETTE = {
  background: 'rgba(239, 68, 68, 0.18)',
  border: 'rgba(239, 68, 68, 0.85)',
  text: '#fecaca',
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
