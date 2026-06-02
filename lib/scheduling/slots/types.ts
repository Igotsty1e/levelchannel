// Public type surface + lifecycle constants for the scheduling/slots
// module. Wave 39: extracted from the former single-file
// lib/scheduling/slots.ts so siblings can share the same shapes
// without cycle risk.

// Codex Wave 13 Pass 2 #22. Named MSK business-band constants so the
// admin/teacher move routes don't carry inline 6/22/30 magic numbers
// each side has to keep in sync. Mirrors the DB CHECK invariants from
// migration 0031 (lesson_slots_domain_invariants.sql).
export const MSK_BUSINESS_HOUR_MIN = 6 // 06:00 MSK inclusive
export const MSK_BUSINESS_HOUR_MAX = 22 // 22:00 MSK exclusive (i.e. last slot starts ≤ 22:00)
export const SLOT_GRID_MINUTES = 30 // half-hour grid

export type SlotStartValidationError =
  | { code: 'slot/start_out_of_band'; message: string }
  | { code: 'slot/start_not_30min_aligned'; message: string }

export type SlotStatus =
  | 'open'
  | 'booked'
  | 'cancelled'
  | 'completed'
  | 'no_show_learner'
  | 'no_show_teacher'

// Statuses that the operator can stamp on a booked slot whose start
// has already passed. Phase 5 lifecycle.
export type SlotLifecycleStatus =
  | 'completed'
  | 'no_show_learner'
  | 'no_show_teacher'

export const LIFECYCLE_STATUSES: SlotLifecycleStatus[] = [
  'completed',
  'no_show_learner',
  'no_show_teacher',
]

export const TERMINAL_STATUSES: SlotStatus[] = [
  'cancelled',
  'completed',
  'no_show_learner',
  'no_show_teacher',
]

// Phase 5 — 24-hour rule: a learner can cancel only if start_at is
// at least N hours away, where N is governed by
// LEARNER_CANCEL_WINDOW_HOURS (default 24) via lib/scheduling/policy.ts
// since POLICY-KNOBS (2026-05-17). Operator/admin paths bypass this
// — they have the override.
//
// Pure function so the cabinet UI can check it client-side too. The
// client receives the materialised window as a prop from a server
// component; see app/cabinet/lessons-section.tsx for the wire.
import { getLearnerCancelThresholdMs } from '@/lib/scheduling/policy'

export type LearnerCancelDecision =
  | { ok: true }
  | { ok: false; reason: 'already_terminal' | 'too_late_to_cancel'; minutesUntilStart?: number }

export function canLearnerCancel(
  slot: { status: SlotStatus; startAt: string },
  nowMs = Date.now(),
): LearnerCancelDecision {
  if (slot.status !== 'booked') {
    return { ok: false, reason: 'already_terminal' }
  }
  const startMs = new Date(slot.startAt).getTime()
  if (Number.isNaN(startMs)) {
    return { ok: false, reason: 'already_terminal' }
  }
  const diffMs = startMs - nowMs
  if (diffMs < getLearnerCancelThresholdMs()) {
    return {
      ok: false,
      reason: 'too_late_to_cancel',
      minutesUntilStart: Math.max(0, Math.floor(diffMs / 60_000)),
    }
  }
  return { ok: true }
}

