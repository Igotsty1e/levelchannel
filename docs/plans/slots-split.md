# Wave 17: split `lib/scheduling/slots.ts`

**Status:** design v3, 2026-05-11. v2 paused after Codex round 2 NEEDS-FURTHER-REVISION; v3 absorbs all 6 findings (2 CRITICAL + 2 HIGH + 2 MEDIUM). Ready for Codex round 3.

## Why

`lib/scheduling/slots.ts` is ~1700 lines (grew from 1666 since v2 due to Wave 26's `EditOpenSlotResult`/`DeleteOpenSlotResult` additions and Wave 27's `validateSlotStartMsk`). 44+ public exports across multiple distinct domains. Codex Wave 13 Pass 1 #9 flagged it as a god-module. Splitting now (before more weight lands) bounds future per-module review burden.

## Constraints

- **Behavior must stay bit-for-bit identical**. No-op refactor; tests stay 241+/241+ without any test edits.
- **Public import path must remain `@/lib/scheduling/slots`**. ~40 callers across `app/`, `lib/`, `tests/` import from there. A facade `index.ts` keeps the path stable.
- **No `as any` / `// @ts-ignore` introduced**.
- **No new circular imports**. Layering rule below.
- **All public exports** continue to be exported from `@/lib/scheduling/slots`. List derived mechanically from `grep '^export ' lib/scheduling/slots.ts`.
- **Dynamic billing imports preserved verbatim**. `bookSlot` and the cancel ops `await import(...)` billing modules at call time. This is load-bearing for the legacy fast path: when `BILLING_WAVE_ACTIVE !== 'true'`, billing modules must NOT be loaded at all. Static imports would be a behavior change disguised as cleanup. v3 makes this an explicit contract.

## Honest naming reset (carried from v2)

- `cancelSlot` / `cancelLearnerSlot` / `cancelSlotByTeacher` DO touch billing (dynamic import of `restorePackageConsumption`). They live in `mutations-cancel.ts`.
- `SlotTeacherRoleError` + `assertTeacherRole` are public/used; `assertTeacherRole` does a DB read. They live in `mutations-write.ts`.

## Target structure (v3, 9 files)

```
lib/scheduling/slots/
  internal.ts            shared private utilities + DB row plumbing.
                         Contains: SLOT_COLUMNS, rowToSlot, appendEventSql,
                         UUID_PATTERN, MAX_NOTES_LEN, MAX_REASON_LEN.
                         Exports are for sibling modules; NOT re-exported
                         from index.ts. Type-imports LessonSlot/SlotEvent/
                         SlotStatus from types.ts.

  types.ts               pure types + lifecycle constants. No DB calls.
                         Contains the public type surface: SlotStatus,
                         SlotLifecycleStatus, LIFECYCLE_STATUSES,
                         TERMINAL_STATUSES, LEARNER_CANCEL_THRESHOLD_MS,
                         LearnerCancelDecision, canLearnerCancel,
                         LessonSlot, SlotEvent, PublicSlot, toPublicSlot,
                         and all Result/Input types
                         (BookSlotResult, BookSlotBilling, CreateSlotInput,
                          BulkCreateInput, BulkCreateResult,
                          CancelLearnerSlotResult, MoveOpenSlotResult,
                          MoveTeacherSlotResult, CancelTeacherSlotResult,
                          EditOpenSlotResult, DeleteOpenSlotResult,
                          BulkPreviewInput, BulkPreviewError,
                          SlotValidationError, SlotStartValidationError).
                         Also MSK_BUSINESS_HOUR_MIN/MAX, SLOT_GRID_MINUTES.

  validation.ts          pure functions: validateSlotInput,
                         bulkGeneratePreview, validateSlotStartMsk.
                         Imports: types (LessonSlot input shapes),
                         internal (MAX_NOTES_LEN / MAX_REASON_LEN
                         constants used by validateSlotInput).

  queries.ts             read-only DB queries: listOpenFutureSlots,
                         listSlotsAsTeacher, listSlotsForLearner,
                         listAllSlotsForAdmin, listSlotsForCalendarRange,
                         getSlotById.
                         Imports: types, internal.

  mutations-write.ts     NO billing. Writers that do not cancel.
                         Contains: SlotTeacherRoleError class +
                         assertTeacherRole helper, createSlot,
                         bulkCreateSlots, editOpenSlot, moveOpenSlot,
                         moveOpenSlotByTeacher, deleteOpenSlot.
                         ~300 lines target.
                         Imports: types, internal, validation,
                         lib/auth/accounts.

  mutations-cancel.ts    Cancel writers. Dynamically imports
                         @/lib/billing/consumption for
                         restorePackageConsumption.
                         Contains: cancelSlot, cancelLearnerSlot,
                         cancelSlotByTeacher.
                         ~300 lines target.
                         Imports: types, internal; dynamic:
                         lib/billing/consumption.

  booking.ts             bookSlot only (the heaviest billing-aware path).
                         Dynamic imports preserved verbatim. ~250 lines.
                         Imports: types, internal; dynamic:
                         lib/billing/consumption (consumePackageUnit) and
                         lib/billing/packages (package lookup). Verified
                         against lib/scheduling/slots.ts:1025-1029.

  lifecycle.ts           markSlotLifecycle, autoCompletePastBookedSlots.
                         Imports: types, internal.

  index.ts               facade. Re-exports the public surface 1:1,
                         split into two sections (see below).
```

