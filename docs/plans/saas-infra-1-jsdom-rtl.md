# SAAS-INFRA-1 — Add jsdom + React Testing Library to vitest unit suite

**Status:** SHIPPED 2026-05-19 — PR #346 merged (`6d3bc81`) + follow-up `engines.node` bump in PR #360 (`815c341`). `jsdom` + `@testing-library/react` + `@testing-library/jest-dom` added to vitest unit suite; `tests/setup-rtl.ts` wired via `vitest.config.ts`. Unblocked SAAS-1 `SlotBlock` palette-class render coverage + cabinet-profile Server Component render coverage + future SaaS-tier component coverage.
**Wave name:** SAAS-INFRA-1 (infra-only; ships standalone, no functional code change).
**Trigger:** Per backlog — "Today `vitest.config.ts` is `environment: 'node'` and `package.json` carries no RTL/jsdom dep; pure-function tests are the only currently-supported shape. Blocking: SlotBlock palette-class component render coverage (deferred from SAAS-1), cabinet-profile-page Server Component render coverage (deferred from SAAS-5)."

Plan-doc shape mirrors `docs/plans/saas-1-5a-token-scoping.md`. All file:line refs verified on `main` 2026-05-18 (HEAD `59a537d`).

---

## 1. Goal

Add `jsdom` + `@testing-library/react` (+ `@testing-library/jest-dom` for matchers) to the vitest unit suite so React component-render assertions can land. Unblocks:

- **SAAS-1 follow-up.** `SlotBlock` palette-class render tests (`components/calendar/SlotBlock.tsx:42-44` — `className=` composed from `calendar-slot-block calendar-slot-${kind}` plus optional ` calendar-slot-conflict`). Today `tests/calendar/palette.test.ts` pins `paletteForKind` / `paletteForRow` pure functions (`tests/calendar/palette.test.ts:14-83`) but the actual className composition + the kind→class wiring is untested.
- **SAAS-5 follow-up.** `app/cabinet/profile/page.tsx` Server Component render tests (currently uncovered at the render level — see `app/cabinet/profile/page.tsx:32-40` for the redirect-on-no-session path that has only an integration test).
- **Future SaaS-tier component coverage** (SAAS-6 primitives, any cabinet/admin chrome rework) without contortions.

