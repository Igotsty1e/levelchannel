'use client'

import { TimePickerButton } from './TimePickerButton'

// «От HH:mm → До HH:mm · N мин» row — drops into both the bulk modal
// (one row per interval) and the single modal (one row, no remove).
//
// «От» is per-row editable. «До» is computed from («От» + shared
// `durationMinutes`); editing «До» bumps the shared duration via
// `onDurationChange` (preserves the tariff invariant in
// `assertTariffDurationMatches`, which assumes one duration per
// bulk-create batch).
//
// New duration is snapped to the ALLOWED whitelist (matches
// `lib/calendar/recurrence.ts`).

const ALLOWED_DURATIONS_MIN = [30, 45, 50, 60, 75, 90, 120] as const

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minToHhmm(min: number): string {
  const safe = ((min % (24 * 60)) + 24 * 60) % (24 * 60)
  const hh = Math.floor(safe / 60)
  const mm = safe % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function snapToAllowedDuration(minutes: number): number {
  if (minutes <= ALLOWED_DURATIONS_MIN[0]) return ALLOWED_DURATIONS_MIN[0]
  for (const d of ALLOWED_DURATIONS_MIN) {
    if (d >= minutes) return d
  }
  return ALLOWED_DURATIONS_MIN[ALLOWED_DURATIONS_MIN.length - 1]
}

export type TimeRangeRowProps = {
  from: string // HH:mm
  durationMinutes: number
  onFromChange: (next: string) => void
  onDurationChange: (nextDurationMinutes: number) => void
  allowRemove?: boolean
  onRemove?: () => void
}

export function TimeRangeRow({
  from,
  durationMinutes,
  onFromChange,
  onDurationChange,
  allowRemove,
  onRemove,
}: TimeRangeRowProps) {
  const fromMin = hhmmToMin(from)
  const to = minToHhmm(fromMin + durationMinutes)

  function handleToChange(nextTo: string) {
    const nextToMin = hhmmToMin(nextTo)
    let nextDuration = nextToMin - fromMin
    if (nextDuration <= 0) nextDuration += 24 * 60
    onDurationChange(snapToAllowedDuration(nextDuration))
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
      }}
    >
      <TimePickerButton label="От" value={from} onSelect={onFromChange} />
      <span aria-hidden="true" style={{ color: 'var(--secondary)', fontSize: 14 }}>
        →
      </span>
      <TimePickerButton label="До" value={to} onSelect={handleToChange} />
      <span
        style={{
          fontSize: 12,
          color: 'var(--secondary)',
          marginLeft: 'auto',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {durationMinutes} мин
      </span>
      {allowRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Удалить интервал"
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text)',
            cursor: 'pointer',
            fontSize: 18,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}
