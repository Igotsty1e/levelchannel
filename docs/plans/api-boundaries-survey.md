# API-BOUNDARIES — Survey + plan-doc (Phase 1)

**Status:** DRAFT — awaiting `/codex-paranoia plan` SIGN-OFF before any implementation PR.
**Owner:** TBD (epic-level work; sub-PR decomposition included).
**Date:** 2026-05-21.
**Phase 1 scope:** survey current state + propose convention + enforcement option + staged migration plan. No code changes in this phase.
**Phase 2 scope (separate epic, after paranoia plan SIGN-OFF):** rolled-out implementation.

## 0. Why this epic exists

The backlog text (`docs/backlog/cross-cutting.md` line 9):

> **API-BOUNDARIES** — Зафиксировать public/private surface между `lib/*` модулями. Каждый `lib/X` экспортирует через `index.ts`; импорт `lib/X/internal/*` или sibling-only файлов из соседнего `lib/Y` запрещён. CI-тест (ts-morph или regex sweep) ловит нарушения. Цель: предотвратить незаметное расширение surface, как было с `internal.ts` уходящим в чужие модули.

The trigger pattern — the slots-split wave (`docs/plans/slots-split.md`) introduced `lib/scheduling/slots/internal.ts` as a sibling-only DB helper module. To keep it sibling-only the team shipped `scripts/check-module-boundaries.mjs` + `.github/workflows/module-boundaries.yml`. That guard is in place but covers a **narrow slice** (Rule 1 = `internal.ts` is sibling-only; Rule 2 = once an `index.ts` exists in a folder, callers from outside the folder must go through it; Rule 3 = nothing required for flat-file modules). This epic generalises Rule 3 — every `lib/X` module gets a proper public surface, after which Rule 2 starts firing for the whole codebase.

## 1. Current state per module

Inventory of `lib/*/` taken 2026-05-21. "Deep imports" = lines outside `lib/X/` that import `from '@/lib/X/<deeper-segment>'` (i.e. would be flagged if `lib/X` had an `index.ts` facade). "Files" = top-level `.ts` files at the module root, sub-dirs counted separately.

| Module | `index.ts`? | Top-level files | Sub-dirs | External deep imports (lines) | Worst-offender file:line example |
|---|---|---|---|---|---|
| `lib/admin` | NO | 5 | — | 27 | `app/admin/(gated)/settings/digest/page.tsx:3` (`@/lib/admin/digest-summary`) |
| `lib/analytics` | NO | 1 | — | 1 | `components/payments/pricing-section.tsx:1` |
| `lib/api` | NO | 3 | — | 102 | `app/api/auth/register/route.ts:1` (`@/lib/api/cron-auth`-style helpers) |
| `lib/audit` | NO | 4 | — | 45 | `lib/audit/payment-events.ts:2` (intra-module, but mirrored across many tests) |
| `lib/auth` | NO | 19 | — | **365** | `app/api/auth/register/route.ts:8` (8 deep imports from one route) |
| `lib/billing` | NO | 8 | `packages/` (has `index.ts`) | 51 | `app/api/admin/packages/[id]/grant/route.ts:3` |
| `lib/calendar` | NO | 21 | `google/` (no `index.ts`) | **168** | `tests/integration/calendar/google-routes.test.ts:4` |
| `lib/copy` | NO | 1 | — | 3 | `lib/notifications/teacher-digest-telegram-template.ts:1` |
| `lib/db` | NO | 2 | — | **158** | spread across 151 files; canonical `@/lib/db/pool` |
| `lib/email` | NO | 5 | `templates/` (no `index.ts`) | 36 | `lib/email/dispatch.ts:8` (intra-module fanout) |
| `lib/learner-telegram-bind` | NO | 2 | — | 1 | `components/cabinet/learner-telegram-binding.tsx:1` |
| `lib/legal` | NO | 3 | — | 22 | `app/api/auth/register/route.ts:2` |
| `lib/notifications` | NO | 1 | — | 1 | `tests/notifications/teacher-digest-telegram-template.test.ts:1` |
| `lib/payments` | NO | 21 | `provider/` (has `index.ts`) | **138** | `app/api/payments/webhooks/cloudpayments/pay/route.ts:7` |
| `lib/pricing` | NO | 1 | — | 8 | `app/admin/(gated)/pricing/page.tsx:1` |
| `lib/scheduling` | NO | 2 | `slots/` (has `index.ts`) | 46 | `app/cabinet/page.tsx:3` (`@/lib/scheduling/slots` — already routed through facade) |
| `lib/security` | NO | 6 | — | **116** | spread; `lib/security/request.ts` + `idempotency.ts` heavily reached |
| `lib/teacher-telegram-bind` | NO | 2 | — | 1 | `components/teacher/teacher-telegram-binding.tsx:1` |
| `lib/telemetry` | NO | 2 | — | 8 | `app/api/payments/route.ts:1` |