export type LessonSlot = {
  id: string
  teacherAccountId: string
  teacherEmail?: string | null
  startAt: string
  durationMinutes: number
  status: SlotStatus
  learnerAccountId: string | null
  learnerEmail?: string | null
  bookedAt: string | null
  cancelledAt: string | null
  cancelledByAccountId: string | null
  cancellationReason: string | null
  // Phase 5: when the lifecycle status was set (auto-complete cron
  // stamps it, operator "mark" endpoint stamps it). Null on rows
  // that never reached completed / no_show_*.
  markedAt: string | null
  // Phase 6: optional binding to a pricing tariff. Operator picks at
  // create time. Null = no auto-bound price (cabinet shows no
  // «оплатить» action for that slot).
  tariffId: string | null
  tariffSlug?: string | null
  tariffTitleRu?: string | null
  tariffAmountKopecks?: number | null
  notes: string | null
  // BCS-B.1 — learner's free-form comment captured on Calendly confirm
  // screen. Nullable. Capped at MAX_AGENDA_LEN at write time. Visible to
  // teacher in their slot view (frontend in BCS-B.frontend). NOT shown
  // to the operator-facing admin UI (those reads pre-date this field).
  agenda: string | null
  // BCS-F.3 — set by the post-pull conflict detector when an external
  // calendar event overlaps this booked slot. The teacher-facing
  // calendar surfaces this as a red outline + ⚠ marker; nullable in
  // every other context. The conflict_source_* pair carries the
  // specific (calendar_id, event_id) needed by the F.4 resolution
  // endpoints.
  externalConflictAt: string | null
  externalConflictKind: string | null
  conflictSourceCalendarId: string | null
  conflictSourceEventId: string | null
  // BCS-DEF-3 — optional Zoom (or similar) URL for the lesson. Set
  // by admin or by the teacher on a booked slot. Nullable; capped
  // at 512 chars; must start with https:// (DB CHECK + app
  // validator). Learner sees as a "Join lesson" link in the
  // cabinet on booked slots.
  zoomUrl: string | null
  events: SlotEvent[]
  createdAt: string
  updatedAt: string
}

export type SlotEvent = {
  type: string
  at: string
  actor?: string | null
  payload?: Record<string, unknown>
}

// Public projection of a slot for anonymous callers.
//
// Codex 2026-05-07: `GET /api/slots/available` is intentionally
// anonymous-friendly so the public marketing surface can render a
// "book a lesson" widget. The full LessonSlot shape leaks operator-
// internal data (teacher email, internal account IDs, free-form
// notes, lifecycle audit fields). Anonymous responses MUST go through
// `toPublicSlot` so a UI bug or curl probe cannot exfiltrate that
// metadata.
//
// Authenticated learner / operator paths keep the full shape — they
// already have a session and the data is appropriate for them.
export type PublicSlot = {
  id: string
  startAt: string
  durationMinutes: number
  status: SlotStatus
  tariffId: string | null
  tariffSlug?: string | null
  tariffTitleRu?: string | null
  tariffAmountKopecks?: number | null
}

export function toPublicSlot(slot: LessonSlot): PublicSlot {
  return {
    id: slot.id,
    startAt: slot.startAt,
    durationMinutes: slot.durationMinutes,
    status: slot.status,
    tariffId: slot.tariffId,
    tariffSlug: slot.tariffSlug ?? null,
    tariffTitleRu: slot.tariffTitleRu ?? null,
    tariffAmountKopecks: slot.tariffAmountKopecks ?? null,
  }
}

export type SlotValidationError =
  | { field: 'startAt'; reason: 'invalid' | 'in_past' }
  | { field: 'durationMinutes'; reason: 'out_of_band' | 'not_integer' }
  | { field: 'teacherAccountId'; reason: 'invalid' }
  | { field: 'notes'; reason: 'too_long' }
  | { field: 'cancellationReason'; reason: 'too_long' }

export type BulkPreviewInput = {
  weekdays: number[] // 0=Sunday..6=Saturday
  startTime: string // 'HH:MM'
  startDate: string // 'YYYY-MM-DD'
  weeks: number
  durationMinutes: number
  skipDates?: string[] // 'YYYY-MM-DD'
  // Display tz for parsing startTime + startDate. Default Europe/Moscow
  // per D5. The generated `startAt` values are absolute ISO timestamps;
  // the operator's tz only affects how 'HH:MM on YYYY-MM-DD' is mapped
  // to UTC.
  timezone?: string
}

export type BulkPreviewError =
  | { field: 'weekdays'; reason: 'empty' | 'invalid' }
  | { field: 'startTime'; reason: 'invalid' }
  | { field: 'startDate'; reason: 'invalid' }
  | { field: 'weeks'; reason: 'out_of_band' }
  | { field: 'durationMinutes'; reason: 'out_of_band' | 'not_integer' }
  | { field: 'skipDates'; reason: 'invalid' }

export type CreateSlotInput = {
  teacherAccountId: string
  startAt: string
  durationMinutes: number
  notes?: string | null
  tariffId?: string | null
}

