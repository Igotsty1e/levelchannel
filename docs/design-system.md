# Design System

**Status:** v1.0 — foundation draft (2026-05-18).
**Scope:** spec-only. No code lives here; this is the contract that
`app/globals.css` tokens and `lib/ui/primitives/*` will implement.
**Owners:** Frontend / Design (rolling out under the SAAS-6 epic).

> Section headings in English by repo convention. UI copy examples in
> Russian — that is the product language.

---

## 1. Goals + non-goals

**This document decides:**

- One token set (color, type, spacing, radius, shadow, motion) used by
  every SaaS surface — login/register, learner cabinet, teacher
  cabinet, admin console.
- The visual language: dark-first, Apple-HIG-inspired (Calendar /
  macOS Settings / iOS 17 Settings), warm-gray neutrals, one accent.
- The primitive component contract: which primitives exist; for each,
  what variants, states, ARIA, keyboard.
- The migration baseline: which existing CSS vars survive, get
  renamed, or get deprecated.
- The roll-out order: tokens → primitives → per-wave surface ports.

**Explicitly left to feature plans:**

- Per-page layout (e.g. `docs/plans/calendar-apple-redesign.md` owns
  the Apple-Calendar week grid; this doc only gives it tokens).
- Information architecture and copy revisions.
- Light-mode palette. v1.0 is dark-only.
- Marketing/landing surfaces beyond the SaaS shell.
- Iconography library choice (default assumption `lucide-react`,
  locked in the first primitive PR).

**Out of scope, period:** replacing inline `style={{}}` in one PR, and
a Tailwind config rewrite. Tokens land as CSS custom properties;
Tailwind can adopt them later.

---

## 2. Migration baseline (current `app/globals.css`)

The current site ships dark, but the tokens are minimal and the
component CSS classes (`.btn-primary`, `.btn-secondary`, `.card`,
`.section-label`, `.tag`, `.stat-number`) were authored as marketing
helpers. They stay on landing/marketing surfaces but are NOT the basis
for SaaS primitives.

### Current root variables

| Var | Value | Verdict |
|---|---|---|
| `--bg` | `#0B0B0C` | **Keep** as canvas. Hex slightly warms in v1 (see §3). |
| `--surface` | `#111113` | **Keep**, becomes `--surface-1`. New `--surface-2`/`-3` added. |
| `--border` | `rgba(255,255,255,0.08)` | **Keep** as `--separator-default`. Two more weights added. |
| `--text` | `#ffffff` | **Keep**, renamed `--text-primary`, lowered to `#F5F5F7` (Apple system-label tone). |
| `--secondary` | `#A1A1AA` | **Keep** as `--text-secondary`. Two fainter ranks added. |
| `--accent-start` / `--accent-end` / `--accent-gradient` | `#C87878 → #E8A890` | **Soft-deprecate.** Marketing keeps it. SaaS uses solid `--accent` from the middle of the gradient (§3). |

### Current utility classes — disposition

- `.btn-primary`, `.btn-secondary`, `.card` — **marketing-only.** SaaS
  uses primitives (§9). Classes stay for landing.
- `.section-label`, `.tag`, `.stat-number`, `.glow`, `.gradient-text`,
  `.gradient-border`, `.fade-in`, `.delay-*`, `.divider` —
  **marketing-only, untouched.**
- `.auth-shell-main`, `.legal-page-card`, `.final-cta-card`,
  `.payment-form-checkbox` — targeted mobile overrides; **untouched**
  until their surface migrates.
- `.not-found-page` / `.global-error-*` — CSP edge cases, **untouched.**
- `.min-svh`, `.no-h-overflow` — **kept** as useful primitives.
- `body::before` noise overlay — **removed on SaaS routes** via an
  opt-out class on `<html>`. Kept on marketing.

### Tokens added in v1.0 (namespaced, additive)

```
/* Surfaces */
--bg, --surface-1, --surface-2, --surface-3, --overlay-scrim,
--separator-default, --separator-strong, --separator-faint,

/* Text */
--text-primary, --text-secondary, --text-tertiary, --text-quaternary,
--text-on-accent,

/* Accent + semantic */
--accent, --accent-hover, --accent-pressed, --accent-bg, --accent-bg-strong,
--success, --success-bg, --warning, --warning-bg,
--danger, --danger-bg, --info, --info-bg,

/* Type */
--font-sans, --font-mono,
--text-12, --text-13, --text-15, --text-17, --text-22, --text-28, --text-34,
--font-weight-regular, --font-weight-medium, --font-weight-bold,

/* Spacing */
--space-0..--space-9,

/* Radii */
--radius-1, --radius-2, --radius-3, --radius-4, --radius-5, --radius-full,

/* Shadows */
--shadow-1, --shadow-2, --shadow-3, --shadow-modal,

/* Motion */
--duration-fast, --duration-base, --duration-slow,
--ease-out, --ease-in, --ease-in-out, --ease-linear,

/* Focus ring */
--focus-ring-color, --focus-ring-width, --focus-ring-offset,
```

