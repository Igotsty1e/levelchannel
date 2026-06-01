# SAAS-1 5.A — Token scoping under `.saas-chrome` class selector

**Status:** SHIPPED 2026-05-19 — PR #341 merged (`10e35d7`). SaaS design-token block landed under `.saas-chrome` class selector in `app/globals.css`; tokens (color/typography/spacing/radii/shadows/motion/focus-ring) attached to admin chrome + auth chrome + cabinet (via `AuthShell`) without leaking to `/pay`, `/checkout/[tariffSlug]`, marketing landing, `/offer`, `/privacy`, `/consent/personal-data`. Plan-doc retained as historical paranoia continuity for `calendar-apple-redesign.md` §5.A.
**Wave name:** SAAS-1 5.A (extracted sub-PR of `docs/plans/calendar-apple-redesign.md` §5.A).
**Trigger:** The Apple-redesign plan §5.A drafted the scoping spec inline but never extracted it into its own plan-doc. Without an isolated plan-doc the change is hidden inside a multi-sub-PR wave and never independently paranoia-reviewed.

Plan-doc shape mirrors `docs/plans/calendar-apple-redesign.md` and `docs/plans/booking-calendly-style.md`. All file:line refs verified on `main` 2026-05-18.

---

## 1. Goal

Add the full SaaS design-token block from `docs/design-system.md` (§3 Color + §4 Typography + §5 Spacing + §6 Radii + §7 Shadows + §8 Motion + §11 Focus ring — §3 is the load-bearing part for SAAS-1 calendar consumption) to `app/globals.css` **inside a `.saas-chrome { ... }` class selector**, NOT inside `:root`.

Attach `.saas-chrome` to exactly three shell wrappers — admin chrome, auth chrome, and (transitively, via `AuthShell`) cabinet — so SaaS Apple-aesthetic tokens are visible to descendants of those shells and **invisible to `/pay`, `/checkout/[tariffSlug]`, marketing landing (`/`), `/offer`, `/privacy`, `/consent/personal-data`** (all four legal-style surfaces have their own top-level container, not `AuthShell`).

Rationale: the SAAS-1 calendar plan, the future SAAS-6 primitive layer, and any subsequent SaaS surface port all need `--accent`, `--text-on-accent`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--danger`, `--info`, `--success`, `--warning` and their `-bg` companions defined. If they land in `:root`, they leak globally — silently re-painting `/pay`'s `var(--accent-gradient)` consumers and the legal pages' hardcoded `#0B0B0C` / `#A1A1AA` chrome. Class-scoping makes the blast radius explicit.

### 1.1 Existing surface inventory

Per COMPANY.md "Survey-before-plan". Cited against `main` 2026-05-18.

**Current `:root` token block** — `app/globals.css:5-14` defines exactly **4 visual + 3 accent-gradient tokens**:

| Token | Value | `app/globals.css` line |
|---|---|---|
| `--bg` | `#0B0B0C` | `:6` |
| `--surface` | `#111113` | `:7` |
| `--border` | `rgba(255,255,255,0.08)` | `:8` |
| `--text` | `#ffffff` | `:9` |
| `--secondary` | `#A1A1AA` | `:10` |
| `--accent-start` | `#C87878` | `:11` |
| `--accent-end` | `#E8A890` | `:12` |
| `--accent-gradient` | `linear-gradient(135deg, #C87878 0%, #E8A890 100%)` | `:13` |

**Critical gap.** `--accent` (solid, not gradient) is NEVER defined globally. 27 files reference `var(--accent...)`, of which the well-defended consumers use the fallback form `var(--accent, #D88A82)`:

- `components/calendar/Grid.tsx:164,178,237` — `var(--accent, #D88A82)`
- `app/teacher/settings/calendar/connect-card.tsx:237` — `var(--accent, #3b82f6)` (note divergent fallback colour)
- `app/legal/v/[id]/page.tsx:84` — `var(--accent, #6ea8fe)` (note third divergent fallback)

