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
| Reverse proxy | `nginx`, `/etc/nginx/sites-enabled/levelchannel` | per-IP `limit_req zone=lcapi 30r/m burst=20 nodelay` на `/api/*`; CP webhooks (`^~ /api/payments/webhooks/`) исключены — HMAC + amount cross-check там единственный trust boundary |
| Process manager | `systemd`, юнит `/etc/systemd/system/levelchannel.service` | `User=levelchannel`, `WorkingDirectory=/var/www/levelchannel`, `ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000` |
| Auto-deploy | `systemd` timer `levelchannel-autodeploy.timer` + service `/etc/systemd/system/levelchannel-autodeploy.service` | раз в минуту сверяет `origin/main`, см. §6. Между `npm run build` и swap зовёт `npm run migrate:up` — миграции накатываются под старым live-кодом (additive only), потом swap. |
| Env file | `/etc/levelchannel.env` (chmod 600, root:root) | подключается через `EnvironmentFile=` в systemd unit |
| SSH | root + ed25519 ключ `~/.ssh/levelchannel_timeweb_ed25519` (на машине оператора) | **`PermitRootLogin prohibit-password` + `PasswordAuthentication no`** — только publickey. См. §3 |
| Firewall (ufw) | OpenSSH + Nginx Full + `10050/tcp` (Zabbix agent от Timeweb) | приложение биндится на `127.0.0.1:3000`, ufw нужен только как defense-in-depth |
| **Деплой** | **Git-based autodeploy с сервера** | `/usr/local/bin/levelchannel-autodeploy` делает clone → `npm ci` → `npm run build` → `npm run migrate:up` → swap → health-check |
| Email транспорт | Resend (RESEND_API_KEY + EMAIL_FROM) — для verify/reset; платёжные чеки по-прежнему шлёт CloudKassir | в production boot падает, если auth email-контур не сконфигурирован |
| Платёжный провайдер | CloudPayments | <!-- FILL IN: ID кабинета (есть в .env как CLOUDPAYMENTS_PUBLIC_ID) --> |
| Онлайн-касса | CloudKassir (входит в CloudPayments) | <!-- FILL IN: статус ОФД --> |
| Логи | `journalctl -u levelchannel`, `/var/log/nginx/access.log`, `/var/log/nginx/error.log` | см. §8 |
| Бэкапы БД | ежедневный `pg_dump` через `/etc/cron.daily/levelchannel-db-backup` → `/var/backups/levelchannel/db-YYYY-MM-DD.sql.gz` (mode 600 + dir 700), retention 14 дней. Restore drill пройден 2026-04-29 | для catastrophic recovery — gunzip + `psql -d <recovery_db>`. Дамп: `--no-owner --no-acl --clean --if-exists` |
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
**Порт, который слушает Next:** `127.0.0.1:3000`. Bind закреплён в systemd unit через `--hostname 127.0.0.1 --port 3000` в `ExecStart`. nginx терминирует TLS и проксирует.

### SSH

```bash
# с машины оператора (Ivan)
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136
```

**SSH hardening применён 2026-04-29.** Эффективная конфигурация
(`sshd -T` подтверждает):

```
permitrootlogin without-password   # alias для prohibit-password
passwordauthentication no
pubkeyauthentication yes
kbdinteractiveauthentication no
```

- `/etc/ssh/sshd_config` — `PermitRootLogin prohibit-password`
- `/etc/ssh/sshd_config.d/50-cloud-init.conf` — `PasswordAuthentication no` (cloud-init override; если по какой-то причине будет переопределяться обновлением Ubuntu, проверить здесь)

Backup исходных файлов: `/etc/ssh/sshd_config.bak-20260429-072458` и
`/etc/ssh/sshd_config.d/50-cloud-init.conf.bak-20260429-072458`.

