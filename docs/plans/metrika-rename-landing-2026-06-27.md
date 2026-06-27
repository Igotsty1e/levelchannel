# План: включить Yandex.Метрику корректно (152-ФЗ) + rename + вычитка landing-v3

## Context

«CSP-ошибка» оказалась заблокированной Yandex.Метрикой (Webvisor = запись сессий), выключенной CSP. Owner решил (2026-06-27): включить Метрику, раскрыть во всех документах, всё через пайплайн. Codex-paranoia раунд 1 (6 BLOCKER) + раунд 2 (5 BLOCKER) вычистили план до безопасной последовательности.

Цель: Метрика работает легально (раскрыта + маскирует PII), публичные обещания честные, лендинг вычитан. **Включение Метрики — САМЫЙ ПОСЛЕДНИЙ шаг, после того как раскрытие и весь честный копирайт уже live на проде** (иначе окно «трекинг идёт, а сайт обещает ноль трекеров»).

## Decisions locked

- Метрику ВКЛЮЧАЕМ, но включение (CSP-фикс) — последний merge, после A+C+D+E.
- Legal-доки через `/legal-rf-router` + `Legal-Pipeline-Verified:`.
- Rename — только UI.
- Landing-правки — согласованы построчно (см. контракт ниже).

## Codex round-1 + round-2 findings → закрытие

| # | Находка | Закрытие |
|---|---|---|
| R1-B1 | Метрика не раскрыта в privacy/consent | Epic A |
| R1-B2 / R2-B5 | `learn/security` врёт — lede, body, **и metadata+OG (:8/:12)** | Epic C |
| R1-B3 / R2-B1 | «берём на себя» overclaim + live-lie window | Epic C + порядок (B последним) |
| R1-B4 / R2-B4 | consent/banner TODO + **Webvisor пишет все формы (auth/checkout/cabinet PII)** | Epic A (banner-gate) + Epic B (масштаб/маскировка Webvisor) |
| R1-B5 | ложные тарифы в learn/free + crm-for-tutors | Epic D |
| R1-B6 | «Слоты» глоссарий | Epic E |
| R2-B2 | `.htaccess` (unsafe-inline + mc.yandex.ru) — проверить СЕЙЧАС, не в B | Precondition P0 |
| R2-B3 | legal-versioning — конкретные шаги, не вопрос | Epic A (явные шаги) |
| R2-W6 | nonce-тест слишком узкий | Epic B (render/smoke-тест на реальный `nonce=`) |
| R2-W7 | `docs/landing-v3/script.md` тоже врёт | Epic C |

---

## P0 — Precondition (до любого кода)

Доказать, что на проде Метрика СЕЙЧАС реально выключена и нет второго CSP-пути:
- Подтвердить, что prod отдаёт nginx + per-request nonce-CSP из `proxy.ts` (canary headers уже показали `server: nginx` + `script-src 'self' 'nonce-…'` без `unsafe-inline`, и console показал CSP-violation на `#ym-init` → Apache/`.htaccess` не в строю). Зафиксировать как факт.
- `public/.htaccess:12` — старый CSP с `'unsafe-inline'` + `mc.yandex.ru`. Привести в соответствие (убрать `unsafe-inline` из script-src / убрать дубль) или удалить, чтобы не было дрейфа на случай Apache-fallback. Задокументировать в `ARCHITECTURE.md`.

## Epic list (порядок merge на прод)

### Epic A — 152-ФЗ disclosure (legal-rf) ⟵ первым
`/legal-rf-router` → `legal-rf-commercial` → `legal-rf-qa`. Конкретные шаги:
- Раскрыть Яндекс.Метрику + Webvisor (категории: поведение на странице, запись сессий; цель: аналитика/UX; получатель: ООО «Яндекс») в `app/privacy/page.tsx` (обработчики ~:114/:168) и `app/consent/personal-data/page.tsx` (~:111/:147).
- **Legal-versioning (явно):** legal-rf-qa оценивает материальность. Если материально — bump `PERSONAL_DATA_DOCUMENT_VERSION` в `lib/legal/personal-data.ts`, версия `privacy` отдельно, опубликовать новые строки `legal_document_versions` миграцией (паттерн `migrations/0032`), проверить binding в `app/api/auth/register/route.ts:437`. Кто публикует и как — прописать в PR.
- **Cookie-banner gate:** legal-rf решает, нужен ли explicit consent для Метрики+Webvisor или хватает legitimate-interest. Резолв TODO `docs/analytics/privacy.md:69`. **Если banner обязателен → STOP + surface owner'у** (отдельный sub-эпик; включение Метрики ждёт).
- Reconcile «Учитель — оператор / платформа — обработчик» (`app/privacy/page.tsx:211/217`) с маркетингом.
- Trailer: `Legal-Pipeline-Verified:`.