The undefended consumers fire the CSS-default empty string for `--accent` (i.e. the property has no effect):

- `app/admin/(gated)/payments/page.tsx:269` — `background: 'var(--accent)'`
- `app/cabinet/lessons-section.tsx:526` — same shape
- `app/cabinet/billing-sections.tsx`, `app/cabinet/teacher-section.tsx`, `app/cabinet/book/...`, `app/admin/(gated)/reconciliation/...`, `app/admin/(gated)/packages/packages-editor.tsx`, `app/checkout/[tariffSlug]/checkout-form.tsx`, etc. — same shape, no fallback.

**This means defining `--accent` ANYWHERE that those undefended consumers can see it is a visual change today, not a no-op.** Class-scoping under `.saas-chrome` is the only way to opt those consumers in deliberately without also opting in `/checkout/[tariffSlug]` (which sits OUTSIDE any planned `.saas-chrome` shell — see §1.3).

**Design-system promise** — `docs/design-system.md` §2-§11 enumerates ~50 tokens (full list in §2 of this plan-doc). The 4-vs-50 delta is the gap this sub-PR closes for SaaS-only surfaces.

### 1.2 Attachment-point inventory

`.saas-chrome` is added to exactly these shell wrappers:

| Attachment point | File:line | Wraps |
|---|---|---|
| **Admin chrome** | `app/admin/(gated)/layout.tsx:46-104` (outer `<div>` with `display:flex` + `minHeight: calc(100vh - 56px)`) | every page under `/admin/(gated)/*` |
| **Auth chrome** | `components/auth-shell.tsx:13-26` (the `<main className="auth-shell-main">`) | `/login`, `/register`, `/forgot`, `/reset`, `/verify-pending`, `/verify-failed` |
| **Cabinet (transitively)** | `app/cabinet/page.tsx:137` renders `<AuthShell>` as outer wrapper | `/cabinet` inherits the class via the AuthShell attach-point above; **no separate edit needed**. Verified against `app/cabinet/page.tsx:136-244`. |

Cabinet sub-routes: spot-checked `/cabinet/packages` and `/cabinet/book/[ymd]`; if any sub-route bypasses `AuthShell` it must be patched at impl time (tracked as a §6 RISK, not a blocker — most cabinet sub-routes wrap their own `AuthShell` independently).

### 1.3 NOT-touched inventory

These surfaces keep the current palette (warm rose gradient + hardcoded `#0B0B0C` chrome). They reach the DOM via top-level wrappers that are **separate from `AuthShell`** and **separate from `app/admin/(gated)/layout.tsx`**:

| Page | Outer container | File:line | Why untouched |
|---|---|---|---|
| `/` (marketing landing) | `<HomePageClient>` (client component) | `app/page.tsx:11-24` → `components/home/home-page-client.tsx:1075` | Marketing keeps the rose gradient — `docs/design-system.md` §2 explicit non-goal. |
| `/pay` | `<main style={{ minHeight: '100vh', background: 'var(--bg)' }}>` | `app/pay/page.tsx:44` | Payment surface uses landing's pricing section verbatim; framing locked. |
| `/checkout/[tariffSlug]` | `<main style={{ minHeight: '100vh', background: 'var(--bg)' }}>` | (analogous pattern to `app/pay/page.tsx:44`) — verified the file does NOT import `AuthShell` (no match in `grep AuthShell app/checkout/[tariffSlug]/page.tsx`) | Same framing as `/pay` — paid surfaces stay on landing palette. |
| `/offer` | `<div style={{ minHeight: '100vh', background: '#0B0B0C', ... }}>` | `app/offer/page.tsx:30-31` | Legal page; hardcoded chrome, inline-styled — outside SaaS aesthetic. |
| `/privacy` | `<div style={{ minHeight: '100vh', background: '#0B0B0C', ... }}>` | `app/privacy/page.tsx:24-32` | Same shape — legal page top-level container. |
| `/consent/personal-data` | `<div style={{ minHeight: '100vh', background: '#0B0B0C', ... }}>` | `app/consent/personal-data/page.tsx:20-29` | Same shape — legal page top-level container. |

