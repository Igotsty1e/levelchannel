# Calendar Apple-redesign — `/admin/slots` grid 1h + Apple aesthetic

**Status:** DRAFT 2026-05-18, awaiting `/codex-paranoia plan`.
**Wave name:** SAAS-1.
**Trigger:** Product-owner request 2026-05-18 — operators report the current
30-min grid feels dense and unrelated to the new design system. Reference:
native macOS Calendar (week view) screenshot in intake.

Plan-doc shape mirrors `docs/plans/booking-calendly-style.md` and
`docs/plans/conflict-feed.md`. All file:line refs verified on `main`
2026-05-18.

## 1. Goal

Replace the 30-min row grid on `/admin/slots` Calendar tab with a 1-hour
row grid and apply the Apple Calendar visual language (sticky day
headers, today-column tint, half-hour dotted sub-tick, current-time
indicator, accent-tinted event chips with 3px left border, translucent
drag ghost).

**Explicit non-goal — `/cabinet/book` is OUT of scope.** That surface is
a list IA (`app/cabinet/book/[ymd]/time-list.tsx:25-56`), not a grid. A
separate plan (SAAS-CABINET-1) will cover it later.

The data model does NOT change. Slots stay 30-min-aligned (schema CHECK
`(extract(minute from start_at)::int % 30) = 0`;
`lib/scheduling/slots/types.ts:12` `SLOT_GRID_MINUTES = 30`). Hour grid
means grid LINES render every 60 min; a slot starting at `:30` renders
offset half-cell down with the dotted half-hour sub-tick guiding the
eye.

## 2. Existing surface inventory

Per COMPANY.md "Survey before plan". Cited against `main` 2026-05-18.

### 2.1 Page + switcher

- **`app/admin/(gated)/slots/page.tsx:1-51`** — server component; loads
  teachers/slots/tariffs/learners, hands to `SlotsViewSwitcher`. Unchanged.
- **`app/admin/(gated)/slots/slots-view-switcher.tsx:33-274`** — client
  switcher. Owns tab state (`:34`), calendar-teacher select (`:35-37`),
  active-row modal state (`:38`), `reloadCounter` for in-place refetch
  (`:39, :48-50`), paint-pending state (`:40`), toast (`:41-46`).
  `handleMoveTarget` (`:52-88`) synthesises `startAt` via
  `halfHourToUtcIso` (`:336-351`), PATCHes `/api/admin/slots/[id]/move`,
  refetches in `finally`. `handlePaintConfirm` (`:90-137`) POSTs
  `/api/admin/slots/bulk-create`, refetches in `finally`.
  `currentMondayYmd` (`:307-330`) — MSK Monday-of-week.
  **Inline `halfHourToUtcIso` (`:336-351`) is load-bearing** — drag
  reducer emits half-hour coords; this helper stays unchanged in the
  migration (§4).

### 2.2 List tab + modals (NOT touched)

- **`app/admin/(gated)/slots/slots-manager.tsx:1-1046`** — list
  renderer; switcher branches there when `tab === 'list'` (`:154-161`).
  Wave touches only the Calendar branch (`:161-241`).
- **`app/admin/(gated)/slots/slot-cancel-modal.tsx:1-319`** — launched
  by `setActiveRow`; decides actions via `slot.kind` (`:39-42`). Modal
  shell redesign is a separate wave (SAAS-MODAL-1).
- **`components/calendar/PaintConfirmModal.tsx`**,
  **`components/calendar/BookConfirmModal.tsx`** — NOT touched.

### 2.3 Calendar primitives — current renderer

- **`components/calendar/SlotCalendar.tsx:1-413`** — composition root.
  Drag reducer + ref (`:118-130`), `dayRefs` map for hit-test
  (`:136-163`), `findCellAt(clientX, clientY)` (`:142-163`) maps
  pointer→halfHour via `Math.floor(offsetY / CELL_HEIGHT_PX)`,
  `suppressClickRef` (`:169`), always-on document listeners (`:193-249`)
  for mousemove/mouseup/Escape/pointercancel/visibilitychange/blur.
  `CELL_HEIGHT_PX = 30 * CALENDAR_GRID_PX_PER_MIN` (`:65`) — 45 px
  half-hour bucket. **The half-hour bucket stays 45 px for hit-test;
  only RENDERED row height changes to 90 px.**

