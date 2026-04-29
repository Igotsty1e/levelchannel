# Operations

Single source of truth по инфраструктуре, деплою, git workflow и
повседневным операциям. Code- и contract-уровень — в [README.md](README.md),
[ARCHITECTURE.md](ARCHITECTURE.md), [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md),
[SECURITY.md](SECURITY.md), [AGENTS.md](AGENTS.md). Этот документ — про то,
**где это всё крутится** и **как это держать живым**.

> Маркер `<!-- FILL IN -->` означает "впиши конкретное значение перед тем,
> как полагаться на этот раздел". Эти маркеры рассчитаны на то, что их
> заменят на реальные хосты/пути/имена.

---

## 1. TL;DR — где что лежит

| Контур | Где | Кто владеет |
|---|---|---|
| Source code | GitHub: `Igotsty1e/levelchannel` (private) | <!-- FILL IN: владелец/контактный человек --> |
| Production runtime | <!-- FILL IN: hostname / IP / провайдер VPS --> | <!-- FILL IN --> |
| Production database | <!-- FILL IN: тот же VPS / managed Postgres / hostname --> | <!-- FILL IN --> |
| Domain | <!-- FILL IN: levelchannel.ru? --> | <!-- FILL IN: регистратор --> |
| TLS | <!-- FILL IN: Let's Encrypt / Cloudflare / другое --> | автоматическое продление: <!-- FILL IN --> |
| Reverse proxy | <!-- FILL IN: nginx / caddy / напрямую `next start` --> | <!-- FILL IN --> |
| Process manager | <!-- FILL IN: systemd / pm2 / другое --> | <!-- FILL IN --> |
| Email транспорт | пока не нужен (чеки шлёт CloudKassir) | — |
| Платёжный провайдер | CloudPayments | <!-- FILL IN: ID кабинета --> |
| Онлайн-касса | CloudKassir (входит в CloudPayments) | <!-- FILL IN --> |
| Логи | <!-- FILL IN: где живут, как читать --> | — |
| Бэкапы БД | <!-- FILL IN: цель, частота, retention --> | — |
| Uptime monitor | <!-- FILL IN: ставится на `/api/health` --> | — |
| Error tracking | пока не подключено (Sentry в roadmap) | — |

---

## 2. Git workflow

**Remote:** `https://github.com/Igotsty1e/levelchannel.git` (private).

**Default branch:** `main`. Это и dev, и prod. Долгоживущих feature-веток сейчас нет.

**Кто пушит:** <!-- FILL IN: ты один / команда из N человек -->.

**Conventional-commit prefix:** обязательный.
- `feat(payments): ...` — новая функциональность
- `fix(payments): ...` — баг-фикс
- `chore(deps): ...` — зависимости
- `test: ...` — только тесты
- `docs: ...` — только документация
- `refactor: ...` — без изменения поведения

**Перед push:** `npm run test:run` + `npm run build` локально. Оба должны
быть зелёными. Если падает coverage gate (70%) — добавь тест в этом же
коммите, а не follow-up'ом.

**Что нельзя делать:**
- force-push в main
- amend опубликованного коммита
- commit `.env` или `data/payment-orders.json`
- commit чего-либо с `CLOUDPAYMENTS_API_SECRET=` или похожим

**Tags / релизы:** пока не используются. Если появится релиз-цикл,
схема: `v0.<minor>.<patch>` через `git tag -a vX.Y.Z -m "..."`.

---

## 3. Server / runtime

<!-- FILL IN this whole section once known -->

**Хост:** <!-- например, `lc-prod-1.levelchannel.ru` (`<IP>`), <провайдер VPS> -->
**OS:** <!-- Ubuntu 22.04 / Debian 12 / другое -->
**Node.js версия:** <!-- v20.x — должна совпадать с `engines` в package.json -->
**Рабочая директория:** <!-- /opt/levelchannel или /home/levelchannel/app -->
**Пользователь, под которым крутится app:** <!-- levelchannel / www-data -->
**Порт, который слушает Next:** <!-- 3000 -->

### Process manager

<!-- FILL IN: pm2 / systemd / другое -->

Если **systemd**, юнит лежит в `<!-- /etc/systemd/system/levelchannel.service -->`. Команды:

```bash
sudo systemctl status levelchannel
sudo systemctl restart levelchannel
sudo journalctl -u levelchannel -f         # follow логов
sudo journalctl -u levelchannel --since "1 hour ago"
```