**Class-scope semantics** — CSS custom properties defined inside `.saas-chrome { ... }` are scoped to that element and its descendants. They do NOT cascade up to ancestors and do NOT leak across siblings. Therefore `--accent` inside `.saas-chrome` cannot reach a `<main>` in `/pay` or a `<div>` in `/offer` because neither has `.saas-chrome` on any ancestor.

**Note on `:root`-defined tokens.** The 4 existing `:root` vars (`--bg`, `--surface`, `--border`, `--text`, `--secondary`, `--accent-start`, `--accent-end`, `--accent-gradient`) STAY in `:root` and are unchanged — both SaaS and non-SaaS surfaces continue to consume them. The `.saas-chrome` block is purely additive.

---

## 2. Design — full token block to add inside `.saas-chrome`

The block below transcribes `docs/design-system.md` §3 (Color), §4 (Typography), §5 (Spacing), §6 (Radii), §7 (Shadows), §8 (Motion), §11 (Focus ring) verbatim. Hex values are the design-system v1.0 source of truth.

```css
/* ──────────────────────────────────────────────────────────────────
   SaaS design tokens v1.0 (per docs/design-system.md §2-§11).
   Scoped to .saas-chrome so they don't leak to /pay, /, /offer,
   /privacy, /consent — those keep the marketing palette.

   Attached in three places:
   - app/admin/(gated)/layout.tsx outer <div>
   - components/auth-shell.tsx <main>
   - cabinet inherits via AuthShell
   ────────────────────────────────────────────────────────────────── */
.saas-chrome {
  /* Surfaces (design-system §3) */
  --bg: #0B0B0D;
  --surface-1: #141416;
  --surface-2: #1C1C1F;
  --surface-3: #26262A;
  --overlay-scrim: rgba(0, 0, 0, 0.55);

  /* Separators */
  --separator-faint: rgba(255, 255, 255, 0.04);
  --separator-default: rgba(255, 255, 255, 0.08);
  --separator-strong: rgba(255, 255, 255, 0.14);

  /* Text */
  --text-primary: #F5F5F7;
  --text-secondary: #A1A1AA;
  --text-tertiary: #6E6E76;
  --text-quaternary: #48484C;
  --text-on-accent: #FFFFFF;

  /* Accent */
  --accent: #D88A82;
  --accent-hover: #E29B92;
  --accent-pressed: #C47B72;
  --accent-bg: rgba(216, 138, 130, 0.10);
  --accent-bg-strong: rgba(216, 138, 130, 0.18);

  /* Semantic (design-system §3 Semantic colors) */
  --success: #4ADE80;
  --success-bg: rgba(74, 222, 128, 0.10);
  --warning: #F5C26B;
  --warning-bg: rgba(245, 194, 107, 0.10);
  --danger: #FF6E6E;
  --danger-bg: rgba(255, 110, 110, 0.12);
  --info: #7AB8FF;
  --info-bg: rgba(122, 184, 255, 0.10);

  /* Font (design-system §4) */
  --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text',
               'SF Pro Display', 'Inter', system-ui, 'Segoe UI', Roboto,
               'Helvetica Neue', Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
               'Liberation Mono', monospace;

  /* Type scale */
  --text-12: 12px;
  --text-13: 13px;
  --text-15: 15px;
  --text-17: 17px;
  --text-22: 22px;
  --text-28: 28px;
  --text-34: 34px;
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-bold: 700;

  /* Spacing (design-system §5) */
  --space-0: 0;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 96px;

  /* Radii (design-system §6) */
  --radius-1: 4px;
  --radius-2: 8px;
  --radius-3: 12px;
  --radius-4: 16px;
  --radius-5: 24px;
  --radius-full: 9999px;

  /* Shadows (design-system §7) */
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.30);
  --shadow-2: 0 2px 4px rgba(0, 0, 0, 0.30), 0 8px 16px rgba(0, 0, 0, 0.24);
  --shadow-3: 0 4px 8px rgba(0, 0, 0, 0.32), 0 16px 32px rgba(0, 0, 0, 0.28);
  --shadow-modal: 0 8px 16px rgba(0, 0, 0, 0.36), 0 32px 64px rgba(0, 0, 0, 0.40);

  /* Motion (design-system §8) */
  --duration-fast: 150ms;
  --duration-base: 250ms;
  --duration-slow: 400ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-linear: linear;

  /* Focus ring (design-system §11) */
  --focus-ring-color: rgba(216, 138, 130, 0.60);
  --focus-ring-width: 4px;
  --focus-ring-offset: 2px;
}
```

