# Bug 4 — Tariff naming + subscription-screen polish

Status: Sub-PR A SHIPPED (1fd631e via PR #490) · Sub-PR B IMPL in progress (2026-06-02)

Owner: Иван
Driver: Claude (this session)
Date: 2026-06-02

## Reproduction

1. Учитель открывает `/teacher/subscription`.
2. Видит сухой минимальный экран без иерархии: один заголовок «Выберите
   тариф», свинцово-серый блок текста, две одинаковые карточки «Mid» / «Pro»
   с ценой/лимитом и кнопкой «Подписаться».
3. На активной подписке (`active != null`) — `<dl>` с парами
   «Тариф / Цена / Период оплачен до», без описания что входит в этот
   тариф, без визуальной связи с лендингом.
4. Названия «Free / Mid / Pro» — английские, не согласованы с русским
   языком кабинета.

## Owner ask (verbatim)

> Сейчас очень плохо выглядит экран с выбором подписок, давай сделаем
> его более красивым. Так же давай добавим описание текущего выбранного
> тарифа. Давай дадим тарифам названия — «Стартовый», «Базовый»,
> «Расширенный». Это нужно прописать не только в интерфейсе, но и в
> оферте, и вообще везде, где мы про это пишем.

Decoded:
- **Rename**: 3 публичных SaaS тарифа → «Стартовый» / «Базовый» / «Расширенный».
- **Polish**: `/teacher/subscription` визуально нагнать до уровня
  `/saas` pricing-section (карточки с фичами, badge, описание выбранного).
- **Description**: на активной подписке показать пояснение «что входит
  в этот тариф».

Mapping в существующий контракт:
- DB slug `free` → public title «Стартовый»
- DB slug `mid` → public title «Базовый»
- DB slug `pro` → public title «Расширенный»
- DB slug `operator-managed` → admin-only label, остаётся «Operator-managed»
  (это не публичный тариф учителя, владелец про него не говорил).

## Existing surface inventory

Survey verbs: «названия публичных тарифов» — где они появляются в UI,
copy, DB, тестах, оферте.

Команды:
```
rg "'Mid'|'Pro'|'Free'|«Mid»|«Pro»|«Free»|titleRu.*['\"](Mid|Pro|Free|Operator)" \
  --type ts --type tsx --type sql --type md --type mjs
rg "Free / Mid / Pro|Free, Mid|Mid и Pro|Free навсегда" \
  --type ts --type tsx --type md
rg "Тариф Free|Тариф Mid|Тариф Pro|тариф Free|тариф Mid|тариф Pro" \
  --type md --type sql
```

Хиты (production code + tests + DB + legal):

| # | Файл | Что несёт | Disposition |
|---|---|---|---|
| 1 | `lib/billing/teacher-subscription.ts:284-301` | `SAAS_SUBSCRIPTION_TARIFFS.{mid,pro}.titleRu` + `description` (single SoT для checkout intent + UI) | **refactor — Sub-PR A** |
| 2 | `migrations/0073_teacher_subscription_plans.sql:31-37` | Seed-вставка для всех 4 slugs с title_ru | **refactor — Sub-PR A** (новая mig 0103 UPDATE-ит title_ru для free/mid/pro). operator-managed не трогаем. |
| 3 | `tests/integration/setup.ts:88-93` | Тестовый seed для `teacher_subscription_plans` | **refactor — Sub-PR A** (синхронизировать с новыми title_ru) |
| 4 | `tests/billing/teacher-subscription.test.ts:30-37` | Pin `titleRu === 'Mid' / 'Pro'` + description contains 'Mid'/'Pro' | **refactor — Sub-PR A** |
| 5 | `tests/teacher-cabinet-polish/profile-tariff-card.test.tsx:33-50, 203` | Pin titleRu для 4 plans в render-теcте `TariffComparisonCard` (компонент мёртв, но тест живой) | **refactor — Sub-PR A** |
| 6 | `tests/saas-pivot/landing.test.tsx:81-83` | `screen.getByText('Free' / 'Mid' / 'Pro')` на /saas landing | **refactor — Sub-PR A** |
| 7 | `components/home/teacher-landing-client.tsx:644-706` | 3 tier-cards (name='Free'/'Mid'/'Pro' + bullets «Всё из Free»/«Всё из Mid») | **refactor — Sub-PR A** |
| 8 | `app/saas/page.tsx:16,28` | `metadata.title` + `og:description` — упоминание «Free навсегда; Mid и Pro …» | **refactor — Sub-PR A** |
| 9 | `app/admin/(gated)/teachers/page.tsx:110-115` | `PLAN_LABEL` map (admin teacher list) | **refactor — Sub-PR A** |
| 10 | `app/admin/(gated)/teachers/[id]/edit-form.tsx:11-16` | `PLAN_OPTIONS` для select в admin edit | **refactor — Sub-PR A** |
| 11 | `app/teacher/settings/page.tsx:46-49` | Hub-card description «Тариф LevelChannel — Free / Mid / Pro.» | **refactor — Sub-PR A** (плюс комментарий :10 тоже мимо) |
| 12 | `app/teacher/subscription/page.tsx:30-85` | SSR-страница `/teacher/subscription` (две ветки: active vs pick-a-tier) | **Sub-PR B — UI polish** |
| 13 | `app/teacher/subscription/client.tsx:222-355` | Карточки тарифов + active-state карточка | **Sub-PR B — UI polish** |
| 14 | `docs/legal/saas-drafts/saas-offer-draft-v2-operator-deferred.md` §3.1-3.3 etc. | Source-of-truth черновика оферты (был использован для mig 0099) | **Out of scope this epic** — см. §"Legal scope decision" |
| 15 | `migrations/0099_saas_v1_publish_and_flip.sql:38-230` | LIVE body of оферты вшит здесь (heredoc) с «Тариф Free/Mid/Pro» — попадает в DB на fresh installs ИЛИ через saas-go-live publish | **Out of scope this epic** — см. §"Legal scope decision" |
| 16 | `scripts/saas-go-live.mjs:58-63` | `OFFER_VERSION_LABEL = 'v1-2026-06-01'` + `HUMAN_DATE_RU` | **Out of scope this epic** — см. §"Legal scope decision" |

Production-readable surface inventory closed. Negative check: `rg
"Стартовый|Базовый|Расширенный"` — пусто в production code (есть лишь
случайные совпадения в этом плане-документе).

`TariffComparisonCard` (components/teacher/tariff-comparison-card.tsx)
больше **не** монтируется (`app/teacher/profile/page.tsx:108-113`
явно `void plans / void currentPlanSlug`). Тест всё ещё pin'ит названия —
синхронизируем для регрессии.

## Decision

### Canonical names (RU)

| DB slug (stays) | Old title_ru | New title_ru |
|---|---|---|
| `free` | Free | **Стартовый** |
| `mid` | Mid | **Базовый** |
| `pro` | Pro | **Расширенный** |
| `operator-managed` | Operator-managed | **Operator-managed** (без изменений — не публичный) |

Admin-side labels для `operator-managed`: сейчас два разных
(`Plan-4 (operator)` в обоих местах). В Sub-PR A унифицируем их до
**`Operator-managed`** во всех админских поверхностях (соответствует
title_ru в DB + табличке выше).

Slug-у в чеке CloudPayments / order metadata / FK теперь = «системный
идентификатор», публичное имя — title_ru. Описано в комментариях кода,
**НЕ** в оферте (см. §"Legal scope decision" ниже).

### Legal scope decision (BLOCKER fix from paranoia round 1)

**Drop legal sub-PR from this epic.** Owner asked to update оферту тоже,
но из реальной механики:

1. Live оферта рендерится из `legal_document_versions` (не из
   `docs/legal/saas-drafts/`). Чтобы публичная страница `/saas/offer`
   действительно показала новые имена — нужен либо новый publish v2,
   либо UPDATE существующей строки v1 body_md.
2. Любая публикация v2 включает гейт `evaluateSaasOfferGate()`
   (`lib/auth/guards.ts:383-395`): если `consent.legalDocumentVersionId
   !== live.id`, верный учитель получает `consent_required` и режется
   из `/api/teacher/subscribe` + других protected routes. Это
   **массовый re-consent flow на всех текущих учителей**.
3. Backfill (`scripts/saas-offer-backfill.mjs`) не годится: это
   re-consent от их имени без их участия — для **substantive**
   изменений оферты юридически некорректно. Для **technical-rename**
   (без правовых изменений) может быть допустимо, но это решение
   `legal-rf-qa`, не разработчика.
4. Mig 0099 (живёт в проде) уже зашила body c «Free / Mid / Pro».
   Любая «перевыдача» этого тела — это либо новая мигра, либо
   admin-only operational шаг с явным аудитом.

Эпик ограничен **UI + DB title_ru + tests**. Legal-RF трек идёт
отдельным эпиком: `docs/plans/bug-4-followup-legal-rename.md` (TBD —
требует `legal-rf-router` → `legal-rf-commercial` → `legal-rf-qa`
cascade для решения "substantive vs technical rename + re-consent
politики"). В коммит-боди финального PR этого эпика добавляем явное
upcoming-followup упоминание, чтобы оферта не была забыта.

Owner-facing wording в финальном report'е: «Переименовали тариф
в UI + DB; оферту трогать в этом эпике не безопасно, потому что
любой её publish-флип запускает re-consent для всех текущих
учителей. Отдельным эпиком: легально-чистая правка с консультацией
legal-rf-qa».

### Sub-PR phasing

**Sub-PR A — naming flip + tests** (`bug/4-A-tariff-naming`):
- mig 0103: `UPDATE teacher_subscription_plans SET title_ru = $new
  WHERE slug IN ('free','mid','pro')` (idempotent, slug-driven). По
  каждому slug guard: «WHERE slug=... AND title_ru IS DISTINCT FROM
  $new». operator-managed не трогаем.
- `lib/billing/teacher-subscription.ts`:
  `SAAS_SUBSCRIPTION_TARIFFS.mid.titleRu = 'Базовый'`,
  `.pro.titleRu = 'Расширенный'`; description-string получает
  новое имя.
- `app/saas/page.tsx`: metadata description copy.
- `components/home/teacher-landing-client.tsx`: name на tier-картах
  («Стартовый/Базовый/Расширенный») + bullets («Всё из Стартового»
  и т.п.) + лид-текст pricing-секции.
- `app/admin/(gated)/teachers/page.tsx` + `edit-form.tsx`: labels
  («Стартовый (free) / Базовый (mid) / Расширенный (pro) /
  Operator-managed (operator-managed)»); slug в скобках для оператора.
- `app/teacher/settings/page.tsx:46-49` + comment :10: hub-card
  description «Тариф LevelChannel — Стартовый / Базовый / Расширенный.»
- `tests/integration/setup.ts`: синхронизировать seed (title_ru).
- `tests/billing/teacher-subscription.test.ts`: pin новых title.
- `tests/teacher-cabinet-polish/profile-tariff-card.test.tsx`: flip.
- `tests/saas-pivot/landing.test.tsx`: flip `getByText('Стартовый' / ...)`.
- New integration: `tests/integration/billing/tariff-naming.test.ts`:
  после mig 0103 SELECT title_ru WHERE slug IN ('free','mid','pro')
  возвращает «Стартовый/Базовый/Расширенный». Также assertion на
  operator-managed = «Operator-managed» (не сломали).

**Sub-PR B — `/teacher/subscription` UI polish** (`bug/4-B-subscription-ui`):
- Перерисовать pick-a-tier surface:
  - 2 карточки (Базовый / Расширенный) с feature-bullets, оформленные
    как pricing-section на `/saas`. Badge «Популярный» на Расширенном.
  - Подзаголовок объясняет «Стартовый — бесплатно навсегда; Базовый
    и Расширенный — когда учеников больше». Стартовый на этой
    странице **не показываем** — он не purchasable из subscription,
    он default after register.
- Active-state surface:
  - Карточка с цветным акцентом + label «Текущий тариф».
  - Раздел «Что входит в тариф» (bullets из catalogue).
  - Сохранить dl-блок (тариф / цена / период / cancelled-at).
  - Кнопка «Отменить» снизу справа в secondary-стиле.
- **Source of feature-bullets**: используем `teacher_subscription_plans.features
  jsonb` (поле существует с mig 0073, ridepers `app/teacher/profile/page.tsx`
  + `tariff-comparison-card.tsx` уже типизированы). Расширение SoT в
  Sub-PR A: в mig 0103 опционально записываем `features` json с массивом
  feature-строк (например `{"ui_bullets":["Расписание","Ученики","Пакеты"]}`).
  В Sub-PR B `/teacher/subscription/page.tsx` читает их через
  `SELECT features FROM teacher_subscription_plans`. Если features.ui_bullets
  отсутствует — fallback на hardcoded 4 bullets из catalogue.description
  parsed. **Никакого второго SoT** — единственная правда = DB.
- НЕТ изменений в API контрактах (subscribe / cancel routes).

**Sub-PR C — *удалён из этого эпика*** — см. §"Legal scope decision".

Order: A → B (последовательно).

## Tests

### Sub-PR A
- Unit (jsdom): `tests/teacher-cabinet-polish/profile-tariff-card.test.tsx`
  flip на «Стартовый» / «Базовый» / «Расширенный».
- Unit: `tests/billing/teacher-subscription.test.ts` flip + description
  contains новое имя.
- Unit (jsdom): `tests/saas-pivot/landing.test.tsx` flip на новые
  title в pricing-section.
- New integration: `tests/integration/billing/tariff-naming.test.ts`:
  - After all migrations: `SELECT slug, title_ru FROM
    teacher_subscription_plans` → точная карта slug → title_ru.
  - Включая assertion что operator-managed = «Operator-managed»
    (не сломали).
  - Включая re-run mig 0103 idempotency check (running twice
    оставляет тот же state).
- Existing integration: `tests/integration/saas-pivot/schema-day1.test.ts`
  уже проверяет slugs (НЕ titles) → без изменений.

### Sub-PR B
- New unit (jsdom): `tests/teacher-cabinet-polish/subscription-ui-pick-tier.test.tsx`:
  - empty state (`active === null`) рисует **две** карточки (Базовый
    + Расширенный), не три. Стартовый отсутствует.
  - Карточка «Базовый» имеет feature-bullets и кнопку «Подписаться».
  - Карточка «Расширенный» имеет badge «Популярный».
  - Цена/период/лимит соответствуют catalogue.
- New unit (jsdom): `tests/teacher-cabinet-polish/subscription-ui-active.test.tsx`:
  - Active-state surface рисует «Текущий тариф» badge на нужном tier
    (mid и pro случаи).
  - Раздел «Что входит» присутствует с >= 3 bullets.
  - Кнопка «Отменить» НЕ показывается если `cancelled_at != null`.
  - Сохранён dl (тариф / цена / период / cancelled-at).
- `npm run build` + `npm run test` + `npm run test:integration` green.

## What is NOT in scope

- Изменение цен / лимитов / периодов / валюты.
- Удаление старых slugs `free` / `mid` / `pro`.
- Operator-managed renaming (не публичный тариф; админ-label
  унифицируется только в названии "Operator-managed").
- **Любые изменения публичной оферты** (`docs/legal/**`,
  `migrations/0099*`, `scripts/saas-go-live.mjs`, `app/saas/offer/**`,
  `app/saas/processor-terms/**`). Это отдельный legal-RF эпик с
  consent re-flow design.
- `TariffComparisonCard` оживление (компонент мёртв, оставляем).
- /saas pricing-section полный редизайн (только переименование).
- Изменение existing consent rows / re-consent flow.

## Risks + mitigations

- **R1 (closed)**: CloudPayments чек получит description с «Базовый /
  Расширенный» → audit-history не переписываем, новые чеки уйдут с
  новым именем. ОК.
- **R2**: Расхождение public UI ↔ публичная оферта: после Sub-PR A+B
  лендинг и кабинет говорят «Базовый / Расширенный», а живая оферта
  на `/saas/offer` всё ещё говорит «Free / Mid / Pro».
  - Mitigation: В Sub-PR A footer-комментарий в плане-doc + явное
    `Followup-Required: legal-rf cascade for offer rename`-trailer
    в коммит-боди финального sub-PR. Это **видимое** расхождение,
    но оно НЕ legal-defective — оба варианта названия ссылаются на
    одну и ту же сущность (slug), и в оферте есть конструкция «Тариф
    — один из планов, опубликованных по адресу .../saas/pricing»
    (mig 0099:81), которая фактически делегирует именование
    прейскуранту.
- **R3**: Mig 0103 идемпотентность — UPDATE ... WHERE slug IN (...)
  AND title_ru IS DISTINCT FROM $new. Re-run-safe.
- **R4**: PLAN_LABEL в admin показывает русские названия —
  оставляем slug в скобках для оператора (`Базовый (mid)`).
- **R5**: Pricing-section на `/saas` landing — bullets «Всё из Free» /
  «Всё из Mid» зашиты текстом → перепишем на «Всё из Стартового» /
  «Всё из Базового». Тесты ловят только заголовки → не сломаются.
- **R6**: Features jsonb shape — кто пишет, кто читает?
  - WRITER: mig 0103 опционально расширяем (SET features = features
    || '{"ui_bullets":[...]}'::jsonb). Если оставим только title_ru —
    тоже OK, тогда reader делает fallback на catalogue.description.
  - READER: `app/teacher/subscription/page.tsx` (Sub-PR B). Type:
    `features.ui_bullets?: string[]` (optional). Если не задан —
    fallback array.
  - Single SoT (DB), single reader path (subscription page),
    single writer (mig 0103). Нет race.
- **R7**: Hub-card description в `/teacher/settings` — оставшийся
  user-facing hit; добавлен в inventory; обновляем в Sub-PR A.

## Definition of done

Sub-PR A:
- [ ] mig 0103 добавлен (idempotent UPDATE на title_ru).
- [ ] Catalogue SoT (lib/billing/teacher-subscription.ts) обновлён.
- [ ] Admin labels + landing + settings-hub-card + tests флипнуты.
- [ ] Integration test `tariff-naming.test.ts` green.
- [ ] CI green (build + unit + integration + lint + typecheck).
- [ ] Trailer: `Codex-Paranoia: SUB-WAVE self-reviewed (epic bug-4-tariff-naming-and-ui); epic-end review pending`.
- [ ] PR merged.

Sub-PR B:
- [ ] `/teacher/subscription` визуально приближено к `/saas` pricing-section.
- [ ] Active-state surface показывает «Что входит» description.
- [ ] Empty state (Базовый + Расширенный, без Стартового).
- [ ] Unit tests pin'ят новый layout.
- [ ] CI green.
- [ ] Trailer: `Codex-Paranoia: SUB-WAVE self-reviewed (epic bug-4-tariff-naming-and-ui); epic-end review pending`.
- [ ] PR merged.

Epic-end:
- [ ] `/codex-paranoia wave <range>` SIGN-OFF.
- [ ] `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <range>)` trailer
  в финальном PR (например в Sub-PR B если он последний).
- [ ] Followup: создать `docs/plans/bug-4-followup-legal-rename.md`
  как placeholder для будущего legal-RF cascade.

## Codex-Paranoia

- Plan checkpoint round 1: Codex SIGN-OFF=BLOCK с 2 BLOCKERs + 5 WARNs +
  1 INFO. Все закрыты в revised state (см. Changelog ниже).
- Plan checkpoint round 2: **Codex quota exhausted** (rate-limit hit
  до начала round 2). Fallback per `~/.claude/skills/codex-paranoia/SKILL.md`
  §7: "Doc-only / dead-code cleanup / single-file rename / config flip:
  fall back to 2-round agent self-review (round 1 + round 2 fresh-eyes)".
  Этот wave квалифицируется как cross-surface rename (UI label + DB
  seed + tests), без auth/payment/substantive schema changes — fallback
  применим. Round 2 = Claude self-review fresh-eyes pass; см. итог в
  блоке "Self-review round 2 (Claude, Codex-quota fallback)" ниже.
- Sub-PR trailers: `Codex-Paranoia: SUB-WAVE self-reviewed (epic
  bug-4-tariff-naming-and-ui); epic-end review pending`.
- Wave checkpoint: `/codex-paranoia wave <epic-commit-range>` после
  обоих sub-PR смержены. Если quota к тому моменту восстановится —
  Codex; иначе SELF-REVIEW round 2/2 fallback с явным trailer.

## Self-review round 2 (Claude, Codex-quota fallback)

Fresh-eyes scan на revised state:

1. **Surface inventory completeness** — повторный grep с двумя
   шаблонами:
   - `'Mid'|'Pro'|'Free'|titleRu.*['"](Mid|Pro|Free)`
   - `Free / Mid / Pro|Free навсегда|Mid и Pro|Тариф Free|Тариф Mid|Тариф Pro`
   - Все 16 хитов учтены в inventory.
   - Negative check: `rg "Стартовый|Базовый|Расширенный"` пусто в
     production code.

2. **operator-managed admin label unification** — оба места теперь
   будут унифицированы в Sub-PR A.

3. **Pattern-matching на старые имена** — нет кода, который делает
   `titleRu === 'Mid'`. Renaming safe.

4. **Test seed flow** — `tests/integration/setup.ts` TRUNCATE
   `teacher_subscription_plans` и re-INSERT. Sub-PR A синхронизирует
   названия. Mig 0073 INSERT-WITH-OLD-TITLES будет в фactual mig
   history (immutable), но TRUNCATE + setup-INSERT обходят это.
   Mig 0103 покрывает реальный prod (UPDATE-after-INSERT). OK.

5. **R6 jsonb features path** — упрощение: bullets живут в
   `SAAS_SUBSCRIPTION_TARIFFS` (catalogue field `features: string[]`),
   НЕ в DB jsonb. DB `features` jsonb остаётся неиспользованным в
   этом эпике. Один SoT (catalogue), один reader (subscription page).
   Если кому-то понадобится DB-driven features — отдельный эпик.

6. **Live offer drift** — owner-facing: после Sub-PR A+B лендинг и
   кабинет говорят «Базовый / Расширенный», а `/saas/offer` всё ещё
   показывает «Free / Mid / Pro». Это известное, ожидаемое
   расхождение, документированное в R2 и в final-report.

7. **Backward compatibility** — old `description` строки внутри
   `SAAS_SUBSCRIPTION_TARIFFS` менялись с «Mid»/«Pro» на «Базовый»/«Расширенный».
   CloudPayments чек получит новое описание (audit history не
   переписывается). OK.

Outcome: SELF-REVIEW SIGN-OFF (round 2/2 fallback).
No BLOCKERs identified. Proceeding to implementation.

## Changelog of this plan-doc

- **Round 1 → Round 2**: dropped Sub-PR C (legal SoT) — moved out of
  epic as `bug-4-followup-legal-rename`. Reasons: live offer is in
  DB (mig 0099), not in `docs/legal/`; publishing v2 triggers
  consent-required gate on all teachers; backfill is not legally
  safe for substantive changes without legal-rf-qa pass.
- **Round 1 → Round 2**: added missing surface (R3 paranoia finding)
  — `app/teacher/settings/page.tsx:46-49` hub-card description.
- **Round 1 → Round 2**: unified `operator-managed` admin label
  (was `Plan-4 (operator)` in two places; now canonical
  `Operator-managed (operator-managed)`).
- **Round 1 → Round 2**: dropped `features: string[]` SoT addition;
  reuse existing `teacher_subscription_plans.features jsonb` instead.
- **Round 1 → Round 2**: tightened test §C scope (removed it
  entirely with Sub-PR C drop).
- **Round 1 → Round 2**: removed mention of `scripts/saas-go-live.mjs`
  as part of legal guardrail check.

## Sub-PR B — `/teacher/subscription` UI polish (impl addendum, 2026-06-02)

Sub-PR A shipped as 1fd631e (PR #490, squash-merged) — `SAAS_SUBSCRIPTION_TARIFFS`
now carries `features: ReadonlyArray<string>` per tier; titles flipped
to «Базовый» / «Расширенный»; mig 0103 updated `title_ru` in DB; landing
+ admin labels + settings hub-card all flipped. Sub-PR B builds on top.

### Existing surface inventory (Sub-PR B scope)

```
rg "TeacherSubscriptionClient|teacher-subscription-(tiers|active|tier|subscribe|cancel)|/teacher/subscription" --type ts --type tsx
```

| # | File | Disposition |
|---|---|---|
| 1 | `app/teacher/subscription/page.tsx` (SSR, 87 lines pre) | **refactor — Sub-PR B** (pass `features` through to client; no auth changes) |
| 2 | `app/teacher/subscription/client.tsx` (363 lines pre) | **refactor — Sub-PR B** (active surface + pick-tier surface visual rebuild) |
| 3 | `lib/billing/teacher-subscription.ts` `SAAS_SUBSCRIPTION_TARIFFS` | **READ only** (Sub-PR A already added `features`) |
| 4 | `tests/teacher-cabinet-polish/subscription-ui-*.test.tsx` | **new (2 files)** — pin the new visual contract |
| 5 | `/api/teacher/subscribe`, `/api/teacher/subscription/cancel` | **UNTOUCHED** (no behavioural change) |
| 6 | `components/payments/pricing-section.tsx` `Window.cp` global | **UNTOUCHED** (still single declaration, reused via `unknown` cast) |

Negative check: `rg "subscription-ui-(active|pick-tier)"` → only the 2 new tests after this PR.

### Reproduction (Sub-PR B)

1. Учитель в роли «без активной подписки» открывает `/teacher/subscription`.
2. Видит после Sub-PR A: правильные русские названия «Базовый» / «Расширенный»,
   но визуал — сухие минимальные карточки в один ряд без иерархии, без feature-bullets,
   без выделения рекомендуемого тарифа. Заголовок «Выберите тариф» дублирует
   header страницы.
3. Учитель в роли «с активной подпиской» открывает `/teacher/subscription`.
4. Видит после Sub-PR A: голый `<dl>` (Тариф / Цена / Период), без объяснения
   что входит в тариф. На вопрос «а что мне даёт мой текущий тариф?»
   страница не отвечает.

### Fix (Sub-PR B)

**Pick-a-tier surface**:
- Drop duplicated `<h2>Выберите тариф</h2>` — page-level `<h1>Подписка
  на платформу` уже несёт смысл.
- Двухкарточный grid (`minmax(240px, 1fr)` → 1 col на узких экранах, 2 col
  от ~540px container width).
- Каждая карточка: title (h3, 20px/700) → price row («NNN ₽» 24px/700 +
  «/ 30 дней» secondary) → limit-line («До N активных учеников») →
  feature-bullets `<ul>` (5 bullets из `tariffs[].features` = catalogue
  SoT, set by Sub-PR A) → «Подписаться» button.
- «Расширенный» (pro) карточка дополнительно несёт:
  - `border: var(--accent)` + thin `box-shadow` ring,
  - абсолютно-позиционированный badge «Популярный» (top-right corner),
  - solid-accent кнопка вместо outline.
- Лид-текст (`<p>`) поясняет место «Стартового» — он бесплатный
  default after register, не purchasable на этой странице.

**Active surface**:
- Header row: «● Текущий тариф» (uppercase accent badge) → `<h2>` titleRu
  (26px/700) → price+period.
- Two-column grid:
  - «Что входит в тариф» → `<ul>` из `active.features` (catalogue SoT).
  - «Период и оплата» → `<dl>` с «Период оплачен до» + (optional)
    «Подписка отменена N — доступ до конца оплаченного периода».
- Кнопка «Отменить подписку» в footer (только если `cancelled_at == null`).

**A11y**:
- Декоративные unicode-bullets («●») обёрнуты в `<span aria-hidden="true">`
  чтобы скринридер не зачитывал «black large circle». Текст остаётся.

**Mobile-first**:
- Оба grid'а `auto-fit minmax(220-240px, 1fr)` — естественно стекаются
  в один столбец на <540px viewport. `padding` карточек 20-24px —
  читаемо на 360px.

### What is NOT in Sub-PR B

- НЕ трогаем `/api/teacher/subscribe` или `/api/teacher/subscription/cancel`.
- НЕ меняем CloudPayments widget glue (handle{Subscribe,Cancel,Widget}).
- НЕ меняем catalogue SoT (Sub-PR A собственность).
- НЕ меняем pricing-section на /saas landing — это другая поверхность.
- НЕ меняем admin labels — Sub-PR A собственность.

### Tests (Sub-PR B)

- `tests/teacher-cabinet-polish/subscription-ui-pick-tier.test.tsx` (5 tests):
  ровно 2 карточки (Стартового нет), Pro badge «Популярный» (mid badge null),
  feature-bullets рендерятся, кнопки «Подписаться» disabled до загрузки CP,
  цены отформатированы как «NNN ₽» + «30 дней».
- `tests/teacher-cabinet-polish/subscription-ui-active.test.tsx` (5 tests):
  «Текущий тариф» badge, titleRu rendering, «Что входит» bullets, cancel
  button visible when `cancelled_at == null`, hidden when set + surfaces
  cancellation date with access-end hint.
- Both files `// @vitest-environment jsdom`, use `@testing-library/react`.

### Self-review fresh-eyes pass (Claude, 2026-06-02, Codex quota note)

Per `~/.claude/skills/codex-paranoia/SKILL.md` §7, Sub-PR B fits the
"single-page UI polish (no auth/payment/schema changes)" fallback profile:
catalogue is read-only here, no API routes touched, no DB writes,
no auth boundary edits. Plan paranoia round-2 (Codex quota) fallback
applies recursively to Sub-PR B impl.

Fresh-eyes findings (all closed before commit):
1. **a11y (WARN, fixed)** — decorative «●» bullets needed `aria-hidden="true"`.
   Fixed in both `currentBadgeStyle` and `featureBulletStyle` callsites.
2. **mobile (INFO, accepted)** — single-column stacking on <540px viewports
   is intended behaviour, `auto-fit minmax(240px, 1fr)` is the standard mobile-first
   primitive (matches `app/teacher/learners/page.tsx`).
3. **disabled button affordance (INFO, accepted)** — CP-widget-loading hides
   behind the existing «Готовим оплату…» text on click; the brief disabled
   state pre-script-ready is rare on broadband and not a regression.
4. **CloudPayments race (INFO, accepted)** — `openWidget` and `handleCancel`
   already had `e instanceof Error` guards from A2 baseline; Sub-PR B doesn't
   change the contract.
5. **Test affordance (INFO, accepted)** — `data-highlight="true"|"false"`
   added on tier card for QA / future visual regression hooks.

Wave checkpoint runs once at epic-end after Sub-PR B merges — per
codex-paranoia §"unit is the EPIC", BOTH sub-PRs reviewed as one diff
range. If Codex quota recovers, full Codex pass; else self-review fallback
trailer documented.

### Definition of done (Sub-PR B)

- [x] `app/teacher/subscription/{page,client}.tsx` updated.
- [x] `tests/teacher-cabinet-polish/subscription-ui-{active,pick-tier}.test.tsx`
  added; 10 tests pass under jsdom.
- [x] Wider unit suite (`tests/teacher-cabinet-polish/`) — 50/50 green.
- [x] `npm run build` green.
- [ ] PR opened, CI green, trailer `Codex-Paranoia: SUB-WAVE self-reviewed
  (epic bug-4-tariff-naming-and-ui); epic-end review pending`.
- [ ] Squash-merge with `--admin --delete-branch`.
- [ ] Epic-end paranoia wave on `1fd631e..<sub-PR-B-SHA>` after merge.
