# SAAS-1-FOLLOWUP-KEYBOARD — Arrow-key grid navigation + Enter-to-create on `/admin/slots` Calendar

**Status:** DRAFT 2026-05-18, awaiting `/codex-paranoia plan`.
**Wave name:** SAAS-1-FOLLOWUP-KEYBOARD (out-of-scope follow-up extracted from `docs/plans/calendar-apple-redesign.md`; SAAS-1 was visual-only).
**Trigger:** Per backlog — "Today empty cells expose only mouse handlers on `role='gridcell'` (`components/calendar/Grid.tsx:227-228`); the primary operator action is unreachable from keyboard / screen-reader. Required to close WCAG 2.1 Operable; foundation work for accessibility wave."

Plan-doc shape mirrors `docs/plans/saas-1-5a-token-scoping.md` and `docs/plans/saas-infra-1-jsdom-rtl.md`. All file:line refs verified on `main` 2026-05-18.

---

## 1. Goal

Make the `/admin/slots` Calendar grid (`components/calendar/Grid.tsx`) fully keyboard-operable per **WCAG 2.1 Level A SC 2.1.1 "Keyboard"** and **WAI-ARIA Authoring Practices `grid` pattern**. After this wave:

- Tab moves focus *into* the grid (lands on a single tabbable cell).
- Arrow keys navigate cell-by-cell across days × half-hours.
- Enter / Space on a focused **empty cell** opens `PaintConfirmModal` at that cell's `halfHour` (the same path the mouse `onCellMouseDown` triggers today).
- Enter / Space on a focused **`SlotBlock`** invokes its existing click handler (slot-detail modal / cancel flow).
- Home/End/PageUp/PageDown jump to row / column extremes.
- Focus is always visible via the design-system `--focus-ring-*` tokens.

Non-goal: keyboard nav for `/cabinet/book` (different layout, separate plan). Non-goal: a full WCAG 2.1 **Level AA** audit (touch targets, contrast, axe sweep, etc. — separate epic).

### 1.1 Existing surface inventory

Per COMPANY.md "Survey-before-plan". Cited against `main` 2026-05-18.

**`components/calendar/Grid.tsx` structure** (single client component, ~387 lines):

| Concern | Lines | Notes |
|---|---|---|
| Outer container | `:141-154` | `role="grid"`, `aria-label="Календарь занятий на неделю"`, `display: grid`, 8-column template (60px axis + 7 day columns). |
| Header row (day labels) | `:156-185` | Plain `<div>`, no role. |
| Time-axis column | `:188-215` | `aria-hidden="true"`. Decorative, never focusable. |
| Day column (×7) | `:221-313` | `role="gridcell"`, `aria-label="День {ymd}"`. **One `gridcell` per whole day, not per half-hour.** No `tabindex`, no `onKeyDown`. |
| Mouse paint trigger | `:227-228` | `onMouseDown={handleColumnMouseDown}` → `drag.onCellMouseDown(ymd, halfHour)` where `halfHour` is computed from `e.clientY - rect.top` via `halfHourFromOffset` (`lib/calendar/grid-hit-test.ts`). |
| Mouse drag-extend | `:228` | `onMouseMove={handleColumnMouseMove}` → `drag.onCellMouseEnter(ymd, halfHour)`. Only fires once a drag is in progress (parent state-machine gates). |
| Slot blocks | `:286-297` (`SlotBlock` at `components/calendar/SlotBlock.tsx:37-92`) | `<button>` — natively focusable, click already keyboard-activatable (Enter/Space). Has `aria-label="Занятие {start}–{end}, {label}"`. No `tabindex` override. |
| Paint highlight overlay | `:299-304` | `aria-hidden`, decorative. |
| Move ghost overlay | `:306-311` | `aria-hidden`, decorative. |

**The accessibility gap.** A day column is *one* `role="gridcell"` covering 35 half-hour rows (06:00→23:30). Even if we made it focusable, "Enter" couldn't disambiguate *which* half-hour the operator means. The redesign below introduces a focus cursor at half-hour granularity that does not change the visual layout (still one column DOM-node per day, focus model lives at half-hour granularity in state + an overlay div).

**Related surface (no change needed):**

