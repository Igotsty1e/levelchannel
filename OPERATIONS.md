# Operations

Single source of truth for infrastructure, deploy, git workflow and
day-to-day operations. Code- and contract-level docs live in [README.md](README.md),
[ARCHITECTURE.md](ARCHITECTURE.md), [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md),
[SECURITY.md](SECURITY.md), [AGENTS.md](AGENTS.md). This document covers
**where it all runs** and **how to keep it alive**.

> The marker `<!-- FILL IN -->` means "fill in the concrete value before
> relying on this section". These markers are meant to be replaced with
> real hosts/paths/names.

> Production deploys via server-side git autodeploy from `origin/main`. The
> active `/var/www/levelchannel` is now a git checkout, and rollout swaps to
> a fresh release directory with a mandatory health-check after restart.
> Before any incident, cross-check `DEPLOYED_SHA`, `git rev-parse HEAD` on
> production, and `origin/main`. See §6.

---

## 1. TL;DR - where everything lives

| Layer | Where | Note |
|---|---|---|
| Source code | GitHub: `Igotsty1e/levelchannel` (private) | default branch `main` |
| Production runtime | `83.217.202.136` (Timeweb VPS), Ubuntu 24.04.4 LTS, kernel 6.8 | systemd unit `levelchannel` |
| Production database | same VPS, Postgres 16.13, listens on `127.0.0.1:5432` + `[::1]:5432` | DB `levelchannel`, app user `levelchannel` |
| Node.js | v20.20.2 (npm 10.8.2) | `/usr/bin/npm`, `/usr/bin/node` |
| Domain | `levelchannel.ru` + `www.levelchannel.ru` (A → `83.217.202.136`) | TLS required (`http://` redirected with 301) |
| TLS | Let's Encrypt, `/etc/letsencrypt/live/levelchannel.ru/` | `certbot.timer` active → auto-renewal |
| Reverse proxy | `nginx`, `/etc/nginx/sites-enabled/levelchannel` | per-IP `limit_req zone=lcapi 30r/m burst=20 nodelay` on `/api/*`; CP webhooks (`^~ /api/payments/webhooks/`) are excluded - HMAC + amount cross-check is the only trust boundary there |
| Process manager | `systemd`, unit `/etc/systemd/system/levelchannel.service` | `User=levelchannel`, `WorkingDirectory=/var/www/levelchannel`, `ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000` |
| Auto-deploy | `systemd` timer `levelchannel-autodeploy.timer` + service `/etc/systemd/system/levelchannel-autodeploy.service` | once a minute checks `origin/main`, see §6. Between `npm run build` and swap it calls `npm run migrate:up` - migrations are applied under the old live code (additive only), then swap. |
| Env file | `/etc/levelchannel.env` (chmod 600, root:root) | wired in via `EnvironmentFile=` in the systemd unit |
| SSH | root + ed25519 key `~/.ssh/levelchannel_timeweb_ed25519` (on operator's machine) | **`PermitRootLogin prohibit-password` + `PasswordAuthentication no`** - publickey only. See §3 |
| Firewall (ufw) | OpenSSH + Nginx Full + `10050/tcp` (Zabbix agent from Timeweb) | the app binds on `127.0.0.1:3000`, ufw is only defense-in-depth |
| **Deploy** | **Git-based autodeploy from the server** | `/usr/local/bin/levelchannel-autodeploy` does clone → `npm ci` → `npm run build` → `npm run migrate:up` → swap → health-check |
| Email transport | Resend (RESEND_API_KEY + EMAIL_FROM) - for verify/reset; payment cheques are still sent by CloudKassir | in production, boot fails if the auth email channel is not configured |
| Payment provider | CloudPayments | <!-- FILL IN: cabinet ID (it's in .env as CLOUDPAYMENTS_PUBLIC_ID) --> |
| Online kassa | CloudKassir (part of CloudPayments) | <!-- FILL IN: OFD status --> |
| Logs | `journalctl -u levelchannel`, `/var/log/nginx/access.log`, `/var/log/nginx/error.log` | see §8 |
| DB backups | daily `pg_dump` via `/etc/cron.daily/levelchannel-db-backup` → `/var/backups/levelchannel/db-YYYY-MM-DD.sql.gz` (mode 600 + dir 700), retention 14 days. Restore drill passed 2026-04-29 | for catastrophic recovery - gunzip + `psql -d <recovery_db>`. Dump: `--no-owner --no-acl --clean --if-exists` |
| Uptime monitor | **not configured** | wire it up against `/api/health` |
| Error tracking | not connected (Sentry on the roadmap) | - |
| External monitoring | Zabbix agent on `:10050` (from Timeweb) | host-internal metrics, not the app |

---

## 2. Git workflow

**Remote:** `https://github.com/Igotsty1e/levelchannel.git` (private).

**Default branch:** `main`. It's both dev and prod. There are no long-lived feature branches at the moment.
Every push to `main` is considered production-bound, because
`levelchannel-autodeploy.timer` will pick it up.

**Who pushes:** <!-- FILL IN: just you / a team of N -->.

**Conventional-commit prefix:** required.
- `feat(payments): ...` - new functionality
- `fix(payments): ...` - bug fix
- `chore(deps): ...` - dependencies
- `test: ...` - tests only
- `docs: ...` - documentation only
- `refactor: ...` - no behaviour change

**Before push:** `npm run test:run` + `npm run build` locally. Both must
be green. If the coverage gate (70%) fails - add the test in the same
commit, not as a follow-up.

**What you must not do:**
- force-push to main
- amend a published commit
- commit `.env` or `data/payment-orders.json`
- commit anything containing `CLOUDPAYMENTS_API_SECRET=` or similar

**Tags / releases:** not used yet. If a release cycle appears, the
scheme will be: `v0.<minor>.<patch>` via `git tag -a vX.Y.Z -m "..."`.

---

## 3. Server / runtime

**Host:** `83.217.202.136`, VPS at Timeweb.
**OS:** Ubuntu 24.04.4 LTS (kernel 6.8.0-110-generic).
**Node.js version:** v20.20.2, npm 10.8.2.
**Working directory:** `/var/www/levelchannel` (active git checkout of the current release).
**User the app runs as:** `levelchannel` (system user).
**Env file:** `/etc/levelchannel.env` (chmod 600, root:root, wired in via `EnvironmentFile=` in the systemd unit).
**Port Next listens on:** `127.0.0.1:3000`. The bind is locked in the systemd unit through `--hostname 127.0.0.1 --port 3000` in `ExecStart`. nginx terminates TLS and proxies.

### SSH

```bash
# from the operator's machine (Ivan)
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136
```

**SSH hardening applied 2026-04-29.** Effective configuration
(`sshd -T` confirms):

```
permitrootlogin without-password   # alias for prohibit-password
passwordauthentication no
pubkeyauthentication yes
kbdinteractiveauthentication no
```

- `/etc/ssh/sshd_config` - `PermitRootLogin prohibit-password`
- `/etc/ssh/sshd_config.d/50-cloud-init.conf` - `PasswordAuthentication no` (cloud-init override; if it ever gets overridden by an Ubuntu update, check here)

Backup of the original files: `/etc/ssh/sshd_config.bak-20260429-072458` and
`/etc/ssh/sshd_config.d/50-cloud-init.conf.bak-20260429-072458`.

**If you lose the SSH key:** root password does not work. Emergency access
via Timeweb VNC console (timeweb.cloud → your VPS → "Console") and
restore authorized keys in `/root/.ssh/authorized_keys` from there.

### Process manager - systemd

```bash
sudo systemctl status levelchannel
sudo systemctl restart levelchannel
sudo journalctl -u levelchannel -f         # follow logs
sudo journalctl -u levelchannel --since "1 hour ago"
sudo systemctl status levelchannel-autodeploy.timer
sudo journalctl -u levelchannel-autodeploy.service --since "1 hour ago"
```

Unit file: `/etc/systemd/system/levelchannel.service`. Current
contents:

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

### Reverse proxy - nginx

Config: `/etc/nginx/sites-enabled/levelchannel`.

Current state:

- TLS termination + HTTP→HTTPS redirect
- `limit_req_zone lcapi 30r/m burst=20 nodelay` on `/api/*`
- `^~ /api/payments/webhooks/` excluded from nginx rate limiting and lives
  on HMAC + order cross-check
- the app receives `Host`, `X-Forwarded-For`, `X-Real-IP`

Inspect or reload the current config:

```bash
sudo nginx -T
sudo nginx -t
sudo systemctl reload nginx
```

If you change nginx, edit the live config, then run `nginx -t` before
reload.

### TLS

**certbot --nginx**, certificates in `/etc/letsencrypt/live/levelchannel.ru/`,
auto-renewal via `certbot.timer` (active). The nginx config already includes
`include /etc/letsencrypt/options-ssl-nginx.conf` and `ssl_dhparam`.

```bash
# check
sudo certbot certificates
sudo systemctl status certbot.timer

# force renewal (usually not needed)
sudo certbot renew --dry-run            # test
sudo certbot renew                       # real
```

---

## 4. Domain & DNS

**Domain:** `levelchannel.ru` + `www.levelchannel.ru` (both served by
the same nginx server-block). HTTP is redirected with 301 to HTTPS.

| Record | Value |
|---|---|
| A `levelchannel.ru` | `83.217.202.136` |
| A `www.levelchannel.ru` | `83.217.202.136` (or CNAME → `levelchannel.ru`) |
| AAAA | <!-- FILL IN: check whether the VPS has IPv6 and an AAAA record --> |
| MX | <!-- FILL IN: if email is configured on the domain --> |
| TXT (SPF/DKIM/DMARC) | <!-- FILL IN: if you send email from the domain; not needed for the landing right now --> |

Registrar and DNS control panel: <!-- FILL IN: REG.RU / NameSilo / hosted at Timeweb? -->.

---

## 5. Database

**Engine:** PostgreSQL 16.13 (Ubuntu package `postgresql-16`).
**Host:** `127.0.0.1:5432` + `[::1]:5432` on the same VPS (`83.217.202.136`).
The DB is not exposed externally - access is local on the server only, or via
SSH tunnel.
**Database:** `levelchannel`
**Application user:** `levelchannel`
**Password:** stored only in `.env` on the server, not in the repository.
**Connection string** (in `DATABASE_URL` form):
`postgresql://levelchannel:<password>@127.0.0.1:5432/levelchannel?sslmode=disable`

**Tables (source of truth - `migrations/`, see below):**

| Table | Migration | Purpose |
|---|---|---|
| `payment_orders` | `migrations/0001_payment_orders.sql` | orders / lifecycle / events |
| `payment_card_tokens` | `migrations/0002_payment_card_tokens.sql` | saved card tokens (PK = customer_email) |
| `payment_telemetry` | `migrations/0003_payment_telemetry.sql` | checkout event log (privacy-friendly: e-mail is hashed, IP masked to /24) |
| `idempotency_records` | `migrations/0004_idempotency_records.sql` | dedup for money routes |
| `accounts` | `migrations/0005_accounts.sql` | identity: email, password_hash, email_verified_at, disabled_at |
| `account_roles` | `migrations/0006_account_roles.sql` | roles (admin / teacher / student) per account |
| `account_sessions` | `migrations/0007_account_sessions.sql` | session bearer tokens, stored as hashes; cookie `lc_session` |
| `email_verifications` | `migrations/0008_email_verifications.sql` | single-use verify-email tokens (TTL 24h) |
| `password_resets` | `migrations/0009_password_resets.sql` | single-use password-reset tokens (TTL 1h) |
| `accounts.email` CHECK | `migrations/0010_accounts_email_normalized.sql` | DB-level enforcement: `email = lower(btrim(email))`. Any bypass of the app layer hits a constraint violation, not a shadow account |
| `account_consents` | `migrations/0011_account_consents.sql` | audit table; row per consent acceptance event (`document_kind` ∈ personal_data/offer/marketing_opt_in/parent_consent) |
| `_migrations` | service table, created by the runner | bookkeeping of applied migrations |

**Migration runner.** The schema now lives in `migrations/NNNN_*.sql`. Apply with:

```bash
DATABASE_URL=postgres://... npm run migrate:up
DATABASE_URL=postgres://... npm run migrate:status
```

The remaining `ensureSchema*` functions in code (`lib/payments/store-postgres.ts`,
`lib/security/idempotency-postgres.ts`, `lib/telemetry/store-postgres.ts`)
are kept as a safety net and are idempotent. On a prod DB where tables
already exist, `migrate:up` changes nothing - it just records bookkeeping in
`_migrations`. Details - `migrations/README.md`.

**The runner is wired into autodeploy as of 2026-04-29.**
`/usr/local/bin/levelchannel-autodeploy` calls `npm run migrate:up`
between `npm run build` and the release swap. If a migration fails, `set -e`
aborts rollout and the current live code keeps running on the previous
release directory. Policy: migrations are additive-only, so a new
schema is always compatible with the previous code version.

### Debug access - three ways

**1. The fastest one - psql on the server as the `postgres` superuser:**

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136
sudo -u postgres psql -d levelchannel
```

```sql
\dt                    -- list tables
\q                     -- quit
```

**2. One-liner (top-20 payments, without entering the shell):**

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 \
  "sudo -u postgres psql -d levelchannel -c \"select invoice_id, status, amount_rub, customer_email, created_at from payment_orders order by created_at desc limit 20;\""
```

**3. SSH tunnel for a GUI (TablePlus / DBeaver / pgAdmin):**

```bash
# in a separate terminal:
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 \
    -L 5433:127.0.0.1:5432 \
    root@83.217.202.136
```

Connection in the client:

| Field | Value |
|---|---|
| Host | `127.0.0.1` |
| Port | `5433` (local tunnel port) |
| Database | `levelchannel` |
| User | `levelchannel` |
| Password | the DB app user password (from `.env` on the server) |

Alternative - built-in SSH in TablePlus:

| Field | Value |
|---|---|
| DB Host | `127.0.0.1` |
| DB Port | `5432` |
| Database | `levelchannel` |
| User | `levelchannel` |
| SSH Host | `83.217.202.136` |
| SSH Port | `22` |
| SSH User | `root` |
| SSH Key | `~/.ssh/levelchannel_timeweb_ed25519` |

### Useful queries (as the app user via `$DATABASE_URL`)

```bash
psql "$DATABASE_URL"

# useful queries:
\dt                                                       -- list tables
select count(*) from payment_orders;
select status, count(*) from payment_orders group by 1;
select * from payment_orders order by created_at desc limit 10;
select * from payment_telemetry where type = 'one_click_3ds_paid' order by at desc limit 20;
select scope, count(*) from idempotency_records group by 1;

-- audit log (full data: real email + real IP, see SECURITY.md):
select event_type, to_status, actor, created_at
  from payment_audit_events
 where invoice_id = 'lc_xxxxxxxx'
 order by created_at;

select event_type, count(*)
  from payment_audit_events
 where created_at > now() - interval '24 hours'
 group by 1
 order by 2 desc;

-- "what failed in the last hour"
select id, event_type, invoice_id, customer_email, payload
  from payment_audit_events
 where event_type in ('charge_token.declined', 'threeds.declined',
                      'webhook.fail.received')
   and created_at > now() - interval '1 hour'
 order by created_at desc;
```

**Backup and restore.** The actual backup is already configured:
`/etc/cron.daily/levelchannel-db-backup` → `/var/backups/levelchannel`,
retention 14 days, restore drill passed 2026-04-29.

```bash
# check that fresh backups exist
ls -lh /var/backups/levelchannel

# inspect a specific dump
gunzip -c /var/backups/levelchannel/db-YYYY-MM-DD.sql.gz | head -100

# apply to a recovery DB, not production
gunzip -c /var/backups/levelchannel/db-YYYY-MM-DD.sql.gz | psql "$RECOVERY_DATABASE_URL"
```

### Retention and deletion of personal data

> **Canonical document - [`docs/legal/retention-policy.md`](docs/legal/retention-policy.md)** (with skeleton for the legal-rf-router pipeline). This table is an operator-facing short excerpt for the runbook, it does not replace the main document. In case of disagreement, the source of truth is `docs/legal/retention-policy.md`.

Minimum operational retention policy for the current setup:

| Data category | Where stored | Term |
|---|---|---|
| Paid orders, payment statuses, webhook events, proof of consent | `payment_orders` | 5 years after the end of the reporting year of the payment |
| Unpaid / cancelled / failed orders without dispute | `payment_orders` | up to 30 days |
| Saved card tokens | `payment_card_tokens` | until the user deletes them, withdraws one-click consent, or the need ceases |
| Checkout telemetry | `payment_telemetry` | up to 90 days |
| Names / phones / additional emails from Telegram, Gmail, Edvibe, if not included in accounting documents | external communication services and internal working notes | until classes and settlements are completed, then up to 30 days |
| DB backup | `/var/backups/levelchannel` | 14 days |

Minimum procedure for personal data subject deletion request:

1. Receive the request at `igotstyle227@gmail.com` and record the receipt date.
2. Check what data is still needed for the contract, tax, accounting, or payment records.
3. Delete or anonymise data for which there is no longer a legal basis for storage.
4. Separately delete correspondence and supporting records in Telegram / Gmail / Edvibe if they are no longer needed.
5. Keep a brief internal note: who deleted, what was deleted, on what basis, and on what date.

#### Automatic cleanup of expired records (TODO - activation on the server)

`scripts/db-retention-cleanup.mjs` runs once a day at 04:30 (after the `pg_dump` cron at 04:00) and deletes:

| Table | What it deletes | Why |
|---|---|---|
| `account_sessions` | `revoked_at IS NOT NULL` OR `expires_at < now() - 7d` | Phase 1A debt - without a cron, revoked + expired sessions bloat |
| `email_verifications` | `consumed_at IS NOT NULL` OR `expires_at < now() - 30d` | single-use tokens, no longer needed after consume or expiry |
| `password_resets` | `consumed_at IS NOT NULL` OR `expires_at < now() - 30d` | same |
| `idempotency_records` | `created_at < now() - 7d` | idempotency window 24h on the wire, 7-day forensic tail |
| `payment_audit_events` | `created_at < now() - 3 years` | personal-data law (152-FZ) alignment for financial records; see `docs/legal/retention-policy.md` |

**NOT touched** by this cron: `payment_orders` (cash-register law (54-FZ) - 5 years, separate policy via legal-rf), `payment_telemetry` (already privacy-friendly, product decision), `accounts` / `account_consents` (only via the SAR-erasure path).

**Activation (one-off, requires SSH):**

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

In the journal, every run prints one JSON line per table with `rows` (the number of rows deleted). Handy for audit: you can see the volume of each day's cleanup.

**Failure mode:** on an error in one table (FK constraint, lock timeout) the script continues with the rest - it logs the error and moves on. Exit non-zero only if **all** tables fail (network gone). systemd captures the journal regardless.

---

## 6. Deploy

**Current mechanism: server-side git autodeploy from `origin/main`.**
Rollout is owned by `/usr/local/bin/levelchannel-autodeploy`, which is
launched by the `systemd` timer `levelchannel-autodeploy.timer` once a
minute. The flow is simple:

1. find `target_sha` via `git ls-remote` on `origin/main`
2. if the SHA hasn't changed, exit without doing anything
3. clone a fresh release into `/var/www/levelchannel.release-<sha12>`
4. run `env -u NODE_ENV npm ci`
5. load `/etc/levelchannel.env` and run `env -u NODE_ENV npm run build`
6. write `DEPLOYED_SHA`
7. stop `levelchannel`
8. rename the current `/var/www/levelchannel` to `/var/www/levelchannel.prev-<timestamp>`
9. move the new release to `/var/www/levelchannel`
10. start `levelchannel` and probe `http://127.0.0.1:3000/api/health`
11. keep only the last three `levelchannel.prev-*`

`postbuild.js` and `public/.htaccess` are legacy from the first
static-export version, in the current server mode they don't take part in deploy.

### What actually drives deploy

| Component | Where | Role |
|---|---|---|
| Deploy script | `/usr/local/bin/levelchannel-autodeploy` | the entire rollout, build and swap |
| Deploy unit | `/etc/systemd/system/levelchannel-autodeploy.service` | one-shot script run |
| Deploy timer | `/etc/systemd/system/levelchannel-autodeploy.timer` | `OnBootSec=2min`, `OnUnitActiveSec=1min`, `Persistent=true` |
| GitHub auth | `/home/levelchannel/.ssh/github_deploy` + `/home/levelchannel/.ssh/config` | read-only deploy key for `git@github.com:Igotsty1e/levelchannel.git` |

### Deploy freshness check (TODO - patch the script on the server)

`.github/workflows/deploy-freshness.yml` compares the SHA of `main` against `version` from `/api/health` every 30 minutes and alerts via a GitHub Issue (`deploy-stale`) if production is more than 15 minutes behind. To make this work, **a single patch on the server is required**:

In `/usr/local/bin/levelchannel-autodeploy`, **before** `npm run build`, add:

```bash
export GIT_SHA=$(git rev-parse HEAD)
```

This variable needs to be forwarded into the systemd unit that launches `next start` - otherwise `process.env.GIT_SHA` in `/api/health` stays empty and the workflow opens an issue `deploy-freshness-inactive`.

There are two ways:

1. **Via `/etc/levelchannel.env`** (recommended): write `GIT_SHA=...` to the env file at every deploy before swap. The systemd unit already reads this file via `EnvironmentFile=/etc/levelchannel.env`.

2. **Via an `Environment=` directive** in `/etc/systemd/system/levelchannel.service` - works only if the deploy script runs `systemctl edit levelchannel.service` to substitute the value, which complicates swap atomicity. The first approach is better.

Smoke test after the patch:

```bash
curl -s https://levelchannel.ru/api/health | jq '.version'
# expected: "<sha-from-main>"
```

The `deploy-freshness` workflow will close issue `deploy-freshness-inactive` itself on its next run, as soon as `version` becomes non-null.

### Normal rollout path

```bash
# 1. Locally: prepare a clean main and pass the gates
cd ~/LevelChannel
git checkout main
git pull --ff-only origin main
npm ci
npm run test:run
npm run build

# 2. Commit and push to main
git push origin main

# 3. Wait up to a minute and verify rollout
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  systemctl status levelchannel-autodeploy.timer --no-pager
  journalctl -u levelchannel-autodeploy.service --since "10 minutes ago" --no-pager
  cat /var/www/levelchannel/DEPLOYED_SHA
  su -s /bin/bash -c "git -C /var/www/levelchannel rev-parse HEAD" levelchannel
  curl -s http://127.0.0.1:3000/api/health
'
```

### Manual deploy without waiting for the timer

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  systemctl start levelchannel-autodeploy.service
  journalctl -u levelchannel-autodeploy.service -n 100 --no-pager
'
```

### Smoke test after deploy

```bash
curl -s https://levelchannel.ru/api/health | jq
# expected: {"status":"ok","provider":"cloudpayments","storage":"postgres",...}

curl -s -o /dev/null -w "%{http_code}\n" https://levelchannel.ru/
# expected: 200

curl -s -X POST https://levelchannel.ru/api/payments/webhooks/cloudpayments/check \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "test=1" -w "\nHTTP %{http_code}\n"
# expected: HTTP 401, because there is no HMAC, but the route is alive
```

### How to check which commit is currently in production

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  cat /var/www/levelchannel/DEPLOYED_SHA
  su -s /bin/bash -c "git -C /var/www/levelchannel rev-parse HEAD" levelchannel
'

cd ~/LevelChannel
git fetch origin main
git rev-parse origin/main
```

If the SHAs don't match, that usually means the deploy timer hasn't yet
gone to GitHub, or the latest rollout failed. See
`journalctl -u levelchannel-autodeploy.service`.

### Rollback

Important: if you simply restore the old directory, the timer will
re-apply the current `origin/main` within a minute. So rollback always
starts by pausing autodeploy.

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

After that:

1. `git revert` the offending commit on `main` or quickly
   prepare a fix
2. push the correction
3. enable the timer again

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  systemctl start levelchannel-autodeploy.timer
  systemctl status levelchannel-autodeploy.timer --no-pager
'
```

If rollback runs into incompatibility with the DB schema, the rule is
the same: our current changes are safe as long as migrations are add-only.
If a destructive schema change ever appears, a backup restore is required
before rollback.

### Pre-push checklist

- [ ] locally: `npm run test:run` green
- [ ] locally: `npm run build` green
- [ ] on the server: `df -h /` shows headroom for a new release
- [ ] on the server: `pg_isready` returns ok
- [ ] env changes? - `/etc/levelchannel.env` updated first, then push
- [ ] you understand that a push to `main` goes to production automatically

### Forbidden practices

- manual `rsync` / `scp` into `/var/www/levelchannel`
- editing files directly on the server without a commit
- restarting `levelchannel` as a way to "deploy code" if `origin/main`
  hasn't been updated
- rollback without stopping `levelchannel-autodeploy.timer`

---

## 7. Environment variables (production)

The file lives **only** on the app server, not in the repository:

```dotenv
NODE_ENV=production

PAYMENTS_PROVIDER=cloudpayments
PAYMENTS_STORAGE_BACKEND=postgres

# critical: false. config.ts will fail boot if =true in production.
PAYMENTS_ALLOW_MOCK_CONFIRM=false

# the real domain over https. config.ts validates this on startup.
NEXT_PUBLIC_SITE_URL=https://<!-- FILL IN: domain -->

DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<db>?sslmode=<!-- prefer for managed PG, disable for local -->

# 32+ random characters; used for the HMAC hash of the e-mail in telemetry.
# Must not coincide with CLOUDPAYMENTS_API_SECRET.
TELEMETRY_HASH_SECRET=<!-- FILL IN -->

CLOUDPAYMENTS_PUBLIC_ID=<!-- FILL IN from the CloudPayments cabinet -->
CLOUDPAYMENTS_API_SECRET=<!-- FILL IN from the CloudPayments cabinet -->

# Resend transactional email (verify + reset + already-registered). With an
# empty key under NODE_ENV=production, lib/email/config.ts fails on boot.
RESEND_API_KEY=<!-- FILL IN from the Resend cabinet -->
EMAIL_FROM="LevelChannel <noreply@levelchannel.ru>"

# HMAC key for per-email rate-limit scope strings (lib/auth/email-hash.ts).
# 32+ random chars. NOT the same value as TELEMETRY_HASH_SECRET - different
# trust boundary, different rotation cadence (Phase 1B mech-3).
# Boot fails under NODE_ENV=production if empty.
AUTH_RATE_LIMIT_SECRET=<!-- FILL IN: 32+ random chars -->
```

`.env` on the server - permissions `chmod 600`, owner `root:root`, read
via `EnvironmentFile=` in the systemd unit. Not in git, not in a public
directory.

### Secret rotation

- **`CLOUDPAYMENTS_API_SECRET`**: rotation in the CloudPayments cabinet,
  then on the server: `vim .env`, `systemctl restart levelchannel`. Old
  webhook signatures stop validating immediately - coordinate so that
  CP doesn't have queued retries on the old key.
- **`TELEMETRY_HASH_SECRET`**: can be rotated without business impact - it
  breaks the linkage "the same e-mail in telemetry before and after rotation",
  but the events themselves are not lost.
- **`DATABASE_URL`**: DB password change - update in `.env`, restart.
- **`RESEND_API_KEY`**: rotation in the Resend cabinet, update `.env`, restart.
  The old key can be revoked immediately - verify/reset tokens come from
  our server, delivery does not depend on history.

---

## 8. Logs

| Source | Where to look |
|---|---|
| App stdout/stderr | `journalctl -u levelchannel` |
| Reverse proxy access | `/var/log/nginx/access.log` |
| Reverse proxy errors | `/var/log/nginx/error.log` |
| Database slow query | <!-- if `log_min_duration_statement` is enabled --> |
| OS / auth | `/var/log/auth.log` |

### What to look for when debugging a payment problem

```bash
# all events for a specific invoiceId
journalctl -u levelchannel --since "1 day ago" | grep "lc_<invoiceId>"

# only webhooks from CloudPayments
journalctl -u levelchannel --since "1 day ago" | grep "/api/payments/webhooks/"

# 401 on a webhook = the signature did not match - this is the most painful spot
journalctl -u levelchannel --since "6 hours ago" | grep -E "(HMAC|401)"

# CloudPayments tokens/charge rejections
journalctl -u levelchannel | grep -E "(charge-token|tokens/charge|requires_3ds|declined)"
```

---

## 9. Monitoring

### Uptime probe - GitHub Actions

**Health endpoint:** `GET /api/health`. Returns 200 + JSON
`{"status":"ok","provider":"cloudpayments","storage":"postgres","checks":{...}}`
or 503. See `PAYMENTS_SETUP.md` for the exact shape.

**Who pings.** The workflow [`/.github/workflows/uptime-probe.yml`](../.github/workflows/uptime-probe.yml)
runs every 5 minutes (`cron: '*/5 * * * *'`) on GitHub Actions
runners - external relative to production. In one run it makes 3 attempts
with a 20-second pause; OK is registered if **at least one** returns HTTP 200 +
`"status":"ok"` + `"database":"ok"`. This filters out short cold
starts and Actions-side network jitter.

**Where to see alerts.** On FAIL, the workflow opens a GitHub Issue with
the `uptime-incident` label in the same repo. The repo owner is subscribed
to issue create / comment events by default - notification lands at the
email tied to the GitHub account. Active incidents dashboard:

```
https://github.com/Igotsty1e/levelchannel/issues?q=is%3Aopen+label%3Auptime-incident
```

**Incident lifecycle (idempotent - the workflow handles all 4 states):**

| State | What the workflow does |
|---|---|
| FAIL + no open issue | creates a new `[uptime] ... is DOWN` |
| FAIL + open issue exists | appends a "Still failing at ..." comment (no new-issue spam) |
| OK + open issue exists | writes "Recovered at ..." and closes the issue |
| OK + no open issue | no-op |

The issue body contains the timestamp of detection, the last HTTP code, the last response
body (truncated to 1500 characters), and a link to the specific Actions run.

**Detection latency.** Practical floor ~5 minutes (cron interval) +
up to ~10 minutes (Actions cron sometimes delays under load) → worst case
~15 minutes. If 30-second precision is ever needed - we add an
external probe (BetterStack / Healthchecks.io) as a second layer,
this workflow stays.

### Runbook - what to do when an alert fires

1. **Open the issue, check the last response body in the issue body.** If you see HTTP code != 200 there - go to step 2. If timeout / curl exit without an HTTP code - DNS / TLS / no answer from the server; steps 3 and 5.

2. **Check by hand from your machine:**
   ```bash
   curl -i https://levelchannel.ru/api/health
   ```
   - 200 + `"status":"ok"` → false-positive in Actions (the run flapped, GH closed the issue itself). You can manually comment the cause in the issue.
   - 503 + `"database":"err"` → Postgres is down, step 4.
   - 502 / 504 → the app is not responding, step 3.
   - timeout / nothing → server / nginx / DNS, step 5.

3. **App is not responding.** SSH to the VPS:
   ```bash
   ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136
   systemctl status levelchannel
   journalctl -u levelchannel --since "10 min ago" | tail -100
   ```
   If the service died - `systemctl restart levelchannel`. If it's looping on crash - the journal will show the stack; deploy the necessary hotfix (auth secret missing, migration failed, OOM, etc.).

4. **Postgres unreachable.** SSH to the VPS:
   ```bash
   pg_isready -d "$DATABASE_URL"
   systemctl status postgresql
   journalctl -u postgresql --since "30 min ago" | tail -50
   df -h
   ```
   Most often - disk full (backups piled up) or OOM. See §13 retention drill, §5 backup commands.

5. **Server / nginx / DNS.**
   ```bash
   ssh root@83.217.202.136 'systemctl status nginx; nginx -t'
   dig +short levelchannel.ru
   ```
   - nginx is down - `systemctl restart nginx`.
   - dig returns a non-our IP → registrar incident (see §4).
   - SSH timeout → provider incident, check the Timeweb status page.

6. **After recovery** - the workflow will close the issue automatically
   on the next successful probe (max 5 min). If you need to do it
   manually - close it and add the cause as a comment for the
   incident retro.

### Manual probe run

If you want to check outside cron - Actions tab → uptime-probe →
**Run workflow** (button). Uses the `workflow_dispatch` trigger.

### Webhook-flow alerting (TODO - activation on the server)

`scripts/webhook-flow-alert.mjs` reads `payment_audit_events` for the last hour every 30 minutes and sends an email to `ALERT_EMAIL_TO` if the CloudPayments webhook contour looks broken:

| Signal | Verdict |
|---|---|
| <5 orders created in the window | `low_volume_skip` (silence - too quiet to judge) |
| `paid + fail + cancelled ≥ created` | `all_resolved` (everything resolved) |
| `(paid + fail) / created < 0.3` | **`alert`** - webhook stall |
| otherwise | `ok` |

What "webhook stall" means: orders are being created but pay/fail webhooks aren't arriving (or are arriving but aren't being processed). Most often - CP cabinet URLs are broken, the HMAC secret has drifted from `/etc/levelchannel.env`, or the handler crashed in a loop.

**Activation (one-off, requires SSH):**

```bash
# 1) make sure scripts/webhook-flow-alert.mjs is already on the server
#    (it lands on the VPS via the usual autodeploy - mirror of the git repo)
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136

# 2) install unit + timer
cp /var/www/levelchannel/scripts/systemd/levelchannel-webhook-flow-alert.service \
   /etc/systemd/system/
cp /var/www/levelchannel/scripts/systemd/levelchannel-webhook-flow-alert.timer \
   /etc/systemd/system/

# 3) add ALERT_EMAIL_TO to /etc/levelchannel.env (if not yet set;
#    EMAIL_FROM, RESEND_API_KEY, DATABASE_URL are already there)
echo 'ALERT_EMAIL_TO=masteryprojectss@gmail.com' >> /etc/levelchannel.env

# 4) start the timer
systemctl daemon-reload
systemctl enable --now levelchannel-webhook-flow-alert.timer

# 5) verify
systemctl status levelchannel-webhook-flow-alert.timer
journalctl -u levelchannel-webhook-flow-alert.service --since "5 min ago"
```

**Manual run without waiting for the timer:**

```bash
systemctl start levelchannel-webhook-flow-alert.service
journalctl -u levelchannel-webhook-flow-alert.service -n 20
```

In the journal, every run prints one JSON line with `verdict` - which is `low_volume_skip` / `all_resolved` / `ok` / `alert`.

**Fine-tuning (env vars):**

| Var | Default | What it does |
|---|---|---|
| `WEBHOOK_FLOW_WINDOW_MINUTES` | `60` | window for the count |
| `WEBHOOK_FLOW_MIN_VOLUME` | `5` | minimum orders to trigger (avoids false-positive on small volumes) |
| `WEBHOOK_FLOW_TERMINATED_RATIO` | `0.3` | floor for the (paid+fail)/created ratio for alert |

**Idempotence:** the script does NOT keep "already alerted" state. Every run in alert state sends an email. With cron 30 minutes - max 2 emails/hour, which is acceptable. If noise becomes a problem, add a state file `/var/lib/levelchannel/last-webhook-alert-at` - separate wave.

### Sentry - error tracking

Connected 2026-04-29. The SDK lives in:
- `instrumentation.ts` - Node + Edge runtime init (reads `SENTRY_DSN`)
- `instrumentation-client.ts` - browser SDK (reads `NEXT_PUBLIC_SENTRY_DSN`)
- `app/global-error.tsx` - top-level React error boundary, forwards to Sentry and renders the ru fallback
- `next.config.js` - wrapped in `withSentryConfig` (CSP allows `*.ingest.de.sentry.io` / `*.ingest.sentry.io` in `connect-src` + `worker-src 'self' blob:`)

**Project:** `mastery-zs/levelchannel` on Sentry SaaS (EU region).

**Dashboard:**
```
https://sentry.io/organizations/mastery-zs/projects/levelchannel/
```

The owner is subscribed to email notifications for new issues by default (Sentry account-level setting).

**Env vars (production, in `/etc/levelchannel.env`):**

| Var | What |
|---|---|
| `SENTRY_DSN` | DSN - taken from Sentry → Settings → Projects → levelchannel → Client Keys |
| `NEXT_PUBLIC_SENTRY_DSN` | the same value, available to the browser (build-time inline) |
| `SENTRY_AUTH_TOKEN` (optional) | for source-maps upload during `npm run build`. Without it, stack traces still come, but they reference the bundled JS instead of the original TS |

Without a DSN the SDK becomes a no-op - which is good for dev. In production an empty DSN means silent absence of alerts; controlled via a smoke capture after deploy:

```bash
# manual smoke - after changing the SDK or DSN:
node -e "
  const S = require('@sentry/nextjs');
  S.init({ dsn: process.env.SENTRY_DSN });
  S.captureMessage('manual smoke ' + Date.now());
  S.flush(5000).then(() => process.exit(0));
"
```

The event appears in Sentry within ≤30 seconds.

**`tracesSampleRate=0.1`** in both inits - performance traces are sampled at 10% so as not to exceed free tier limits. Raise after real load.

**`sendDefaultPii: false`** - the standard safe option. Sentry default integrations redact common auth headers; the flag reinforces this.

**Release tagging:** `instrumentation.ts` reads `process.env.GIT_SHA` (the same one the deploy-freshness workflow uses). After activating the server-side patch for `GIT_SHA` ([§6 Deploy](#)), Sentry will group issues by release.

### Operator email on successful payment

Connected 2026-04-29. Inline in `app/api/payments/webhooks/cloudpayments/pay/route.ts` - after `markOrderPaid` + audit, the handler sends an email notification to `OPERATOR_NOTIFY_EMAIL` via Resend.

Best-effort: a Resend error / missing env var **does not** break the webhook ACK to CloudPayments. Without ACK, CP starts re-firing → audit gets a duplicate paid event. So the notification is wrapped in try/catch + console.warn into the journal.

**Activation:**

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136
echo 'OPERATOR_NOTIFY_EMAIL=masteryprojectss@gmail.com' >> /etc/levelchannel.env
systemctl restart levelchannel
```

On the next successful payment, an email arrives with the subject `[LevelChannel] «Платёж получен»: <amount> ₽ - <invoice>`.

**When the email does NOT arrive:**
1. Check `journalctl -u levelchannel | grep '\[notify\]'` - there will be a warn if something broke.
2. Resend account: free-tier limit 100 emails/day; if you're hitting it - `RESEND_API_KEY` mismatch.
3. The EMAIL_FROM domain must be verified in the Resend dashboard.

### What is NOT configured (on the roadmap)

- Slack/Telegram alert on a successful payment - separate task in the backlog (needs a bot token and parse_mode logic). Email covers 80% of the need
- Disk usage monitoring (indirectly - `db: err` will show up when the disk is dying)

---

## 10. CloudPayments cabinet

<!-- FILL IN: cabinet ID, contact email of the account -->

**Webhooks** (configured in the cabinet → Site → Notifications):

| Event | URL |
|---|---|
| Check | `https://levelchannel.ru/api/payments/webhooks/cloudpayments/check` |
| Pay | `https://levelchannel.ru/api/payments/webhooks/cloudpayments/pay` |
| Fail | `https://levelchannel.ru/api/payments/webhooks/cloudpayments/fail` |

All three - POST, format: `application/x-www-form-urlencoded` or
`application/json` (we accept both). HMAC must be enabled
(`X-Content-HMAC` / `Content-HMAC`).

**One-click payments / cofRecurring** - **must be enabled**, otherwise
`/payments/tokens/charge` will return an error.

**OFD / online kassa** - switched to live mode, cheks are sent to the
e-mail from `receiptEmail`.

---

## 11. Common ops runbook

### Find an order by client e-mail

```bash
psql "$DATABASE_URL" -c "
  select invoice_id, amount_rub, status, created_at, paid_at
  from payment_orders
  where customer_email = '<email>'
  order by created_at desc;
"
```

### Find an order "stuck" in pending

```bash
psql "$DATABASE_URL" -c "
  select invoice_id, amount_rub, customer_email, created_at, updated_at
  from payment_orders
  where status = 'pending' and created_at < now() - interval '30 minutes'
  order by created_at desc;
"
```

If this is a CloudPayments order - the webhook didn't arrive. Check:
1. `/api/health` returns 200
2. nginx access log: did a POST arrive at `/api/payments/webhooks/cloudpayments/pay`
3. CloudPayments cabinet → notification history → are there retries
4. If you need to close it manually - NOT through mock confirm (it's disabled in production).
   Use the CP cabinet: trigger a notification re-send, our processing
   is idempotent.

### Look at the events of a single order

```bash
psql "$DATABASE_URL" -c "
  select jsonb_array_elements(events)
  from payment_orders
  where invoice_id = 'lc_<id>';
"
```

### Check who has a saved card

```bash
psql "$DATABASE_URL" -c "
  select customer_email, card_last_four, card_type, created_at, last_used_at
  from payment_card_tokens
  order by last_used_at desc;
"
```

### Delete a token at the client's request (personal-data law, 152-FZ)

```bash
psql "$DATABASE_URL" -c "
  delete from payment_card_tokens where customer_email = '<email>';
"
```

The «Забыть эту карту» button in the UI does the same - but sometimes
clients write in by hand.

### Clean up old idempotency records

```bash
psql "$DATABASE_URL" -c "
  delete from idempotency_records where created_at < now() - interval '24 hours';
"
```

Optionally via cron: `0 3 * * * psql ... -c "delete ..."`.

### Restart the runtime

```bash
sudo systemctl restart levelchannel    # or pm2 restart levelchannel
sudo journalctl -u levelchannel -f     # confirm it came up clean
curl -s https://<domain>/api/health | jq    # status should be ok
```

### Temporarily enable verbose logging

There's no log-level switch in the code. If you need deep debug - drop
`console.log` at the right spot, deploy, then remove.

---

## 12. Incident playbook

### Symptom: "the payment went through but the client sees pending"

1. Find the order by invoice_id or email (see §11).
2. Check `status` in the DB - is it really pending?
3. Check whether the webhook arrived: `journalctl ... | grep "/webhooks/cloudpayments/pay"` for the last 30 min.
4. If the webhook didn't arrive: CP cabinet → resend the notification. Our processing is idempotent - it won't duplicate.
5. If the webhook did arrive but the order is still pending: look at the order events, most likely HMAC didn't match (`{"code":13}`). Check `CLOUDPAYMENTS_API_SECRET` in .env vs in the cabinet.

### Symptom: `/api/health` returns 503

1. `journalctl -u levelchannel -n 100` - what's in the logs?
2. `pg_isready -d "$DATABASE_URL"` - is the DB alive?
3. Check `df -h /` - is the disk full?
4. If the runtime crashed and won't come up: `systemctl status levelchannel`,
   `systemctl restart levelchannel`, look at stderr.

### Symptom: "the bank won't let through 3DS"

1. Find the order with `metadata.threeDs.transactionId`.
2. Check telemetry: `select * from payment_telemetry where invoice_id = '<id>' order by at`.
3. If `one_click_3ds_callback` is there but `one_click_3ds_paid` is not -
   `confirmThreeDsAndFinalize` returned `declined` or `error`. The order's
   `events` should contain a `one_click.3ds_error` or `payment.failed` record.
4. If `one_click_3ds_callback` is missing - the user did not return from the
   bank's ACS. This is not our bug, but we may not get a webhook from CP.
   After a few minutes CP itself will mark the transaction as timeout and send Fail.

### Symptom: suspicion of brute-force / DDoS

1. `tail -f /var/log/nginx/access.log` - look at the top IPs
2. `journalctl -u levelchannel | grep "Too many requests"` - our limiter
   is already pushing back something
3. If the flow is above limiter capacity - tighten `limit_req_zone` in nginx
   (see §3) and run `nginx -s reload`

---

## 12.5 One-shot activator: SENTRY + notifications + cron timers + GIT_SHA

After a big batch of PRs (auth debt, audit log, Sentry, retention cron, deploy-freshness probe, etc.), some of it works "as code in production", and some requires **a one-off setup on the server**: env vars, systemd units and a patch to the autodeploy script. Previously this was 4 separate copy-paste blocks (`§9 Sentry`, `§9 Webhook-flow`, `§5 Retention`, `§6 Deploy freshness`). Now it's all bundled into one idempotent script - you can rerun it as many times as you want, the second run will be a no-op for whatever has already been done.

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136
cd /var/www/levelchannel

# Pull the freshest main (autodeploy does this itself, of course, but we want
# the very latest version of the activator script):
git fetch origin && git reset --hard origin/main

bash scripts/activate-prod-ops.sh
```

The script does (details - the top of `scripts/activate-prod-ops.sh`):

1. Appends 4 new env vars to `/etc/levelchannel.env` if they are missing:
   `ALERT_EMAIL_TO`, `OPERATOR_NOTIFY_EMAIL`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`. Existing values are **not overwritten**.

2. Patches `/usr/local/bin/levelchannel-autodeploy` so that before each `npm run build` it exports `GIT_SHA=$(git rev-parse HEAD)` and updates that line in `/etc/levelchannel.env`. Before patching it creates a backup `*.bak-<timestamp>`. Idempotency: if `export GIT_SHA=$(git rev-parse HEAD)` is already in the file - skip.

3. Copies unit/timer files into `/etc/systemd/system/`:
   - `levelchannel-webhook-flow-alert.{service,timer}`
   - `levelchannel-db-retention.{service,timer}`
   `cp -p` - permissions/owner from the source. If an identical file is already in place - skip.

4. `systemctl daemon-reload`, `enable --now` for both timers, `restart levelchannel` (if env actually changed).

When done, the script prints a follow-up smoke command for Sentry + curl on `/api/health.version`. The first event will appear in Sentry within a minute after the next push to main.

---

## 13. Debt and known ops gaps

### Closed hardening work - 2026-04-29

Closed: SSH publickey-only, bind `127.0.0.1:3000`, nginx `limit_req`
on `/api/*`, daily DB backup + restore drill, `npm run migrate:up`
in the autodeploy pipeline. Details live in §§1, 3, 5 and 6.

Of the actual blanks not yet closed: CloudPayments cabinet ID, OFD
status, DNS registrar.

### Open debt (operations)

- set up an uptime monitor on `/api/health` (UptimeRobot free / BetterStack)
- connect Sentry, or at least `journald` → log aggregator
- formalise rotation of `CLOUDPAYMENTS_API_SECRET` (every N months or by event)
- a 14-day backup retention does not replace a separate archival contour. Under
  the personal-data law (152-FZ), personal data must be kept only while the
  processing purpose is current, while payment records and the related proofs
  of consent must remain available in the main DB and working archives for the
  full mandatory retention period
- alerting on a failed autodeploy / a hung `levelchannel-autodeploy.service`
- session cleanup cron for `account_sessions` (Phase 1A backlog)

### git ↔ prod sync

`/var/www/levelchannel` is now a git checkout of the last successful release.
The main question is no longer "is there a git repo there", but "did the
last deploy reach a healthy state".

**How to check current state at any time:**

```bash
ssh -i ~/.ssh/levelchannel_timeweb_ed25519 root@83.217.202.136 '
  systemctl status levelchannel-autodeploy.timer --no-pager
  journalctl -u levelchannel-autodeploy.service -n 50 --no-pager
  cat /var/www/levelchannel/DEPLOYED_SHA
  su -s /bin/bash -c "git -C /var/www/levelchannel rev-parse HEAD" levelchannel
  curl -s http://127.0.0.1:3000/api/health
'
```

Then locally:

```bash
cd ~/LevelChannel
git fetch origin main
git rev-parse origin/main
```

If the SHAs do not match for more than a couple of minutes, this is already a
deploy pipeline incident: see `journalctl -u levelchannel-autodeploy.service`,
verify GitHub access via the key `/home/levelchannel/.ssh/github_deploy` and
free space for a new release.
