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
// BCS-B.1 — learner's Calendly-confirm comment cap. Generous enough for a
// short paragraph but small enough that abusive payloads can't poison
// the slot row.
export const MAX_AGENDA_LEN = 1000

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
  agenda,
  zoom_url,
  external_conflict_at,
  external_conflict_kind,
  conflict_source_calendar_id,
  conflict_source_event_id,
  source,
  personal_event_title,
  personal_event_body,
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
    // BCS-B.1 — read agenda when present. Queries that pre-date this
    // field don't include the column in their SELECT, in which case
    // row.agenda is undefined → null projection. Backward compatible.
    agenda: row.agenda ? String(row.agenda) : null,
    // BCS-F.3 — conflict metadata. Same backward-compat shape: queries
    // that don't select these columns get null.
    externalConflictAt: row.external_conflict_at
      ? new Date(String(row.external_conflict_at)).toISOString()
      : null,
    externalConflictKind: row.external_conflict_kind
      ? String(row.external_conflict_kind)
      : null,
    conflictSourceCalendarId: row.conflict_source_calendar_id
      ? String(row.conflict_source_calendar_id)
      : null,
    conflictSourceEventId: row.conflict_source_event_id
      ? String(row.conflict_source_event_id)
      : null,
    // BCS-DEF-3 — backward-compat: SELECTs that pre-date the column
    // don't include it; row.zoom_url is undefined → null projection.
    zoomUrl: row.zoom_url ? String(row.zoom_url) : null,
    // 0122 — direct-assign discriminator. NULL → legacy open_slot.
    // Epic B (2026-06-19) — 'personal_event' добавлен в enum.
    source:
      row.source === 'open_slot' ||
      row.source === 'direct_assign' ||
      row.source === 'personal_event'
        ? row.source
        : null,
    // Epic B — дело учителя: title + body.
    personalEventTitle: row.personal_event_title
      ? String(row.personal_event_title)
      : null,
    personalEventBody: row.personal_event_body
      ? String(row.personal_event_body)
      : null,
    events: Array.isArray(row.events)
      ? (row.events as SlotEvent[])
      : [],
    // 2026-06-24 race-window fix (WARN от wave round 2): убрали String()
    // cast — он конвертировал pg Date через locale string и терял
    // миллисекунды. Без String() — pg Date проходит через `new Date()`
    // identity-конвертацией и .toISOString() даёт full-precision ISO.
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
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
