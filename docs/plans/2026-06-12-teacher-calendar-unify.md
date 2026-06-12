# Teacher calendar — top-row unify + slotMode cleanup

**Date:** 2026-06-12
**Status:** SHIPPED
**Branch:** feat/calendar-unify-top-row

## Context

`/teacher/calendar` имел три проблемы UI/UX:

1. **Mobile FAB** — sticky-bottom плавающая кнопка «Создать», отдельный
   стиль и другая позиция от top-row кнопки «Назначить ученику». Два
   разных entry-point в один и тот же поток создания слотов.
2. **`slot_mode` настройка** (`accounts.calendar_slot_mode`) —
   `'open_slots' | 'direct_assign'`. Чисто UI-флаг: API-эндпоинты
   `/api/teacher/slots/bulk-create` и `/api/teacher/slots/assign-direct`
   его не проверяли. Прятала «+ Добавить слоты» в `direct_assign` mode
   на desktop; на mobile в этом mode FAB сразу открывал AssignDirectModal
   без выбора. Косметика, не enforcement.
3. **Десинхрон стилей** — «+ Назначить ученику» нейтральный, «+ Добавить
   слоты» accent. Никакой логики иерархии не было — оба создают слоты в
   одинаковой степени.

## Changes

### DB
- Migration `0127_drop_accounts_calendar_slot_mode.sql` — drop CHECK
  constraint + drop column. Сама колонка была nullable-default; никакая
  data не теряется кроме UI-выбора.

### Deleted
- `lib/scheduling/slot-mode.ts` — модуль `getCalendarSlotMode` /
  `setCalendarSlotMode` / `isCalendarSlotMode` + type.
- `app/api/teacher/settings/calendar/slot-mode/route.ts` — POST endpoint.
- `app/teacher/settings/calendar/slot-mode-toggle.tsx` — UI-компонент.

### Edited
- `app/teacher/settings/calendar/page.tsx` — снят fetch + `<SlotModeToggle />`.
- `app/teacher/calendar/page.tsx` — снят `slotMode` fetch + prop.
- `app/teacher/calendar/client.tsx`:
  - Снят `slotMode` prop, default, type.
  - Единый объект `topActionBtnStyle` для обеих кнопок.
  - «+ Добавить слоты» рендерится всегда (без `.calendar-bulk-add-desktop`
    скрытия на mobile).
  - Top-row получил `flex-wrap: wrap` чтобы на узких mobile-экранах
    кнопки могли перейти на новую строку, а не обрезаться.
- `components/calendar/MobileCreateFab.tsx`:
  - `<FloatingActionButton>` рендер удалён.
  - `slotMode` prop удалён, `MODE_OPTIONS_DIRECT_ASSIGN` константа
    удалена, `openFromFab` функция удалена.
  - `BULK_PREF_KEY` LS-prefer логика удалена (default = bulk явный из
    текста кнопки).
  - Компонент остаётся как контейнер для single-slot mobile-sheet, который
    триггерится из `BulkAddSlotsModal.onSwitchToSingle`.
- `app/cabinet/page.tsx` — снят `teacherSlotMode` fetch + prop в
  `<LessonsSection />`.
- `app/cabinet/lessons-section.tsx` — снят `teacherSlotMode` prop +
  `<DirectAssignInfoCard />` рендер. Ученик в bывшем `direct_assign`
  mode теперь видит обычный pickup-CTA; если у учителя нет open-slots,
  pickup просто пустой.
- `app/globals.css` — удалены 2 media-rule блока:
  `.calendar-mobile-fab` и `.calendar-bulk-add-desktop`.

## Verification

Локально (pre-merge):
- ✓ Migration 0127 применилась чисто
- ✓ `npm run build` — typecheck зелёный
- ✓ `npm run test` — unit 1316 passed
- ✓ Mobile 375×812 (playwright + dev login):
  - Top-row: «+ Назначить ученику» + «+ Добавить слоты» рядом, одинаковый
    стиль (border + surface-2 + text), wraps на узких экранах
  - Sticky bottom FAB отсутствует
  - «+ Добавить слоты» → BulkAddSlotsModal → switch на «Один слот» работает
  - «+ Назначить ученику» → AssignDirectModal → single/series chip работает
  - `/teacher/settings/calendar` — секции slot-mode toggle нет
- Prod (post-merge):
  - Sentry release header совпадает с merge SHA
  - Smoke 200/307 на основных surfaces
  - CSS bundle не содержит `.calendar-bulk-add-desktop` / `.calendar-mobile-fab`

## Paranoia

Codex quota exhausted до 2026-06-11 23:59 — self-review fallback по
COMPANY.md §7. Trailer: `Codex-Paranoia: SUB-WAVE self-reviewed`,
epic-end-debt в `2026-06-06_push_pwa_codex_debt.md`.