### Epic C — честный копирайт про трекеры ⟵ до включения
- `components/saas/landing-v3/screens/07-security.tsx` гарантия 04 → «Аналитика, не реклама» + честно про Метрику/запись сессий; lede :82 «берём на себя» — смягчить под legal-wording.
- `app/saas/learn/security/page.tsx`: **metadata (:8) + OG (:12)** + lede (:30) + секция «Что НЕ делаем» (:88-96) + ложное «Яндекс.Метрики нет» (:95) → правда.
- `docs/landing-v3/script.md:207` — синхронизировать (убрать «не передаём в аналитические системы / один счётчик»).
- legal-rf-qa sanity-check формулировок.

### Epic D — rename + фикс ложных фактов в learn-страницах (независимо от Метрики)
- UI rename (7 строк + 2 коммента + alt карусели).
- `app/saas/learn/free/page.tsx`: rename + «Один ученик»→«до 3 учеников» (:8/:30/:41/:52/:96).
- `app/saas/learn/crm-for-tutors/page.tsx`: rename + устаревшие тарифы (:113) → текущие.

### Epic E — вычитка landing-v3 (контракт ниже) ⟵ до включения
Все согласованные правки + «Слоты»→«Время занятий» (B6) + проверить `08-pricing.tsx:40`.

### Epic B — CSP nonce fix + Webvisor scoping (ВКЛЮЧЕНИЕ) ⟵ ПОСЛЕДНИМ, после A+C+D+E live
- `app/layout.tsx`: `<YandexMetrika nonce={nonce} />`; `components/analytics/YandexMetrika.tsx`: `nonce?: string` → `<Script nonce={nonce}>`; исправить комментарий.
- **Webvisor PII-scoping (R2-B4 / R3-B4) — ОБЯЗАТЕЛЬНО:** Webvisor (запись сессий) монтируется ТОЛЬКО на публичных маркетинговых страницах (landing `/`, `/saas/learn/*`, `/offer`, `/privacy`, `/consent/*`). Запись сессий **ЗАПРЕЩЕНА** на всех авторизованных/PII-поверхностях — `/login`, `/register`, `/auth*`, `/checkout*`, `/pay*`, `/cabinet*`, `/teacher*`, `/admin*`. Это не «дефолт, который можно сузить» — это жёсткий контракт. Плюс глобальная маскировка ввода (`ym-hide-content`/«не записывать содержимое полей») как defense-in-depth. Реализация: условный mount `YandexMetrika`/webvisor по pathname, либо webvisor=false вне marketing-дерева. legal-rf-qa подтверждает, что список исключений полный.
- **W6 nonce-тест:** не только prop-уровень — render/smoke проверка реального `nonce=` в HTML инлайн-скрипта (как в `docs/security-csp.md:127`).
- НЕ трогать `lib/security/csp.ts`. Fallback: `/public/ym-init.js`.
- Verify: canary — CSP-violation нет, `ym` инициализируется, запрос `mc.yandex.ru`, Webvisor не пишет исключённые формы, Sentry 0 new. `/cso` daily.

---

## Epic E — согласованные строки landing-v3 (контракт)

Тарифы/цены НЕ трогаем (7 тестов). Блокнот (03 NOTES), штамп «с 2025», 14700₽, h2 pricing «Год — выгоднее всего», footer «Уже учишься? — Оплатить» — тире ОСТАВЛЯЕМ.