---

## 3. Color palette

**Principles.** Dark-first; warm grays (no pure black — reads cheap on
OLED, clashes with the warm-rose accent); one accent; semantic colors
only in their own contexts; AA contrast everywhere body text appears.

### Surfaces

| Token | Hex | Use | Contrast vs `--text-primary` |
|---|---|---|---|
| `--bg` | `#0B0B0D` | Canvas. Body background. | 17.2:1 |
| `--surface-1` | `#141416` | Default raised: cards, list rows, modal body. | 15.6:1 |
| `--surface-2` | `#1C1C1F` | Higher: dropdowns, popovers, card hover. | 13.8:1 |
| `--surface-3` | `#26262A` | Highest: segmented-thumb, prominent inline panels. | 11.1:1 |
| `--overlay-scrim` | `rgba(0,0,0,0.55)` | Modal backdrop (+ 12px `backdrop-filter: blur`). | n/a |

Surfaces are opaque hex, not `rgba` over `--bg` — keeps readability
under a scrim and stable in screenshots. `.card:hover` now lands on
`--surface-2` with a border tint instead of the current `translateY(-4px)`
lift (translateY belongs to marketing).

### Separators

| Token | Value | Use |
|---|---|---|
| `--separator-faint` | `rgba(255,255,255,0.04)` | Inside a row group; high-density lists. |
| `--separator-default` | `rgba(255,255,255,0.08)` | Card border, section divider. (Replaces `--border`.) |
| `--separator-strong` | `rgba(255,255,255,0.14)` | Sticky-toolbar underline, page-shell header rule. |

All borders are 1px hairlines (true single pixel on retina).

### Text

| Token | Hex | Use | Contrast vs `--bg` |
|---|---|---|---|
| `--text-primary` | `#F5F5F7` | Body, headings, controls. | 15.8:1 |
| `--text-secondary` | `#A1A1AA` | Meta, captions, helper text, sidebar idle. | 7.4:1 |
| `--text-tertiary` | `#6E6E76` | Disabled labels, faint timestamps. | 4.5:1 (AA min) |
| `--text-quaternary` | `#48484C` | Placeholder, "or" dividers. | 3.2:1 (large-text only) |
| `--text-on-accent` | `#FFFFFF` | Text on `--accent` fills. | 4.6:1 vs `--accent` |

`--text-quaternary` does NOT meet AA against `--bg` and is reserved
for non-essential decoration. Never for actionable content.

### Accent

The current gradient `#C87878 → #E8A890` is warm-rose. SaaS chrome
locks a solid hex from the upper middle:

| Token | Hex | Use |
|---|---|---|
| `--accent` | `#D88A82` | Primary button fill, focus ring, active nav, switch on-state. |
| `--accent-hover` | `#E29B92` | Hover for `--accent` surfaces. |
| `--accent-pressed` | `#C47B72` | Pressed state. |
| `--accent-bg` | `rgba(216,138,130,0.10)` | Tinted bg: active sidebar row, segmented selected, info-box. |
| `--accent-bg-strong` | `rgba(216,138,130,0.18)` | Hover for `--accent-bg`. |

`--accent-gradient` is preserved unchanged for marketing.

### Semantic colors (dark-mode tuned)

| Role | `--{role}` | `--{role}-bg` | Use |
|---|---|---|---|
| Success | `#4ADE80` | `rgba(74,222,128,0.10)` | "Оплачено", "Сохранено", positive banners. |
| Warning | `#F5C26B` | `rgba(245,194,107,0.10)` | "Скоро истекает". |
| Danger | `#FF6E6E` | `rgba(255,110,110,0.12)` | Errors, destructive confirms, "Просрочено". |
| Info | `#7AB8FF` | `rgba(122,184,255,0.10)` | Neutral banners, "Возвращено". |

Contrast vs `--bg`: success 11.6:1, warning 12.9:1, danger 6.4:1, info
9.5:1 — all AA+. Banner body text uses `--text-primary` on the tinted
bg; the chromatic foreground is for icons and accent strokes only.

---

## 4. Typography scale

**Font stack:**

```
--font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text',
             'SF Pro Display', 'Inter', system-ui, 'Segoe UI', Roboto,
             'Helvetica Neue', Arial, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
             'Liberation Mono', monospace;
```

