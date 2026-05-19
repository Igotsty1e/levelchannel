# LevelChannel

Production: https://levelchannel.ru/

LevelChannel is a conversion site for one-on-one English lessons with a server-side payment flow and a growing account layer.

It is aimed at small education businesses that need a direct landing-to-payment funnel with legal consent capture, webhook-backed payment handling, and room for a future learner cabinet.

## Current stage

MVP, in active development.

## Problem it solves

The project combines public marketing pages, direct checkout, payment reconciliation, consent capture, and operational guardrails in one codebase. The goal is a narrow, understandable sales and payment surface rather than a broad learning platform from day one.

## What is implemented

- public site on `Next.js` with legal and consent pages
- checkout flow with `mock` and CloudPayments-backed modes
- payment creation, status polling, webhook handling, and one-click charge support
- server-side consent recording for personal-data processing
- file and Postgres storage modes
- auth, registration, verify-email, reset-password, and minimal cabinet surface
- payment audit and telemetry layers
- baseline hardening: headers, origin checks, HMAC verification, and rate limiting
- tariff catalog with mandatory lesson duration (60/90 min), price/duration immutable after first slot reference, hard-delete refused when slots reference the tariff
- booking calendar sync with Google Calendar: Calendly-style booking UI, OAuth scaffolding, two-way pull/push, post-pull conflict detector, teacher conflict resolution surface (red outline + modal actions)
- learner-facing package catalog at `/cabinet/packages` with a buy CTA, race-safe purchase gates (one pending and one already-active package of the same duration both refused under a per-(account, duration) advisory lock), and CloudPayments widget intent returned inline from the checkout-init response
- operator-driven non-money package grant via `POST /api/admin/packages/[id]/grant` with synthetic `payment_orders` rows (`provider='admin_grant'`, `status='granted'`), inline grant button in the admin packages editor, anti-stacking serialised against the learner-buy and webhook-grant paths on the shared `pkg-stack:` advisory-lock prefix, and a `granted_by_operator_id` triple-CHECK invariant in the schema
- operator observability for systemd alert probes (auth-flow, calendar-pathology, webhook-flow, conflict-unresolved) at `/admin/settings/alerts`: per-probe last-run + last-alert + effective thresholds read from probe_runs row snapshots, plus a dry-run test-send button to verify the Resend transport without waiting for a real incident

## What is intentionally private

- production server layout and deployment runbooks
- operator contacts and alert destinations
- infrastructure-specific environment values
- incident and retention procedures that belong to operations rather than the public product surface

Tracked files are guarded by `bash scripts/public-surface-check.sh`, which blocks
private runbooks, `.env` files, and known concrete production paths from
landing in git. The pre-commit hook runs the same script with `--staged`.

## High-level architecture

- `app/` contains public pages, legal pages, auth UI, teacher + cabinet surfaces, and API routes
- `components/` contains UI building blocks, including the payment + calendar surfaces
- `lib/payments/` contains payment orchestration, provider integrations, storage, and webhook logic
- `lib/auth/` and `lib/email/` contain the account layer and transactional email logic
- `lib/scheduling/` and `lib/calendar/` contain slot lifecycle, booking, Google Calendar OAuth + pull/push workers, and the post-pull conflict detector
- `lib/pricing/` and `lib/billing/` contain the tariff catalog and the package/postpaid billing layer
- `scripts/` contains operational tooling; the full production runbook is kept private

Public-facing architecture and workflow notes live in [`docs/public/ARCHITECTURE.md`](docs/public/ARCHITECTURE.md), [`docs/public/ROADMAP.md`](docs/public/ROADMAP.md), and [`docs/public/AI_WORKFLOW.md`](docs/public/AI_WORKFLOW.md).

## Quickstart

1. Install dependencies.

```bash
npm install
```

2. Create `.env` from [`.env.example`](.env.example).

3. Run locally.

```bash
npm run dev
```

4. Production build.

```bash
npm run build
npm run start
```

## Environment variables

Minimum local set:

