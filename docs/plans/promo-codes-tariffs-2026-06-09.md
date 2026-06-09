# Promo codes на странице тарифов (LK учителя)

**Status**: round 2 — ВСЕ вопросы отвечены, в pre-paranoia self-review
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

Реальные plan slugs в проекте (mig 0073 + 0103): `free`, `mid`, `pro`, `operator-managed`. Публичные RU-названия: Стартовый, Базовый, Расширенный (= pro), operator-managed. Owner называет «Extended» — это `pro` в БД.

```sql
create extension if not exists citext;  -- для case-insensitive code lookup

create table promo_codes (
  id              uuid primary key default gen_random_uuid(),
  code            citext not null unique,
                                                  -- "LAUNCH3" / "ANYAK-2D9F", case-insensitive
  description     text,

  -- Что даёт код. FK на справочник planов (mig 0073).
  -- MVP: только 'pro' через admin-UI; БД хранит slug чтобы будущие коды
  -- на 'mid' не требовали миграции.
  grant_plan_slug text not null
    references teacher_subscription_plans(slug)
    on update cascade on delete restrict,
  grant_days      integer not null check (grant_days between 1 and 365),

  -- Лимиты использования
  max_redemptions   integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count  integer not null default 0,

  -- Окно действия
  valid_from        timestamptz not null default now(),
  valid_until       timestamptz,

  -- Аудит
  created_at        timestamptz not null default now(),
  created_by_account_id uuid references accounts(id) on delete set null,
  revoked_at        timestamptz,
  revoked_reason    text,

  -- Анти-абуз gates
  requires_email_verified boolean not null default true
);

create index promo_codes_valid_window_idx
  on promo_codes (valid_from, valid_until)
  where revoked_at is null;
```

**Удалено из v1**: `is_personal` (избыточно — поведение полностью моделируется через `max_redemptions` + unique constraint в `promo_code_redemptions`). `min_account_age_days` (owner выбрал минимум защиты Q4).

### 2.2. Сущность `promo_code_redemptions`

```sql
create table promo_code_redemptions (
  id              uuid primary key default gen_random_uuid(),
  promo_code_id   uuid not null references promo_codes(id) on delete restrict,
  account_id      uuid not null references accounts(id) on delete cascade,
  redeemed_at     timestamptz not null default now(),

  -- На какую подписку легло
  -- teacher_subscriptions.account_id (PK) — see mig 0074
  subscription_account_id uuid not null references accounts(id) on delete cascade,
  granted_plan_slug text not null
    references teacher_subscription_plans(slug)
    on update cascade on delete restrict,
  granted_days    integer not null check (granted_days between 1 and 365),
  granted_until   timestamptz not null,

  -- Аудит (PII-safe per 152-ФЗ)
  redeemed_ip_prefix inet,                -- truncated /24 IPv4 or /48 IPv6 (lib/analytics/server.ts)
  redeemed_ua        text,                -- raw UA OK per privacy policy

  unique (promo_code_id, account_id)
);

create index promo_code_redemptions_account_idx
  on promo_code_redemptions (account_id, redeemed_at desc);
```

### 2.3. Application logic — redeem flow (round 2 final)

Owner ответил Q3+Q3.1: **не разрешаем redeem при активной платной подписке**, ничего не резервируем, понятная error message.

**Логика redeem в одной транзакции с advisory lock**:

