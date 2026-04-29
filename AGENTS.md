# AGENTS.md — LevelChannel project entry

> Cross-project principles, user profile, skill routing baseline,
> auto-memory protocol, model selection, token economy и общая
> discipline (output style, code style, tool discipline, confusion
> protocol, three-strike, completion status, доc maintenance rule)
> живут в `~/.claude/COMPANY.md` (loaded automatically per
> `~/.claude/CLAUDE.md` bootstrap).
>
> Этот файл — **только LevelChannel-specific layer**: payment domain
> anti-patterns, risk table for production-money work, vitest test
> discipline, project anchors, doc layer table, deploy posture.

## 1. Doc layer (LevelChannel-specific)

The general doc-maintenance rule (`rg`-sweep, drift = real bug) is in
`~/.claude/COMPANY.md`. LevelChannel has a flat doc taxonomy:

| File | Carries |
|---|---|
| `README.md` | Stack overview, quick-start, env vars, deploy stance. Always-loaded entry point. |
| `DOCUMENTATION.md` | Documentation map. Which doc owns which topic, what to read first, where duplication is forbidden. |
| `ARCHITECTURE.md` | File-by-file responsibilities. Frontend, payment domain, security layer, API routes. Update when a file moves or its responsibility changes. |
| `SECURITY.md` | Hardening checklist + threat model + open items. Update when a security boundary moves. |
| `PAYMENTS_SETUP.md` | Mock vs real CloudPayments switch, env vars, webhook URL setup. Update when the payment integration contract changes. |
| `OPERATIONS.md` | Production infrastructure, deploy, server, DB, rollback, retention, incident runbook. |
| `ROADMAP.md` | Outcome-level priorities. Product, operations, compliance. No low-level implementation queue here. |
| `ENGINEERING_BACKLOG.md` | Concrete engineering queue. System tasks that are not yet shipped. |
| `PRD.md` | Historical first-version landing PRD. Treat as audit trail; don't decide current behaviour from this. |

If your diff touches `lib/payments/` and you didn't update `ARCHITECTURE.md` or `PAYMENTS_SETUP.md`, you didn't finish.

## 2. Risk discipline (LevelChannel — production money)

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
| Force-push, hard-reset, branch deletion | Confirm + explain why this and not a safer alternative. |
| `rm -rf`, `git reset --hard`, `--no-verify` | Hard stop. Need explicit user authorization for this specific action. |
| Modify shared infra, send messages, post comments | Confirm. |

When you encounter unfamiliar files, branches, or state — investigate first. Don't delete to make the obstacle go away.

## 3. Test discipline

Vitest (`tests/`, configured in `vitest.config.ts`). Real money is moving through this code, so the bar is high.

- **Run `npm run test:run` before claiming any payment-domain or security-layer change is done.** TypeScript-only checks don't prove HMAC verification is correct, only that the types line up.
- **`npm run test:coverage` enforces 70% lines / branches / functions / statements** on the load-bearing modules listed in `vitest.config.ts`. If you drop below the threshold, the run fails — fix it in the same diff, don't promise a follow-up.
- **What earns a unit test:** anything in `lib/payments/`, `lib/security/`, `lib/telemetry/`, `lib/auth/` that is pure or can be made pure with a mock — HMAC verify, amount/email validation, token extraction + consent reading, rate limiter edges, idempotency key validation, CloudPayments API client (with mocked `fetch`), invoice id regex, password hashing, single-use token generation.
- **What stays integration:** `store-postgres.ts`, `idempotency-postgres.ts`, `store-file.ts`, route handlers themselves. These need a live Postgres or temp FS. Excluded from coverage thresholds. Phase 1B introduces `npm run test:integration` against Docker Postgres.
- **Always-on signals before merge:** `npm run test:run` (green), `npm run build` (green), and a manual click-through of the affected payment flow against `PAYMENTS_PROVIDER=mock`. Never test against the real CloudPayments terminal from a feature branch.
- **Coverage is not the goal — boundary correctness is.** A 100%-covered HMAC verifier that signs the wrong bytes is worse than a 60%-covered one with a precise regression test for the exact CP wire format.

## 4. Project anchors

