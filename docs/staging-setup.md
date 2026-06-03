# Staging environment setup

> Operator runbook for `staging.levelchannel.ru`.
>
> Scope: single shared staging that tracks the `staging` branch, lives on the
> SAME VPS as prod (separate port + user + DB), uses CloudPayments TEST mode
> credentials, and gets auto-promoted from `main` by GitHub Actions after
> post-deploy smoke confirms prod is healthy.
>
> Status of the scaffold: PR #505 (this PR) ships repo-side infra:
> systemd units, nginx vhost, autodeploy script, env template, GH Actions
> workflows, Playwright config + staging suite. **All operator activation
> steps are documented here**; nothing in this PR changes prod behaviour.

## Architecture

```
Internet → Cloudflare DNS → staging.levelchannel.ru
                          │
                          ▼
                  VPS nginx (vhost staging.conf)
                          │
                          ▼
              localhost:3001 (next start)
                          │
                          ▼
        Postgres: levelchannel_staging (separate DB, same instance)
                          │
                          ▼
            CloudPayments TEST mode site (separate Public ID + API Secret)
```

Why same-VPS:

- One physical machine is cheaper and simpler than two.
- Prod gets resource priority (systemd-side `CPUWeight=400` recommended for
  `levelchannel.service`, `CPUWeight=100` for `levelchannel-staging.service`).
- Staging tolerates degradation; prod must not.

Why same-Postgres-instance, separate DB:

- Schema parity guaranteed (same `npm run migrate:up` against both).
- Avoids second `pg` install + backup pipeline.
- staging DB CAN be wiped freely — `psql -c "DROP DATABASE levelchannel_staging"`
  is a routine operation. Prod DB never gets that treatment.

Why CP TEST as separate Site, not separate Account:

- CloudPayments per-Site keys are the only mechanism for test isolation
  on a single merchant. Same merchant cabinet manages prod + test from one
  pane.
- Account-level "test mode toggle" does not exist in CP UI.

## Activation runbook (operator-side, ~45 min)

### Prerequisites

- SSH access to the prod VPS as a user with `sudo`.
- DNS control over `levelchannel.ru` (Cloudflare).
- CloudPayments TEST site already created in merchant cabinet
  (see PR #505 conversation; site name `levelchannel-staging`,
  URL `https://staging.levelchannel.ru`, with Check/Pay/Fail webhooks
  pointing at the staging API paths).
- Test Public ID + API Secret on hand (do NOT paste into chat or git).

### Step 1 — DNS

In Cloudflare:

1. Add an `A` record:
   ```
   Name:    staging
   Type:    A
   Content: <PROD_VPS_IP>
   Proxy:   off (so certbot can solve the HTTP-01 challenge)
   TTL:     auto
   ```
2. Wait 60-120s for propagation.
3. Verify: `dig staging.levelchannel.ru +short` returns the VPS IP.

### Step 2 — User + filesystem + git clone

```bash
sudo useradd --system --create-home \
    --home-dir /srv/levelchannel-staging \
    --shell /usr/sbin/nologin \
    levelchannel-staging

sudo mkdir -p /var/log/levelchannel-staging /var/lib/levelchannel-staging
sudo chown levelchannel-staging:levelchannel-staging \
    /var/log/levelchannel-staging /var/lib/levelchannel-staging

# Clone the repo onto the staging working tree
sudo -u levelchannel-staging git clone https://github.com/Igotsty1e/levelchannel.git /srv/levelchannel-staging
cd /srv/levelchannel-staging
sudo -u levelchannel-staging git checkout staging
```

### Step 3 — Postgres database

```bash
sudo -u postgres psql <<EOF
CREATE USER lc_staging WITH PASSWORD '<generate-32-char-secret>';
CREATE DATABASE levelchannel_staging OWNER lc_staging;
GRANT ALL PRIVILEGES ON DATABASE levelchannel_staging TO lc_staging;
EOF
```

