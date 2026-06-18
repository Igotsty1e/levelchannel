# Tariff reprice — Mid → «Оптимальный», free 3 учеников, Pro depublish (A.1)

**Status:** in progress (2026-06-18)
**Epic:** owner-backlog 2026-06-18 / Epic A.1 (часть 1 из 2; A.2 — годовой тариф отдельным PR)
**Branch:** `feat/tariffs-reprice-mid-to-optimal-2026-06-18`
**Trailer:** `Codex-Paranoia: SELF-REVIEW round 1/3 (codex quota exhausted)` + `Legal-Pipeline-Verified: <commit-range>` + `Skill-Used: /codex-paranoia plan, /codex-paranoia wave, /ship, /document-release`.

## Context

Owner-задача из бэклога 2026-06-18: переделать ценообразование.

- **Стартовый**: до 1 ученика → **до 3 учеников**. Цена 0 ₽ навсегда. Все функции платформы.
- **Базовый** → **«Оптимальный»**, 300 ₽ → **399 ₽/мес**, лимит 5 → **NULL** (без ограничения).
- **Расширенный** (Pro): удалить из публичного каталога. DB-строка остаётся для legacy/operator-managed flow и истории платежей.
- **Годовой 4 000 ₽** — отдельный PR (A.2), эта часть только месячный.

**Pre-flight (owner подтвердил в plan-mode 2026-06-18):**
- Активных подписок на `pro` сейчас НЕТ → safe depublish.
- Активных подписок на `mid` НЕТ или единицы → safe price flip без grandfather-cohort.

## Существующая поверхность (Survey-before-plan)

Команда: `rg -ln 'SAAS_SUBSCRIPTION_TARIFFS|Базовый|Расширенный|Mid.*Pro|teacher_subscription_plans' app/ lib/ components/ tests/ migrations/ docs/`

Затрагиваемые файлы (per-hit disposition):

| Файл | Что внутри | Disposition |
|---|---|---|
| `lib/billing/teacher-subscription.ts:306-355` | `SAAS_SUBSCRIPTION_TARIFFS` SoT, `getSubscriptionTariff`, `getPaidSubscriptionTariff` | **refactor** — обновить `free.learnerLimit` 1→3 + features; переименовать `mid.titleRu` Базовый→Оптимальный, price 30000→39900, `learnerLimit` 5→null; features уточнить. `pro` остаётся (legacy webhook), description в комментарии помечается «archived from public catalogue». |
| `app/teacher/subscription/page.tsx:50` | `(['free', 'mid', 'pro'] as const).map(...)` | **refactor** — массив `['free', 'mid'] as const`. Pro не показывается в кабинете. |
| `app/teacher/subscription/client.tsx` | UI карточек (active + picker), `Tariff` type | **refactor** — обновить description ("Стартовый для трёх учеников"), Pro исчезает из render. |
| `components/saas/landing-v3/screens/08-pricing.tsx:24-72` | `TIERS` массив на landing | **refactor** — обновить 3 тарифа (free 3 учеников, optimal без лимита 399 ₽, pro — удалить из массива; добавление annual — в A.2). Обновить hook на «Попробуй бесплатно. Год — выгоднее всего.» (annual карточка идёт в A.2). |
| `migrations/0073_teacher_subscription_plans.sql:30-39` | seed строки free/mid/pro/operator-managed | **refactor через 0134** — `UPDATE teacher_subscription_plans` с новыми значениями; pro строка не меняется. |
| `migrations/0099_saas_v1_publish_and_flip.sql:38-230` | публичная оферта (heredoc markdown с ценами) | **refactor через 0135 (новая legal_document_version)** — вставить новую публикацию оферты с обновлёнными ценами и тарифами; старая остаётся в истории. Legal-Pipeline-Verified. |
| `lib/onboarding/teacher-plan-limit.ts` | проверка `learner_limit` при invite | **refactor** — поддержать `learner_limit === null` как unlimited. |
| `tests/billing/teacher-subscription.test.ts` | pin titleRu + amountKopecks | **refactor** — обновить ожидания. |
| `tests/integration/setup.ts:88-93` | seed тарифов | **refactor** — обновить seed. |
| `tests/integration/saas-pivot/teacher-tariffs.test.ts` | проверки тарифов | **refactor** — обновить ожидания. |
| `tests/integration/billing/tariff-naming.test.ts` | имена тарифов | **refactor** — обновить ожидания. |
| `tests/teacher-cabinet-polish/subscription-ui-pick-tier.test.tsx` | UI render тесты | **refactor** — обновить ожидаемое количество карточек (3→2) + новые имена. |

