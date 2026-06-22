# Spacing system foundation (Stage 1)

**Status:** PLAN — Codex paranoia **SIGN-OFF round 8/8** (cap exceeded by parent epic, owner-authorized)
**Owner:** Claude (session 2026-06-22)
**Date:** 2026-06-22
**Scope:** semantic spacing tokens + CSS utility classes + AGENTS rule + Banner primitive cleanup + LEARNINGS promotion. **Cross-surface foundation** — потребляется любой UI surface.

> **Forked из:** `docs/plans/teacher-lessons-payments-design-review-2026-06-22.md`. Codex paranoia round-1 поймал scope creep: page-review plan превратился в repo-wide spacing migration. Эта foundation — **hard pre-req** для page review (foundation merged first; parallel ship dropped per Codex round-4/5).

---

## 0. Context

Owner-flagged 2026-06-22 после vertical rhythm finding на `/teacher/lessons?kind=payments` (gaps 16→16→16→24×5 inconsistent): «всегда выставляли одинаковые расстояния на страницах (в вебе и в мобилке)».

Текущий state (`app/globals.css`):
- Numeric scale `--space-0..9` (0/4/8/12/16/24/32/48/64/96) — для padding/micro inside primitives. Уже есть.
- `--space-7..9` имеют mobile collapse @<600px. Уже есть.
- `--space-section: 32/24` + `.lc-section { margin-bottom }` — singular utility. Уже есть.

Что отсутствует:
- Semantic layer для **vertical rhythm между cards** (section/card/intra/tight).
- Stack utility classes (4 уровня).
- Project-level правило в AGENTS.md.
- Mechanical guard (Stage 2, deferred).

---

## 1. Existing surface inventory

```bash
rg -l 'marginBottom:\s*\d+|marginTop:\s*\d+' app/cabinet app/teacher components/cabinet components/teacher | wc -l
```

Ожидается ~30-50 файлов с inline magic. **Migration не делаем в этой волне** — только foundation. Page-level migration — в child plans.

```bash
rg -n '<Banner' app components --glob '*.tsx' | grep -v test | grep -v '^\s*//'
```

**21 use-sites в 13 файлах** (verified Codex round-6 — round-4 inventory был incomplete: regex `'<Banner '` пропускал multiline opens `<Banner\n...>` и не учитывал banners в `app/cabinet/page.tsx`, `components/cabinet/payments-explainer.tsx`, `cap-banners.tsx:41`, `package-list.tsx:182`, `lessons-section.tsx:964`).

| File | Lines | Count |
|---|---|---|
| `app/admin/(gated)/accounts/[id]/page.tsx` | 100, 105 | 2 |
| `app/admin/(gated)/slots/slots-manager.tsx` | 146, 147 | 2 |
| `app/cabinet/lessons-section.tsx` | 545, 964 | 2 |
| `app/cabinet/page.tsx` | 319 | 1 |
| `app/cabinet/profile/page.tsx` | 140 | 1 |
| `app/teacher/payments/explainer.tsx` | 33 | 1 |
| `components/cabinet/pay-lesson-modal.tsx` | 208, 351 | 2 |
| `components/cabinet/payments-explainer.tsx` | 45 | 1 |
| `components/teacher/pricing/cap-banners.tsx` | 41, 56, 65 | 3 |
| `components/teacher/pricing/package-list.tsx` | 172, 182 | 2 |
| `components/teacher/pricing/tariff-list.tsx` | 163 | 1 |
| `components/teacher/profile/danger-card.tsx` | 62 | 1 |
| `components/teacher/profile/profile-card.tsx` | 233, 240 | 2 |
| **TOTAL** | | **21** |

Banner primitive имеет hardcoded `marginBottom: 16` (`banner.tsx:50`).

---

## 2. Findings

### F-1. **BLOCKER** — Semantic spacing layer отсутствует

**Where:** `app/globals.css`.

**Why:** только numeric scale + `--space-section`. Авторы вписывают magic `marginBottom: 16/24/32` — drift каждой PR.

**Fix:** добавить 3 semantic tokens алиасами на existing numeric (см. §3.1).

