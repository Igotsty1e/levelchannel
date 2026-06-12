# Backend architecture and business-process audit - 2026-06-12

## Scope

This audit focused on the backend and backend-adjacent business process surface:

- build + test health
- payment, billing, scheduling, auth, cron, and operator-control boundaries
- owner docs vs actual writer/read-path shape
- whether the current architecture still fits a post-MVP product

Read first during this pass:

- `AGENTS.md`
- `README.md`
- `DOCUMENTATION.md`
- `ARCHITECTURE.md`
- `PAYMENTS_SETUP.md`
- `SECURITY.md`
- `evals/PRODUCT_FLOWS.md`
- `evals/URL_REDIRECT_CONTRACT.md`
- module contracts under `lib/{payments,billing,scheduling,calendar,security,admin}/README.md`

## Current-state snapshot

Positive signals already in place:

- Critical-path inventory exists and is explicit: `docs/critical-path.md`.
- Load-bearing modules carry local contract READMEs.
- Build is green on the current tree.
- Payment and scheduling domains already use strong DB-level invariants, advisory locks, and explicit operator runbooks.
- Product-flow contracts exist as first-class docs instead of tribal knowledge.

This is no longer an MVP-sized repo:

- `next build` currently emits a very large route surface across public, learner, teacher, admin, payments, calendar, legal, and SaaS pages.
- The architecture is still operationally a monolith, but it now contains multiple real sub-domains with different failure modes:
  - money-moving
  - entitlement/billing
  - booking/scheduling
  - calendar sync
  - auth/legal
  - reminders/digests/alert probes
  - operator/admin tooling

That is still workable, but the seams now need to be formalized more aggressively than in the original MVP phase.

## Findings

### 1. Full regression lane is unstable, and the failures are broad enough to be an architecture/process issue

Evidence:

- `npm run test:run` failed with 12 failing tests across unrelated surfaces: auth, admin, calendar, payments, teacher cabinet.
- The failures were mostly generic 5-second timeouts, not one localized business regression.
- The same tests passed when run in isolation:
  - `tests/auth/password.test.ts`
  - `tests/payments/sbp-create-qr-route.test.ts`
  - `tests/payments/pricing-section-widget-rollback.test.tsx`
  - `tests/payments/teacher-feed-prop-resync.test.tsx`

Interpretation:

- The primary problem is not "password logic is broken" or "SBP route is broken".
- The problem is that the full-suite runtime budget and orchestration are no longer reliable under the current repo size and mix of Node + jsdom tests.
- At current scale, "all tests in one bucket" is itself becoming a regression vector.

Why this matters for business processes:

- Critical-path signals get buried under suite contention.
- Teams start distrusting red CI.
- Real regressions become harder to distinguish from harness noise.

Recommended next step:

- Split CI into explicit lanes with separate SLOs:
  - critical backend unit
  - critical backend integration
  - jsdom/UI contract
  - e2e/product-flow
- Keep `npm run test:run` as a local convenience, but stop treating one giant bucket as the only signal worth trusting.

### 2. Learner-reminder cron is already a critical operational subsystem, and its integration harness is not stable enough

Evidence:

- `docs/critical-path.md` explicitly lists `scripts/learner-reminder-dispatch.mjs` as critical path because silent drops require operator SQL recovery.
- Targeted integration run of `tests/integration/scripts/learner-reminder-dispatch.test.ts` failed with:
  - `lesson_slots_teacher_account_id_fkey`
  - failure location: test fixture writes a slot after creating a teacher account
- The same subsystem already carries a known operator-recovery burden: a stuck `learner_reminder_dispatches` row in `status='claimed'` blocks retry until manual delete.

Interpretation:

- This is not just "an email reminder script".
- It is a stateful job processor with idempotency rows, operator settings, channel toggles, and recovery semantics.
- The architecture still treats it partly as a script and partly as a domain subsystem. That split is starting to leak into tests and operability.

Why this matters for business processes:

- Missed learner reminders become a support issue and an attendance issue.
- Recovery that requires SQL is acceptable for a wave-1 subsystem, but weak for a mature product.

Recommended next step:

- Promote reminder/digest/probe jobs into an explicit "job platform" layer with shared primitives for:
  - claim/finalize lifecycle
  - retry semantics
  - stuck-row recovery
  - structured telemetry
  - admin recovery actions
- Add an operator-facing recovery surface for stuck reminder rows so recovery is not SQL-only.

### 3. `payment_orders` is no longer a single-flow table, but the architecture still documents and treats it too narrowly

Evidence:

- `lib/payments/README.md` previously claimed `store-postgres.ts` was the only writer of `payment_orders`.
- Actual writer surface is broader and includes direct inserts in multiple product-specific routes, including:
  - `app/api/payments/route.ts`
  - `app/api/checkout/package/[slug]/route.ts`
  - `app/api/payments/sbp/create-qr/route.ts`
  - `app/api/teacher/subscribe/route.ts`
  - admin/teacher grant routes
- In `app/api/teacher/subscribe/route.ts`, the business kind is carried as `metadata.productKind` rather than a canonical top-level column.
- `lib/payments/types.ts` currently uses a triad of `provider`, `paymentMethod`, and `status` to encode several product types and non-money flows.

Interpretation:

- `payment_orders` is no longer "payments for learner packages".
- It is becoming the common order/event ledger for multiple business products:
  - learner package purchases
  - SBP orders
  - teacher SaaS subscription orders
  - admin grants
  - teacher grants
- That can work, but it now needs a first-class domain model, not just route-specific metadata conventions.

Why this matters for business processes:

