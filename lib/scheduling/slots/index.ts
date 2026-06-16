// Wave 39: facade for the former lib/scheduling/slots.ts.
//
// Public surface re-exported 1:1. Two sections — `export type {...}`
// for types (erasable at runtime, required by isolatedModules: true)
// and `export {...}` for runtime values.
//
// All ~40 existing callers import via `@/lib/scheduling/slots`; this
// barrel resolves to this folder by tsconfig moduleResolution:
// "bundler" and keeps the public path stable.

// Types (erasable at runtime)
export type {
  AssignSlotDirectBilling,
  AssignSlotDirectInput,
  AssignSlotDirectResult,
  BookSlotBilling,
  BookSlotResult,
  BulkCreateInput,
  BulkCreateResult,
  BulkPreviewError,
  BulkPreviewInput,
  CancelLearnerSlotResult,
  CancelTeacherSlotResult,
  CreateSlotInput,
  DeleteOpenSlotResult,
  EditOpenSlotResult,
  LearnerCancelDecision,
  LessonSlot,
  MoveOpenSlotResult,
  MoveTeacherSlotResult,
  PublicSlot,
  SlotEvent,
  SlotLifecycleStatus,
  SlotSource,
  SlotStartValidationError,
  SlotStatus,
  SlotValidationError,
} from './types'

// Values (runtime exports)
// LEARNER_CANCEL_THRESHOLD_MS removed in POLICY-KNOBS (2026-05-17);
// the threshold is now env-tunable via getLearnerCancelThresholdMs()
// in lib/scheduling/policy.ts. canLearnerCancel calls the function
// on every invocation.
export {
  LIFECYCLE_STATUSES,
  MSK_BUSINESS_HOUR_MAX,
  MSK_BUSINESS_HOUR_MIN,
  SLOT_GRID_MINUTES,
  TERMINAL_STATUSES,
  canLearnerCancel,
  toPublicSlot,
} from './types'

export {
  bulkGeneratePreview,
  validateSlotInput,
  validateSlotStartMsk,
} from './validation'

export {
  getSlotById,
  listAllSlotsForAdmin,
  listOpenFutureSlots,
  listSlotsAsTeacher,
  listSlotsForCalendarRange,
  listSlotsForLearner,
} from './queries'

export {
  autoCompletePastBookedSlots,
  markSlotLifecycle,
} from './lifecycle'

export {
  SlotTariffDurationMismatchError,
  SlotTeacherRoleError,
  TariffNotActiveError,
  TariffOwnershipError,
  bulkCreateSlots,
  createSlot,
  deleteOpenSlot,
  editOpenSlot,
  moveOpenSlot,
  moveOpenSlotByTeacher,
  setSlotZoomUrl,
} from './mutations-write'

export { MAX_ZOOM_URL_LEN, validateZoomUrl } from './validation'
export type { ZoomUrlValidationError } from './validation'

export {
  CancelAfterCompletionError,
  cancelLearnerSlot,
  cancelSlot,
  cancelSlotByTeacher,
} from './mutations-cancel'

export { bookSlot } from './booking'

export { assignSlotDirect } from './mutations-assign-direct'

export {
  rescheduleSlotByLearner,
  rescheduleSlotByTeacher,
} from './mutations-reschedule'
export type { RescheduleSlotResult } from './mutations-reschedule'

export {
  isValidIanaTz,
  isValidYmd,
  listOpenBookingDays,
  listOpenBookingTimes,
  validateBookingRange,
} from './booking-queries'
export type { BookingRangeError } from './booking-queries'