macOS/iOS get SF Pro natively. The rest fall through to Inter (already
bundled via `next/font`) or system-ui. This is the single largest
visual win toward the Apple feel.

**Scale (7-step):**

| Token | Size | Line height | Letter spacing | Weights | Use |
|---|---|---|---|---|---|
| `--text-12` | 12px | 16px (1.33) | +0.02em | 400/500/700 | Captions, all-caps micro-labels, badge text. |
| `--text-13` | 13px | 18px (1.38) | +0.01em | 400/500 | Meta rows, helper text, table secondary. |
| `--text-15` | 15px | 22px (1.47) | 0 | 400/500/700 | **Body default.** Form controls, list rows, copy. |
| `--text-17` | 17px | 24px (1.41) | -0.005em | 500/700 | Section headings (`<h3>`), card titles. |
| `--text-22` | 22px | 28px (1.27) | -0.012em | 600/700 | Page subtitles (`<h2>`), modal title. |
| `--text-28` | 28px | 34px (1.21) | -0.018em | 700 | Page heading (`<h1>`) — matches current cabinet/login. |
| `--text-34` | 34px | 40px (1.18) | -0.022em | 700 | Hero h1 / empty-state hero only. |

Three weight tokens: `--font-weight-regular: 400`, `-medium: 500`,
`-bold: 700`. Sizes 22+ internally use 600/700; 800 is marketing-only.

Negative tracking on display sizes counteracts SF Pro Display
crowding; Inter fallback handles it gracefully.

**Reserved patterns:**

- Numerals tabular by default in tables (`font-variant-numeric:
  tabular-nums`, utility class `--numeric-tabular`).
- All-caps micro-labels are an `Eyebrow` primitive — 12px / 700 /
  +0.08em / `--text-secondary` / `text-transform: uppercase`.

---

## 5. Spacing scale

4-pt half-step grid. Component padding/margin always reaches a token;
one-off literals only inside primitives, never inside features.

| Token | Value | Use |
|---|---|---|
| `--space-0` | 0 | Reset. |
| `--space-1` | 4px | Icon-to-text gap, badge inner pad-x. |
| `--space-2` | 8px | Small control pad-y, intra-row gap. |
| `--space-3` | 12px | Input pad-y, button-md pad-y, list row. |
| `--space-4` | 16px | Input pad-x, default field margin-bottom, small card pad. |
| `--space-5` | 24px | Default card pad, gap between form sections. |
| `--space-6` | 32px | Page section spacing inside `<main>`. |
| `--space-7` | 48px | Hero block breathing room. |
| `--space-8` | 64px | Page-shell top pad on desktop. |
| `--space-9` | 96px | Decorative-only; long-form landing rhythm. |

**Mobile collapse** (`≤480px`): `--space-7+` collapse one step
(`48→32`, `64→48`, `96→64`) via a single media query overriding the
tokens. No JS, no per-component branching.

---

## 6. Radii

| Token | Value | Use |
|---|---|---|
| `--radius-1` | 4px | Inline tag, input focus-ring corner clip. |
| `--radius-2` | 8px | Button, input/textarea/select, segmented thumb. |
| `--radius-3` | 12px | Dropdown menu, popover, tooltip, banner. |
| `--radius-4` | 16px | Card, dialog body, sidebar panel. |
| `--radius-5` | 24px | Hero card, empty-state illustration container. |
| `--radius-full` | 9999px | Pill button, avatar, badge, switch track, segmented outer. |

Modal corner masking: `overflow: hidden` + `--radius-4` so internal
toolbars don't bleed past the corner.

---

## 7. Shadows

Apple shadows are subtle and layered: one tight contact shadow + one
diffuse ambient. On a dark canvas we tune them darker than the canvas,
not lighter — no "glow".

| Token | Value | Use |
|---|---|---|
| `--shadow-1` | `0 1px 2px rgba(0,0,0,0.30)` | Default raised card on same-color surface (rare). |
| `--shadow-2` | `0 2px 4px rgba(0,0,0,0.30), 0 8px 16px rgba(0,0,0,0.24)` | Dropdown, popover, tooltip on open. |
| `--shadow-3` | `0 4px 8px rgba(0,0,0,0.32), 0 16px 32px rgba(0,0,0,0.28)` | Dialog / modal. |
| `--shadow-modal` | `0 8px 16px rgba(0,0,0,0.36), 0 32px 64px rgba(0,0,0,0.40)` | Full-screen modal (with `backdrop-filter: blur(12px)`). |

Most cards on `--bg` skip shadow entirely and rely on the 1px border.
The existing `.btn-primary` rose-glow stays on marketing only.

