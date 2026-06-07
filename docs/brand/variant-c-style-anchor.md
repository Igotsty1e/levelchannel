# Variant C — Interactive Demo Playground — style anchor v1.0

> **Scope.** Locks brand-DNA for `/saas/v2-c` preview route only. Consumed by Sub-1 (Codex image-gen prompt prefix), Sub-5 (variant build), and Sub-7 (winner polish if Variant C wins). Mirrors structure of `variant-a-style-anchor.md` + `variant-b-style-anchor.md` (owned by other Sub-1 agents); content tuned for **interactive product demo** identity.
>
> **Pairs with** `docs/brand/_pending/codex-prompts-variant-c.json` (intermediate manifest; orchestrator collates into `docs/brand/codex-image-prompts.md` after all 3 Sub-1 agents finish).
>
> **Authority.** Plan-doc `docs/plans/saas-landing-tier1-v2.md` §11.1, §11.2, §11.6 + §0z BLOCKER #8 closure. Design tokens via `docs/design-system.md` §3, §8.LANDING (lines 327-490).

---

## anchorVersion: vc-1.0

Bump rules: bump to `vc-1.1` on copy/mood tweak that doesn't change palette or composition rules; bump to `vc-2.0` on palette shift, composition philosophy change, or interactive-state schema change. Every committed asset under `public/assets/landing-v2/variant-c/illustrations/` MUST carry a manifest row with `anchorVersion` exactly matching this header — CI gate `scripts/check-asset-manifest.mjs` enforces. Stale assets (anchor bumped without re-gen) fail CI per plan §11.2.

---

## Brand DNA in 5 words

**hands-on, immediate, transparent, demo-grade, calm**

Decoded:
- **hands-on** — user touches the product before signing up; the page IS the demo, not a picture of one
- **immediate** — every click responds in ≤16ms; no loading shimmers, no skeletons, no "demo loading…" copy
- **transparent** — placeholder data is visibly placeholder (Маша/Петя/Катя names; balances like 12 500 ₽ not 1 000 000 ₽); demo state lives in localStorage and the page admits it on hover-tooltip
- **demo-grade** — UI labels look like real product UI labels (not marketing-pitch labels); typography of the dashboard mock mirrors live `/teacher/dashboard` patterns
- **calm** — minimal motion, no parallax theatrics, no magnetic cursor; one accent color only, used sparingly

Anti-DNA (what Variant C is **not**): cinematic, mysterious, editorial, story-driven, photographic, emotionally-charged. Those belong to Variants A and B respectively.

---

## Palette lock

**Variant C-specific surface lift** (rationale: slightly elevated bg vs brand `--bg #0B0B0D` creates an "approachable demo" feel — not as dark/dramatic as Variant A, not as inverted-light as Variant B). Variant C overrides apply ONLY under `[data-landing-variant="c"]` attribute on `.saas-chrome` root per plan §0z surface inventory.

### Surfaces (Variant C overrides — three-tier elevation for demo dashboard)

| Token | Hex | Use | Source |
|---|---|---|---|
| `--bg` (vc override) | `#0D0D10` | Page canvas; slightly lifted vs brand `#0B0B0D` | Variant C only |
| `--surface-1` (vc override) | `#16161A` | Section panels, footer | Variant C only |
| `--surface-2` (vc override) | `#1C1C22` | Demo dashboard card body (third elevation tier) | Variant C only |

Original brand `--bg #0B0B0D`, `--surface-1 #141416`, `--surface-2 #1C1C1F` continue to apply outside `.saas-chrome[data-landing-variant="c"]` — no leak into cabinet/admin/`/`/`/offer`.

### Accent (brand-locked — variant C reuses brand accent, NOT a new color)

| Token | Hex | Use |
|---|---|---|
| `--accent` | `#E8A890` | Single hot color. Interactive CTA fill, demo-card "active slot" pulse, focus rings |
| `--accent-hover` | `#C87878` | Hover state for `--accent` surfaces (darker per `docs/design-system.md` §3 accent ramp inverted for hover-darken) |

Rule: `--accent` appears at most **once per visible viewport** at any scroll position. Demo dashboard contains many UI affordances, but only the "Save your work — register" CTA + the currently-hovered slot light up with `--accent`. Every other affordance is `--text-secondary` outline + transparent fill.

### Text (brand-locked)