This is **LevelChannel** — production payment site for ИП Фирсова Анастасия Геннадьевна's English-tutoring business, with server-side CloudPayments integration. Real money flows through this code.

### Stack

- Next.js 16 (App Router), React 18, TypeScript, Tailwind
- Runtime: Node.js (NOT static export — there are server routes)
- Default payment provider: `mock`. Real provider: `cloudpayments`, switched via `.env`.

### Source-of-truth docs (read before changing the area they own)

| Doc | When to read |
|---|---|
| `README.md` | First-time orienting. Stack, quick-start, env vars. |
| `DOCUMENTATION.md` | Before trusting any doc — check who owns the topic. |
| `OPERATIONS.md` | Before any deploy / restart / DB op / log dive. Where the server is, how a commit reaches prod, runbook for common ops, incident playbook. |
| `ARCHITECTURE.md` | Before any structural change. File-by-file map. |
| `SECURITY.md` | Before any change to `lib/security/`, `next.config.js`, webhook handling, or rate limiting. |
| `PAYMENTS_SETUP.md` | Before changing the payment provider switch, env-var contract, or webhook URL setup. |
| `ROADMAP.md` | Outcome-level priorities. |
| `ENGINEERING_BACKLOG.md` | Implementation queue. |
| `PRD.md` | **Historical.** Don't decide current behaviour from this. |

### Critical paths