- `PAYMENTS_PROVIDER=mock|cloudpayments`
- `PAYMENTS_STORAGE_BACKEND=file|postgres`
- `PAYMENTS_STORAGE_FILE=payment-orders.json`
- `PAYMENTS_MOCK_AUTO_CONFIRM_SECONDS=20`
- `PAYMENTS_ALLOW_MOCK_CONFIRM=true|false`
- `NEXT_PUBLIC_SITE_URL=http://localhost:3000`
- `DATABASE_URL=postgresql://...`
- `DB_SSL=require|disable` (optional; production refuses `disable` for **non-local** hosts. Auto-detect: localhost / 127.0.0.1 / ::1 / `*.local` → no TLS in any env, everything else → strict TLS with cert verify. See `lib/db/pool.ts`)
- `DB_SSL_REJECT_UNAUTHORIZED=false` (optional, **dev or local-only**; rejected in production for non-local hosts. Allows encrypted-but-lax cert verification when targeting a managed host with a self-signed cert)
- `TELEMETRY_HASH_SECRET=...`
- `CLOUDPAYMENTS_PUBLIC_ID=...`
- `CLOUDPAYMENTS_API_SECRET=...`
- `RESEND_API_KEY=...`
- `EMAIL_FROM="LevelChannel <noreply@example.com>"`
- `AUTH_RATE_LIMIT_SECRET=...`
- `TEACHER_INVITE_SECRET=...` (SAAS-3+4 TINV.1; mandatory in production; HMAC key for teacher invite tokens; ≥32 chars random; generate with `openssl rand -base64 48`. Distinct trust boundary from `AUTH_RATE_LIMIT_SECRET`. Rotation rejects outstanding invites — document blast radius before rotating.)
- `AUDIT_ENCRYPTION_KEY=...` (mandatory in production; ≥32 chars random; encrypts PII in `payment_audit_events` via pgcrypto. Generate with `openssl rand -base64 48`. **Treat as a peer of `CLOUDPAYMENTS_API_SECRET` for rotation cadence — losing it means losing every encrypted audit row.**)
- `CRON_SHARED_SECRET=...` (BCS-OP-ROLLOUT; auto-generated by `scripts/activate-prod-ops.sh` on first run when missing from `$ENV_FILE`. Used by the systemd-driven `scripts/calendar-cron.mjs` to authenticate POSTs to `/api/cron/calendar/*` over loopback. Cron routes refuse external Hosts with 404 by design — see `lib/api/cron-auth.ts`.)
- `CRON_TRUSTED_HOST=...` (optional, comma-separated; extra allow-list of non-loopback hostnames permitted through the cron-route Host gate. Defaults to loopback-only. **`scripts/calendar-cron.mjs` hardcodes the target as `127.0.0.1` — the bearer secret never traverses an external network.** This list only relaxes the app-side Host gate for on-box reverse-proxy setups; do not interpret it as permission to invoke the cron routes from another host without TLS.)

## Documentation

- [DOCUMENTATION.md](DOCUMENTATION.md): documentation map and ownership
- [ARCHITECTURE.md](ARCHITECTURE.md): internal file-by-file code map
- [AGENTS.md](AGENTS.md): AI-agent entry point, doc layer, risk discipline, skill routing
- [SECURITY.md](SECURITY.md): trust boundaries and hardening notes
- [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md): payment contract and integration notes
- [docs/design-system.md](docs/design-system.md): Apple-HIG token palette, type scale, spacing, radii, motion, primitive components. Read before any UI change.
- [docs/content-style.md](docs/content-style.md): Russian copy style guide + 40-entry forbidden-words glossary + admin menu rename proposal. Read before any user-visible string change.
- [docs/legal-pipeline.md](docs/legal-pipeline.md): mechanical guardrail for legal-RF content (commit trailer + CI gate)
- [docs/skill-pipeline.md](docs/skill-pipeline.md): mechanical guardrail for GSTACK skill discipline (commit trailer + CI gate)
- [docs/public/ARCHITECTURE.md](docs/public/ARCHITECTURE.md): public-facing system overview
- [docs/public/ROADMAP.md](docs/public/ROADMAP.md): current phase and next steps
- [docs/public/AI_WORKFLOW.md](docs/public/AI_WORKFLOW.md): AI usage boundaries
- [docs/github-readiness/](docs/github-readiness/): repository publication-prep artifacts

The detailed production runbook and the first-version historical PRD are kept outside the tracked public repository surface.

## Status

Active development.
