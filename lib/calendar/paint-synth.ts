// Wave A PR3b — synthesize bulk-create payload from a paint span.
//
// Codex 2026-05-08 design: drag-paint generates back-to-back slots of
// uniform duration D ∈ {30, 60, 90, 120}. Restricting D to 30-min
// multiples guarantees every derived `start_at` lands on a 30-min
// boundary in MSK — the migration 0031 invariant. Other durations
// (e.g. 50 min for the existing pricing tariff) MUST go through the
// single-create row form, not paint.
//
// Algorithm:
//   1. Span = (toHalfHour - fromHalfHour + 1) × 30 min, in minutes.
//   2. Number of slots = floor(span / D). At most this many fit
//      back-to-back without crossing the upper bound.
//   3. Slot start times = fromHalfHour + i × (D/30) for i ∈ [0, N).
//   4. Each start is converted to an MSK wall-clock then to UTC ISO
//      via `mskWallToUtcIso`. The 30-min alignment of the start cell
//      + the 30-min step between starts means every emitted ISO is
//      :00 or :30 in MSK. Migration 0031 is happy.
//
// Returns null when no slot fits (span shorter than duration). The
// caller surfaces this as a UX hint instead of submitting an empty
// payload.

import {
  CALENDAR_GRID_START_HOUR,
  isValidYmd,
  mskWallToUtcIso,
} from './dates'

export const ALLOWED_PAINT_DURATIONS_MIN = [30, 60, 90, 120] as const

export type PaintDurationMinutes = (typeof ALLOWED_PAINT_DURATIONS_MIN)[number]

export type PaintSynthInput = {
  readonly ymd: string
  readonly fromHalfHour: number // 0..35 inclusive
  readonly toHalfHour: number // >= fromHalfHour, 0..35 inclusive
  readonly durationMinutes: PaintDurationMinutes
}

export type PaintSynthOutput = {
  readonly startsIso: ReadonlyArray<string>
  readonly startsHhmm: ReadonlyArray<string> // for the confirm dialog preview
}

function halfHourToHhmm(halfHour: number): string {
  const totalMin = CALENDAR_GRID_START_HOUR * 60 + halfHour * 30
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

export function synthesizePaintSlots(
  input: PaintSynthInput,
): PaintSynthOutput | null {
  if (!isValidYmd(input.ymd)) return null
  if (
    !ALLOWED_PAINT_DURATIONS_MIN.includes(input.durationMinutes)
  ) {
    return null
  }
  if (input.fromHalfHour < 0 || input.toHalfHour > 35) return null
  if (input.fromHalfHour > input.toHalfHour) return null

  const cellsPerSlot = input.durationMinutes / 30 // always integer for allowed durations
  const spanCells = input.toHalfHour - input.fromHalfHour + 1
  const slotCount = Math.floor(spanCells / cellsPerSlot)
  if (slotCount === 0) return null

  const startsHhmm: string[] = []
  const startsIso: string[] = []
  for (let i = 0; i < slotCount; i++) {
    const cell = input.fromHalfHour + i * cellsPerSlot
    const hhmm = halfHourToHhmm(cell)
    const iso = mskWallToUtcIso(input.ymd, hhmm)
    if (iso === null) {
      // mskWallToUtcIso only returns null on bad ymd/hhmm shapes.
      // We've validated ymd above and hhmm is computed from valid
      // half-hour cells in 06:00..23:30. This branch is unreachable
      // — but if it ever fires, fail closed instead of producing a
      // partial payload.
      return null
    }
    startsHhmm.push(hhmm)
    startsIso.push(iso)
  }
  return { startsIso, startsHhmm }
}
