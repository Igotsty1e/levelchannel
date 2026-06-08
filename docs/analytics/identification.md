# Identification model

## TL;DR

```
Anonymous (lc_aid cookie, HMAC-signed)
       │
       │ user signs up / logs in
       ▼
identified (cookie still present + account_id linked)
```

- **`anonymous_id`** — UUID v4 в HMAC-signed cookie `lc_aid` (2 года max-age, `SameSite=Lax`, `Secure`). Всегда установлен, server-side enforced.
- **`account_id`** — UUID, FK к `accounts(id)`. NULL до identify.
- **Identity = одна строка `accounts.id`** (не «человек»). Если один и тот же email завёл 2 аккаунта (teacher + learner) — это 2 identity.

---

## Lifecycle

### 1. First visit (anonymous)

1. Browser POST'ит в `/api/events` без cookie.
2. Server отдаёт 401 + `Set-Cookie: lc_aid=<uuid>:<hmac>`.
3. Client (или сразу через TrackingProvider в layout) делает retry → события начинают писаться с `anonymous_id = uuid`, `account_id = NULL`.

### 2. Signup (compromise pattern — UPDATE history)

1. User submits `/register` → POST `/api/auth/register`.
2. Server creates account → возвращает `accountId` в response.
3. **Server-side в TX**: helper `linkAnonymousIdToAccount(client, anonymous_id, account_id)` делает `UPDATE events SET account_id = $2 WHERE anonymous_id = $1 AND account_id IS NULL`.
4. Client получает response → вызывает `identify(accountId)` → кладёт в localStorage `lc_evt_acc`.
5. Все будущие `track()` пишут с `account_id` напрямую (без UPDATE race).

> ⚠️ **Этот UPDATE — компромисс.** Posthog/Segment рекомендуют НЕ переписывать историю, а резолвить identity at-query-time через dim-table. Мы выбрали UPDATE для простоты схемы (нет `event_identities` таблицы). Trade-off: малый объём UPDATE'ов (10-50 events/signup), не повторяемые scenarios.

### 3. Login (на новом устройстве)

1. User submits `/login` → POST `/api/auth/login`.
2. Server lookup account → `linkAnonymousIdToAccount(client, anonymous_id, account_id)` (UPDATE на pre-login события устройства).
3. Client получает response → `identify(accountId)`.

### 4. Cross-device

User на iPhone + ноутбуке = 2 разных `anonymous_id`. На обоих делает login → оба получают `account_id`. SQL агрегирующий по `account_id` natively stitches.

### 5. Multi-tab

Tab A делает identify → cookie + localStorage обновились. Tab B слушает `storage` event → `currentAccountId` подхватывается. Next `track()` в B пишет с правильным account_id.

### 6. Logout (`reset()`)

1. Client `forceFlush()` все pending events с current anonymous_id.
2. Cookie ротируется на следующем `/api/events` POST (если auth cookie очищен → server отдаёт 401 + new lc_aid).
3. `currentAccountId = null` в client state.

### 7. Multi-role одного человека

Иван заводит:
- `accounts(id=A, email=ivan@…, role=teacher)`
- `accounts(id=B, email=ivan2@…, role=learner_of_anastasiia)`

→ В `events` это **2 identity** (A и B). SQL различает их по `account_id`. Если для аналитики нужно «слепить» — это owner-level join (`accounts.email`-based), не аналитический слой.

---

## Security

### HMAC signature

Cookie format: `lc_aid=<uuid_v4>:<base64url(HMAC-SHA256(EVENTS_AID_SECRET, uuid_v4))>`

- `EVENTS_AID_SECRET` — env var, ≥32 chars, generate: `openssl rand -hex 48`.
- Verify timing-safe.
- Rotation `EVENTS_AID_SECRET` → invalidates ВСЕХ existing cookies. Пользователи получают новый `anonymous_id`. История orphan'ится (но account_id остаётся, так что identified users чувствуют разрыв). Не ротировать без необходимости.

### Rate limit

- Per-IP: 600 events/min (`extractClientIp()`)
- Per-anonymous_id: 300 events/min
- Hybrid защищает от cookie-rotation abuse.

### Anti-spoof

- `account_id` устанавливается ТОЛЬКО server-side, из verified session (`getCurrentSession()`).
- Client не может выставить произвольный account_id в body.
- Это критично — иначе attacker писал бы фейковые события на чужой аккаунт.

---

## 152-ФЗ — Delete request

User просит «удалите мои данные»:

```sql
-- Scrub identity link, оставляем агрегированную статистику
UPDATE events SET account_id = NULL WHERE account_id = '<account-uuid>';
-- (по желанию) hard-delete
-- DELETE FROM events WHERE account_id = '<account-uuid>';
```

Per recital 26 GDPR + ст. 3 п. 9 № 152-ФЗ — анонимизированные данные не являются ПДн → агрегаты можно сохранить.