Keep the generated `lc_staging` password handy — it goes into
`/etc/levelchannel-staging/env` next.

### Step 4 — Env file

```bash
sudo mkdir -p /etc/levelchannel-staging
sudo cp /srv/levelchannel-staging/ops/staging/env-template \
        /etc/levelchannel-staging/env

# Fill in every <FILL_IN_*> placeholder, including:
# - DATABASE_URL with the lc_staging password from Step 3
# - CLOUDPAYMENTS_PUBLIC_ID + CLOUDPAYMENTS_API_SECRET from the CP test site
# - All *_SECRET fields with `openssl rand -base64 32`
# - GOOGLE_CALENDAR_* with a SECOND OAuth client (NOT the prod one)
# - LC_ENV=staging  (drives /api/health.environment + Sentry env tag)
# - NEXT_PUBLIC_LC_ENV=staging
sudo $EDITOR /etc/levelchannel-staging/env

sudo chown levelchannel-staging:levelchannel-staging /etc/levelchannel-staging/env
sudo chmod 600 /etc/levelchannel-staging/env
```

### Step 5 — nginx vhost (HTTP-only bootstrap for certbot)

The committed `ops/staging/nginx/staging.conf` references
`/etc/letsencrypt/live/staging.levelchannel.ru/` paths that don't exist
yet. We install a minimal HTTP-only stub first so certbot has a vhost
to attach to, then replace it after the cert lands.

```bash
sudo cp /srv/levelchannel-staging/ops/staging/nginx/staging-http-bootstrap.conf \
        /etc/nginx/sites-available/staging.conf
sudo ln -sf /etc/nginx/sites-available/staging.conf \
            /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Verify: `curl -sI http://staging.levelchannel.ru/` returns `503` (the
stub vhost intentionally returns 503 for everything outside the ACME
challenge path).

### Step 6 — SSL via certbot

```bash
sudo certbot --nginx -d staging.levelchannel.ru \
    --non-interactive --agree-tos -m <operator-email>

# certbot adds the 443 block + auto-redirect 80 → 443 to the
# minimal stub. Now swap in the full committed config that has all the
# hardening headers + the proxy_pass to port 3001. Certbot's
# /etc/letsencrypt/ artifacts remain — only the vhost file changes.
sudo cp /srv/levelchannel-staging/ops/staging/nginx/staging.conf \
        /etc/nginx/sites-available/staging.conf
sudo nginx -t
sudo systemctl reload nginx
```

Verify: `curl -sI https://staging.levelchannel.ru/` returns `502 Bad
Gateway` at this point — the cert is live and nginx is up, but the
upstream port 3001 has nothing listening yet. That's the expected
pre-app state. Step 7 starts the systemd unit and the response will
flip to `200`.

### Step 6.5 — Swap file (required for build on small VPS)

