# Политика хранения и удаления персональных данных

> **Status: SKELETON.** Это инженерный скелет — структура, перечень
> категорий ПДн и существующих механизмов. Сроки хранения, правовые
> основания и формальные формулировки **должны заполняться**
> через `legal-rf-router → legal-rf-private-client → legal-rf-qa` и
> только после этого считаться действующей политикой. Каждая ячейка
> с `<!-- legal-rf: TODO -->` ждёт юридического review.

> Этот документ — operator-facing. Публичные обязательства про
> обработку ПДн живут в `app/privacy/page.tsx` и
> `app/consent/personal-data/page.tsx`. Любое расхождение между
> публичным текстом и этим документом разруливается через
> legal-rf пайплайн в одном PR.

## 1. Цели документа

- зафиксировать **категории ПДн**, которые мы фактически собираем
- для каждой категории — где она хранится, на каком правовом основании,
  с каким сроком и каким механизмом удаления
- дать оператору runbook для запросов субъектов ПДн (152-ФЗ ст.14,
  ст.20, ст.21)
- сделать политику **проверяемой**: чтобы Роскомнадзор / аудитор мог
  сопоставить декларацию с фактом

## 2. Текущие механизмы согласия (уже работают)

Этот раздел описывает **существующее** состояние, не план.

### 2.1 Versioning подписанных согласий

| Surface | Где живёт версия | Что сохраняется |
|---|---|---|
| Регистрация (`/register`) | `account_consents` (миграция 0011) | `(account_id, document_kind='personal_data', document_version, document_path, accepted_at, ip, user_agent)`. Audit-trail row-per-acceptance, история не схлопывается. |
| Гостевой checkout (`/api/payments`) | `payment_orders.metadata.personalDataConsent` | snapshot из `buildPersonalDataConsentSnapshot()` в `lib/legal/personal-data.ts`: `documentVersion`, `documentPath`, `policyPath`, `acceptedAt`, `source='checkout'`, `ipAddress`, `userAgent`. Хранится в order metadata, остаётся всё время жизни заказа. |

**Текущая версия документа:** `PERSONAL_DATA_DOCUMENT_VERSION =
'2026-04-29.4'` (`lib/legal/personal-data.ts:1`). При публикации новой
редакции согласия версия инкрементируется в коде; новая запись в
`account_consents` или новый snapshot в `payment_orders.metadata`
автоматически фиксирует, какую версию пользователь подписал.

### 2.2 Сам текст согласия и политики

| Файл | Что |
|---|---|
| `app/offer/page.tsx` | публичная оферта |
| `app/privacy/page.tsx` | политика обработки ПДн |
| `app/consent/personal-data/page.tsx` | согласие на обработку ПДн |
| `lib/legal/personal-data.ts` | server-side `PERSONAL_DATA_DOCUMENT_VERSION` + snapshot helper |

Изменения этих файлов проходят через `legal-rf-router → … → legal-rf-qa`
(см. `docs/legal-pipeline.md`) и попадают в commit с trailer'ом
`Legal-Pipeline-Verified:`.

## 3. Категории ПДн в системе

Перечень основан на текущем коде (фактических точках записи ПДн).

