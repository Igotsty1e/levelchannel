# Operations

Single source of truth по инфраструктуре, деплою, git workflow и
повседневным операциям. Code- и contract-уровень — в [README.md](README.md),
[ARCHITECTURE.md](ARCHITECTURE.md), [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md),
[SECURITY.md](SECURITY.md), [AGENTS.md](AGENTS.md). Этот документ — про то,
**где это всё крутится** и **как это держать живым**.

> Маркер `<!-- FILL IN -->` означает "впиши конкретное значение перед тем,
> как полагаться на этот раздел". Эти маркеры рассчитаны на то, что их
> заменят на реальные хосты/пути/имена.

> Прод деплоится server-side git autodeploy'ем из `origin/main`. Активный
> `/var/www/levelchannel` теперь git-checkout, а rollout делает swap на
> свежий release directory с обязательным health-check после рестарта.
> Перед любым инцидентом сверяй `DEPLOYED_SHA`, `git rev-parse HEAD` в
> проде и `origin/main`. См. §6.

---

## 1. TL;DR — где что лежит

| Контур | Где | Примечание |
|---|---|---|
| Source code | GitHub: `Igotsty1e/levelchannel` (private) | default branch `main` |
| Production runtime | `83.217.202.136` (Timeweb VPS), Ubuntu 24.04.4 LTS, kernel 6.8 | systemd unit `levelchannel` |
| Production database | тот же VPS, Postgres 16.13, слушает `127.0.0.1:5432` + `[::1]:5432` | БД `levelchannel`, app-юзер `levelchannel` |
| Node.js | v20.20.2 (npm 10.8.2) | `/usr/bin/npm`, `/usr/bin/node` |
| Domain | `levelchannel.ru` + `www.levelchannel.ru` (A → `83.217.202.136`) | TLS обязателен (`http://` редиректится 301) |
| TLS | Let's Encrypt, `/etc/letsencrypt/live/levelchannel.ru/` | `certbot.timer` активен → автообновление |
| Reverse proxy | `nginx`, `/etc/nginx/sites-enabled/levelchannel` | простой `proxy_pass http://127.0.0.1:3000`, без `limit_req` (см. §13) |
| Process manager | `systemd`, юнит `/etc/systemd/system/levelchannel.service` | `User=levelchannel`, `WorkingDirectory=/var/www/levelchannel`, `ExecStart=/usr/bin/npm run start` |
| Auto-deploy | `systemd` timer `levelchannel-autodeploy.timer` + service `/etc/systemd/system/levelchannel-autodeploy.service` | раз в минуту сверяет `origin/main`, см. §6 |
| Env file | `/etc/levelchannel.env` (chmod 600, root:root) | подключается через `EnvironmentFile=` в systemd unit |
| SSH | root + ed25519 ключ `~/.ssh/levelchannel_timeweb_ed25519` (на машине оператора) | password auth включён (gap, §13) |
| Firewall (ufw) | OpenSSH + Nginx Full + `10050/tcp` (Zabbix agent от Timeweb) | прикрывает gap с `*:3000` в краткосроке |
| **Деплой** | **Git-based autodeploy с сервера** | `/usr/local/bin/levelchannel-autodeploy` делает clone → `npm ci` → `npm run build` → swap → health-check |
| Email транспорт | пока не нужен (чеки шлёт CloudKassir) | — |
| Платёжный провайдер | CloudPayments | <!-- FILL IN: ID кабинета (есть в .env как CLOUDPAYMENTS_PUBLIC_ID) --> |
| Онлайн-касса | CloudKassir (входит в CloudPayments) | <!-- FILL IN: статус ОФД --> |
| Логи | `journalctl -u levelchannel`, `/var/log/nginx/access.log`, `/var/log/nginx/error.log` | см. §8 |
| Бэкапы БД | **не настроены** | см. §13 |
| Uptime monitor | **не настроен** | подключай на `/api/health` |
| Error tracking | не подключено (Sentry в roadmap) | — |
| External monitoring | Zabbix agent на `:10050` (от Timeweb) | внутренние метрики хоста, не приложения |

---

## 2. Git workflow

**Remote:** `https://github.com/Igotsty1e/levelchannel.git` (private).

**Default branch:** `main`. Это и dev, и prod. Долгоживущих feature-веток сейчас нет.
Каждый push в `main` считается production-bound, потому что его подберёт
`levelchannel-autodeploy.timer`.

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

