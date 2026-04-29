# Operations

Single source of truth по инфраструктуре, деплою, git workflow и
повседневным операциям. Code- и contract-уровень — в [README.md](README.md),
[ARCHITECTURE.md](ARCHITECTURE.md), [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md),
[SECURITY.md](SECURITY.md), [AGENTS.md](AGENTS.md). Этот документ — про то,
**где это всё крутится** и **как это держать живым**.

> Маркер `<!-- FILL IN -->` означает "впиши конкретное значение перед тем,
> как полагаться на этот раздел". Эти маркеры рассчитаны на то, что их
> заменят на реальные хосты/пути/имена.

> **⚠ Production drift (зафиксировано аудитом 2026-04-29):** на сервере
> `/var/www/levelchannel` НЕ является git-репозиторием, и его содержимое
> отстаёт от `origin/main` минимум на 5 коммитов (legal-блок + opt-in
> tokens + one-click + 3DS + idempotency + telemetry-postgres + health +
> tests + docs). На проде сейчас работает версия от 28 апреля. Деплой
> делается через прямой upload (scp / rsync с локальной машины), не через
> `git pull`. Перед любой работой с прод-инцидентами помни: код там
> другой. См. §6 для процедуры догнать.

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
| Env file | `/etc/levelchannel.env` (chmod 600, root:root) | подключается через `EnvironmentFile=` в systemd unit |
| SSH | root + ed25519 ключ `~/.ssh/levelchannel_timeweb_ed25519` (на машине оператора) | password auth включён (gap, §13) |
| Firewall (ufw) | OpenSSH + Nginx Full + `10050/tcp` (Zabbix agent от Timeweb) | прикрывает gap с `*:3000` в краткосроке |
| **Деплой** | **Manual upload (scp/rsync с локальной машины)** | На сервере НЕТ `.git` — workdir не git-репо. См. §6. |
| Email транспорт | пока не нужен (чеки шлёт CloudKassir) | — |
| Платёжный провайдер | CloudPayments | <!-- FILL IN: ID кабинета (есть в .env как CLOUDPAYMENTS_PUBLIC_ID) --> |
| Онлайн-касса | CloudKassir (входит в CloudPayments) | <!-- FILL IN: статус ОФД --> |
| Логи | `journalctl -u levelchannel`, `/var/log/nginx/access.log`, `/var/log/nginx/error.log` | см. §8 |
| Бэкапы БД | **не настроены** | см. §13 |
| Uptime monitor | **не настроен** | подключай на `/api/health` (после деплоя — сейчас 404) |
| Error tracking | не подключено (Sentry в roadmap) | — |
| External monitoring | Zabbix agent на `:10050` (от Timeweb) | внутренние метрики хоста, не приложения |

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

**Хост:** `83.217.202.136`, VPS на Timeweb.
**OS:** Ubuntu 24.04.4 LTS (kernel 6.8.0-110-generic).
**Node.js версия:** v20.20.2, npm 10.8.2.
**Рабочая директория:** `/var/www/levelchannel` (НЕ git-репо — см. §6).
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
```

```bash
sudo systemctl status levelchannel
sudo systemctl restart levelchannel
sudo journalctl -u levelchannel -f         # follow логов
sudo journalctl -u levelchannel --since "1 hour ago"
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

**Таблицы (создаются автоматически при первом запросе через `ensureSchema*`):**

| Таблица | Файл | Назначение |
|---|---|---|
| `payment_orders` | `lib/payments/store-postgres.ts` | заказы / lifecycle / events |
| `payment_card_tokens` | `lib/payments/store-postgres.ts` | сохранённые токены карт (PK = customer_email) |
| `payment_telemetry` | `lib/telemetry/store-postgres.ts` | событийный лог checkout (privacy-friendly: e-mail хешируется, IP маскируется до /24) |
| `idempotency_records` | `lib/security/idempotency-postgres.ts` | dedup для money-роутов |

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

---

## 6. Deploy

**Текущий механизм: manual upload через rsync/scp с локальной машины оператора.**
Нет `Dockerfile`, нет `docker-compose.yml`, нет `.github/workflows/`,
нет pm2, и **нет `.git` в `/var/www/levelchannel`** — workdir на сервере
**не git-репозиторий**. Файлы попадают туда копированием, без аудит-trail
"какой sha сейчас крутится".

`postbuild.js` и `public/.htaccess` — legacy от первой static-export
версии, в текущем server-режиме не используются.

### Процедура деплоя: build-локально → rsync → restart

```bash
# 1. На локальной машине: подтянуть последний main, прогнать gates
cd ~/LevelChannel
git checkout main
git pull --ff-only origin main
npm ci
npm run test:run                        # 87 tests должны быть зелёные
npm run build                           # должен дойти до "✓ Compiled successfully"

# 2. Rsync артефактов на прод. Исключаем dev-only мусор и data-store.
#    Включаем .next (готовый билд), node_modules (production deps),
#    исходники (Next в server-режиме читает их при старте).
rsync -avz --delete \
  --exclude='.git/' \
  --exclude='.next/cache/' \
  --exclude='data/' \
  --exclude='tests/' \
  --exclude='vitest.config.ts' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.DS_Store' \
  -e "ssh -i ~/.ssh/levelchannel_timeweb_ed25519" \
  ./ root@83.217.202.136:/var/www/levelchannel/

# 3. На сервере: вернуть владельца файлам и рестартнуть
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  chown -R levelchannel:levelchannel /var/www/levelchannel
  systemctl restart levelchannel
  sleep 2
  systemctl is-active levelchannel
  curl -sS -o /dev/null -w "/api/health -> %%{http_code}\n" http://127.0.0.1:3000/api/health
'
```