- `components/calendar/SlotBlock.tsx:37-92` — `<button>`, already keyboard-activatable. We only add a `tabIndex` override (roving) so the grid owns focus order, not browser default.
- `components/calendar/PaintConfirmModal.tsx:82-101` — `role="dialog"`, `aria-modal="true"`, `aria-labelledby="paint-confirm-title"`. Backdrop click no-op while busy. **No focus trap today** — relevant to §6 risks but not changed in this wave (existing limitation tracked separately).
- `components/calendar/Toolbar.tsx:31-73` — `role="toolbar"`, plain `<button>` elements with `aria-label`. Already keyboard-operable; not touched.
- Page-level usage: `components/admin/AdminSlotsClient.tsx` (parent) owns the drag-state reducer + modal mount. The keyboard handlers terminate at the same callbacks the mouse handlers use, so the reducer is untouched.

---

## 2. Design

### 2.1 Focus model — **roving `tabindex`**

Per WAI-ARIA APG grid pattern. Trade-off:

| Option | Pros | Cons |
|---|---|---|
| **Roving `tabindex`** (chosen) | Real DOM focus → `:focus-visible` works without extra CSS; screen readers announce the focused element naturally; matches `<button>` SlotBlock behaviour. | Requires `tabIndex={-1}` on every non-active cell. |
| `aria-activedescendant` | One tab stop on the grid; no per-cell `tabindex` churn. | `:focus-visible` doesn't paint the descendant (need manual class); SR support varies; mismatches the `<button>` SlotBlock natural-focus model. |

**Decision: roving `tabindex`.** Active cell carries `tabindex="0"`; every other cell + every SlotBlock carries `tabindex="-1"`. Arrow keys move active-cell state in the parent and re-focus the new active node via a `ref` after re-render. First mount picks "today @ 09:00 half-hour" if present in the visible week, else the first half-hour of the first day.

**Half-hour cell DOM.** Each day column gets an overlay grid of 35 invisible `<div role="gridcell" tabindex={...}>` siblings (one per half-hour), absolutely positioned at `top: halfHour * CELL_HEIGHT_PX`, `height: CELL_HEIGHT_PX`, `pointerEvents: 'none'` so the existing mouse handlers on the parent column still receive `onMouseDown`/`onMouseMove`. The day-column `<div>` keeps its outer `role="gridcell"` removed in favour of `role="row"` (or `role="presentation"` — see §4 decision).

### 2.2 Key bindings

All handled on the grid container (`onKeyDown` at `role="grid"`), dispatched against the active-cell `(dayIdx, halfHour)`:

| Key | Action |
|---|---|
| `ArrowUp` | `halfHour -= 1` (clamp at 0). |
| `ArrowDown` | `halfHour += 1` (clamp at 34, since 35 rows × 30min = 06:00→23:30). |
| `ArrowLeft` | `dayIdx -= 1` (clamp at 0). |
| `ArrowRight` | `dayIdx += 1` (clamp at 6). |
| `Home` | `dayIdx = 0` (first cell in row). |
| `End` | `dayIdx = 6` (last cell in row). |
| `PageUp` | `halfHour = 0` (top of column). |
| `PageDown` | `halfHour = 34` (bottom of column). |
| `Enter` / `Space` | If the active cell intersects a `SlotBlock`: invoke `onSlotClick(row)`. Else: invoke `drag.onCellMouseDown(ymd, halfHour)` — the same callback the mouse-drag uses to open `PaintConfirmModal`. |
| `Escape` | If a modal is open: handled by the modal (existing behaviour). Otherwise no-op. |

Every handler calls `e.preventDefault()` to suppress page scroll on arrow / PageUp / PageDown / Space.