**Хост:** `83.217.202.136`, VPS на Timeweb.
**OS:** Ubuntu 24.04.4 LTS (kernel 6.8.0-110-generic).
**Node.js версия:** v20.20.2, npm 10.8.2.
**Рабочая директория:** `/var/www/levelchannel` (активный git-checkout текущего release).
**Пользователь, под которым крутится app:** `levelchannel` (system user).
**Env file:** `/etc/levelchannel.env` (chmod 600, root:root, подключается через `EnvironmentFile=` в systemd unit).
**Порт, который слушает Next:** `3000`. Сейчас bind на `*:3000` (gap, §13). Должен быть `127.0.0.1:3000`, перед ним nginx.

### SSH

```bash
# с машины оператора (Ivan)
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136
```

Сейчас на сервере включены `PermitRootLogin yes` и
`PasswordAuthentication yes` (см. §13 — это hardening долг). До его
закрытия — не публиковать IP сервера в публичных issue / wiki.

### Process manager — systemd

```bash
sudo systemctl status levelchannel
sudo systemctl restart levelchannel
sudo journalctl -u levelchannel -f         # follow логов
sudo journalctl -u levelchannel --since "1 hour ago"
sudo systemctl status levelchannel-autodeploy.timer
sudo journalctl -u levelchannel-autodeploy.service --since "1 hour ago"
```

Файл юнита: `/etc/systemd/system/levelchannel.service`. Текущее
содержимое:

```ini
[Unit]
Description=LevelChannel Next.js app
After=network.target

[Service]
Type=simple
User=levelchannel
Group=levelchannel
WorkingDirectory=/var/www/levelchannel
EnvironmentFile=/etc/levelchannel.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Reverse proxy — nginx

Конфиг: `/etc/nginx/sites-enabled/levelchannel`. Сейчас минимальный —
TLS termination + proxy_pass. **Нет `limit_req_zone`** на nginx-уровне
(долг, §13). HTTP→HTTPS редирект работает.

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

**certbot --nginx**, сертификаты в `/etc/letsencrypt/live/levelchannel.ru/`,
автообновление через `certbot.timer` (active). Конфиг nginx уже включает
`include /etc/letsencrypt/options-ssl-nginx.conf` и `ssl_dhparam`.

```bash
# проверить
sudo certbot certificates
sudo systemctl status certbot.timer

# принудительное обновление (обычно не надо)
sudo certbot renew --dry-run            # тест
sudo certbot renew                       # реальное
```

---

## 4. Domain & DNS

**Домен:** `levelchannel.ru` + `www.levelchannel.ru` (оба обслуживаются
тем же nginx server-block'ом). HTTP редиректится 301 на HTTPS.

| Запись | Значение |
|---|---|
| A `levelchannel.ru` | `83.217.202.136` |
| A `www.levelchannel.ru` | `83.217.202.136` (или CNAME → `levelchannel.ru`) |
| AAAA | <!-- FILL IN: проверить, есть ли IPv6 у VPS, и AAAA-запись --> |
| MX | <!-- FILL IN: если на домене настроена почта --> |
| TXT (SPF/DKIM/DMARC) | <!-- FILL IN: если шлёшь почту с домена; сейчас для лендинга не нужно --> |

Регистратор и панель управления DNS: <!-- FILL IN: REG.RU / NameSilo / у Timeweb? -->.

---

## 5. Database

**Engine:** PostgreSQL 16.13 (Ubuntu пакет `postgresql-16`).
**Хост:** `127.0.0.1:5432` + `[::1]:5432` на том же VPS (`83.217.202.136`).
Наружу БД не торчит — доступ только локально на сервере или через
SSH-туннель.
**База:** `levelchannel`
**Пользователь приложения:** `levelchannel`
**Пароль:** хранится только в `.env` на сервере, не в репозитории.
**Connection string** (в формате `DATABASE_URL`):
`postgresql://levelchannel:<password>@127.0.0.1:5432/levelchannel?sslmode=disable`

**Таблицы (источник истины — `migrations/`, см. ниже):**

| Таблица | Миграция | Назначение |
|---|---|---|
| `payment_orders` | `migrations/0001_payment_orders.sql` | заказы / lifecycle / events |
| `payment_card_tokens` | `migrations/0002_payment_card_tokens.sql` | сохранённые токены карт (PK = customer_email) |
| `payment_telemetry` | `migrations/0003_payment_telemetry.sql` | событийный лог checkout (privacy-friendly: e-mail хешируется, IP маскируется до /24) |
| `idempotency_records` | `migrations/0004_idempotency_records.sql` | dedup для money-роутов |
| `_migrations` | служебная, создаётся runner'ом | bookkeeping применённых миграций |