### Smoke test после деплоя

```bash
# С внешней сети — health endpoint должен вернуть 200 ok
curl -s https://levelchannel.ru/api/health | jq

# Webhook reachability (без HMAC он отдаст 401, это норма)
curl -s -X POST https://levelchannel.ru/api/payments/webhooks/cloudpayments/check \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "test=1" -w "\nHTTP %{http_code}\n"
# ожидаем: HTTP 401 (HMAC missing/invalid) — значит роут жив
```

### Записать что катилось

Поскольку `.git` на проде нет, sha из коммита нужно класть рядом с
артефактами, иначе через неделю никто не вспомнит что в проде. Пока
делаем так — после rsync дописать `git rev-parse HEAD` в файл на сервере:

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 \
  "echo $(git rev-parse HEAD) > /var/www/levelchannel/DEPLOYED_SHA"
```

Тогда `cat /var/www/levelchannel/DEPLOYED_SHA` всегда покажет что катилось.

### Rollback

Поскольку git на проде нет, rollback = выкатить старый sha с локальной
машины:

```bash
cd ~/LevelChannel
git checkout <previous-sha>            # sha из DEPLOYED_SHA из бэкапа /var/www/levelchannel/
npm ci
npm run build
# повторить процедуру rsync выше
git checkout main                       # вернуться на main для дальнейшей работы
```

Если откат вызывает несовместимость со схемой БД — миграции у нас
add-only (`create table if not exists`), значит откат кода со старыми
таблицами безопасен. Но если кто-то добавил `alter table ... drop column`
в новом релизе, сначала восстанови backup БД.

### Долг: переехать на git pull

Текущий manual-upload механизм опасен:
- нет аудит-trail
- любой rsync может затереть случайно правленные на сервере файлы
- если оператор на разных машинах — состояние на проде непредсказуемо

Стандартный фикс — превратить workdir в git-checkout. Это безопасно
делается без даунтайма:

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  cd /var/www/levelchannel
  git init
  git remote add origin https://github.com/Igotsty1e/levelchannel.git
  git fetch origin main
  git reset --soft origin/main           # подцепить историю, не трогая working tree
  git status                              # должно показать diff локального vs git
'
```

После этого диф между прод-файлами и git-history будет виден честно,
дальше через `git stash` / `git checkout` / `git pull` всё стандартно.
Делать только когда есть актуальный бэкап БД и время на возможный
recovery.

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
- автоматизировать deploy (webhook-скрипт или GitHub Actions через SSH)
- зафиксировать ротацию `CLOUDPAYMENTS_API_SECRET` (раз в N месяцев или по событию)
- добавить `nginx limit_req_zone` (если в текущем конфиге его нет)
- backup retention 14 дней — мало для бухгалтерии. По 152-ФЗ персональные
  данные надо хранить только пока цель обработки актуальна, но платёжные
  записи нужны для налоговой минимум 5 лет — продумай отдельный архив

### git ↔ prod синхронизация

Текущее состояние (на 2026-04-29): `/var/www/levelchannel` **не git-репо**,
файлы датированы 28 апреля, отстают от `origin/main` на 5+ коммитов:

- `12ac8e7` chore(deps): add vitest, bump tsconfig target
- `b3dedcc` feat(payments): opt-in tokens, one-click + 3-D Secure, idempotency, telemetry, health
- `7b1f1bc` test: vitest with 87% coverage
- `73a0d0e` docs: refresh AGENTS, ARCHITECTURE, PAYMENTS_SETUP, SECURITY
- `98f7219` feat(legal): add personal data consent flow
- `88d7959` docs: add OPERATIONS.md
- `ecb40b2` docs: fill OPERATIONS with real prod facts

То есть на проде НЕТ:
- legal/personal-data consent capture (на проде сайт принимает платежи без
  записи согласия — это юридический долг под 152-ФЗ);
- one-click + 3DS + saved-card endpoints;
- idempotency на money-роутах;
- health endpoint (`/api/health` отвечает 404);
- postgres-таблицы `payment_card_tokens`, `payment_telemetry`,
  `idempotency_records` (создадутся автоматически при первом hit
  соответствующего кода после деплоя).

**Как проверить расхождение в любой момент:**

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  ls /var/www/levelchannel/lib/legal/ 2>/dev/null && echo "legal: present" || echo "legal: MISSING"
  ls /var/www/levelchannel/app/api/health/ 2>/dev/null && echo "health: present" || echo "health: MISSING"
  ls /var/www/levelchannel/lib/payments/cloudpayments-api.ts 2>/dev/null && echo "one-click: present" || echo "one-click: MISSING"
  cat /var/www/levelchannel/DEPLOYED_SHA 2>/dev/null || echo "DEPLOYED_SHA not written yet"
'
```

**Что делать:** прогнать процедуру деплоя из §6. После первого успешного
деплоя — желательно превратить `/var/www/levelchannel` в git-checkout
(см. там же), чтобы дальше иметь честный аудит.