Non-goal: porting the existing 745+ pure-function tests off `environment: 'node'` (they don't need DOM).

### 1.1 Existing surface inventory

Per COMPANY.md "Survey-before-plan". Cited against `main` 2026-05-18.

**`vitest.config.ts` current state** (`vitest.config.ts:1-45`):

| Setting | Value | Line |
|---|---|---|
| `environment` | `'node'` | `:8` |
| `include` | `['tests/**/*.test.ts']` (note: no `.tsx`) | `:9` |
| `exclude` | `['tests/integration/**', 'node_modules/**']` | `:10` |
| `setupFiles` | `['tests/setup-env.ts']` (env-vars only, see `tests/setup-env.ts:1-25`) | `:11` |
| `coverage.provider` | `'v8'` | `:13` |
| `coverage.thresholds` | lines 85 / functions 95 / branches 80 / statements 85 | `:37-42` |
| `resolve.tsconfigPaths` | `true` (so `@/*` works in tests) | `:5` |

**`package.json` current devDependencies** (`package.json:35-46`) — relevant subset:

| Dep | Pinned | Line |
|---|---|---|
| `vitest` | `^4.1.5` | `:45` |
| `@vitest/coverage-v8` | `^4.1.5` | `:40` |
| `@types/react` | `^18` | `:38` |
| `@types/react-dom` | `^18` | `:39` |
| `typescript` | `^5` | `:44` |
| `react` (prod dep) | `^18` | `:28` |
| `react-dom` (prod dep) | `^18` | `:29` |

**No RTL / jsdom / happy-dom in package.json today.** `grep -E "testing-library|jsdom|happy-dom" package.json package-lock.json` returns only matches in `package-lock.json` (transitive — not declared deps).

**No `.tsx` test files exist today.** `find tests -name "*.tsx"` returns empty. The `tests/**/*.test.ts` glob in `vitest.config.ts:9` also wouldn't pick them up if they did.

**`tsconfig.json` JSX setup** (`tsconfig.json:19`) — `"jsx": "react-jsx"`. Vitest's esbuild transform consumes this automatically; `.tsx` test files would compile without extra config.

**Existing palette-test surface (the SAAS-1 follow-up target).** `tests/calendar/palette.test.ts:1-83` covers `paletteForKind` (6 kinds × non-empty-palette assertions, plus 4 specific-family pins) and `paletteForRow` (conflict overlay matrix). What it does **not** cover: the actual DOM className the component emits at render time, and the conflict-glyph render path at `components/calendar/SlotBlock.tsx:80-92`.

### 1.2 Disposition of existing surface

Per Survey-before-plan, every existing-surface match needs an explicit disposition:

| Surface | Disposition | Rationale |
|---|---|---|
| `vitest.config.ts` `environment: 'node'` | **extend (no replace)** | Keep `node` as the default; opt-in jsdom per-file via `// @vitest-environment jsdom` directive. See §2.2 design choice. |
| `vitest.config.ts` `include: ['tests/**/*.test.ts']` | **extend** | Widen to `['tests/**/*.test.{ts,tsx}']` so `.test.tsx` files are picked up. |
| `tests/setup-env.ts` | **leave as-is** | Env-var setup is environment-agnostic; jsdom-env tests need it too. |
| `tests/calendar/palette.test.ts` (pure-function) | **leave as-is** | Pure-function coverage stays; render coverage lands in a separate file (`palette-render.test.tsx`) as a downstream PR (see §5). |
| Coverage `include` list (`vitest.config.ts:18-31`) | **leave as-is for this PR** | Component files (`components/calendar/SlotBlock.tsx`, `app/cabinet/profile/page.tsx`) are added to the `include` list in the downstream coverage-PRs, not here. SAAS-INFRA-1 ships zero test code beyond the smoke sample. |

---

## 2. Design

### 2.1 New devDependencies

Pin to versions known compatible with React 18 + vitest 4:

| Package | Version | Rationale |
|---|---|---|
| `@testing-library/react` | `^16.3.2` | Latest as of 2026-05-18. Peers: `react ^18 || ^19`, `@types/react ^18 || ^19`, `@testing-library/dom ^10`. Matches our React 18. |
| `@testing-library/dom` | `^10.4.1` | RTL peer — must be declared explicitly per RTL docs (not bundled transitively). |
| `@testing-library/jest-dom` | `^6.9.1` | Provides `toBeInTheDocument` / `toHaveClass` / etc. matchers. Works with vitest's expect via `expect.extend(matchers)` in a setup file. |
| `jsdom` | `^29.1.1` | DOM impl. Vitest 4 includes a built-in `jsdom` env that auto-detects when this package is present. |

These are **devDependencies only** — zero impact on production bundle / `next build`.

### 2.2 Per-file jsdom opt-in (NOT global)

Two options considered:

**Option A — global `environment: 'jsdom'`.** Switch `vitest.config.ts:8` from `'node'` to `'jsdom'`. Every test (including 745+ existing node-env unit tests) runs in jsdom.

**Option B — per-file `// @vitest-environment jsdom` directive (CHOSEN).** Keep `environment: 'node'` global default. Add the directive at the top of each component-render `.test.tsx`. Vitest reads the directive comment and spins up jsdom only for that file.

**Justification for Option B.**

1. **Migration safety.** 745+ existing node-env tests don't need DOM and were authored against `node` semantics. Switching them all to jsdom risks: (a) subtle Buffer / Node-only global shadowing, (b) `crypto.subtle` resolving to jsdom's web-crypto shim instead of node:crypto in payment/auth test paths (see `lib/auth/tokens.ts`, `lib/payments/cloudpayments-webhook.ts` — both in coverage `include` at `vitest.config.ts:20-22`).
2. **Performance.** jsdom env adds ~100-200ms startup per worker. Per-file opt-in pays the cost only on component tests.
3. **Reversibility.** If we later decide global jsdom is fine, the per-file directives are no-ops and can be stripped in one find-replace. Going the other direction (global jsdom → per-file node) is harder because failures are subtle.

**Trade-off (acknowledged).** Per-file directives are slightly more verbose. Mitigation: lint via a short `tests/README.md` snippet (out of scope for this PR; rolls into SAAS-INFRA-1 follow-up if friction emerges).

### 2.3 Config changes (this PR only)

`vitest.config.ts` diff (minimal — three lines changed):

```diff
   test: {
     environment: 'node',
-    include: ['tests/**/*.test.ts'],
+    include: ['tests/**/*.test.{ts,tsx}'],
     exclude: ['tests/integration/**', 'node_modules/**'],
-    setupFiles: ['tests/setup-env.ts'],
+    setupFiles: ['tests/setup-env.ts', 'tests/setup-rtl.ts'],
```

New file `tests/setup-rtl.ts` — registers `@testing-library/jest-dom` matchers + auto-cleanup between tests:

```ts
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { expect } from 'vitest'

expect.extend(matchers)
afterEach(() => {
  cleanup()
})
```

Note: this setup file is loaded for ALL test files (including node-env ones), but `cleanup()` and the matchers are no-ops outside a DOM context — they only activate when a test actually calls `render()`. Safe across both environments.

### 2.4 Sample smoke test (ships in this PR)

Single render-smoke test added to validate the toolchain end-to-end. Lives at `tests/_smoke/jsdom-smoke.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('jsdom + RTL smoke', () => {
  it('renders a button and finds it by role', () => {
    render(<button type="button">Hello</button>)
    expect(screen.getByRole('button', { name: 'Hello' })).toBeInTheDocument()
  })
})
```

This proves: (a) `.tsx` glob picks up the file, (b) `@vitest-environment jsdom` directive activates jsdom, (c) RTL `render` works, (d) `toBeInTheDocument` matcher loaded from `setup-rtl.ts`.

**Out of this PR:** real `SlotBlock` render test, real `CabinetProfilePage` render test. Those are downstream coverage-PRs (see §5).

### 2.5 Reference shape for the downstream SlotBlock render PR

Documented here so the downstream PR has an explicit target. Sketch only — not committed in this PR:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SlotBlock } from '@/components/calendar/SlotBlock'

