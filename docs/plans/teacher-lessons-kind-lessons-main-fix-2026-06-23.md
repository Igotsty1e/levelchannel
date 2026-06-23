# Hotfix: `<main>` semantic violation на `/teacher/lessons` (kind=lessons)

**Date:** 2026-06-23
**Type:** hotfix (1 file, ≤10 lines)
**Owner:** Claude
**Status:** PLAN → impl

## Problem

`/teacher/lessons` (default `kind=lessons`) рендерит:
- `app/teacher/lessons/page.tsx` создаёт `<main className="lc-stack-section">` (Epic 2 PR-1b H-11).
- Внутри panel для `kind=lessons` рендерится `<LessonHistoryClient>`, который создаёт собственный `<main maxWidth: 980, paddingBottom: 80>` (`components/teacher/lessons/lesson-history-client.tsx:176`).

**Симптомы:**
1. **Double `<main>` semantic violation** — invalid HTML.
2. **Parent `.lc-stack-section` rhythm не работает** через nested main (lobotomized-owl pattern needs direct children, не nested).
3. **`paddingBottom: 80` дублируется** в outer + inner main.

Visible на скриншоте `/teacher/lessons` (default): rhythm между header → KindRoutingCards → filters bar tight, не matches `var(--space-section)` (32/24).

Сравнение:
- `kind=payments`: PaymentsSection — `<section className="lc-stack-card">` ✅ (Epic 2 PR-1b).
- `kind=deals`: DealsSection — `<section className="lc-section">` ✅ (existing).
- `kind=lessons`: LessonHistoryClient — **own `<main>`** ❌.

## Why was this missed (retrospective)

**Plan-time scope narrowness:**
- Epic 2 plan-doc был **explicitly** «`/teacher/lessons?kind=payments`» — kind=lessons и kind=deals deliberately out-of-scope.
- 8 rounds Codex paranoia + wave 1 round проверяли только payments surface diff. Я даже acceptance checklist'у L-6 footer-link removal в обоих файлах (`page.tsx` + `lesson-history-client.tsx`) проводил **только grep**, не semantic structure check.

**Codex paranoia limitation (shifted-right detection):**
- Wave round 1 смотрел aggregated diff `d79fb2f^..b540411`. В diff видны изменения в `page.tsx` (`<main className="lc-stack-section">` добавлен) — Codex видел.
- `lesson-history-client.tsx` был в diff ТОЛЬКО для L-6 footer link removal (3 lines). Inner `<main>` остался unchanged, не попал в visible diff context.
- Codex не reads unchanged sibling-files без явного hint. Это классический «shifted-right detection» trade-off — wave-mode trades деталь для token-savings.

**Foundation-time verification gap:**
- Когда я designed `.lc-stack-section` для H-11, должен был проверить **все 3 panel candidates** (PaymentsSection / DealsSection / LessonHistoryClient) на compatibility. Я проверил только PaymentsSection (which I was actively migrating).

**Visual canary gap:**
- Я visual-verifit на проде только `kind=payments`. `kind=lessons` и `kind=deals` после deploy не открывал. Owner caught на manual visual review.

**No mechanical guard:**
- No lint rule блокирует double `<main>` в Next App Router tree.
- No e2e spec для kind=lessons / kind=deals.

## Fix

`components/teacher/lessons/lesson-history-client.tsx:176-178`:

```tsx
// BEFORE
return (
  <main style={{ maxWidth: 980, margin: '0 auto', paddingBottom: 80 }}>
    <section className="card lc-section" style={{ padding: 16, ... }}>
      ...
    </section>
    ...

// AFTER
return (
  <>
    <section className="card lc-section" style={{ padding: 16, ... }}>
      ...
    </section>
    ...
  </>
)
```

Парент `<main className="lc-stack-section">` уже задаёт maxWidth: 980 + paddingBottom: 80 + ритм через lc-stack-section. Inner main избыточен.

## Verification

- [ ] `npm run test:run` green
- [ ] `npm run build` green
- [ ] Manual visual prod /teacher/lessons (default) — rhythm matches kind=payments.
- [ ] Manual visual prod /teacher/lessons?kind=deals — sanity.
- [ ] DOM check — only ONE `<main>` in rendered tree.

## Cross-project learning (candidate, не auto-promote)

**Pattern:** Server-branching pages с разными panel components — verify ВСЕ panel candidates совместимы с parent wrapper structure. Не только active surface на дату ревью.

**Impact if missed:** semantic HTML violation + broken visual rhythm на shadowed surfaces, прохождит unnoticed когда plan scope узкий + Codex wave не reads unchanged adjacent files.

**How to catch:**
- Code-time: grep `<main` в panel candidates перед applying parent wrapper.
- Review-time: enumerate ALL routes которые page.tsx может render, verify каждый.
- Mechanical: lint rule single-main per route (TODO Epic 9?).

## Trailer

Single-file hotfix. `Codex-Paranoia: SKIPPED — trivial 1-file structural fix (4 LoC), retrospectively documented`.