Если **pm2**:

```bash
pm2 status
pm2 restart levelchannel
pm2 logs levelchannel --lines 200
```

### Reverse proxy

<!-- FILL IN: nginx / caddy. Конфиг файла. -->

Reverse proxy обязателен для:
- TLS termination (HTTPS)
- gzip / brotli
- inflight rate limiting на уровне инфраструктуры (`limit_req_zone` в nginx)
- передача `X-Forwarded-For` (наш `getClientIp` его читает)

Базовый nginx-блок (если ещё не оформлен):

```nginx
server {
  server_name <!-- FILL IN: levelchannel.ru -->;
  listen 443 ssl http2;
  ssl_certificate /etc/letsencrypt/live/<!-- FILL IN -->/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/<!-- FILL IN -->/privkey.pem;

  # CloudPayments webhooks ходят сюда — не блокируем по UA / referer
  location /api/payments/webhooks/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
  }

  # Per-IP лимит на mutation эндпоинтах. webhook'и не трогаем — там HMAC.
  limit_req_zone $binary_remote_addr zone=payments:10m rate=30r/m;

  location /api/ {
    limit_req zone=payments burst=10 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}

server {
  listen 80;
  server_name <!-- FILL IN -->;
  return 301 https://$host$request_uri;
}
```

### TLS

<!-- FILL IN: certbot --nginx / Caddy auto / Cloudflare proxied -->

Если **certbot**: автообновление через `systemctl status certbot.timer`.
Сертификаты в `/etc/letsencrypt/live/<домен>/`.

---

## 4. Domain & DNS

<!-- FILL IN -->

| Запись | Значение |
|---|---|
| A `<!-- домен -->` | `<!-- IP сервера -->` |
| AAAA `<!-- домен -->` | `<!-- IPv6, если есть -->` |
| MX | `<!-- если используется почта на этом домене -->` |
| TXT (SPF/DKIM/DMARC) | `<!-- если шлёшь почту с домена -->` |

---

## 5. Database

**Engine:** PostgreSQL <!-- FILL IN: 14 / 15 / 16 -->
**Хост:** <!-- FILL IN: `localhost:5432` на app-сервере / managed Yandex.Cloud / другое -->
**База:** <!-- levelchannel -->
**Пользователь приложения:** <!-- levelchannel_app -->
**Connection string:** хранится только в production env как `DATABASE_URL`,
никогда в репозитории.

**Таблицы (создаются автоматически при первом запросе через `ensureSchema*`):**

| Таблица | Файл | Назначение |
|---|---|---|
| `payment_orders` | `lib/payments/store-postgres.ts` | заказы / lifecycle / events |
| `payment_card_tokens` | `lib/payments/store-postgres.ts` | сохранённые токены карт (PK = customer_email) |
| `payment_telemetry` | `lib/telemetry/store-postgres.ts` | событийный лог checkout (privacy-friendly: e-mail хешируется, IP маскируется до /24) |
| `idempotency_records` | `lib/security/idempotency-postgres.ts` | dedup для money-роутов |

**Подключение для отладки:**

```bash
# на app-сервере, под app-юзером
psql "$DATABASE_URL"

# полезные запросы:
\dt                                                       -- список таблиц
select count(*) from payment_orders;
select status, count(*) from payment_orders group by 1;
select * from payment_orders order by created_at desc limit 10;
select * from payment_telemetry where type = 'one_click_3ds_paid' order by at desc limit 20;
select scope, count(*) from idempotency_records group by 1;
```

**Backup:**

<!-- FILL IN: pg_dump cron на сервере? managed snapshot? куда складывается? retention? -->

Минимально-приличный setup: ежедневный `pg_dump` через cron, хранение
14 дней, файлы в директории вне репозитория и вне веб-корня.

```bash
# /etc/cron.daily/levelchannel-db-backup
#!/bin/sh
TS=$(date +%Y-%m-%d)
pg_dump "$DATABASE_URL" | gzip > /var/backups/levelchannel/db-$TS.sql.gz
find /var/backups/levelchannel -name "db-*.sql.gz" -mtime +14 -delete
```

**Restore (после инцидента):**

```bash
# проверка содержимого
gunzip -c /var/backups/levelchannel/db-2026-04-29.sql.gz | head -100

# применение в чистую БД (НЕ в production без подтверждения)
gunzip -c /var/backups/levelchannel/db-2026-04-29.sql.gz | psql "$RECOVERY_DATABASE_URL"
```