---

## 8. Motion

```
--duration-fast: 150ms;   /* hover tint, focus ring */
--duration-base: 250ms;   /* default enter/exit, dropdown open */
--duration-slow: 400ms;   /* modal enter, page transitions */

--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);   /* enter */
--ease-in:     cubic-bezier(0.7, 0, 0.84, 0);   /* exit */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);  /* cross-fade, thumb slide */
--ease-linear: linear;                          /* progress, spinners */
```

`--ease-out` approximates Apple's `UISpringTimingParameters` default.
We avoid CSS spring keyframes — Safari-only.

**Patterns:**

- Hover: `color`/`background` transitions at `--duration-fast`,
  `--ease-out`. Never `transform: translateY()` (marketing).
- Dropdown / popover enter: opacity 0→1 + `translateY(-4px → 0)`,
  `--duration-base`, `--ease-out`. Exit reverses, `--ease-in`.
- Modal enter: scrim opacity 0→1 + dialog opacity 0→1 + `scale(0.96 → 1)`,
  `--duration-slow`, `--ease-out`.
- Segmented thumb: `translateX`, `--duration-base`, `--ease-in-out`.
- Toast: `translateY(8px → 0)` + opacity, `--duration-base`.

**Reduced motion:** `@media (prefers-reduced-motion: reduce)` collapses
transitions to none on primitive root classes. Scale/translate on
modal enter degrades to a plain opacity fade. The segmented thumb still
translates at fast duration (a static thumb loses the affordance).

---

## 8.LANDING. Tier-1 SaaS landing motion library

**Scope:** `.saas-chrome` class (per SAAS-1-5A precedent — tokens MUST NOT bleed into cabinet/admin/`/`/`/offer`). Activates on `/saas` and child routes only. Adds to §8 tokens; doesn't replace them.

**Brief constraint:** owner asked for "МАКСИМАЛЬНО ЩЕДРО" — scroll-driven, magnetic cursor, parallax, micro-interactions (Bruno Simon / Lando Norris benchmark). Lighthouse Performance ≥90 hard floor. `prefers-reduced-motion` MUST collapse every theatrical effect to a static fallback.

### 8.LANDING.1 Theatrical durations

```css
.saas-chrome {
  --landing-duration-fast: 180ms;        /* micro-interaction settle */
  --landing-duration-base: 240ms;        /* card hover lift, FAQ open */
  --landing-duration-slow: 420ms;        /* section reveal, hero text in */
  --landing-duration-theatrical: 720ms;  /* WebGL hero entrance, parallax depth */
  --landing-stagger-step: 60ms;          /* between siblings in a row/grid */
}
```

`theatrical` is reserved for hero entrance + once-per-page reveals; never for hover.

### 8.LANDING.2 Generous easings

```css
.saas-chrome {
  /* Hero reveals, headline appear */
  --ease-out-expo:  cubic-bezier(0.16, 1, 0.3, 1);
  /* Card hover lift, button press release — slight overshoot */
  --ease-out-back:  cubic-bezier(0.34, 1.56, 0.64, 1);
  /* Spring-feel for magnetic cursor settle */
  --ease-spring-soft: cubic-bezier(0.5, 1.5, 0.5, 1);
  /* Asymmetric exit — slow start, fast end */
  --ease-in-quart:  cubic-bezier(0.5, 0, 0.75, 0);
}
```

### 8.LANDING.3 Scroll-trigger primitives

A section becomes visible when its top crosses 75% of viewport height. Triggers a stagger reveal of its children.

```css
.saas-chrome [data-scroll-trigger] {
  opacity: 0;
  transform: translateY(48px);
  transition:
    opacity var(--landing-duration-slow) var(--ease-out-expo),
    transform var(--landing-duration-slow) var(--ease-out-expo);
}
.saas-chrome [data-scroll-trigger].is-visible {
  opacity: 1;
  transform: translateY(0);
}
.saas-chrome [data-scroll-trigger] > *:nth-child(1) { transition-delay: 0ms; }
.saas-chrome [data-scroll-trigger] > *:nth-child(2) { transition-delay: var(--landing-stagger-step); }
.saas-chrome [data-scroll-trigger] > *:nth-child(3) { transition-delay: calc(var(--landing-stagger-step) * 2); }
.saas-chrome [data-scroll-trigger] > *:nth-child(4) { transition-delay: calc(var(--landing-stagger-step) * 3); }
.saas-chrome [data-scroll-trigger] > *:nth-child(5) { transition-delay: calc(var(--landing-stagger-step) * 4); }
.saas-chrome [data-scroll-trigger] > *:nth-child(6) { transition-delay: calc(var(--landing-stagger-step) * 5); }
```