- **Payment domain:** `lib/payments/`
  - `catalog.ts` — server-side amount + email validation. Authority for "is this amount legal".
  - `config.ts` — env config + **production assertions at module load** (NEXT_PUBLIC_SITE_URL must be real, CP creds must be set, mock confirm must be off). Never relax these without explicit ask.
  - `provider.ts` — orchestration: `createPayment`, `markOrderPaid/Failed/Cancelled`, `chargeWithSavedCard` (one-click).
  - `cloudpayments.ts` — server-side order + widget intent (`tokenize` flag honours user's `rememberCard` consent).
  - `cloudpayments-webhook.ts` — HMAC-verified parsing (`base64(HMAC-SHA256(rawBody, ApiSecret))` over **raw** body), plus order validation (amount, AccountId, Email match).
  - `cloudpayments-api.ts` — server-to-server HTTP client for `POST /payments/tokens/charge` (HTTP Basic, `Public ID : API Secret`). Branches: success / requires_3ds / declined / error.
  - `tokens.ts` — extracts CardLastFour/CardType/Token from webhook, reads `rememberCard` consent from order metadata (with Data / JsonData fallback), persists token only when consented.
  - `mock.ts` — mock provider (development only).
  - `store.ts` / `store-postgres.ts` / `store-file.ts` — adapter + backends for orders AND saved card tokens.
- **Security layer:** `lib/security/`
  - `request.ts` — origin checks, invoice id validation (`/^lc_[a-z0-9_]{8,48}$/i`), rate limiting wrapper.
  - `rate-limit.ts` — in-memory per-IP limiter (single-process; multi-instance deploy needs shared backend, see ENGINEERING_BACKLOG).
  - `idempotency.ts` + `idempotency-postgres.ts` — request dedup by `Idempotency-Key` header for money-moving routes (`/api/payments`, `/api/payments/charge-token`). 5xx responses are NOT cached so transient infra failures stay retriable.
- **Telemetry:** `lib/telemetry/`
  - `store.ts` — privacy-friendly checkout event log (HMAC-hashed e-mail via `TELEMETRY_HASH_SECRET`, /24-masked IP). Postgres primary, file fallback if DB write fails.
- **Auth foundation (Phase 1A — backend lib only, no routes/UI yet):** `lib/auth/`
  - `password.ts` — bcryptjs cost=12. Don't drop the cost without an explicit change-of-policy.
  - `tokens.ts` — random 32B base64url + sha256. Plain tokens never persisted. Single-use enforced at consume time inside a row lock.
  - `policy.ts` — password policy (8..128 chars, not all-digits).
  - `accounts.ts`, `sessions.ts`, `single-use-tokens.ts`, `verifications.ts`, `resets.ts` — store ops. Emails are normalized via `normalizeAccountEmail()` (`trim().toLowerCase()`) at the application layer; DB has CHECK constraint `accounts_email_normalized` as defense in depth.
  - When Phase 1B routes land, they MUST: rate-limit + origin-check every mutation; revoke all active sessions on successful password reset; return identical "we sent a link if the email exists" for register and reset-request to avoid enumeration.
- **Email transport:** `lib/email/`
  - `client.ts` — Resend SDK; falls back to `console.log` when `RESEND_API_KEY` is empty. The fallback is a dev convenience — Phase 1B will add a production assertion that fails boot when key is empty under `NODE_ENV=production`.
  - `escape.ts` — HTML escape for inline templates. Defense in depth.
  - `templates/{verify,reset}.ts` — plain HTML + plain text, RU.
  - `dispatch.ts` — `sendVerifyEmail`, `sendResetEmail`. URLs built from `paymentConfig.siteUrl`.
- **API routes:** `app/api/`
  - `payments/` — create, status, cancel, events
  - `payments/saved-card/` — POST = lookup, DELETE = forget (opt-out)
  - `payments/charge-token/` — one-click charge by saved token
  - `payments/webhooks/cloudpayments/{check,pay,fail}/` — CP callbacks
- **Checkout UI:** `components/payments/pricing-section.tsx`
- **Public legal pages:** `app/offer/page.tsx`, `app/privacy/page.tsx`, `app/consent/personal-data/page.tsx`

### Commands

| Purpose | Command |
|---|---|
| Install | `npm install` |
| Dev server | `npm run dev` |
| Production build (with postbuild) | `npm run build` |
| Production server | `npm run start` |
| Lint | `npm run lint` |
| Tests (watch) | `npm run test` |
| Tests (CI) | `npm run test:run` |
| Tests + coverage gate | `npm run test:coverage` |
| TypeScript-only check | `npx tsc --noEmit` |
| Apply pending schema migrations | `npm run migrate:up` |
| Show schema migration status | `npm run migrate:status` |
| One-shot file → Postgres data import (legacy) | `npm run migrate:payments:postgres` |

### Deploy posture

This is **production with real money.** The bar:

- `PAYMENTS_PROVIDER=cloudpayments` and `PAYMENTS_STORAGE_BACKEND=postgres` in production env.
- `PAYMENTS_ALLOW_MOCK_CONFIRM` must be unset — `lib/payments/config.ts` throws on boot if it's `true` under `NODE_ENV=production`.
- `NEXT_PUBLIC_SITE_URL` must be the real https URL — config validates this when provider=cloudpayments in prod.
- CloudPayments webhooks (`Pay`, `Check`, `Fail`) point at the real domain in the CP cabinet, terminal is in live mode, kassa sends receipts.
- Postgres carries the payment tables (`payment_orders`, `payment_card_tokens`, `payment_telemetry`, `idempotency_records`) AND the auth-foundation tables (`accounts`, `account_roles`, `account_sessions`, `email_verifications`, `password_resets`). The schema source of truth is `migrations/NNNN_*.sql`, applied via `npm run migrate:up`. Legacy `ensureSchema*` paths in `lib/{payments,security,telemetry}/*-postgres.ts` still create the payment tables on first use as a safety net; auth tables exist only through migrations (no `ensureSchema*` for them — the runner is authoritative).
- Resend env: `RESEND_API_KEY` + `EMAIL_FROM`. Empty key is a console fallback (acceptable for dev, NOT for prod once routes ship).
- Backup + retention plan is the operator's responsibility (`OPERATIONS.md §5`).

When shipping a payment-domain or security-layer change to this production system, the bar is: tests green, build green, manual mock checkout walked, doc sweep done, and you'd bet your own money on the diff being correct.

## 5. One-click / token payments (152-FZ-aware)

CloudPayments returns a `Token` on every successful payment when the terminal is configured to support it. **Saving that token is opt-in, not opt-out** — `pricing-section.tsx` shows an unchecked checkbox "Запомнить карту" and only when it's checked do we tokenize:

1. Frontend sends `rememberCard: true` to `/api/payments`.
2. Server stamps `metadata.rememberCard = true` on the order (`createCloudPaymentsOrder`).
3. Widget intent passes both `tokenize: true` AND `metadata.rememberCard: true` so CP knows to issue a token AND echoes the consent back.
4. Pay-вебхук reads consent from order metadata first (our source of truth), falls back to `Data` / `JsonData` in the payload.
5. Token saved to `payment_card_tokens` only when consent is true.
6. User can delete the token any time via DELETE `/api/payments/saved-card`.

If you change anything in this chain, walk through the flow with the checkbox both checked and unchecked. The default — never save without explicit consent — is a hard requirement, not a preference.

3-D Secure for one-click is fully implemented. When CP returns `AcsUrl + PaReq`, the route persists `metadata.threeDs` on the order and returns `{ status: 'requires_3ds', threeDs: { acsUrl, paReq, transactionId, termUrl } }`. The UI builds and submits a hidden `<form method="POST" action="acsUrl">` with `PaReq`, `MD`, `TermUrl`. The bank's ACS POSTs back to `/api/payments/3ds-callback?invoiceId=...` which calls CloudPayments `/payments/cards/post3ds` and 303-redirects the user to `/thank-you` (success) or the home page with `?payment=failed` (decline).

If you change anything in the 3DS chain — `cloudpayments-api.ts` (`confirmThreeDs`), `provider.ts` (`confirmThreeDsAndFinalize`), `/api/payments/3ds-callback/route.ts`, or the form-submit helper in `pricing-section.tsx` — verify every branch (success, decline, error, unknown invoice, invalid state, double callback). The bank may POST twice (browser back, retry) and we must not double-charge or double-fail.

## 6. Idempotency (money-moving routes)

`/api/payments` and `/api/payments/charge-token` accept an `Idempotency-Key` header. Frontend sends a fresh UUID per submit. Backend dedupes via `idempotency_records` table.

- Replays return the **cached** response with `Idempotency-Replay: true`.
- Same key + different body → 409.
- 5xx responses are not cached — transient infra failures must stay retriable.
- File backend ignores idempotency cache (single-process, low value).

If you add another money-moving route, wrap it in `withIdempotency` and pick a stable scope name. Never trust the client's word that the same amount/email means "this is a retry".

## 7. Anti-patterns to avoid (LevelChannel-specific)

- **Don't trust the client on amount or email.** The client supplies both, the server validates against `lib/payments/catalog.ts`, and the amount the client *wanted* never decides what gets charged. Existing code respects this — don't loosen it.
- **Don't run mock confirm in production.** `PAYMENTS_ALLOW_MOCK_CONFIRM` must be unset in real prod. The default in code is the safe one; don't add a code path that flips it without an explicit gate.
- **Don't switch the payment provider in committed files.** The default in `.env.example` is `mock`; the real value lives only in deployment env vars. Never set `PAYMENTS_PROVIDER=cloudpayments` in any committed file.
- **Don't lose the security headers.** `next.config.js` carries CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy. If you're touching that file, read `SECURITY.md` first; understand what each header is buying before relaxing it.
- **Don't tokenize a card without explicit user consent.** The default is `rememberCard=false`. `tokens.ts` enforces this on the webhook side; do not weaken `readRememberCardConsent`. If the user didn't tick the box, even if CP sent a Token, we drop it.
- **Don't bypass `withIdempotency` on money-moving routes.** If you add a new route that creates an order or charges a card, wrap it. Frontend retries are normal; double-charges are not.
- **Don't change the HMAC verification path** (`cloudpayments-webhook.ts`) without updating the regression tests in `tests/payments/cloudpayments-webhook.test.ts`. The exact wire format is `base64(HMAC-SHA256(rawBody, ApiSecret))` over **raw** bytes — no re-encoding, no decoding, no JSON-vs-form branching for signature input.
- **Don't email-normalize with `.toLowerCase()` alone.** Use `normalizeAccountEmail()` (`trim().toLowerCase()`). Trailing-whitespace duplicates create shadow accounts. DB CHECK constraint `accounts_email_normalized` catches bypasses.
- **Don't cut the `ARCHITECTURE.md` file map.** Every file added or moved goes in. Without it, the next agent has to re-discover the structure from scratch.

## 8. Final test (LevelChannel bar)

For payment-domain or security-layer work specifically: **would you bet your own money on this code path being correct?** If not, slow down and verify.