- Finance/admin/reporting surfaces become harder to reason about.
- New product lines will keep growing hidden branching around "what kind of order is this".
- Reconciliation and support flows become more expensive because product kind is partly implicit.

Recommended next step:

- Introduce a canonical top-level `order_kind` (or similarly named) column and route all new order creation through a shared factory/service.
- Keep `provider` and `payment_method` as transport/instrument dimensions, not product semantics.
- Treat "teacher SaaS subscription" and "learner package purchase" as separate business kinds even if they share the same payment provider.

### 4. Money-moving writer logic is still too distributed for the current scale

Evidence:

- Several routes do their own direct `payment_orders` insert + receipt construction + metadata shaping.
- `store-postgres.ts` centralizes status transitions well, but creation semantics are fragmented.
- Different writers already need bespoke locks (`teacher-subscribe:<account>`, CP webhook tx locks, package-grant lock families, etc.).

Interpretation:

- The current design is still safe enough because DB constraints and domain checks are strong.
- But every new product writer repeats "how to create an order row correctly" with slightly different shape rules.
- That is a classic post-MVP duplication seam: safe today, compounding tomorrow.

Recommended next step:

- Extract shared order-creation services per business capability:
  - create learner package checkout order
  - create teacher subscription order
  - create SBP order
  - create non-money grant order
- Force those services to own:
  - canonical order kind
  - canonical metadata shape
  - audit event emission
  - teacher/account derivation
  - receipt token issuance

### 5. Operator-settings duplication across TS and MJS is still acceptable, but it is the wrong long-term scaling shape

Evidence:

- `lib/admin/operator-settings.ts` is the canonical app-side schema.
- `scripts/lib/operator-settings.mjs` mirrors the same schema for cron scripts.
- The repo already needs a drift test to keep the two copies aligned.

Interpretation:

- The team already knows this is a drift risk, which is why the test exists.
- The test is a guardrail, not a scalable source-of-truth strategy.
- As more probes, digests, reminders, and gates are added, this manual mirror becomes a tax on every operational feature.

Recommended next step:

- Generate both runtime surfaces from one neutral schema source (JSON/TS data file + build step), or move the scripts onto a shared TS runtime path.
- Keep the current drift test until the duplication is removed.

### 6. Coverage numbers look healthy, but the protected scope still under-represents several load-bearing backend domains

Evidence:

- `vitest.config.ts` coverage scope still excludes `lib/billing/**`, `lib/scheduling/slots/**`, `lib/admin/**`, and `lib/teacher-ledger/**` from enforced unit-coverage floors.
- The current rationale is understandable: those domains are integration-heavy.
- But those same domains now carry a large portion of business-critical logic.

Interpretation:

- The current coverage contract protects the original core well.
- It does not yet reflect where the product's real business complexity has moved.

Recommended next step:

- Do not blindly stuff those modules into the unit-coverage scope.
- Instead, add per-domain protected test lanes and explicit floors:
  - critical billing integration floor
  - critical scheduling integration floor
  - admin/operator critical queries floor
- Ratchet them as domain-specific gates, not just as one global coverage number.

## Recommended architecture changes for the next stage

### Priority A - make the monolith legible at current scale

1. Introduce canonical business identifiers for orders and entitlements.
2. Consolidate order creation behind shared services instead of route-local SQL.
3. Move cross-product semantics out of `metadata` when they are operationally important.

### Priority B - treat cron/process flows as first-class backend subsystems

1. Shared job-runner primitives for reminders, digests, and alert probes.
2. Admin recovery UI for stuck idempotency rows.
3. Clear run-level telemetry and SLOs per job family.

### Priority C - make test signals trustworthy again

1. Split full-suite CI by domain/layer.
2. Stabilize the reminder integration harness first, because that failure is concrete and backend-relevant.
3. Add critical-path regression packs that run fast and fail loudly on real invariants.

### Priority D - reduce contract drift

1. Remove the TS/MJS operator-settings mirror.
2. Keep module READMEs current when writer surfaces expand.
3. Continue treating docs as shipped contract, not as optional commentary.

## Suggested next PR order

1. Fix `learner-reminder-dispatch` integration fixture instability and add a regression note explaining the FK failure mode.
2. Create a small `order_kind` design note and map all current `payment_orders` writer paths to it.
3. Extract one shared order-creation helper for the teacher subscription writer as the first pilot.
4. Split CI test lanes so isolated-green but suite-red cases stop burning reviewer attention.
5. Design an admin recovery surface for stuck reminder/digest dispatch rows.

## Verification run in this audit

- `npm run check:env-contract` - pass
- `npm run check:content-style` - pass
- `npm run build` - pass
- `npm run test:run` - fail in aggregate (`12` failed tests across unrelated surfaces, mostly timeout-shaped)
- isolated reruns:
  - `tests/auth/password.test.ts` - pass
  - `tests/payments/sbp-create-qr-route.test.ts` - pass
  - `tests/payments/pricing-section-widget-rollback.test.tsx` - pass
  - `tests/payments/teacher-feed-prop-resync.test.tsx` - pass
- `npm run test:integration -- tests/integration/scripts/learner-reminder-dispatch.test.ts` - fail with FK on `lesson_slots_teacher_account_id_fkey`

## Bottom line

The project is still viable as a monolith, but it should no longer be treated as a simple MVP codebase.

The next maturity step is not "microservices". It is:

- stronger domain boundaries inside the monolith
- first-class treatment of job/process subsystems
- canonical business types for orders
- CI/test lanes that reflect the real backend shape

Without that, the codebase will keep shipping features, but the cost of each new business flow will rise faster than necessary.