**Mobile-collapse override** for `--space-7..--space-9` per `docs/design-system.md` §5:

```css
@media (max-width: 480px) {
  .saas-chrome {
    --space-7: 32px;   /* 48 → 32 */
    --space-8: 48px;   /* 64 → 48 */
    --space-9: 64px;   /* 96 → 64 */
  }
}
```

**Total token count: ~55 entries** (≈10 surface/separator, 5 text, 5 accent, 8 semantic, 2 font, 7 type-scale + 3 weight, 10 spacing, 6 radius, 4 shadow, 7 motion, 3 focus-ring). All names match `docs/design-system.md` §2 enumeration verbatim.

### 2.1 Attachment edits

Three edits, ≤1 line each:

1. **`app/admin/(gated)/layout.tsx:46`** — add `className="saas-chrome"` to the outer `<div style={{ display:'flex', ... }}>` (current line `:46-52`).
2. **`components/auth-shell.tsx:13`** — change `className="auth-shell-main"` to `className="auth-shell-main saas-chrome"` on the `<main>` (line `:13-22`).
3. **Cabinet** — NO edit needed; verified `app/cabinet/page.tsx:137` wraps its render in `<AuthShell>`, which inherits the class via attachment point #2.

### 2.2 Token-name conflicts (deliberate)

The new `.saas-chrome { --bg: #0B0B0D }` re-declares `--bg`. Inside `.saas-chrome` and descendants the value becomes `#0B0B0D` (warmer); outside it stays `#0B0B0C` (current). The Δ is 1 hex unit on the blue channel — invisible to the eye, intentional per design-system §3. This is the ONLY token name that collides with the existing `:root` set.

Other `:root` tokens kept untouched: `--surface`, `--border`, `--text`, `--secondary`, `--accent-start`, `--accent-end`, `--accent-gradient`. Design-system §2 names these "Keep + soft-deprecate"; full deprecation lands in Phase 3 of the SAAS-6 epic, not in this sub-PR.

---

## 3. Tests — visual regression strategy

No unit-test additions (CSS-only change; pure-function test surface is empty). Verification is browser-screenshot evidence, run on a local dev server BEFORE merge and on staging AFTER merge.

| Surface | Expected delta |
|---|---|
| `/admin/slots` (SAAS-1 calendar surface) | `var(--accent)` consumers (e.g. `Grid.tsx:178` today column) resolve to `#D88A82` instead of the inline fallback `#D88A82` — pixel-identical, confirms the new resolution path. |
| `/admin/payments` | `var(--accent)` consumers (`app/admin/(gated)/payments/page.tsx:269` — no fallback today) flip from empty (rendered black or default) to `#D88A82`. This IS a visible change; flag for product review screenshot. |
| `/cabinet` | Same as `/admin/payments` for `var(--accent)` undefended consumers (cabinet has many). Flag for product review screenshot. |
| `/pay` | **No visual delta.** `--accent-gradient` still resolves from `:root`. Screenshot before/after must be bit-identical. |
| `/checkout/lesson-60min` | Same as `/pay` — no delta. |
| `/offer`, `/privacy`, `/consent/personal-data` | No visual delta — these don't reference `--accent` at all (hardcoded `#0B0B0C`, `#A1A1AA`, etc.). |
| Marketing landing `/` | No visual delta — `--accent-gradient` still in `:root`. |