### F-2. **BLOCKER** — Banner primitive double-margin

**Where:** `components/ui/primitives/banner.tsx:50` — `marginBottom: 16` hardcoded.

**Why:** consumers оборачивают Banner в `<div style={{ marginBottom: N }}>` (e.g. `app/teacher/payments/explainer.tsx:32`). Margin collapse даёт effective 16 (не 32), но это **redundant code, скрывающий drift**. И **блокирует** rhythm migration: parent stack даст 24, Banner внутренний 16 → collapse → 24 norm, но непредсказуемо если Banner — первый/последний/одинокий child.

**Fix:** убрать `marginBottom: 16` из primitive. **21 consumers** (в 13 файлах per §1 inventory) — после fix те, что были singleton без parent stack (11 risky per §6.4 triage), оборачиваются в `.lc-stack-card` parent ИЛИ explicit `marginBottom: 'var(--space-card)'`. Visual sweep обязателен.

### F-3. **HIGH** — Нет project-level правила

**Where:** `AGENTS.md`.

**Fix:** добавить §5a — enforcement pointer на design-system.md §5 + ban на magic in new code.

### F-4. **HIGH** — design-system.md §5 не описывает semantic layer

**Where:** `docs/design-system.md`.

**Fix:** обновить §5 — добавить semantic tokens table + classes section + примеры.

### F-5. **MED** — LEARNINGS.md cross-project promotion candidate

**Where:** `~/.claude/LEARNINGS.md`.

**Fix:** ASK gate per COMPANY.md «Cross-project learning promotion» после ship Stage 1. **Не auto-promote.**

---

## 3. Remediation

### 3.1 Semantic spacing tokens (`app/globals.css`)

Добавить блок (после existing `--space-section` на line 2443):

```css
:root {
  --space-card: var(--space-5);   /* 24px — между смежными cards внутри секции */
  --space-intra: var(--space-4);  /* 16px — внутри карточки: h2→body, label→input, grid gap */
  --space-tight: var(--space-2);  /* 8px — между micro-row элементами в списке */
}

@media (max-width: 600px) {
  :root {
    --space-card: var(--space-4);   /* 24 → 16px */
    --space-intra: var(--space-3);  /* 16 → 12px */
    --space-tight: 6px;             /* 8 → 6px (нет existing token; literal) */
  }
}
```

**Правило выбора (документируется в design-system.md):**
- `--space-section` (32/24): между крупными «семьями» страницы.
- `--space-card` (24/16): между смежными cards одной семьи.
- `--space-intra` (16/12): inside card — h2→body, label→input, grid gap.
- `--space-tight` (8/6): между micro-rows.

### 3.2 CSS utility classes (`app/globals.css`)

Lobotomized-owl pattern:

```css
.lc-stack-section > * + * { margin-top: var(--space-section); }
.lc-stack-card    > * + * { margin-top: var(--space-card); }
.lc-stack-intra   > * + * { margin-top: var(--space-intra); }
.lc-stack-tight   > * + * { margin-top: var(--space-tight); }
```

**Применение:**

```tsx
<section className="lc-stack-card">
  <Banner>...</Banner>
  <SummaryGrid />
  <UnpaidLearners />
  ...
</section>
```

Дети — без inline `marginBottom`. Используется внутри **block-direction stacks**; для flex/grid с собственным `gap`, использовать `gap: var(--space-intra)` напрямую.

### 3.3 Banner primitive cleanup

**File:** `components/ui/primitives/banner.tsx:50`.

**Change:** удалить `marginBottom: 16,`.

**Sweep workflow** (manual, 21 use-sites в 13 файлах):
1. `rg -l '<Banner' app components --glob '*.tsx' | grep -v 'components/ui/primitives/banner.tsx' | sort -u` — список 13 файлов. **NB: regex `'<Banner'` БЕЗ trailing space** — учитывает multiline opens `<Banner\n  tone=...>`. Старая команда `'<Banner '` (с пробелом) пропускала `app/cabinet/page.tsx`, `app/teacher/payments/explainer.tsx`, `components/cabinet/payments-explainer.tsx`, `cap-banners.tsx:41`, `package-list.tsx:182`, `lessons-section.tsx:964` — Codex round-6 BLOCKER #2 caught.
2. Для каждого из 13: `npm run dev` + playwright navigate → ground-truth screenshot ДО изменения primitive.
3. После изменения primitive — повтор navigate → after-screenshot.
4. Если spacing «провалился» (Banner был singleton без parent stack) — оборачиваем consumer в `.lc-stack-card` parent ИЛИ явный `var(--space-card)` на consumer side.

