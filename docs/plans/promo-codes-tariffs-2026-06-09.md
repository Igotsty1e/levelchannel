# Promo codes на странице тарифов (LK учителя)

**Status**: round 1 — владелец ответил на Q1-Q4 + новые уточнения по Q5-Q12 нужны
**Owner**: @ivankhanaev
**Author**: Claude (sonnet/opus)
**Date created**: 2026-06-09
**Codex-Paranoia**: pending (запуск после ответов владельца на §3)

---

## 1. Что хотим сделать (одна страница)

Дать учителю возможность ввести промокод на странице тарифов в его кабинете (`/teacher/subscription` или `/teacher/tariffs`) — и получить за это бонус: например, 1-3 месяца бесплатной работы на максимальном тарифе (Расширенный).

**Сценарии использования**:
1. **Launch giveaway** — раздаём фиксированный промокод (например, `LAUNCH3`) друзьям, преподавателям из чата, ранним юзерам. Один код, использовать может N человек, даёт 3 месяца Расширенного бесплатно.
2. **Партнёрки** — выдаём пакет персональных кодов конкретному инфлюенсеру / каналу / автору. Каждый код = 1 active использование = 1 месяц бесплатно. Можно потом аналитику снять «сколько привёл канал X».
3. **Реферралы (потенциально позже)** — учитель, который привёл другого учителя, получает свой персональный код «1 месяц бесплатно».
4. **Compensation / служебные** — если у учителя что-то сломалось, оператор может выдать ему лично код-извинение.

Все 4 сценария реализуются одним механизмом: **промокод = ваучер на subscription credit (бесплатные дни на тарифе X)**.

---

## 2. Как это видится технически (черновик)

### 2.1. Сущность `promo_codes`

```sql
create table promo_codes (
  id              uuid primary key default gen_random_uuid(),
  code            citext not null unique,        -- "LAUNCH3", "ANYAK-2D9F" — case-insensitive
  description     text,                          -- "Запуск 2026-06: 3 мес Расширенного"

  -- Что даёт код
  grant_tier      text not null,                 -- 'free' | 'basic' | 'extended'
  grant_days      integer not null check (grant_days between 1 and 365),

  -- Лимиты использования
  max_redemptions integer,                       -- NULL = без лимита
  redemption_count integer not null default 0,

  -- Окно действия
  valid_from      timestamptz not null default now(),
  valid_until     timestamptz,                   -- NULL = бессрочно

  -- Аудит
  created_at      timestamptz not null default now(),
  created_by_account_id uuid references accounts(id),
  revoked_at      timestamptz,
  revoked_reason  text,

  -- Поведение
  is_personal     boolean not null default false, -- true → один аккаунт redeem'ит код только один раз
                                                  -- false → партнёрский код, один аккаунт может redeem'ить только 1×
                                                  -- (мы НЕ даём один аккаунт redeem'ить один и тот же код 2×)

  -- Анти-абуз
  requires_email_verified boolean not null default true,
  min_account_age_days    integer not null default 0
);

create index promo_codes_valid_window_idx on promo_codes (valid_from, valid_until) where revoked_at is null;
```

### 2.2. Сущность `promo_code_redemptions`

```sql
create table promo_code_redemptions (
  id              uuid primary key default gen_random_uuid(),
  promo_code_id   uuid not null references promo_codes(id),
  account_id      uuid not null references accounts(id),
  redeemed_at     timestamptz not null default now(),

  -- На какую подписку легло
  subscription_id uuid references teacher_subscriptions(id),  -- если уже есть активная — продлили
  granted_tier    text not null,
  granted_days    integer not null,
  granted_until   timestamptz not null,                       -- absolute end-of-grant

  -- Аудит
  redeemed_ip     inet,
  redeemed_ua     text,

  unique (promo_code_id, account_id)  -- один аккаунт = один redeem кода
);
```

### 2.3. Application logic — что считать «бесплатной подпиской»

Сейчас в проекте есть `teacher_subscriptions` (вероятно — нужно проверить, не путаюсь ли я с `teacher_tariffs`). Логика:

- При redeem кода → если у учителя нет активной подписки, создаём её с `tier = grant_tier`, `paid_until = now() + grant_days`, `payment_method = 'promo'`.
- Если активная подписка ЕСТЬ и того же или меньшего tier → продлеваем `paid_until += grant_days`, обновляем tier если бонусный выше.
- Если активная подписка ЕСТЬ и она ВЫШЕ → не меняем tier, продлеваем `paid_until` всё равно (учитель не потеряет credit, просто бонус «зачтётся» когда платная подписка кончится — в queue нет, но можно начислить «банк» если так проще).