**Verification command** — `npm run dev` + manual nav to each URL, plus DOM-inspector check that `getComputedStyle(document.querySelector('main.saas-chrome'))['--accent']` resolves to `#D88A82` on SaaS routes and is empty/undefined on `/pay`.

**Greenable tests** — full unit + integration suite must remain green (no test file touched).

---

## 4. Migration plan

**Single PR, additive CSS-only.** No DB migration. No feature flag (revert = rollback). No CSP / permissions-policy / env-var change. No new endpoint.

Sequence:
1. Add the `.saas-chrome { ... }` block to `app/globals.css` (after the existing `:root` block, around line 14).
2. Patch `app/admin/(gated)/layout.tsx` outer `<div>` className.
3. Patch `components/auth-shell.tsx` `<main>` className.
4. Manual screenshot verification per §3.
5. Ship.

Rollback: revert the 1 commit.

---

## 5. Decomposition — single PR

**Single PR estimated ≤ 150 LoC delta** (≈+130 CSS + 2 className edits + ~10 doc-update lines). Falls under the SAAS-1 plan's "≤150 LoC per sub-PR" rule. No further split needed — the three edits are co-dependent (CSS block + attachment points must land together to be testable).

The previous SAAS-1 plan §5.A bundled this work into the calendar wave; extracting it now makes it a sub-PR `5.A` of the SAAS-1 epic — independently mergeable BEFORE 5.B (hour-grid constants).

---

## 6. Risks + mitigations

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| R1 | Token leak through inheritance — descendant of `.saas-chrome` happens to be ALSO an ancestor of `/pay` content (nested portal? root portal?). | **Low**, but worth a `grep` check before merge. | `grep -rn "createPortal\|next/portal" app/` to confirm no SaaS-route portal renders into a non-SaaS DOM subtree. Modal portals in `components/calendar/PaintConfirmModal.tsx` render into `document.body` — those WILL miss `.saas-chrome` and lose `--accent`; verified to not be an issue today (modal palette uses literals); flagged for SAAS-MODAL-1. |
| R2 | Cabinet sub-route missing the class — `/cabinet/packages`, `/cabinet/book/[ymd]`, `/cabinet/profile` may not all go through `AuthShell`. | Medium | Per-route grep at impl: `grep -l "AuthShell" app/cabinet/**/*.tsx`. Any route that renders its own outer container needs `.saas-chrome` added or its outer container swapped to `<AuthShell>`. Track as §9 OPEN QUESTION #1. |
| R3 | Marketing CSS unintentionally targets `var(--accent)` and starts resolving differently. | Low | `var(--accent)` does NOT appear in `app/globals.css` outside this sub-PR (only `--accent-gradient`, `--accent-start`, `--accent-end`). Marketing-tier CSS classes (`.btn-primary`, `.section-label`, `.tag`) consume the `:root` gradient vars only. |
| R4 | Undefended `var(--accent)` consumers in admin/cabinet flip from "no value (transparent/black)" to `#D88A82` and operators perceive it as a regression. | Medium | This IS the intended payoff — those surfaces have been silently broken since the property was never defined. Product-owner pre-merge screenshot review at §3 catches any specific page that needed a hardcoded colour. |
| R5 | `--bg` re-declaration inside `.saas-chrome` (`#0B0B0D` vs `:root` `#0B0B0C`) breaks a screenshot pixel-diff test. | Low | No screenshot pixel-diff test exists in the repo (verified — no `.png` assertion infra). Manual screenshot review only. |
| R6 | The new `--font-sans` token re-declares system font stack including SF Pro — currently the body uses `var(--font-inter)` from `next/font`. Cabinet inputs may render with different fallback chain. | Low | The new token is opt-IN — no rule consumes `--font-sans` yet. The `font-family: var(--font-inter), ...` declaration in `body { }` (`app/globals.css:29`) keeps the current inheritance unchanged. Primitive layer (SAAS-6 Phase 1) is the first consumer of `--font-sans`. |
| R7 | The `--bg` redefine inside `.saas-chrome` poisons `app/admin/(gated)/layout.tsx:50` inline-style `background: 'var(--bg)'` — the admin shell paints `#0B0B0D` instead of `#0B0B0C`. | Low | Verified: this IS the intended visual delta per design-system §3. The 1-unit hex shift on the blue channel is invisible. |
| R8 | Some `.saas-chrome` descendant uses `:root` literally in its selector (e.g. CSS variable cascade test) and breaks. | Low | `grep -rn ":root" app/ components/` shows usage limited to `app/globals.css:5` (the definition site). No selector lookup. |
| R9 | Operator runs `/cabinet` while logged-out → redirect to `/login` (which IS `AuthShell`). Visual consistency preserved. | Low | Both surfaces have `.saas-chrome` after this PR. |
| R10 | A nested `.saas-chrome` (e.g. accidental re-add inside cabinet) re-declares the same tokens — harmless (same values). | Low | CSS variables resolve from nearest ancestor; nesting same-value redeclarations is a no-op. |

