---
title: Code-quality audit — 2026-06-02
status: SIGN-OFF — codex-paranoia plan-mode round 3/3 (3 BLOCKER + 4 WARN in R1 closed; 1 BLOCKER in R2 closed; R3 clean)
date: 2026-06-02
owner: claude (audit orchestrator)
scope: dead code + stale comments + small refactors; no architectural rewrites
---

# Code-quality audit — 2026-06-02

Surgical, low-risk cleanup wave after ~15 epics shipped May→early-June 2026.
Goal: remove drift the production team can no longer trust, centralize a
small handful of duplicated SQL predicates, and surface the one genuine
bug found during the sweep. Plan-only; nothing implemented in this PR.

## Existing surface inventory (R1-BLOCKER#1 — COMPANY.md §151 compliance)

**Grep #1** (postpaid surface inventory for F1 + B1):
```
grep -rn "postpaid_allowed\|postpaidAllowed\|PostpaidAllowed" app lib components migrations tests
```
Hits (full enumeration):
- `migrations/0101_learner_billing_preferences.sql:49-54` — deferred drop comment. → **action**: ship the drop in mig 0103.
- `app/api/admin/accounts/[id]/postpaid/route.ts` — entire file. → **delete** (Sub-PR A).
- `app/admin/(gated)/accounts/[id]/page.tsx` — admin toggle UI block. → **delete** (Sub-PR A).
- `app/cabinet/page.tsx:145-150` — inline SELECT. → **delete** (Sub-PR A).
- `app/cabinet/lessons-section.tsx:45,110` — prop pass-through. → **delete the prop** (Sub-PR A).
- `components/calendar/BookConfirmModal.tsx:53,73,238` — banner gate. → **REWIRE, not delete** (R1-BLOCKER#2 closure: see §F1 below).
- `tests/integration/billing/admin.test.ts` postpaid test. → **delete** (Sub-PR A).
- `tests/integration/admin/accounts-mutations.test.ts:281-335` block. → **delete** (Sub-PR A).

**Grep #2** (`BILLING_WAVE_ACTIVE` for F2):
```
grep -rn "BILLING_WAVE_ACTIVE\|billingActive\|billingWaveActive" app lib components tests
```
→ See §F2 for full enumeration + per-hit disposition.

**Grep #3** (the `sync_state='active' AND last_pulled_at` predicate for F9):
```
grep -rn "sync_state.*active.*last_pulled_at\|last_pulled_at.*sync_state.*active" lib app
```
Hits + disposition (R1-BLOCKER#3 closure: ONLY read-side gate sites are F9 targets; write-side lifecycle SQL in `integrations.ts` and `pull-runner.ts` is intentionally NOT touched):
- `lib/scheduling/slots/booking.ts:62-79` `BUSY_OVERLAP_GATE_SQL` → **F9 target** (read-side gate).
- `lib/scheduling/slots/booking.ts:395-396` post-failure overlap probe → **F9 target** (read-side gate).
- `lib/calendar/hidden-slots.ts:87-88` → **F9 target** (read-side gate).
- `lib/calendar/hidden-slots.ts:142-143` → **F9 target** (read-side gate).
- `lib/calendar/integrations.ts:208-219` — sets `sync_state='active'`, `last_pulled_at=null` on reconnect. → **DO NOT TOUCH** (write-side lifecycle; centralizing here would change NULL semantics).
- `lib/calendar/pull-runner.ts:337-356` — `IS NOT DISTINCT FROM` guard on token-write. → **DO NOT TOUCH** (write-side lifecycle).

**Grep #4** (`freshness-sql.ts` proposed new file — verify no collision):
```
grep -rn "freshness-sql\|ACTIVE_INTEGRATION_GATE_SQL\|ACTIVE_INTEGRATION_FRESHNESS_INTERVAL" lib app components
```
Hits: **0** — clean new surface. → **create** as proposed in §F9.

## What this wave touches (so the next agent doesn't re-discover)

- `migrations/0101_learner_billing_preferences.sql` — author of the deferred
  `accounts.postpaid_allowed` drop (lines 49-54). Already has a TODO follow-up
  comment naming the cleanup contract.
- `lib/scheduling/slots/booking.ts` — owns `BUSY_OVERLAP_GATE_SQL` (private)
  and reads `BILLING_WAVE_ACTIVE` for the legacy fast path.
- `lib/calendar/hidden-slots.ts`, `lib/calendar/integrations.ts`,
  `lib/calendar/pull-runner.ts` — duplicate the `sync_state='active'
  AND last_pulled_at >= now() - interval '10 minutes'` predicate inline.
- `lib/calendar/derive-status.ts` — already centralizes the SAME predicate in
  TypeScript (`PULL_FRESHNESS_TTL_MS`). Sibling SQL centralization will live
  next to it for symmetry.
- `app/cabinet/page.tsx`, `app/cabinet/lessons-section.tsx`,
  `components/calendar/BookConfirmModal.tsx`, `app/admin/(gated)/accounts/[id]/page.tsx`,
  `app/api/admin/accounts/[id]/postpaid/route.ts`,
  `tests/integration/billing/admin.test.ts`,
  `tests/integration/admin/accounts-mutations.test.ts` — readers/writers of
  the deferred-drop column.
- `app/api/payments/route.ts`, `lib/email/dispatch.ts`,
  `tests/payments/receipt-token-mint.test.ts`,
  `tests/admin/operator-settings.test.ts` — stale "Phase 2 will..." comments
  for already-shipped functionality.
- `lib/payments/cloudpayments-api.ts` — has two unused `export type`s
  (`CloudPaymentsSbpQrRequest`, `CloudPaymentsSbpQrResult`).

## Findings

Ordered within each category by impact.

### Dead code

#### F1 [HIGH-IMPACT] `accounts.postpaid_allowed` column + 7 consumers

`migrations/0101_learner_billing_preferences.sql:49-54` documents that this
column became dead the moment migration 0101 shipped (booking flow consults
`learner_billing_preferences` per-pair, never `accounts.postpaid_allowed`).
The DROP was explicitly deferred to "follow-up cleanup PR" to avoid blast
radius. That follow-up has not happened. Consumers still in code:

- `app/api/admin/accounts/[id]/postpaid/route.ts` — entire POST endpoint
  toggles a column that no longer steers any business logic. Dead route.
- `app/admin/(gated)/accounts/[id]/page.tsx` — admin UI block showing the
  toggle. Dead UI.
- `app/cabinet/page.tsx:145-150` — SELECT `postpaid_allowed FROM accounts`
  per cabinet render to thread `postpaidAllowed` into `<LessonsSection>`.
  Dead read (the prop is consumed by `BookConfirmModal` for an advisory
  banner that no longer matches the real gate).
- `app/cabinet/lessons-section.tsx:45,110` — prop pass-through. Dead prop.
- `components/calendar/BookConfirmModal.tsx:53,73,238` — gate condition
  `canBook && billingWaveActive && postpaidAllowed`. **R2-BLOCKER#1
  reclassification**: the previous proposal to rewire onto
  `billing?.kind === 'postpaid'` was wrong — the modal's preview-side
  data does NOT carry `billing` (it ships only with `row`,
  `activePackages`, `postpaidAllowed`, `billingWaveActive`; see
  `BookConfirmModal.tsx:46` + `view-model.ts:16`). `billing.kind` is a
  POST-response shape, not pre-book. The real SoT for per-pair payment
  method is `lib/billing/learner-payment-method.ts`, but threading that
  server-side to the modal is its own sub-epic. → **delete the
  postpaid-preview branch entirely** (it's the lying-banner described
  in B1). The booking server-side gate already rejects with structured
  `payment_method_not_set` / `package_required` / `pending_package_grant`
  reasons — the modal can stay silent on the postpaid case until the
  per-pair preview is wired in a follow-up. Drop the `postpaidAllowed`
  prop, drop the conditional surface, drop the `accounts.postpaid_allowed`
  inline read on the cabinet page.
- `tests/integration/billing/admin.test.ts:67-…` — toggle test for a dead
  endpoint.
- `tests/integration/admin/accounts-mutations.test.ts:281-335` — same.

**Proposed action:** delete the 7 consumers above + add migration
`0103_drop_accounts_postpaid_allowed.sql` containing
`alter table accounts drop column postpaid_allowed`. The advisory
"можешь брать в долг" banner in BookConfirmModal is superseded by the
per-pair `payment_method` selector at `/teacher/learners/[id]`.

Estimated diff: ~250 LOC removed, 5 LOC added. Net minus.

#### F2 [HIGH-IMPACT] `BILLING_WAVE_ACTIVE` legacy fast path in `lib/scheduling/slots/booking.ts`

`booking.ts:115` branches on `process.env.BILLING_WAVE_ACTIVE === 'true'`.
The legacy path (lines 131-161) is preserved bit-for-bit to keep "existing
tests continue to exercise the booking path without per-test billing setup"
(comment line 104-107).

Status as of 2026-06-02:

- All 9 production-side integration tests that boot the new path set the
  flag to `'true'` (`tests/integration/billing/*`, `tests/integration/admin/*`,
  `tests/integration/saas-pivot/security-high-closures.test.ts`).
- `.env.example` does NOT document the flag. Dev environment defaults to
  legacy → cabinet UI calls into `learner_billing_preferences`-aware booking
  in tests but legacy single-statement booking in dev. Two semantically
  different paths shipping side-by-side is process debt.
- Production: the flag is set by `/etc/levelchannel/env` per the
  `prepay-postpay-billing.md` plan, but no committed runbook / activation
  script touches it. We rely on operator memory.
- After mig 0101, the legacy path can no longer honor the per-pair payment
  method contract — it just books the slot with no billing side-effects.
  In prod that would be a money leak; in tests it's a "doesn't exercise
  billing" silent skip.

**Proposed action:** remove the `billingActive` branch entirely. New `bookSlot`
always takes the new path. Drop `BILLING_WAVE_ACTIVE` from all test stub-env
calls (10 files). Update `.env.example` comment block. The legacy fast-path
SQL (lines 134-156) is the part that goes; the new-path stays.

Estimated diff: ~80 LOC removed in `booking.ts`, ~30 LOC of `vi.stubEnv`
calls removed across `tests/integration/billing/*` and
`tests/integration/admin/debt-summary.test.ts`.

Out of scope for this audit: re-examining `BILLING_WAVE_ACTIVE` callers
in `lib/scheduling/slots/mutations-cancel.ts`. Those run the same
dynamic-import gate; they likely also collapse but are a separate sub-PR.

#### F3 [MEDIUM] Unused `export type`s in `lib/payments/cloudpayments-api.ts`

`CloudPaymentsSbpQrRequest` (line 489) and `CloudPaymentsSbpQrResult`
(line 501) are only referenced inside the same file. The wrapper function
`createSbpQr` uses them locally. No external consumer imports them.

**Proposed action:** drop the `export` keyword on both. Net: 0 LOC change,
narrower public surface.

#### F4 [LOW] One-shot legacy migration script `scripts/migrate-payment-orders-to-postgres.mjs`

Production runs `postgres` backend. Script is documented in
`PAYMENTS_SETUP.md:69` for fresh env bootstrap from the JSON-era file
backend. Has `Phase 3 caveat` (2026-05-14) noting it doesn't backfill
`receipt_token_hash` and that orders imported via this path get 401s
from the public payment routes. Effectively a stub.

**Proposed action:** **LEAVE ALONE WITH REASON**. The script costs nothing
(unused unless explicitly invoked), the documented caveat is honest about
its limits, and removing it would break documentation cross-refs in two
files. Re-evaluate after 90 days of zero invocations.

### Stale comments / docs

#### F5 [HIGH-IMPACT] `Phase 2 will gate ...` comment in `app/api/payments/route.ts:265`

The Wave 6.1 #4 Phase 2 receipt-token gate has shipped (`evaluateReceiptGate`
is wired in `app/api/payments/[invoiceId]/route.ts:53`, `/stream/route.ts:71`,
`/cancel/route.ts:46`). The comment block at `route.ts:263-269` still says
"Phase 2 will gate [invoiceId]/{,cancel,stream} on it; for now it's
returned to the client so the UI can start threading it ahead of the gate."
This contradicts current behavior.

**Proposed action:** rewrite the comment in past tense; cross-reference the
three gate sites. Net: ~5 LOC of comment churn.

#### F6 [MEDIUM] `Phase 2 may introduce a friendlier loader page` in `lib/email/dispatch.ts:26`

The verify URL still points at `/api/auth/verify` as the canonical click-through
destination — that's the current behavior. But the comment muses about a
"Phase 2" friendlier loader page that has not shipped and is not on any
roadmap. Cosmetic.

**Proposed action:** trim the speculation, keep the rationale (POST-only,
no loader needed). Net: ~3 LOC trimmed.

#### F7 [MEDIUM] `Phase 2 owns the /reset page; in Phase 1B the click landing is a 404 placeholder` in `lib/email/dispatch.ts:33-34`

`/reset` ships (`app/reset/page.tsx`). Comment is two phases stale.

**Proposed action:** rewrite to reflect the shipped state. Net: ~3 LOC.

#### F8 [LOW] `// Wave N` historical anchors in `lib/`, `app/`, `components/`

124 inline `// Wave N` / `// Phase N` / `// Codex round N` anchors across
~70 files. Most are load-bearing (they explain non-obvious code that future
agents will mis-read otherwise — see the 2026-05-14 freehand-session
incident). A wholesale strip would burn future-paranoia signal.

**Proposed action:** **LEAVE ALONE WITH REASON**. Stale anchors are a
feature, not a bug — they tie current code to historical paranoia rounds
so a re-touch knows what risk was previously closed. Only delete an anchor
when the code it annotates is itself deleted.

### Refactor

#### F9 [MEDIUM] Centralize the `sync_state='active' AND last_pulled_at >= 10min` SQL predicate

Duplicated 4× inline ON READ-SIDE GATES (R1-BLOCKER#3 closure: write-side lifecycle SQL in `integrations.ts` + `pull-runner.ts` is INTENTIONALLY excluded — their NULL semantics differ; see §Existing surface inventory grep #3):

- `lib/scheduling/slots/booking.ts:62-79` — `BUSY_OVERLAP_GATE_SQL` (file-private const, used 2× in the same file).
- `lib/scheduling/slots/booking.ts:395-396` — post-failure-classification overlap probe (manually inlined; doesn't share the const).
- `lib/calendar/hidden-slots.ts:87-88, 142-143` — `listHiddenSlotsForTeacher` + `countHiddenSlotsForTeacher`.

Three of the four sites carry the explicit comment "mirror the booking-side
gate predicate exactly" (`hidden-slots.ts:65-71`, `:134`). That comment is
the smell — when a predicate's correctness depends on staying in lockstep
with another file, the predicate wants to be a shared constant.

Parallel JS-side centralization already exists: `lib/calendar/derive-status.ts`
holds `PULL_FRESHNESS_TTL_MS = 10 * 60 * 1000` and is the source of truth for
the `derivePullStatus` cabinet copy. The SQL `interval '10 minutes'` should
live next to it.

**Proposed action:** add `lib/calendar/freshness-sql.ts` exporting:

```ts
export const ACTIVE_INTEGRATION_FRESHNESS_INTERVAL = "interval '10 minutes'"
export const ACTIVE_INTEGRATION_GATE_SQL = `tci.sync_state = 'active' and tci.last_pulled_at >= now() - ${ACTIVE_INTEGRATION_FRESHNESS_INTERVAL}`
```

Then rewrite the 4 inline sites to interpolate the constant. Add a drift
test in `tests/calendar/` that asserts the booking gate's busy-overlap CTE
contains the exact `ACTIVE_INTEGRATION_GATE_SQL` substring.

**Subtlety:** these are SQL string templates. The shared constant is also
a SQL string (NOT a parameterized query), so we keep static-analyzability
and we don't introduce a runtime build step. Comment block on the new
constant must say "string-constant, NOT prepared-statement input" so
future-agent doesn't try to bind it.

Estimated diff: +30 LOC (new file + drift test), -20 LOC (4 inlines collapse
to the constant). Net: ~+10 LOC, semantic gain.

#### F10 [LOW] `app/cabinet/page.tsx:145-150` — inline `accounts.postpaid_allowed` SELECT

If F1 ships, this whole `getDbPool().query('select postpaid_allowed ...')`
inline goes away. Even pre-F1, the inline SQL inside a page render is
anti-pattern (the rest of `page.tsx` uses typed helpers from `lib/`). F1
supersedes — no separate sub-PR.

### Optimization

#### F11 [LOW] Large client components (>1000 LOC)

`components/payments/pricing-section.tsx` (1652 LOC),
`components/home/teacher-landing-client.tsx` (1326 LOC),
`app/admin/(gated)/slots/slots-manager.tsx` (1129 LOC),
`components/home/home-page-client.tsx` (1021 LOC).

All hit the bar in the audit prompt ("large React components that could
split (>500 LOC files)"). The two landing-page files were just rewritten
during the SaaS-pivot wave (2026-05-22..30) and are not yet stable; the
slots-manager carries Apple-Calendar redesign + keyboard nav (SAAS-1
follow-up) and is the operator's daily driver.

**Proposed action:** **LEAVE ALONE FOR NOW**. The smell is real but
splitting any one of these is a 1-2 day sub-epic (component boundary,
state hoisting, prop-drilling consequences) that does not belong in a
surgical cleanup. Flag in `docs/backlog/cross-cutting.md` as a known
debt; revisit when one of them gets touched for a feature change.

### Type drift

#### F12 [LOW] `: any` / `as any` usage

5 occurrences across the whole `lib/` + `app/` tree:

- `lib/scheduling/teacher-learners.ts` — 1
- `app/api/slots/calendar/route.ts` — 1
- `app/api/teacher/lessons/[id]/uncomplete/route.ts` — 1
- `app/api/teacher/learners/[id]/settle/route.ts` — 2

**Proposed action:** spot-check each and replace with `unknown` + narrowing
where free. If the cast is load-bearing (e.g. interfacing with a JSON
payload of mixed shape), leave it with a `// eslint-disable` comment
explaining why. Net: ~5 LOC changes.

## Implementation plan

Five sub-PRs in **strict serial order** (R1-WARN#4 closure — A and B both
touch `app/cabinet/page.tsx` + `app/cabinet/lessons-section.tsx` +
`components/calendar/BookConfirmModal.tsx`, so they are NOT independent).
F1 is the biggest payoff; F2 is the riskiest (R1-WARN#7 — F2 changes a
money-adjacent runtime contract, NOT pure cleanup — consider deferring
to a separate epic with its own paranoia loop if there's any uncertainty).

### Sub-PR A — dead code sweep (F1 + F3)

- Delete `app/api/admin/accounts/[id]/postpaid/route.ts` (entire file).
- Delete admin postpaid UI block from `app/admin/(gated)/accounts/[id]/page.tsx`.
- Strip `postpaid_allowed` SELECT from `app/cabinet/page.tsx`; remove
  `postpaidAllowed` prop from `<LessonsSection>`.
- Strip `postpaidAllowed` from `app/cabinet/lessons-section.tsx`.
- In `components/calendar/BookConfirmModal.tsx`: **delete** the
  `postpaidAllowed` prop AND the postpaid-preview branch (R2-BLOCKER#1
  closure — the modal lacks `billing.kind` data; per-pair preview is a
  follow-up sub-epic). The booking server-side gate already rejects
  ineligible bookings with structured reasons; the preview banner was
  the lying surface described in B1.
- Delete `tests/integration/billing/admin.test.ts` postpaid-toggle test.
- Delete `tests/integration/admin/accounts-mutations.test.ts:281-335`.
- Add `migrations/0103_drop_accounts_postpaid_allowed.sql`:
  `alter table accounts drop column postpaid_allowed`.
- Drop `export` from F3's two SBP types.
- Update `ARCHITECTURE.md` postpaid block.

Trailer: `Skill-Used: trivial (mechanical sweep), Codex-Paranoia: SUB-WAVE
self-reviewed (epic code-quality-audit-2026-06-02); epic-end review pending`.

Estimated LOC: -250 / +10.

### Sub-PR B — BILLING_WAVE_ACTIVE retirement (F2)

- Remove `billingActive` branch from `lib/scheduling/slots/booking.ts`
  (the legacy fast path block, lines 131-161).
- Strip `BILLING_WAVE_ACTIVE` reads in `app/cabinet/page.tsx:302-303` and
  `app/cabinet/lessons-section.tsx:46` (always pass true / always-on
  semantics; eventually drop the prop after a soak).
- Strip `BILLING_WAVE_ACTIVE` reads in `components/calendar/BookConfirmModal.tsx:55`.
- Remove `vi.stubEnv('BILLING_WAVE_ACTIVE', 'true')` and
  `process.env.BILLING_WAVE_ACTIVE = 'true'` from all 9 integration test
  files listed in F2.
- Update `ARCHITECTURE.md` (1 mention) and `docs/plans/prepay-postpay-billing.md`
  is a historical record — leave its content but add a note at the top
  saying the flag was retired in this PR.

Trailer: same as Sub-PR A.

Estimated LOC: -120 / +20.

### Sub-PR C — stale-comment + SQL-predicate centralization (F5, F6, F7, F9)

- Rewrite stale "Phase 2" comments at `app/api/payments/route.ts:263-269`,
  `lib/email/dispatch.ts:23-35` (two blocks).
- Add `lib/calendar/freshness-sql.ts` per F9.
- Replace the 4 inline `sync_state='active' AND last_pulled_at >= 10min`
  call-sites with the new constant; keep the comment block on each call
  site short ("see freshness-sql.ts").
- Add drift test `tests/calendar/freshness-sql-call-sites.test.ts`.

Trailer: same as Sub-PR A.

Estimated LOC: +50 / -30. Net +20.

### Sub-PR D — type drift spot-fixes (F12)

5 small `: any` → `unknown` + narrow conversions. Or keep with explicit
disable comments where they're load-bearing. Bundled separately so a
revert of any one doesn't drag the bigger sweeps.

Estimated LOC: +/-5.

### Sub-PR E (epic-close) — F11 backlog note + ENGINEERING_BACKLOG entry

Add one-line note to `docs/backlog/cross-cutting.md`:
"Large client components ≥1000 LOC (pricing-section, teacher-landing-client,
slots-manager, home-page-client) flagged 2026-06-02; revisit at next
feature touch on any of them."

Estimated LOC: +5.

## Tests

Regression tests to **keep** after Sub-PR A:

- `tests/integration/billing/booking.test.ts` minus the legacy-path block
  — covers the post-mig-0101 booking with `learner_billing_preferences`.
- Existing `lib/billing/learner-payment-method.ts` unit tests.

Regression tests to **add**:

- `tests/calendar/freshness-sql-call-sites.test.ts` — grep-based assertion
  that the 4 known call sites all import `ACTIVE_INTEGRATION_GATE_SQL`
  rather than inlining the predicate (drift guard).
- `tests/integration/billing/no-postpaid-column.test.ts` — asserts after
  mig 0103 the `accounts.postpaid_allowed` column does not exist (catches
  any consumer that snuck back).

Regression tests to **delete**:

- `tests/integration/billing/admin.test.ts` postpaid-toggle test.
- `tests/integration/admin/accounts-mutations.test.ts:281-335` block.

## Bugs found during audit

### B1 [MEDIUM] `app/cabinet/page.tsx:145-150` reads `accounts.postpaid_allowed`, which the booking layer no longer honors

After mig 0101, the booking layer consults `learner_billing_preferences`
per (teacher, learner) pair. `accounts.postpaid_allowed` is unread by
booking.ts (the dead-column comment at mig 0101:49-54 says so explicitly).
BUT `/cabinet/page.tsx` still SELECTs it to thread `postpaidAllowed` into
`<LessonsSection>` → `BookConfirmModal` for the advisory "сможете записаться
в долг" banner. The banner can now LIE to a learner: if the teacher set
`payment_method='prepaid_packages'` for this learner, the booking will be
rejected with `package_required` / `pending_package_grant` /
`payment_method_not_set` (R1-WARN#6 closure: actual reasons in
`lib/scheduling/slots/types.ts:236-253`; the earlier draft cited a
non-existent `payment_method_packages_no_active_package`), but the modal
will display "можете брать в долг" if `postpaid_allowed=true` is still set
from before mig 0101.

This is a UX bug, not a money bug — the server still rejects correctly.
But it's misleading copy.

**Closure:** Sub-PR A above. The dead column goes, the modal stops lying.

### B2 [LOW] `.env.example` does not document `BILLING_WAVE_ACTIVE`

A dev who copies `.env.example` to `.env.local` gets the legacy fast path
in their local cabinet. The legacy path silently skips billing entirely,
so a manual click-through of "book a slot from /cabinet/book/..." silently
succeeds with no package consumption and no debt row — masking real
behavior in dev. After Sub-PR B this becomes moot (flag is gone). Until
then it's a quiet trap. Surfaced here so the reader knows what they're
not seeing in `.env.example`.

**Closure:** Sub-PR B above.

## What is NOT in scope

- React 19 migration (project is on React 18 per `package.json`).
- Next.js 17 migration.
- Splitting any of the >1000 LOC components (F11 — backlog note only).
- TypeScript `strict: true` migration (orthogonal large refactor).
- Removing `// Wave N` / `// Codex round N` historical anchors (F8 —
  intentionally retained for paranoia continuity).
- `lib/payments/store-file.ts` removal (still used by unit-test default
  backend per `tests/setup-env.ts:18-19`).
- `scripts/migrate-payment-orders-to-postgres.mjs` removal (F4 — leave-alone-with-reason).
- Any change to `lib/payments/` or `lib/security/` business logic.
- Any change to the SQL of `BUSY_OVERLAP_GATE_SQL` itself (Sub-PR C only
  moves the duplicated predicate into a shared constant; the predicate
  text doesn't change).

## Paranoia plan

- Plan-mode `/codex-paranoia plan` on THIS file. 3-round hard cap.
- Each sub-PR carries `SUB-WAVE self-reviewed (epic code-quality-audit-2026-06-02)`.
- Epic-end `/codex-paranoia wave` after Sub-PR E close, on the aggregated
  diff range. BLOCKERs land as follow-up fix-PRs per the shifted-right
  contract.

## Total estimated LOC change

- Sub-PR A: −240 net
- Sub-PR B: −100 net
- Sub-PR C: +20 net
- Sub-PR D: ~0 net
- Sub-PR E: +5 net

**Total: ~−315 LOC net (mostly deletions).**