- **01-hero:61** → «...балансы и оплаты собраны в одном месте. Без кучи вкладок, Excel-таблиц и блокнотов.»
- **02-pain-1:46** → «До первого урока уже <em>30 сообщений.</em>»
- **02-pain-1:24** → «Сегодня не сможем, Кирилл заболел.»
- **03-pain-2:49** → «...разбросано по переписке, чекам перевода и блокноту. А часть помнишь только ты сам.»
- **03-pain-2:222** → «...не ведёт балансы. Так говорят преподаватели, с которыми мы общались.»
- **06-features:27** → «Оплаты, остатки абонементов, история платежей собраны на одном экране.»
- **04-multiplatform:293** → «Утром с телефона на кухне. Вечером с ноутбука. В пятницу с планшета на встрече. Один кабинет, те же ученики, тот же баланс.»
- **04-multiplatform:259** → «Просто открываешь в браузере. Скачивать и устанавливать ничего не нужно.»
- **04-multiplatform:266** → «Всё лежит у нас на сервере, а не в памяти телефона. Сломался телефон, заходишь с ноута, ничего не пропало.»
- **04b-carousel** captions: «Главная. Все ученики: кто оплатил, кто должен» / «Календарь. Время занятий, конфликты, переносы» / «Журнал оплат. СБП-заявки и подтверждения» / «Карточка ученика. Заметки, цели, прошлый урок» / «Настройки оплаты. СБП-методы и пакеты»; alt :43 → «Настройки учёта оплат»; lede :136 → «Не маркетинговые скрины. Реальный кабинет с тестовыми учениками. Точно так же ты увидишь его после регистрации.»
- **06b-integrations:26** → «Создал слот в кабинете, и он сразу появляется в Google-календаре у тебя и у ученика. Без переноса вручную.»
- **06b-integrations:38** → «Подтверждение записи, перенос, отмена уходят на почту ученику и родителю автоматически. Не нужно копировать-вставлять.»
- **06b-integrations:140** → «...интеграцию с Google Calendar. Какие данные читаем и пишем, кто их видит.»
- **06c-pullquote:72-77** → «...ни одного "не забудь, у нас сегодня". И в первый раз за два года точно знал, кто оплатил февраль.»
- **07-security:78** → «Данные твоих учеников <em>остаются твоими.</em>»
- **07-security:23/:43** (guar 01/05) → убрать тире.
- **07-security:47-48** (guar 06) → «Каждое согласие под защитой» / «Согласие ученика сохраняется отдельной записью с датой, версией документа, IP и устройством. Позже её нельзя изменить.»
- **08-pricing:96** → «Стартовый: навсегда, до 3 учеников. Оптимальный: 399 ₽ в месяц, без ограничения по числу учеников. Год: разовый платёж 4 000 ₽, экономия 15%.»
- **10-cta:28** → «Пять вкладок. <em>Один кабинет.</em>»
- **10-cta:31** → «На Стартовом всё бесплатно, навсегда, до 3 учеников. Карта не нужна, мы не звоним.»
- **footer:52** → «Интеграция с Google Calendar».
- Комментарии в коде с em-dash — почистить.

(07-security guar 04 + lede :82 — в Epic C.)

---

## Orchestration & paranoia

1. **Plan checkpoint:** этот план → `/codex-paranoia plan` раунд 3 (финальный cap; раунды 1-2 были BLOCK). Если round 3 BLOCK → escalate owner'у.
2. **Impl порядок:** P0 → Epic A (legal) → Epic C → Epic D → Epic E → **Epic B последним** (включение). Метрика реально стартует только когда раскрытие+копирайт live.
3. **Wave checkpoint:** `/codex-paranoia wave` на агрегате после merge всех.
4. **Trailers:** sub-PR `SUB-WAVE self-reviewed`; epic-close `SIGN-OFF`; `Skill-Used:`; `Legal-Pipeline-Verified:` (Epic A).
5. Каждый PR: green CI → merge → autodeploy → `/canary` + Sentry.

## Risks / gates

- **Cookie-banner gate (Epic A):** explicit consent обязателен → STOP + surface; Epic B ждёт баннер.
- **Webvisor PII (Epic B):** запись сессий ТОЛЬКО на публичных marketing-страницах; жёсткий запрет на `/login` `/register` `/auth*` `/checkout*` `/pay*` `/cabinet*` `/teacher*` `/admin*` + глобальная маскировка инпутов; legal-rf-qa подтверждает полноту списка.
- **Legal-versioning:** материальная правка → bump + миграция.
- Live-lie window исключён порядком (B последним).
- CSP nonce-prop может не сработать → канарь + fallback `/public/ym-init.js`.
- Тарифные тесты — не задеть названия/цены.