| Token | Hex | Use |
|---|---|---|
| `--text-primary` | `#F5F5F7` | Headlines, body, dashboard mock labels |
| `--text-secondary` | `#A1A1AA` | UI helper text, slot count labels, "placeholder data" disclosure on tooltip |

### Demo-data utility colors (NOT brand kit — local to `<DashboardMock />` only)

These colors appear ONLY inside the interactive dashboard mock to signal calendar slot state. They are NOT exported as tokens, NOT used outside `<DashboardMock />`, NOT pulled into the brand palette. Treat them like utility colors for a single feature.

| Hex | State | Contrast vs `#1C1C22` (card bg) |
|---|---|---|
| `#4A9D5E` | Booked slot (filled green) | 4.7:1 — AA for non-text UI |
| `#D4A24B` | Pending slot (filled amber) | 7.1:1 — AA for non-text UI |
| `#8B8B95` | Free slot (filled neutral gray) | 5.2:1 — AA for non-text UI |

Each color paired with an ICON + LABEL — never color-alone meaning, per `docs/design-system.md` §11 a11y rule.

### Forbidden colors for Variant C

- Pure black `#000` (clashes with warm-rose accent per §3 principle)
- Pure white `#FFF` (only `--text-on-accent` keeps `#FFFFFF` — inside accent fills only)
- Any blue / purple / teal (not in brand kit; would muddy the single-accent rule)
- Semantic colors (`--success` / `--warning` / `--danger` / `--info`) — these stay in cabinet/admin chrome. Variant C uses neutral UI labels even for "Booked / Pending / Free" — the green/amber/gray utility colors above are demo-data signals, not semantic banner colors

---

## Lighting rule (flat UI lighting)

**No dramatic key-lighting. No god-rays. No spotlights. No photographic depth.** Variant C illustrations and the dashboard mock surface use **flat UI lighting**:

- Single ambient soft fill from above (10° angle, soft, no harsh shadows)
- Cards have a 1px hairline border at `--separator-default` (`rgba(255,255,255,0.08)`) — no drop shadows on cards
- Maximum one shadow per viewport: a 2px `0 1px 2px rgba(0,0,0,0.4)` under the hovered dashboard card (subtle product-UI feedback, NOT marketing drama)
- Illustrations follow "product screenshot framing": elements rendered as if captured from a real dashboard at 1× zoom, no perspective tricks, no isometric drama

This is the polar opposite of Variant A's cinematic key-lighting. The asset should look like a product screenshot, not a magazine spread.

---

## Composition rules (UI-centered)

1. **The dashboard IS the hero.** The interactive `<DashboardMock />` component fills the hero viewport on desktop (1024-1920px width); occupies the lower 60vh on mobile (≤640px). No hero photograph competing for attention.
2. **Supporting illustrations are small.** Maximum 2 illustrations on the entire page; each ≤480px wide on desktop, ≤320px on mobile; positioned as accents next to UI sections, NOT as full-bleed backdrops.
3. **No photography.** Zero stock photos, zero generated human portraits, zero hands-on-laptop tropes.
4. **No 3D rendering.** Zero R3F. Zero isometric. Zero Three.js. Variant C is flat-UI-only.
5. **Hover-feedback is the visual punch**, not photography. The dashboard mock animates on every interaction — calendar slot fills on click, card lifts 2px on hover, balance number transitions on update. Owner's "wow" comes from feeling the product respond, not from looking at a picture.
6. **Generous whitespace.** Sections separate by 96-120px vertical gap (desktop); 64-80px (mobile). The page should feel **uncrowded**, like Linear's dashboard, not packed like a landing-page-template.
7. **Grid alignment.** Everything snaps to an 8px grid; dashboard mock cards align to the same grid as the supporting illustrations.

---

## Typography

Variant C uses `docs/design-system.md` §8.LANDING.6 hero type-scale but **at the smaller end of the clamp range**. Rationale: a product-demo headline feels wrong at 96px — it would compete with the dashboard mock for attention. Variant A and B want the 96px upper end; Variant C wants the 64-72px sweet spot.

### Hero type (Variant C tune)

```css
.saas-chrome[data-landing-variant="c"] {
  /* Override §8.LANDING.6 hero-h1 upper bound — keep clamp() but cap lower */
  --hero-h1-desktop: clamp(48px, 5vw, 72px);  /* vs default clamp(64px, 7vw, 96px) */
  --hero-h1-tablet:  clamp(40px, 5vw, 56px);  /* vs default clamp(48px, 6vw, 64px) */
  --hero-h1-mobile:  clamp(32px, 8vw, 40px);  /* vs default clamp(36px, 9vw, 48px) */
  --hero-h1-leading: 1.05;                    /* slightly looser than default 0.95 — product-UI feel, not headline-drama */
  --hero-h1-track:   -0.02em;                 /* less tight than default -0.04em */
  --hero-subtitle:   clamp(16px, 1.4vw, 18px); /* smaller than default — UI-label feel */
  --hero-subtitle-leading: 1.55;
}
```