- **`components/calendar/Grid.tsx:1-305`** — pure layout, CSS grid
  `60px repeat(7, 1fr)` (`:128`). Duplicate `CELL_HEIGHT_PX` at `:60`.
  `halfHourFromOffset` (`:79-84`), `handleColumnMouseDown/MouseMove`
  (`:86-106`) wired to day-column mousedown for paint start —
  unchanged. Header row (`:139-156`) DOW + day number; NOT sticky today.
  Time-axis column (`:159-185`) renders labels every 30 min via
  `timeAxisLabels()`. Day columns (`:188-233`) host
  absolute-positioned SlotBlocks over a `repeating-linear-gradient`
  background (`gridBackground`, `:296-304`). Overlays:
  `PaintHighlight` (`:238-266`), `MoveGhost` (`:268-294`).

- **`components/calendar/SlotBlock.tsx:1-167`** — single chip; absolute
  position via `row.topPx / row.heightPx`. Palette per kind
  (`:103-128`): open=green, booked-self=blue, booked-other/-full=grey,
  past-*=dark grey. Conflict palette (`:97-101`, red);
  `slotHasConflict` (`:88-95`). `cursor: grab` when draggable (`:54`),
  no hover-α today. aria-label preserved verbatim (`Доступен`,
  `Ваше занятие`, `Занято`, `Забронировано`, `Прошедшее`,
  `… · конфликт`).

- **`components/calendar/Toolbar.tsx:1-97`** + **`MobileFallback.tsx`**
  — unchanged; pick up §3 tokens automatically.

### 2.4 Time math + view model

- **`lib/calendar/dates.ts:158-163`** — current constants:
  `CALENDAR_GRID_START_HOUR=6`, `_END_HOUR=23`, `_PX_PER_MIN=1.5`,
  `_DAY_HEIGHT_PX = ((23 + 0.5 - 6) * 60) * 1.5 = 1575`.
  Hour grid: 17 hour rows × 90 px = 1530 (06:00..22:00 inclusive).
- **`lib/calendar/view-model.ts:28-54`** — `groupSlotsByDay` derives
  `topPx = mskMinutesFromGridStart * 1.5`,
  `heightPx = durationMinutes * 1.5`. Unchanged — px/min stays 1.5.
- **`lib/calendar/view-model.ts:88-96`** — `timeAxisLabels()` returns 35
  half-hour labels. Wave adds `hourAxisLabels()` (17 hour labels).

### 2.5 Drag-state reducer (HALF-HOUR STAYS)

- **`lib/calendar/drag-state.ts:1-225`** — pure reducer. `CalendarCoords`
  uses `halfHour: 0..35` (`:23-26`); `HALF_HOUR_MAX=35` (`:100`);
  `PaintSpan from/toHalfHour` (`:73-77`); `MoveTarget origin/newHalfHour`
  (`:79-86`); single-day clamp on paint (`:156-158`); move can cross
  days (`:166-178`). **Reducer unchanged in this wave** — DB CHECK keeps
  30-min alignment.

### 2.6 Validation contract (server, untouched)

`lib/scheduling/slots/validation.ts:20-55` — `validateSlotStartMsk`
asserts `(minute === 0 || minute === SLOT_GRID_MINUTES) && second === 0`
and `hour ∈ [MIN..MAX]` (`:38-47`). Constants in
`lib/scheduling/slots/types.ts:10-12`: `MSK_BUSINESS_HOUR_MIN=6`,
`MSK_BUSINESS_HOUR_MAX=22`, `SLOT_GRID_MINUTES=30`. DB CHECK in
`migrations/0031_lesson_slots_domain_invariants.sql` mirrors the
predicate. **No CHECK change in this wave.**

## 3. Design — the redesign concretely

Tokens referenced from `docs/design-system.md` (sibling-drafted in
parallel, lands before SAAS-1.A): §Color (accent + status palettes),
§Spacing (4/8/12/16/24 px scale), §Typography (mono digits for time,
weight ladder), §Radii (6px chip, 12px container), §Motion (80–160 ms
ease curves).

### 3.1 Hour-row grid constants

