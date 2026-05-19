# SAAS-6-A11Y-1 — Skip-to-content link

Status: plan-doc (capture-only). Foundation work for the SAAS-6 design
rollout. Single PR. WCAG 2.4.1 Level A compliance.

## 1. Goal

Add a "skip-to-content" link to every page shell so keyboard /
screen-reader users can bypass the header + (admin) sidebar and jump
straight to the page's main content. Today neither `AuthShell` nor any
surface mounting `<SiteHeader>` directly carries one;
`docs/design-system.md` §11 explicitly mandates it on every shell.

WCAG 2.4.1 (Bypass Blocks), Level A — single-criterion compliance. This
plan does NOT attempt a broader WCAG 2.1 AA audit (see §10).

## 1.1 Existing surface inventory

The current chrome story has three shell variants. None has a skip
link; only some have a `<main>` element at all.

- **`AuthShell`** (`components/auth-shell.tsx:9-27`) — wraps
  `<SiteHeader />` + a `<main className="auth-shell-main">`. Used by
  `/login`, `/register`, `/forgot`, `/reset`, `/verify-pending`,
  `/verify-failed`, and the cabinet pages under `/cabinet/`,
  `/cabinet/book`, `/cabinet/book/[ymd]`, `/cabinet/profile`,
  `/cabinet/settings/calendar` (confirmed via grep
  `AuthShell|<main` on `app/cabinet`).
- **Admin (gated) layout** (`app/admin/(gated)/layout.tsx:43-105`) —
  mounts `<SiteHeader />` + an aside-nav + `<main style={…}>`. Wraps
  every `/admin/*` route inside `(gated)`.
- **Teacher layout** (`app/teacher/layout.tsx:58-71`) — mounts
  `<SiteHeader />` + a single `<main>`. Wraps `/teacher/*`.
- **Marketing landing** — `app/page.tsx:13` renders
  `<HomePageClient />` which carries its own `<header>` at
  `components/home/home-page-client.tsx:129` and a single `<main>` at
  `:1090`. It does NOT use `SiteHeader`.
- **Payment-stage pages.** `/pay` (`app/pay/page.tsx`) and
  `/checkout/[tariffSlug]` (`app/checkout/[tariffSlug]/page.tsx`) have
  their own bespoke chrome (no `SiteHeader`); their `<main>` lives
  inline in the page component.
- **Cabinet packages** (`app/cabinet/packages/page.tsx:61`) renders
  `<main>` directly without `AuthShell` — this is an outlier worth
  reconciling but out of scope here (we still give it `id`).
- **Legal viewer** (`app/legal/v/[id]/page.tsx`) — own `<main>`.
- **Not-found / admin-login** (`app/not-found.tsx`,
  `app/admin/login/page.tsx`) — bespoke layouts; out-of-scope for the
  shell-level requirement but cheap to include.
- **Root layout** (`app/layout.tsx:30-63`) — only emits `<html>` /
  `<body>`. No shell logic; not where the skip link lives.

Design-system reference (`docs/design-system.md:536-540`):
> Skip-to-content link at top of every shell, visually hidden until
> focused.

## 2. Design

### 2.1 Markup pattern

Each shell renders, **as the very first focusable element inside
`<body>`**, an anchor like:

```tsx
<a href="#main-content" className="skip-to-content">
  Перейти к основному содержимому
</a>
```

- The link is the first DOM node inside the shell fragment, BEFORE
  `<SiteHeader />` (or whatever header equivalent the shell uses), so
  the very first Tab press on a fresh page focuses it.
- The target `<main>` element on every shell carries
  `id="main-content"` and is implicitly focusable via the anchor jump.
  We also set `tabIndex={-1}` on `<main>` so programmatic focus lands
  cleanly when activated (Safari quirk; harmless elsewhere).
- Copy is Russian, matches `docs/content-style.md` operator-friendly
  voice. ("Перейти к основному содержимому" — standard a11y phrasing
  in Russian-language sites.)

### 2.2 CSS — standard "sr-only-then-focusable" pattern

