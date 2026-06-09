'use client'

import { TimePickerButton } from './TimePickerButton'

// «От HH:mm → До HH:mm · N мин» row used in both single and bulk
// create-slot flows. «От» is per-row editable. «До» is derived from
// «От» + a shared duration owned by the parent form (so all rows in
// a bulk series share the same duration — matches the tariff
// invariant in `assertTariffDurationMatches`). Editing «До» bumps the
// shared duration up via the parent's `onDurationChange`.

const ALLOWED_DURATIONS_MIN = [30, 45, 60, 75, 90, 120] as const

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function minToHhmm(min: number): string {
  const hh = Math.floor(min / 60) % 24
  const mm = ((min % 60) + 60) % 60
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
  /**
   * Called when the user edits the «До» chip. Parent decides whether
   * to apply this as a new shared duration (bulk) or a one-off
   * duration on this row. The component itself is duration-agnostic;
   * it just emits the requested «До» value snapped to the allowed
   * duration whitelist.
   */
  onDurationChange: (nextDurationMinutes: number) => void
  /** Show a delete button. */
  allowRemove?: boolean
  onRemove?: () => void
  /** Inline error message (validation from parent). */
  error?: string | null
}

export function TimeRangeRow({
  from,
  durationMinutes,
  onFromChange,
  onDurationChange,
  allowRemove,
  onRemove,
  error,
}: TimeRangeRowProps) {
  const fromMin = hhmmToMin(from)
  const toMin = fromMin + durationMinutes
  const to = minToHhmm(toMin)

  function handleToChange(nextTo: string) {
    const nextToMin = hhmmToMin(nextTo)
    let nextDuration = nextToMin - fromMin
    if (nextDuration <= 0) {
      // wrap around (e.g. picker went «back»): treat as +24h then clamp
      nextDuration += 24 * 60
    }
    onDurationChange(snapToAllowedDuration(nextDuration))
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 12px',
        background: 'var(--bg)',
        border: `1px solid ${error ? 'var(--danger, #f87171)' : 'var(--border)'}`,
        borderRadius: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <TimePickerButton label="От" value={from} onSelect={onFromChange} />
        <span aria-hidden="true" style={{ color: 'var(--secondary)', fontSize: 16 }}>
          →
        </span>
        <TimePickerButton label="До" value={to} onSelect={handleToChange} />
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            color: 'var(--secondary)',
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
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--secondary)',
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
      {error ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--danger, #f87171)' }}>{error}</p>
      ) : null}
    </div>
  )
}
