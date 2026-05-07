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

## What is intentionally private

- production server layout and deployment runbooks
- operator contacts and alert destinations
- infrastructure-specific environment values
- incident and retention procedures that belong to operations rather than the public product surface

Tracked files are guarded by `npm run check:public-surface`, which blocks
private runbooks, `.env` files, and known concrete production paths from
landing in git.

## High-level architecture

- `app/` contains public pages, legal pages, auth UI, and API routes
- `components/` contains UI building blocks, including the payment surface
- `lib/payments/` contains payment orchestration, provider integrations, storage, and webhook logic
- `lib/auth/` and `lib/email/` contain the account layer and transactional email logic
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
- `AUDIT_ENCRYPTION_KEY=...` (mandatory in production; ≥32 chars random; encrypts PII in `payment_audit_events` via pgcrypto. Generate with `openssl rand -base64 48`. **Treat as a peer of `CLOUDPAYMENTS_API_SECRET` for rotation cadence — losing it means losing every encrypted audit row.**)

## Documentation

- [DOCUMENTATION.md](DOCUMENTATION.md): documentation map and ownership
- [ARCHITECTURE.md](ARCHITECTURE.md): internal file-by-file code map
- [SECURITY.md](SECURITY.md): trust boundaries and hardening notes
- [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md): payment contract and integration notes
- [docs/public/ARCHITECTURE.md](docs/public/ARCHITECTURE.md): public-facing system overview
- [docs/public/ROADMAP.md](docs/public/ROADMAP.md): current phase and next steps
- [docs/public/AI_WORKFLOW.md](docs/public/AI_WORKFLOW.md): AI usage boundaries
- [docs/github-readiness/](docs/github-readiness/): repository publication-prep artifacts

The detailed production runbook and the first-version historical PRD are kept outside the tracked public repository surface.

## Status

Active development.
