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

## 0. Bootstrap self-check — read BEFORE touching anything

Mirror of `~/.claude/CLAUDE.md` § "Bootstrap" applied to this repo.
Don't skip this block to save tokens; the cost of skipping is the
2026-05-14 freehand session (7 PRs without `/ship` / `/codex` / `/review` /
`/document-release` — full incident in `docs/skill-pipeline.md`).

Before any non-trivial action in this repo, mentally answer:

1. Have I `Read` `~/.claude/CLAUDE.md`, `~/.claude/COMPANY.md`,
   `~/.claude/SKILLS.md`, `~/.claude/LEARNINGS.md` in this session?
   If "no, I'll rely on the system-reminder skill list" — stop, read
   them now via `Read` tool. The reminder is a triggers index, not
   the routing source-of-truth.
2. Have I `Read` this file (`AGENTS.md`) and the owner doc for what
   I'm about to touch (`ARCHITECTURE.md` / `PAYMENTS_SETUP.md` /
   `SECURITY.md` / `OPERATIONS.md` / `docs/design-system.md` for UI
   work / `docs/content-style.md` for copy work)?
3. For the work I'm about to do (plan review / code review / ship /
   debug / QA / deploy / doc sync) — which skill in `~/.claude/SKILLS.md`
   owns it? If the answer is "I'll write the prompt freehand" — that's
   the freehand failure mode caught 2026-05-14. Re-read SKILLS.md.
4. If this is a multi-PR wave: have I run `/plan-eng-review` (or
   `/autoplan`) on the plan **before** code lands? §4 below lists this
   as non-negotiable for the project.

**The freehand check** (run before EVERY non-trivial action): *"Is
there a skill for this in `~/.claude/SKILLS.md`?"* Yes → invoke via
`Skill` tool. No → proceed manually + flag the gap in `~/.team/activity.jsonl`
via `~/.team/bin/log-event claude note "freehand: <reason>"`.

The repo enforces this mechanically:

- Local: `.githooks/commit-msg` runs `scripts/skill-pipeline-check.sh`
  on every commit. Non-trivial diff (≥3 files OR ≥100 lines in
  `app/` `lib/` `tests/` `migrations/`) without a `Skill-Used:` trailer
  is refused.
- CI: `.github/workflows/skill-pipeline.yml` enforces the same per-PR
  before merge.
- Visible: `.github/pull_request_template.md` carries a checklist of
  the skill gates — fill it out per PR.
- Diagnostic: `scripts/session-audit.sh --since "2 hours ago"` reads
  `~/.team/activity.jsonl` + recent commits and reports skill-gate
  drift. Use it before closing a multi-PR session.

See [`docs/skill-pipeline.md`](docs/skill-pipeline.md) for the trailer
format, threshold, exceptions, and how to add the guardrail to a new
project.

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
| `docs/design-system.md` | Apple-HIG token palette + type scale + spacing + radii + motion + primitive components. **Mandatory read before any UI change in admin / cabinet / auth shells.** New colors, shadows, radii must use the documented tokens; introducing a one-off `rgba(...)` or hex that doesn't fit the scale = doc drift. |
| `docs/content-style.md` | Russian copy style guide: tone rules, audience matrix (учащийся / учитель / оператор), forbidden-words glossary (40+ entries), microcopy patterns, admin menu rename proposal. **Mandatory read before any user-visible Russian string change.** The glossary is authoritative — don't introduce «Реконсилиация» / «Webhook» / «Слот» as user-visible text. |

If your diff touches `lib/payments/` and you did not update
`ARCHITECTURE.md` or `PAYMENTS_SETUP.md`, you did not finish.
If your diff touches a UI surface and you did not check `docs/design-system.md`, you did not finish.
If your diff edits user-visible Russian copy and you did not check `docs/content-style.md` for forbidden words, you did not finish.

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
| Touch `docs/private/`, `*.private.*`, or concrete prod host/path metadata in tracked files | Hard stop. Keep it out of git; `scripts/public-surface-check.sh` is the mechanical guardrail. |
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

### Skill routing — non-negotiable for this project

