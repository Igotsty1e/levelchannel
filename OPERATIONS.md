# Operations Note

The detailed production operations runbook for LevelChannel is intentionally
kept outside the tracked repository surface.

This file remains only as a public-safe pointer.

## What is private

- server inventory and access procedures
- deployment and rollback runbooks
- backup and retention operations
- incident response checklists
- operator-only alerting and maintenance procedures

## Public boundary

Public repository readers should use:

- `README.md` for project orientation
- `DOCUMENTATION.md` for the documentation map
- `ARCHITECTURE.md` for the runtime code map
- `SECURITY.md` for trust boundaries and hardening notes
- `docs/public/` for public-facing architecture and roadmap context

## Operator-tunable env knobs (pointers only — procedure lives in the private runbook)

- `LEARNER_CANCEL_WINDOW_HOURS` — minimum hours-until-start required
  for a learner self-service cancel. Default 24; clamp [0..720]; 0
  disables the gate (operator policy). Strict integer parser — any
  malformed value (whitespace, sign, decimal, non-digit) falls back
  to default 24. Implemented in `lib/scheduling/policy.ts` since
  POLICY-KNOBS (2026-05-17). See the private runbook for the
  operator procedure (env-file edit + systemctl restart).

- `SBP_ENABLED` — operator gate for the SBP QR endpoint
  `POST /api/payments/sbp/create-qr`. Default off (route responds
  503 `sbp_disabled`). Set to literal `'true'` to revive once the
  CloudPayments-side merchant terminal has SBP activated — flip
  this BEFORE testing the route, NOT after. Exact-match guard
  rejects truthy strings other than `'true'`. Operator procedure:
  (1) confirm SBP live in the CloudPayments dashboard, (2) edit
  `$ENV_FILE` → `SBP_ENABLED=true`, (3) `systemctl restart
  levelchannel`. The `/pay` UI does not need a re-ship — SBP
  surfaces as a payment method inside the standard CloudPayments
  widget. Added by PAY-SBP-REMOVAL (2026-05-20).

- `TELEGRAM_API_BASE_URL` — base URL for outbound Telegram Bot API
  calls. Default `https://api.telegram.org`. Mandatory override when
  the production VPS cannot reach `api.telegram.org` directly (some
  RU hosting blocks the host). Set to a reverse-proxy URL such as a
  Cloudflare Worker that forwards `/bot<TOKEN>/<method>` verbatim to
  `api.telegram.org`. Reference Worker implementation lives at
  `scripts/cloudflare-worker-telegram-proxy.js`; operator procedure
  is in the private runbook. Read-once at module load in
  `scripts/lib/telegram-alerts.mjs` — restart the app after changing.
  Added by BCS-DEF-4-TG-PROXY (2026-05-21).

## Staging environment

Staging at `staging.levelchannel.ru` is a single shared instance tracking the
`staging` branch (auto-promoted from `main` after prod post-deploy-smoke).
Lives on the same VPS as prod (separate port 3001 + user `levelchannel-staging`
+ DB `levelchannel_staging` + CloudPayments TEST-mode site keys). Activation
runbook + ops cadence + troubleshooting → [`docs/staging-setup.md`](docs/staging-setup.md).

Scaffold lives at:

- `ops/staging/systemd/` — service + autodeploy + timer units
- `ops/staging/scripts/autodeploy-staging.sh` — staging deploy driver
- `ops/staging/nginx/staging.conf` — vhost
- `ops/staging/env-template` — env file template (fill placeholders, copy to `/etc/levelchannel-staging/env` on VPS)

Operator-tunable knobs specific to staging:

- `LC_ENV` (auto-set by systemd unit to `staging`) — surfaces via
  `/api/health.environment`. Used by the `staging-uptime.yml` probe to
  guard against nginx misroute.
- `NEXT_PUBLIC_STAGING_BANNER` — when `1`, future versions of the UI
  can render a top banner so QA can't confuse staging with prod.
  Currently informational; no UI consumer yet.

## Maintenance rule

Do not reintroduce production hostnames, server IPs, private SSH commands,
or operator procedures into this file.