**Totals:** 19 modules surveyed, **0 with `index.ts` at the module root**, **3 sub-folders already have a facade `index.ts`** (`lib/scheduling/slots/`, `lib/billing/packages/`, `lib/payments/provider/`) — these are the working proof-of-concept.

### Top 5 worst-offending single-source deep-import sites

Where a SINGLE file pulls many leaf paths from one module (high blast radius if the leaf paths got renamed):

1. `app/api/auth/register/route.ts` — 8 deep imports into `lib/auth/` (`accounts`, `consents`, `teacher-invites`, `dummy-hash`, `email-hash`, `password`, `policy`, `verifications`) — plus separate deep imports into `lib/legal/`, `lib/audit/`, `lib/email/`, `lib/payments/`, `lib/security/`, `lib/api/`. This route alone touches ~7 different modules through ~20+ leaf paths.
2. `app/api/payments/webhooks/cloudpayments/pay/route.ts` — 7 deep imports into `lib/payments/` (`allocations`, `cloudpayments-route`, `cloudpayments-webhook`, `slot-binding`, `store`, `provider` *[already via facade]*, `tokens`).
3. `app/api/teacher/calendar/google/callback/route.ts` — 5 deep imports into `lib/calendar/` including `lib/calendar/google/config|oauth|state` (sub-folder with NO `index.ts` — a candidate facade for the OAuth surface).
4. `app/api/auth/reset-confirm/route.ts` — 5 deep imports into `lib/auth/` (`accounts`, `password`, `policy`, `resets`, `sessions`).
5. `app/api/payments/sbp/create-qr/route.ts` — 6 deep imports into `lib/payments/` (`catalog`, `cloudpayments-api`, `cloudpayments`, `order-account-resolver`, `store`, `provider` *[facade]*).

These five files alone touch ~30 leaf paths and would all simplify dramatically once each module exposes a single `@/lib/X` import via `index.ts`.

### Pre-existing precedent — what already works

- **`lib/scheduling/slots/`** is the canonical example: `internal.ts` (sibling-only DB plumbing) + `index.ts` (public facade re-exporting from `types`, `validation`, `queries`, `lifecycle`, `mutations-write`, `mutations-cancel`, `booking`, `booking-queries`). Ratified by the slots-split wave (`docs/plans/slots-split.md`).
- **`lib/billing/packages/`** — facade re-exports from `catalog`, `purchases`, `debt`, `eligibility`. Explicit comment "API-BOUNDARIES (2026-05-18) — facade exports for eligibility so outside callers don't import `@/lib/billing/packages/eligibility` directly."
- **`lib/payments/provider/`** — facade re-exports from `lifecycle` + `checkout` for `markOrderPaid`, `chargeWithSavedCard`, etc.
- **`scripts/check-module-boundaries.mjs`** — already enforces Rule 1 (`internal.ts` is sibling-only) and Rule 2 (facade-folder discipline once `index.ts` exists). Currently Rule 3 explicitly defers flat-file modules.
- **`.github/workflows/module-boundaries.yml`** — already gates CI on PR + push to `main`. **No new infra needed** — adding `index.ts` files automatically opts the parent module into Rule 2 enforcement.

