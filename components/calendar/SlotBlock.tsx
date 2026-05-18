'use client'

import { paletteForRow, type SlotKind } from '@/lib/calendar/palette'
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
  const palette = paletteForRow({ kind: kind as SlotKind, hasConflict })
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
        // SAAS-1: Apple-chip styling — accent stroke on the left,
        // tinted bg via color-mix() against the accent stroke color,
        // no full border (just the left accent + faint right tint).
        background: palette.background,
        border: 'none',
        borderLeft: `3px solid ${palette.border}`,
        borderRadius: 6,
        padding: '4px 8px 4px 10px',
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
        transition: 'background-color 120ms ease-out',
        fontVariantNumeric: 'tabular-nums',
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
