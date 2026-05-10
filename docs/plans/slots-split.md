# Wave 17: split `lib/scheduling/slots.ts`

**Status:** design v2, paused 2026-05-10 after Codex paranoia round 2 verdict **NEEDS-FURTHER-REVISION**. Code is NOT yet written. v3 required before any implementation. see "Round 2 follow-ups required for v3" at the bottom of this doc.

## Why

`lib/scheduling/slots.ts` is 1666 lines, 44 public exports across multiple distinct domains. Codex Wave 13 Pass 1 #9 flagged it as a god-module. Splitting now (before more weight lands) bounds future per-module review burden.

## Constraints

- **Behavior must stay bit-for-bit identical**. No-op refactor; tests stay 229/229 without any test edits.
- **Public import path must remain `@/lib/scheduling/slots`**. ~40 callers across `app/`, `lib/`, `tests/` import from there. A facade `index.ts` keeps the path stable.
- **No `as any` / `// @ts-ignore` introduced**.
- **No new circular imports**. Layering rule below.
- **All 44 public exports** continue to be exported from `@/lib/scheduling/slots`. List derived mechanically from `grep '^export ' lib/scheduling/slots.ts`.

## Honest naming reset (Codex round 1 CRITICAL)

Codex caught two false claims in v1:
- `cancelSlot` / `cancelLearnerSlot` / `cancelSlotByTeacher` DO touch billing (dynamic import of `restorePackageConsumption`). They cannot live in a "non-billing" module.
- `SlotTeacherRoleError` + `assertTeacherRole` are public/used; `assertTeacherRole` does a DB read (calls `listAccountRoles`). They are not pure types.

v2 fixes both. The "mutations.ts" line is now: any single-slot writer that's NOT `bookSlot`. It's allowed to touch `billing/*` for restore-on-cancel.

## Target structure (v2. 8 files)

```
lib/scheduling/slots/
  internal.ts      . shared private utilities + DB row plumbing.
                      Contains: SLOT_COLUMNS, rowToSlot, appendEventSql,
                      UUID_PATTERN, MAX_NOTES_LEN, MAX_REASON_LEN.
                      No public exports. Imported by every other
                      module that touches the DB.

  types.ts         . pure types + lifecycle constants. No DB calls.
                      Contains the public type surface: SlotStatus,
                      SlotLifecycleStatus, LIFECYCLE_STATUSES,
                      TERMINAL_STATUSES, LEARNER_CANCEL_THRESHOLD_MS,
                      LearnerCancelDecision, canLearnerCancel,
                      LessonSlot, SlotEvent, PublicSlot, toPublicSlot,
                      and ALL Result/Input types
                      (BookSlotResult, BookSlotBilling, CreateSlotInput,
                       BulkCreateInput, BulkCreateResult,
                       CancelLearnerSlotResult, MoveOpenSlotResult,
                       MoveTeacherSlotResult, CancelTeacherSlotResult,
                       BulkPreviewInput, BulkPreviewError,
                       SlotValidationError).

  validation.ts    . pure functions: validateSlotInput,
                      bulkGeneratePreview. Imports types only.

  queries.ts       . read-only DB queries: listOpenFutureSlots,
                      listSlotsAsTeacher, listSlotsForLearner,
                      listAllSlotsForAdmin, listSlotsForCalendarRange,
                      getSlotById.
                      Imports: types, internal.

  mutations.ts     . single-slot writers that are NOT bookSlot.
                      Contains: SlotTeacherRoleError class +
                      assertTeacherRole helper, createSlot,
                      bulkCreateSlots, editOpenSlot, moveOpenSlot,
                      moveOpenSlotByTeacher, cancelSlot,
                      cancelLearnerSlot, cancelSlotByTeacher,
                      deleteOpenSlot.
                      Cancel-paths dynamically import
                      `@/lib/billing/consumption` for
                      restorePackageConsumption. this is intentional
                      and matches today's behaviour.
                      Imports: types, internal, validation, queries
                      (for the post-write classify branch in cancel),
                      lib/auth/accounts (for assertTeacherRole), and
                      lib/billing/consumption (dynamically).

  booking.ts       . bookSlot only (the heaviest billing-aware path,
                      ~200 lines). Imports: types, internal, queries,
                      lib/billing/* (consumption, packages, paid-state,
                      package-grant) statically. Already does this in
                      slots.ts today.

  lifecycle.ts     . markSlotLifecycle, autoCompletePastBookedSlots.
                      Imports: types, internal, queries.

  index.ts         . facade. Re-exports the public surface 1:1.
                      All 44 public names listed mechanically from
                      the original grep '^export '.
```