**Round-1 paranoia revision 2026-05-18 — BLOCKER#1:** the original draft proposed `CALENDAR_GRID_VISIBLE_ROWS = 17` (06:00–22:00), which clips slot ends past 22:00. Schema invariants allow slot `start_at` up to 22:00 (band CHECK) and `duration_minutes` up to 240 min — meaning a 22:00 / 90-min slot ending at 23:30 IS valid and pinned in `tests/calendar/view-model.test.ts:66-77`. The previous `CALENDAR_GRID_DAY_HEIGHT_PX = 1575` was sized for exactly this case (1575 px = 17:30 hours × 90 px/hour from 06:00 to 23:30).

Revised constants in `lib/calendar/dates.ts`:

```
CALENDAR_HOUR_ROW_PX             = 60 * 1.5 = 90
CALENDAR_GRID_START_HOUR         = 6
CALENDAR_GRID_END_HOUR_EXCLUSIVE = 24                   // visible up to 24:00
CALENDAR_GRID_VISIBLE_ROWS       = 18                   // 06..24 inclusive
CALENDAR_GRID_DAY_HEIGHT_PX_V2   = 18 * 90 = 1620       // > 1575 (existing)
```

Rationale: 18 rows (06:00–24:00) is the smallest band that fully shows every slot the schema allows (max start 22:00 + max duration 240 = 26:00 next day, BUT the test corpus + production data show no slots end past 24:00; the rare 22:00+120-min case extends to 24:00 exactly, which the new band covers; the theoretical 22:00+240-min case would clip — flagged as known-non-regression because no such slot has ever shipped on prod and the existing 1575 px geometry also clips it).

The existing `CALENDAR_GRID_DAY_HEIGHT_PX` (1575) stays exported until the tidy-up sub-PR; `grep -r CALENDAR_GRID_DAY_HEIGHT_PX` shows only two consumers (Grid.tsx:66, SlotCalendar.tsx:65). Both swap to the v2 constant.

**Geometry test (regression pin):** `tests/calendar/view-model.test.ts` gets a new case asserting the 22:00→23:30 slot has `top=1440, height=135, bottom=1575 <= dayHeight=1620`. This is the failing assertion under the original draft and the keystone of BLOCKER#1.

### 3.2 Grid lines + half-hour sub-ticks

Replace `gridBackground()` (`Grid.tsx:296-304`) with a layered overlay
per design-system §Spacing:

- Layer 1: thin hour divider every 90 px,
  `rgba(255,255,255,0.055) 1px`.
- Layer 2: every 6 hours a slightly darker grouping divider,
  `rgba(255,255,255,0.085) 1px`.
- Layer 3: half-hour dotted sub-tick (absolute-positioned overlay
  `<div aria-hidden>` per day column, 16 elements at odd 45px offsets,
  `border-top: 1px dotted rgba(255,255,255,0.07)`). Overlay (not
  gradient) because dotted gradients are not crisp cross-browser.

### 3.3 Today column highlight + day-number circle

Day column root gets `data-today="true"` when its ymd matches MSK's
current ymd:

```css
[role="gridcell"][aria-label^="День "][data-today="true"] {
  background-color: color-mix(in srgb, var(--accent) 4%, transparent);
}
```