**Если потерял SSH-ключ:** root password не работает. Эмерджнси-доступ
через VNC console у Timeweb (timeweb.cloud → твой VPS → "Консоль") и
оттуда восстановление авторизованных ключей в `/root/.ssh/authorized_keys`.

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
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Reverse proxy — nginx

Конфиг: `/etc/nginx/sites-enabled/levelchannel`.

Текущее состояние:

- TLS termination + HTTP→HTTPS redirect
- `limit_req_zone lcapi 30r/m burst=20 nodelay` на `/api/*`
- `^~ /api/payments/webhooks/` исключены из nginx rate limit и живут на
  HMAC + order cross-check
- в app прокидываются `Host`, `X-Forwarded-For`, `X-Real-IP`

Проверить или перечитать текущий конфиг:

```bash
sudo nginx -T
sudo nginx -t
sudo systemctl reload nginx
```

Если меняешь nginx, правь боевой конфиг, потом делай `nginx -t` перед
reload.

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
| `accounts` | `migrations/0005_accounts.sql` | identity: email, password_hash, email_verified_at, disabled_at |
| `account_roles` | `migrations/0006_account_roles.sql` | роли (admin / teacher / student) per account |
| `account_sessions` | `migrations/0007_account_sessions.sql` | session bearer-tokens, хранятся хешем; cookie `lc_session` |
| `email_verifications` | `migrations/0008_email_verifications.sql` | single-use verify-email tokens (TTL 24h) |
| `password_resets` | `migrations/0009_password_resets.sql` | single-use password-reset tokens (TTL 1h) |
| `accounts.email` CHECK | `migrations/0010_accounts_email_normalized.sql` | DB-level enforcement: `email = lower(btrim(email))`. Любой bypass app-слоя получает constraint violation, не shadow account |
| `account_consents` | `migrations/0011_account_consents.sql` | audit table; row per consent acceptance event (`document_kind` ∈ personal_data/offer/marketing_opt_in/parent_consent) |
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

**Runner подключён в autodeploy с 2026-04-29.**
`/usr/local/bin/levelchannel-autodeploy` вызывает `npm run migrate:up`
между `npm run build` и release-swap. Если миграция упадёт, `set -e`
аварит rollout и текущий live-код продолжает работать на предыдущем
release directory. Политика: миграции additive-only, поэтому новая
схема всегда совместима с предыдущей версией кода.

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

-- audit log (полные данные: real email + real IP, см. SECURITY.md):
select event_type, to_status, actor, created_at
  from payment_audit_events
 where invoice_id = 'lc_xxxxxxxx'
 order by created_at;

select event_type, count(*)
  from payment_audit_events
 where created_at > now() - interval '24 hours'
 group by 1
 order by 2 desc;

-- "что упало за последний час"
select id, event_type, invoice_id, customer_email, payload
  from payment_audit_events
 where event_type in ('charge_token.declined', 'threeds.declined',
                      'webhook.fail.received')
   and created_at > now() - interval '1 hour'
 order by created_at desc;
```

**Backup и restore.** Фактический backup уже настроен:
`/etc/cron.daily/levelchannel-db-backup` → `/var/backups/levelchannel`,
retention 14 дней, restore drill пройден 2026-04-29.

```bash
# проверить наличие свежих бэкапов
ls -lh /var/backups/levelchannel

# проверить содержимое конкретного дампа
gunzip -c /var/backups/levelchannel/db-YYYY-MM-DD.sql.gz | head -100

