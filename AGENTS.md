# AGENTS.md: LevelChannel project entry

> Cross-project principles, user profile, skill routing baseline,
> auto-memory protocol, model selection, token economy, and shared
> discipline (output style, code style, tool discipline, confusion
> protocol, three-strike, completion status, doc-maintenance rule)
> live in `~/.claude/COMPANY.md` (loaded automatically per
> `~/.claude/CLAUDE.md` bootstrap).
>
> This file is the **LevelChannel-specific routing and hard-stop layer
> only**: doc ownership, production-money risk table, test bar, task
> routing, local anti-patterns. File-by-file architecture, payment
> contract, security boundary, and ops runbook live in the topic-
> specific owner docs.

## 1. Doc layer (LevelChannel-specific)

The general doc-maintenance rule (`rg`-sweep, drift = real bug) is in
`~/.claude/COMPANY.md`. LevelChannel uses a flat doc taxonomy:

| File | Carries |
|---|---|
| `README.md` | Stack overview, quickstart, env vars, deploy stance. Always-loaded entry point. |
| `DOCUMENTATION.md` | Documentation map. Which doc owns which topic, what to read first, where duplication is forbidden. |
| `ARCHITECTURE.md` | File-by-file responsibilities. Frontend, payment domain, security layer, API routes. Update when a file moves or its responsibility changes. |
| `SECURITY.md` | Hardening checklist plus threat model plus open items. Update when a security boundary moves. |
| `PAYMENTS_SETUP.md` | Mock vs real CloudPayments switch, env vars, webhook URL setup. Update when the payment integration contract changes. |
| `OPERATIONS.md` | Production infrastructure, deploy, server, DB, rollback, retention, incident runbook. |
| `ROADMAP.md` | Outcome-level priorities. Product, operations, compliance. No low-level implementation queue here. |
| `ENGINEERING_BACKLOG.md` | Concrete engineering queue. System tasks not yet shipped. |
| `PRD.md` | Public-safe note that points to the private historical PRD. Do not decide current behaviour from it. |

If your diff touches `lib/payments/` and you did not update
`ARCHITECTURE.md` or `PAYMENTS_SETUP.md`, you did not finish.

## 2. Risk discipline (LevelChannel: production money)

Project-specific elaboration of the company-level [SAFETY] guardrails.

| Action | What to do |
|---|---|
| Local edits, reads, builds, lint, dev server | Just do them. |
| Edit files outside `lib/payments/` and `lib/security/` | Just do them. |
| Edit files inside `lib/payments/` or `lib/security/` | Read the surrounding contract first. Trace the call sites. State the change before writing it. |
| Create branches, commits | Just do them. |
| Open PRs, push to remote | Confirm if not explicitly authorized. |
| Touch `.env`, `.env.local`, anything with real secrets | Hard stop. Never commit secrets. Read-only by default; ask before editing. |
| Switch `PAYMENTS_PROVIDER` to `cloudpayments` in any committed file | Hard stop. The default in `.env.example` is `mock` for a reason. |
| `PAYMENTS_ALLOW_MOCK_CONFIRM=1` in any production-bound file | Hard stop. This must be unset in real prod. |
| Force-push, hard-reset, branch deletion | Confirm and explain why this and not a safer alternative. |
| `rm -rf`, `git reset --hard`, `--no-verify` | Hard stop. Need explicit user authorization for this specific action. |
| Modify shared infra, send messages, post comments | Confirm. |

When you encounter unfamiliar files, branches, or state, investigate
first. Do not delete to make the obstacle go away.

### Legal-pipeline guardrail

Any change that touches public legal text (`app/offer/`,
`app/privacy/`, `app/consent/`) or the server-side legal SoT
(`lib/legal/`, `docs/legal/`) must flow through
`legal-rf-router → profile skill → legal-rf-qa` (company rule,
`~/.claude/CLAUDE.md` § legal-rf), and the commit must carry a
`Legal-Pipeline-Verified:` trailer. The hook in `.githooks/commit-msg`
and the CI workflow in `.github/workflows/legal-pipeline.yml` enforce
this mechanically. See [`docs/legal-pipeline.md`](docs/legal-pipeline.md)
for the marker format, the protected scope, and how to add a new
legal path.

## 3. Test discipline

Vitest (`tests/`, configured in `vitest.config.ts`). Real money flows
through this code, so the bar is high.