---

## 6. Deploy

<!-- FILL IN: текущий способ -->

Из того, что я знаю по коду:
- нет `Dockerfile`, нет `docker-compose.yml`
- нет `.github/workflows/`
- нет `ecosystem.config.js` (pm2)
- есть `postbuild.js` — но он работает только на static-export сборке, в server-режиме это no-op (legacy от первой версии)
- есть `public/.htaccess` — это headers + редиректы для **Apache**, тоже legacy от static-сборки. Если за приложением стоит nginx, файл не используется, но и не мешает.

Значит сейчас деплой — **manual git pull + restart**, либо что-то самописное на сервере. Заполни ниже что у тебя реально:

### Текущий механизм деплоя

<!-- FILL IN: один из вариантов -->

#### Вариант A — manual `git pull`

```bash
ssh <user>@<host>
cd /opt/levelchannel
git fetch origin
git pull --ff-only origin main
npm ci
npm run build
sudo systemctl restart levelchannel    # или: pm2 restart levelchannel
```

#### Вариант B — webhook → script

GitHub шлёт push-event на endpoint `<!-- FILL IN -->`, который запускает
`<!-- FILL IN: /opt/levelchannel/scripts/deploy.sh -->` под app-юзером.
Скрипт делает `git pull`, `npm ci && npm run build`, рестарт.

#### Вариант C — GitHub Actions → SSH

`.github/workflows/deploy.yml` на push в main: чекаут, билд, rsync артефактов
на сервер, рестарт через SSH. Сейчас не настроено.

### Pre-deploy чеклист (вручную, если деплой manual)

- [ ] локально: `npm run test:run` зелёный
- [ ] локально: `npm run build` зелёный
- [ ] на сервере: `df -h /` — есть как минимум 2GB свободного
- [ ] на сервере: `pg_isready` отвечает ok
- [ ] изменения в env? — обновил env-файл на сервере ДО pull
- [ ] миграции? — все миграции у нас сейчас идемпотентные `create table if not exists`, схема обновится сама на первом запросе

### Post-deploy smoke test

```bash
curl -s https://<домен>/api/health | jq
# ожидаемо: {"status":"ok","provider":"cloudpayments","storage":"postgres",...}

# проверить, что главная отдаётся
curl -s -o /dev/null -w "%{http_code}\n" https://<домен>/

# проверить webhook reachability (без подписи он отдаст 401, это норма)
curl -s -X POST https://<домен>/api/payments/webhooks/cloudpayments/check \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "test=1" -w "%{http_code}\n"
# ожидаемо: 401 (HMAC missing) — значит маршрут жив
```

### Rollback

```bash
# на сервере
cd /opt/levelchannel
git log --oneline -10                       # найди предыдущий хороший SHA
git reset --hard <SHA>                      # ВНИМАНИЕ: только если SHA уже был задеплоен раньше
npm ci
npm run build
sudo systemctl restart levelchannel
```

Если rollback вызывает несовместимость со схемой БД — миграции у нас
add-only (`create table if not exists`), значит откат кода со старыми
таблицами безопасен. Но если ты добавил `alter table ... drop column`,
сначала восстанови backup БД.

---

## 7. Environment variables (production)

Файл живёт **только** на app-сервере, не в репозитории:

```dotenv
NODE_ENV=production

PAYMENTS_PROVIDER=cloudpayments
PAYMENTS_STORAGE_BACKEND=postgres

# критично: false. config.ts уронит boot если =true в проде.
PAYMENTS_ALLOW_MOCK_CONFIRM=false

# реальный домен с https. config.ts проверит на старте.
NEXT_PUBLIC_SITE_URL=https://<!-- FILL IN: домен -->

DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<db>?sslmode=<!-- prefer для managed PG, disable для local -->

# 32+ случайных символов; используется для HMAC-хеша e-mail в телеметрии.
# Не должен совпадать с CLOUDPAYMENTS_API_SECRET.
TELEMETRY_HASH_SECRET=<!-- FILL IN -->

CLOUDPAYMENTS_PUBLIC_ID=<!-- FILL IN из кабинета CloudPayments -->
CLOUDPAYMENTS_API_SECRET=<!-- FILL IN из кабинета CloudPayments -->
```

`.env` на сервере — права `chmod 600`, владелец = app-юзер. Не в git, не
в публичной директории.

