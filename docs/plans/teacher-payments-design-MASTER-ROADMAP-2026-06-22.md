# Master roadmap — teacher payments design polish

**Date:** 2026-06-22
**Owner:** Иван (product) + Claude (impl)
**Status:** All paranoia rounds SIGN-OFF; ready to start impl
**Source plans:**
- `docs/plans/spacing-system-foundation-2026-06-22.md`
- `docs/plans/teacher-lessons-payments-design-review-2026-06-22.md`

---

## Epic structure

```
Epic 1: spacing-system-foundation-2026-06-22       [pre-req for Epic 2]
   └─ PR-FOUNDATION (one PR, standalone epic)

Epic 4: chipgroup-primitive-evolution              [pre-req for Epic 2 PR-1a; owner Q-10 = B]
   └─ PR-CHIPGROUP (add aria-label + disabled + 5-option overflow)

Epic 2: teacher-payments-design-polish-2026-06-22  [main page review]
   ├─ PR-1a: correctness + a11y (uses ChipGroup from Epic 4)
   ├─ PR-1b: copy + spacing + tokens
   ├─ PR-2: MED + LOW polish
   └─ PR-3: epic-close + /codex-paranoia wave + /document-release

Epic 3 (DEFERRED): spacing-mechanical-guard         [Stage 2; after 2-week soak]
Epic 5 (DEFERRED): cabinet-modal-primitive          [unblocks 28 modals refactor]
Epic 6 (DEFERRED): spacing-banner-cleanup           [Banner marginBottom removal + 21-site sweep]
Epic 7 (DEFERRED): cabinet-tabs-a11y-keyboard       [roving tabIndex + arrow/Home/End for tablist; identified Codex wave round-1 WARN #3]
```

**Owner decisions 2026-06-22 (Q-1, Q-2, Q-4, Q-5, Q-10):**
- Q-1 «Не пришло» → **pulled** (mercy tone сохраняется; consumer files не трогаем).
- Q-2 banner-explainer → **pulled** (text как есть; только wrapper удалён).
- Q-4 B-1 → **Variant B** (русский Pill statusLabel вместо удаления).
- Q-5 split → **3 PR** (default).
- Q-10 ChipGroup → **Variant B** (Epic 4 promoted к pre-req; H-5 closed в PR-1a).

---

## Epic 1: spacing-system-foundation

**Plan:** `docs/plans/spacing-system-foundation-2026-06-22.md`
**Type:** standalone one-PR epic
**Estimated effort:** 0.5-1 day impl + sweep
**Blocks:** Epic 2 (hard pre-req)

### Tasks

| ID | Task | File(s) | Estimate |
|---|---|---|---|
| F-1 | Add semantic tokens `--space-card/intra/tight` + mobile overrides | `app/globals.css` | 10 min |
| F-2 | Add `.lc-stack-*` utility classes (4 stacks) | `app/globals.css` | 10 min |
| F-3 | Remove `marginBottom: 16` from Banner primitive | `components/ui/primitives/banner.tsx:50` | 5 min |
| F-4 | Banner sweep — playwright snapshot before/after 21 use-sites в 13 файлах | full inventory §6.4 | 30 min |
| F-5 | Fix-ups для regressing Banner consumers (11 risky triaged) | up to 13 files | 30-60 min |
| F-6 | Checkbox primitive `:focus-within` CSS rule | `components/ui/primitives/checkbox.tsx` + `globals.css` | 15 min |
| F-7 | AGENTS.md §5a enforcement pointer | `AGENTS.md` | 10 min |
| F-8 | design-system.md §5 extended (semantic + classes + decision tree) | `docs/design-system.md` | 20 min |

**Trailer:** `Codex-Paranoia: SIGN-OFF round 8/3 (cap-exceeded owner-authorized; standalone epic)`
**Skill-Used:** `codex-paranoia (8 rounds), design-review, playwright-mcp`

### Acceptance gates (impl-time)
- [ ] `npm run test:run` green
- [ ] `npm run build` green
- [ ] `npm run check:content-style` green
- [ ] Banner sweep 21 use-sites passed
- [ ] Checkbox keyboard Tab → focus ring visible

---

## Epic 2: teacher-payments-design-polish

**Plan:** `docs/plans/teacher-lessons-payments-design-review-2026-06-22.md`
**Type:** multi-sub-PR epic
**Estimated effort:** 2-3 days
**Hard pre-req:** Epic 1 merged

