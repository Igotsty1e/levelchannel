# Owner decisions — финальные (2026-05-30)

Сессия завершена. Все владельческие решения зафиксированы здесь как single source of truth для следующей сессии.

---

## Часть 1 — 5 решений по оферте

| # | Решение | Дефолт | Финальный ответ owner |
|---|---|---|---|
| 1 | Модель "оператор + поручение" (+ `/saas/processor-terms` + audit-таблица teacher-write events) | ✅ ДА | ✅ ОКЕЙ |
| 2 | 14-дневный cooling-period для физлиц (возврат если не пользовался) | ✅ ДА | ✅ ОКЕЙ |
| 3 | Operator-managed — только определённый статус учителя | ИП/самозанятые | ⚠ **ОТЛОЖЕН В ДАЛЬНИЙ БЕКЛОГ** — см. часть 3 ниже |
| 4 | Раздельная подсудность B2B (Челябинск) / B2C (по выбору потребителя) | ✅ ДА | ✅ ОКЕЙ |
| 5 | Отдельная галочка на автосписания при оформлении подписки | ✅ ДА | ✅ ОКЕЙ |

## Часть 2 — Логотип (брендовый знак)

✅ **Выбран Option O v6** — ascending sine wave (3 humps Q/T-chain), rotated -28° around start, dual endpoint dots, vertically centered with "LevelChannel" wordmark.

✅ **Scope: Option A — единый бренд** (новый логотип везде, никаких L нигде).

Анимация: обе точки появляются одновременно (0-0.3s) → линия рисуется L→R (0.4-1.6s) → wordmark fade-in (1.7-2.3s) → бесконечный gentle pulse точек.

Источник: `public/brand-options/option-o-sine-wave.svg`, `option-o-sine-wave-animated.svg`, `option-o-mark-only.svg`.

React-компонент: `components/brand/brand-mark.tsx` — заменяет inline L во всех 9 touchpoints (favicon, site-header, home-page-client, teacher-landing-client, /offer, /pay, /checkout, /t/[slug]/pay).

## Часть 3 — Operator-managed в дальний беклог

**Owner: "Давай пока уберем в дальний беклог часть про прием платежей за учителей. Его надо продумать отдельно."**

Что это значит для текущего эпика:

- **Тарифы на старте — только Free / Mid / Pro** (наша подписка, мы НЕ держим деньги учеников).
- **Никаких выплат учителям** через нашу платформу.
- **Никаких чеков НПД** (Operator-managed не запускается).
- **Никакого ФНС API** (см. часть 4).
- **Никакого статус-чека НПД/ИП при регистрации** — регистрация открыта для всех.
- **Никаких агентских условий в оферте** — оферта сильно упрощается, остаётся только подписка SaaS-доступа.

Operator-managed = отдельный эпик в будущем, с собственным плановым документом, юридической проработкой, дизайном и реализацией.

## Часть 4 — ФНС API не нужен

**Owner: "Зачем нам ФНС апи?"**

Изначально ФНС API был в плане для проверки НПД-статуса при регистрации на Operator-managed. После решения отложить Operator-managed:

- Операционный механизм для всех остающихся тарифов (Free/Mid/Pro): **мы НЕ платим учителям**, только получаем подписку. Налогового агента нет.
- Учитель сам остаётся ответственным за свой налоговый статус.
- ФНС API убран из эпиков целиком.

Если когда-то запустим Operator-managed — workflow с чеками НПД (которые учитель сам прикладывает после каждой выплаты) проще и юридически надёжнее, чем API-проверка.

## Часть 5 — Что меняется в plan-doc PR #441

Следующая сессия должна:

1. Обновить `docs/plans/saas-offer-and-landing-redesign.md`:
   - §0z surface inventory — убрать упоминания Operator-managed tier как блокирующих
   - §1 Owner answers — обновить Q2 (3 тарифа вместо 4), Q4 (recurrent только Mid/Pro)
   - §2.A.1 CASE_PACKET — упростить, убрать questions about agency, НПД, % commission
   - §3.5 Launch gate — оставить только Mid/Pro как deferred CTAs (Operator-managed просто не существует)
   - Epic D (ФНС API) — удалить из бизнес-карты
   - §0z `lib/auth/teacher-learner-mutations.ts` — оставить только в контексте "оператор + поручение" модели (не для Operator-managed контекста)
2. Запросить **второй legal-rf-qa pass** на упрощённый драфт оферты (без Operator-managed раздела 3.4, без агентских условий, без чеков НПД).
3. Уточнить % комиссии в оферте — поскольку Operator-managed убран, commission cap не нужен. Просто прайс тарифов (Mid 300₽, Pro 800₽).

## Часть 6 — Что меняется в legal draft PR #442

Следующая сессия должна:

1. Переписать `saas-offer-draft-v1-final-qa-signed-off.md` → v2:
   - Удалить раздел 3.4 «Тариф Operator-managed» целиком.
   - Удалить раздел про агентскую схему (ГК 1005).
   - Удалить упоминания НПД-only регистрации.
   - Удалить упоминания чеков НПД и API «Мой налог».
   - Упростить раздел про выплаты — только подписка платформы, никаких money-flow между учеником и учителем.
   - Сократить определения соответственно.
2. Прогнать упрощённый draft через `legal-rf-qa` второй раз.
3. Подтвердить финальный body_md и заложить в DB-канонический seed.

## Часть 7 — Что меняется в design tokens PR #443

Никаких изменений по логотипу — Option O v6 финален. Однако:

- Pricing card компонент в Sub-B.3 должен показывать **3 тарифа** вместо 4 (Free / Mid / Pro).
- Карточка Operator-managed выпиливается или становится "Coming soon" внизу с email-mailto.

## Часть 8 — PR state на момент завершения сессии

| PR | Branch | Status | Что внутри |
|---|---|---|---|
| #441 | `plan/saas-offer-and-landing-redesign` | OPEN | Plan-doc, paranoia 11 rounds SIGN-OFF |
| #442 | `feat/sub-a-1-legal-rf-draft` | OPEN | Legal-rf draft v0 + v1 (qa SIGN-OFF) + OWNER-DECISIONS + OWNER-ANSWERS (этот файл) |
| #443 | `feat/sub-b-1-design-tokens-and-logos` | OPEN | Design tokens + 19 logo concepts + Option O финальный |
| #444 | `feat/sub-b-1c-logo-swap-atomic` | OPEN | `<BrandMark />` component + atomic swap 9 touchpoints |

## Часть 9 — Куда вернуться после рестарта

Команды для быстрого подхвата контекста:

```bash
gh pr list --state open --limit 10
cat docs/legal/saas-drafts/OWNER-ANSWERS.md  # этот файл
cat docs/plans/saas-offer-and-landing-redesign.md | head -100  # план
```

Главные приоритеты для следующей сессии:

1. **Сначала** — обновить документы под Operator-managed deferral (план + оферта draft v2).
2. **Параллельно** — запустить Sub-A.2-3-5 bundle (миграция БД + админка + согласие на /register + interstitial для существующих учителей + flag SAAS_OFFER_GATE_ENABLED) — это уже **сильно проще** без Operator-managed.
3. **Дальше** — Sub-B.2 (copy через content-strategist) + Sub-B.3 (landing rebuild с motion-токенами и magnetic cursor).
4. Sub-B.4 (a11y) + Sub-B.5 (perf).
5. Epic-end paranoia wave → ship.

Operator-managed эпик — отдельный плановый документ в будущем (черновик можно начать с раздела 3.4 текущего legal draft + ФНС-workflow с чеками).
