# LevelChannel

Conversion site for one-on-one English lessons with server-side payment
integration through the CloudPayments widget.

## Current state

- stack: `Next.js 16`, `React 18`, `App Router`, `TypeScript`
- runs as a Node.js app, not as static export
- payment is already wired into UI and API
- checkout flow: agreed amount within a limit, plus e-mail, plus the CloudPayments popup widget
- before payment creation the user must confirm a separate consent on personal data processing
- default provider: `mock`
- storage backend: `file` or `postgres`
- real CloudPayments mode is enabled via `.env`
- the project has passed baseline hardening: security headers, origin checks, rate limiting, webhook signature verification

## Quickstart

1. Install dependencies:

```bash
npm install
```

2. Create `.env` based on [`.env.example`](/Users/ivankhanaev/LevelChannel/.env.example).

3. Run locally:

```bash
npm run dev
```

4. Production build:

```bash
npm run build
npm run start
```

## Environment variables

Minimum set:

- `PAYMENTS_PROVIDER=mock|cloudpayments`
- `PAYMENTS_STORAGE_BACKEND=file|postgres`
- `PAYMENTS_STORAGE_FILE=payment-orders.json`
- `PAYMENTS_MOCK_AUTO_CONFIRM_SECONDS=20`
- `PAYMENTS_ALLOW_MOCK_CONFIRM=true|false`
- `NEXT_PUBLIC_SITE_URL=http://localhost:3000`
- `DATABASE_URL=postgresql://...`
- `TELEMETRY_HASH_SECRET=...`
- `CLOUDPAYMENTS_PUBLIC_ID=...`
- `CLOUDPAYMENTS_API_SECRET=...`
- `RESEND_API_KEY=...` (transactional email; empty → console fallback in dev; **boot fails in prod if empty**)
- `EMAIL_FROM="LevelChannel <noreply@levelchannel.ru>"`
- `AUTH_RATE_LIMIT_SECRET=...` (HMAC key for per-email rate-limit scopes; 32+ chars; **boot fails in prod if empty**)

## Main routes

Pages:

- `/`
- `/offer`
- `/privacy`
- `/consent/personal-data`
- `/thank-you`

Payment API:

- `POST /api/payments`
- `GET /api/payments/[invoiceId]`
- `POST /api/payments/mock/[invoiceId]/confirm`
- `POST /api/payments/webhooks/cloudpayments/check`
- `POST /api/payments/webhooks/cloudpayments/pay`
- `POST /api/payments/webhooks/cloudpayments/fail`

## Documentation

- [DOCUMENTATION.md](/Users/ivankhanaev/LevelChannel/DOCUMENTATION.md): documentation map, ownership, what to read first
- [ARCHITECTURE.md](/Users/ivankhanaev/LevelChannel/ARCHITECTURE.md): file-by-file code map
- [OPERATIONS.md](/Users/ivankhanaev/LevelChannel/OPERATIONS.md): server location, deploy, git, DB, runbook
- [SECURITY.md](/Users/ivankhanaev/LevelChannel/SECURITY.md): hardening and threat model
- [PAYMENTS_SETUP.md](/Users/ivankhanaev/LevelChannel/PAYMENTS_SETUP.md): CloudPayments, one-click, 3DS, health
- [AGENTS.md](/Users/ivankhanaev/LevelChannel/AGENTS.md): operating guide for AI agents
- [ROADMAP.md](/Users/ivankhanaev/LevelChannel/ROADMAP.md): high-level priorities
- [ENGINEERING_BACKLOG.md](/Users/ivankhanaev/LevelChannel/ENGINEERING_BACKLOG.md): engineering task queue
- [PRD.md](/Users/ivankhanaev/LevelChannel/PRD.md): historical product doc of the first version
- [migrations/README.md](/Users/ivankhanaev/LevelChannel/migrations/README.md): format and rules for SQL migrations

## Things worth keeping in mind

- file storage stays as a fallback mode; the production target backend is now `PostgreSQL`
- the live CloudPayments flow already runs on the VPS, and prod is updated by a git-based autodeploy on the server tracking `origin/main`
- mock confirm must stay disabled in production