The original four rules below were set after the 2026-05-07 Wave 1+2
adversarial-review session. The 2026-05-14 BCS-E/F/HARDEN/BUG-2/3
session (7 PRs shipped freehand without `/ship` / `/codex` skill / `/review` /
`/document-release`) added the next four — they cover the lifecycle
gaps the first four didn't reach. The whole set is now mechanically
enforced via `docs/skill-pipeline.md`.

The skills are listed in `~/.claude/SKILLS.md`; invoke via the `Skill`
tool, not ad-hoc Bash. Each rule names a concrete moment in the
workflow and the gstack skill that owns it.

| When | Skill | Why this rule exists |
|---|---|---|
| **Plan/doc agreement BEFORE implementing an EPIC** | **`/codex-paranoia plan <epic-plan-file>`** | **MANDATORY** at epic level (per `~/.claude/CLAUDE.md §Two-checkpoint paranoia pipeline`). Runs ONCE before the first sub-PR of the epic; sub-PRs inherit this SIGN-OFF — no per-sub-PR plan-mode pass. Hard cap 3 rounds; all BLOCKERs close before code. |
| **EPIC-end code review** | **`/codex-paranoia wave <epic-commit-range>`** | **MANDATORY** at the END of the epic, on the AGGREGATED diff of all sub-PRs after they're merged to main. Final epic-close PR commit body carries `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <range>)`. BLOCKERs surfacing here land as follow-up fix-PRs. Trade-off: shifted-right detection in exchange for ~2× Codex token savings vs per-sub-PR paranoia. |
| **Sub-PR inside an already-planned epic** | manual diff pass + `npm run test:integration` + `npm run build` | Claude self-reviews each sub-PR; Codex not called. Sub-PR commit body carries `Codex-Paranoia: SUB-WAVE self-reviewed (epic <name>); epic-end review pending` trailer. Missing trailer = process violation. |
| **Standalone one-PR epic (no sub-waves)** | `/codex-paranoia plan` + `/codex-paranoia wave` on the same PR | Small functional units that fit in a single PR still run both checkpoints, just collapsed. Trailer matches the SIGN-OFF format without the epic-end qualifier. |
| **Before any epic that spans more than two PRs** | `/plan-eng-review` (then `/codex-paranoia plan`) | Independent eng-manager pass on the plan **before** code lands. `/plan-eng-review` is the human-mentor pass; `/codex-paranoia plan` is the Codex pass — both happen on substantive epic plans. 10 minutes saves a hotfix. |
| **Before merging any PR that touches `lib/payments/` or `lib/security/`** | `/review` | Goes deeper than `public-surface` + `build` — checks SQL safety, LLM trust boundary violations, conditional side-effects. CI runs the mechanical gates; `/review` runs the structural ones. |
| **After every prod deploy with a route-level change** | `/qa` (or `/qa-only` if read-only) | Browser-driven regression check. `post-deploy-smoke.sh` covers status-code shape; `/qa` covers actual flows (registration → verify-email → cabinet, checkout → 3DS → /thank-you). The Resend-sandbox-from issue would have surfaced here on day one. |
| **For any second-opinion / adversarial review (one-off, not pipeline)** | `/codex` | Self-review has a known conflict-of-interest; Codex is the independent counterweight. Invoke via `Skill('codex', ...)`, not via raw `Bash('codex exec ...')`. For the two pipeline checkpoints (plan / post-wave), use `/codex-paranoia` instead. |
| **For collecting + pushing every non-trivial PR** | `/ship` | Branch detect, tests, VERSION bump, CHANGELOG voice polish, commit, push, PR creation, base-branch sync — in one structured pass. Hand-rolled `gh pr create` lost VERSION/CHANGELOG hygiene across 7 PRs on 2026-05-14. Use this even when the PR is simple. |
| **Post-merge on every non-trivial PR** | `/document-release` | Sync of README / ARCHITECTURE / PAYMENTS_SETUP / SECURITY / OPERATIONS / CLAUDE.md / CHANGELOG to the diff. Drift = real bug per `~/.claude/COMPANY.md` § Doc maintenance. Not "follow-up" — same session. |
| **Post-merge with route-level change** | `/land-and-deploy` | Merge + wait for CI + wait for autodeploy + canary verify. Replaces hand-rolled `gh pr merge` + manual `curl /api/healthz`. |
| **Whenever you'd hand-write a debug prompt for a bug / 500 / regression / flaky test** | `/investigate` | 4-phase root-cause loop. **NEVER** start a debug session with file `Read`s + ad-hoc `Grep` + theory. Both flaky-test fixes on 2026-05-13/14 (`refunds.test.ts`, `nearFutureBusinessBandIso`) should have entered via this skill. |
| **At session end after shipping ≥1 wave** | `/learn` + `/document-release` + `/context-save` | `/learn` captures cross-PR patterns; `/document-release` syncs docs; `/context-save` writes a handoff snapshot so the next session (yours or Codex's) doesn't rediscover everything. Without these, learnings die at the session boundary. |

These rules are mandatory, not advisory. Skipping them is a process
debt that surfaces as a Sentry alert at midnight or as the
"оверфит на конкретную задачу, проиграл стратегически" failure mode
caught on 2026-05-14. If a step is inapplicable (e.g. doc-only PR
doesn't need `/qa`), say so explicitly in the PR description AND in
the `Skill-Used:` commit trailer; don't quietly drop the gate.

The reciprocal: do NOT call code-writing skills (`/qa`, `/investigate`,
`/design-review`) on a problem you already understand and can fix in
under 15 minutes — they add coordination cost. The point is to
delegate the work that benefits from a structured pass, not every
keystroke. The `Skill-Used: trivial` exemption in the commit trailer
exists for exactly this case.

### Session-end checklist (run before closing the conversation)

On any session that shipped ≥1 PR — before logging off:

1. `/document-release` — sweep README / ARCHITECTURE / docs / CHANGELOG
   for drift introduced by the wave.
2. `/learn` — capture per-project + promotable cross-project findings.
3. `/context-save` — snapshot for the next session.
4. `bash scripts/session-audit.sh --since "<session start>"` —
   confirm every non-trivial commit carries the trailer.
5. `~/.team/bin/log-event claude complete "<one-line summary>" --tags wave-shipped` —
   handoff record for Codex / future Claude.

The four-step closing protocol is cheap and catches the "drift in
docs / lost learnings / silent freehand commit" tail every time.

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

## 7. Product-flow evals rule

If your task touches any of:

- routes, navigation, role access, redirects, layouts
- learner / teacher / admin dashboard pages
- booking, packages, payment, checkout, thank-you flows
- teacher / learner calendar settings
- public legal / offer / privacy surfaces

Then BEFORE writing code:

1. Read [`evals/PRODUCT_FLOWS.md`](evals/PRODUCT_FLOWS.md) — flow registry
   with expected URLs, allowed/forbidden redirects, required/forbidden UI
   anchors.
2. Read [`evals/URL_REDIRECT_CONTRACT.md`](evals/URL_REDIRECT_CONTRACT.md) —
   route × role × redirect contract.

If your change would alter a row in either file, **edit the registry/contract
in the same PR**. Drift between code and contract is the regression class these
files exist to prevent.

If you find a bug in route or redirect behavior:

1. Add a failing test in `tests/e2e/product-flows.spec.ts` that locks in the
   expected behavior.
2. Fix the bug only if expected behavior is clear from PRODUCT_FLOWS.md or
   URL_REDIRECT_CONTRACT.md.
3. If expected behavior is **ambiguous**, do not guess. Tag it `R-AMBIG-N` in
   URL_REDIRECT_CONTRACT.md and surface to the owner.

If a shipped page shows placeholder or wrong copy (`Скоро будет`, hardcoded
English, internal status names, etc.):

- Either rephrase per `docs/content-style.md`, or
- If the placeholder is state-aware (depends on env / DB state), add an inline
  `// content-style-allow` comment on the line above it.

Do not claim the task done unless:

- `npm run check:env-contract` passes (or its failure is unrelated and
  documented).
- `npm run check:content-style` passes (or its failure is documented as a
  state-aware exemption).
- `npm run test:e2e:product-flows` passes (when applicable for the surface
  you touched). Authenticated suite requires Docker Postgres (brought up
  automatically via `docker-compose.test.yml` + seed script). Without
  Docker, the authenticated suite skips cleanly and the public/anon suite
  still runs.