**Полный список consumers (21 use-sites в 13 файлах — Codex round-6 verified):** см. §1 inventory выше. Sweep обязателен для всех 21.

### 3.4 AGENTS.md §5a (enforcement pointer)

Добавить раздел после §5:

```markdown
## 5a. Spacing rule (vertical rhythm)

**Vertical rhythm — mandatory через semantic tokens.** Full spec: `docs/design-system.md §5`.

**Hard rule:** inline `style={{ marginBottom: N }}` / `marginTop: N` / `gap: N` для **vertical** rhythm между cards/section-level в `app/cabinet/`, `app/teacher/`, `components/cabinet/`, `components/teacher/` — anti-pattern. Use `.lc-stack-*` classes ИЛИ inline `'var(--space-*)'` token.

**Exception:** primitives (`components/ui/primitives/*`) могут использовать numeric tokens (`var(--space-N)`) напрямую — они provide layer, не consume semantic.

**Migration rule:** редактируешь старый файл с magic spacing — мигрируешь на classes/tokens в той же правке (COMPANY.md «Doc maintenance discipline»).

**Mechanical check:** Stage 2 (`scripts/check-spacing.sh`) — отдельная волна. До тех пор: review-time + `/review` skill catches.
```

### 3.5 docs/design-system.md §5 update

Расширить §5 «Spacing scale»:

- Existing numeric scale (`§5` базовый) — оставить.
- Add subsection `§5.2 Semantic tokens` — tokens table (section/card/intra/tight + responsive values).
- Add subsection `§5.3 Stack utility classes` — 4 классa с примерами.
- Add subsection `§5.4 When to use which` — decision tree:
  - Vertical rhythm между cards → semantic.
  - Padding inside primitive → numeric.
  - Inline magic → запрещено в cabinet/teacher.

### 3.6 Checkbox primitive focus-visible fix (Codex round-2 BLOCKER)

**File:** `components/ui/primitives/checkbox.tsx:48-77` — текущий primitive **не рисует visible focus state**: input визуально скрыт через `visuallyHidden` (line 120-130), но custom `<span aria-hidden>` box на :focus-visible не реагирует.

**Why в этом plan, не в page review:** Codex round-2 BLOCKER — page-review plan B-4 указал на pre-req без owner. Logical fit: foundation эпик уже трогает primitives layer (`banner.tsx` cleanup), Checkbox присоединяется natural.

**Fix (Codex round-5 BLOCKER correction):**

Текущий DOM order в primitive (line 50-83):
1. `<label>` outer container.
2. `<span aria-hidden>` visual box.
3. `<input>` visually-hidden.
4. `<span>` label-text.

CSS selector `.lc-checkbox-input:focus-visible + .lc-checkbox-box` **НЕ работает** — box идёт ДО input в DOM. Adjacent sibling `+` matches только subsequent siblings.

**Working approach: `:focus-within` на parent label** (no DOM reorder):

```css
.lc-checkbox-label:focus-within .lc-checkbox-box {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 8px;
}
```

Browser support: `:focus-within` 95%+ (Safari 10.1+, Chrome 60+, Firefox 52+). 

И обновить primitive:
- `className="lc-checkbox-label"` на `<label>` (line 50).
- `className="lc-checkbox-box"` на visual `<span aria-hidden>` (line 53-59).
- `<input>` остаётся как есть (visually hidden).

**Verification (Codex round-6 fix — jsdom не симулирует `:focus-within`):**

- **Manual keyboard check:** dev server, Tab на любую страницу с Checkbox → видимый focus ring на box.
- **Snapshot test** (`tests/primitives/checkbox-focus.test.tsx`): rendered Checkbox + `userEvent.tab()` + expect `<label>` has class `lc-checkbox-label` AND `<input>` is `:focus` (jsdom supports `:focus`, не `:focus-within`). CSS rule self не testable в jsdom — verify через manual + e2e.
- **E2E** (если есть Playwright Banner-touched flow): `await page.locator('[data-testid="...checkbox..."]').focus()` + visual snapshot diff показывает ring.

### 3.7 LEARNINGS.md promotion candidate

После ship Stage 1 — ASK owner per COMPANY.md gate:

```markdown
## [2026-06-22] Vertical rhythm via semantic tokens + class layer (LevelChannel)

**Pattern:** UI projects накапливают drift между cards (16/24/32 mix) когда vertical gaps живут как inline `marginBottom`. Fix: semantic spacing tokens (`--space-section / --space-card / --space-intra / --space-tight`) + CSS stack utility classes (`.lc-stack-*`) + project rule «inline marginBottom forbidden for new code».

**Impact if missed:** visually inconsistent screens; gaps «прыгают» по мере merger независимых PRs от разных авторов; design-system contract drift на каждой новой странице.

**How to catch:**
- Code: `rg 'marginBottom:\s*\d+' app/ components/` — высокий count → drift.
- Review: при чтении plan-doc / PR на UI surface — verify spacing tokens use.
- Stage 2 mechanical: `scripts/check-spacing.sh` — grep magic numbers вне allowlist; CI gate.

**Sources:** LevelChannel design review `/teacher/lessons?kind=payments` 2026-06-22.
```

---

## 4. Out-of-scope

- **Page-level migration** — child plans (`teacher-lessons-payments-design-review-2026-06-22.md`, etc).
- **Stage 2 mechanical** (`scripts/check-spacing.sh`) — отдельная волна после 2-week soak.
- **Numeric scale refactor** — `--space-0..9` остаются как есть.

---

## 5. Remediation scope (single PR — foundation)

**Files (4 base — Banner cleanup §3.3 DEFERRED to separate sub-epic):**

Base 4:
- `app/globals.css` (§3.1 + §3.2)
- `components/ui/primitives/checkbox.tsx` (§3.6 — focus-visible state)
- `AGENTS.md` (§3.4)
- `docs/design-system.md` (§3.5)

**Banner cleanup §3.3 DEFERRED** (impl-time decision 2026-06-22):
- 21 use-sites в 13 файлах требуют individual sweep с potential consumer fix-ups.
- Foundation проще ship'ить без Banner change → consumers могут потреблять tokens/classes сразу.
- Banner cleanup → отдельный `spacing-banner-cleanup-2026-XX-XX.md` plan (after foundation merged).

Post-ship (separate ASK-gated step):
- `~/.claude/LEARNINGS.md` promotion candidate

**Realistic scope:** 4 файлов. **Worst case если кто-то найдёт regression в Checkbox migration:** 4 + 1-2 fix-up. Manageable single PR.

**Trailer (standalone one-PR epic per CLAUDE.md):**
```
Codex-Paranoia: SIGN-OFF round N/3
```

---

## 6. Verification

### 6.1 Automated
- `npm run test:run` — green.
- `npm run check:content-style` — green.
- `npm run build` — typecheck + Next build.

### 6.2 ~~Manual Banner sweep~~ — DEFERRED

Banner cleanup §3.3 вынесен в отдельный sub-epic. Этот foundation PR не трогает Banner primitive — sweep не нужен в текущем scope.

### 6.3 Acceptance
- [ ] §3.1: 3 semantic tokens добавлены + mobile overrides.
- [ ] §3.2: 4 `.lc-stack-*` classes добавлены.
- [ ] ~~§3.3 Banner cleanup~~ — DEFERRED to separate sub-epic. Skip в foundation acceptance.
- [ ] §3.4: AGENTS.md §5a добавлен.
- [ ] §3.5: design-system.md §5 расширен (semantic tokens + classes + decision tree).
- [ ] §3.6: Checkbox primitive focus-visible CSS rule added. Verified via existing Checkbox use-site (`components/teacher/learners/invite-form.tsx` или другой existing use-site — НЕ `policy-editor.tsx`, который мигрирует на Checkbox в page-review PR-1a после foundation merge). Manual keyboard Tab → focus ring visible.
- [ ] No regression в `npm run test:run` / `build`.

### 6.4 Banner sweep named inventory (Codex round-3)

**21 use-sites в 13 файлах** — `rg '<Banner' app components --glob '*.tsx' | grep -v primitives/banner.tsx` (round-6 verified; full table в §1).

**Triage по 21 use-sites — pre-impl visual hypothesis (verify в sweep).**

**Risky 11 use-sites (likely break — parent stack/inline margin требуется):**
1. `app/cabinet/profile/page.tsx:140` — Banner между блоков без wrapping stack.
2. `components/cabinet/pay-lesson-modal.tsx:208` — Banner в модалке flow.
3. `components/cabinet/pay-lesson-modal.tsx:351` — second Banner в той же модалке.
4. `components/cabinet/payments-explainer.tsx:45` — learner-side payments explainer.
5. `components/teacher/profile/danger-card.tsx:62` — singleton в карточке.
6. `components/teacher/profile/profile-card.tsx:233` — 1st banner в card.
7. `components/teacher/profile/profile-card.tsx:240` — 2nd banner в card.
8. `app/admin/(gated)/accounts/[id]/page.tsx:100` — page-level.
9. `app/admin/(gated)/accounts/[id]/page.tsx:105` — page-level.
10. `app/teacher/payments/explainer.tsx:33` — explainer wrapper (cleanup в page-review эпике параллельно).
11. `app/cabinet/page.tsx:319` — cabinet home banner.

**Safe 3 use-sites (parent flex/grid с gap):**
- `app/admin/(gated)/slots/slots-manager.tsx:146,147` — inline ternaries в flex container.
- `app/cabinet/lessons-section.tsx:545` — внутри grid container.

**Verify 7 use-sites (pricing/list contexts — likely OK, но screenshot чек):**
- `components/teacher/pricing/cap-banners.tsx:41,56,65` — pricing surface, 3 banners в file.
- `components/teacher/pricing/tariff-list.tsx:163` — list item context.
- `components/teacher/pricing/package-list.tsx:172,182` — list item context.
- `app/cabinet/lessons-section.tsx:964` — secondary banner.

**Sweep workflow:** playwright navigate ДО+ПОСЛЕ всех 21. Если spacing ломается — fix-up в той же PR (parent wrap в `.lc-stack-card` ИЛИ inline `marginBottom: 'var(--space-card)'`).

---

## 7. Risks

- **R-1.** Banner sweep — manual, no baseline diffs. Зависит от тщательности.
- **R-2.** Token alias `var(--space-N)` мобильный fallback — `--space-tight: 6px` literal (нет existing `--space-1.5`). Если решим стандартизировать — добавить `--space-1.5: 6px`.
- **R-3.** Stack utility classes используют lobotomized-owl pattern — работает для plain block stacks; не подходит для grid/flex с `gap`. Документировано в §3.2.
- **R-4.** Page-level migration hard-зависит от этой foundation. Foundation merged first — обязательно (parallel ship dropped per Codex round-4/5).

---

## 8. Open questions

- **Q-1.** Class names — `.lc-stack-section/card/intra/tight` (default, descriptive) или короче `.lc-vs/vc/vi/vt`? **Default: descriptive.**
- **Q-2.** Stage 2 timeline — после Stage 1 SIGN-OFF + 2-week soak (default) или сразу?
- **Q-3.** LEARNINGS.md promotion — после PR merge (default) или вообще не promote (cross-project bar не пройден)? Per COMPANY.md нужен ≥2 projects ИЛИ critical boundary. **Default: ASK после merge.**
- **Q-4.** Banner primitive consumers — sweep 11+ перед ship или принять risk (минорная visual regression в far-out sites — fix follow-up)? **Default: sweep mandatory.**

---

## 9. Sign-off

- **Plan checkpoint:** pending `/codex-paranoia plan`.
- **Implementation:** not started.
- **Wave checkpoint:** after implementation.