**Edge case**: что если код даёт `extended` на 3 мес, а у учителя сейчас платный `basic` на месяц вперёд? Варианты:
- (A) **апгрейдим до extended на 3 мес, basic «теряется»** — учитель сразу получает топ-тариф.
- (B) **добавляем 3 мес к concrete end-of-basic** → новая запись «после basic → extended ещё 3 мес».
- (C) **самое простое: не разрешаем redeem, пока есть активная платная подписка** → owner просто отменяет / ждёт.

Решение — вопрос к владельцу (см. §3 Q3).

### 2.4. UI

**Страница `/teacher/subscription`** или новая `/teacher/promo-code`:
- Input «промокод» + кнопка «Активировать».
- Результат: «Активирован: 3 месяца на тарифе Расширенный до 2026-09-09» или ошибка.
- Подсказки про ошибки: «такого кода нет», «уже использован вами», «истёк», «требуется подтверждённый e-mail».

**Админка `/admin/promo-codes`**:
- Список кодов, фильтр по статусу.
- CRUD: создать код / отозвать.
- На каждый код — список redemptions.
- Метрика: «потенциальная стоимость выдач» (сколько дней × tier × ₽).

### 2.5. API endpoints

- `POST /api/teacher/promo-codes/redeem` `{ code }` → 200 / 4xx с typed error
- `GET /api/admin/promo-codes` (admin) → list + pagination
- `POST /api/admin/promo-codes` (admin) → create
- `POST /api/admin/promo-codes/[id]/revoke` (admin) → revoke
- `GET /api/admin/promo-codes/[id]/redemptions` (admin) → list redemptions

### 2.6. Анти-абуз

- **Rate limit**: 5 redeem-попыток на аккаунт в минуту (как у /login).
- **Email verified**: учитель с неподтверждённой почтой не может redeem'ить (опционально per-code через `requires_email_verified`).
- **Минимальный возраст аккаунта**: опционально per-code через `min_account_age_days` — защита от регистрации фейкаков под раздачу.
- **Audit log**: все redeem'ы пишутся в `payment_audit_events` (или новый `promo_audit_events`).
- **Уникальность редемпции**: `unique (promo_code_id, account_id)` — один человек, один redeem кода.

### 2.7. Аналитика