This is a key finding: **most of the enforcement machinery is shipped**. This epic adds the `index.ts` barrels, then optionally tightens the script (e.g. add Rule 3 — "any sibling file under `lib/X` whose name starts with `_` or lives under `lib/X/internal/` is sibling-only" — to formalise additional private files beyond the bare `internal.ts` convention).

## 2. Proposed convention

### Rule set

| # | Rule | Status |
|---|------|--------|
| R1 | Every `lib/X` module exports through `lib/X/index.ts`. External callers (anything outside `lib/X/`) write `import { ... } from '@/lib/X'` — never `'@/lib/X/<leaf>'`. | NEW (this epic) |
| R2 | Files named `internal.ts`, `*.internal.ts`, or sitting under `lib/X/internal/` are **sibling-only** — importable only from files in the SAME folder. | EXISTING (Rule 1 of guard script) — will be extended to cover `internal/` subdirs. |
| R3 | Sub-folders with their own `index.ts` (e.g. `lib/scheduling/slots/`) follow the same discipline — outside callers must use the sub-folder facade. | EXISTING (Rule 2 of guard script). |
| R4 | Intra-module imports stay free-form (`lib/X/a.ts` may import `from './b'` directly). The barrel is for the **public** surface, not for forcing internal indirection. | NEW (codification of how the existing slots facade already works). |
| R5 | Type-only re-exports use `export type { ... }` so `isolatedModules: true` keeps working — same as the slots facade today. | NEW (codification). |

### Naming conventions

| Pattern | Meaning |
|---------|---------|
| `lib/X/index.ts` | Public surface. Outside callers may import from here. |
| `lib/X/<file>.ts` | Implementation detail; reachable via `lib/X/index.ts` re-export, **not** by external direct import once R1 enforces. |
| `lib/X/internal.ts` | Sibling-only DB / helper plumbing (existing Rule 1). |
| `lib/X/internal/*.ts` (new option) | Bucket variant — when one `internal.ts` outgrows itself, split into `internal/foo.ts`, `internal/bar.ts` (same sibling-only semantics). |
| `lib/X/<sub>/index.ts` | Sub-facade for a logically grouped subset (slots, packages, provider, google-oauth, email-templates). Sub-facade enforcement = Rule 2 of guard, already live. |

### What stays out of scope

- **No `components/`, `app/`, `tests/` rule.** This epic touches `lib/*` only. The app router naturally owns route-handler files, and route handlers are not importable surfaces.
- **No code-mod of public APIs.** R1 is mechanical — collect the leaf exports and re-export them from `index.ts`. Public function names + signatures stay byte-identical.
- **No reshuffle of what's "public" vs "private".** This epic does NOT change what's exposed. If `lib/auth/dummy-hash.ts` currently exports `getDummyHash` and it's used externally, the new `lib/auth/index.ts` re-exports `getDummyHash`. A second epic (out of scope here) can later tighten the surface — that's a behaviour change requiring its own paranoia review.

## 3. Enforcement options

Three options, evaluated for the cases found in the survey above:

### Option A — Extend the existing regex sweep (`scripts/check-module-boundaries.mjs`)

**What it would add.** Today the script defers flat-file modules (Rule 3). Once every `lib/X` has `index.ts`, that comment becomes false: the existing Rule 2 (facade-folder discipline) automatically catches any `from '@/lib/X/<anything>'` written outside `lib/X/`. So the script needs **no logic change** — just the `index.ts` files have to land. Optional small additions:
- Add `internal/` subdir support to Rule 1.
- Add per-module allow-list for grandfathered violations during the ratchet phase (Section 4(c)).