These overrides apply ONLY under `[data-landing-variant="c"]` per plan §0z. They do NOT mutate the base §8.LANDING.6 tokens (Variants A and B keep the default cinematic range).

### Font stacks

- **Headings + body** — same brand sans (`Inter Tight` or current brand sans per `docs/design-system.md` §4)
- **UI labels inside `<DashboardMock />`** — monospace-friendly stack for numerical / tabular content:
  ```css
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", Menlo, monospace;
  font-feature-settings: "tnum" 1; /* tabular numbers */
  ```
  Applied to: balance amounts, slot times (`14:00 — 15:00`), learner counts, calendar week-numbers.
- **Body copy** — brand sans, 16px / 1.55 leading. NEVER serif. (Serif belongs to Variant B.)

---

## Motion DNA

**Calm, instant, product-grade.** No theatrical reveals, no parallax, no magnetic cursor on the body. Motion serves interaction feedback, not narrative drama.

### Allowed motion

| Trigger | Effect | Duration | Easing |
|---|---|---|---|
| Hover a dashboard card | 2px lift; border tint to `--separator-strong` | `--landing-duration-fast` (180ms) | `--ease-out-back` |
| Click a calendar slot (free → pending) | Slot fills `#D4A24B` with 1px halo pulse | 220ms total (160ms fill + 60ms halo decay) | `--ease-spring-soft` |
| Hover the CTA "Save your work — register" | Background fades `--accent` → `--accent-hover` | `--landing-duration-fast` (180ms) | `--ease-out-expo` |
| Section reveal on scroll | `[data-scroll-trigger]` per §8.LANDING.3 — opacity 0→1, translateY 48px→0 | `--landing-duration-slow` (420ms) | `--ease-out-expo` |
| Balance number changes | `tabular-nums` slide-in (no rotation, no flip) | 200ms | `--ease-out-expo` |

### Forbidden motion (Variant C must NOT have)

- Magnetic cursor on CTAs or logo (`data-magnetic` per §8.LANDING.4) — too dramatic for Variant C
- 3D card tilt (`data-tilt` per §8.LANDING.5) — competes with real dashboard UI
- Parallax layers (`data-parallax` per §8.LANDING.7) — would distract from product demo
- Theatrical 720ms reveals — feels heavy for product-grade demo
- Any motion that does NOT correspond to a user action (idle drift, ambient float, etc.)

### LocalStorage state sync timing

Every interaction with `<DashboardMock />` MUST sync state to `window.localStorage` AND reflect visually within **one animation frame (16ms)** of the click event. If the localStorage write is slow (rare), the visual update happens first and the write follows in a `requestIdleCallback`. Owner should never feel a lag between click and feedback.

### Reduced-motion fallback (MANDATORY per §8.LANDING.8)

```css
@media (prefers-reduced-motion: reduce) {
  .saas-chrome[data-landing-variant="c"] [data-scroll-trigger],
  .saas-chrome[data-landing-variant="c"] [data-scroll-trigger] > *,
  .saas-chrome[data-landing-variant="c"] .dashboard-mock-card,
  .saas-chrome[data-landing-variant="c"] .dashboard-mock-slot {
    transition: none !important;
    transform: none !important;
    animation: none !important;
    opacity: 1 !important;
  }
}
```

All JS interaction handlers also gate on `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and short-circuit attach if true — no idle listeners for opted-out users. State changes still fire (click → slot fills) but without animated transition.

---

## GPT-Image-1 system-prompt prefix (verbatim — append to every Variant C image prompt)

> The orchestrator concatenates this prefix into the unified `docs/brand/codex-image-prompts.md`. Every Variant C asset generated via Codex CLI MUST start with EXACTLY this prefix (no rewording). Drift = brand-coherence incident per plan §11.2.

```
[VARIANT C — INTERACTIVE DEMO PLAYGROUND — anchorVersion vc-1.0]

Style: flat-UI illustration, product-screenshot framing, mid-dark calm aesthetic. Reference mood: Mercury (banking dashboard), Notion (workspace), Raycast (command palette) — modern SaaS product UI illustrated.