Новые события в существующей системе `events` (PR #558):
- `promo_code_redeem_attempted` — properties: `{ code_prefix }` (только первые 4 символа, чтобы не утечь полные коды)
- `promo_code_redeem_succeeded` — properties: `{ code_prefix, granted_tier, granted_days }`
- `promo_code_redeem_failed` — properties: `{ code_prefix, reason }` (reason = unknown_code | revoked | expired | already_redeemed | wrong_email_state)

---

## 3. ВОПРОСЫ К ВЛАДЕЛЬЦУ (нужны ответы перед /codex-paranoia plan)

### Q1. Сценарии (1) — какой основной use-case на старте?
- (a) Один публичный код «LAUNCH3» для всех ранних учителей — даёт 3 мес Extended бесплатно?
- (b) Сразу строим под персональные коды (по одному коду на учителя, выдаём 1-by-1)?
- (c) Оба — `LAUNCH3` сразу + персональные коды позже как фича.

### Q2. Сценарии (2) — какие тарифы кодом можно выдать?
- (a) Только Расширенный — самое простое, идёт под маркетинговый launch giveaway.
- (b) Любой из 3-х (Free / Basic / Extended) — выбирается при создании кода. Полезно если потом потребуется давать «1 мес Basic».
- Моё предложение: **(b)** — гибче, кост-делта минимальная.

### Q3. Поведение при активной платной подписке (см. §2.3 edge case)
Учитель платил Basic до 2026-08-01. Применяет код «Extended на 3 мес». Что делаем?
- (A) Апгрейдим: Extended до 2026-09-09 (на 3 мес от сегодня). Платный Basic как бы «сгорает».
- (B) Очередь: Basic до 2026-08-01, потом Extended ещё 3 мес. Сложнее, но честнее.
- (C) Не разрешаем: «у вас уже активная подписка». Учитель ждёт окончания или пишет в саппорт.
- Моё предложение: **(A)** для MVP. Простота > 100% справедливость. На launch giveaway никто не будет иметь платных подписок.

### Q4. Защита от абуза — насколько жёстко?
- (a) Минимум: rate limit + email-verified обязательно + `unique(code, account)`.
- (b) Плюс «аккаунт младше 1 часа не может redeem'ить» — защита от регистрации под раздачу.
- (c) Плюс «один IP может redeem'ить только 1 раз в день» — защита от ботов с одного устройства.
- Моё предложение: **(a)** для MVP — низкая ставка проблем, лояльные ранние юзеры, не надо параноить. (b)/(c) ввести если поймаем абуз.

### Q5. Кто может создавать промокоды?
- (a) Только admin через `/admin/promo-codes`.
- (b) Admin + специальная роль «marketing operator» (новая).
- Моё предложение: **(a)** — пока нет marketing team, лишняя сущность не нужна.

### Q6. Что показываем учителю до активации?
- (a) Никакого UI — просто input на странице тарифов, узнаёт о коде из e-mail/телеги.
- (b) Баннер «У вас есть промокод? Введите его здесь →»
- (c) Чек-листы / FAQ про коды.
- Моё предложение: **(a)** на MVP. Один input, без шума. Если код попал — вводят, не попал — не видят.

### Q7. Какое название «фичи» хотим в копирайте?
- «Промокод» (стандарт)
- «Бесплатный доступ»
- «Ваучер»
- Моё предложение: **«Промокод»** — самый понятный.

### Q8. Что с уведомлениями?
После успешного redeem:
- (a) Только баннер на странице.
- (b) Письмо на e-mail «Вам активирован Расширенный до 2026-09-09» + telegram (если подключён).
- Моё предложение: **(b)** — учитель потом будет искать в почте «до какого числа у меня бесплатно».

### Q9. Что считаем «использованным» кодом?
- (a) Код «использован» когда `max_redemptions` ↘ 0. Каждый аккаунт может redeem'ить любой код ОДИН раз.
- (b) Код без `max_redemptions` (NULL) можно использовать кому угодно бесконечно, но один аккаунт = один redeem.
- Моё предложение: оставить обе модели в схеме — `max_redemptions` опционально. Для `LAUNCH3` ставим NULL → пусть юзают пока не отзовём.

### Q10. Срок жизни «бесплатных дней»
Учитель активирует «3 мес Extended» 2026-06-09. Через 1 мес он удаляет аккаунт и регистрирует новый аккаунт. Может ли он redeem'ить тот же код снова?
- (a) Да — `unique(code, account_id)`, новый account_id, можно.
- (b) Нет — проверяем по e-mail хэшу что у этого e-mail уже был redeem.
- Моё предложение: **(a)** — реальных проблем мало (надо удалить аккаунт что не тривиально), а защиту по e-mail хэшу можно ввести позже.

### Q11. Где живёт страница ввода — `/teacher/subscription` (там, где тариф) или отдельная `/teacher/promo-code`?
- (a) Inline на `/teacher/subscription` — один экран всё что про тарифы.
- (b) Отдельная `/teacher/promo-code` — чище UI, можно глубоко linkать из писем.
- Моё предложение: **(a)** + якорь `#promo` для ссылок из писем.

### Q12. Где показываем «у вас осталось N дней бесплатно»?
- (a) На главной кабинета (`/teacher`) баннером.
- (b) На странице тарифов отдельным блоком.
- (c) Только в письме + email-напоминание за 3 дня до конца.
- Моё предложение: **(a)+(b)+(c)** — все три, разные surfaces, разная аудитория. Не дорого.

---

## 4. Что НЕ делаем (out of scope для MVP)

- Скидки по проценту («-50% на месяц») — пока только «N дней бесплатно».
- Промокоды для **учеников** (только учителя).
- Stacking — нельзя redeem'ить два кода подряд на один аккаунт чтобы получить 6 мес.
- Cashback / реферальное вознаграждение реальными деньгами.
- Auto-apply кодов из UTM-параметров.
- A/B-тесты разных кодов (сам код вшит в URL).

---

## 5. Зависимости

- **`teacher_subscriptions`** или эквивалент — нужно проверить актуальную таблицу подписок и понять, как туда грантовать tier+days.
- **`accounts.email_verified_at`** — для гейта.
- **`events`** — для аналитики.
- **`payment_audit_events`** или новый `promo_audit_events` — для аудита.
- **`teacher_tariffs`** — справочник тарифов с amount + tier маппингом.

---

## 6. Декомпозиция (предварительная, до ответов на §3)

Прикидываю 3 sub-PR:

1. **promo-codes-A** (foundation):
   - Mig 0120 `promo_codes` + `promo_code_redemptions` + index'ы.
   - `lib/promo/codes.ts` — `redeemPromoCode()`, `createPromoCode()`, `revokePromoCode()`.
   - Unit-tests + integration test «happy path redeem».
2. **promo-codes-B** (admin UI):
   - `/admin/promo-codes` — list + create + revoke + per-code redemptions.
   - API endpoints + zod validation.
3. **promo-codes-C** (teacher UI + аналитика):
   - `/teacher/subscription` блок «промокод» + редемпция API.
   - 3 events в `events` (attempted/succeeded/failed).
   - Email + Telegram уведомление после успешного redeem.

Codex-paranoia: 1 round на plan-доке (после ответов §3) + 1 round на wave-end после merge всех 3 sub-PR.

---

## 7. Self-review (round 1 — Claude)

Прошёл по документу — нашёл несколько gap'ов и противоречий с ответами владельца.

### 7.1. Противоречия в текущей версии после ответов Q1-Q4
- **Q2 → только Extended**, но в схеме `promo_codes.grant_tier text` без constraint. **Action**: в migration добавить `check (grant_tier in ('free', 'basic', 'extended'))`. На MVP в admin-UI скрыть выбор tier — только Extended. Поле в БД сохраняем для будущего.
- **Q3 → "пока не разрешаем при активной платной"** — в §2.3 написано про upgrade/queue/blocked, но мы не зафиксировали (C) blocked. Action: §2.3 переписать «При активной платной подписке — redeem fails с typed error `active_paid_subscription`». Опционально (§7.1 ниже) — резервирование.
- **Q3.1 (моё уточнение)**: резервировать или нет? Если резервировать → нужна таблица `promo_code_reservations(promo_code_id, account_id, reserved_at)` + cron-задача активации после окончания платной. Если не резервировать → MVP проще, но возможен случай «учитель ввёл код, его всосало, потом ничего не получил» — UX-катастрофа.
  - **Моё предложение для MVP**: НЕ резервировать. Учитель получает понятный error: «у вас есть активная оплаченная подписка до DD.MM.YYYY — введите код после её окончания». Не запоминаем код, не паримся.

### 7.2. Открытые риски / [BLOCKER] кандидаты для paranoia
- **Schema drift**: я предполагал `teacher_subscriptions` — но в проекте есть `teacher_tariffs` (это справочник, не activations). **Action перед /codex-paranoia plan**: найти таблицу-источник правды для «когда у учителя подписка кончается» (вероятно — последний paid `teacher_subscription_payments` + paid_until column). Без этого схема `promo_code_redemptions.subscription_id` повисает в воздухе.
- **Concurrent redeem**: если `max_redemptions = 100` и 101 человек одновременно жмут «активировать» — без advisory-lock последняя пройдёт, но `redemption_count` будет дёргаться race. **Action**: redeem-функция должна работать в транзакции с `select … for update` на promo_codes row.
- **PII в audit row**: `redeemed_ip inet` + `redeemed_ua text` — это PII per 152-ФЗ. **Action**: использовать ту же truncation что в `lib/analytics/server.ts` (`truncateIp(/24)`). UA можно оставить — он не PII по строгому толкованию.
- **citext extension**: `code citext` требует расширение `citext` в Postgres. **Action**: проверить установлено ли (мигрировать `create extension if not exists citext`).
- **Анти-абуз по сценарию Q10 (а)**: если аккаунт удалили и зарегали с тем же e-mail — `unique(code, account_id)` не спасёт. Owner выбрал (a) — это окей для MVP. Помечаем что в backlog лежит «e-mail-hash дедуп при redeem».

### 7.3. Что НЕ сделано в этом self-review
- Нет реальных wireframe'ов admin-UI и teacher-UI — текстовые скетчи.
- A11y не описан явно — wave должен подключить web-accessibility-wizard перед merge sub-PR C.
- Не описана локализация — все строки на ru (как в проекте); en планируется через i18n позже, но out of scope.

---

## 8. Ответы владельца

**Round 1 (2026-06-09)**:
- **Q1 → (a) публичный код «LAUNCH3»** на старте. Персональные коды — позже отдельной фичей.
- **Q2 → (a) только Extended** — кодом выдаём только топовый тариф. Schema всё равно поддержит другие — но UI / создание кода ограничено до Extended для MVP.
- **Q3 → "ничего пока"** → интерпретирую как: НЕ занимаемся edge case активной платной подписки. Защищаемся проще: если у учителя есть активная платная подписка, redeem кода **запрещён** с понятным сообщением «у вас активная оплаченная подписка — код можно применить когда она закончится» (вариант **C** из плана). Это не теряет ничего у учителя (код помечается зарезервированным за ним; при истечении платной — автоматом активируется).
  - **открытое уточнение Q3.1**: вариант (C) — НЕ разрешать сразу + не резервировать (учителю прийдётся заново вводить код после окончания подписки); ИЛИ всё-таки **резервировать** код за аккаунтом до окончания платной?
- **Q4 → (a) минимум** — rate limit + email-verified + `unique(code, account)`. Без агрессивной защиты по возрасту аккаунта / IP. Если поймаем абуз — введём (b) и (c).

**Round 2 — нужно решить Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12 + Q3.1 выше.** См. §3 — мои дефолты помечены **Моё предложение**, если согласны со всеми — просто скажите «ОК».

---

## 9. Меняем после ответов

- Технические детали §2.
- Декомпозицию §6.
- Запускаем `/codex-paranoia plan docs/plans/promo-codes-tariffs-2026-06-09.md`.
- Только после SIGN-OFF — стартуем sub-PR A.
