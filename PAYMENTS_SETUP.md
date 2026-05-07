# Payments Setup

This file describes the current payment contract in code and the
checklist for a new or repeated production environment.

## Current payment contract

- frontend is already wired to `/api/payments`
- the user enters an agreed amount within the technical checkout limit and an `e-mail`, confirms a separate consent on personal data processing, and the CloudPayments widget launches
- default provider: `mock`
- default storage backend: `file`
- real CloudPayments mode is enabled via `.env`
- the project runs on `Next.js 16`
- the mock confirm endpoint must only be used for local checks and staging

## What a new production environment needs

1. Deploy the site as a Node.js app:
   - Vercel
   - VPS plus `next start`
   - any other host with a long-lived server process
2. Fill in `.env`:
   - `PAYMENTS_PROVIDER=cloudpayments`
   - `PAYMENTS_STORAGE_BACKEND=postgres`
   - `PAYMENTS_ALLOW_MOCK_CONFIRM=false`
   - `NEXT_PUBLIC_SITE_URL=https://your-domain`
   - `DATABASE_URL=postgresql://...` (must reach Postgres over TLS unless the host is `localhost` — `lib/db/pool.ts` forces strict TLS in production)
   - `TELEMETRY_HASH_SECRET=...`
   - `CLOUDPAYMENTS_PUBLIC_ID=...`
   - `CLOUDPAYMENTS_API_SECRET=...`
   - `AUTH_RATE_LIMIT_SECRET=...` (32+ random chars; mandatory in prod)
   - `AUDIT_ENCRYPTION_KEY=...` (32+ random chars; mandatory in prod. Generate with `openssl rand -base64 48`. Encrypts `payment_audit_events.customer_email` + `client_ip` via pgcrypto. Losing this key loses every encrypted audit row — back it up alongside `CLOUDPAYMENTS_API_SECRET`)
3. In the CloudPayments cabinet, verify that the needed payment methods are enabled in the form (`bank card`, optionally `T-Pay`, others).
4. In the CloudPayments / CloudKassir cabinet, make sure the cash register is in live mode and chek e-mails are sent.
5. In the CloudPayments cabinet, set the webhooks:
   - Check: `https://your-domain/api/payments/webhooks/cloudpayments/check`
   - Pay: `https://your-domain/api/payments/webhooks/cloudpayments/pay`
   - Fail: `https://your-domain/api/payments/webhooks/cloudpayments/fail`
6. Apply the schema to the new database:

```bash
DATABASE_URL=postgres://... npm run migrate:up
```

   On an existing prod DB (where the legacy `ensureSchema*` already
   created the tables), the same command is safe: migrations `0001..0004`
   are idempotent and simply record bookkeeping in `_migrations`. See
   `migrations/README.md` for details. Migrations 0024 (webhook dedup)
   and 0025 (pgcrypto-backed audit encryption) are also idempotent and
   safe to re-run.

   After 0025 has been applied **and** `AUDIT_ENCRYPTION_KEY` is set,
   run a one-shot backfill to encrypt pre-Wave-2.1 audit rows:

   ```bash
   DATABASE_URL=postgres://... AUDIT_ENCRYPTION_KEY=... \
     node scripts/backfill-audit-encryption.mjs
   ```

   Then track the destructive Phase-B null-out in `ENGINEERING_BACKLOG.md`
   for the day after deploy (≥24h soak before wiping the plaintext columns).
7. Run a test payment.
8. Confirm the status changes through the webhook, not only through polling.
9. Confirm that the chek e-mail from CloudPayments / CloudKassir arrives.
10. If the previous environment used JSON order storage, run the one-shot data import (different from schema migrations):

```bash
npm run migrate:payments:postgres
```

The production runtime and the actual VPS runbook live in
`OPERATIONS.md`. The section below stays as a contract-level checklist
for a new environment or for re-setup.

## Things to verify before production

- Production target backend is now `PostgreSQL`.
- The path to the file store is intentionally locked to the `data/` directory so config cannot move writes to an arbitrary place on the file system.
- Cheks already rely on passing `receipt` and `receiptEmail`, but actual sending depends on CloudKassir setup in the cabinet.
- For a multi-instance deployment, the in-memory rate limiter must be replaced.
- The backup and retention plan for order storage and personal-data deletion must be recorded in `OPERATIONS.md`.

## One-click (single-click payment)

CloudPayments returns a `Token` in the Pay notification after the first
successful payment. The token is stored in the DB and bound to
`customerEmail`. On the next visit the same e-mail will see an
«Pay with card ··NNNN» button.

Server side:

1. `POST /api/payments/saved-card`: returns `{ savedCard: { cardLastFour, cardType, createdAt } | null }`. Protected by origin-check plus rate limit (10/min/IP).
2. `POST /api/payments/charge-token`: creates an order and calls `https://api.cloudpayments.ru/payments/tokens/charge` with HTTP Basic Auth (`Public ID : API Secret`). Possible client responses:
   - `{ status: 'paid', order }`: the charge succeeded; redirect to `/thank-you`.
   - `{ status: 'requires_widget', order }`: the bank required 3-D Secure; the order stays `pending`, the frontend offers the regular form.
   - `{ status: 'declined', order, message }`: declined; the order is `failed`.

In the CloudPayments cabinet, «Pay by token» / cofRecurring must be
enabled (if the terminal does not support it, `tokens/charge` returns
an error).

### 3-D Secure flow (fully implemented)

If on the first one-click charge the bank requires 3DS, the flow is:

1. CloudPayments returns `Success: false, Model: { TransactionId, AcsUrl, PaReq, ThreeDsCallbackId }`.
2. The server saves `metadata.threeDs` on the order and returns to the client `{ status: 'requires_3ds', threeDs: { acsUrl, paReq, transactionId, termUrl } }`.
3. The client builds an auto-submitting `<form method="POST" action="acsUrl">` with the fields `PaReq`, `MD=transactionId`, `TermUrl=https://site/api/payments/3ds-callback?invoiceId=...`.
4. The browser leaves to the bank window; the user confirms.
5. The bank POSTs back to `TermUrl` with form data `MD=...&PaRes=...`.
6. `app/api/payments/3ds-callback/route.ts` reads `PaRes`, calls `https://api.cloudpayments.ru/payments/cards/post3ds` (HTTP Basic), updates the order, and redirects the user 303 to `/thank-you` or to `/?payment=failed`.

### Health endpoint

`GET /api/health` returns:

- `{ status: 'ok' }` with HTTP 200: runtime alive, DB pingable, CloudPayments creds present.
- `{ status: 'degraded' }` with HTTP 503: something critical is misconfigured.

Convenient to plug into an external uptime monitor or watchdog.

## What's next

Strategic payment priorities live in `ROADMAP.md`; concrete engineering
tasks for the payment domain and observability live in
`ENGINEERING_BACKLOG.md`.