**Pros.** Zero new dependencies; same workflow file already wired into CI; existing maintainers already understand the script; the entire approach has been live since 2026-05-18 (slots wave) without false positives.
**Cons.** Regex `from\s+['"]@\/lib\/([^'"\n]+)['"]/g` does not parse `import type`, namespace imports, or dynamic `import()`. Quick check below shows the codebase uses neither dynamic `import('@/lib/...')` nor TypeScript namespace re-imports — the regex is sufficient. Re-exports (`export ... from '@/lib/X/...'`) ARE matched by the same `from '...'` pattern, so re-exports are also caught.

### Option B — Drop-in ts-morph script

**What it would add.** A `scripts/check-module-boundaries.ts` that parses the AST via `ts-morph`, applies the same rules with import-kind discrimination (type-only vs value), and could optionally check **unused** re-exports in barrels.
**Pros.** AST-grade precision; ergonomic for follow-up rules (e.g. "no circular module imports", "no `default` export from a barrel").
**Cons.** Adds `ts-morph` (~5MB) as a build-CI dep; doubles run time vs regex; introduces a TypeScript-typecheck dependency in CI (currently the boundaries job runs a plain `.mjs` with zero install); 5× more code than the regex. For the **specific cases observed** (no edge-case kinds in the survey), ts-morph buys nothing material.

### Option C — ESLint plugin (`eslint-plugin-boundaries`, `eslint-plugin-import`)