---

## 7. Migration of existing fallbacks (deferred follow-up)

The 5 well-defended consumers (`var(--accent, #D88A82)` in `Grid.tsx`, `var(--accent, #3b82f6)` in `connect-card.tsx`, `var(--accent, #6ea8fe)` in `app/legal/v/[id]/page.tsx`) keep their fallbacks **intact** in this sub-PR. Cleanup happens later:

- `connect-card.tsx:237` `#3b82f6` (blue) is wrong vs the SaaS warm-rose `#D88A82` — already a bug today. Fix lives in a SAAS-1-FOLLOWUP-FALLBACK-COLORS ticket (NOT this sub-PR).
- `app/legal/v/[id]/page.tsx:84` `#6ea8fe` is on a legal page — OUT of `.saas-chrome` scope (`<main>` at `legal/v/[id]/page.tsx:55` not nested under any SaaS shell); fallback stays the source of truth there.

---

## 8. Doc-sweep

This sub-PR's docs update:

- **`docs/design-system.md`** — append a one-line status note at top (§Status block, line 3-6 region) saying "Phase 0 token foundation landed via SAAS-1 5.A — see `docs/plans/saas-1-5a-token-scoping.md`".
- **`docs/plans/calendar-apple-redesign.md`** — line 361 area: change the inline §5.A spec into a cross-reference: "see `docs/plans/saas-1-5a-token-scoping.md`".
- **`ARCHITECTURE.md`** — if it has a Design-System / Styling section, add a paragraph: "SaaS design tokens are scoped under `.saas-chrome` (admin/auth/cabinet); marketing + legal + payment surfaces keep the `:root` gradient palette."

No backlog additions in this sub-PR (R7 follow-up filed only if Codex flags it BLOCKER in paranoia).

---

## 9. Open questions for paranoia