**Slot-vs-empty resolution.** The active half-hour either falls inside an open/booked slot's `[topHalfHour, topHalfHour + durationHalfHours)` span or it doesn't. Computed from the same `grouped.get(ymd)` data the column render already iterates over (`Grid.tsx:286`). If multiple slots cover the cell (data invariant says they can't, but defensive), pick the one with the smaller `topPx`.

### 2.3 Focus-ring CSS

Use the design-system focus-ring tokens already defined in `docs/design-system.md:520-534`:

```
--focus-ring-color: rgba(216,138,130,0.60);   /* accent at 60% alpha */
--focus-ring-width: 4px;
--focus-ring-offset: 2px;
```

Per SAAS-1 5.A token-scoping, these tokens live under `.saas-chrome` and are visible on `/admin/(gated)/*`. Apply via `:focus-visible` (not `:focus`) so mouse clicks don't paint the ring:

```css
.calendar-cell:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: calc(var(--focus-ring-offset) * -1); /* inset, the cell is full-width */
  border-radius: 2px;
}
```

SlotBlock buttons inherit the global `*:focus-visible` rule from design-system §11, no extra CSS.

### 2.4 Auto-scroll on viewport overflow

When `halfHour` moves past the visible scroll area (grid container has internal scroll if the parent layout constrains height), call `activeCellRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' })` after focus moves. `behavior: 'auto'` (not `'smooth'`) because rapid arrow-key holds need instant catch-up; smooth-scroll lag is jarring. See §6 RISK-3.

---

## 3. Tests

Depends on **SAAS-INFRA-1** (`docs/plans/saas-infra-1-jsdom-rtl.md`) shipping jsdom + RTL first. Without that, only the pure cell-resolution helper can be unit-tested.

**Pure helpers** (extractable to `lib/calendar/grid-keyboard.ts`):

1. `slotAtCell(grouped, ymd, halfHour) → CalendarRow | null` — pin slot-resolution logic. Cases: empty cell, cell inside open slot, cell at top half-hour of slot, cell at last half-hour of slot, cell just past slot end (must be null).
2. `nextActiveCell(active, key) → {dayIdx, halfHour}` — pure reducer for arrow / Home / End / PageUp / PageDown. Cases: clamp at each edge, no-op when already at edge, all 8 keys.

**Component render tests** (RTL, gated on SAAS-INFRA-1):

3. First mount: today's first visible cell gets `tabindex="0"`, all others `tabindex="-1"`.
4. `ArrowRight` on day 0 / halfHour 0 → focus moves to day 1 / halfHour 0; tabindex flips; `document.activeElement` is the new cell.
5. `ArrowUp` at halfHour 0 → no-op (focus stays); `e.preventDefault` called.
6. `Enter` on an empty cell → spy on `onCellMouseDown` fires with `(ymd, halfHour)` matching the focused cell.
7. `Enter` on a cell that overlaps a `SlotBlock` → spy on `onSlotClick` fires with the matching `CalendarRow`; `onCellMouseDown` does NOT fire.
8. `Space` mirrors `Enter` for both cases (one parametrised test).
9. `Home` / `End` / `PageUp` / `PageDown` — one assertion each on the resulting active cell.

**Integration test** (Playwright, separate suite — optional, can defer):

10. Open `/admin/slots`, Tab to grid, ArrowDown ×4, Enter → `PaintConfirmModal` opens with the expected `span.fromHalfHour`. Marked `@a11y-keyboard`, runs in CI alongside existing admin specs.

Coverage targets: keyboard helper module ≥95% lines; component test file ≥85% lines (matches global thresholds in `vitest.config.ts:37-42`).

---

## 4. Implementation notes

- **Outer `role="grid"`** stays as-is.
- **Each day column** changes from `role="gridcell"` (`Grid.tsx:224`) to `role="row"` (one row per day in the WAI-ARIA grid model — *transposed* from the visual row=time, column=day convention because each `gridcell` must live inside exactly one `row`). Mouse handlers on the column are unchanged; only the role attribute moves.
- **Half-hour overlay cells** are new: 35 invisible `<div role="gridcell" tabindex={...} ref={...}>` per column. `pointerEvents: 'none'` so they don't shadow the column's mouse handlers; `inset: 0` with computed `top`/`height` per cell. Each cell gets `aria-label="{DOW} {ymd} {hh:mm} — {занят / свободен}"` derived from `slotAtCell`.
- **`SlotBlock` `tabIndex` override.** Add `tabIndex={isActive ? 0 : -1}` prop. When the active cell falls inside a slot, the SlotBlock owns focus (not the overlay cell beneath it); Enter/Space already triggers click.
- **Active-cell state** lives in `Grid.tsx` via `useState<{dayIdx: number; halfHour: number}>`. A ref-map (`Map<string, HTMLDivElement | HTMLButtonElement>`) keyed by `${ymd}#${halfHour}` lets the effect re-focus on state change.
- **No prop-API changes** to `GridProps` or `GridDragHandlers`. The keyboard path reuses the existing `drag.onCellMouseDown` and `onSlotClick` callbacks verbatim — same call signature, same parent reducer, same modal mount.

---

## 5. Decomposition

**Single PR.** Component change + pure-helper module + RTL tests + CSS focus-ring rule. ~250 lines of code + ~150 lines of test. Atomic because:

- The focus model and the activation handlers are tightly coupled (an activation handler with no focus model is dead code; a focus model with no activation handlers is a half-feature that ships a regression — Enter does nothing).
- The CSS rule is 4 lines; splitting it into a second PR is overhead theatre.
- Test file imports the component; can't land before the component change.

**Rejected alternative:** PR1 focus model only (tabindex + arrow keys) → PR2 activation (Enter/Space). Rejected because PR1 in isolation is user-visible (focus ring appears, arrows move) but functionally a regression (Enter does nothing on what looks like an interactive element). Worse UX than the status quo.

Sub-wave SUB-WAVE self-review under Claude per epic-level paranoia contract; epic-end paranoia is this single PR's wave-checkpoint.

---

## 6. Risks

**RISK-1 (LOW): Focus trap on modal open.** `PaintConfirmModal` (`PaintConfirmModal.tsx:82-101`) does not currently install a focus trap. When Enter on an empty cell opens it, focus stays on the cell underneath; screen reader keeps announcing the cell, not the modal. Mitigation: out of scope for this wave (existing behaviour, not regressed by keyboard nav — a mouse-opened modal has the same gap). Tracked for the next a11y wave.

**RISK-2 (MEDIUM): Screen-reader announcement quality.** Per-cell `aria-label` includes Russian DOW + ymd + hh:mm + status. NVDA/JAWS will read this on every arrow press → can become verbose. Mitigation: use `aria-label` only on cells with status (booked/conflict); empty cells get a shorter label (`"Пн 2026-05-18 09:00 свободно"` vs `"Пн 2026-05-18 09:00"`). Verify with a manual NVDA pass before merge.

**RISK-3 (LOW): Scroll-jumping when nav'ing past viewport.** If the grid container has internal overflow (depends on parent layout — `app/admin/(gated)/slots/page.tsx` flow), holding ArrowDown could jump unnaturally as `scrollIntoView` fires every frame. Mitigation: `block: 'nearest'` (only scrolls when actually offscreen, not on every move); `behavior: 'auto'` to avoid lag. If still janky, debounce to one scroll per 16ms (one frame).

**RISK-4 (LOW): Day-column `role` change.** Changing `role="gridcell"` → `role="row"` on the day-column `<div>` could break any test or screen-reader expectation that targets `gridcell` at the column level. Mitigation: grep usages — currently zero RTL tests target the column role (no `.tsx` test files exist pre-SAAS-INFRA-1); the change is conceptually correct per WAI-ARIA grid pattern.

**RISK-5 (LOW): Roving-tabindex with React re-renders.** If the parent re-fetches and `grouped` changes (e.g. new slot lands via auto-refresh), the active cell's DOM node may unmount/remount and lose focus. Mitigation: after each render, the `useEffect` that focuses `activeCellRef.current` runs; if the ref is null (cell unmounted), fall back to the day column's `<div>` to keep focus inside the grid.

---

## 7. Rollout

Single PR → standard `/codex-paranoia wave` after merge → no flags, no migration. Behaviour change is purely additive (mouse path unchanged).

---

## 8. Open questions

None blocking. The roving-tabindex vs `aria-activedescendant` decision (§2.1) is locked. The 1-PR vs 2-PR decomposition (§5) is locked.

---

## 9. References

- WAI-ARIA Authoring Practices, **Grid Pattern** — https://www.w3.org/WAI/ARIA/apg/patterns/grid/
- WCAG 2.1 SC 2.1.1 **Keyboard (Level A)** — https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html
- `components/calendar/Grid.tsx` (lines cited inline).
- `components/calendar/SlotBlock.tsx:37-92`.
- `components/calendar/PaintConfirmModal.tsx:82-101`.
- `docs/design-system.md:515-534` (focus-ring tokens).
- `docs/plans/saas-infra-1-jsdom-rtl.md` (jsdom dependency for §3 tests).
- `docs/plans/calendar-apple-redesign.md` (SAAS-1 parent wave; visual-only).

---

## 10. Out of scope

- **Keyboard nav for `/cabinet/book`.** Different layout (single-slot picker, not a week grid). Separate plan-doc.
- **Full WCAG 2.1 Level AA audit.** Touch targets, contrast pairs, axe-core CI gate, prefers-reduced-motion, skip-to-content links — a dedicated accessibility wave.
- **Focus trap inside `PaintConfirmModal`.** RISK-1 above; existing gap, not introduced or worsened here.
- **Drag-paint via keyboard.** Today mouse paint extends with `onMouseMove`. Keyboard equivalent would be Shift+Arrow to extend a paint span. Deferred — Enter-to-create a single-cell paint is enough for primary operator action.
- **Toolbar keyboard shortcuts** (`,`/`.` for prev/next week, `t` for today). Nice-to-have; native Tab order through `Toolbar.tsx` already works.