**What it would add.** A lint-time rule (`no-restricted-imports` patterns or a dedicated boundaries plugin) baked into `npm run lint`.
**Pros.** Editor-time feedback (the violation lights up in VS Code before commit); single config surface alongside other lint rules; mature plugin ecosystem.
**Cons.** Requires that the repo run ESLint on every PR (current CI uses Next's build-time check + the standalone boundaries script — full ESLint is not the primary gate). Plugin config grows complex once `internal.ts`/`internal/` sibling-only is layered on top of the barrel rule — the existing script already encodes this in ~130 lines of clear JavaScript. Introducing it would compete with the script rather than replacing it.

### Recommendation

**Option A — extend the existing regex sweep.** Two reasons:
1. **It already works.** Half the rule set ships and runs on CI today. The deficiency is the missing `index.ts` files, not the enforcement mechanism.
2. **Smallest delta-to-protection.** Once each module gets a `lib/X/index.ts`, Rule 2 of the existing script automatically protects the whole codebase with zero new dependencies and zero new CI workflows.

ts-morph and ESLint remain on the table for a follow-up epic if a future rule (circular-import detection, automated dead-export pruning) makes regex inadequate.

## 4. Migration plan

Staged, designed so each stage merges as an independent sub-PR with self-review. Codex-paranoia runs **once on this plan upfront** + **once on the epic-end wave** per the global paranoia contract.

Estimated decomposition: **6 sub-PRs**. Adjust during paranoia plan review if needed.

### Stage A — Foundation: low-risk barrels first (sub-PR #1)

Add `index.ts` to **5 trivial modules** with ≤ 8 deep imports each. These are mechanical no-risk barrels and prove the pattern end-to-end before tackling the big modules.

Target list (sorted by deep-import count, ascending):
- `lib/notifications/` (1 import)
- `lib/analytics/` (1 import)
- `lib/learner-telegram-bind/` (1 import)
- `lib/teacher-telegram-bind/` (1 import)
- `lib/copy/` (3 imports)
- `lib/telemetry/` (8 imports)
- `lib/pricing/` (8 imports)

Per module:
1. Create `index.ts` re-exporting every value + type used outside the module.
2. Rewrite the (1–8) external import sites to `from '@/lib/X'`.
3. CI's existing module-boundaries check now actively enforces the facade for that module.

### Stage B — Mid-tier modules (sub-PR #2)

Same mechanical pattern for: `lib/legal/` (22), `lib/admin/` (27), `lib/email/` (36), `lib/audit/` (45), `lib/billing/` (51) — adding the **module-level** `index.ts` (the `packages/` sub-facade keeps working unchanged).

For `lib/email/`, also add `lib/email/templates/index.ts` to factor out the 8-fanout in `lib/email/dispatch.ts` (which is intra-module so will continue to work either way, but a sub-facade makes the surface cleaner).

### Stage C — High-traffic modules — auth/scheduling/payments/calendar (sub-PR #3, #4, #5, #6)

One sub-PR per module to keep diff size reviewable and rollback granular. Each stage:
1. Audit `lib/X/`: identify which leaf functions are imported externally (use the survey output above as the starting set).
2. Author `lib/X/index.ts` re-exporting that set. Re-exports use `export type { ... }` for types and `export { ... } from './leaf'` for values.
3. Re-write external import sites in `app/`, `tests/`, `components/`, and **other `lib/Y/` modules** to use `from '@/lib/X'`.
4. Confirm `npm run build` + `npm run test:integration` + `npm run typecheck` pass.
5. Confirm `node scripts/check-module-boundaries.mjs` passes — Rule 2 will now fire for X.
6. Self-review under `Codex-Paranoia: SUB-WAVE self-reviewed (epic api-boundaries); epic-end review pending`.

Order (by external-deep-import count, descending — finishing on the biggest):
- (C-1) `lib/calendar/` — 168 deep imports across 78 files. Includes a candidate `lib/calendar/google/index.ts` sub-facade for the 5 google/* files (matches the surveyed callback-route fan-in).
- (C-2) `lib/security/` — 116 deep imports across 100 files. Surface includes `request.ts`, `idempotency.ts`, `rate-limit.ts`, `account-rate-limit.ts`, etc.
- (C-3) `lib/db/` — 158 deep imports across 151 files. Tiny module (2 files: `pool.ts` + `errors.ts`) — the barrel is trivial; the churn is in rewriting 151 call sites. Acceptable because it's purely mechanical.
- (C-4) `lib/auth/` (365 import lines across 222 files) + `lib/payments/` (138 import lines across 73 files) + `lib/api/` (102 import lines across 77 files) — biggest churn modules; reserve last when the team has confidence in the migration recipe.

Per the principle "every sub-PR ships under self-review; one epic-end paranoia run on the merged diff", sub-PR #3..#6 share the same lifecycle trailer; the final close-PR of stage C carries `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`.

### Stage D — Tighten the guard (optional, only if needed) (sub-PR #7)

After A+B+C land, every `lib/X/` has `index.ts` and the existing `scripts/check-module-boundaries.mjs` Rule 2 covers everything. Optional follow-up:
- Update the script's comment block (Rule 3) from "no rule for flat `lib/X/foo.ts`" → "implicitly covered by Rule 2 since every lib/X now has index.ts".
- Add explicit `internal/` subdir support to Rule 1.
- Add an allow-list mechanism if any grandfathered violations need temporary exemption.

**Decision deferred to paranoia-plan:** whether Stage D is part of this epic or a tiny follow-up.

## 5. Risks

### R1 — Massive churn (mitigation: per-module sub-PRs, no behaviour change)

`lib/auth/` alone has 365 import lines to rewrite across 222 files. Each module is a contained sub-PR; the rewrite is mechanical (`@/lib/X/leaf` → `@/lib/X`). All imports stay value-compatible because `index.ts` re-exports the same identifiers. Risk = pure merge-conflict surface area against in-flight PRs that touch the same files.

**Mitigation:**
- Plan-doc paranoia BEFORE work starts (this epic).
- Sub-PRs land back-to-back, oldest first, to limit drift.
- Drag the rewrite through `npm run build` + `tsc --noEmit` + integration tests in EACH sub-PR; if green, the rewrite is mechanically safe.
- Avoid landing this epic during a high-velocity feature wave (e.g. BCS-DEF-* still has active sub-tracks per `docs/backlog/bcs-wave.md`). Coordinate slot.

### R2 — Barrel files cause tree-shaking regressions

Next.js 16's Turbopack does dead-code elimination across `export ... from './leaf'` re-exports, but a poorly-written barrel can pull entire submodules into the client bundle.

**Mitigation:**
- Re-exports use named exports (`export { foo } from './leaf'`) — Turbopack treats these as side-effect-free imports.
- Spot-check the `lib/auth/index.ts` bundle on at least one page that imports from `lib/auth` to confirm the bundle does not regress materially. The `npm run build` output (chunks + sizes) is a hard signal.

### R3 — Type-only exports leak runtime imports (mitigation: `export type`)

`isolatedModules: true` requires `export type { X }` for type-only re-exports. The slots facade today already does this correctly — replicate the pattern verbatim.

### R4 — Should we enforce on existing code or only new code?

**Decision (in this plan, subject to paranoia review):** enforce on existing code. Rationale:
- The current `scripts/check-module-boundaries.mjs` already enforces Rule 1 + 2 on existing code with no allow-list.
- The whole point of the epic is to lock down `lib/*` surface; an opt-in mode would leak the surface forever.
- Stage A+B+C migrate ALL existing call sites; after they land, the no-allow-list policy is trivially correct.

**Reject:** "only new code" — it would require an allow-list of every current violation, which is harder than just rewriting the call sites.

### R5 — Conflict with the in-flight DOC-MODULE-CONTRACTS epic (mitigation: coordinate ordering)

`docs/backlog/cross-cutting.md` also lists `DOC-MODULE-CONTRACTS` — extract per-module READMEs. That epic doesn't touch `.ts` files; this one doesn't touch READMEs. They're orthogonal but both edit `lib/*/`. Coordinate so the two don't land in the same week.

### R6 — `internal.ts` rename risk

A future module-author might rename `internal.ts` → `private.ts` thinking it's a stylistic choice. The guard's Rule 1 matches by literal filename. **Mitigation:** documented in `lib/scheduling/README.md` line 29 and in the script comment block; new module READMEs (from DOC-MODULE-CONTRACTS) reinforce.

### R7 — False sense of security

R1 ensures imports go through `@/lib/X` — it does NOT ensure those exports are correct, secure, or audited. The two-checkpoint paranoia pipeline still applies for behaviour-changing PRs. This epic is purely structural.

## 6. Decisions captured (for paranoia plan review)

1. **Enforcement option:** Option A (extend existing regex sweep). No new dep.
2. **Enforce on existing code:** YES. No grandfathered allow-list.
3. **Sub-PR decomposition:** 6 sub-PRs (Stage A, B, C-1..C-4). Optional Stage D as +1 if guard tightening is needed.
4. **`internal/` subdir support:** add to Rule 1 of the script in Stage D (or earlier if any module needs it during Stage C).
5. **Coordination:** sequence after DOC-MODULE-CONTRACTS or after a clear week from BCS-DEF-* activity. Choose at paranoia-plan time.
6. **Final paranoia trailer pattern:**
   - Sub-PRs #1..#6: `Codex-Paranoia: SUB-WAVE self-reviewed (epic api-boundaries); epic-end review pending`.
   - Epic-close PR (#7 if Stage D ships, otherwise the last C sub-PR): `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`.

## 7. Open questions for `/codex-paranoia plan`

1. Is Option A truly sufficient, or do we want ts-morph for circular-import detection later? Reserve ts-morph for a follow-up?
2. Should `lib/calendar/google/`, `lib/email/templates/` get sub-facades **in this epic** or be deferred to a follow-up? Survey above suggests they would each pay off, but they grow the scope by ~2 sub-PRs.
3. Is the sub-PR ordering (low-risk first → high-risk last) right, or should `lib/db/` go FIRST because the barrel is trivial and the call-site rewrite is the dominant cost?
4. Should `Phase 2` be one mega-epic or split into two (foundation/A+B → high-traffic/C+D)? The paranoia contract counts plan+wave checkpoints per epic, so deciding now matters for cost.
5. Does the team want a temporary `// API-BOUNDARIES-EXEMPT` magic comment for known-deferred call sites, or is "rewrite all in one sub-PR" the only acceptable mode?

---

**Next step:** run `/codex-paranoia plan docs/plans/api-boundaries-survey.md` to adversarially review this plan. After SIGN-OFF, decompose into sub-PRs per Stage A / B / C / D and begin implementation.