JS implementation: a single `IntersectionObserver` shared across all triggers, threshold = 0.25. Add `is-visible` once; never remove (re-triggering on scroll back up is "cheap-feeling").

### 8.LANDING.4 Magnetic cursor primitives

For CTA buttons and the logo mark. Cursor enters within a radius → element translates a fraction of the cursor delta. Releases on leave with spring settle.

```css
.saas-chrome [data-magnetic] {
  --magnetic-radius: 96px;        /* activation zone around element */
  --magnetic-max-disp: 12px;      /* max element offset */
  --magnetic-snap-ms: 320ms;      /* settle duration on cursor leave */
  transition: transform var(--magnetic-snap-ms) var(--ease-spring-soft);
  will-change: transform;
}
/* Active follow drives transform via JS inline style — no transition then. */
.saas-chrome [data-magnetic].is-following {
  transition: none;
}
```

JS contract:
- Single `mousemove` listener on each magnetic element parent.
- `delta = (cursor - center) * 0.18` (18% of distance to cursor; clamped to `--magnetic-max-disp`).
- On enter zone: add `is-following`; write `transform: translate3d(deltaX, deltaY, 0)` inline.
- On leave zone: remove `is-following`; transform animates back to 0,0 via the spring transition.

### 8.LANDING.5 3D card tilt on hover

For feature cards. Cursor over card → card tilts toward cursor with subtle gloss/spotlight.

```css
.saas-chrome [data-tilt] {
  --tilt-max-rot: 8deg;
  --tilt-perspective: 1200px;
  transform-style: preserve-3d;
  perspective: var(--tilt-perspective);
  transition: transform var(--landing-duration-fast) var(--ease-out-back);
  will-change: transform;
}
.saas-chrome [data-tilt]:hover {
  transform: scale(1.02);
}
.saas-chrome [data-tilt] .tilt-inner {
  transition: transform var(--landing-duration-fast) var(--ease-out-back);
  transform-style: preserve-3d;
}
/* JS sets rotateX/rotateY inline on .tilt-inner based on cursor pos. */
```

### 8.LANDING.6 Hero type-scale

Reserved for the `/saas` hero only; never use these sizes elsewhere.

```css
.saas-chrome {
  --hero-h1-desktop: clamp(64px, 7vw, 96px);  /* big screens */
  --hero-h1-tablet:  clamp(48px, 6vw, 64px);  /* iPad portrait */
  --hero-h1-mobile:  clamp(36px, 9vw, 48px);  /* phone */
  --hero-h1-leading: 0.95;                    /* tight */
  --hero-h1-track:   -0.04em;                 /* tight letter-spacing for big sizes */
  --hero-subtitle:   clamp(18px, 1.6vw, 22px);
  --hero-subtitle-leading: 1.5;
}
```

### 8.LANDING.7 Parallax depth layers

3 layers for the hero: background (slowest), midground (mid), foreground (fastest, near 1:1).

```css
.saas-chrome [data-parallax="bg"]   { will-change: transform; }  /* 0.3x scroll */
.saas-chrome [data-parallax="mid"]  { will-change: transform; }  /* 0.6x scroll */
.saas-chrome [data-parallax="fg"]   { will-change: transform; }  /* 0.9x scroll */
```

JS contract: single `scroll` listener (passive), `requestAnimationFrame`-throttled. Applies `transform: translate3d(0, scrollY * factor, 0)` per layer.

### 8.LANDING.8 Reduced-motion fallback (MANDATORY)

```css
@media (prefers-reduced-motion: reduce) {
  .saas-chrome [data-scroll-trigger],
  .saas-chrome [data-scroll-trigger] > *,
  .saas-chrome [data-magnetic],
  .saas-chrome [data-tilt],
  .saas-chrome [data-tilt] .tilt-inner,
  .saas-chrome [data-parallax] {
    /* Strip all transitions, transforms, and animations */
    transition: none !important;
    transform: none !important;
    animation: none !important;
    opacity: 1 !important;
  }
}
```

Every JS handler ALSO checks `window.matchMedia('(prefers-reduced-motion: reduce)').matches` at attach time and short-circuits attach if true. No idle event listeners for users who opted out.

### 8.LANDING.9 Performance budget

- Initial JS for hero animation: ≤200KB (code-split, dynamic `import()`).
- Three.js hero is OPTIONAL — gated by Sub-B.1 performance prototype validating Lighthouse Performance ≥85 on mobile slow-4G.
- If WebGL hero fails the budget: fallback = vanilla CSS hero with `data-parallax` + `data-scroll-trigger` only.
- All non-hero animations are CSS-driven (no JS framework cost beyond a tiny IO listener).