Lighting: flat UI lighting. Single soft ambient fill from above, no key-lighting, no god-rays, no spotlights, no dramatic shadows. Maximum subtle 2px drop shadow under one focal element if needed for separation.

Palette (strict — no other colors allowed):
- Background: #0D0D10 (slightly lifted dark gray)
- Surface panels: #16161A
- Card surfaces: #1C1C22
- Accent (use sparingly, max one element per illustration): #E8A890 (warm rose)
- Text primary: #F5F5F7
- Text secondary: #A1A1AA
- Demo-data utility colors (only if illustration shows calendar slots): booked #4A9D5E, pending #D4A24B, free #8B8B95

Composition: UI-centered. Generous whitespace. 8px grid alignment. Hairline borders at rgba(255,255,255,0.08) instead of drop shadows. No photography. No 3D rendering. No isometric perspective. No human figures. No hands. No realistic devices.

Mood: hands-on, immediate, transparent, demo-grade, calm. Looks like a product screenshot, not a marketing illustration.

Forbidden: cinematic key-lighting, photography, 3D, isometric, magazine-editorial typography, dramatic shadows, blue/purple/teal accent colors, full-bleed photographic backdrops.

Aspect ratio: see per-asset prompt body.
```

---

## Asset slot list

Variant C is **deliberately lean on Codex-gen assets**. The bulk of visual interest comes from the hand-coded `<DashboardMock />` React component — that's the brand identity, not the illustrations. Codex generates only 2 supporting still illustrations. The dashboard mock + sample data are Sub-5 deliverables (hand-coded, not AI-generated).

### Codex-gen illustrations (2 total)

| Slot | Aspect | Output path | Purpose |
|---|---|---|---|
| `slot_c_hero_dashboard_overview` | 16:10 (1920×1200 desktop master) | `public/assets/landing-v2/variant-c/illustrations/raw/slot_c_hero_dashboard_overview.{avif,webp}` | Still illustration of the dashboard at a static moment — used as the loading placeholder (`<noscript>` fallback) and as the OG/Twitter card image. The live page replaces this with the interactive `<DashboardMock />` on hydration. |
| `slot_c_secondary_callout_workspace` | 4:3 (960×720 desktop master) | `public/assets/landing-v2/variant-c/illustrations/raw/slot_c_secondary_callout_workspace.{avif,webp}` | Small supporting illustration alongside the "your workspace" section — shows a stylized workspace tray with placeholder cards (e.g. learner list snippet, balances card snippet) to reinforce "everything is here". Used as a decorative side-illustration, NOT as the main visual. |

Per-slot prompt bodies live in `docs/brand/_pending/codex-prompts-variant-c.json` (intermediate manifest) and get collated by the orchestrator into the unified `docs/brand/codex-image-prompts.md`.

### Hand-coded deliverables (NOT Codex-generated — Sub-5 owns)

These are NOT image assets. They are React components and JSON files authored directly by Claude in Sub-5. Listed here for reference so the orchestrator does not mistakenly add them to the Codex prompt manifest.

#### `<DashboardMock />` React component spec

**Location.** `components/saas/landing-v2/variant-c/dashboard-mock/dashboard-mock.tsx` (composition root) + subcomponents under `dashboard-mock/`.

**3 mock cards inside `<DashboardMock />`**:

1. **Calendar mini card** (`<DashboardMockCalendarCard />`)
   - Shows a 7-day week strip with 5 × 7 = 35 slot tiles
   - Each tile renders with one of three states: `booked` (#4A9D5E), `pending` (#D4A24B), `free` (#8B8B95)
   - Click a `free` slot → transitions to `pending` (calls `updateSlotState(slotId, 'pending')` → `localStorage.setItem`)
   - Click a `pending` slot → transitions to `booked`
   - Click a `booked` slot → transitions back to `free`
   - Hover any slot → tooltip shows the placeholder time range (e.g. `Понедельник 14:00 — 15:00`) and placeholder learner name
   - Reduced-motion: state changes are instant (no transition); tooltip appears on focus-visible too

2. **Learner roster card** (`<DashboardMockLearnerCard />`)
   - Shows 6 placeholder learner rows: Маша, Петя, Катя, Лёша, Дима, Аня (locked names — see PII rule below)
   - Each row: avatar circle (no photo — first-letter monogram in `--surface-3 #26262A` bg), name, "следующее занятие" timestamp, balance amount
   - Click a row → opens a small inline "детали ученика" expand showing placeholder lesson history (5 items, all placeholder data)
   - Hover row → row bg lifts to `--surface-2`