# применить в recovery БД, не в production
gunzip -c /var/backups/levelchannel/db-YYYY-MM-DD.sql.gz | psql "$RECOVERY_DATABASE_URL"
```

### Retention и удаление персональных данных

> **Канонический документ — [`docs/legal/retention-policy.md`](docs/legal/retention-policy.md)** (со скелетом для legal-rf-router pipeline). Эта таблица — operator-facing краткая выписка для runbook'а, не подменяет основной документ. При расхождении источник истины — `docs/legal/retention-policy.md`.

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

1. Принять запрос на `igotstyle227@gmail.com` и зафиксировать дату получения.
2. Проверить, какие данные ещё нужны для договора, налогового, бухгалтерского или платёжного учёта.
3. Удалить или обезличить данные, по которым больше нет законного основания для хранения.
4. Отдельно удалить переписку и вспомогательные записи в Telegram / Gmail / Edvibe, если они больше не нужны.
5. Сохранить краткую внутреннюю отметку: кто удалял, что удалено, на каком основании и в какую дату.

#### Автоматический cleanup expired-записей (TODO — активация на сервере)

`scripts/db-retention-cleanup.mjs` запускается раз в сутки в 04:30 (после `pg_dump` cron в 04:00) и удаляет:

| Таблица | Что удаляет | Why |
|---|---|---|
| `account_sessions` | `revoked_at IS NOT NULL` ИЛИ `expires_at < now() - 7d` | Phase 1A debt — без cron'а раздувание revoked + expired сессий |
| `email_verifications` | `consumed_at IS NOT NULL` ИЛИ `expires_at < now() - 30d` | single-use токены, после consume или истечения уже не нужны |
| `password_resets` | `consumed_at IS NOT NULL` ИЛИ `expires_at < now() - 30d` | то же |
| `idempotency_records` | `created_at < now() - 7d` | idempotency window 24h на wire, 7-day forensic tail |
| `payment_audit_events` | `created_at < now() - 3 years` | 152-ФЗ alignment для финансовых записей; см. `docs/legal/retention-policy.md` |

**НЕ трогается** этим cron'ом: `payment_orders` (54-ФЗ — 5 лет, отдельная политика через legal-rf), `payment_telemetry` (privacy-friendly уже, decision продуктовый), `accounts` / `account_consents` (только через SAR-erasure path).

**Активация (один раз, требует SSH):**

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136

cp /var/www/levelchannel/scripts/systemd/levelchannel-db-retention.{service,timer} \
   /etc/systemd/system/

systemctl daemon-reload
systemctl enable --now levelchannel-db-retention.timer

# verify timer schedule:
systemctl list-timers levelchannel-db-retention.timer

# manual run (without waiting for 04:30):
systemctl start levelchannel-db-retention.service
journalctl -u levelchannel-db-retention.service -n 20
```

В журнале каждый run печатает по одной JSON-строке на таблицу с `rows` (сколько строк удалено). Удобно для аудита: видно объём очистки за каждый день.

**Failure mode:** на ошибке одной таблицы (FK constraint, lock timeout) script продолжает с остальными — логирует error и идёт дальше. Exit non-zero только если **все** таблицы упали (network gone). systemd captures journal в любом случае.

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

### Deploy freshness check (TODO — патч скрипта на сервере)

`.github/workflows/deploy-freshness.yml` каждые 30 минут сравнивает SHA `main` с `version` из `/api/health` и алертит через GitHub Issue (`deploy-stale`), если прод отстал больше чем на 15 минут. Чтобы это заработало, **нужен один patch на сервере**:

В `/usr/local/bin/levelchannel-autodeploy` **перед** `npm run build` добавить:

```bash
export GIT_SHA=$(git rev-parse HEAD)
```

Эту переменную нужно forward'ить в systemd unit, который запускает `next start` — иначе `process.env.GIT_SHA` в `/api/health` останется пустым и workflow откроет issue `deploy-freshness-inactive`.

Способа два:

1. **Через `/etc/levelchannel.env`** (рекомендуется): записывать `GIT_SHA=...` в env-файл при каждом деплое перед swap. Systemd unit уже читает этот файл через `EnvironmentFile=/etc/levelchannel.env`.

2. **Через `Environment=` директиву** в `/etc/systemd/system/levelchannel.service` — работает только если deploy script делает `systemctl edit levelchannel.service` для подмены значения, что усложняет атомарность swap'а. Лучше первый способ.