// makeFixtureRow lives in tests/calendar/_fixtures.ts (added in the
// downstream PR, not here) — returns a fully-typed CalendarRow.
import { makeFixtureRow } from './_fixtures'

describe('SlotBlock palette class', () => {
  it('renders calendar-slot-booked-self for booked-self kind', () => {
    const row = makeFixtureRow({ kind: 'booked-self' })
    render(<SlotBlock row={row} />)
    const block = screen.getByRole('button', { name: /Занятие/ })
    expect(block.className).toContain('calendar-slot-booked-self')
    expect(block.className).toContain('calendar-slot-block')
    expect(block.className).not.toContain('calendar-slot-conflict')
  })

  it('adds calendar-slot-conflict on hasConflict overlay', () => {
    const row = makeFixtureRow({ kind: 'booked-full', hasConflict: true })
    render(<SlotBlock row={row} />)
    const block = screen.getByRole('button', { name: /конфликт/ })
    expect(block.className).toContain('calendar-slot-conflict')
  })
})
```

### 2.6 Coverage threshold impact

Adding component tests should **increase** measured coverage on whichever component files end up in the coverage `include` list. No threshold change required in this PR — thresholds at `vitest.config.ts:37-42` are floors; going up is fine.

The downstream SlotBlock render PR will add `components/calendar/SlotBlock.tsx` to `vitest.config.ts` coverage `include`; the cabinet-profile render PR will add `app/cabinet/profile/page.tsx`. Both are out of scope here.

---

## 3. Tests (meta — for this infra PR)

The "tests" for this infra change are the test-runner itself:

1. **Smoke test passes.** `npm test -- tests/_smoke/jsdom-smoke.test.tsx` runs green. Proves the directive + RTL + matcher stack works.
2. **Existing 745+ node-env tests still pass unchanged.** `npm test` runs green without behavioral change. Hybrid approach via per-file directive is the safer migration path (Option B in §2.2).
3. **Coverage thresholds still pass.** `npm run test:coverage` runs green. The smoke test runs but its file is NOT in the coverage `include` list (`vitest.config.ts:18-31`), so it doesn't move the needle in any direction.
4. **`npm run build` succeeds.** New devDeps don't bleed into prod bundle (devDependencies-only, no app import).
5. **Typecheck passes.** `tsc --noEmit` on the smoke `.tsx` file proves `@testing-library/react` + `@types/react` resolve correctly.

No new integration test required (this PR is infra-only).

---

## 4. Rollout

Single PR. No flag. No migration. Drops in alongside existing tests.

**Verification on PR.** CI runs `npm test` + `npm run build` + `npm run test:coverage` (existing pipeline — see `scripts/test-integration.sh` for the integration variant; unit pipeline is just `vitest run`). All three must stay green.

---

## 5. Decomposition

**One PR for the infra (this plan).** Downstream coverage-PRs ship separately as follow-ups, each with its own self-review trailer per the SUB-WAVE protocol:

| # | PR | Owner doc | Scope |
|---|---|---|---|
| 1 (this) | SAAS-INFRA-1 — jsdom + RTL added | this doc | Add devDeps, add `tests/setup-rtl.ts`, widen `include` glob, single smoke test. |
| 2 (follow-up) | SAAS-1 — SlotBlock palette-class render coverage | future plan-doc | `tests/calendar/palette-render.test.tsx` + fixture helper. Add `components/calendar/SlotBlock.tsx` to coverage `include`. |
| 3 (follow-up) | SAAS-5 — cabinet-profile-page render coverage | future plan-doc | `tests/cabinet/profile-page.test.tsx`. Add `app/cabinet/profile/page.tsx` to coverage `include`. Server Component → needs RSC-aware render (likely via `await CabinetProfilePage()` + `render(...)` pattern; downstream PR re-validates the exact shape). |

PRs 2 and 3 are independent and can ship in either order. Both are blocked on PR 1 merging.

---

## 6. Risks

| ID | Risk | Mitigation |
|---|---|---|
| **R1** | Version skew between `@testing-library/react@16` and React 18.x — peers say `^18 || ^19` but jest-dom matchers occasionally lag. | Pin exact minor versions in §2.1. Smoke test catches a hard break at PR time. |
| **R2** | vitest 4 transitive jsdom compat. Vitest 4 bundles its own `@vitest/environment-jsdom` adapter but defers to the user-installed `jsdom` for the actual DOM impl. | Pin `jsdom@^29` (latest stable). If vitest 4 ever drops a hard requirement on a specific jsdom major, the smoke test fails immediately and we re-pin. |
| **R3** | ESM transform pitfalls — RTL is ESM-only; vitest's esbuild loader handles this, but `@testing-library/jest-dom/matchers` has both CJS + ESM exports and Node 20 occasionally picks the wrong one. | Use the explicit ESM subpath import (`@testing-library/jest-dom/matchers`, not `@testing-library/jest-dom`). Confirmed working pattern across vitest+React+RTL projects. |
| **R4** | jsdom missing CSS computation — `color-mix()` and `getComputedStyle()` for CSS variables don't resolve in jsdom. SAAS-1 §5.A scoping relies on CSS-variable cascade. | **Out of scope for this PR.** Component render tests assert against `className` strings, not computed colors. Visual-token verification stays in Playwright / live `/design-review` audits (separate epic if ever pursued). Documented as a known constraint: component tests pin DOM shape + class wiring, not computed styles. |
| **R5** | Per-file `// @vitest-environment jsdom` directive drift — devs may forget it on new `.test.tsx` files. | Smoke-test pattern in §2.4 + sample shape in §2.5 set the precedent. Add a one-line note to `tests/README.md` in the downstream PR (or this PR if trivial — TBD during impl, doesn't gate plan SIGN-OFF). |
| **R6** | Server Component render coverage for `app/cabinet/profile/page.tsx` is harder than client-component render. The page is `async function` and reads cookies via `next/headers`. | **Acknowledged but deferred** to follow-up PR #3 in §5. This plan only commits to making the toolchain available; the RSC-render strategy gets its own plan-doc. |
| **R7** | New devDeps add to `npm install` time / `node_modules` size. | Acceptable — RTL + jsdom together add ~30-40MB to `node_modules`. Standard for any React project that ships component tests. |

