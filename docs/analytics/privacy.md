# Analytics privacy + 152-ФЗ

## What we collect

| Field | Source | Purpose | Retention |
|---|---|---|---|
| `event_id` | client UUID | Idempotency on retry | event lifetime |
| `event_name` | registry (allowlist) | Funnel / behavior | event lifetime |
| `anonymous_id` | HMAC-signed cookie `lc_aid` | Cross-session stitching | event lifetime + 2-year cookie |
| `account_id` | server session (verified) | Identity merge | event lifetime; scrubable on delete request |
| `session_id` | client (30-min inactivity) | Session-level analysis | event lifetime |
| `url` | client (sanitized) | Page context | event lifetime |
| `referrer` | client (origin-only) | Source attribution | event lifetime |
| `utm` | extracted from URL | Campaign attribution | event lifetime |
| `ua_family/os/device` | parsed UA, raw dropped | Device split | event lifetime |
| `ip_prefix` | server (truncated /24 v4, /48 v6) | Geo/abuse heuristics | event lifetime |
| `geo_country` | currently NULL (MaxMind deferred) | — | — |
| `properties` | registry-validated | Event-specific | event lifetime |

## What we DON'T collect

- Email, phone, full name (Zod schema rejects)
- Payment card data (CloudPayments handles)
- Free-text user input (chat messages, notes)
- Full URL query string (only `utm_*` preserved; tokens/codes stripped)
- Raw User-Agent (parsed → dropped)
- Full IP (truncated)

## Cookies

| Cookie | Purpose | Lifetime | Flags |
|---|---|---|---|
| `lc_aid` | Anonymous_id (HMAC-signed UUID) | 2 years | SameSite=Lax, Secure |
| `lc_evt_buf` (localStorage) | Pending events buffer | until flushed | local |
| `lc_evt_acc` (localStorage) | Account_id cache | until logout | local |
| `lc_evt_session` (sessionStorage) | Session_id + last activity | tab close OR 30-min inactivity | local |

## 152-ФЗ: запрос на удаление данных

User → `support@levelchannel.ru` → owner runs:

```sql
-- "Право на удаление" — scrub identity link, leave aggregates
UPDATE events
SET account_id = NULL
WHERE account_id = '<account-uuid>';

-- For hard delete (по запросу пользователя)
DELETE FROM events
WHERE account_id = '<account-uuid>';
```

Anonymized data is NOT ПДн per:
- ст. 3 п. 9 № 152-ФЗ («персональные данные»)
- recital 26 GDPR (anonymized data outside scope)

Hence aggregate counts (DAU/MAU/funnels) remain valid even after personal data deletion.

## Cookie consent

**Текущая позиция**: legitimate interest (security, fraud detection, product improvement). `lc_aid` НЕ передаётся третьим лицам и не используется для рекламы.

**152-ФЗ интерпретация**:
- Cookies, идентифицирующие пользователя, формально ПДн (п. 9 ст. 3).
- Но если они «техническая необходимость» (auth, fraud, performance) — consent не требуется (ст. 6 п. 1 пп. 5).

**Posthog и Я.Метрика** работают по такой же модели.

**TODO**: при первой проверке Роскомнадзора готов аргумент legitimate interest. Если требуют explicit consent — добавить cookie banner (`react-cookie-consent`).

## Cross-device / Multi-tab

- Cross-device: после login на обоих устройствах, события автоматически stitch'ются по `account_id`. Pre-login события каждого устройства остаются в своём anonymous_id (могут быть UPDATE-backfill'нуты на login).
- Multi-tab: `storage` event → `currentAccountId` обновляется в realtime.

## Admin access

- `/admin/analytics` ZA `requireAdmin` guard. Без admin role → 403.
- Все timeline/event queries в admin UI **default 7-day window** для performance.
- Admin browsing events помечены `properties.is_admin=true` → SQL queries фильтруют шум.

## Retention

- **Raw events**: forever (owner choice).
- **Месячные партиции** позволяют `DROP PARTITION events_2025_01` в любой момент.
- Recommendation для 2027+: keep 13 months raw + roll-up в `events_daily` за более старые.

## Re-rotation `EVENTS_AID_SECRET`

Invalidates ВСЕ existing `lc_aid` cookies. Pre-rotation events orphan'ятся (account_id остаётся, новые события начинают новый anonymous_id). Не ротировать без необходимости.