```ts
async function redeemPromoCode(client, codeRaw, accountId, ip, ua) {
  // 1. Глобальный advisory lock per code — анти-race на max_redemptions
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [codeRaw.toLowerCase()])

  // 2. Lookup + lock row.
  const code = await client.query(
    `select * from promo_codes where code = $1::citext for update`,
    [codeRaw],
  )
  if (!code.rows.length) throw new RedeemError('unknown_code')

  const c = code.rows[0]
  const now = new Date()
  if (c.revoked_at) throw new RedeemError('revoked')
  if (c.valid_from > now) throw new RedeemError('not_yet_valid')
  if (c.valid_until && c.valid_until < now) throw new RedeemError('expired')
  if (c.max_redemptions != null && c.redemption_count >= c.max_redemptions) {
    throw new RedeemError('exhausted')
  }

  // 3. Аккаунт-уровень gate'ы
  const account = await client.query(
    `select email_verified_at, disabled_at from accounts where id = $1 for update`,
    [accountId],
  )
  if (!account.rows.length || account.rows[0].disabled_at) {
    throw new RedeemError('account_unavailable')
  }
  if (c.requires_email_verified && !account.rows[0].email_verified_at) {
    throw new RedeemError('email_not_verified')
  }

  // 4. Активная платная подписка → отказ (Q3 решение).
  const sub = await client.query(
    `select plan_slug, state, period_end
       from teacher_subscriptions
      where account_id = $1`,
    [accountId],
  )
  if (sub.rows.length) {
    const s = sub.rows[0]
    const isPaidActive =
      ['mid', 'pro'].includes(s.plan_slug) &&
      s.state === 'active' &&
      (s.period_end == null || s.period_end > now)
    if (isPaidActive) {
      throw new RedeemError('active_paid_subscription', {
        currentPlan: s.plan_slug,
        endsAt: s.period_end,
      })
    }
  }

  // 5. Уже redeem'ил этот код? unique(code, account) — но проверяем явно
  //    чтобы вернуть понятную error, не EXCEPTION.
  const dup = await client.query(
    `select 1 from promo_code_redemptions
      where promo_code_id = $1 and account_id = $2`,
    [c.id, accountId],
  )
  if (dup.rows.length) throw new RedeemError('already_redeemed')

  // 6. Grant: создаём/обновляем teacher_subscriptions.
  const grantedUntil = new Date(now.getTime() + c.grant_days * 24 * 60 * 60 * 1000)
  await client.query(
    `insert into teacher_subscriptions (account_id, plan_slug, state, period_start, period_end)
       values ($1, $2, 'active', $3, $4)
       on conflict (account_id) do update
         set plan_slug = excluded.plan_slug,
             state = 'active',
             period_start = excluded.period_start,
             period_end = excluded.period_end,
             cancelled_at = null,
             updated_at = now()`,
    [accountId, c.grant_plan_slug, now, grantedUntil],
  )

  // 7. Запись в журнал + bump counter.
  await client.query(
    `insert into promo_code_redemptions
       (promo_code_id, account_id, subscription_account_id,
        granted_plan_slug, granted_days, granted_until,
        redeemed_ip_prefix, redeemed_ua)
       values ($1, $2, $2, $3, $4, $5, $6, $7)`,
    [c.id, accountId, c.grant_plan_slug, c.grant_days, grantedUntil,
     truncateIp(ip), ua?.slice(0, 256) ?? null],
  )
  await client.query(
    `update promo_codes set redemption_count = redemption_count + 1 where id = $1`,
    [c.id],
  )

  return { plan_slug: c.grant_plan_slug, granted_days: c.grant_days, granted_until: grantedUntil }
}
```

**Зачем advisory lock + select for update?** На `LAUNCH3` без `max_redemptions` — лочиться не критично, но при ограниченных кодах две одновременные транзакции иначе превысят cap. Lock hashtext по lowercased code → гарантирует serializable per-code.

**Edge case backward-fill**: учитель сейчас на `free`, redeem `pro` на 90 дней → ON CONFLICT UPDATE затрёт plan_slug=free на pro + период. Free `period_end` всегда NULL, так что мы не теряем оплаченных дней.

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

## 7. Self-review (round 2 — Claude, после locked-in ответов)

### 7.0. Что починено vs. round 1
- **Schema drift**: подтвердил реальные таблицы `teacher_subscriptions` (mig 0074) + `teacher_subscription_plans` (mig 0073). Заменил выдуманный `extended` slug на реальный `pro` (RU title: «Расширенный»). FK `grant_plan_slug` → `teacher_subscription_plans(slug)`.
- **Concurrent redeem race**: добавлен `pg_advisory_xact_lock(hashtext(code))` + `select for update` в `redeemPromoCode()` (§2.3).
- **PII**: `redeemed_ip_prefix inet` (truncated /24 / /48) вместо raw `redeemed_ip`.
- **citext extension**: явный `create extension if not exists citext` в §2.1.
- **`is_personal` поле удалено** — избыточно (моделируется `max_redemptions` + unique).
- **Q3 final**: redeem fails при активной платной с typed error `active_paid_subscription`.