Lives in `app/globals.css` as a single utility class. The link is
visually hidden by default and pops into view on `:focus` /
`:focus-visible`. Visual style matches the design-system focus ring
(§11) — solid `--accent` background, white text, 4px outline.

```css
.skip-to-content {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 100; /* above SiteHeader's z-40 */
  padding: 12px 16px;
  background: var(--accent);
  color: #fff;
  font-weight: 500;
  text-decoration: none;
  border-radius: 0 0 8px 0;
  transform: translateY(-110%);
  transition: transform 120ms ease-out;
}

.skip-to-content:focus,
.skip-to-content:focus-visible {
  transform: translateY(0);
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

@media (prefers-reduced-motion: reduce) {
  .skip-to-content { transition: none; }
}
```

Visual diff on non-focus states: zero. On focus: a single banner
appears top-left of viewport.

### 2.3 Per-route considerations

Every shell that mounts a header gets the link as its first child, and
its `<main>` gets `id="main-content"` + `tabIndex={-1}`.

- **`AuthShell`** (covers `/login`, `/register`, `/forgot`, `/reset`,
  `/verify-pending`, `/verify-failed`, most of `/cabinet/*`). One edit
  in `components/auth-shell.tsx` covers all listed routes.
- **Admin `(gated)/layout.tsx`** — link + `id` on the existing
  `<main>` (line 101).
- **Teacher `layout.tsx`** — link + `id` on the existing `<main>`
  (line 61).
- **Marketing landing (`components/home/home-page-client.tsx`)** —
  insert skip link as first child of the top-level fragment (before
  the `<header>` at line 129) + `id="main-content"` on the existing
  `<main>` (line 1090). SiteHeader is NOT mounted here, so the shell
  edit is local to `home-page-client.tsx`.
- **`/pay`, `/checkout/[tariffSlug]`** — each has its own inline
  chrome. Add the skip link + `id` on their `<main>`. Pattern is
  cheap; checkout is a high-traffic surface for keyboard users (form
  submission), so including it is the right call.
- **`/cabinet/packages`** — has a bare `<main>` outside `AuthShell`.
  Add `id` + a local skip-link wrapper for consistency. Reconciling
  this with `AuthShell` is out of scope.
- **Legal viewer (`app/legal/v/[id]`)** — touch lightly: `id` on
  `<main>` + skip link.
- **`/not-found`, `/admin/login`** — out of scope for SAAS-6-A11Y-1.
  Listed in §10.

Notable non-impact:
- **Root `app/layout.tsx`** — untouched. The skip link is per-shell,
  not root, because the marketing landing's chrome is bespoke and the
  link must sit *inside* the shell to be the first focusable element
  before the shell's own header.

## 3. Tests

**Hard dependency: SAAS-INFRA-1 (RTL + jsdom).** If that infra is not
ready by the time this PR is picked up, the tests are skipped and we
ship with manual verification only (documented in the PR body).

If infra is ready, add a single integration test per shell variant
under `tests/integration/a11y/skip-to-content/`:

1. Render the shell (AuthShell, admin layout, teacher layout, home
   page, /pay, /checkout).
2. `user.tab()` → assert the focused element has class
   `skip-to-content` and href `#main-content`.
3. `user.keyboard('{Enter}')` → assert `document.activeElement` is the
   `<main id="main-content">` node (or `id`-targeted via
   `getElementById('main-content')`).

Manual verification regardless of test infra:
- Keyboard: cold-load each shell, press Tab once, verify the link
  appears top-left, press Enter, verify focus moves past header into
  the main content (visible by next Tab landing on the first
  interactive element in main).
- Screen reader spot-check (VoiceOver / NVDA) on `/login` and
  `/admin/(gated)` after merge.

## 4. Rollout

Single PR. No feature flag (the link is purely additive — invisible
by default; no behaviour change for non-keyboard users). Standard
preview-→-merge flow.

## 5. Decomposition

**Single PR.** Atomic change:

1. Add `.skip-to-content` CSS to `app/globals.css`.
2. Edit `components/auth-shell.tsx` — prepend link, set `id` +
   `tabIndex={-1}` on `<main>`.
