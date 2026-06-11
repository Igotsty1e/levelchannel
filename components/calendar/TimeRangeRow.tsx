'use client'

import { TimePicker } from '@/components/ui/primitives'

// «От HH:mm → До HH:mm · N мин» row — drops into both the bulk modal
// (one row per interval) and the single modal (one row, no remove).
//
// «От» is per-row editable. «До» is computed from («От» + shared
// `durationMinutes`); editing «До» bumps the shared duration via
// `onDurationChange` (preserves the tariff invariant in
// `assertTariffDurationMatches`, which assumes one duration per
// bulk-create batch).
//
// 2026-06-11 (minute-duration epic): snap-to-allowed whitelist убран.
// «До» теперь поддерживает минутную точность (input type="time"
// step="60"). Длительность = (toMin - fromMin), wrap +24h если < 0.
// Backend `validateSlotInput` гейтит [15..180] минут.

const DURATION_MIN = 15
const DURATION_MAX = 180

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

function clampDuration(minutes: number): number {
  if (!Number.isFinite(minutes)) return DURATION_MIN
  if (minutes < DURATION_MIN) return DURATION_MIN
  if (minutes > DURATION_MAX) return DURATION_MAX
  return Math.round(minutes)
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
    onDurationChange(clampDuration(nextDuration))
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
      {/* minute-start epic A.3/A.4 (2026-06-11): «От» теперь DS TimePicker
          с granularity=1 — start_at тоже минутная точность после drop
          DB CHECK lesson_slots_start_30min_aligned (Sub-PR A.1). */}
      <TimePicker
        value={from}
        onChange={onFromChange}
        hourMin={6}
        hourMax={21}
        granularity={1}
        ariaLabel="От (время начала)"
      />
      <span aria-hidden="true" style={{ color: 'var(--secondary)', fontSize: 14 }}>
        →
      </span>
      <TimePicker
        value={to}
        onChange={handleToChange}
        hourMin={6}
        hourMax={22}
        granularity={1}
        ariaLabel="До (время окончания)"
      />
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