**Migration runner.** Схема теперь живёт в `migrations/NNNN_*.sql`. Накатить:

```bash
DATABASE_URL=postgres://... npm run migrate:up
DATABASE_URL=postgres://... npm run migrate:status
```

Ребят `ensureSchema*` функций в коде (`lib/payments/store-postgres.ts`,
`lib/security/idempotency-postgres.ts`, `lib/telemetry/store-postgres.ts`)
оставлены как safety net и idempotent. На прод-БД, где таблицы уже
существуют, `migrate:up` ничего не меняет — фиксирует bookkeeping в
`_migrations`. Подробнее — `migrations/README.md`.

**Подключение runner'а в autodeploy — отдельная задача (queued).** Сейчас
`/usr/local/bin/levelchannel-autodeploy` НЕ вызывает `npm run migrate:up`.
Пока не подключено — после первого ручного `migrate:up` на проде новые
миграции придётся запускать руками тем же `npm run migrate:up` (через ssh)
**до** деплоя кода, который от них зависит.

### Доступ для отладки — три способа

**1. Самый быстрый — psql на сервере под `postgres`-суперюзером:**

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136
sudo -u postgres psql -d levelchannel
```

```sql
\dt                    -- список таблиц
\q                     -- выйти
```

**2. Однострочник (top-20 платежей, без входа в консоль):**

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 \
  "sudo -u postgres psql -d levelchannel -c \"select invoice_id, status, amount_rub, customer_email, created_at from payment_orders order by created_at desc limit 20;\""
```

**3. SSH-туннель для GUI (TablePlus / DBeaver / pgAdmin):**

```bash
# в отдельном терминале:
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 \
    -L 5433:127.0.0.1:5432 \
    root@83.217.202.136
```

Подключение в клиенте:

| Поле | Значение |
|---|---|
| Host | `127.0.0.1` |
| Port | `5433` (локальный порт туннеля) |
| Database | `levelchannel` |
| User | `levelchannel` |
| Password | пароль app-юзера БД (из `.env` на сервере) |

Альтернатива — встроенный SSH в TablePlus:

| Поле | Значение |
|---|---|
| DB Host | `127.0.0.1` |
| DB Port | `5432` |
| Database | `levelchannel` |
| User | `levelchannel` |
| SSH Host | `83.217.202.136` |
| SSH Port | `22` |
| SSH User | `root` |
| SSH Key | `~/.ssh/levelchannel_timeweb_ed25519` |

### Полезные запросы (под app-юзером через `$DATABASE_URL`)

```bash
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

### Retention и удаление персональных данных

Минимальная операционная политика хранения для текущего контура:

| Категория данных | Где хранится | Срок |
|---|---|---|
| Оплаченные заказы, статусы оплаты, webhook events, proof of consent | `payment_orders` | 5 лет после окончания отчётного года платежа |
| Неоплаченные / отменённые / failed заказы без спора | `payment_orders` | до 30 дней |
| Сохранённые токены карт | `payment_card_tokens` | до удаления пользователем, отзыва consent на one-click или прекращения необходимости |
| Checkout telemetry | `payment_telemetry` | до 90 дней |
| ФИО / телефон / доп. e-mail из Telegram, Gmail, Edvibe, если они не вошли в бухгалтерские документы | внешние сервисы связи и внутренние рабочие записи | до завершения занятий и расчётов, затем до 30 дней |
| Backup БД | `/var/backups/levelchannel` | 14 дней |

Минимальная процедура удаления по запросу субъекта ПДн:

1. Принять запрос на `igptstyle227@gmail.com` и зафиксировать дату получения.
2. Проверить, какие данные ещё нужны для договора, налогового, бухгалтерского или платёжного учёта.
3. Удалить или обезличить данные, по которым больше нет законного основания для хранения.
4. Отдельно удалить переписку и вспомогательные записи в Telegram / Gmail / Edvibe, если они больше не нужны.
5. Сохранить краткую внутреннюю отметку: кто удалял, что удалено, на каком основании и в какую дату.

---

## 6. Deploy

**Текущий механизм: server-side git autodeploy из `origin/main`.**
За rollout отвечает `/usr/local/bin/levelchannel-autodeploy`, который
запускается `systemd` timer'ом `levelchannel-autodeploy.timer` раз в
минуту. Схема простая:

1. узнать `target_sha` через `git ls-remote` на `origin/main`
2. если SHA не изменился, выйти без действий
3. клонировать свежий release в `/var/www/levelchannel.release-<sha12>`
4. выполнить `env -u NODE_ENV npm ci`
5. загрузить `/etc/levelchannel.env` и выполнить `env -u NODE_ENV npm run build`
6. записать `DEPLOYED_SHA`
7. остановить `levelchannel`
8. переименовать текущий `/var/www/levelchannel` в `/var/www/levelchannel.prev-<timestamp>`
9. переместить новый release в `/var/www/levelchannel`
10. запустить `levelchannel` и проверить `http://127.0.0.1:3000/api/health`
11. оставить только три последних `levelchannel.prev-*`