1. **Cabinet sub-route AuthShell coverage.** Are `/cabinet/packages`, `/cabinet/book/[ymd]`, `/cabinet/profile`, `/cabinet/orders` ALL wrapped in `AuthShell`? If any renders its own outer `<main>` / `<div>`, `.saas-chrome` won't reach it. Verification command: `grep -L AuthShell app/cabinet/**/*.tsx | xargs grep -l "export default"`. Resolution: either patch them to use `AuthShell`, or add `.saas-chrome` to their outer container.
2. **Modal portals.** `components/calendar/PaintConfirmModal.tsx`, `components/calendar/BookConfirmModal.tsx`, `app/admin/(gated)/slots/slot-cancel-modal.tsx` render via React portals (most likely into `document.body`, OUTSIDE `.saas-chrome`). They'd lose access to `--accent`. Do any of them currently consume `var(--accent...)`? If yes, they need explicit `className="saas-chrome"` on the portal root, or hardcoded literals stay.
3. **`/checkout/[tariffSlug]` — is it truly out-of-scope?** It's a logged-in surface in many flows. Product may want it aligned with the SaaS palette eventually. v1.0 says NO (keep marketing palette); revisit when checkout gets its own SAAS-CHECKOUT epic.
4. **Forced-colors / high-contrast mode.** The CSS-custom-property foundation does not interact with `forced-colors: active` (the browser overrides regardless). No mitigation needed; design-system §11 covers this in primitive layer.
5. **SSR + hydration mismatch risk.** `.saas-chrome` is a static className, no JS branching, no hydration risk. (`AuthShell` is a server component; `app/admin/(gated)/layout.tsx` is a server component with embedded client islands.)
6. **The `--bg` redefine.** Should we leave `--bg` ONLY in `:root` and add `--bg-saas: #0B0B0D` to avoid the redeclare? Design-system §3 names it `--bg` deliberately — a separate name would break the spec. Keep the redeclare; flag for paranoia.

---

## 10. Out of scope

- **Re-themeing `/pay`, `/checkout/[tariffSlug]`** — these keep the current marketing palette.
- **Re-themeing marketing landing `/`** — design-system §1 explicit non-goal.
- **Re-themeing `/offer`, `/privacy`, `/consent/personal-data`** — legal-page palette stays.
- **Touching ANY of the 27 `var(--accent...)` call-sites** to remove fallbacks — separate ticket (SAAS-1-FOLLOWUP-FALLBACK-CLEANUP).
- **Adding the SAAS-6 primitive layer** (`lib/ui/primitives/`) — that's Phase 1 of the design-system epic, separate epic.
- **Light-mode palette** — design-system §1 explicit non-goal; v1.0 is dark-only.
- **Tailwind config rewrite** — design-system §1 explicit out-of-scope.

---

## 11. Files touched (single PR, ≈ +130 LoC CSS + 2 className edits + doc-sweep)

- `app/globals.css` (+130 inside new `.saas-chrome` block, after line 14).
- `app/admin/(gated)/layout.tsx` (+1 — `className="saas-chrome"` on outer `<div>` `:46`).
- `components/auth-shell.tsx` (+1 — merge `saas-chrome` into the `<main>` className `:13`).
- `docs/design-system.md` (+1 status line).
- `docs/plans/calendar-apple-redesign.md` (~5 lines — replace inline §5.A spec with cross-reference).
- `ARCHITECTURE.md` if it has a Design-System / Styling section (+3, conditional).

Estimated total: ≤ 150 LoC delta. Falls under the "one PR" threshold.

---

## 12. Invariants

1. Tokens defined inside `.saas-chrome { ... }` MUST NOT leak to `/pay`, `/checkout/*`, `/offer`, `/privacy`, `/consent/*`, or marketing landing `/`.
2. The 4 existing `:root` tokens (`--bg`, `--surface`, `--border`, `--text`, `--secondary`, `--accent-start`, `--accent-end`, `--accent-gradient`) stay in `:root` unchanged.
3. `.saas-chrome` attach points: admin outer `<div>` (`app/admin/(gated)/layout.tsx:46`), auth `<main>` (`components/auth-shell.tsx:13`), and any cabinet sub-route not transitively covered by `AuthShell` (per §9 question #1).
4. Token names match `docs/design-system.md` §2 enumeration verbatim — single source of truth.
5. Marketing-tier classes (`.btn-primary`, `.section-label`, `.tag`, `.stat-number`, `.gradient-text`, `.gradient-border`, `.glow`) consume `:root` gradient vars only — untouched by this sub-PR.

---

Paranoia note: foundation-level, additive, CSS-only. No runtime, no data layer, no API surface. Three edits are independently verifiable via DOM inspector + screenshot review. Single PR ≤ 150 LoC; revert-safe.