3. Edit `app/admin/(gated)/layout.tsx` — same.
4. Edit `app/teacher/layout.tsx` — same.
5. Edit `components/home/home-page-client.tsx` — prepend link, set
   `id` on `<main>`.
6. Edit `app/pay/page.tsx` + `app/checkout/[tariffSlug]/page.tsx` —
   same.
7. Edit `app/cabinet/packages/page.tsx` + `app/legal/v/[id]/page.tsx`
   — local skip link + `id`.
8. Add integration tests under `tests/integration/a11y/skip-to-content/`
   if SAAS-INFRA-1 is in place; otherwise add a TODO trailer in the
   PR body.

Small enough to land in one review pass. No epic split required.

## 6. Risks

- **Focus-order regression in modal contexts.** Modals on `/cabinet`
  and `/admin` set their own focus traps. The skip link lives outside
  any modal, so a Tab during a modal-open state should NOT escape the
  modal. Verify by manual test: open the booking modal, press Tab,
  ensure focus does not reach the skip link.
- **Z-index conflict with `<SiteHeader>`** — SiteHeader uses
  `z-index: 40` (`components/site-header.tsx:58`). We set
  `z-index: 100` on the focused skip link to ensure it paints above
  the sticky header.
- **`tabIndex={-1}` on `<main>` regression risk** — adds a focusable
  surface but only programmatically (negative tabindex is skipped by
  Tab). No visible side-effect; Safari-quirk fix only.
- **Marketing landing footprint** — `home-page-client.tsx` is a large
  client component; an edit at the top of the JSX tree is mechanically
  safe but worth a careful diff pass.
- **Style override leak.** `.skip-to-content` is a generic class name.
  Globals.css owns it; no component-scoped clash (verified via grep —
  no existing `skip-to-content` definition).

## 7. Acceptance criteria

- [ ] Cold-load `/`, `/login`, `/cabinet`, `/admin`, `/teacher`,
  `/pay`, `/checkout/lesson-60min` — first Tab press surfaces the skip
  link top-left.
- [ ] Enter on the skip link moves focus to `<main id="main-content">`
  on every shell.
- [ ] Visual diff for non-keyboard / non-focused state: pixel-identical
  to today.
- [ ] No new console warnings (a11y or otherwise) on any covered
  shell.
- [ ] Lighthouse a11y score on `/` does not regress (should improve by
  +1 to +3 points for the bypass-blocks audit).

## 8. Observability

None required. Skip-link activation is a client-side keyboard event;
no metric worth wiring. If we ever want to measure adoption, we'd
listen for `focus` on `.skip-to-content` and post once per session —
out of scope.

## 9. Documentation

No new doc file. `docs/design-system.md` §11 already mandates the
pattern; this PR makes the codebase match the doc. Possible follow-up:
add a one-line note in `docs/design-system.md` §11 saying "Implemented
across all shells in SAAS-6-A11Y-1 (PR #TBD)."

## 10. Out of scope

- Full WCAG 2.1 Level AA audit (contrast pairs not in the §3 matrix,
  ARIA-label coverage, heading-order sweep, form-error association).
- Per-modal focus traps and their first/last focusable-element
  cycling.
- `prefers-reduced-motion` audit beyond the one rule added to the
  skip link.
- Skip-link presence on `/not-found` and `/admin/login` (bespoke
  layouts; cheap follow-up).
- Reconciling `/cabinet/packages` outlier (bare `<main>` not wrapped
  in `AuthShell`).
- Tab-order audit of `home-page-client.tsx` interior content.

## 11. References

- `docs/design-system.md` §11 Accessibility (lines 516-549).
- `components/auth-shell.tsx:9-27`.
- `app/admin/(gated)/layout.tsx:43-105`.
- `app/teacher/layout.tsx:58-71`.
- `components/home/home-page-client.tsx:129,1090`.
- `components/site-header.tsx:58` (z-index).
- `ENGINEERING_BACKLOG.md:140` — backlog entry.
- WCAG 2.4.1 Bypass Blocks (Level A):
  https://www.w3.org/WAI/WCAG21/Understanding/bypass-blocks.html