---

## 7. Telemetry / docs

- **CHANGELOG.md** — entry under "infra/tooling": "Add jsdom + React Testing Library to vitest unit suite for component render assertions."
- **`tests/README.md`** (if exists; otherwise inline at top of `tests/_smoke/jsdom-smoke.test.tsx`) — one paragraph documenting the `// @vitest-environment jsdom` directive pattern.
- No other doc touches — `CLAUDE.md` / `docs/architecture.md` / etc. don't reference vitest internals.

---

## 8. Out of scope

- Real `SlotBlock` render coverage (downstream PR #2 — separate plan).
- Real `CabinetProfilePage` render coverage (downstream PR #3 — separate plan).
- Server Component RSC-render strategy (downstream — PR #3 plan-doc).
- E2E browser tests via Playwright (separate epic if ever pursued; not on backlog today).
- Migration of existing 745+ tests to jsdom (explicitly rejected — see §2.2).
- Visual-regression / computed-style assertions (jsdom can't do `color-mix()`; see R4).
- Coverage threshold ratchet up (no change in this PR — see §2.6).

---

## 9. Open questions for `/codex-paranoia plan`

1. Is per-file `// @vitest-environment jsdom` directive truly safer than global jsdom for our specific mix of crypto / Buffer / Node-only test paths? (See §2.2 + R2.)
2. Is the smoke test in §2.4 sufficient to gate "toolchain works" or should we ship one real component render in this PR (e.g. a trivial `SlotBlock open-kind` smoke) to catch RSC-vs-client-component shape issues earlier?
3. Does `tests/setup-rtl.ts` being loaded globally (even for node-env tests) cause any unwanted side effect when `cleanup()` runs in a non-DOM context? (Expected: no-op. Verified during impl.)

---

## 10. Sign-off

- [ ] `/codex-paranoia plan docs/plans/saas-infra-1-jsdom-rtl.md` — round N/3, SIGN-OFF
- [ ] PR opened, ready for `/codex-paranoia wave` at epic-end (this is a single-PR epic, so epic-end == this PR's diff)