The VPS has 2 GB RAM and prod's `next-server` already holds ~500 MB. The
staging cold-start build runs `tsc --noEmit` after `next build`'s
compile step, which peaks at ~1.5 GB and gets OOM-killed without
backing swap (verified 2026-06-03 — `Killed` after "Running TypeScript
…"; the build exits 0 but writes no `.next/BUILD_ID`, so `next start`
later refuses to run).

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo swapon --show   # confirm 4 GB swap is active
```

The swap is only used during the build burst; runtime memory of both
prod + staging fits comfortably in physical RAM and never touches it.
No prod-impact risk.

### Step 7 — systemd units

```bash
sudo cp /srv/levelchannel-staging/ops/staging/systemd/*.service \
        /srv/levelchannel-staging/ops/staging/systemd/*.timer \
        /etc/systemd/system/
sudo systemctl daemon-reload

# Allow the staging-autodeploy user to start/stop the staging unit only
# (NOT prod). Edit sudoers:
sudo visudo -f /etc/sudoers.d/levelchannel-staging
# Add this single line:
levelchannel-staging ALL=(root) NOPASSWD: /bin/systemctl start levelchannel-staging.service, /bin/systemctl stop levelchannel-staging.service

# Initial migration + build. Use the SAME env file the autodeploy will
# use, so build-time NEXT_PUBLIC_* values match what production code
# sees later. `set -a` exports every sourced var to the build process.
sudo -u levelchannel-staging bash -c '
cd /srv/levelchannel-staging
set -a
. /etc/levelchannel-staging/env
set +a
npm ci --no-audit --no-fund
npm run migrate:up
export GIT_SHA=$(git rev-parse HEAD)
npm run build
'

# Start the unit + timer
sudo systemctl enable --now levelchannel-staging.service
sudo systemctl enable --now levelchannel-staging-autodeploy.timer
```

### Step 8 — Verify

```bash
curl -s https://staging.levelchannel.ru/api/health | jq
```

Expected:
```json
{
  "status": "ok",
  "environment": "staging",
  "version": "<commit sha>"
}
```

Key check: `environment` must be `"staging"`. If it's `"prod"`, nginx
is routing staging.levelchannel.ru to the prod backend — fix the
vhost server_name + reload nginx.

### Step 9 — GitHub Actions secrets

In the repo settings → Secrets → Actions, add:

- `STAGING_HEALTH_DETAIL_SECRET` — same value as `HEALTH_DETAIL_SECRET`
  in `/etc/levelchannel-staging/env`. Lets the
  `.github/workflows/staging-uptime.yml` probe access the privileged
  health shape. Without it the probe falls back to the slim shape, which
  still works but doesn't reveal `database: ok`.

### Step 10 — First promote

The first time you push to `staging`, the autodeploy timer needs to find
something to fetch:

```bash
# From your local machine
git push origin main:staging
```

The `staging-promote.yml` workflow will then take over automatically
after every prod-smoke-ok event.

## Operating cadence

### Auto-promote sequence (the happy path)

1. PR merges to `main`
2. `autodeploy.timer` on VPS pulls main, builds, restarts prod
3. `post-deploy-smoke.yml` probes prod, returns 200 OK
4. GH Actions `staging-promote.yml` fires (triggered by the smoke
   workflow_run completion)
5. `staging-promote` pushes `main` HEAD to `staging` branch
6. Staging `autodeploy.timer` picks up new SHA within 60s
7. Staging restarts with new code
8. `staging-e2e.yml` polls `/api/health.version` against the promoted SHA every 15 s for up to 10 min (exits early on match), then runs
   Playwright suite against `https://staging.levelchannel.ru`

Total lag main-merge → staging-e2e-result: ~10-15 min.

### Manual promote (override)

```bash
git push origin <sha>:staging --force
```

Use case: you want to test a specific PR branch on staging without
merging to main. Replace `<sha>` with the PR-branch commit SHA. CI
will warn about the manual push diverging staging from main; that's
intentional and resolves on next auto-promote.

### Wiping staging DB

```bash
# On VPS, as a user with psql access:
sudo -u postgres psql <<EOF
DROP DATABASE levelchannel_staging;
CREATE DATABASE levelchannel_staging OWNER lc_staging;
EOF

sudo systemctl restart levelchannel-staging-autodeploy.service
```

The autodeploy script re-runs migrations on the fresh DB. Safe operation
— staging never holds anything real.

### Rolling staging back

```bash
# Force-promote an older SHA from main:
git push origin <older-main-sha>:staging --force
```

Or pause autodeploy:

```bash
sudo systemctl stop levelchannel-staging-autodeploy.timer
```

Re-enable when ready.

## Testing on staging

### Card numbers (CloudPayments TEST mode)

| Card | Number | CVV | Expiry | 3DS pwd |
|---|---|---|---|---|
| Visa OK | `4111 1111 1111 1111` | any 3 | any future | `12345678` |
| Mastercard OK | `5555 5555 5555 4444` | any 3 | any future | `12345678` |
| Decline | `4000 0000 0000 0002` | any 3 | any future | — |
| 3DS challenge | `4000 0000 0000 3220` | any 3 | any future | `12345678` |

No actual money moves. CP-side webhooks fire with real HMAC signatures
against `CLOUDPAYMENTS_API_SECRET` from `/etc/levelchannel-staging/env`,
so the full intake → audit → grant → consumption path is exercised
end-to-end.

### Known limitations

- **Real cards rejected**: staging Public ID is `pk_bbf9*` (test prefix);
  CP rejects real card numbers under this site. Use only test card
  numbers above.
- **5 concurrent request cap**: CP TEST terminals rate-limit at 5
  simultaneous requests → HTTP 429. Our Playwright suite runs
  sequentially (`workers: 1`) so this doesn't trip.
- **No SBP**: staging CP site doesn't have SBP activated. The /pay UI
  shows the SBP button when `SBP_ENABLED=true` (operator-tunable), but
  staging defaults to off because there's nothing to call.
- **Telegram unwired by default**: staging env-template ships with empty
  `TELEGRAM_*` vars. Telegram-side bots and admin commands stay
  uninitialized. To activate: register a separate bot under a different
  username, add the token + chat_id to `/etc/levelchannel-staging/env`,
  restart.

## Troubleshooting

### `staging-inactive` issue auto-opens

The `staging-uptime.yml` workflow can't resolve `staging.levelchannel.ru`.
Either DNS isn't set (Step 1) or nginx vhost is missing (Step 6).

### `/api/health` returns `environment: "prod"` on staging URL

nginx is routing staging.levelchannel.ru to the prod backend. Check:

```bash
nginx -T 2>&1 | grep -A 5 staging.levelchannel.ru
```

The `proxy_pass` line should point at `127.0.0.1:3001`, not `:3000`. If
wrong, edit `/etc/nginx/sites-enabled/staging.conf` and reload.

### Staging-promote workflow keeps failing with `force-with-lease` error

Someone manually advanced staging beyond main. Either:

- Accept the manual state, wait for it to catch up naturally
- Hard-reset: `git push origin main:staging --force` (no `--force-with-lease`)

### CloudPayments webhook returns 401 in our handler

`CLOUDPAYMENTS_API_SECRET` in `/etc/levelchannel-staging/env` does NOT
match the test-site API Secret in the CP merchant cabinet. Re-copy from
the cabinet and restart staging.

### prod regression after staging-e2e green

This shouldn't happen — staging and prod run identical code from the
same commit. If it does, the failure mode is environment drift (env
vars / DB schema / nginx config differ). Compare:

```bash
diff <(curl -s https://levelchannel.ru/api/health -H "X-Health-Detail: $PROD_SECRET" | jq -S) \
     <(curl -s https://staging.levelchannel.ru/api/health -H "X-Health-Detail: $STAGING_SECRET" | jq -S)
```

Any diff outside `environment` and `version` fields is the culprit.

## Files in this scaffold

| Path | Purpose |
|---|---|
| `ops/staging/systemd/*.service` + `.timer` | systemd units, copy to `/etc/systemd/system/` |
| `ops/staging/scripts/autodeploy-staging.sh` | invoked by the autodeploy timer |
| `ops/staging/nginx/staging.conf` | nginx vhost, copy to `sites-available/` |
| `ops/staging/env-template` | env file template, fill + copy to `/etc/levelchannel-staging/env` |
| `app/api/health/route.ts` | adds `environment` field driven by `LC_ENV` |
| `.github/workflows/staging-promote.yml` | main → staging auto-promote |
| `.github/workflows/staging-uptime.yml` | external health probe every 15 min |
| `.github/workflows/staging-e2e.yml` | Playwright suite against deployed staging |
| `playwright.config.staging.ts` | Playwright config targeting staging URL |
| `tests/e2e/staging-flows.spec.ts` | staging product-flow suite |

## Out of scope for this PR

- Per-PR preview environments (Vercel-style). Single shared staging is
  the v1 scope.
- Staging-specific Sentry project (we use `environment=staging` tag with
  the same DSN; cheaper and good enough for v1).
- Separate staging Resend domain (we reuse `mail.levelchannel.ru`;
  staging emails go to ops accounts only).
- Mutation testing / property testing — separate P0 #2 from the audit.

## Maturity bump

The audit's `Staging / canary` dimension was 0.5/5 (no pre-prod
environment). After PR #505 + operator activation, the dimension moves
to ~2.5/5: real staging environment, real CP TEST integration, real
post-promote e2e. Not 3.5+ because (a) lag-behind-main only,
(b) single environment shared by all PRs, (c) no canary traffic split.
Future ratchet: per-PR preview envs would move it to 4.0+.

## Lessons from first cold-start (2026-06-03)

Captured during the autonomous first activation on the prod VPS so the
next operator doesn't re-discover them in production:

1. **`seed-staging-env.sh` reads `/etc/<operator>.env`, not
   `/etc/<operator>/env`.** Some operator runbooks use a subdirectory
   layout; LevelChannel uses the flat file in /etc. The helper now
   assembles the path from `${PROD_OPERATOR:-levelchannel}` (override
   via `PROD_ENV_PATH=...` if your prod layout differs). Fixed in
   PR #507.

2. **`EMAIL_FROM` must be quoted in the env file.** The display name
   contains `<` / `>` characters; bash's `source` interprets them as
   I/O redirects and aborts the Step 7 build with `syntax error near
   unexpected token 'newline'`. systemd's `EnvironmentFile=` accepts
   both quoted and unquoted forms, so quoting is the universally safe
   shape. Fixed in the env-template + seed helper.

3. **Node 20 V8 baseline JIT is incompatible with
   `MemoryDenyWriteExecute=true`.** The unit dies immediately with
   `status=5/TRAP` because V8's `OS::SetPermissions` mprotects pages
   W↔X at runtime. Prod's `levelchannel.service` does not set MDWE
   either; staging dropped it to match. The remaining
   `@system-service` filter + `@privileged`/`@resources` deny + pkey_*
   allowlist still catches the regression class
   `scripts/seccomp-regression-check.sh` asserts on. Fixed in PR #507.

4. **`RestrictAddressFamilies` must include `AF_NETLINK`.** Linux
   glibc `getifaddrs(3)` uses rtnetlink under the hood. Without it
   libuv's `uv_interface_addresses` returns `EAFNOSUPPORT` (errno 97).
   Next 16's `start-server.js` post-listen callback throws on it and
   never registers the request handler — port 3001 listens but every
   TCP request times out at 0 bytes received. Fixed in PR #507.

5. **`staging-promote.yml` needs a first-time-bootstrap path.** On a
   fresh repo the `staging` branch does not exist; the workflow's
   `--force-with-lease="refs/heads/staging:"` (empty lease ref)
   behaves inconsistently across git versions. Workflow now detects
   the empty `STAGING_SHA` case and falls back to a plain
   `git push origin SHA:refs/heads/staging` for the bootstrap. Fixed
   in this cleanup PR.

6. **A 4 GB swap file on the VPS is required.** The build's
   `tsc --noEmit` step peaks at ~1.5 GB; together with prod
   `next-server` it exceeds the 2 GB physical RAM. Without swap the
   build is `Killed` after "Running TypeScript ..." and exits 0
   without writing `BUILD_ID`, leaving `next start` unable to run.
   Documented in Step 6.5 above.

None of these escape CI's `build-check` because CI runs `next build`
but never `next start`, and CI runners have abundant RAM. The
follow-up is a smoke-boot regression workflow that boots
`next-server` under the actual unit file's hardening for ~30 s and
hits `/api/health`. See the cross-cutting backlog item for the
tracker.