Smoke test после patch'а:

```bash
curl -s https://levelchannel.ru/api/health | jq '.version'
# ожидается: "<sha-from-main>"
```

Workflow `deploy-freshness` сам закроет issue `deploy-freshness-inactive` на следующем своём run'е, как только `version` станет non-null.

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

# Resend transactional email (verify + reset + already-registered). При пустом
# ключе под NODE_ENV=production lib/email/config.ts падает на boot.
RESEND_API_KEY=<!-- FILL IN из кабинета Resend -->
EMAIL_FROM="LevelChannel <noreply@levelchannel.ru>"

# HMAC key for per-email rate-limit scope strings (lib/auth/email-hash.ts).
# 32+ random chars. NOT the same value as TELEMETRY_HASH_SECRET — different
# trust boundary, different rotation cadence (Phase 1B mech-3).
# Boot fails under NODE_ENV=production if empty.
AUTH_RATE_LIMIT_SECRET=<!-- FILL IN: 32+ random chars -->
```

`.env` на сервере — права `chmod 600`, владелец `root:root`, читается
через `EnvironmentFile=` в systemd unit. Не в git, не в публичной
директории.

### Ротация секретов

- **`CLOUDPAYMENTS_API_SECRET`**: ротация в личном кабинете CloudPayments,
  затем на сервере: `vim .env`, `systemctl restart levelchannel`. Старые
  webhook подписи перестанут проверяться сразу — координируй с тем, чтобы
  у CP не висели в очереди ретраи на старом ключе.
- **`TELEMETRY_HASH_SECRET`**: можно ротировать без бизнес-импакта — это
  сломает связку «один и тот же e-mail в телеметрии до и после ротации»,
  но сами события не теряются.
- **`DATABASE_URL`**: смена пароля БД — обновить в `.env`, рестарт.
- **`RESEND_API_KEY`**: ротация в кабинете Resend, обновить `.env`, рестарт.
  Старый ключ можно отозвать сразу — verify/reset токены идут от нашего
  сервера, доставка не зависит от истории.

---

## 8. Logs

| Источник | Где смотреть |
|---|---|
| App stdout/stderr | `journalctl -u levelchannel` |
| Reverse proxy access | `/var/log/nginx/access.log` |
| Reverse proxy errors | `/var/log/nginx/error.log` |
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

### Uptime probe — GitHub Actions

**Health endpoint:** `GET /api/health`. Возвращает 200 + JSON
`{"status":"ok","provider":"cloudpayments","storage":"postgres","checks":{...}}`
или 503. См. `PAYMENTS_SETUP.md` про точный shape.

**Кто пингует.** Workflow [`/.github/workflows/uptime-probe.yml`](../.github/workflows/uptime-probe.yml)
запускается раз в 5 минут (`cron: '*/5 * * * *'`) через GitHub Actions
runners — внешний relative прода. В одном run-е делается 3 попытки
с паузой 20 сек; OK считается если **хоть одна** вернула HTTP 200 +
`"status":"ok"` + `"database":"ok"`. Это фильтрует короткие cold
starts и Actions-side network jitter.

**Где видеть алерты.** При FAIL workflow открывает GitHub Issue с
лейблом `uptime-incident` в этом же репо. Owner репо подписан на
issue create / comment по умолчанию — уведомление падает на email,
который привязан к GitHub аккаунту. Дашборд активных инцидентов:

```
https://github.com/Igotsty1e/levelchannel/issues?q=is%3Aopen+label%3Auptime-incident
```

**Жизненный цикл инцидента (idempotent — workflow знает все 4 состояния):**

| Состояние | Что делает workflow |
|---|---|
| FAIL + нет открытого issue | создаёт новый `[uptime] ... is DOWN` |
| FAIL + есть открытый issue | дописывает комментарий «Still failing at ...» (без spam'а новых issue) |
| OK + есть открытый issue | пишет «Recovered at ...» и закрывает issue |
| OK + нет открытого issue | no-op |

Issue body содержит timestamp обнаружения, last HTTP code, last response
body (обрезано до 1500 символов), ссылку на конкретный run в Actions.

**Detection latency.** Practical floor ~5 минут (cron interval) +
до ~10 минут (Actions cron sometimes delays under load) → worst-case
~15 минут. Если когда-нибудь нужна 30-сек precision — добавляем
external probe (BetterStack / Healthchecks.io) как второй слой,
этот workflow остаётся.

### Runbook — что делать когда пришёл алерт

1. **Открыть issue, проверить last response body в issue body.** Если там виден HTTP code != 200 — переходим к шагу 2. Если timeout / curl exit без HTTP code — DNS / TLS / нет ответа от сервера; шаги 3 и 5.

2. **Проверить руками с своей машины:**
   ```bash
   curl -i https://levelchannel.ru/api/health
   ```
   - 200 + `"status":"ok"` → false-positive в Actions (run flap'нул, GH closed issue сам). Можно вручную закомментировать причину в issue.
   - 503 + `"database":"err"` → Postgres сдох, шаг 4.
   - 502 / 504 → app не отвечает, шаг 3.
   - таймаут / ничего → server / nginx / DNS, шаг 5.

3. **App не отвечает.** SSH на VPS:
   ```bash
   ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136
   systemctl status levelchannel
   journalctl -u levelchannel --since "10 min ago" | tail -100
   ```
   Если service died — `systemctl restart levelchannel`. Если loop'ит на crash — журнал покажет stack; подними нужный hotfix (auth secret пропал, миграция упала, OOM и т.д.).

4. **Postgres недоступен.** SSH на VPS:
   ```bash
   pg_isready -d "$DATABASE_URL"
   systemctl status postgresql
   journalctl -u postgresql --since "30 min ago" | tail -50
   df -h
   ```
   Чаще всего — disk full (бэкапы накопились) или OOM. См. §13 retention drill, §5 backup commands.

5. **Сервер / nginx / DNS.**
   ```bash
   ssh root@83.217.202.136 'systemctl status nginx; nginx -t'
   dig +short levelchannel.ru
   ```
   - nginx упал — `systemctl restart nginx`.
   - dig возвращает не наш IP → registrar incident (см. §4).
   - SSH timeout → провайдерский incident, проверь Timeweb status page.

6. **После восстановления** — workflow закроет issue автоматически
   на следующем successful probe (макс 5 мин). Если нужно
   вручную — закрывай и подпиши причину в комментарии для
   incident retro.

### Ручной запуск probe

Если хочется проверить вне cron — Actions tab → uptime-probe →
**Run workflow** (button). Использует `workflow_dispatch` trigger.

### Webhook-flow alerting (TODO — активация на сервере)

`scripts/webhook-flow-alert.mjs` каждые 30 минут читает `payment_audit_events` за последний час и шлёт email на `ALERT_EMAIL_TO`, если CloudPayments webhook contour выглядит сломанным:

| Сигнал | Verdict |
|---|---|
| создано <5 заказов за окно | `low_volume_skip` (молчим — слишком тихо чтобы судить) |
| `paid + fail + cancelled ≥ created` | `all_resolved` (всё разрешилось) |
| `(paid + fail) / created < 0.3` | **`alert`** — webhook stall |
| иначе | `ok` |

Что значит "webhook stall": заказы создаются, но pay/fail webhook'и не приходят (или приходят, но не обрабатываются). Чаще всего — CP cabinet URL'ы сломаны, HMAC secret разъехался с `/etc/levelchannel.env`, или handler упал в loop.

**Активация (один раз, требует SSH):**

```bash
# 1) убедиться что scripts/webhook-flow-alert.mjs уже на сервере
#    (попадает на VPS обычным autodeploy — зеркало git репо)
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136

