# Эпик C: Финансовая карточка на /teacher home — компактнее

Status: SHIPPED 2026-06-16 · Owner: claude
Parent: `docs/plans/teacher-master-flow-2026-06-15.md`
Depends on: ничего (стоит параллельно с любыми)
Branch: `feat/finance-card-compact-2026-06-16`

## Round-1 self-review (2026-06-16)

Single-file CSS tweak — paranoia не требуется (нет API surface, нет data flow, только spacing).
Touch target compliance: row min-height 44px сохранён.
2-column grid из плана пропущен (out-of-scope, выйдет следующим эпиком если нужно).

---

## Зачем

Owner: «карточку финансовую надо сделать компактнее».

Текущая высота карточки (`components/teacher/home/finance-summary.tsx`) — **~260-280px**. Это 30-35% viewport-а на ноутбучном экране 1440×900 и почти весь экран на iPhone 14 (844px) когда на главную выгружается ещё чеклист + digest + upcoming + (новое) recent-past (эпик B).

С эпиком B на главной добавится карточка «Недавние прошедшие». Если финансовая останется ~280px — главная превратится в скролл-портянку. **Эпик C освобождает место для B.**

## Current state (research)

**Файл:** `components/teacher/home/finance-summary.tsx` (82 строки)
**Что показывает:**
- Hero label: «ЗАРАБОТАНО В <МЕСЯЦ>» (`fontSize 12px`)
- Hero number: `clamp(36px, 5vw, 44px)` — большой
- 1px divider
- 3 secondary rows clickable:
  - «Должны прямо сейчас» → `/teacher/payments`
  - «Предоплата у учеников» → `/teacher/learners`
  - «Ожидается на этой неделе» → `/teacher/calendar`

**Размеры (current):**

| Элемент | Property | Value |
|---|---|---|
| Section padding | `padding` | `24px 24px 20px` |
| Hero gap | `gap` | `8px` |
| Hero margin-bottom | | `20px` |
| Row min-height | | `44px` (iOS touch target) |
| Row padding | | `12px 0` |
| Row label | `fontSize` | `14px` |
| Row value | `fontSize` | `16px` |
| Divider margin | | `0 0 12px` |

**Текущая позиция:** PR #635 переместил карточку в самый низ страницы — это уже сделано.

## Целевая компактность

**Цель:** ~180-200px высота (≈25-30% редукция). Без потери информации — те же 4 числа, та же кликабельность.

### План правок (только spacing + font + layout, никаких новых tokens)

| Элемент | Было | Стало | Гран |
|---|---|---|---|
| Section padding | `24px 24px 20px` | `16px 20px 14px` | -16px суммарно |
| Hero number | `clamp(36px, 5vw, 44px)` | `clamp(28px, 4vw, 34px)` | -10px на desktop |
| Hero label | `12px` | `11px` | -1px |
| Hero margin-bottom | `20px` | `12px` | -8px |
| Divider margin | `0 0 12px` | `0 0 8px` | -4px |
| Row min-height | `44px` | `40px` | -4px × 3 = -12px |
| Row padding | `12px 0` | `10px 0` | -4px × 3 = -12px |
| Row label / value | `14/16px` | `13/15px` | минор |

**Дополнительно:**
- Перевод 3 secondary rows в **2-column grid** на desktop ≥600px (всё ещё кликабельные строки, но 2 в ряд). Mobile — список как сейчас.
- Hero number → inline с label: `Заработано в июне · 24 600 ₽` (одной строкой при достаточной ширине), на mobile — две строки.

### Итоговая высота
~180-200px desktop, ~220-240px mobile. Сэкономлено ~60-80px = 25-30%.

## Constraints

- **Accessibility:** iOS touch target 44px — нарушение если уменьшим row до 40px. **Решение:** оставить minHeight 44px на touch-устройствах (через media query / userAgent проверку?). Альтернатива: оставить 44px, экономить на padding между rows.
- **Tabular nums** — оставить (`fontVariantNumeric: tabular-nums`) для финансовых цифр.
- **Условный рендер** `if (!snapshot.emptyState.hasAnySlot) return null` — оставить.

## API / data — без изменений

Никаких правок query или helpers. `lib/billing/teacher-finance.ts:177+` `getTeacherFinanceSnapshot` остаётся as-is.

## Verification

**Unit:**
- `tests/teacher/home/finance-summary-compact.test.tsx` — рендер с full data → assert высота `<= 220px` (через JSDOM getBoundingClientRect mock)
- snapshot test чтобы детект кейс структуры

**Playwright walkthrough:**
- Login teacher → `/teacher` → screenshot до/после
- Resize 390×844 → screenshot mobile до/после
- Resize 360×800 → screenshot small-mobile

**Visual regression:** опционально, через chrome-devtools MCP `take_screenshot` с before/after.

## Effort

≈0.5 рабочего дня = 1 small PR. **Один файл `components/teacher/home/finance-summary.tsx` + 1 тестовый файл.**

Может работать параллельно с любым другим эпиком — никаких зависимостей.

## Risks

- **Owner может не согласиться с уменьшением hero number** (visual punch reduced). Mitigation: prep before/after screenshots для approval перед merge.
- **Touch-target compliance:** уменьшение до 40px row может flagged accessibility-проверкой. **Решение:** добавить media query чтобы на coarse-pointer устройствах rows оставались 44px.
- **Grid 2-col layout** на средних экранах (768-1024px) может смотреться нелепо (узкие колонки). Решение: breakpoint только ≥1024px.

## Out of scope

- Изменение data в финансовом snapshot (другие numbers)
- Анимации / motion
- Финансовый dashboard на отдельной странице (это другой эпик)

## Связанные

- Master plan: `docs/plans/teacher-master-flow-2026-06-15.md`
- Историческая карта finance-card: `docs/plans/finance-on-teacher-home-2026-06-09.md` (SHIPPED, hero-variant)
- PR #632 + #635 — текущая базовая разработка
- Партнёр-эпик: `docs/plans/teacher-lesson-history-2026-06-15.md` (B) — освобождённое место используется под «Недавние прошедшие»
