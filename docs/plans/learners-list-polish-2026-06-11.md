---
title: learners-list-polish — список учеников вверху + top-10 a-z + pagination + убрать дублирующую подпись
status: PLAN
date: 2026-06-11
scope: standalone one-PR epic (UI polish on /teacher/learners)
owner: ivankhanaev
author: claude
---

# learners-list-polish (2026-06-11)

## 0. TL;DR

Полировка `/teacher/learners` per owner ask:

1. **Список вверх.** `LearnersListClient` рендерится ВЫШЕ `TeacherInviteSection` (приглашение нового ученика). Учитель чаще приходит к списку, чем к приглашению — список первый.
2. **Top-10 active + sort a-z + pagination.** Default sort активных — по имени (a-z). Показываем первые 10. Если больше — pagination control. Если ≤10 — никаких лишних элементов pagination.
3. **Убрать дублирующую подпись.** `<p>«X активных учеников.»</p>` дублирует count в `ChipGroup` ниже («Активные · 12»). Удаляем.

## 1. Existing surface

Patch existing — НЕ новый surface, survey-before-plan skip.

- `app/teacher/learners/page.tsx` — SSR + props plumbing.
- `app/teacher/learners/client.tsx` — фильтр / search / render.
- `lib/scheduling/teacher-learners.ts` → `listLearnersForTeacher()` — data; не трогаем.

## 2. Что меняем

### 2.1 `app/teacher/learners/page.tsx`

- Меняем порядок JSX: `LearnersListClient` сначала, `TeacherInviteSection` после.
- Удаляем дублирующую `<p>...активных учеников.</p>` секцию.
- `activeLearnerCount` локальная переменная больше не используется → удалить.

### 2.2 `app/teacher/learners/client.tsx`

- Add sort by name (a-z) перед фильтром. Sort работает только для отображения; counts остаются по полному `learners`.
- Add `currentPage` state и `PAGE_SIZE = 10` constant.
- Slice filtered list: `filtered.slice((currentPage-1) * PAGE_SIZE, currentPage * PAGE_SIZE)`.
- Pagination controls: рендерим ТОЛЬКО если `filtered.length > PAGE_SIZE`.
  - Простой prev/next + «N из M» indicator (tabular nums).
- Reset `currentPage = 1` когда `filter` / `query` меняются (через `useEffect` или derived).

### 2.3 Sort details

```ts
function nameKey(l: LearnerRow): string {
  return renderName(l).toLocaleLowerCase('ru-RU')
}
sorted = [...filtered].sort((a, b) => nameKey(a).localeCompare(nameKey(b), 'ru-RU'))
```

`localeCompare('ru-RU')` корректно сортирует кириллицу.

## 3. Acceptance criteria

1. `/teacher/learners` — список учеников отображается ВВЕРХУ экрана; приглашение нового ученика — ПОСЛЕ списка.
2. Подпись «X активных учеников.» исчезла. ChipGroup внизу всё ещё показывает counts.
3. Default sort активных — по имени (a-z), регистронезависимо.
4. Если фильтр→результат >10 — внизу pagination «← 1 из N →». При ≤10 — никаких элементов pagination.
5. Меняешь фильтр/поиск → возврат на page 1.

## 4. Risks (self-review fallback, codex quota exhausted)

- **LOW: existing CSS на `.learner-card-list`** — мы используем тот же ul/li wrapper для меньшего набора, no CSS change нужно.
- **LOW: пользователь увидит изменённый порядок и его удивит** — это и есть owner ask, не bug.
- **LOW: `renderName` локально вызывается дважды в render** — небольшой пере-расчёт; оптимизация не нужна (≤10 items).
- **INFO: `useEffect` для сброса page** vs `useMemo` + comparison — using `useMemo` чтобы пересоздавать page при изменении query/filter (cleaner).

## 5. Tests

- `npm run build` — green.
- `npm run test:run` — green.
- `npm run check:content-style` — green (нет user-facing copy changes кроме удаления одной строки).
- `npm run check:env-contract` — green.
- Manual playwright walkthrough:
  - desktop 1440×900 — список первым, no «X активных учеников.» текст; sort a-z.
  - mobile 375×812 — то же.
  - >10 учеников — pagination видна.
  - ≤10 учеников — pagination скрыта.

## 6. Trailers

- `Skill-Used: codex-paranoia (plan SELF-REVIEW round 1/3 — codex quota exhausted), design-with-claude:table-designer`
- Commit: `Codex-Paranoia: SELF-REVIEW round 1/3 (codex quota exhausted; replay pending)`

## 7. Out of scope

- Server-side pagination (≤10 default, ≤50 typical learner count — client-side sort+paginate безусловно ОК).
- Изменение фильтров (Активные / Архив / Все) — owner не просил.
- Изменение search behaviour — owner не просил.