# 2) установить unit + timer
cp /var/www/levelchannel/scripts/systemd/levelchannel-webhook-flow-alert.service \
   /etc/systemd/system/
cp /var/www/levelchannel/scripts/systemd/levelchannel-webhook-flow-alert.timer \
   /etc/systemd/system/

# 3) добавить ALERT_EMAIL_TO в /etc/levelchannel.env (если ещё не задан;
#    EMAIL_FROM, RESEND_API_KEY, DATABASE_URL уже там)
echo 'ALERT_EMAIL_TO=masteryprojectss@gmail.com' >> /etc/levelchannel.env

# 4) запустить timer
systemctl daemon-reload
systemctl enable --now levelchannel-webhook-flow-alert.timer

# 5) проверить
systemctl status levelchannel-webhook-flow-alert.timer
journalctl -u levelchannel-webhook-flow-alert.service --since "5 min ago"
```

**Ручной запуск без ожидания таймера:**

```bash
systemctl start levelchannel-webhook-flow-alert.service
journalctl -u levelchannel-webhook-flow-alert.service -n 20
```

В журнале каждый run печатает одну JSON-строку с `verdict` — это `low_volume_skip` / `all_resolved` / `ok` / `alert`.

**Тонкая настройка (env vars):**

| Var | Default | Что делает |
|---|---|---|
| `WEBHOOK_FLOW_WINDOW_MINUTES` | `60` | окно для подсчёта |
| `WEBHOOK_FLOW_MIN_VOLUME` | `5` | минимум заказов для срабатывания (избегает false-positive на малых объёмах) |
| `WEBHOOK_FLOW_TERMINATED_RATIO` | `0.3` | floor отношения (paid+fail)/created для alert |

**Idempotence:** скрипт НЕ хранит «уже алертил». Каждый run в состоянии alert посылает email. При cron 30 минут — максимум 2 email/час, что приемлемо. Если шум станет проблемой, добавляется state file `/var/lib/levelchannel/last-webhook-alert-at` — отдельный wave.

### Sentry — error tracking

Подключён 2026-04-29. SDK живёт в:
- `instrumentation.ts` — Node + Edge runtime init (читает `SENTRY_DSN`)
- `instrumentation-client.ts` — браузерный SDK (читает `NEXT_PUBLIC_SENTRY_DSN`)
- `app/global-error.tsx` — top-level React error boundary, форвардит в Sentry и рендерит ru-fallback
- `next.config.js` — обёрнут в `withSentryConfig` (CSP допускает `*.ingest.de.sentry.io` / `*.ingest.sentry.io` в `connect-src` + `worker-src 'self' blob:`)

**Project:** `mastery-zs/levelchannel` на Sentry SaaS (EU regio'n).

**Dashboard:**
```
https://sentry.io/organizations/mastery-zs/projects/levelchannel/
```

Owner подписан на email-нотификации по новым issues по умолчанию (Sentry account-level setting).

**Env vars (production, в `/etc/levelchannel.env`):**

| Var | Что |
|---|---|
| `SENTRY_DSN` | DSN — берётся из Sentry → Settings → Projects → levelchannel → Client Keys |
| `NEXT_PUBLIC_SENTRY_DSN` | то же значение, доступно браузеру (build-time inline) |
| `SENTRY_AUTH_TOKEN` (опционально) | для source-maps upload во время `npm run build`. Без него стек-трейсы приходят, но ссылаются на bundled JS вместо оригинального TS |

Без DSN SDK становится no-op — что хорошо для dev. В production пустой DSN значит молчаливое отсутствие алертов; контролируется через смок-захват после деплоя:

```bash
# manual smoke — после изменения SDK или DSN:
node -e "
  const S = require('@sentry/nextjs');
  S.init({ dsn: process.env.SENTRY_DSN });
  S.captureMessage('manual smoke ' + Date.now());
  S.flush(5000).then(() => process.exit(0));
