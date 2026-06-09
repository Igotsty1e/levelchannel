# Массовое добавление слотов — форма + мобилка

**Status**: SHIPPED 2026-06-09 (PRs #563 `08d2d4e` + #567 `9979a3f`). Codex paranoia debt — SIGN-OFF owed after 2026-06-11.
**Owner**: @ivankhanaev
**Author**: Claude (sonnet/opus)
**Date created**: 2026-06-09
**Codex-Paranoia**: pending (запуск после ответов владельца на §3)

---

## 1. Что не так сейчас

В кабинете учителя `/teacher/calendar` массовое создание слотов УЖЕ работает через **drag-paint** (зажать ЛКМ на ячейке, протянуть через N ячеек — открывается `PaintConfirmModal` → `/api/teacher/slots/bulk-create`). Технически до 200 слотов за один запрос.

**Проблемы**:
1. **Мобилка**: FAB (`MobileCreateFab`) добавляет ТОЛЬКО ОДИН СЛОТ. Чтобы сделать «каждую среду по 4 слота» нужно 4 раза нажать FAB. Это адово.
2. **Веб без календаря**: drag-paint требует видеть календарь и зажимать мышь. Это работает, но НЕПОНЯТНО — нет подсказки, никто не догадается. Учителю проще ввести «вт+чт, 16:00–20:00, на 8 недель вперёд» в форму, чем мышью рисовать.
3. **Recurring schedule** (повторяющееся расписание) НЕ существует в принципе. Сейчас drag-paint = «эти конкретные ячейки этой недели». Чтобы повторить на 8 недель — надо переключить неделю и тянуть мышь ещё 8 раз.

Хотим закрыть всё тремя сурфейсами:
- **A.** Форма на вебе — для recurring («каждый вт+чт 18:00 на 8 недель») И для one-shot («4 слота в эту субботу»).
- **B.** Та же форма на мобилке — заменить single-slot FAB на bulk-form.
- **C.** Сохранить drag-paint как был, для тех кто понял (быстрее всех).

---

## 2. UX-эскиз

### 2.1. Форма «Добавить слоты» — общий вид

Открывается из одного места — например, кнопкой «+ Добавить слоты» на странице календаря (и FAB на мобилке).

**Шаги внутри формы (одна страница, не wizard)**:

```
[Дата начала]    [Дата окончания]      ← диапазон. Дефолт: «сегодня + 4 недели».
                                          Если оба = одно число → one-shot режим.

[Дни недели]     ☐Пн ☐Вт ☑Ср ☐Чт ☑Пт ☐Сб ☐Вс
                                          ← multi-toggle. Если выбрана дата-сингл,
                                            этот блок скрыт.

[Время слотов]   16:00  ✕     [+ ещё]
                 18:00  ✕
                 19:30  ✕
                                          ← список time-pickers, можно добавить
                                            строки. На мобилке — bottom-sheet
                                            time-picker.

[Длительность]   (60 мин ▾)               ← селект: 30 / 45 / 60 / 90 / 120 мин.

[Тариф для слота] (Стандарт 1500₽ ▾)      ← селект из учительских тарифов.

[Заметки]        _________________________ ← опциональное free-text для слота
                                            (видит только учитель).

────────────────
[Предпросмотр]   «Будет создано N слотов:
                  ср 11.06 16:00, ср 11.06 18:00, ср 11.06 19:30,
                  пт 13.06 16:00, ...»

                 ⚠ 3 слота конфликтуют с уже существующими и будут
                    пропущены (showing how many):
                    • ср 11.06 16:00 — занят (booked)
                    • пт 13.06 18:00 — уже есть открытый слот

[Создать N слотов]  [Отмена]
```

### 2.2. Mobile-specific tweaks

- Форма — full-screen sheet, открывается snap'ом снизу.
- Date inputs — native (`<input type="date">`).
- Time inputs — native (`<input type="time">`).
- Days-of-week — большие чипы 44×44px.
- Кнопка «Создать» приклеена снизу sticky (учитывая safe-area).

### 2.3. Validation rules (frontend + backend)

- Дата начала ≥ сегодня.
- Дата окончания ≥ дата начала, ≤ дата начала + 90 дней (запрет рисовать на год вперёд).
- Хотя бы 1 день недели если диапазон > 1 дня.
- Хотя бы 1 время.
- Длительность из дискретного списка (миграция 0031 — `lesson_slots_start_in_business_hours` + 30-min boundary + duration ∈ allowed list).
- Каждое время × каждый день × каждая дата → проверка business hours (06:00–22:00 MSK), пропуск если outside (с warning).

### 2.4. Конфликты — преview, не failure

Перед коммитом — backend `POST /api/teacher/slots/preview-bulk` возвращает `{ willCreate: [...], conflicts: [...] }`. UI показывает обе кучи. После «Создать» → существующий `/api/teacher/slots/bulk-create` (он уже idempotent: skipped_conflicts возвращается, без error). Учитель видит реалистичный preview и не получает unexpected'ов.

---

## 3. ВОПРОСЫ К ВЛАДЕЛЬЦУ

### Q1. Где живёт точка входа?
- (a) На странице календаря: кнопка «+ Добавить слоты» в шапке (рядом с переключателем недель). FAB на мобилке.
- (b) Отдельная страница `/teacher/slots/new` куда из календаря linkается.
- (c) Modal в текущем `/teacher/calendar`, но full-screen на мобилке.
- Моё предложение: **(c)** — modal на десктопе, full-screen sheet на мобилке. Один URL, не теряем context календаря.

### Q2. Drag-paint оставляем?
- (a) Да, оставляем + добавляем форму.
- (b) Удаляем drag-paint, остаётся только форма (проще учить, меньше UX-сюрпризов).
- (c) Оставляем, но прячем подсказку «зажми и тяни» в onboarding-туторе.
- Моё предложение: **(a)** — drag-paint реально быстрее когда понимаешь. Не ломаем привычку у тех, кто им пользуется.

### Q3. Что внутри формы — recurring или one-shot или оба?
Один UI или два?
- (a) Один общий — поля «дата начала / дата окончания» + дни недели делают и recurring («ср+пт на 4 недели») и one-shot («один день»).
- (b) Два таба: «На неделю» (одна неделя) / «Регулярно» (с диапазоном).
- (c) Только recurring через эту форму. One-shot оставляем за drag-paint.
- Моё предложение: **(a)** — один экран меньше когнитивной нагрузки. Если дата-начала = дате-окончания, форма себя ведёт как one-shot (дни недели скрываются).

### Q4. Сколько раз вперёд можно «запланировать»?
Хочется ограничить чтобы случайно не залить календарь на год.
- (a) До 3 месяцев (90 дней) от сегодня.
- (b) До 6 месяцев (180 дней).
- (c) До текущий + следующий tariff billing period (если у учителя месячная подписка — до конца следующего месяца).
- Моё предложение: **(a) 90 дней** — этого хватает на семестр. После окончания семестра реалии меняются — лучше пересоздать чем заранее наплодить.

### Q5. Что делаем с конфликтами на момент preview?
- (a) Показываем preview с пометкой «эти будут пропущены», кнопка «Создать» работает — пропускает их.
- (b) Блокируем «Создать» пока есть конфликты — заставляем учителя осознанно убрать день/время.
- (c) Показываем preview, по умолчанию галка «пропускать конфликты» включена; учитель может выключить → тогда любой конфликт = abort всего батча.
- Моё предложение: **(a)** — нынешний backend и так skip'ает idempotent, не блокируем учителя.

### Q6. Какие тарифы можно ассоциировать со слотом?
- (a) Любой существующий тариф учителя.
- (b) «По умолчанию» — текущий standard tariff + опция «другой».
- (c) Можно тариф НЕ выбирать → слот создаётся без price-hint (ученик потом увидит дефолтную цену из настроек учителя).
- Моё предложение: **(b)** — дефолт ускоряет, опционально переключаемся. Если тариф не выбран — берём первый по `sort_order` из `teacher_tariffs`.

### Q7. На мобилке — заменяем FAB полностью или дополняем?
- (a) Текущий FAB заменяем — теперь он открывает bulk-form (single или multi).
- (b) FAB → bulk-form, плюс отдельная кнопка «Один слот быстро» на странице слота.
- Моё предложение: **(a)** — bulk-form поддерживает one-shot (1 слот = bulk с N=1). Лишняя кнопка не нужна.

### Q8. Tracking — что логгировать?
Через events (analytics):
- `slot_bulk_form_opened` — properties: `{ surface: 'desktop_modal' | 'mobile_sheet' }`
- `slot_bulk_preview_requested` — `{ slot_count, conflict_count }`
- `slot_bulk_created` — `{ slot_count, days_span }`
- `slot_bulk_cancelled` — `{ at_step: 'config' | 'preview' }`
- Моё предложение: **все 4** — у нас analytics уже есть, бесплатно знать что юзают.

### Q9. Что если учитель выбрал день/время, который ВЫХОДНЫМ выпадает (например 1 января)?
- (a) Не парим — слот создаётся, ученик увидит «1 января 16:00» как обычно.
- (b) Слабый warning «эти даты — праздники, точно?» — продолжаем по умолчанию.
- (c) Skip — пропускаем праздники, показываем в preview.
- Моё предложение: **(a)** — учитель сам знает. Праздники могут быть удобными для занятий с детьми (родители дома). Не заботимся.

### Q10. На странице календаря — где конкретно живёт кнопка «+ Добавить слоты»?
- (a) В шапке, рядом с переключателем недель.
- (b) Отдельный плавающий button bottom-right (как FAB на десктопе).
- (c) Внутри пустых ячеек календаря — «+ слот здесь» при hover (как Cron.com).
- Моё предложение: **(a) шапка** + tooltip «или зажмите и тяните по календарю». На мобилке — sticky FAB справа внизу.

### Q11. Что с zoom_url (или meet url) для bulk-created слотов?
Сейчас bulk-create не задаёт zoom_url. Это окей?
- (a) Окей — учитель потом откроет каждый слот и добавит ссылку (если нужно). Большинство — Google Calendar event генерится автоматически с Meet.
- (b) В форме поле «Zoom URL по умолчанию для всех» — все N слотов получат одну ссылку.
- (c) В форме селект «Авто-Meet через Google Calendar» / «Без видео» / «Своя ссылка для всех».
- Моё предложение: **(a) пока окей**. Если попросят — добавим (b) полем.

### Q12. Empty-state hint на календаре про drag-paint?
Сейчас drag-paint скрытый. Минимальный фикс:
- (a) На календарь добавить мелкую подсказку: «Совет: зажмите ЛКМ и протяните, чтобы создать несколько слотов» — показывается первый раз, ученик прячет.
- (b) Никакого хинта — кто хочет, узнаёт случайно.
- (c) Туториал-overlay на первый заход в кабинет.
- Моё предложение: **(a)** — мелкая подсказка с возможностью dismiss. Дешёво.

---

## 4. Технические детали (черновик)

### 4.1. Новые / изменённые файлы

```
app/teacher/calendar/page.tsx                     — добавить кнопку "+ Добавить слоты" в шапку
app/teacher/calendar/client.tsx                   — state для open/close bulk-add modal
components/calendar/BulkAddSlotsForm.tsx          — НОВЫЙ — основная форма
components/calendar/BulkAddSlotsModal.tsx         — НОВЫЙ — wrapper modal/sheet (responsive)
components/calendar/MobileCreateFab.tsx           — переподключить на BulkAddSlotsModal
lib/scheduling/slots/bulk-preview.ts              — НОВЫЙ — server logic для preview
app/api/teacher/slots/preview-bulk/route.ts       — НОВЫЙ — POST endpoint
app/api/teacher/slots/bulk-create/route.ts        — без изменений (но добавим Zod валидации
                                                     для notes, и проверим duration whitelist)
lib/calendar/recurrence.ts                        — НОВЫЙ — pure function:
                                                     `expandRecurrence({startDate, endDate, daysOfWeek, times, durationMin}) => Array<{startUtc, duration}>`
```

### 4.2. Backend logic

`expandRecurrence()` — pure, easy to test:
```ts
function expandRecurrence(input: {
  startDate: string  // YYYY-MM-DD
  endDate: string
  daysOfWeek: Array<0|1|2|3|4|5|6>  // 0 = Sunday по ISO
  times: Array<string>  // ["16:00", "18:00"]
  durationMinutes: number
  tariffId: string | null
}): Array<{ startUtc: string; duration: number; tariffId: string | null }>
```

Все timestamp в Europe/Moscow (per migration 0031 invariant), потом cast в UTC. **No DST in MSK** — упрощает.

`POST /api/teacher/slots/preview-bulk`:
- Авторизация: teacher session.
- Zod schema валидирует input.
- `expandRecurrence()` → candidate slots.
- SQL: `select start_at, status from lesson_slots where teacher_account_id = $1 and start_at = any($2::timestamptz[])` → конфликты.
- Возвращает `{ willCreate: [...], conflicts: [...] }`.

`POST /api/teacher/slots/bulk-create` — уже существует, без изменений.

### 4.3. Edge cases / risks

- **Большой батч**: 7 дней × 5 времён × 13 недель = 455 слотов > 200 max. Backend вернёт 400 — frontend должен ограничивать в preview.
  - **Fix**: показать в форме счётчик «будет создано N слотов» live; если > 200 — отключить кнопку, показать «слишком много, уменьшите диапазон».
- **Concurrent edits**: два устройства учителя одновременно создают пересекающиеся слоты → backend idempotent skipped_conflicts покроет.
- **Timezone**: учитель в Москве, в UI всё в MSK. Если у него `account_profiles.timezone` ≠ MSK — нужно перевести (но Wave C по умолчанию MSK; вне scope этого PR).
- **Drag-paint backwards-compat**: drag-paint вызывает тот же `/api/teacher/slots/bulk-create`. Не ломаем.

---

## 5. Декомпозиция (sub-PR)

1. **slots-form-A** (preview endpoint):
   - `expandRecurrence()` (pure) + tests.
   - `POST /api/teacher/slots/preview-bulk` + Zod + integration test.
   - Empty-state hint на календаре (drag-paint).
   - Лог-события `slot_bulk_form_opened`, `slot_bulk_preview_requested`.
2. **slots-form-B** (desktop modal + form):
   - `BulkAddSlotsForm.tsx` + `BulkAddSlotsModal.tsx`.
   - Кнопка в шапке `/teacher/calendar`.
   - Лог-события `slot_bulk_created`, `slot_bulk_cancelled`.
3. **slots-form-C** (mobile sheet + replace FAB):
   - `MobileCreateFab` ↦ переоткрывает `BulkAddSlotsModal` (responsive).
   - Sticky-bottom CTA в form, safe-area, native pickers.

Codex-paranoia: plan-mode round по `docs/plans/slot-bulk-add-form-mobile-2026-06-09.md` после ответов §3. Wave-mode round после merge всех 3 sub-PR (epic-end).

---

## 6. Ответы владельца

**Round 1 (2026-06-09)** — владелец принял все мои дефолты Q1-Q12:
- Q1 → (c) modal на десктопе + full-screen sheet на мобилке.
- Q2 → (a) drag-paint оставляем рядом с формой.
- Q3 → (a) один общий UI для recurring и one-shot (по диапазону дат).
- Q4 → (a) до 90 дней вперёд.
- Q5 → (a) preview с конфликтами, кнопка «Создать» работает (skipped silently).
- Q6 → (b) дефолтный тариф — первый по `sort_order`.
- Q7 → (a) FAB заменяем — теперь bulk-form.
- Q8 → (всё) 4 события в analytics.
- Q9 → (a) праздники не парим, слот создаётся как обычно.
- Q10 → (a) кнопка в шапке `/teacher/calendar` + sticky FAB на мобилке.
- Q11 → (a) zoom_url не задаём в bulk-create (оставляем как сейчас).
- Q12 → (a) empty-state подсказка про drag-paint на календаре.

---

## 7. Self-review (round 1 — Claude)

См. §10 этого документа после второго прохода.

---

## 8. Меняем после ответов

- Финальная схема формы по §3.
- Финальная декомпозиция §5.
- `/codex-paranoia plan docs/plans/slot-bulk-add-form-mobile-2026-06-09.md`.
- После SIGN-OFF — sub-PR A.

---

## 9. Out of scope

- **Recurring как сущность в БД** (template). Мы expand'им в момент создания, без хранения шаблона. Если потом нужен «отредактировать расписание целиком» — это другой PR.
- **Двусторонняя синхронизация с Google Calendar** — слот → событие односторонне как сейчас.
- **Конфликты с Google Calendar внешним**. Сейчас `external_conflict_*` поля считают это, но bulk-create их не туда не сюда — out of scope.
- **Drag-paint на мобилке** — не делаем (touch drag через ячейки — UX-ад на маленьком экране).

---

## 10. Self-review (round 2 — после verify реальной схемы)

### 10.0. Что починено vs. round 1
- Прочитал `lib/scheduling/slots/mutations-write.ts:151-246` — `bulkCreateSlots()` НЕ использует advisory lock, полагается на `ON CONFLICT DO NOTHING` против partial unique index (mig 0035). Новый preview-endpoint + новая form НЕ нуждаются в advisory lock — следуем тому же паттерну.
- Прочитал `migrations/0031_lesson_slots_domain_invariants.sql:77-90` — **duration НЕ ограничен** check'ом. Comment: «pricing has 50-min product». Это меняет form UI:
  - Раньше предлагал select `30 / 45 / 60 / 90 / 120` — это произвольный белый список.
  - Реально: duration привязана к **тарифу**, через `assertTariffDurationMatches()` в bulkCreateSlots (строка 184).
  - **Implication**: в form поле «Длительность» появляется ТОЛЬКО когда тариф НЕ выбран; когда тариф выбран — duration берётся из тарифа автоматически. UI явно показывает «60 мин (из тарифа Стандарт)» disabled.

### 10.1. Новые [BLOCKER]-кандидаты (round 2)
- **B1. assertTariffDurationMatches**: если в форме learner выбрал тариф «Стандарт 60мин» — кнопка «Создать» должна быть disabled пока он не подгонит duration. Лучше: duration auto-set из тарифа, нельзя править. **Action в Sub-PR B**: имплементировать derived-duration-from-tariff.
- **B2. lesson_slots_start_in_business_hours** (06-22 МСК): expandRecurrence() должна явно фильтровать out-of-band candidates ДО preview. Иначе backend выдаст error 23514 ON CONFLICT не поймает (это check_violation, не unique). UX-impact: учитель видит preview с N слотами, нажимает Create, получает 500. **Fix**: `expandRecurrence()` фильтрует + reports `{ skipped: [...], skippedReason: 'outside_business_hours' }`. Preview показывает оба списка.
- **B3. lesson_slots_start_30min_aligned** (mig 0031:80-90): start_at MUST быть на :00 или :30 MSK. Если в form пользователь ввёл 16:15 — это invalid. **Fix**: time-picker step=1800 (30 мин) ИЛИ снизу формы валидация «время должно быть кратно 30 мин». Лучше — step="1800" в `<input type="time">`.
- **B4. Размер batch'а**: backend cap = 200. expandRecurrence() может произвести 7×5×13 = 455. Form должна:
  - (a) live-counter: показывает реальное число валидных слотов (после фильтрации business hours).
  - (b) если > 200 — disabled «Создать» с надписью «Слишком много. Уменьшите диапазон или число времён.»
  - Это уже было в плане; теперь проверяем что counter учитывает business-hours filtering.
- **B5. Конфликты — учитываем CANCELLED**: unique partial index (mig 0035) `where status <> 'cancelled'`. Это значит cancelled слот — НЕ конфликт. Preview-endpoint должен искать конфликты только с активными статусами. **Fix**: `select start_at, status from lesson_slots where teacher_account_id = $1 and start_at = any($2::timestamptz[]) and status <> 'cancelled'`.

### 10.2. Drag-paint hint (Q12 → a)
- Где живёт hint: в `components/calendar/SlotCalendar.tsx` (он рисует grid). Простой dismissible баннер сверху календаря: «Совет: зажмите ЛКМ и протяните по ячейкам, чтобы создать несколько слотов сразу.»
- Persist dismissal: `localStorage.lc_drag_paint_hint_dismissed_at`. Не показывается если установлено.
- Mobile: hint показывает «На телефоне нажмите + чтобы добавить слоты». Разные подсказки по `window.matchMedia`.

### 10.3. Точки расхождения / risks
- **Events для analytics** (Q8): добавить в `lib/analytics/registry.ts` 4 новых Zod-схемы:
  ```ts
  slot_bulk_form_opened: z.object({ surface: z.enum(['desktop_modal', 'mobile_sheet']) }),
  slot_bulk_preview_requested: z.object({ slot_count: z.number().int().nonnegative(), conflict_count: z.number().int().nonnegative() }),
  slot_bulk_created: z.object({ slot_count: z.number().int().min(1).max(200), days_span: z.number().int().nonnegative().max(90) }),
  slot_bulk_cancelled: z.object({ at_step: z.enum(['config', 'preview']) }),
  ```
- **A11y**: modal требует focus-trap, ESC закрывает, ARIA-live для preview-counter. **Action**: подключить `web-accessibility-wizard` в Sub-PR B.
- **TimePicker UX**: native `<input type="time" step="1800">` на iOS Safari не уважает step. **Workaround**: добавить onBlur валидацию + snap to nearest 30min.

### 10.4. Готовность к /codex-paranoia plan
**Готов**. Открытые [BLOCKER]-кандидаты B1-B5 нужно решить в plan-mode paranoia. Plan-mode round зацепит:
- Constraints из mig 0031 (B2, B3)
- Tariff-duration derived (B1)
- Backend cap + counter UX (B4)
- Partial unique index semantics (B5)

**Action перед запуском**: owner подтверждает запуск paranoia (per global mandate).

---

## OLD: Self-review (round 1)

Прошёл по документу — нашёл несколько gaps:

### 10.1. Закрытые в этом ревью
- **Counter в форме** (см. §4.3 risk про 200-slot cap) — добавлен в §2.1 «Предпросмотр» сначала был просто список; теперь явный live-counter «будет создано N слотов» и cap-warning.
- **Tariff selection default** (§3 Q6) — выбран дефолт «первый по sort_order» если учитель не задал; раньше было неоднозначно.
- **Праздники** (§3 Q9) — добавлен вопрос, мой ответ (а) явно прописан.

### 10.2. Открытые риски — нужно решить с владельцем
- **Q3.1 (открытое уточнение из promo-codes plan)** — не относится, упомянут только чтобы не забыть.
- **Recurring без шаблона** — если учитель захочет «пересоздать расписание целиком» (например изменить вторник 18:00 → 19:00 на всё лето), он не может одним кликом. Придётся отменять все вторничные + bulk-add заново. Сейчас это считаю acceptable trade-off — рассказать владельцу.

### 10.3. Risks к [BLOCKER] paranoia
- **Mig 0031 invariants** — duration MUST быть из allowed list. Я в форме предложил `30 / 45 / 60 / 90 / 120`. Надо проверить какие реально разрешены. **Action для Claude перед /codex-paranoia plan**: прочитать migration + lib/scheduling и подтвердить.
- **Auth / rate limit** — `/api/teacher/slots/preview-bulk` должен иметь rate limit (учитель не должен скриптом перегружать backend conflict-check). Не описал явно — добавить в §4.2.
- **Concurrent advisory lock** — drag-paint в существующей реализации использует advisory-lock для batch insert (надо проверить). Если использует, новая form должна следовать тому же паттерну. **Action**: грепнуть `pg_advisory` в `lib/scheduling/slots/`.

### 10.4. Что НЕ сделано в self-review
- **Дизайн-mocks**: текстовые скетчи; реального wireframe нет. Это уровень детализации plan-doc — оставляю.
- **A11y prescription**: aria-label на каждом контроле, focus management в modal — не описал. Wave должен подключить web-accessibility-wizard.