### Ротация секретов

- **`CLOUDPAYMENTS_API_SECRET`**: ротация в личном кабинете CloudPayments,
  затем на сервере: `vim .env`, `systemctl restart levelchannel`. Старые
  webhook подписи перестанут проверяться сразу — координируй с тем, чтобы
  у CP не висели в очереди ретраи на старом ключе.
- **`TELEMETRY_HASH_SECRET`**: можно ротировать без бизнес-импакта — это
  сломает связку «один и тот же e-mail в телеметрии до и после ротации»,
  но сами события не теряются.
- **`DATABASE_URL`**: смена пароля БД — обновить в `.env`, рестарт.

---

## 8. Logs

<!-- FILL IN -->

| Источник | Где смотреть |
|---|---|
| App stdout/stderr | <!-- journalctl -u levelchannel / pm2 logs / файл --> |
| Reverse proxy access | <!-- /var/log/nginx/access.log --> |
| Reverse proxy errors | <!-- /var/log/nginx/error.log --> |
| Database slow query | <!-- если включён `log_min_duration_statement` --> |
| OS / auth | `/var/log/auth.log` |

### Что искать при разборе платёжной проблемы

```bash
# все события по конкретному invoiceId
journalctl -u levelchannel --since "1 day ago" | grep "lc_<invoiceId>"

# только webhook'и от CloudPayments
journalctl -u levelchannel --since "1 day ago" | grep "/api/payments/webhooks/"

# 401 на webhook = подпись не сошлась — это самое больное место
journalctl -u levelchannel --since "6 hours ago" | grep -E "(HMAC|401)"

# отказы CloudPayments tokens/charge
journalctl -u levelchannel | grep -E "(charge-token|tokens/charge|requires_3ds|declined)"
```

---

## 9. Monitoring

**Health endpoint:** `GET /api/health` (см. PAYMENTS_SETUP.md). Возвращает
200 / 503. Подключи uptime monitor:

- <!-- FILL IN: UptimeRobot / BetterStack / Healthchecks.io / самописный cron -->
- интервал: 60s
- timeout: 10s
- алерт: <!-- FILL IN: куда -->

**Что НЕ настроено (в roadmap):**
- Sentry / error tracking — пока ловишь только по логам
- Slack/Telegram алерт по успешному платежу — opt'ed out оператором
- Webhook failure alerting — пока разбирается вручную через `journalctl`
- Disk usage monitoring

---

## 10. CloudPayments кабинет

<!-- FILL IN: ID кабинета, контактный e-mail аккаунта -->

**Webhooks** (настраиваются в кабинете → Сайт → Уведомления):

| Событие | URL |
|---|---|
| Check | `https://<домен>/api/payments/webhooks/cloudpayments/check` |
| Pay | `https://<домен>/api/payments/webhooks/cloudpayments/pay` |
| Fail | `https://<домен>/api/payments/webhooks/cloudpayments/fail` |

Все три — POST, формат: `application/x-www-form-urlencoded` или
`application/json` (мы понимаем оба). HMAC включить обязательно
(`X-Content-HMAC` / `Content-HMAC`).

**Платежи в один клик / cofRecurring** — **включить**, иначе
`/payments/tokens/charge` будет возвращать ошибку.

**ОФД / онлайн-касса** — переведена в боевой режим, чеки шлются на
e-mail из `receiptEmail`.

---

## 11. Common ops runbook

### Найти заказ по e-mail клиента

```bash
psql "$DATABASE_URL" -c "
  select invoice_id, amount_rub, status, created_at, paid_at
  from payment_orders
  where customer_email = '<email>'
  order by created_at desc;
"
```

### Найти заказ, который «застрял» в pending

```bash
psql "$DATABASE_URL" -c "
  select invoice_id, amount_rub, customer_email, created_at, updated_at
  from payment_orders
  where status = 'pending' and created_at < now() - interval '30 minutes'
  order by created_at desc;
"
```

Если это CloudPayments-ордер — webhook не дошёл. Проверь:
1. `/api/health` отвечает 200
2. nginx access log: приходил ли POST на `/api/payments/webhooks/cloudpayments/pay`
3. CloudPayments кабинет → история уведомлений → есть ли ретраи
4. Если нужно вручную закрыть — НЕ через mock confirm (он закрыт в проде).
   Используй CP кабинет: запусти повтор уведомления, наша обработка
   идемпотентна.