---

## 9. Primitive components

Each primitive ships under `lib/ui/primitives/`, typed, server-
component-friendly where possible, exporting both component and TS
prop types. Each entry names: variants, sizes, states, ARIA, keyboard.

### 9.1 Button

- **Variants:** `primary` (solid `--accent`, `--text-on-accent`),
  `secondary` (`--surface-2` fill, `--separator-default` border,
  `--text-primary`), `ghost` (transparent), `danger` (`--danger` text
  on `--danger-bg`).
- **Sizes** (height / pad-x / font): `sm` 28/12/13, `md` 36/16/15
  (default), `lg` 44/20/15 (touch target).
- **States:** default, hover, active (pressed), focus-visible,
  disabled, loading (inline 14px spinner left of label, label →
  `--text-tertiary`, click suppressed).
- **ARIA:** native `<button>`; real `disabled` when blocked,
  `aria-disabled` for content-invalidity; `aria-busy` during loading.
- **Keyboard:** native — Tab/Space/Enter.
- **Russian copy examples:** "Сохранить", "Отменить", "Купить пакет",
  "Удалить аккаунт".

### 9.2 Input / Textarea / Select

- **Sizes:** `md` (h=36, default), `lg` (h=44, auth forms — matches
  current 12×14 padding).
- **Composition:** `<Field>` wraps `<Label>` + control + `<HelperText>`
  + `<ErrorMessage>`. Migrates the current `AuthField` (callers swap
  imports per-wave).
- **States:** default, hover, focus-visible (4px outset focus ring,
  §11), invalid (1px `--danger` border + helper in `--danger`),
  disabled (opacity 0.5).
- **ARIA:** `<label for>` ↔ `id`; `aria-describedby` → helper id;
  `aria-invalid` + `aria-errormessage` when invalid.
- **Keyboard:** native. Native `<select>` only in v1.0 (custom
  listbox reserved for post-v1).

### 9.3 Card

- **Anatomy:** `<Card>` (`--surface-1`, `--radius-4`, 1px
  `--separator-default` border, `--space-5` pad); optional
  `<Card.Header>` (title `--text-17` weight 600, optional eyebrow,
  right-aligned actions slot, 1px underline + `--space-4` gap);
  optional `<Card.Footer>` (separator above, right-aligned actions).
- **States:** static by default. If the whole card is a link/button,
  hover: border → `--separator-strong`, bg → `--surface-2`,
  `--duration-fast`. No translateY lift.
- **ARIA:** if interactive, render as `<a>` or `<button>`.

### 9.4 Modal / Dialog

- **Anatomy:** scrim (`--overlay-scrim` + 12px `backdrop-filter`);
  dialog centered, `min(560px, 92vw)`, `--surface-1`, `--radius-4`,
  `--shadow-modal`. Header: `<h2>` `--text-22` weight 600 + ghost icon
  close (top-right). Body pad `--space-5`. Footer: actions right-
  aligned (Apple order: secondary "Отмена" left, primary right; for
  destructive, danger right).
- **States:** entering (`--duration-slow`, `--ease-out`), open,
  exiting (reverse, `--ease-in`).