3. **Balances card** (`<DashboardMockBalanceCard />`)
   - Shows aggregate balance: "На счетах учеников: **47 500 ₽**" (placeholder)
   - 3 mini-rows: "Оплачено в этом месяце: 12 500 ₽", "Возвраты: 0 ₽", "К выводу: 8 000 ₽"
   - Click "К выводу" row → triggers a placeholder "вывод средств" interaction that shows a toast "Демо-режим. Зарегистрируйся, чтобы вывести по-настоящему." with the CTA button. NO actual API call. Toast dismissible.

#### Sample-data JSON files (2 — Sub-5 hand-authored)

| File | Contents |
|---|---|
| `components/saas/landing-v2/variant-c/dashboard-mock/data/mock-data-classroom.json` | 6 placeholder learners + 35 default slot states (mix of booked/pending/free seeded for visual richness). All names from the locked list (Маша/Петя/Катя/Лёша/Дима/Аня). No phone numbers, no emails, no real-looking timestamps. |
| `components/saas/landing-v2/variant-c/dashboard-mock/data/mock-data-balances.json` | Placeholder balance ledger: aggregate + 12-month history (12 rows). All amounts round numbers in 1 000-10 000 ₽ range — visibly placeholder, not real-looking. |

These JSON files load via static `import` (NO fetch, NO API call, NO server roundtrip). Bundle cost: <3KB gzipped each.

---

## Interactive UX rules (BLOCKER #8 closure spec)

Per plan-doc §0z BLOCKER #8 closure + §11.6 one-line story («Кабинет — здесь. Сразу. Без email. Зарегистрируйся, когда захочешь повторить.») — note the explicit word **«повторить»**, NOT «сохранишь». The product story is "try it now, register if you want to do it again" — NOT "try it now and we'll save your work after register".

### LocalStorage state contract

**Single key.** `saas-v2c-demo-state`

**Schema.**

```ts
type SlotState = {
  slotId: string;        // e.g. "mon-1400"
  state: 'booked' | 'pending' | 'free';
  learnerId?: string;    // optional reference to MockLearner (if booked or pending)
};

type MockLearner = {
  learnerId: string;     // e.g. "learner-masha"
  displayName: string;   // one of: Маша | Петя | Катя | Лёша | Дима | Аня (LOCKED list)
  balanceRub: number;    // placeholder integer 0..10000
};

type DemoState = {
  calendarSlots: SlotState[];
  learners: MockLearner[];
  lastInteractedAt: string; // ISO8601 timestamp
};
```

**Read path.** On `<DashboardMock />` mount, `useEffect` reads `localStorage.getItem('saas-v2c-demo-state')`. If null → seed from `mock-data-classroom.json`. If present → JSON.parse + validate shape (Zod or hand-rolled type-guard — Sub-5 picks). On parse failure → log to console (dev-only) + seed from default mock-data.

**Write path.** Every state change calls `updateDemoState(partial)` which merges into current state + writes back to localStorage synchronously + updates React state. `lastInteractedAt` updates on every write.

**Quota handling.** If `localStorage.setItem` throws `QuotaExceededError` → catch + show non-blocking toast "Демо-память переполнена. Очистить?" with a "Очистить" CTA that calls `localStorage.removeItem('saas-v2c-demo-state')` and reseeds.

### Server-side knowledge: ZERO

- NO API endpoint receives demo state
- NO request to `/api/landing/event` includes demo state in its body (the analytics beacon per Sub-2.5 only records funnel events like `landing_view` / `cta_click`, NOT the slot states)
- NO cookie carries demo state
- NO query-string handoff carries demo state to `/register`
- NO server-side rendering of demo state — the hero illustration `slot_c_hero_dashboard_overview` shows a STATIC seeded view, and the live `<DashboardMock />` hydrates client-side from localStorage

### "Save your work — register" CTA

**Label (anchor — final copy refined in Sub-7).** «Попробовать у себя — войти / зарегистрироваться» (Variant C tagline hypothesis per §11.6 is «Попробуй прямо сейчас. Регистрация — потом.» — the CTA reinforces "потом").

