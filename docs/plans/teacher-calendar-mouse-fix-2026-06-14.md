# Teacher Calendar — Mouse-Interaction Audit + Fix (2026-06-14)

Status: IN_PROGRESS
Owner: claude (Иван Ханаев, founder)
Scope: `/teacher/calendar`, desktop, mouse-driven flows only. Mobile/touch + learner calendar (`/cabinet/calendar`) are explicit non-goals.

---

## Context

Owner reported (2026-06-14): «набираю мышкой, выбираю слот → баг интерфейс. Множество вариаций: предложение слота → закрываешь → предлагает занятия назначить. Пересекаются разные сценарии из-за того, что мы делали кучу всяких разных изменений. Нужен аудит того, какие все сценарии могут быть сейчас при работе в календаре веб-версии, и именно вот при нажатии мышкой. Аудит и исправление этого пиздеца».

Last 30 days: 16 PRs touched teacher calendar (#577 → #634). Highlights: minute-duration (#598/#599), no-slots-mode (#601/#604/#605), `slot_mode` column drop + top-row unify (#623), single-slot TimeRangeRow rewrite (#624), design audit (#626/#627/#633), assign-direct followup (#634). Each PR landed clean in isolation, but the composition accumulated four real bugs that line up with the owner-described «беспредел».

### Root-cause exploration (file:line evidence)

1. **Single click on empty cell opens broken paint-confirm modal.** `components/calendar/SlotCalendar.tsx:272-279` — `onCellMouseDown` immediately dispatches `cellMouseDown` → reducer enters `painting`. `lib/calendar/drag-state.ts:184-196` — `mouseUp` from `painting` always emits `paintCommit`, even with from==to (single 30-min cell). PaintConfirmModal mounts with default `duration=60`; `synthesizePaintSlots` returns null; modal shows «Диапазон короче выбранной длительности». User must dismiss. **No pixel / time threshold separates click from drag.**

2. **No mutual exclusion between modals.** `app/teacher/calendar/client.tsx:62-66` — three independent `useState` flags (`activeRow`, `pendingPaint`, `createMode`) drive five modals. They render at overlapping z-indexes (`TeacherSlotDetailModal` z=1000, `PaintConfirmModal` z=1000, `MobileCreateFab` z=200, others default). When flags race or stack, multiple modals mount; dismissing the top one reveals the next — exactly «закрываешь → предлагает занятия назначить».

3. **TeacherSlotDetailModal + PaintConfirmModal have no ESC handler.** `client.tsx:427-612` (inline TeacherSlotDetailModal) — backdrop click + «Закрыть» button only. `components/calendar/PaintConfirmModal.tsx:91` — backdrop guarded by `busy`, but no `keydown` listener. `BulkAddSlotsModal` + `AssignDirectModal` + `MobileCreateFab` all wire ESC. Inconsistent.

4. **`BulkAddSlotsModal` close paths not guarded mid-POST.** `BulkAddSlotsModal.tsx:98` (ESC) and `:208` (backdrop) call `onClose()` unconditionally. The `creating` and `previewing` flags exist but aren't consulted. User can dismiss while POST is in-flight → modal closes; on next refresh, slots are actually created — confusing.

### Intended outcome

Every mouse interaction on `/teacher/calendar` desktop has exactly one well-defined result. At most one modal renders at any time. Single click never triggers paint commit. ESC works consistently. Mid-POST close is blocked.

---

## Scenario matrix

Status legend: **OK** — current behavior is expected; **BUG-N** — maps to a fix below.

| # | Trigger | Current behavior | Expected | Status |
|---|---|---|---|---|
| 1 | Click empty cell (no drag) | Reducer → `painting`; mouseup commits paintSpan with from==to; PaintConfirmModal opens with duration=60, synth returns null, banner «Диапазон короче выбранной длительности» | Pure click does not commit; no modal opens | **BUG-1** |
| 2 | Drag empty cells across ≥2 rows | Paint highlight follows; mouseup → PaintConfirmModal with valid span; submit → bulk-create | Same | OK |
| 3 | Click open own slot | `onSlotClick` → `setActiveRow` → TeacherSlotDetailModal opens | Same | OK |
| 4 | Click booked-by-other slot | TeacherSlotDetailModal, status «Занято», cancel-with-reason flow | Same | OK |
| 5 | Click past-* slot | Modal, no action buttons | Same | OK |
| 6 | Drag own open slot to another half-hour | `slotMouseDown` → `moving`; drift sets `suppressClickRef`; mouseUp emits moveCommit → PATCH /move | Same | OK |
| 7 | Drag own open slot back to origin (no drift) | mouseUp returns idle without commit; click NOT suppressed → TeacherSlotDetailModal opens | Same | OK |
| 8 | Click `+ Назначить ученику` (modal closed) | `setCreateMode('assign')` → AssignDirectModal opens | Same | OK |
| 9 | Click `+ Добавить слоты` (modal closed) | `setCreateMode('bulk')` → BulkAddSlotsModal opens | Same | OK |
| 10 | ESC on TeacherSlotDetailModal | Nothing — no keydown handler | Closes (when !busy) | **BUG-3a** |
| 11 | ESC on PaintConfirmModal | Nothing — no keydown handler | Closes (when !busy) | **BUG-3b** |
| 12 | ESC on BulkAddSlotsModal mid-POST | `onClose()` fires unconditionally; modal closes while POST in flight | Block when `creating \|\| previewing` | **BUG-4** |
| 13 | Backdrop click on BulkAddSlotsModal mid-POST | Same — `onClose()` fires without guard | Block when busy | **BUG-4** |
| 14 | ESC on AssignDirectModal mid-POST | Already guarded by `!submitting` | OK | OK |
| 15 | ESC on MobileCreateFab mid-POST | Already guarded by `!busy` | OK | OK |
| 16 | Drag-paint started → modal opens → user clicks `+ Назначить ученику` | `setCreateMode('assign')` fires; AssignDirectModal mounts on top; PaintConfirmModal still in DOM; dismissing AssignDirectModal reveals PaintConfirmModal underneath | Top-row buttons inert while modal open | **BUG-2** |
| 17 | PaintConfirmModal open + drag-paint in background somehow | Currently a new `pendingPaint` overwrites existing one | Drop new paint commits while a modal is open | **BUG-2** |
| 18 | Switch «Несколько» → «Один» in BulkAddSlotsModal | `onSwitchToSingle` → `setCreateMode('single')`; BulkAddSlotsModal unmounts; MobileCreateFab opens | Same | OK |
| 19 | Switch «Один» → «Несколько» in MobileCreateFab | `onModeChange('bulk')` → `setCreateMode('bulk')`; MobileCreateFab closes; BulkAddSlotsModal opens | Same | OK |
| 20 | Click `Закрыть` on TeacherSlotDetailModal while `busy=true` | Disabled via `disabled={busy}` | OK | OK |
| 21 | Top-row buttons misclick — they sit 8px apart, identical 13px styling, no icons | Easy to hit «Добавить слоты» when aiming for «Назначить ученику» | Visual separation: primary action surface-3, secondary surface-2, gap 12 | **BUG-5** |
| 22 | Drag from empty into own open slot | reducer `painting` ignores cellMouseEnter for cross-day; same-day drift extends span; mouseup commits over the slot area | Acceptable; documented edge | OK |
| 23 | Window blur mid-drag | `onCancelGesture` → reducer `reset` → idle, no commit | OK | OK |
| 24 | Rapid double-click empty cell | First mousedown→painting, first mouseup→paintCommit→modal opens; second mousedown lands on modal backdrop (cell unreachable) | After BUG-1 fix: first click is no-op; second click also no-op | OK after BUG-1 |

---

## Sub-PR breakdown

### Sub-PR 1 — click-vs-drag 5px threshold (BUG-1)

Pure reducer untouched. Threshold lives in the SlotCalendar wiring layer where DOM coords already live.

- New `pendingPaintRef` captures `{clientX, clientY, ymd, halfHour}` on `onCellMouseDown`. Does NOT dispatch yet.
- Document-level `mousemove` (already on mount) checks `max(|dx|, |dy|) >= 5`. On cross: dispatch `cellMouseDown` with original coords as anchor, clear ref, fall through to existing `cellMouseEnter` logic.
- Document-level `mouseup` clears ref without dispatching when threshold never crossed → pure click → no modal.
- `Grid.tsx` `onCellMouseDown` prop signature gains `clientX, clientY` (self-review WARN-2: explicit coords, not raw event, for test simplicity). One caller in `SlotCalendar`.
- Export `MOUSE_DRAG_THRESHOLD_PX = 5` so tests can override or assert.

**Rationale for 5px Chebyshev:** FullCalendar / Cal.com / Cocoa / Windows DnD sit at 4-10px. Grid half-hour rows are ~24px tall; 5px = ~20% of a cell — above pointer jitter, below «drift into next cell». Time delta is NOT used (long-press isn't a known gesture here).

### Sub-PR 2 — consolidated modal state + ESC/busy guards + drag-state cleanup (BUG-2, 3a, 3b, 4)

Replace 3 useStates with single discriminated union in `app/teacher/calendar/client.tsx`:

```ts
type CalendarModalState =
  | { kind: 'closed' }
  | { kind: 'slot-detail'; row: CalendarRow }
  | { kind: 'paint-confirm'; span: PaintSpan }
  | { kind: 'single-create' }
  | { kind: 'bulk-create' }
  | { kind: 'assign-direct' }
```

- `setModal({ kind: '...' })` replaces every `setActiveRow` / `setPendingPaint` / `setCreateMode`.
- Each modal renders under `modal.kind === '...'` gate. By construction, at most one mounted.
- `onPaintSpan` from grid: if `modal.kind !== 'closed'`, drop the span (drag commit during open modal = misclick, not data); else `setModal({ kind: 'paint-confirm', span })`.
- `onSlotClick` from grid: if `modal.kind !== 'closed'`, drop (same logic); else `setModal({ kind: 'slot-detail', row })`.
- Top-row `+ Назначить ученику` and `+ Добавить слоты`: `disabled` when `modal.kind !== 'closed'`. Click does nothing while a modal is open.
- Cross-modal switches preserved (single ↔ bulk via existing props).
- **Defensive reducer reset on modal open** (self-review WARN-1): when `setModal` transitions from `closed` to any non-closed kind, also call `SlotCalendar.resetDrag()` (new exposed callback) → dispatches `{type:'reset'}`, clears `pendingPaintRef`, clears `suppressClickRef`. Prevents stuck `painting` state from leaking paint commits after modal closes.

Plus:
- `TeacherSlotDetailModal` (inline in `client.tsx`) — `useEffect` keydown listener; ESC → `onClose()` only when `!busy`. Mirror `AssignDirectModal.tsx:292`.
- `PaintConfirmModal` — same ESC pattern, guard by `busy`.
- `BulkAddSlotsModal` — line 98: `if (e.key === 'Escape' && open && !creating && !previewing) onClose()`. Line 208: `onClick={creating || previewing ? undefined : onClose}`. Header × button: `disabled={creating || previewing}`.

### Sub-PR 3 — top-row button visual polish (BUG-5)

In `app/teacher/calendar/client.tsx:164-187`: gap 8 → 12; primary action style for «+ Назначить ученику» using `--surface-3`; secondary `--surface-2` for «+ Добавить слоты». Tokens only — no new colour values, no new icons (keep minimal blast radius). Reuse existing tokens from `app/globals.css` per `docs/design-system.md`.

---

## Critical files

**Modify:**
- `app/teacher/calendar/client.tsx`
- `components/calendar/SlotCalendar.tsx`
- `components/calendar/Grid.tsx` (prop signature)
- `components/calendar/PaintConfirmModal.tsx`
- `components/calendar/BulkAddSlotsModal.tsx`
- `tests/teacher-cabinet-polish/calendar-page-state-matrix.test.tsx`

**Do not touch:**
- `lib/calendar/drag-state.ts` — reducer stays pure
- `components/calendar/AssignDirectModal.tsx` — already correct
- `components/calendar/MobileCreateFab.tsx` — already correct (ESC guarded by `!busy`)
- Any `lib/payments/`, `lib/security/`, `lib/auth/` — out of scope

**New tests:**
- `tests/calendar/slot-calendar-click-vs-drag.test.tsx` — 4 cases (pure click, sub-threshold, supra-threshold, cross-cell drag)
- `tests/calendar/teacher-slot-detail-modal-esc.test.tsx` — ESC closes; ESC during busy no-op
- `tests/calendar/bulk-add-slots-modal-close-guards.test.tsx` — ESC + backdrop + × blocked during creating / previewing
- `tests/calendar/calendar-single-modal-invariant.test.tsx` — for every modal-open transition (5 modals × open/close), assert `screen.queryAllByRole('dialog').length <= 1`. Covers BUG-2 by construction (self-review WARN-3: new file, not modification of `calendar-page-state-matrix.test.tsx` which lives in a different scope).

---

## Reuse

- `components/ui/primitives/` (`ChipGroup`, `Combobox`, `DatePicker`, `Pill`, `Banner`) — already wired in modals; no new primitives.
- `SlotCalendar.tsx` existing `dragStateRef`, `suppressClickRef`, `findCellAt`, document-level listeners — extend, don't duplicate.
- `AssignDirectModal.tsx:292` ESC pattern → copy to PaintConfirmModal + inline TeacherSlotDetailModal.
- `PaintConfirmModal.tsx:91` `busy ? undefined : onCancel` backdrop pattern → copy to BulkAddSlotsModal.

---

## Verification

**Per sub-PR:**
- `npm run test:run -- calendar`
- `npm run build`
- `npm run lint`
- `npm run check:content-style` (only when copy touched in Sub-PR 3 — minimal)

**Browser walkthrough via `playwright` MCP** on `/teacher/calendar` desktop 1440×900, signed in as a teacher with ≥1 own open slot. Scenarios:
1. Click an empty cell → NO modal (BUG-1 proof)
2. Drag empty 06:00 → 07:00 → PaintConfirmModal opens; submit → toast
3. Click own open slot → TeacherSlotDetailModal opens → ESC → closes (BUG-3a proof)
4. `+ Добавить слоты` → opens → ChipGroup «Один слот» → MobileCreateFab opens, BulkAddSlotsModal unmounted (single-modal invariant)
5. Fresh load → drag-paint → confirm modal open → top-row `+ Назначить ученику` is `disabled` (BUG-2 proof)
6. `+ Добавить слоты` → fill → click «Создать» → before response press ESC → modal stays (BUG-4 proof); resolve → modal closes naturally
7. `chrome-devtools` MCP `list_console_messages` → no warnings / errors

**Epic-end:** `/canary` + Sentry check on autodeployed prod.

---

## Pipeline

Per `~/.claude/CLAUDE.md` § Two-checkpoint paranoia + `AGENTS.md` § Skill routing:

- **Plan checkpoint:** `/codex-paranoia plan docs/plans/teacher-calendar-mouse-fix-2026-06-14.md` BEFORE Sub-PR 1. If Codex quota exhausted per memory `codex_quota_exhausted_til_2026_06_11` → self-review fallback + `~/.team/bin/log-event claude block` debt entry; replay on quota return.
- **Sub-PR trailers:** `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-calendar-mouse-fix); epic-end review pending` + `Skill-Used: ...` per sub-PR commit body.
- **Wave checkpoint:** `/codex-paranoia wave <epic-commit-range>` after all 3 sub-PRs merged; final close PR carries `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <range>)`.
- **Doc sweep:** `/document-release` per sub-PR + at epic close. Flip this doc's `Status:` to `SHIPPED` and add to `docs/plans/SHIPPED-INDEX.md`.

---

## Risk + rollback

**Concrete regressions to watch:**
- **Drag-paint feels unresponsive** if 5px too high → lower constant to 4 via the exported knob.
- **Existing reducer / wiring tests** — reducer signature unchanged; threshold lives upstream of dispatch. Tests in `tests/calendar/` continue passing.
- **State-consolidation mistransition** — matrix test in `calendar-page-state-matrix.test.tsx` covers every modal-pair before merge.
- **Top-row `disabled` while modal open** may surprise — intentional; documented here. Audit note added to `docs/audit/frontend-audit-routes.md` per AGENTS.md §1.

**Rollback:** Single revert PR per sub-PR. Pure client UX; no schema / API / auth / payments touched. Zero data implications.

---

## Out of scope (backlog)

- Mobile touch on `/teacher/calendar` — separate session per owner («веб-версии … мышкой»)
- Learner calendar `/cabinet/calendar`
- Visual transition animation on cross-modal switch (single ↔ bulk) — `/design-with-claude:motion-designer` follow-up
- Reducer-level keyboard nav refactor — already pinned by SAAS-1-FOLLOWUP-KEYBOARD; works as-is