`postbuild.js` и `public/.htaccess` остаются legacy от первой
static-export версии, в текущем server-режиме не участвуют в deploy.

### Что именно крутит deploy

| Компонент | Где | Роль |
|---|---|---|
| Deploy script | `/usr/local/bin/levelchannel-autodeploy` | весь rollout, build и swap |
| Deploy unit | `/etc/systemd/system/levelchannel-autodeploy.service` | oneshot запуск скрипта |
| Deploy timer | `/etc/systemd/system/levelchannel-autodeploy.timer` | `OnBootSec=2min`, `OnUnitActiveSec=1min`, `Persistent=true` |
| GitHub auth | `/home/levelchannel/.ssh/github_deploy` + `/home/levelchannel/.ssh/config` | read-only deploy key для `git@github.com:Igotsty1e/levelchannel.git` |

### Нормальный путь выката

```bash
# 1. Локально: подготовить чистый main и пройти gates
cd ~/LevelChannel
git checkout main
git pull --ff-only origin main
npm ci
npm run test:run
npm run build

# 2. Закоммитить и запушить в main
git push origin main

# 3. Подождать до минуты и проверить rollout
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  systemctl status levelchannel-autodeploy.timer --no-pager
  journalctl -u levelchannel-autodeploy.service --since "10 minutes ago" --no-pager
  cat /var/www/levelchannel/DEPLOYED_SHA
  su -s /bin/bash -c "git -C /var/www/levelchannel rev-parse HEAD" levelchannel
  curl -s http://127.0.0.1:3000/api/health
'
```

### Ручной запуск deploy без ожидания timer'а

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  systemctl start levelchannel-autodeploy.service
  journalctl -u levelchannel-autodeploy.service -n 100 --no-pager
'
```

### Smoke test после deploy

```bash
curl -s https://levelchannel.ru/api/health | jq
# ожидаемо: {"status":"ok","provider":"cloudpayments","storage":"postgres",...}

curl -s -o /dev/null -w "%{http_code}\n" https://levelchannel.ru/
# ожидаемо: 200

curl -s -X POST https://levelchannel.ru/api/payments/webhooks/cloudpayments/check \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "test=1" -w "\nHTTP %{http_code}\n"
# ожидаемо: HTTP 401, потому что HMAC нет, но маршрут жив
```

### Как проверить, какой коммит сейчас в проде

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  cat /var/www/levelchannel/DEPLOYED_SHA
  su -s /bin/bash -c "git -C /var/www/levelchannel rev-parse HEAD" levelchannel
'

cd ~/LevelChannel
git fetch origin main
git rev-parse origin/main
```

Если SHA не совпадают, обычно это значит, что deploy timer ещё не успел
сходить на GitHub или последний rollout упал. Смотри
`journalctl -u levelchannel-autodeploy.service`.

### Rollback

Важно: если просто вернуть старую директорию, timer через минуту снова
накатит текущий `origin/main`. Поэтому rollback всегда начинается с паузы
autodeploy.

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  systemctl stop levelchannel-autodeploy.timer
  latest_prev=$(ls -1dt /var/www/levelchannel.prev-* | head -n 1)
  test -n "$latest_prev"
  systemctl stop levelchannel
  mv /var/www/levelchannel /var/www/levelchannel.bad-$(date +%Y%m%d-%H%M%S)
  mv "$latest_prev" /var/www/levelchannel
  systemctl start levelchannel
  sleep 2
  systemctl is-active levelchannel
  curl -fsS http://127.0.0.1:3000/api/health
'
```

После этого:

1. сделать `git revert` проблемного коммита в `main` или быстро
   подготовить фикс
2. запушить исправление
3. включить timer обратно

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  systemctl start levelchannel-autodeploy.timer
  systemctl status levelchannel-autodeploy.timer --no-pager
'
```