- **Run `npm run test:run` before claiming any payment-domain or security-layer change is done.** TypeScript-only checks do not prove HMAC verification is correct, only that the types line up.
- **`npm run test:coverage` enforces 70% lines / branches / functions / statements** on the load-bearing modules listed in `vitest.config.ts`. If you drop below the threshold, the run fails. Fix it in the same diff; do not promise a follow-up.
- **What earns a unit test:** anything in `lib/payments/`, `lib/security/`, `lib/telemetry/`, `lib/auth/` that is pure or can be made pure with a mock. HMAC verify, amount and email validation, token extraction plus consent reading, rate limiter edges, idempotency key validation, CloudPayments API client (with mocked `fetch`), invoice id regex, password hashing, single-use token generation.
- **What stays integration:** `store-postgres.ts`, `idempotency-postgres.ts`, `store-file.ts`, route handlers themselves. These need a live Postgres or temp FS. Excluded from coverage thresholds. `npm run test:integration` exercises the auth and Postgres path against Docker Postgres.
- **Always-on signals before merge:** `npm run test:run` (green), `npm run build` (green), and a manual click-through of the affected payment flow against `PAYMENTS_PROVIDER=mock`. Never test against the real CloudPayments terminal from a feature branch.
- **Coverage is not the goal: boundary correctness is.** A 100%-covered HMAC verifier that signs the wrong bytes is worse than a 60%-covered one with a precise regression test for the exact CP wire format.

## 4. Project anchors

This is **LevelChannel**: a production payment site for the
English-tutoring business of IE Firsova Anastasia Gennadievna, with
server-side CloudPayments integration. Real money flows through this
code.

### Stack

- Next.js 16 (App Router), React 18, TypeScript, Tailwind.
- Runtime: Node.js (not a static export; there are server routes).
- Default payment provider: `mock`. Real provider: `cloudpayments`, switched via `.env`.

### Task routing

- File map, runtime flow, subsystem ownership: `ARCHITECTURE.md`.
- Payment contract, env contract, webhooks, one-click, 3DS, idempotency: `PAYMENTS_SETUP.md`.
- Security boundaries, auth invariants, HMAC, headers, rate limiting: `SECURITY.md`.
- Deploy, server, DB, logs, backups, rollback, incident response: `OPERATIONS.md`.

Read the owner doc before touching:

- `lib/payments/`, `app/api/payments/*`, `components/payments/*`
- `lib/security/`, `next.config.js`, webhook handlers
- `lib/auth/`, `lib/email/`, `app/api/auth/*`
- anything production-bound or server-facing

### Deploy posture

This is **production with real money.** The bar:

- `PAYMENTS_PROVIDER=cloudpayments` and `PAYMENTS_STORAGE_BACKEND=postgres` in production env.
- `PAYMENTS_ALLOW_MOCK_CONFIRM` must be unset. `lib/payments/config.ts` throws on boot if it is `true` under `NODE_ENV=production`.
- `NEXT_PUBLIC_SITE_URL` must be the real https URL. Config validates this when provider=cloudpayments in prod.
- Migrations are authoritative via `migrations/NNNN_*.sql` and `npm run migrate:up`.
- Read `OPERATIONS.md` before any deploy, rollback, DB change, log dive, or prod incident step.

When shipping a payment-domain or security-layer change to this
production system, the bar is: tests green, build green, manual mock
checkout walked, doc sweep done, and you would bet your own money on
the diff being correct.

## 5. Anti-patterns to avoid (LevelChannel-specific)

- **Do not trust the client on amount or email.** The client supplies both, the server validates against `lib/payments/catalog.ts`, and the amount the client *wanted* never decides what gets charged. Existing code respects this; do not loosen it.
- **Do not run mock confirm in production.** `PAYMENTS_ALLOW_MOCK_CONFIRM` must be unset in real prod. The default in code is the safe one; do not add a code path that flips it without an explicit gate.
- **Do not switch the payment provider in committed files.** The default in `.env.example` is `mock`; the real value lives only in deployment env vars. Never set `PAYMENTS_PROVIDER=cloudpayments` in any committed file.
- **Do not tokenize a card without explicit user consent.** The default is `rememberCard=false`. `tokens.ts` enforces this on the webhook side; do not weaken `readRememberCardConsent`. If the user did not tick the box, even if CP sent a Token, we drop it.
- **Do not bypass `withIdempotency` on money-moving routes.** If you add a new route that creates an order or charges a card, wrap it. Frontend retries are normal; double-charges are not.
- **Do not change the HMAC verification path** (`cloudpayments-webhook.ts`) without updating the regression tests in `tests/payments/cloudpayments-webhook.test.ts`. The exact wire format is `base64(HMAC-SHA256(rawBody, ApiSecret))` over **raw** bytes: no re-encoding, no decoding, no JSON-vs-form branching for signature input.
- **Do not email-normalize with `.toLowerCase()` alone.** Use `normalizeAccountEmail()` (`trim().toLowerCase()`). Trailing-whitespace duplicates create shadow accounts. DB CHECK constraint `accounts_email_normalized` catches bypasses.
- **Do not cut the `ARCHITECTURE.md` file map.** Every file added or moved goes in. Without it, the next agent has to re-discover the structure from scratch.

## 6. Final test (LevelChannel bar)

For payment-domain or security-layer work specifically: **would you bet
your own money on this code path being correct?** If not, slow down
and verify.