"
```

Событие появляется в Sentry за ≤30 секунд.

**`tracesSampleRate=0.1`** в обоих init'ах — performance traces семплируются на 10%, чтобы не уйти за free tier limits. Поднимать после реальных нагрузок.

**`sendDefaultPii: false`** — стандартный безопасный вариант. Default integrations Sentry редактируют common auth headers; флаг подкрепляет это.

**Release tagging:** `instrumentation.ts` читает `process.env.GIT_SHA` (тот же, что использует deploy-freshness workflow). После активации сервер-патча про `GIT_SHA` ([§6 Deploy](#)), Sentry будет группировать issues по релизам.

### Operator email на successful payment

Подключён 2026-04-29. Inline в `app/api/payments/webhooks/cloudpayments/pay/route.ts` — после `markOrderPaid` + audit handler шлёт email-уведомление на `OPERATOR_NOTIFY_EMAIL` через Resend.

Best-effort: ошибка Resend / отсутствие env var **не валит** webhook ACK к CloudPayments. Без ACK CP начнёт re-fire → audit двойной paid event. Поэтому notification обёрнут в try/catch + console.warn в журнал.

**Активация:**

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136
echo 'OPERATOR_NOTIFY_EMAIL=masteryprojectss@gmail.com' >> /etc/levelchannel.env
systemctl restart levelchannel
```