### Layering (DAG)

```
internal.ts    ← (none)
types.ts       ← (none)
validation.ts  ← types
queries.ts     ← types, internal
lifecycle.ts   ← types, internal, queries
mutations.ts   ← types, internal, validation, queries, errors-side: lib/auth/accounts; billing-side (dynamic): lib/billing/consumption
booking.ts     ← types, internal, queries, lib/billing/* (static)
index.ts       ← all of the above (re-export only)
```

No backward edges. `mutations.ts` and `booking.ts` are siblings. neither depends on the other.

## Migration mechanics

1. Generate the canonical export list once: `grep -nE '^export ' lib/scheduling/slots.ts > /tmp/slots-exports.txt` (44 lines). Use this to populate `index.ts` mechanically.
2. Create `lib/scheduling/slots/internal.ts` and move shared private utilities verbatim. No public exports.
3. Create `lib/scheduling/slots/types.ts` and move type/const declarations verbatim.
4. Create `lib/scheduling/slots/validation.ts` and move pure functions.
5. Create `lib/scheduling/slots/queries.ts` and move read-only DB queries.
6. Create `lib/scheduling/slots/lifecycle.ts` and move `markSlotLifecycle` + `autoCompletePastBookedSlots`.
7. Create `lib/scheduling/slots/mutations.ts` and move all non-booking writers + `SlotTeacherRoleError` + `assertTeacherRole`.
8. Create `lib/scheduling/slots/booking.ts` and move `bookSlot`.
9. Create `lib/scheduling/slots/index.ts` re-exporting every name in `/tmp/slots-exports.txt`.
10. Delete `lib/scheduling/slots.ts` original. Module resolution falls back to `lib/scheduling/slots/index.ts` per tsconfig `moduleResolution: "bundler"`.
11. Run `npx tsc --noEmit` after each step. Fix any cycle/missing-import on the spot.
12. Run `npm run test:integration` and `npm run test:run`. 229/229 + 408/408.

## What does NOT change

- Public API names. same function signatures, same types.
- Argument types. same.
- Behavior under any input. same SQL, same error classifications.
- Test files. no edits.
- Caller import paths. all 40+ callers use `@/lib/scheduling/slots`.

## What DOES change

- `lib/scheduling/slots.ts` (single file) → `lib/scheduling/slots/` (folder with 8 files).
- Per-file size: ~150-300 lines (vs 1666 today).
- Future modifications land in narrow modules.

## Risks (post-Codex round 1)

1. **Drawing the billing-aware boundary wrong.** v1 falsely claimed cancel ops were billing-free. Fixed in v2: mutations.ts owns cancel + the dynamic billing import.
2. **Missing a public export in index.ts.** 44 names; one missed = build break at any of 40+ callers. Mitigation: derive the index list mechanically from grep, line-by-line.
3. **Implicit circular imports**. If `mutations.ts` accidentally imports from `booking.ts` (or vice versa), tsc reports nothing immediately but runtime can break. Mitigation: layering rule above + tsc check after each step.
4. **Path-alias resolution edge case**. `@/lib/scheduling/slots` must resolve to `slots/index.ts`. Verify with tsc + `npm run build` (CI catches this if local build is sandbox-blocked).
5. **`scripts/auto-complete-slots.mjs` is NOT affected.** It does direct SQL, not module imports. Codex round 1 caught this misstatement; corrected.

## Acceptance criteria

- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run test:integration` 229/229.
- [ ] `npm run test:run` 408/408.
- [ ] CI `npm run build` passes.
- [ ] No file in `lib/scheduling/slots/` exceeds 400 lines.
- [ ] Every name in the original `grep '^export '` is re-exported from `index.ts`.
- [ ] Codex round 2 review on the diff: no behavior-change findings.

## Doc-drift sweep (post-merge)

`ARCHITECTURE.md:183` and any other doc referencing `lib/scheduling/slots.ts` (single file path) must be updated to point at `lib/scheduling/slots/` (folder). Single-file references will dangle after the migration.

## Round 2 follow-ups required for v3

Codex paranoia round 2 (2026-05-10) verdict: **NEEDS-FURTHER-REVISION**. Two CRITICAL findings + several HIGH/MEDIUM. v3 must address ALL of these before implementation:

### CRITICAL

1. **`mutations.ts` ~622 lines exceeds the 400-line cap** in the acceptance criteria. The cap is real. without it the split brings minimal review-burden value. Fix: split mutations into two siblings:
   - `mutations-write.ts`: `SlotTeacherRoleError`, `assertTeacherRole`, `createSlot`, `bulkCreateSlots`, `editOpenSlot`, `moveOpenSlot`, `moveOpenSlotByTeacher`, `deleteOpenSlot`. ~300 lines, NO billing.
   - `mutations-cancel.ts`: `cancelSlot`, `cancelLearnerSlot`, `cancelSlotByTeacher`. ~300 lines, dynamically imports `@/lib/billing/consumption`.
   Final file count: 9 files (`internal`, `types`, `validation`, `queries`, `lifecycle`, `mutations-write`, `mutations-cancel`, `booking`, `index`).

2. **`booking.ts` MUST preserve dynamic billing imports**. current `bookSlot` does `await import('@/lib/billing/consumption')` etc. Static imports would break the legacy fast path (when `BILLING_WAVE_ACTIVE !== 'true'`, billing modules must NOT be loaded). The doc claimed static imports. that would be a behaviour change, not a no-op refactor. v3 must explicitly say "preserve dynamic imports verbatim".

### HIGH

3. **`index.ts` generation under `isolatedModules: true`** must split type re-exports from value re-exports:
   ```
   export type { SlotStatus, SlotLifecycleStatus, ... } from './types'
   export { LIFECYCLE_STATUSES, canLearnerCancel, ... } from './types'
   export { listOpenFutureSlots, ... } from './queries'
   ...
   ```
   Saying "44 lines from grep" is incomplete. the grep needs to be filtered into TWO sections (type-exports and value-exports) before being assembled into the facade.

4. **`internal.ts` "no public exports" is contradictory** with "imported by every other module". Reword: "exports for sibling modules; NOT re-exported from `index.ts`". This is a doc-clarity fix, not a behaviour fix.

### MEDIUM

5. **DAG inaccuracies**: cancel ops do NOT call exported queries; `bookSlot` does NOT call exported queries. Drop those edges from the DAG, or move the local helpers (`classifyBookSlotFailure` etc) into `queries.ts` as private-to-folder exports if you want to consolidate.

6. **`internal.ts` will type-import from `types.ts`** (rowToSlot needs `LessonSlot`/`SlotEvent`/`SlotStatus`). DAG should show `internal.ts ← types.ts (type-only)`.

### Minimum v3 deltas

- Split `mutations.ts` → `mutations-write.ts` + `mutations-cancel.ts`.
- Update Layering / DAG section to:
  ```
  types.ts             ← (none)
  internal.ts          ← types (type-only)
  validation.ts        ← types, internal
  queries.ts           ← types, internal
  lifecycle.ts         ← types, internal
  mutations-write.ts   ← types, internal, validation, lib/auth/accounts
  mutations-cancel.ts  ← types, internal; dynamic: lib/billing/consumption
  booking.ts           ← types, internal; dynamic: lib/billing/{consumption,packages,paid-state,package-grant}
  index.ts             ← all (two sections: export type, export)
  ```
- Add explicit "Preserve dynamic imports" callout for `booking.ts` and `mutations-cancel.ts`.
- Remove the cancel→queries and booking→queries dependency claims.
- Reword internal.ts export semantics.
- After v3 doc lands, send to Codex round 3. Implement only on GOOD-AS-IS verdict.

### Why paused

This wave is a no-op refactor in spirit but the design-level work is non-trivial: two paranoia rounds caught real issues (false billing-aware claim in v1, exceeded line-cap + static-vs-dynamic billing import bug in v2). Implementation without v3 + round-3 sign-off would risk a behaviour-change disguised as cleanup. Better to pause and pick up in a session with bandwidth for round 3 + the actual mechanical move + post-merge Codex review on the diff.