### PR-1a: Correctness + a11y

**Files:** 6 edits + 3 new = 9 total
**Estimate:** 1 day

| ID | Task | File(s) |
|---|---|---|
| B-1 | Убрать `${row.status}` из slot label | `lib/payments/sbp-claims.ts:352-358` |
| B-2 | Динамический sum preview в «Отметить оплачено» button | `app/teacher/payments/unpaid-learners.tsx` |
| B-3 | Tabs ARIA (`role="tablist"`/`tab` + `aria-selected`, без `aria-controls`) | `app/teacher/payments/feed.tsx:214-237` |
| B-3-test | Selector migration `getByRole('button')` → `getByRole('tab')` | `tests/payments/teacher-feed-prop-resync.test.tsx:51,60` |
| B-4 | `<Checkbox>` primitive в policy-editor (только; slot rows native) | `app/teacher/payments/policy-editor.tsx` |
| H-9 | Modal a11y: `aria-describedby` + textarea hint + `inputMode="decimal"` + `<label htmlFor>` 4 inputs | `app/teacher/payments/feed.tsx` modals |
| H-12 | Wrap error `<p>` в `<div role="alert" aria-live="polite">` | feed/unpaid-learners/policy-editor |
| B-1-helper-test | Helper unit test — label не содержит slugs | `tests/payments/sbp-claims-unpaid-label.test.ts` (NEW) |
| B-1-route-test | Route serialization test | `tests/api/teacher/payment-claims-unpaid-slots.test.ts` (NEW) |
| E2E | Same-wave E2E spec | `tests/e2e/teacher-payments.spec.ts` (NEW) |
| EVALS | Add `FLOW-TEACHER-PAYMENTS-001` row | `evals/PRODUCT_FLOWS.md` section D |

**Trailer:** `Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-payments-design-polish-2026-06-22); epic-end review pending`

### PR-1b: Copy + spacing + tokens

**Files:** 6 edits
**Estimate:** 0.5 day
**Hard pre-req:** PR-1a + foundation merged

| ID | Task | File(s) |
|---|---|---|
| H-1 | Local subtitle const per kind в page.tsx | `app/teacher/lessons/page.tsx` |
| H-2 | h2→h3 в подсекциях; fontSize 17 | `payments-section.tsx`, `unpaid-learners.tsx`, `policy-editor.tsx` |
| H-3 | Summary card value 22px + tabular-nums | `payments-section.tsx` |
| H-4 | Banner explainer text ≤ 2 строк + wrapper удалён | `app/teacher/payments/explainer.tsx` |
| H-6/H-7 | Section rhythm: `.lc-stack-section` wrapper в page.tsx + `.lc-stack-card` в payments-section + удалить inline marginBottom (8 hits) | `page.tsx`, `payments-section.tsx`, `kind-routing-cards.tsx`, `unpaid-learners.tsx`, `policy-editor.tsx`, `explainer.tsx` |
| H-8 | «Не пришло» → «Отклонить заявку» + sync 2 consumers | `feed.tsx`, `app/cabinet/payments/page.tsx:94`, `app/saas/learn/sbp/page.tsx:93` |
| H-11 | `<main>` обёрнут в `.lc-stack-section`; 8 inline margins removed; CSV marginTop removed; explainer wrapper removed | comprehensive vertical rhythm fix |
| B-5 | KindRoutingCards `role="tab"` + `aria-selected` + усиленный active state | `kind-routing-cards.tsx` |
| H-13 | `var(--surface)` → `var(--surface-1)`; raw rgba → `var(--accent-bg)` | `kind-routing-cards.tsx` |

**Trailer:** same SUB-WAVE format.

### PR-2: MED + LOW polish

**Files:** 8 edits
**Estimate:** 0.5 day
**Hard pre-req:** PR-1a + PR-1b merged

| ID | Task | File(s) |
|---|---|---|
| M-1 | Page H1 28px | `app/teacher/lessons/page.tsx` |
| M-4 | Copy unified + глоссарий content-style.md | `feed.tsx`, `docs/content-style.md` |
| M-5 | CSV link → Button | `payments-section.tsx` |
| M-6 | «Заявка» убрано | `feed.tsx` |
| M-7 | «Выбрать все / Снять все» link | `unpaid-learners.tsx` |
| M-8 | tabular-nums на money/count | `unpaid-learners.tsx` |
| M-9 | status pill labels сокращены | `feed.tsx` |
| L-1 | mobile minHeight уменьшен | `kind-routing-cards.tsx` |
| L-3 | separator в expanded view | `unpaid-learners.tsx` |
| L-6 | «← на главную» удалён в обоих файлах | `page.tsx`, `lesson-history-client.tsx` |
| I-3 | design-system §11 «ты/вы» doc-drift | `docs/design-system.md` |