При следующем successful платеже придёт email с сабжом `[LevelChannel] Платёж получен: <amount> ₽ — <invoice>`.

**Когда email НЕ приходит:**
1. Проверь `journalctl -u levelchannel | grep '\[notify\]'` — там будет warn если что-то порвалось.
2. Resend account: лимит free-tier 100 email/day; если шкалит — `RESEND_API_KEY` mismatch.
3. EMAIL_FROM-домен должен быть верифицирован в Resend dashboard.

### Что НЕ настроено (в roadmap)

- Slack/Telegram алерт по успешному платежу — отдельная задача в backlog (нужен bot token и parse_mode logic). Email покрывает 80% потребности
- Disk usage monitoring (косвенно — `db: err` появится когда диск умирает)

---

## 10. CloudPayments кабинет

<!-- FILL IN: ID кабинета, контактный e-mail аккаунта -->

**Webhooks** (настраиваются в кабинете → Сайт → Уведомления):

| Событие | URL |
|---|---|
| Check | `https://levelchannel.ru/api/payments/webhooks/cloudpayments/check` |
| Pay | `https://levelchannel.ru/api/payments/webhooks/cloudpayments/pay` |
| Fail | `https://levelchannel.ru/api/payments/webhooks/cloudpayments/fail` |

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

## 13. Долги и known ops gaps

### Closed hardening work — 2026-04-29

Закрыто: SSH publickey-only, bind `127.0.0.1:3000`, nginx `limit_req`
на `/api/*`, ежедневный DB backup + restore drill, `npm run migrate:up`
в autodeploy pipeline. Детали живут в §§1, 3, 5 и 6.

Из фактических blanks ещё не закрыты: CloudPayments cabinet ID, ОФД
status, DNS registrar.

### Открытые долги (operations)

- настроить uptime monitor на `/api/health` (UptimeRobot free / BetterStack)
- подключить Sentry или хотя бы `journald` → лог-агрегатор
- зафиксировать ротацию `CLOUDPAYMENTS_API_SECRET` (раз в N месяцев или по событию)
- backup retention 14 дней не заменяет отдельный архивный контур. По
  152-ФЗ персональные данные надо хранить только пока цель обработки
  актуальна, а платёжные записи и связанные доказательства согласия
  должны оставаться доступными в основной БД и рабочих архивах весь
  обязательный срок хранения
- alerting на неуспешный autodeploy / зависший `levelchannel-autodeploy.service`
- session cleanup cron для `account_sessions` (Phase 1A backlog)

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