export type BulkCreateInput = {
  teacherAccountId: string
  durationMinutes: number
  notes?: string | null
  tariffId?: string | null
  slots: { startAt: string }[]
}

export type BulkCreateResult = {
  created: LessonSlot[]
  skippedConflicts: string[] // startAt values that hit the unique constraint
}

// Quality Sub-PR B (2026-06-02): `kind: 'legacy'` retired alongside the
// BILLING_WAVE_ACTIVE flag. New `bookSlot` always returns either
// `prepaid` (package consumed) or `postpaid` (debt at completion).
export type BookSlotBilling =
  | { kind: 'prepaid'; packagePurchaseId: string; countRemainingAfter: number; expiresAt: string }
  | { kind: 'postpaid'; tariffId: string; amountKopecks: number; currency: string }

export type BookSlotResult =
  | { ok: true; slot: LessonSlot; billing: BookSlotBilling }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'not_open'
        | 'in_past'
        | 'self_booking_blocked'
        | 'package_required'
        | 'tariff_required'
        | 'pending_package_grant'
        // BCS-D.5 — busy-cache overlap blocked the booking. Plan
        // §4.2: a fresh external busy interval covers the slot's
        // time window AND the teacher's integration is active and
        // recently pulled. Learner UI surfaces "слот занят у учителя".
        | 'external_conflict'
        // mig 0101 — teacher не выбрал способ оплаты для (teacher,
        // learner) пары в learner_billing_preferences. Booking blocked;
        // UI показывает «учитель не выбрал способ оплаты, свяжитесь с
        // ним».
        | 'payment_method_not_set'
      // For package_required: the matching active packages the
      // learner can buy (capped at top 3 by display_order). Empty
      // array = no matching package for this slot's duration.
      availablePackages?: ReadonlyArray<{
        slug: string
        titleRu: string
        amountKopecks: number
        durationMinutes: number
      }>
    }

export type CancelLearnerSlotResult =
  | { ok: true; slot: LessonSlot }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'not_owner'
        | 'already_terminal'
        | 'too_late_to_cancel'
        // SAAS-PIVOT Day 5A — slot is in a billable terminal state
        // (`completed` / `no_show_learner`). Learner must call the
        // un-complete path first (teacher action) before re-cancelling.
        | 'after_completion'
      minutesUntilStart?: number
    }

// Codex Wave 13 Pass 2 #11. Discriminated result lets the route map
// 'not_found' → 404 and 'not_open' → 409 cleanly, instead of
// collapsing both into a single null return + 404.
export type EditOpenSlotResult =
  | { ok: true; slot: LessonSlot }
  | { ok: false; reason: 'not_found' | 'not_open' }

export type MoveOpenSlotResult =
  | { ok: true; slot: LessonSlot }
  | {
      ok: false
      reason: 'not_found' | 'not_open' | 'slot_collision'
    }

// BCS-DEF-3 — set/clear zoom URL on a slot. Allowed on `booked`
// slots (the lesson is scheduled and the join link is meaningful);
// rejected on terminal states. `not_owner` is the teacher-side
// failure mode; admin path bypasses that gate. `invalid_url` is
// the validator failure (length / scheme).
export type SetSlotZoomUrlResult =
  | { ok: true; slot: LessonSlot }
  | {
      ok: false
      reason: 'not_found' | 'not_booked' | 'not_owner' | 'invalid_url'
    }

export type MoveTeacherSlotResult =
  | { ok: true; slot: LessonSlot }
  | { ok: false; reason: 'not_found' | 'not_owner' | 'not_open' | 'slot_collision' }

export type CancelTeacherSlotResult =
  | { ok: true; slot: LessonSlot }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'not_owner'
        | 'already_terminal'
        | 'reason_required_for_booked'
        // SAAS-PIVOT Day 5A — slot is in a billable terminal state
        // (`completed` / `no_show_learner`). Teacher must un-mark via
        // /api/teacher/lessons/[id]/uncomplete first.
        | 'after_completion'
    }

// Codex Wave 13 Pass 2 #11. Same shape as editOpenSlot — discriminated
// result so the route can return 404 vs 409 truthfully.
export type DeleteOpenSlotResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_open' }
