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
  const draggable = kind === 'open' && onMouseDown !== undefined

  // Visible secondary line. Priority (top to bottom):
  //   • booked-full / booked-self with learner name → name
  //   • booked-other                                 → 'Занято'
  //   • past                                         → 'Прошло'
  //   • open                                         → null (palette is enough)
  // hasConflict is overlaid via the ⚠ glyph in the time row + red border.
  const secondaryLine = secondaryFor(row)
  const tariff = tariffBadge(row)

  // Conditional density: on a 30-min slot (h ≈ 30px) only the time line
  // fits; on 45-min hide secondary; on 60+ show everything that exists.
  const h = row.heightPx
  const showTariff = !!tariff && h >= 50
  const showSecondary = !!secondaryLine && h >= 40

  const ariaLabel = hasConflict
    ? `Занятие ${row.startLabel}–${row.endLabel}${secondaryLine ? ', ' + secondaryLine : ''}, конфликт с Google Calendar`
    : `Занятие ${row.startLabel}–${row.endLabel}${secondaryLine ? ', ' + secondaryLine : ''}`

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
        zIndex: 2,
        transition: 'background-color 120ms ease-out',
        fontVariantNumeric: 'tabular-nums',
      }}
      title={
        hasConflict
          ? `${row.startLabel} – ${row.endLabel} · конфликт с Google Calendar`
          : `${row.startLabel} – ${row.endLabel}`
      }
      aria-label={ariaLabel}
    >
      <div style={{ fontWeight: 600 }}>
        {hasConflict && (
          <span aria-hidden="true" style={{ marginRight: 4 }}>
            ⚠
          </span>
        )}
        {row.startLabel} – {row.endLabel}
      </div>
      {showSecondary ? (
        <div style={{ fontSize: 11, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {secondaryLine}
        </div>
      ) : null}
      {showTariff ? (
        <div style={{ fontSize: 11, opacity: 0.7 }}>{tariff}</div>
      ) : null}
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

function secondaryFor(row: CalendarRow): string | null {
  const slot = row.slot
  if (slot.kind === 'open') return null
  if (slot.kind === 'booked-other') return 'Занято'
  if (slot.kind === 'past-full' || slot.kind === 'past-redacted') return 'Прошло'
  // booked-self / booked-full — try to surface a human name when present.
  if ('learnerDisplayName' in slot && slot.learnerDisplayName) {
    return String(slot.learnerDisplayName)
  }
  if ('learnerEmail' in slot && slot.learnerEmail) {
    return String(slot.learnerEmail)
  }
  return slot.kind === 'booked-self' ? 'Ваше занятие' : 'Занято'
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
