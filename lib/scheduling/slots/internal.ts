// Wave 39 internal helpers for the scheduling/slots folder.
// Exports here are for SIBLING modules in lib/scheduling/slots/ only;
// they are intentionally NOT re-exported from index.ts. Keeping them
// here lets each external-facing module avoid redefining the SQL
// column list, the row mapper, or the event-blob shape.

import type { LessonSlot, SlotEvent, SlotStatus } from './types'

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_NOTES_LEN = 500
export const MAX_REASON_LEN = 500

export const SLOT_COLUMNS = `
  id,
  teacher_account_id,
  start_at,
  duration_minutes,
  status,
  learner_account_id,
  booked_at,
  cancelled_at,
  cancelled_by_account_id,
  cancellation_reason,
  marked_at,
  tariff_id,
  notes,
  events,
  created_at,
  updated_at
`

export function rowToSlot(
  row: Record<string, unknown>,
  extra: {
    teacherEmail?: string | null
    learnerEmail?: string | null
    tariffSlug?: string | null
    tariffTitleRu?: string | null
    tariffAmountKopecks?: number | null
  } = {},
): LessonSlot {
  return {
    id: String(row.id),
    teacherAccountId: String(row.teacher_account_id),
    teacherEmail: extra.teacherEmail ?? null,
    startAt: new Date(String(row.start_at)).toISOString(),
    durationMinutes: Number(row.duration_minutes),
    status: String(row.status) as SlotStatus,
    learnerAccountId: row.learner_account_id
      ? String(row.learner_account_id)
      : null,
    learnerEmail: extra.learnerEmail ?? null,
    bookedAt: row.booked_at
      ? new Date(String(row.booked_at)).toISOString()
      : null,
    cancelledAt: row.cancelled_at
      ? new Date(String(row.cancelled_at)).toISOString()
      : null,
    cancelledByAccountId: row.cancelled_by_account_id
      ? String(row.cancelled_by_account_id)
      : null,
    cancellationReason: row.cancellation_reason
      ? String(row.cancellation_reason)
      : null,
    markedAt: row.marked_at
      ? new Date(String(row.marked_at)).toISOString()
      : null,
    tariffId: row.tariff_id ? String(row.tariff_id) : null,
    tariffSlug: extra.tariffSlug ?? null,
    tariffTitleRu: extra.tariffTitleRu ?? null,
    tariffAmountKopecks: extra.tariffAmountKopecks ?? null,
    notes: row.notes ? String(row.notes) : null,
    events: Array.isArray(row.events)
      ? (row.events as SlotEvent[])
      : [],
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

export function appendEventSql(
  eventType: string,
  actor: string | null,
  payload?: Record<string, unknown>,
) {
  const event = {
    type: eventType,
    at: new Date().toISOString(),
    actor,
    ...(payload ? { payload } : {}),
  }
  return JSON.stringify([event])
}