### Layering (DAG)

```
types.ts             ← (none)
internal.ts          ← types (type-only)
validation.ts        ← types, internal
queries.ts           ← types, internal
lifecycle.ts         ← types, internal
mutations-write.ts   ← types, internal, validation, lib/auth/accounts
mutations-cancel.ts  ← types, internal; dynamic: lib/billing/consumption
booking.ts           ← types, internal; dynamic: lib/billing/consumption, lib/billing/packages
index.ts             ← all (two sections: export type, export)
```

No backward edges. `mutations-write.ts`, `mutations-cancel.ts`, and `booking.ts` are siblings. None depends on the other. Cancel ops and `bookSlot` do NOT call exported queries from `queries.ts` (Codex round 2 #5: the DAG no longer claims this edge).

### index.ts facade — two-section pattern

Under `isolatedModules: true` (enforced by tsconfig), type re-exports MUST be separated from value re-exports. Mechanical derivation:

```bash
grep -nE '^export ' lib/scheduling/slots.ts | \
  awk -F: '{print $2}' | \
  awk '/^export (type|interface)/ {print "TYPE:" $0} \
       /^export (const|function|class|async)/ {print "VAL:" $0}'
```

Then assemble:

```ts
// Types (erasable at runtime)
export type {
  SlotStatus,
  SlotLifecycleStatus,
  LearnerCancelDecision,
  LessonSlot,
  SlotEvent,
  PublicSlot,
  BookSlotResult,
  BookSlotBilling,
  CreateSlotInput,
  BulkCreateInput,
  BulkCreateResult,
  CancelLearnerSlotResult,
  MoveOpenSlotResult,
  MoveTeacherSlotResult,
  CancelTeacherSlotResult,
  EditOpenSlotResult,
  DeleteOpenSlotResult,
  BulkPreviewInput,
  BulkPreviewError,
  SlotValidationError,
  SlotStartValidationError,
} from './types'

// Values (runtime exports)
export {
  LIFECYCLE_STATUSES,
  TERMINAL_STATUSES,
  LEARNER_CANCEL_THRESHOLD_MS,
  MSK_BUSINESS_HOUR_MIN,
  MSK_BUSINESS_HOUR_MAX,
  SLOT_GRID_MINUTES,
  canLearnerCancel,
  toPublicSlot,
} from './types'

export {
  validateSlotInput,
  bulkGeneratePreview,
  validateSlotStartMsk,
} from './validation'

export {
  listOpenFutureSlots,
  listSlotsAsTeacher,
  listSlotsForLearner,
  listAllSlotsForAdmin,
  listSlotsForCalendarRange,
  getSlotById,
} from './queries'

export {
  markSlotLifecycle,
  autoCompletePastBookedSlots,
} from './lifecycle'

export {
  SlotTeacherRoleError,
  createSlot,
  bulkCreateSlots,
  editOpenSlot,
  moveOpenSlot,
  moveOpenSlotByTeacher,
  deleteOpenSlot,
} from './mutations-write'

export {
  cancelSlot,
  cancelLearnerSlot,
  cancelSlotByTeacher,
} from './mutations-cancel'

export { bookSlot } from './booking'
```

The exact name lists are populated mechanically from the grep output during step 1 of migration mechanics.

## Migration mechanics

1. Generate the canonical export list: `grep -nE '^export ' lib/scheduling/slots.ts > /tmp/slots-exports.txt`. Use to populate `index.ts`.
2. Create `lib/scheduling/slots/types.ts` and move type/const declarations verbatim.
3. Create `lib/scheduling/slots/internal.ts` and move shared private utilities verbatim (type-imports from `./types`).
4. Create `lib/scheduling/slots/validation.ts` and move pure functions (`validateSlotInput`, `bulkGeneratePreview`, `validateSlotStartMsk`).
5. Create `lib/scheduling/slots/queries.ts` and move read-only DB queries.
6. Create `lib/scheduling/slots/lifecycle.ts` and move `markSlotLifecycle` + `autoCompletePastBookedSlots`.
7. Create `lib/scheduling/slots/mutations-write.ts` and move non-billing writers + `SlotTeacherRoleError` + `assertTeacherRole`.
8. Create `lib/scheduling/slots/mutations-cancel.ts` and move cancel writers. Preserve the dynamic `await import('@/lib/billing/consumption')` verbatim.
9. Create `lib/scheduling/slots/booking.ts` and move `bookSlot`. Preserve all dynamic billing imports verbatim.
10. Create `lib/scheduling/slots/index.ts` with the two-section facade.
11. Delete `lib/scheduling/slots.ts`. Module resolution falls back to `lib/scheduling/slots/index.ts` per tsconfig `moduleResolution: "bundler"`.
12. `npx tsc --noEmit` after each step. Fix any cycle/missing-import on the spot.
13. `npm run test:integration` + `npm run test:run`. 241+/241+ + 408+/408+.

## What does NOT change

- Public API names. Same function signatures, same types.
- Argument types. Same.
- Behavior under any input. Same SQL, same error classifications.
- **Dynamic billing imports.** `bookSlot` and `cancelSlot`/`cancelLearnerSlot`/`cancelSlotByTeacher` continue to `await import('@/lib/billing/...')` at call time. The legacy fast path (when `BILLING_WAVE_ACTIVE !== 'true'`) must not load billing modules.
- Test files. No edits.
- Caller import paths. All 40+ callers use `@/lib/scheduling/slots`.

## What DOES change

- `lib/scheduling/slots.ts` (single file) → `lib/scheduling/slots/` (folder with 9 files).
- Per-file size: 150-300 lines (vs 1700 today). 400-line cap holds.
- Future modifications land in narrow modules.

## Risks (post-Codex rounds 1 + 2)

1. **Drawing the billing-aware boundary wrong.** v1 falsely claimed cancel ops were billing-free. v2 fixed cancel placement; v3 also splits non-billing writes from cancel writes to keep each module under the cap.
2. **Static-vs-dynamic billing imports.** v2's "static imports" line would have broken the legacy fast path. v3 makes "preserve dynamic imports verbatim" an explicit contract; PR diff review is the load-bearing check.
3. **Missing a public export in index.ts.** 44+ names; one missed = build break at any of 40+ callers. Mitigation: derive the index list mechanically from grep, line-by-line; tsc check after each step.
4. **`isolatedModules: true` and type re-exports.** Re-exporting a type from a non-direct module via `export {...}` fails under isolatedModules. Mitigation: two-section facade (type-only re-exports use `export type`).
5. **Implicit circular imports.** If `mutations-cancel.ts` accidentally imports from `booking.ts` (or vice versa), tsc reports nothing immediately but runtime can break. Mitigation: layering rule + tsc check after each step.
6. **Path-alias resolution.** `@/lib/scheduling/slots` must resolve to `slots/index.ts`. Verify with tsc + `npm run build`.
7. **`scripts/auto-complete-slots.mjs` is NOT affected.** It does direct SQL, not module imports.

## Acceptance criteria

- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run test:integration` passes (241+ tests).
- [ ] `npm run test:run` passes (408+ tests).
- [ ] CI `npm run build` passes.
- [ ] No file in `lib/scheduling/slots/` exceeds 400 lines.
- [ ] Every name in the original `grep '^export '` is re-exported from `index.ts`.
- [ ] `mutations-cancel.ts` and `booking.ts` use `await import('@/lib/billing/...')` (no static `import ... from '@/lib/billing/...'`).
- [ ] Codex round 3 review on the doc: GOOD-AS-IS.
- [ ] Codex post-merge review on the diff: no behavior-change findings.

## Doc-drift sweep (post-merge)

`ARCHITECTURE.md` and any other doc referencing `lib/scheduling/slots.ts` (single file path) must be updated to point at `lib/scheduling/slots/` (folder). Single-file references will dangle after the migration.

## Round 3 review checklist (what Codex should verify)

- [ ] Acceptance criteria match v3 file count (9 files).
- [ ] DAG matches the actual import edges per the file descriptions (no cancel→queries, no booking→queries).
- [ ] internal.ts export semantics are clear ("sibling-only, not re-exported").
- [ ] `index.ts` facade is split into `export type {...}` and `export {...}` sections.
- [ ] Dynamic billing imports are explicitly preserved.
- [ ] Risk #2 (static-vs-dynamic) is called out.

If GOOD-AS-IS verdict — proceed to implementation.
