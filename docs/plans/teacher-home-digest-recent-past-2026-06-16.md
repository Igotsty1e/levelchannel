# /teacher home polish + payments spacing

Status: SHIPPED 2026-06-16 · Owner: claude
Parent: docs/plans/teacher-master-flow-2026-06-15.md (Wave-2/Wave-3 follow-up)
Branch: `feat/teacher-home-digest-polish-2026-06-16`

## Что меняем

4 связанных правки в одном PR:

1. **RecentPastCard кнопки в outline-стиль** (`components/teacher/home/recent-past-card.tsx`).
   Owner: «Провёл слишком акцентная, сделай контур кнопки потолще без заливки».
   `<Button variant="primary">Провёл</Button>` → `<Button variant="secondary">` (1px border + полупрозрачный surface-2 — это и есть outline без заливки). «Не пришёл» остаётся `ghost` для иерархии.

2. **«Недавние прошедшие» → подсекция DigestPreviewTile** (`components/teacher/digest-preview-tile.tsx` + `app/teacher/page.tsx`).
   - Новый `pastUnmarkedSection?: ReactNode` prop у DigestPreviewTile рендерится под сегодняшними со встроенным divider + sub-heading «Не отмечены» + link «Все прошедшие занятия →»
   - RecentPastCard получил `embedded?: boolean` — при true рендерит только список без card-обёртки, h2 и footer-link
   - Старая самостоятельная секция на /teacher home убрана

3. **Сегодняшние занятия не показываем в «Ближайшие занятия»** (`app/teacher/page.tsx`).
   `listUpcomingSlotsForTeacher` принимает `teacherTz` и фильтрует SQL: `start_at >= ((date_trunc('day', now() at time zone $3) + interval '1 day') at time zone $3)`. Tz берётся из `digestPreview.teacherTz`, fallback на Europe/Moscow. Чтобы tz был доступен до Promise.all, дайджест теперь грузится первым последовательно.

4. **`/teacher/payments` spacing** (`app/teacher/payments/page.tsx`).
   ClaimsFeed возвращает фрагмент без внешнего marginBottom — empty-state card налезала на PolicyEditor. Обёрнут в `<div style={{ marginBottom: 24 }}>`.

## Verification

- `npm run build` — green
- Playwright walkthrough на local dev (port 3010):
  - `/teacher` — DigestPreviewTile с «Не отмечены» подсекцией
  - «Провёл» / «Не пришёл» оба outline-стиле
  - Сегодняшние занятия — только в дайджесте
  - `/teacher/payments` — между empty-state и Policy блоком 24px gap
  - Mobile 390×844 — те же ожидания

## Out of scope

- Finance card дополнительные правки (Wave-3 #660 уже в проде; если owner всё ещё хочет компактнее — отдельный follow-up)
- Глобальные `.card` margin-bottom правки
- Редизайн DigestPreviewTile в целом