- **ARIA:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby` →
  header h2, `aria-describedby` → body description if any.
- **Keyboard:** Esc closes, focus trap on open, focus returns to
  trigger on close, initial focus on first field (or on
  non-destructive button if read-only).

### 9.5 Dropdown menu

- **Anatomy:** portaled panel — `--surface-2`, `--radius-3`,
  `--shadow-2`, 1px `--separator-default`. Items 36px tall, `--space-3`
  pad-x, left-aligned icon + label, hover bg `--surface-3`.
- **Variants:** plain, with separators, with destructive item (label
  `--danger`, hover bg `--danger-bg`).
- **ARIA:** `role="menu"` / `role="menuitem"`; trigger has
  `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`.
- **Keyboard:** Up/Down nav, Enter activates, Esc closes, Tab closes
  forward, focus returns to trigger.

### 9.6 Badge

- **Variants:** `neutral` (`--surface-2` / `--text-secondary`),
  `success`, `warning`, `danger`, `info`, `accent` — each pairing the
  semantic bg with the chromatic fg.
- **Size:** one only — h=22, `--text-12` weight 500, pad
  `0 --space-2`, `--radius-full`.
- **ARIA:** none required when redundant with nearby text; otherwise
  a visually-hidden suffix.

### 9.7 Segmented control

- **Anatomy:** outer track `--surface-1`, `--radius-full`, `--space-1`
  inner pad. Each segment is a button `--text-13` weight 500. Selected
  segment renders a thumb (`--surface-3`, `--shadow-1`, `--radius-full`),
  animated via `translateX` (`--duration-base`, `--ease-in-out`).
- **States:** default (`--text-secondary`), selected (`--text-primary`
  + thumb), hover unselected (`--text-primary`, no thumb).
- **ARIA:** `role="tablist"` outer, `role="tab"` each, `aria-selected`
  on active; controlled panel `role="tabpanel"`.
- **Keyboard:** Left/Right cycle (wrap configurable), Home/End jump.
- **Russian copy:** "Все / Открытые / Завершённые", "День / Неделя /
  Месяц".

### 9.8 Checkbox / Radio

- **Visual:** 18×18 — square `--radius-1` (checkbox) or circle
  (radio). Idle: 1px `--separator-strong`, `--surface-1` fill.
  Selected: `--accent` fill + white check / dot.
- **States:** default, hover (border → `--accent`), focus-visible,
  checked, indeterminate (checkbox only — horizontal bar), disabled
  (opacity 0.5).
- **ARIA:** native `<input>` + `<label>`. Radio group needs
  `<fieldset>` + `<legend>`.
- **Keyboard:** Space toggles; radio group arrow-keys move.

### 9.9 Switch (iOS toggle)

- **Use case:** on/off setting with immediate effect ("Постоплата
  разрешена"). NOT for form submission — use checkbox if committed on
  submit.
- **Visual:** track 32×20, `--radius-full`. Off: track `--surface-3`,
  thumb `--text-secondary` (16×16, 2px inset). On: track `--accent`,
  thumb white. Thumb slides `--duration-base` `--ease-in-out`.
- **States:** off, on, focus-visible (ring around track), disabled.
- **ARIA:** `role="switch"`, `aria-checked`, label via `<label>` or
  `aria-labelledby`.
- **Keyboard:** Space toggles.

### 9.10 Tooltip

- **Visual:** `--surface-3`, `--text-primary` 13px, `--radius-2`,
  `--space-2 --space-3` pad, `--shadow-2`, max-width 280px, 4px gap
  from anchor, no arrow (Apple Big Sur+ style).
- **Trigger:** hover (600ms delay) + focus (no delay). Dismiss on
  blur/leave/Esc.
- **ARIA:** anchor `aria-describedby` → tooltip id; tooltip
  `role="tooltip"`. NEVER use `aria-label` here — double-announce risk.

---

## 10. Layout primitives

### 10.1 Page shell

- **AuthShell** (existing, kept): single column, max-width ~440px,
  vertically centered when short. Used by /login, /register,
  /cabinet (single-column for now), /forgot, /reset. Internal
  paddings update to new spacing tokens; contract unchanged.
- **AdminShell** (new): header bar + sidebar + main. Today's geometry
  in `app/admin/(gated)/layout.tsx` (sidebar 240px, main flex) is the
  baseline; restyled per §10.3.
- **SiteShell** (landing): unchanged. Out of scope.

### 10.2 Section

`<Section>` wraps a logical block inside a shell. Margin-bottom
`--space-6`. Optional `<Section.Header>` = `<h2>` (`--text-22`, weight
600) + right-aligned actions.

### 10.3 Header bar

48px height (down from current 56 — Apple's compact toolbar), `--bg`
bg, no border on cabinet, 1px `--separator-default` on admin, logo
left, account menu right. Sticky on long-scroll pages.

### 10.4 Sidebar (admin)

Width 240px (current). Pad `--space-4 --space-3`. Items: `<a>` as
32px-tall rows, `--radius-2`, pad-x `--space-3`, `--text-13` weight 500.

- **Idle:** text `--text-secondary`, bg transparent.
- **Hover:** text `--text-primary`, bg `--surface-2`.
- **Active route:** text `--text-primary`, bg `--accent-bg`, plus 2px
  inset left accent rule (`box-shadow: inset 2px 0 0 var(--accent)`).

Eyebrow "Админка" stays (becomes the new `Eyebrow` primitive).

### 10.5 Grid

12-column responsive grid (dashboards mostly):

- Gutter: `--space-5` (24px).
- Outer page pad: `--space-6` desktop, `--space-4` mobile.
- Container max-width: 1180 admin / 740 cabinet / 440 auth.

v1.0 ships as a CSS-grid utility class (`grid-12`) rather than React
components — feature plans rarely need more.

---

## 11. Accessibility

- **Contrast.** Every pair in §3 passes WCAG AA against its intended
  bg. Any new pairing not in the matrix must be verified before merge.
- **Focus ring.** Apple-style 4px outset in `--accent` at 60% alpha
  with 2px offset. Use `:focus-visible` (NOT `:focus`) so mouse
  clicks don't paint the ring:

  ```
  --focus-ring-color: rgba(216,138,130,0.60);
  --focus-ring-width: 4px;
  --focus-ring-offset: 2px;

  *:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
    border-radius: inherit;
  }
  ```

- **Keyboard.** Every interactive element reachable via Tab in
  document order. No `tabindex > 0`. `tabindex="-1"` only for
  programmatic-focus targets. Skip-to-content link at top of every
  shell, visually hidden until focused. Esc closes overlays in order:
  open menu first, then modal.
- **Motion reduction.** See §8. Every animation has a fallback —
  either an opacity fade or no animation.
- **Touch targets.** ≥44×44 hit area on mobile (`≤480px`). Visual
  control can be smaller (switch is 32×20); wrapping label/`<button>`
  extends the hit area via padding. Non-negotiable for `lg` buttons.
- **Color independence.** No state conveyed by color alone. Validation
  errors carry an `AlertCircle` + text in `--danger`; "Оплачено" badge
  carries the word plus the color.

---

## 12. Migration strategy

**Phase 0 — token foundation (1 PR).**

- Add the v1.0 token block to `app/globals.css` under a `/* design
  tokens v1 */` comment.
- Add the `*:focus-visible` focus ring and the reduced-motion
  override for `.ui-*` classes.
- Add `.no-marketing-noise` opt-out on `<html>` applied via root layout
  for SaaS routes (kills `body::before` noise overlay on cabinet/admin/
  auth).
- No component changes. Visual diff: identical except the noise
  overlay disappears on SaaS routes.

**Phase 1 — primitive layer (1-2 PRs).**

- `lib/ui/primitives/` populated: `Button`, `Field/Input/Textarea`,
  `Card`, `Modal`, `DropdownMenu`, `Badge`, `SegmentedControl`,
  `Checkbox`, `Radio`, `Switch`, `Tooltip`, `Eyebrow`, `Section`.
- Each primitive exercised on `app/_dev/primitives/page.tsx` (gated to
  non-prod) so reviewers see every state without booting a feature.
- No call sites change yet.

**Phase 2 — surface ports (per-wave plan docs).**

Each wave plan picks one or two surfaces and cites this doc by
section. Suggested order:

1. `/login`, `/register`, `/forgot`, `/reset` — smallest surface,
   easiest visual win; validates the typography migration.
2. `/cabinet` learner UI — high-traffic; locks card/banner/modal
   patterns.
3. `/admin` chrome (sidebar + header) — locks the sidebar pattern.
4. `/admin/*` data pages, one at a time — applies grid + segmented +
   badge.
5. Calendar redesign (`docs/plans/calendar-apple-redesign.md`) — most
   ambitious; lands last.

Each port is its own PR. Per CLAUDE.md global policy, surface ports
are sub-PRs of the SAAS-6 epic (epic-level paranoia, sub-PR
self-review).

**Phase 3 — cleanup (one PR after all surfaces are ported).**

- Move marketing-only classes (`.btn-primary`, `.btn-secondary`,
  `.card`, `.section-label`, `.tag`, `.stat-number`, `.glow`,
  `.gradient-*`) into a `app/(marketing)/marketing.css` scoped
  stylesheet, imported only by the marketing layout.
- Drop `.fade-in` / `.delay-*` if unreferenced.
- Decide whether marketing keeps the gradient accent vars (likely
  yes — branding).

**Phase 4 — light mode (future, not v1.0).**

Reserved. Tokens are semantic, so a light-mode swap is a
`:root[data-theme="light"]` override. Out of scope here.

---

## Appendix A — open questions (need product input)

1. **Accent hex final lock.** §3 picks `#D88A82`. Owner may prefer
   warmer (`#E29B92`) or more saturated. Sign-off after Phase 1
   primitive page lands.
2. **Iconography library.** Default `lucide-react`. SF-Symbols-style
   alternatives (Phosphor Pro, custom set) require a buy decision.
3. **Russian-locale tabular numerals.** SF Pro Cyrillic + tabular-
   nums works; Inter fallback on Linux has slightly different glyph
   widths. Acceptable but worth a real-admin-table check.
4. **Empty-state illustrations.** Currently text-only. Product may
   want a thin-line icon set; not committed here.
5. **Per-account reduce-motion toggle.** `prefers-reduced-motion`
   covers OS-level. A "Уменьшить анимации" cabinet setting is
   reserved for a settings-page wave.

---

*End of v1.0. Revisions land via PR touching this file with a one-line
status update at the top.*
