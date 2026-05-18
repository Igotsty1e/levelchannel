// SAAS-1 follow-up (2026-05-18) — pure-function palette lookup
// extracted from components/calendar/SlotBlock.tsx for the 5.D step
// of docs/plans/calendar-apple-redesign.md.
//
// Why extract: the palette table is the only logic in SlotBlock that
// is testable without a DOM. Lifting it out gives us node-env
// vitest coverage for the kind → palette mapping. Future move to
// a CSS-class-name-only API (per plan §5.D) lands as a follow-up;
// this step keeps the same RGBA values to minimise visual delta.
//
// Kind enum mirrors `CalendarRow['slot']['kind']` from
// `lib/calendar/view-model.ts`. Re-exported as `SlotKind` for the
// pure function signature without importing the entire view-model.

export type SlotKind =
  | 'open'
  | 'booked-self'
  | 'booked-other'
  | 'booked-full'
  | 'past-full'
  | 'past-redacted'

export type SlotPalette = {
  background: string
  border: string
  text: string
}

const OPEN_PALETTE: SlotPalette = {
  background: 'rgba(34, 197, 94, 0.15)',
  border: 'rgba(34, 197, 94, 0.5)',
  text: '#bbf7d0',
}

const BOOKED_SELF_PALETTE: SlotPalette = {
  background: 'rgba(59, 130, 246, 0.18)',
  border: 'rgba(59, 130, 246, 0.55)',
  text: '#bfdbfe',
}

const BOOKED_OTHER_PALETTE: SlotPalette = {
  background: 'rgba(107, 114, 128, 0.18)',
  border: 'rgba(107, 114, 128, 0.5)',
  text: '#d1d5db',
}

const PAST_PALETTE: SlotPalette = {
  background: 'rgba(75, 85, 99, 0.15)',
  border: 'rgba(75, 85, 99, 0.4)',
  text: '#9ca3af',
}

export const CONFLICT_PALETTE: SlotPalette = {
  background: 'rgba(239, 68, 68, 0.18)',
  border: 'rgba(239, 68, 68, 0.85)',
  text: '#fecaca',
}

/**
 * Resolve the palette for a slot kind. Conflict overlay must be
 * applied by the caller via CONFLICT_PALETTE — this function is
 * intentionally narrow on `kind` so the test matrix stays small.
 */
export function paletteForKind(kind: SlotKind): SlotPalette {
  switch (kind) {
    case 'open':
      return OPEN_PALETTE
    case 'booked-self':
      return BOOKED_SELF_PALETTE
    case 'booked-other':
    case 'booked-full':
      return BOOKED_OTHER_PALETTE
    case 'past-full':
    case 'past-redacted':
      return PAST_PALETTE
  }
}

/**
 * Resolve the palette for a row, applying the conflict overlay when
 * the slot is `booked-full` with `externalConflictAt` set. This is
 * the single seam the SlotBlock component reads — keeping the
 * conflict branch out of the component body makes both halves easy
 * to test in isolation.
 */
export function paletteForRow(input: {
  kind: SlotKind
  hasConflict: boolean
}): SlotPalette {
  if (input.hasConflict) return CONFLICT_PALETTE
  return paletteForKind(input.kind)
}