**Trailer:** same SUB-WAVE format.

### PR-3: Epic-close

**Estimate:** 1 hour
**Hard pre-req:** PR-2 merged

| Step | Action |
|---|---|
| 1 | Run `/codex-paranoia wave <epic-commit-range>` |
| 2 | Если BLOCKER — follow-up fix-PR |
| 3 | `/document-release` final sweep |
| 4 | Ship: VERSION bump + CHANGELOG + close |

**Trailer epic-close:** `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <range>)`

---

## Deferred epics (separate plan-docs when ready)

### Epic 3: spacing-mechanical-guard (Stage 2)

**Timeline:** after Epic 1 merged + 2-week soak.
**Scope:**
- `scripts/check-spacing.sh` — grep magic numbers outside allowlist.
- Local hook + CI gate.
- Whitelist `// spacing-allow` comments.
- Rampup: warn → block.

### Epic 4: chipgroup-primitive-evolution

**Triggers H-5 closure.** Add to ChipGroup:
- `aria-label` prop (Russian string).
- `disabled` prop.
- 5-option overflow handling на 375px.

After merge — refactor 3 `<select>` в `unpaid-learners.tsx` + `feed.tsx` decline/refund modals.

### Epic 5: cabinet-modal-primitive

**Scope:** 28 inline-styled modals в repo → single `<Modal>` primitive.
**Effort:** 3-5 days.
**Triggers H-9 modal a11y polish.**

---

## Open product decisions (Q-1..Q-12)

Per `teacher-lessons-payments-design-review-2026-06-22.md §7`:

| Q | Question | Default | Owner decision |
|---|---|---|---|
| Q-1 | «Не пришло» → «Отклонить заявку» или мягкий тон | «Отклонить заявку» | ? |
| Q-2 | Banner-explainer — сократить или удалить | сократить | ? |
| Q-3 | RESOLVED — tabs pattern, не aria-current | — | — |
| Q-4 | B-1 — убрать status или русский Pill | убрать | ? |
| Q-5 | Split на 2 sub-PR или single PR | 2 sub-PR | ? |
| Q-6 | RESOLVED — Banner cleanup в foundation | — | — |
| Q-7..Q-9 | Forked to foundation Q-1..Q-3 | — | foundation Q-1..Q-3 |
| Q-10 | ChipGroup primitive upgrade timeline | defer | ? |
| Q-11 | RESOLVED — Checkbox focus-visible в foundation §3.6 | — | — |
| Q-12 | RESOLVED — foundation hard pre-req, no parallel ship | — | — |

**Action:** owner answers Q-1, Q-2, Q-4, Q-5, Q-10 before impl start. Если «иди по дефолтам» — proceed.

---

## Trailer cheat-sheet

```
# PR-FOUNDATION (Epic 1, standalone)
Codex-Paranoia: SIGN-OFF round 8/3 (cap-exceeded owner-authorized; standalone epic)
Skill-Used: codex-paranoia, design-review, playwright-mcp

# PR-1a / PR-1b / PR-2 (Epic 2 sub-PRs)
Codex-Paranoia: SUB-WAVE self-reviewed (epic teacher-payments-design-polish-2026-06-22); epic-end review pending
Skill-Used: design-review

# PR-3 epic-close (Epic 2)
Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)
Skill-Used: codex-paranoia, document-release
```

---

## Final state

**Total paranoia rounds:** 8 (cap 3, owner-authorized override 2026-06-22).
**Token spend:** ~870k Codex tokens (rough sum: 175 + 153 + 0 + 76 + 97 + 105 + 155 + 104 = 865k).
**Files in epic 2:** 9 + 6 + 8 = 23 unique file touches across 3 sub-PRs (some overlap).
**Foundation files:** 5 base + up to 13 conditional = 18 worst-case.

**Brain dump:** `~/Obsidian/Brain/raw/notes/2026-06-22-codex-paranoia-LevelChannel-teacher-payments.md` (создаётся отдельно).