Если rollback упирается в несовместимость со схемой БД, правило то же:
наши текущие изменения безопасны, пока миграции add-only. Если когда-то
появится destructive schema change, перед rollback нужен restore из backup.

### Pre-push чеклист

- [ ] локально: `npm run test:run` зелёный
- [ ] локально: `npm run build` зелёный
- [ ] на сервере: `df -h /` показывает запас места для нового release
- [ ] на сервере: `pg_isready` отвечает ok
- [ ] изменения в env? — сначала обновлён `/etc/levelchannel.env`, потом push
- [ ] понимаешь, что push в `main` поедет в прод автоматически

### Запрещённые практики

- ручной `rsync` / `scp` в `/var/www/levelchannel`
- правки файлов прямо на сервере без коммита
- restart `levelchannel` как способ "задеплоить код", если `origin/main`
  не обновлялся
- rollback без остановки `levelchannel-autodeploy.timer`

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

## 13. Долги и known security gaps

### Server hardening (SSH)

Сейчас на `83.217.202.136`:

| Что | Текущее | Должно быть |
|---|---|---|
| `PermitRootLogin` | `yes` | `prohibit-password` (только по ключу) или, лучше, отдельный sudo-юзер + `no` для root |
| `PasswordAuthentication` | `yes` | `no` (только публичные ключи) |
| Key-based access | работает (`levelchannel_timeweb_ed25519`) | оставить |

Mitigation сейчас: `ufw` пропускает наружу только `22/80/443`, и
ключевой доступ настроен. Это снимает остроту, но не решает: пароль на
SSH — постоянно открытая дверь под брутфорс с ботнета (на 22 порт).

Закрытие (порядок строго такой):
```bash
# 1. Убедись, что ключевой доступ работает (ты сейчас именно так и заходишь — ок)
# 2. На сервере:
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sudo sshd -t                             # проверка синтаксиса
sudo systemctl restart ssh
# 3. НЕ закрывая текущую сессию — открой новую и убедись, что заходишь.
#    Если что — есть провайдерская VNC-консоль у Timeweb.
```

### Application binding

`next start` слушает `*:3000` вместо `127.0.0.1:3000`. Сейчас прикрыт ufw,
но если кто-то перенастроит firewall — приложение сразу окажется в
интернете без TLS. Фиксы:

```bash
# В юните /etc/systemd/system/levelchannel.service:
# ExecStart=/usr/bin/node node_modules/.bin/next start --hostname 127.0.0.1 --port 3000
sudo systemctl daemon-reload
sudo systemctl restart levelchannel
ss -tlnp | grep :3000        # убедись, что binding 127.0.0.1, не *
```

### Прочие долги (operations)

- зафиксировать всё, что помечено `<!-- FILL IN -->` в этом файле
- настроить uptime monitor на `/api/health` (UptimeRobot free / BetterStack)
- настроить ежедневный `pg_dump` + retention минимум 14 дней
- подключить Sentry или хотя бы `journald` → лог-агрегатор
- зафиксировать ротацию `CLOUDPAYMENTS_API_SECRET` (раз в N месяцев или по событию)
- добавить `nginx limit_req_zone` (если в текущем конфиге его нет)
- backup retention 14 дней не заменяет отдельный архивный контур. По
  152-ФЗ персональные данные надо хранить только пока цель обработки
  актуальна, а платёжные записи и связанные доказательства согласия
  должны оставаться доступными в основной БД и рабочих архивах весь
  обязательный срок хранения

### git ↔ prod синхронизация

`/var/www/levelchannel` теперь git-checkout последнего успешного release.
Главный вопрос уже не "есть ли там git", а "дошёл ли последний deploy до
healthy состояния".

**Как проверить текущий state в любой момент:**

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  systemctl status levelchannel-autodeploy.timer --no-pager
  journalctl -u levelchannel-autodeploy.service -n 50 --no-pager
  cat /var/www/levelchannel/DEPLOYED_SHA
  su -s /bin/bash -c "git -C /var/www/levelchannel rev-parse HEAD" levelchannel
  curl -s http://127.0.0.1:3000/api/health
'
```

Потом локально:

```bash
cd ~/LevelChannel
git fetch origin main
git rev-parse origin/main
```

Если SHA не совпадают дольше пары минут, это уже инцидент deploy pipeline:
смотри `journalctl -u levelchannel-autodeploy.service`, проверяй GitHub
доступ ключом `/home/levelchannel/.ssh/github_deploy` и свободное место
под новый release.