| # | Категория | Где хранится | Цель сбора | Правовое основание | Срок хранения | Механизм удаления |
|---|---|---|---|---|---|---|
| 1 | E-mail зарегистрированного пользователя | `accounts.email` (миграция 0005) | идентификация в кабинете, верификация, сброс пароля | <!-- legal-rf: TODO --> | <!-- legal-rf: TODO --> | <!-- legal-rf: TODO --> |
| 2 | Хеш пароля | `accounts.password_hash` | аутентификация | <!-- legal-rf: TODO --> | <!-- legal-rf: TODO --> | удаляется вместе с `accounts` row |
| 3 | Сессии (cookie + DB row) | `account_sessions` (0007) | поддержание залогиненного состояния | <!-- legal-rf: TODO --> | <!-- legal-rf: TODO; технически revoke при logout, expire через `SESSION_TTL_MS` --> | revoke endpoint + cron на expired (cron pending — см. backlog) |
| 4 | Email verification token | `email_verifications` (0008) | подтверждение e-mail | <!-- legal-rf: TODO --> | до consume или expire | single-use enforcement в коде; cleanup expired pending |
| 5 | Reset-password token | `password_resets` (0009) | сброс пароля | <!-- legal-rf: TODO --> | до consume или expire | single-use; cleanup expired pending |
| 6 | Audit-trail согласий | `account_consents` (0011) + withdrawal column в 0013 | доказать, какую версию документа подписал пользователь, и зафиксировать факт отзыва согласия (152-ФЗ ст.9 п.5) | ст.9 152-ФЗ (само согласие = объект ст.7), сам audit — legitimate interest по ст.6 п.7 | <!-- legal-rf: TODO; рекомендация — синхронно со сроком исковой давности по 152-ФЗ --> | `withdrawConsent()` ставит `revoked_at`; row остаётся как факт акцепта в момент T, но больше не считается active. `getActiveConsent()` возвращает только unrevoked rows |
| 7 | E-mail плательщика (гостевой checkout) | `payment_orders.customer_email`, `payment_orders.receipt_email` | приём платежа, отправка чека (54-ФЗ) | <!-- legal-rf: TODO; 54-ФЗ ст.4.7 для чека --> | <!-- legal-rf: TODO; 54-ФЗ требует хранить ОФД-данные ~5 лет --> | <!-- legal-rf: TODO --> |
| 8 | Сумма платежа + статус | `payment_orders.amount_rub`, `status`, `provider_transaction_id` | приём платежа, рекoncile c CloudPayments | <!-- legal-rf: TODO --> | <!-- legal-rf: TODO; 54-ФЗ для kassa-records --> | append-only, не удаляется |
| 9 | Snapshot согласия гостя | `payment_orders.metadata.personalDataConsent` | доказать факт акцепта при оплате | ст.9 152-ФЗ | живёт всё время жизни order row | удаляется вместе с order |
| 10 | Сохранённый токен карты (one-click) | `payment_card_tokens` (0002) | повторная оплата без ввода реквизитов | ст.6 п.5 152-ФЗ (исполнение договора) при `rememberCard=true` | <!-- legal-rf: TODO --> | DELETE `/api/payments/saved-card` (opt-out пользователя), token не персистится без consent |
| 11 | Telemetry checkout-funnel | `payment_telemetry` (0003) | продуктовая аналитика | ст.6 п.7 152-ФЗ (legitimate interest, privacy-friendly) | <!-- legal-rf: TODO --> | append-only; **e-mail хранится как HMAC-hash, IP — /24-masked** |
| 12 | Audit-log платежей | `payment_audit_events` (0012) | расследование инцидентов, audit-обязанность | ст.6 п.7 152-ФЗ (legitimate interest), 54-ФЗ для платёжных операций | <!-- legal-rf: TODO; рекомендация ~3 года --> | append-only, immutable; ON DELETE NO ACTION на FK к `payment_orders` |
| 13 | Idempotency-records | `idempotency_records` (0004) | dedup money-moving requests | ст.6 п.5 (исполнение договора) | <!-- legal-rf: TODO; ~24h-7d достаточно --> | cron cleanup pending — см. backlog |

## 4. Запросы субъектов ПДн (SAR)

### 4.1 Что субъект может запросить (152-ФЗ)

- ст.14 — получить **информацию** об обработке (что хранится, цели,
  сроки, правовое основание)
- ст.20 — потребовать **уточнения** или дополнения данных
- ст.21 — потребовать **прекращения обработки** и/или
  **уничтожения**

### 4.2 Текущий процесс

**Сейчас — manual / по e-mail:** субъект пишет на контактный e-mail
оператора (`<-- FILL IN: контактный email из app/privacy/page.tsx -->`),
оператор вручную:

1. Сверяет identity (e-mail должен совпадать с регистрационным /
   платёжным).
2. По запросу ст.14 — формирует и отправляет в ответ список из
   таблицы §3 с конкретными значениями для этого пользователя.
3. По запросу ст.21 — выполняет последовательность из §5 ниже.

**Машиночитаемый export данных (à-la GDPR data portability) НЕ
реализован и не планируется** — 152-ФЗ его не требует, ст.14 закрывается
ответом оператора в свободной форме.

### 4.3 Когда нужен dedicated `/api/account/delete` endpoint

Когда manual процесс становится узким местом — то есть когда objёm
запросов на удаление превышает ~1/неделю. До этого момента инженерный
скелет endpoint'а — преждевременная оптимизация. Реализация — отдельный
backlog item, привязанный к фактической нагрузке.

## 5. Cascade удаления при ст.21 (skeleton)

При запросе на полное удаление аккаунта:

| Шаг | Что | Где | Что делает |
|---|---|---|---|
| 1 | revoke сессии | `account_sessions` | `delete from account_sessions where account_id = $1` |
| 2 | invalidate verification / reset токены | `email_verifications`, `password_resets` | `delete ... where account_id = $1` |
| 3 | удалить аккаунт | `accounts` | `delete from accounts where id = $1` (CASCADE на `account_roles`, `account_consents`) |
| 4 | анонимизировать платежи | `payment_orders` | <!-- legal-rf: TODO; **не удаляем** — конфликт с 54-ФЗ. Решение: заменить email/имя на `__erased__@__erased__` и mark metadata `{erased_at, erased_reason}`. Согласовать формулировку. --> |
| 5 | удалить токены карт | `payment_card_tokens` | `delete from payment_card_tokens where customer_email = $1` |
| 6 | анонимизировать audit | `payment_audit_events` | <!-- legal-rf: TODO; audit immutable, но email может быть заменён на `__erased__`. Конфликт с audit-целью расследования инцидентов — решить через legal-rf. --> |
| 7 | telemetry | `payment_telemetry` | уже privacy-friendly (HMAC email + /24 IP) — отдельной обработки не требует |

**Конфликт «удалить полностью vs 54-ФЗ хранить чеки 5 лет» —
требует юридического решения.** Предполагаемая стратегия:
**анонимизация**, не удаление. Окончательную формулировку даёт
`legal-rf-private-client` + `legal-rf-qa`.

## 6. Что нужно для перехода SKELETON → ACTIVE

1. `legal-rf-router → legal-rf-private-client` заполняет каждую
   `<!-- legal-rf: TODO -->` ячейку: **срок** + **правовое основание**
   + **формальная формулировка**.
2. `legal-rf-qa` ревью.
3. PR с finalized doc, trailer: `Legal-Pipeline-Verified: legal-rf-router
   → legal-rf-private-client → legal-rf-qa (YYYY-MM-DD)`.
4. Параллельно — добавить контактный e-mail для SAR-запросов в
   `app/privacy/page.tsx` (если ещё не указан) **в том же PR**, через
   тот же legal-rf пайплайн.
5. Подать уведомление в Роскомнадзор о начале обработки ПДн (если ещё
   не подано) — operator-side задача, не код.

## 7. См. также

- Реализация механики версионирования: `lib/legal/personal-data.ts`,
  `lib/auth/consents.ts`, `migrations/0011_account_consents.sql`,
  `migrations/0012_payment_audit_events.sql`.
- Публичный текст согласия и политики: `app/offer/`, `app/privacy/`,
  `app/consent/personal-data/`.
- Жёсткие гарды на изменение легальных файлов: `docs/legal-pipeline.md`.
- Архитектурный обзор: `ARCHITECTURE.md` § Audit log + § Auth and
  account layer.
- Operator runbook (psql, backup, retention): `OPERATIONS.md §5`.