### 7.1. Новые риски / [BLOCKER]-кандидаты (round 2)
- **B1. Subscription state machine**: `teacher_subscriptions.state` имеет значения active/past_due/cancelled/suspended (mig 0074). Мой redeem только проверяет `state = 'active'` для блокировки. Что если у учителя `state = 'past_due'` (3-дневный grace)? Считается ли это «активной платной»? Технически да — он купил, но в просрочке. **Решение**: трактуем `past_due` как ПЛАТНАЯ (блокируем redeem). `cancelled` (downgrade to Free at period_end) — пока есть платный остаток до `period_end`, тоже блокируем. `suspended` — оператор отключил, разрешать ли redeem? Странный кейс; **default: блокируем**, всё равно нужно подождать разблокировки.
- **B2. ON CONFLICT затирает `cp_token`**: если у учителя был платный pro с `cp_token`, потом отменил, попал в free, потом redeem promo — мой `ON CONFLICT DO UPDATE` НЕ затрагивает `cp_token`. Но `payment_order_id` тоже не трогаем. Какая-то историческая связь с старым платежом остаётся в строке. **Acceptable** — потом если он опять оплатит, эти поля обновятся.
- **B3. `grant_days` cap = 365** — теоретически админ может создать код на 365 дней `pro` (стоимостью 800₽ × 12 = 9600₽). Хочется ли явное предупреждение в admin-UI «потенциальная стоимость X ₽»? Для launch не критично — owner единственный кто создаёт. Помечаю как WARN в admin-UI.
- **B4. Email notification после redeem** (Q8 → b): использует Resend SDK через существующий transactional layer (`lib/notifications/email/transactional.ts` или подобный). Надо проверить наличие. Telegram — через `tg_chat_id` в `accounts` если подключён. **Action**: грепнуть `Resend` + `tg_chat` в lib/.
- **B5. Email reminder за 3 дня до конца** (Q12 → c): требует cron-job. У нас уже есть cron-инфраструктура (`scripts/`). **Action**: добавить `scripts/promo-grant-expiring-reminder.mjs` в Sub-PR C; запускается ежедневно в утренний digest-слот.
- **B6. Tracking events** (Q12 трекинг): требует расширения `lib/analytics/registry.ts` тремя новыми events. Helper `track('promo_code_redeem_succeeded', {...})` — но properties могут утечь полные коды. Защита: записывать только `code_prefix` (первые 4 символа) + длину. В §2.7 это упомянуто, но в самой схеме events нужно явно ограничить max length string.
- **B7. Уведомления баннер на /teacher** (Q12 → a): где живёт «у вас осталось N дней бесплатно»? Сейчас на `/teacher` мобильный sticky bottom nav + базовый дашборд. **Action**: добавить блок «Промо-доступ» в Sub-PR C поверх существующего дашборда.

### 7.2. Точки расхождения с другими частями системы
- **`cancelled_at` в teacher_subscriptions** (mig 0098) — выставляется когда учитель сам отменил. При redeem promo мы выставляем `cancelled_at = null` (см. §2.3 step 6). **Side-effect**: если он отменил Pro подписку и потом получил promo, после конца promo-периода он будет на pro в state=active с NULL cancelled_at — НЕ auto-downgrade. Это **проблема**. Надо после promo period_end → trigger downgrade. У нас есть существующий cron `expireOverduePeriods`? **Action**: грепнуть.
- **Pricing copy на лендинге** (`/`, `/saas/offer`) — там везде «Расширенный — 800₽/мес». При запуске LAUNCH3 мы НЕ меняем копирайт. Это норм.

### 7.3. Что НЕ сделано в этом self-review
- A11y prescription явно не описан — закроем через `web-accessibility-wizard` перед merge sub-PR C.
- Локализация — все строки на ru.
- Реальные wireframes admin-UI / teacher-UI — не нужны для plan-doc.

### 7.4. Готовность к /codex-paranoia plan
**Готов**. Открытые риски B1-B7 — это работа для wave, не для plan-doc. Plan-mode paranoia зацепит схему + redeem flow + interaction с teacher_subscriptions state-machine; именно там B1 (state machine matrix) станет [BLOCKER] кандидатом.

**Action перед запуском**: Я НЕ запускаю /codex-paranoia plan сам — owner должен подтвердить «запускай paranoia» в следующем сообщении (per global mandate).

---

## OLD: Self-review (round 1 — Claude)

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

**Round 2 (2026-06-09)** — владелец принял мои дефолты для Q5-Q12 + Q3.1:
- **Q3.1 → (a) error без резервирования** — учитель получает «введите код после окончания подписки», код не запоминаем.
- **Q5 → (a)** — создание промокодов только через `/admin/promo-codes`.
- **Q6 → (a)** — input на странице тарифов, без баннера. Учитель узнаёт о коде из e-mail/телеги.
- **Q7 → «Промокод»** — стандартный термин в копирайте.
- **Q8 → (b)** — после успешного redeem письмо + telegram (если подключён).
- **Q9 → `max_redemptions` опционально NULL** — `LAUNCH3` без лимита; персональные коды (когда появятся) с лимитом 1.
- **Q10 → (a)** — `unique(code, account_id)` хватает; если переустановят аккаунт — пусть redeem'ит заново. Дедуп по e-mail-hash — backlog.
- **Q11 → (a)** — inline на `/teacher/subscription` + якорь `#promo`.
- **Q12 → (a)+(b)+(c)** — баннер на `/teacher`, блок на `/teacher/subscription`, e-mail напоминание за 3 дня до конца.

---

## 9. Меняем после ответов

- Технические детали §2.
- Декомпозицию §6.
- Запускаем `/codex-paranoia plan docs/plans/promo-codes-tariffs-2026-06-09.md`.
- Только после SIGN-OFF — стартуем sub-PR A.