**Href.** `/register?role=teacher&utm_source=landing&utm_medium=v2-c&utm_content=demo`
- `utm_source=landing` — funnel attribution to landing-page surface
- `utm_medium=v2-c` — preview variant identifier
- `utm_content=demo` — distinguishes "from interactive demo" CTAs vs hypothetical future static-page CTAs

**Behavior on click.**
1. Analytics beacon fires `cta_click` with `{ variant: 'c', cta_id: 'demo_register' }` (Sub-2.5 ingest)
2. `lastInteractedAt` updates in localStorage (so we know the user reached register from demo)
3. Browser navigates to `/register?role=teacher&utm_source=landing&utm_medium=v2-c&utm_content=demo`
4. NO state handoff. NO localStorage data flows to the register form. NO post-register hydration of `/cabinet` with demo data.

### Demo-state cleanup on first `/cabinet` load post-register

To prevent demo data polluting a real account, the cabinet layout checks for `saas-v2c-demo-state` in localStorage at mount and clears it.

**Location.** `app/cabinet/layout.tsx` adds a one-time `useEffect` hook on first mount:

```tsx
useEffect(() => {
  // Clear stale Variant C demo state — prevents demo pollution of real account.
  // No-op if key absent. Idempotent — safe to run on every mount.
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('saas-v2c-demo-state');
  }
}, []);
```

This is the ONLY edit Sub-5 makes outside `/saas/v2-c/` + `components/saas/landing-v2/variant-c/` + the dashboard-mock subtree. Plan-doc §0z surface inventory should add `app/cabinet/layout.tsx` as `EXTEND` for Sub-5 specifically. (If parent orchestrator's surface-inventory disposition disagrees, the Sub-5 agent escalates rather than making the edit.)

### PII rule (HARD)

- NO real phone numbers in mock-data — placeholder format `+7 (___) ___-__-__` if shown at all (prefer NOT showing)
- NO real-looking email addresses — placeholders use obvious dummies like `masha@demo.local` if shown at all (prefer NOT showing)
- NO real-looking balances — all amounts round numbers in 1 000-10 000 ₽ range, never anything that looks like a real bank-statement figure
- Locked placeholder name list: **Маша, Петя, Катя, Лёша, Дима, Аня**. No other names. No surnames. No patronymics. No real-looking Russian names that could be mistaken for a specific person.

### Anti-spoof / Anti-abuse considerations

- localStorage is per-origin per-browser; multi-user shared devices CAN see each other's demo state (acceptable — demo data has no PII)
- Demo state is NOT a security boundary — there's nothing valuable in it. A user who edits localStorage manually can change slot states; no harm done; on next mount we validate the shape and seed fresh on parse failure.

---

## Anti-drift checklist

Before any commit under `public/assets/landing-v2/variant-c/illustrations/` OR under `components/saas/landing-v2/variant-c/`, the committer (human or sub-agent) verifies:

- [ ] **Palette.** No color outside the locked Variant C palette + brand accent + 3 demo-data utility colors. No pure black `#000`. No blue/purple/teal anywhere. (Spot-check via Chrome DevTools MCP color-picker on rendered output.)
- [ ] **Lighting.** No dramatic key-light. No spotlights. No god-rays. Max one 2px drop shadow per viewport.
- [ ] **3D.** Zero R3F. Zero isometric. Zero photographic depth.
- [ ] **Photography.** Zero stock photos. Zero generated humans. Zero hands.
- [ ] **Typography.** Hero h1 within the Variant C clamp range (max 72px desktop). UI labels use monospace stack. No serif.
- [ ] **Motion.** No magnetic cursor. No 3D tilt. No parallax. Reveal-on-scroll uses default `[data-scroll-trigger]` only. Every interaction has ≤16ms perceived latency.
- [ ] **localStorage.** Single key `saas-v2c-demo-state`. Schema matches above. No PII. No server roundtrip. Cabinet cleanup hook present.
- [ ] **Anchor version.** Manifest entry in `public/assets/landing-v2/variant-c/manifest.json` carries `anchorVersion: "vc-1.0"` matching this header.
- [ ] **System prompt prefix.** Every Codex prompt entry under `_pending/codex-prompts-variant-c.json` starts with the verbatim prefix above (no rewording).
- [ ] **Scope.** No edits outside `app/saas/v2-c/`, `components/saas/landing-v2/variant-c/`, `public/assets/landing-v2/variant-c/`, `app/cabinet/layout.tsx` cleanup hook, and the documented `lib/landing/legal-profile-loader.ts` consumer wiring.

Drift caught at PR review → block + cite this checklist row + fix before merge.