**Round-3 paranoia revision 2026-05-18 — user decision option (a):** all `rgba(var(--*-rgb), α)` patterns in this plan have been rewritten to CSS `color-mix(in srgb, var(--<token>) <pct>%, transparent)`. The `--*-rgb` companion tokens DO NOT exist in `docs/design-system.md` v1 (only `--accent`, `--accent-bg`, `--accent-bg-strong`, `--danger`, `--danger-bg`, `--info`, `--info-bg`, `--text-on-accent`). `color-mix()` is supported by all 4 major browsers since 2023 (Chrome 111+, Safari 16.2+, Firefox 113+, Edge 111+ — well above LevelChannel's browser baseline). Single-token contract preserved; foundation stays narrow.

Day header for today renders the day number inside an accent-filled
circle (Apple pattern):
`<span class="day-number-today">15</span>` →
`background: var(--accent); color: var(--text-on-accent); border-radius: 50%`.

### 3.4 Sticky day-header row

Today the header is grid-row-1 of the CSS Grid. Wave wraps the grid in
a scroll container and pins the header:

```
<div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 240px)' }}>
  <div role="grid">
    <div style={{ position: 'sticky', top: 0, zIndex: 6 }}>
      {/* corner + 7 day headers */}
    </div>
    <!-- time axis + 7 day columns -->
  </div>
</div>
```

z-stack (lowest → highest): bg-overlay 1 · chip 2 · paint/move ghost 5 ·
sticky header 6 · current-time line 7.

### 3.5 Event chip — Apple aesthetic per `kind`

Replaces `SlotBlock.paletteForKind` (`:103-128`) with CSS classes.
Palette is in a new `lib/calendar/palette.ts` (shareable, testable):

| `slot.kind`              | `--chip-accent` resolves to | bg α | text          | left-border |
|--------------------------|-----------------------------|------|---------------|-------------|
| `open`                   | `--success` (semantic green)| 15%  | `--text-primary` | 3 px solid |
| `booked-self`            | `--accent`                  | 18%  | `--text-primary` | 3 px solid |
| `booked-other` / `-full` | `--text-secondary`          | 10%  | `--text-secondary` | 3 px solid |
| `past-full` / `-redacted`| `--text-tertiary`           | 8%   | `--text-tertiary` | 3 px solid |
| conflict overlay         | `--danger`                  | 18%  | `--text-primary` | 3 px solid (cascade-overrides kind) |

`paletteClassFor(kind)` resolves to a class name with the chip-accent token assigned via a CSS custom property at the element scope:

```css
.calendar-slot-block {
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  line-height: 1.3;
  border: none;
  border-left: 3px solid var(--chip-accent);
  background-color: color-mix(in srgb, var(--chip-accent) 15%, transparent);
  color: var(--text-primary);
  transition: background-color 100ms ease;    /* §Motion */
}
.calendar-slot-block.kind-booked-self  { --chip-accent: var(--accent); }
.calendar-slot-block.kind-open         { --chip-accent: var(--success); }
.calendar-slot-block.kind-booked-other,
.calendar-slot-block.kind-full         { --chip-accent: var(--text-secondary); }
.calendar-slot-block.kind-past-full,
.calendar-slot-block.kind-redacted     { --chip-accent: var(--text-tertiary); }
.calendar-slot-block:hover {
  background-color: color-mix(in srgb, var(--chip-accent) 25%, transparent);
}
.calendar-slot-block:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.calendar-slot-conflict {
  --chip-accent: var(--danger);
  background-color: color-mix(in srgb, var(--danger) 18%, transparent);
  color: var(--text-primary);
}
```

The element-scoped `--chip-accent` swap is the modern equivalent of the original "pass color in as a CSS variable" pattern, but uses ONLY tokens defined in `docs/design-system.md` v1. No new foundation token required.

Content layout preserved: time range (mono digits), optional tariff
badge, kind label. Russian copy verbatim.

### 3.6 Current-time indicator

Absolute-positioned horizontal line at
`topPx = currentMskMinutesFromGridStart() * 1.5`. Rendered only when the
displayed week contains today (MSK):

```css
.calendar-now-line {
  position: absolute; left: 0; right: 0;
  height: 0;
  border-top: 1px solid var(--danger);
  z-index: 7;
  pointer-events: none;
}
.calendar-now-line::before {
  content: ''; position: absolute;
  left: -4px; top: -4px;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--danger);
}
```

Rendered as a sibling layer spanning the 7 day columns (NOT the time
axis). Updates every 60 s via `useInterval`.

### 3.7 Responsive — MobileFallback breakpoint

`useNarrowContainer` (`MobileFallback.tsx`) — **threshold stays at
~720 px (verified from `components/calendar/MobileFallback.tsx:40`) container width** (design-system §Spacing breakpoint "md"). The
fallback renders the per-day list, same as today. No visual change in
fallback land in MVP.

### 3.8 Drag-to-create + drag-move ghost (Apple translucent)

`PaintHighlight` (Grid.tsx:238-266) and `MoveGhost` (`:268-294`):

```css
.calendar-paint-ghost, .calendar-move-ghost {
  position: absolute; left: 4px; right: 4px;
  border-radius: 6px;
  pointer-events: none;
  z-index: 5;
}
.calendar-paint-ghost {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  border-left: 3px solid var(--accent);
}
.calendar-move-ghost {
  background: color-mix(in srgb, var(--info) 20%, transparent);
  border-left: 3px solid var(--info);
}
```

Solid translucent fill + accent stroke (no dashed border). The
PaintConfirmModal still pops on mouseup — operator never wonders "did
this commit?".

### 3.9 Keyboard navigation — DEFERRED

**Decision: defer arrow-key cell nav + Enter-to-create.** Rationale:
introducing a focus model is design-heavy (focus-ring shape,
screen-reader semantics for "06:00, Чт, пусто", Tab-trap inside the
grid). SlotBlock is already a focusable `<button>`; that stays. New
`:focus-visible` ring (§3.5) makes existing keyboard focus visible.

`SAAS-1-FOLLOWUP-KEYBOARD` ticket goes into `ENGINEERING_BACKLOG.md`
§ Calendar UX.

### 3.10 Hover affordances

- Empty cell hover: `cursor: crosshair` already set when drag-handlers
  wired (Grid.tsx:203). MVP keeps as-is.
- Chip hover: bg-α 0.15 → 0.25 (§3.5).

## 4. Impact on existing logic — invariants preserved

1. **Drag-paint still emits half-hour cell ranges.** The reducer keeps
   `halfHour: 0..35`, `PaintSpan` keeps `from/toHalfHour`. Hour grid is
   visual grouping only.
2. **`bulkCreateSlots` contract preserved.** Confirm modal still expands
   the span into individual slot starts on 30-min boundaries with the
   teacher's `durationMinutes` (`slots-view-switcher.tsx:90-137`).
3. **`halfHourToUtcIso` (slots-view-switcher.tsx:336-351) unchanged.**
   `validateSlotStartMsk` continues to enforce 30-min alignment.
4. **No DB migration.** Schema CHECK constants are unchanged.
5. **Existing `:30`-start slots render correctly.** Example: an 18:30
   slot has `topPx = (12.5 * 60) * 1.5 = 1125`. The new 18:00 hour row
   starts at 1080 and the 19:00 row at 1170 → the slot sits centred
   in the cell, with the dotted half-hour sub-tick at exactly 1125.
6. **`findCellAt` semantics preserved.** Half-hour bucket (45 px) stays
   for hit-test; only the RENDER groups them by hour. `findCellAt`
   source doesn't change.
7. **Conflict outline preserved** (`SlotBlock.tsx:88-95`). 2 px red
   border becomes 3 px left-stroke + 0.18 bg via cascade override.

## 5. Implementation phases — 6 sub-PRs (each ≤ ~150 LoC delta)

**Round-1 paranoia revision 2026-05-18:** added 5.docs (doc-sweep, WARN#7), revised 5.A scope (token-blast-radius, WARN#5+#6), added 5.F drag-math-coverage (BLOCKER#3).

**5.A — design tokens, scoped to `.saas-chrome` class selector.** Round-1 WARN#5 + round-3 attachment-point fix: `app/globals.css :root` vars (`--bg`, `--text`, `--accent` etc.) are consumed by `/pay`, `/admin/(gated)/layout.tsx`, marketing landing. Touching them changes blast radius beyond /admin/slots. Per `docs/design-system.md` §"Migration baseline" Phase 0, scope SaaS tokens under a class selector:

```css
.saas-chrome {
  --accent: #D88A82;
  --text-on-accent: #fff;
  --text-primary: #F5F5F7;
  --text-secondary: #9c9ca0;
  --text-tertiary: #6c6c70;
  --danger: #e85a4f;
  --info: #4a9eff;
  --success: #6fcf97;
  --warning: #f2c94c;
  /* ...etc. per design-system §Color */
}
```

**Attachment-point inventory (round-3 WARN#3 closure)** — `.saas-chrome` is added to exactly these shell wrappers in this sub-PR:
- `app/admin/(gated)/layout.tsx` — wraps the admin chrome `<div>` (around line 43, the outermost container that holds the sidebar + content area).
- `components/auth-shell.tsx` — wraps the `<div>` returned by `AuthShell` (around line 9).
- Cabinet shell — `app/cabinet/page.tsx` doesn't use AuthShell at the top; if its outer div doesn't carry the class through `AuthShell`, add `.saas-chrome` to its outermost wrapper too. Verify at impl by reading the current render tree.

NOT added to: `/pay`, marketing landing, `/offer`, `/privacy`, `/consent` — these keep current palette (the gradient + warm beige tones). The class scope means tokens defined inside `.saas-chrome` do NOT leak via inheritance because they're CSS custom properties scoped to that element + descendants.

**Files touched in 5.A:** `app/globals.css` (+120 inside `.saas-chrome` block), `app/admin/(gated)/layout.tsx` (+1 class), `components/auth-shell.tsx` (+1 class), `app/cabinet/page.tsx` (+1 class IF its outer container doesn't already inherit from AuthShell).

**5.B — hour-grid constants + axis labels.** `lib/calendar/dates.ts` adds `CALENDAR_HOUR_ROW_PX=90`, `CALENDAR_GRID_START_HOUR=6`, `CALENDAR_GRID_END_HOUR_EXCLUSIVE=24`, `CALENDAR_GRID_VISIBLE_ROWS=18`, `CALENDAR_GRID_DAY_HEIGHT_PX_V2=1620` (keeps old 35-row consts for transition). `lib/calendar/view-model.ts` adds `hourAxisLabels()` (length 18), marks `timeAxisLabels()` `@deprecated`. Tests: extend `dates.test.ts` + `view-model.test.ts` with the 22:00→23:30 geometry case from §3.1.

**5.C — port Grid.tsx to hour grid + sticky header.** Time-axis uses `hourAxisLabels()` at `i * CALENDAR_HOUR_ROW_PX`. Replace `gridBackground()` with layered overlay (§3.2). Wrap header in sticky positioned div (§3.4). Apply `data-today="true"` (§3.3). **Drag math hit-test stays 45-px half-hour bucket** — 5.F adds the explicit coverage previously missing.

**5.D — SlotBlock visual.** Replace inline `style` with CSS classes (§3.5). New `lib/calendar/palette.ts` exports class resolution per kind + conflict overlay. Tests: **node-env, NOT jsdom** (round-1 BLOCKER#2): assert `paletteClassFor(kind)` returns the expected class string from a pure function — no DOM render. Component-render assertions deferred until project gains jsdom infra; tracked as `SAAS-INFRA-1: add @testing-library/react + jsdom to vitest unit suite`.

**5.E — today highlight + current-time indicator.** New `components/calendar/CurrentTimeIndicator.tsx` per §3.6, wired as z-index 7 sibling overlay spanning the 7 day columns. Renders only when `currentMskYmd ∈ weekDayKeys`. Today day-number circle in header (§3.3). `useInterval(60_000)` re-render. Tests: new `tests/calendar/current-time.test.ts` — pure-function math (`currentTimeTopPx(now)`), no component render.

**5.F — drag-math seam coverage (NEW round-1 BLOCKER#3).** Add `tests/calendar/grid-hit-test.test.ts` that pins `halfHourFromOffset(yPx)` (`components/calendar/Grid.tsx:79-105`) and `findCellAt(clientX, clientY, rect)` (`components/calendar/SlotCalendar.tsx:142-158`) under the new 90 px hour row. Cases: yPx=0 → :00; yPx=44 → :00; yPx=45 → :30; yPx=89 → :30; yPx=90 → next-hour :00. Pure function extraction — if the current code embeds these in component bodies, this sub-PR refactors them OUT to `lib/calendar/grid-hit-test.ts` first. This is the test that defends "pointer math accidentally drifts to wrong half-hour bucket" silent-green regression cited in the BLOCKER.

**5.docs — required doc-sweep (round-1 WARN#7).** Update: `ARCHITECTURE.md` calendar section (cite new constants + `lib/calendar/palette.ts` + `components/calendar/CurrentTimeIndicator.tsx`); `lib/calendar/README.md` if it discusses geometry; `ENGINEERING_BACKLOG.md` add formal entries `SAAS-1-FOLLOWUP-KEYBOARD` (keyboard create on empty cells — round-1 WARN#8) and `SAAS-INFRA-1` (jsdom + RTL — round-1 BLOCKER#2 deferred component-render coverage). Without this step the structural change ships with stale prose.

**5.tidy — cleanup (optional, post-staging-soak).** Delete `timeAxisLabels()`; delete `CALENDAR_GRID_DAY_HEIGHT_PX` (rename `_V2` → primary). NOT on the critical path.

## 6. Tests — concrete additions

**Test-environment caveat (round-1 BLOCKER#2):** `vitest.config.ts` is `environment: 'node'` and `package.json` ships no `@testing-library/react` / `jsdom` deps. All new test files in this wave run under node env on pure functions only. Component-render assertions are deferred to `SAAS-INFRA-1`. The original draft's `tests/calendar/slot-block-render.test.tsx` (jsdom + React DOM rendering) is REMOVED from this wave.

| File                                                          | Status | What                                               |
|---------------------------------------------------------------|--------|----------------------------------------------------|
| `tests/calendar/dates.test.ts`                                | EXTEND | New constants + 22:00→23:30 geometry case (§3.1)   |
| `tests/calendar/view-model.test.ts`                           | EXTEND | `hourAxisLabels()` + 22:00→23:30 top/height/bottom |
| `tests/calendar/drag-state.test.ts`                           | GREEN  | Reducer untouched                                  |
| `tests/calendar/grid-hit-test.test.ts`                        | NEW    | `halfHourFromOffset` + `findCellAt` (BLOCKER#3)    |
| `tests/calendar/palette.test.ts`                              | NEW    | `paletteClassFor(kind)` pure function              |
| `tests/calendar/current-time.test.ts`                         | NEW    | `currentTimeTopPx(now)` pure function              |
| `tests/integration/scheduling/calendar-projection.test.ts`    | GREEN  | Reverify `topPx` after hour-row visual shift       |
| `tests/integration/scheduling/calendar-move.test.ts`          | GREEN  | Move endpoint unchanged                            |
| `tests/integration/scheduling/calendar-auth.test.ts`          | GREEN  | Auth unchanged                                     |
| `tests/integration/scheduling/calendar-range-guard.test.ts`   | GREEN  | Range guard unchanged                              |
| `tests/integration/scheduling/slots-flow.test.ts`             | GREEN  | Bulk-create + cancel unchanged                     |
| `tests/scheduling/bulk-preview.test.ts`                       | GREEN  | Preview unchanged                                  |
| `tests/calendar/paint-synth.test.ts`                          | GREEN  | Paint→half-hour starts unchanged                   |

Coverage goal: every existing slot/calendar test stays green; new tests cover the pure-function logic seams (geometry, hit-test, palette, current-time math) of the visual shift only.

## 7. Migration plan

**Additive + code-only.** No DB migration. No feature flag (revert is
rollback). Rollout: 5.A → 5.B → 5.C (smoke) → 5.D (smoke) → 5.E
(smoke) → product-owner sign-off → 5.tidy. No CSP / permissions-policy
/ env-var change; no new endpoint.

## 8. Risks + mitigations

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| R1 | Operators mis-read `:30`-start slots on hour grid | Medium | Hour labels + dotted sub-tick + chip's `HH:MM – HH:MM` text. Staging pilot ≥1 operator. |
| R2 | Touch-targets shrink for half-hour slots | Low | Half-hour slots stay 45 px tall (same as today); hour slots improve to 90 px. |
| R3 | Sticky header vs modal backdrop stacking | Low | Modal z-index 1000 (slot-cancel-modal.tsx:109); header 6. |
| R4 | Current-time line covers a chip's click | Low | `pointer-events: none` on the line (§3.6). |
| R5 | Dotted half-hour tick invisible on dark bg | Low | `rgba(255,255,255,0.07)` per design-system §Color. |
| R6 | Today red dot vs conflict red stroke collision | Low | Different shapes (circle vs left-border). |
| R7 | `setInterval` leak on unmount | Low | `useEffect` cleanup; pattern reused from Toolbar. |
| R8 | Hidden caller of `CALENDAR_GRID_DAY_HEIGHT_PX` | Low | Grep shows 2 hits; keep-and-deprecate handles a 3rd. |
| R9 | High-contrast / forced-colors mode | Medium | `border-left` is structural; design-system §Color has `forced-colors: active` fallbacks. |
| R10 | MobileFallback hides redesign on viewports under 720 px (verified from `components/calendar/MobileFallback.tsx:40`). | Low | Container ~1100 px nominal on operator desktops; existing 720 px breakpoint stays. Round-1 WARN#4 + round-3 cleanup: original draft mistakenly cited 900 px; corrected to actual code value 720 px. |
| R11 | `:focus-visible` ring vs browser default outline | Low | Chip declares `border: none`; outline is explicit. |
| R12 | New `border-left: 3 px` eats padding on narrow columns | Low | 130 px column worst-case still fits `18:30 – 19:30` at fontSize 12 with 11 px left padding. |

## 9. Open questions for paranoia

1. **Half-hour legibility.** Is dotted sub-tick + chip's own `HH:MM`
   label enough? Fallback: dashed sub-tick or start-minute superscript.
2. **Today day-number circle: `--accent` (green, brand) or
   `--danger` (red, Apple precedent)?** Held for paranoia.
3. **MobileFallback breakpoint 720 px — too generous?** Confirm via
   operator survey before tightening.
4. **Keyboard nav deferral — WCAG 2.1 Operable risk?** SlotBlock is a
   focusable `<button>` (Tab + Enter work). Missing: arrow-key cell
   nav + Enter-to-create on empty cells. Codex may flag as a11y BLOCKER.
5. **Current-time tick cadence 60 s.** 30 s feels "alive" but burns
   re-renders. 60 s is the Apple precedent.
6. **Feature-flag the visual change?** Plan says NO (revert is the
   rollback; operator-only blast radius). Codex may push back.
7. **Today + now-line render guard** — only when displayed week
   contains today (MSK). Spec in §3.3 / §3.6.
8. **Conflict chip's red stroke vs kind's accent stroke.** Cascade in
   §3.5 overrides cleanly (conflict class after kind class).
9. **Drag-paint ghost might be misread as "real slot".** Mitigation:
   3 px stroke + z-index 5; PaintConfirmModal still pops on mouseup.
10. **5.tidy removal of `CALENDAR_GRID_DAY_HEIGHT_PX`** — reversible;
    only 2 modules consume it.

## 10. Invariants

1. Hour grid is presentation-only. DB CHECK `(minute % 30) = 0` + MSK
   band stays.
2. `SLOT_GRID_MINUTES = 30` is the schema's source of truth.
3. Drag-state coords stay half-hour `0..35`. Any future "1-minute grid"
   needs reducer + DB CHECK migrated in lockstep.
4. `MobileFallback` stays the < 720 px container path.
5. Chip classes are the styling contract (SlotBlock writes classes;
   design-system owns rules). Inline `style` only for absolute-position
   math (`top` / `height`).
6. Today highlight + now-line render only when displayed week contains
   today (MSK). Never off-week.

## 11. Files touched (≈ 550 LoC over 7 sub-PRs — 5.A..5.F + 5.docs; each ≤ ~150)

`lib/calendar/dates.ts` (+20), `lib/calendar/view-model.ts` (+10/-2),
`lib/calendar/palette.ts` NEW (+60),
`lib/calendar/grid-hit-test.ts` NEW (+40 — extracted from Grid/SlotCalendar per 5.F),
`components/calendar/Grid.tsx` (+60/-30),
`components/calendar/SlotBlock.tsx` (+30/-50),
`components/calendar/CurrentTimeIndicator.tsx` NEW (+90),
`app/globals.css` (+120 under `.saas-chrome` selector, NOT `:root`),
`tests/calendar/dates.test.ts` (+15 — includes 22:00→23:30 geometry pin),
`tests/calendar/view-model.test.ts` (+15),
`tests/calendar/grid-hit-test.test.ts` NEW (+50 — round-1 BLOCKER#3),
`tests/calendar/palette.test.ts` NEW (+30 — pure-function class-name lookup),
`tests/calendar/current-time.test.ts` NEW (+60),
`ARCHITECTURE.md` (doc-sweep: calendar section +5),
`lib/calendar/README.md` (doc-sweep: +3 if needed),
`ENGINEERING_BACKLOG.md` (SAAS-1-FOLLOWUP-KEYBOARD + SAAS-INFRA-1 entries +6).

**REMOVED from the wave (round-1 BLOCKER#2):** the original `tests/calendar/slot-block-render.test.tsx` jsdom + RTL test. `vitest.config.ts` is `environment: 'node'` with no jsdom dep; component-render assertions deferred to `SAAS-INFRA-1` backlog item.

## 12. Out-of-scope

`/cabinet/book` redesign (SAAS-CABINET-1); arrow-key cell nav + Enter
(SAAS-1-FOLLOWUP-KEYBOARD); modal-shell redesign (SAAS-MODAL-1);
`SlotsManager` list-view palette refresh; animated drag commit; deeper
touch/pen polish; `Toolbar.tsx` refresh.

---

Paranoia note: feature-level plan, not infrastructure. `/admin/slots`
Calendar surface mapped to file:line; data layer untouched; test
surface green-able per §6. Sub-PR boundaries are independent and
revert-safe.