Файлов, которые НЕ трогаем в A.1:
- `lib/payments/teacher-subscription.ts` / CloudPayments webhook — оставляем поддержку `pro` (legacy).
- `app/api/teacher/subscribe/route.ts` — поддерживает `mid` и `pro`, не трогаем (operator может вручную выдать pro).
- `migrations/0117_saas_offer_v1_editorial_tariff_aliases...sql` — aliases не нужны для новой оферты, оставляем как history.

## План имплементации

1. **`docs/plans/tariff-reprice-2026-06-18.md`** — этот файл.
2. **`migrations/0134_tariff_reprice_2026.sql`** — `UPDATE teacher_subscription_plans` для free/mid; pro не трогаем (UI просто перестаёт его показывать; admin при необходимости вручную выдаёт).
3. **`migrations/0135_saas_offer_v2_reprice_2026.sql`** — INSERT новой `legal_document_versions` записи `saas_offer` с обновлёнными тарифами/ценами в body. Старая запись остаётся в истории. **Legal-Pipeline-Verified.**
4. **`lib/billing/teacher-subscription.ts`** — `SAAS_SUBSCRIPTION_TARIFFS`: free.learnerLimit=3 + features, mid.titleRu="Оптимальный" amountKopecks=39900 learnerLimit=null + features. Pro строка остаётся.
5. **`app/teacher/subscription/page.tsx`** — массив `(['free', 'mid'] as const)` (без pro).
6. **`app/teacher/subscription/client.tsx`** — lead-копи обновить под новый Стартовый/Оптимальный.
7. **`components/saas/landing-v3/screens/08-pricing.tsx`** — TIERS: free 3 учеников + Оптимальный (без лимита) + (annual в A.2). Hook = «Попробуй бесплатно. Год — выгоднее всего.» (а пока в A.1 ставлю существующий хук с italic на «без лимита»; в A.2 окончательно).
8. **`lib/onboarding/teacher-plan-limit.ts`** — обработка `learner_limit === null`.
9. **Тесты** — обновить fixtures + assertions.
10. **`npm run test:run` + `build` + `check:env-contract` + `check:content-style` + `check:legal-pipeline`** — все зелёные.
11. **Self-review pass** (Codex недоступен — fallback per memory `codex_quota_exhausted...`): manual adversarial pass + `~/.team/bin/log-event claude block --tags paranoia,codex-debt`.
12. **`/ship`** PR с trailers.

## Risks

- **Pro строка legacy**: webhook `cloudpayments/pay` всё ещё принимает `productKind = 'subscription_pro'`. Если в UI убрали кнопку, риск — operator или legacy URL может попасть. Допустимо — оставляем как admin-эскейп.
- **Изменение `learner_limit` на NULL** — нужно протестировать `lib/onboarding/teacher-plan-limit.ts` чтобы он принимал NULL как «∞» (a не «0»).
- **Pricing carry-over**: тесты на amount могут падать из-за 39900 vs 30000. Все обновлены в A.1.
- **Юр-чувствительность**: новая оферта 0135 → `Legal-Pipeline-Verified` trailer обязателен. Hook `.githooks/commit-msg` блокирует commit без trailer.
- **Доступ к UI после миграции**: учители на mid с lease, у которых period_end будущий — получат «Оптимальный» как название (через `titleRu` rename) автоматически. Цена в UI отображается из `amount_kopecks` в подписке — оригинальная 30000 ₽. Это OK по описанию owner (grandfather).

## Verification

- `npm run test:run` ⏱ ~30s.
- `npm run build` ⏱ ~60s.
- `npm run check:env-contract`.
- `npm run check:content-style` (новые тексты).
- `npm run check:legal-pipeline` (mig 0135).
- Playwright walkthrough: `/` pricing-section (3 карточки: Стартовый 0₽/3 ученика, Оптимальный 399₽/без лимита) + `/teacher/subscription` (свободно или с активной mid-подпиской — теперь отображается «Оптимальный» в UI).
- chrome-devtools console + network — clean.

## Out of scope (→ A.2)

- Годовой тариф 4 000 ₽ (отдельный PR — нужна CloudPayments конфигурация `periodDays=365` one-shot).
- Toggle Месяц/Год на landing + cabinet.
- Editorial-блок с экономией внутри карточки.
- Полная подмена offer body на v3 (в A.1 — версия с месячными тарифами; в A.2 — добавляем годовой раздел).