### Посмотреть события одного заказа

```bash
psql "$DATABASE_URL" -c "
  select jsonb_array_elements(events)
  from payment_orders
  where invoice_id = 'lc_<id>';
"
```

### Посмотреть, у кого есть сохранённая карта

```bash
psql "$DATABASE_URL" -c "
  select customer_email, card_last_four, card_type, created_at, last_used_at
  from payment_card_tokens
  order by last_used_at desc;
"
```

### Удалить токен по запросу клиента (152-ФЗ)

```bash
psql "$DATABASE_URL" -c "
  delete from payment_card_tokens where customer_email = '<email>';
"
```

То же делает кнопка «Забыть эту карту» в UI — но иногда клиент пишет
вручную.

### Очистить старые idempotency-записи

```bash
psql "$DATABASE_URL" -c "
  delete from idempotency_records where created_at < now() - interval '24 hours';
"
```

Опционально через cron: `0 3 * * * psql ... -c "delete ..."`.

### Перезапустить runtime

```bash
sudo systemctl restart levelchannel    # или pm2 restart levelchannel
sudo journalctl -u levelchannel -f     # подтвердить, что встал чисто
curl -s https://<домен>/api/health | jq    # должен быть status: ok
```

### Включить временно verbose logging

В коде нет log-level переключателя. Если нужен глубокий debug — поставь
`console.log` точечно в нужное место, задеплой, отключи после.

---

## 12. Incident playbook

### Симптом: «оплата прошла, но клиент видит pending»

1. Найди ордер по invoice_id или email (см. §11).
2. Проверь `status` в БД — реально pending?
3. Проверь, дошёл ли webhook: `journalctl ... | grep "/webhooks/cloudpayments/pay"` за последние 30 мин.
4. Если webhook не дошёл: CP кабинет → отправь уведомление повторно. У нас обработка идемпотентна — не задвоится.
5. Если webhook дошёл, но ордер всё равно pending: смотри events ордера, скорее всего HMAC не сошёлся (`{"code":13}`). Проверь `CLOUDPAYMENTS_API_SECRET` в .env vs в кабинете.

### Симптом: `/api/health` отдаёт 503

1. `journalctl -u levelchannel -n 100` — что в логах?
2. `pg_isready -d "$DATABASE_URL"` — БД жива?
3. Проверь `df -h /` — диск не забит ли?
4. Если runtime упал и не поднимается: `systemctl status levelchannel`,
   `systemctl restart levelchannel`, смотри stderr.

### Симптом: «банк не пускает на 3DS»

1. Найди ордер с `metadata.threeDs.transactionId`.
2. Проверь telemetry: `select * from payment_telemetry where invoice_id = '<id>' order by at`.
3. Если `one_click_3ds_callback` есть, а `one_click_3ds_paid` нет —
   `confirmThreeDsAndFinalize` отдала `declined` или `error`. В `events`
   ордера должна быть запись `one_click.3ds_error` или `payment.failed`.
4. Если `one_click_3ds_callback` нет — пользователь не вернулся с ACS
   банка. Это не наш баг, но мы можем не получить webhook от CP. Через
   несколько минут CP сам пометит транзакцию как timeout и пришлёт Fail.

### Симптом: подозрение на брутфорс / DDoS

1. `tail -f /var/log/nginx/access.log` — посмотри топ IP
2. `journalctl -u levelchannel | grep "Too many requests"` — наш limiter
   уже отбивает что-то
3. Если поток выше limiter capacity — ужесточи `limit_req_zone` в nginx
   (см. §3) и сделай `nginx -s reload`

---

## 13. Что осталось в долге (operations side)

- зафиксировать всё, что помечено `<!-- FILL IN -->` в этом файле
- настроить uptime monitor на `/api/health`
- настроить ежедневный `pg_dump` + retention 14 дней
- подключить Sentry или хотя бы `journald` → лог-агрегатор
- автоматизировать deploy (либо webhook-скрипт, либо GitHub Actions)
- зафиксировать ротацию `CLOUDPAYMENTS_API_SECRET` (раз в N месяцев или по событию)
- добавить `nginx limit_req_zone` если деплой пока без него
- backup retention 14 дней — мало для бухгалтерии. По 152-ФЗ персональные
  данные надо хранить только пока цель обработки актуальна, но платёжные
  записи нужны для налоговой минимум 5 лет — продумай отдельный архив
