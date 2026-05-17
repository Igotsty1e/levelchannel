# POLICY-KNOBS — env-tunable scheduling policy

**Scope class:** mini-epic (single PR; new config module + 3 code-site updates [server gate, server function, client prop-threading] + tests + doc sweep).
**Wave name:** `policy-knobs`.
**Origin:** `docs/plans/admin-ux-coverage.md §3.3` (P3 in §10.1). ENGINEERING_BACKLOG.md task #34.

**Re-scoped from the original spec.** The original POLICY-KNOBS lived in the P3 lane after ALERTS-EDITOR — the assumption was operator-tunable via a future `operator_settings` DB table. That table does not exist yet. Codex finding #5 in admin-ux-coverage.md §9 explicitly named "DB-only with no env fallback breaks bootstrap/recovery." So the right first step is env-tunable WITH the same memoization-free contract; the optional DB-tunable upgrade can stack on top whenever ALERTS-EDITOR lands.

The scope covers ONE knob — the 24-hour learner cancel window. "Refund grace" (§3.3) is a misnomer in the original doc: the refund-eligibility window IS the cancel window. `DEFAULT_PENDING_TIMEOUT_MINUTES = 30` in `lib/billing/refund-reconcile.ts:46` is a gateway-watchdog timeout (not a policy knob) — out of scope.

Plan paranoia round 1 surfaced three real BLOCKERs + six WARNs that this revision addresses (client-side UI hardcode, sloppy `Number.parseInt` parse, wrong SIGHUP rollout claim, wrong test filenames, wrong HTTP status, missing boundary cases, wrong runbook target, missing coverage call-out, incomplete plan-doc sweep).

## 1. Existing surface inventory

Survey-before-plan per `~/.claude/COMPANY.md`. **All call-sites, including client UI, enumerated.**

### 1.1 Current state of the 24-hour rule — THREE call-sites (not two)

| Site | Today's value | Used by | Role |
|---|---|---|---|
| `lib/scheduling/slots/types.ts:52` | `LEARNER_CANCEL_THRESHOLD_MS = 24 * 60 * 60 * 1000` | `canLearnerCancel(slot, nowMs)` — pure function for server-side validation + cabinet UI client-side check | Predictive |
| `lib/scheduling/slots/mutations-cancel.ts:121` | `start_at - now() >= interval '24 hours'` (SQL) | Atomic `UPDATE ... WHERE` clause in `cancelSlotForLearner` | **Server-authoritative** |
| `app/cabinet/lessons-section.tsx:87,89-91,233` | `HOURS_24_MS = 24 * 60 * 60 * 1000` + `isTooLateToCancel(startAtIso)` | Render-time disable of the "Cancel" button per slot | Predictive (client) |

The TS pure function (`types.ts`) and the SQL clause (`mutations-cancel.ts`) MUST agree on every call. The cabinet UI's local `HOURS_24_MS` is a **separate copy** that has nothing to do with `LEARNER_CANCEL_THRESHOLD_MS` — `lessons-section.tsx` does not import the constant. It's `'use client'`, so a server-only env read cannot reach it directly; the value must be passed in as a prop from the server component that renders `<LessonsSection>` (`app/cabinet/page.tsx:167`).

Re-export at `lib/scheduling/slots/index.ts:38` (`LEARNER_CANCEL_THRESHOLD_MS`) — repo grep (round-1 INFO #10) shows no consumer beyond the def/re-export + doc files. Safe to remove as exported constant.

### 1.2 Adjacent `interval '24 hours'` matches that are NOT this knob

- `lib/calendar/channel-renewer.ts:305` — Google push channel renewal window (renew 24h before expiry). Not policy. Untouched.

### 1.3 Refund-domain inspection

`lib/billing/refund-attempts.ts`, `lib/billing/reversals.ts`, `lib/billing/refund-reconcile.ts` — no policy constants. `DEFAULT_PENDING_TIMEOUT_MINUTES = 30` is a gateway watchdog, not a policy knob.

The connection between cancel and refund happens through `lib/billing/reversals.ts` — successful learner cancel triggers reversal of the prepay allocation. The eligibility gate IS the cancel gate. No second knob needed.

### 1.4 Tests touching the 24h rule today (verified file paths)

Round-1 WARN #4 closure. Actual files (after `grep` against the repo):

- `tests/scheduling/can-learner-cancel.test.ts:1-53` — unit, no DB. Currently asserts `24h - 1 minute` boundary (NOT the exact threshold). New test file must add exact-boundary cases.
- `tests/integration/scheduling/lifecycle.test.ts:71-185` (and `:123-126` for the late-cancel HTTP status — see §1.5 below).
- `tests/integration/scheduling/slots-flow.test.ts:242-362`.
- Fixture helper at `tests/integration/helpers.ts:149-185`.

All currently rely on the hardcoded 24h default. Will keep working under the default-24h path. Add a focused new test file for env-tunable behaviour to avoid coupling existing tests to env state.

### 1.5 Late-cancel HTTP status (round-1 WARN #5 closure)

Late-cancel returns **403**, not 422. Source: `app/api/slots/[id]/cancel/route.ts:113-120`. Pinned by `tests/scheduling/cancel-route-disambiguation.test.ts:98-108` and `tests/integration/scheduling/lifecycle.test.ts:123-126`. The plan's integration tests must assert 403 on the "too late" path.

### 1.6 Plan-doc references to the hardcoded 24h (round-1 WARN #9 closure)

- `docs/plans/slots-split.md:34-48, 149-159` — documents `LEARNER_CANCEL_THRESHOLD_MS` as part of the export surface. Needs update.
- `docs/plans/phase-5-lifecycle-24h-rule.md:28-33, 63-67, 95-97` — describes the rule as fixed 24h. Needs an env-tunable note.
- `docs/plans/prepay-postpay-billing.md:474-480, 671-675` — refers to 24h as a hardcoded contract. Needs an env-tunable note.
- `docs/plans/admin-ux-coverage.md §3.3` — the entry that motivates this wave. Flip "should be in /admin" to "env-tunable today; /admin UI deferred to ALERTS-EDITOR follow-up."

### 1.7 Operator-runbook target (round-1 WARN #7 closure)

`OPERATIONS.md` is a public-safe stub per `DOCUMENTATION.md:76,98-100`. Real env/runbook procedures live in the private runbook (out of public-repo scope). The plan's operator-facing changes will:

1. Append a one-line pointer to `OPERATIONS.md` under the env-section: "`LEARNER_CANCEL_WINDOW_HOURS`: operator-tunable learner cancel window in hours; default 24; clamp [0..720]; see private runbook for the operator procedure."
2. **Not** attempt to land the private runbook delta here.

### 1.8 Coverage gap to call out explicitly (round-1 WARN #8 closure)

`vitest.config.ts:18-31` — `npm run test:coverage` does not include `lib/scheduling/**`. Component tests on `LessonsSection` (the client drift point at `app/cabinet/lessons-section.tsx:87-91, 306-333`) do not exist. **Test acceptance must include explicit assertions on the new server→client prop wire** — see §4.

## 2. Threat model + why env not DB

**What we get:** operator can roll a new cancel-window policy by setting `LEARNER_CANCEL_WINDOW_HOURS=48` (or 6, or 0 to disable the gate) and **restarting the app** (round-1 BLOCKER #3 closure — SIGHUP is NOT a reload signal for plain Node/Next processes; only an explicit `systemctl restart levelchannel-app` picks up the new env from the systemd unit's `Environment=` / `EnvironmentFile=`). No code change. No re-deploy.

**What we explicitly defer:** UI knob in `/admin`. That requires the `operator_settings` table + non-memoized read pattern (Codex finding #6) + DB→env→hardcoded-default fallback chain. Deferred to a follow-up PR once ALERTS-EDITOR brings that infrastructure.

**Why not DB-only today:** Codex #5 — losing bootstrap/recovery. If the DB row is missing or the table doesn't exist, the policy would silently flip to default or "no gate" depending on read shape. Env-with-default is the safe baseline; DB layer stacks on top without changing the fallback chain.

**Rollout shape (round-1 BLOCKER #3 closure).** Single-instance VPS (`docs/private/OPERATIONS.private.md`-class operator runbook): operator edits the unit env, runs `systemctl restart levelchannel-app`, brief downtime is acceptable. There is NO rolling-deploy mixed-instance scenario today; the deployment is single-replica. If the deployment topology changes to multi-instance later, the env-flip flip becomes a real concern and the right answer is to ship ALERTS-EDITOR (DB-tunable, per-request reads) BEFORE multi-instance lands. The plan does NOT claim mixed-instance safety today.

**Safety properties preserved:**

1. The SQL gate stays server-authoritative — UI predictions can lie; the UPDATE's WHERE clause is the final word.
2. All three sites (TS server function, SQL bind, client prop) read from a SINGLE env value materialised at request-time on the server. The client receives the value as a prop on each server render — no module-scope memoization in the server function (Codex #6) and no module-scope memoization in the client either (the prop refreshes on every server-render of the cabinet page).
3. The function clamps to a sane range: `<1h treated as 0 (no-gate)`; `>720h (30 days)` rejected → fallback to default 24h.
4. **Strict env parsing (round-1 BLOCKER #2 closure + round-2 BLOCKER #1 closure).** The parser does NOT trim before regex — the env value is read raw and tested against `/^\d+$/`. Any leading/trailing whitespace, a sign, a decimal point, or any non-digit character fails the match → fallback to default 24h. Values like `0.5`, `6h`, `24abc`, ` 24 ` (with spaces), `+24`, `24.0`, `-1`, `NaN`, `Infinity` are all rejected. After the regex match, `Number(raw)` parses a clean non-negative integer; the range check then enforces `[0..720]`. Fractional hours are not supported — operators wanting half-hour windows would set 0 (no gate) or wait for the future DB-tunable layer. (The earlier draft said "`<1h` treated as 0" — round-2 BLOCKER #1 surfaced this as inconsistent with the strict-reject list; corrected: only the integer 0 means "no gate"; any non-integer fails regex → defaults to 24h.)

## 3. Code changes

### 3.1 New module: `lib/scheduling/policy.ts`

```ts
// Single source of truth for scheduling policy knobs.
//
// Reads env on EVERY call — no module-scope memoization (Codex
// finding #6 from docs/plans/admin-ux-coverage.md §9). Per-request
// reads are cheap (regex match + small int parse), and avoiding
// memoization means an operator-side `systemctl restart` is the only
// step to roll a new policy.
//
// Default 24h preserves pre-POLICY-KNOBS behaviour exactly.
//
// Parser: strict /^\d+$/ regex. Round-1 paranoia BLOCKER #2 — bare
// Number.parseInt accepts '0.5'/'6h'/'24abc'/' 24 '/'+24'. We reject
// all of those → fallback to default 24h. The contract is "operator
// supplies an integer in [0..720] or we revert to safe default".

const DEFAULT_LEARNER_CANCEL_WINDOW_HOURS = 24
const MIN_LEARNER_CANCEL_WINDOW_HOURS = 0    // 0 = no gate (operator policy)
const MAX_LEARNER_CANCEL_WINDOW_HOURS = 720  // 30 days; absurd-bound

const INTEGER_PATTERN = /^\d+$/

export function getLearnerCancelWindowHours(
  env: NodeJS.ProcessEnv = process.env,
): number {
  // Round-2 BLOCKER #1 — do NOT trim. Operator must supply a clean
  // string of digits; any whitespace, sign, decimal, or non-digit
  // character fails the match → safe fallback to default 24h.
  const raw = env.LEARNER_CANCEL_WINDOW_HOURS ?? ''
  if (raw.length === 0) return DEFAULT_LEARNER_CANCEL_WINDOW_HOURS
  if (!INTEGER_PATTERN.test(raw)) return DEFAULT_LEARNER_CANCEL_WINDOW_HOURS
  const parsed = Number(raw)
  if (
    !Number.isFinite(parsed)
    || !Number.isInteger(parsed)
    || parsed < MIN_LEARNER_CANCEL_WINDOW_HOURS
    || parsed > MAX_LEARNER_CANCEL_WINDOW_HOURS
  ) {
    return DEFAULT_LEARNER_CANCEL_WINDOW_HOURS
  }
  return parsed
}

export function getLearnerCancelThresholdMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return getLearnerCancelWindowHours(env) * 60 * 60 * 1000
}
```

### 3.2 `lib/scheduling/slots/types.ts` — route through the function

Replace:

```ts
export const LEARNER_CANCEL_THRESHOLD_MS = 24 * 60 * 60 * 1000

export function canLearnerCancel(slot, nowMs = Date.now()): LearnerCancelDecision {
  // ...
  if (diffMs < LEARNER_CANCEL_THRESHOLD_MS) {
```

With:

```ts
import { getLearnerCancelThresholdMs } from '@/lib/scheduling/policy'

export function canLearnerCancel(slot, nowMs = Date.now()): LearnerCancelDecision {
  // ...
  if (diffMs < getLearnerCancelThresholdMs()) {
```

The `LEARNER_CANCEL_THRESHOLD_MS` constant is removed. The re-export at `lib/scheduling/slots/index.ts:38` is removed. (Repo grep confirms no in-tree consumer beyond def + doc files — round-1 INFO #10.)

### 3.3 `lib/scheduling/slots/mutations-cancel.ts` — bind the window into SQL

Replace:

```sql
and start_at - now() >= interval '24 hours'
```

With:

```sql
and start_at - now() >= make_interval(hours => $5::int)
```

Bind `getLearnerCancelWindowHours()` as `$5`. The function is called once per `cancelSlotForLearner` invocation — same memoization-free pattern.

### 3.4 Server→client prop threading (round-1 BLOCKER #1 closure)

`app/cabinet/page.tsx:167` server component renders `<LessonsSection>`. Read the policy on the server and pass it as a prop:

```tsx
import { getLearnerCancelWindowHours } from '@/lib/scheduling/policy'

// ...inside the server component...
const cancelWindowHours = getLearnerCancelWindowHours()

<LessonsSection
  ...
  cancelWindowHours={cancelWindowHours}
/>
```

`app/cabinet/lessons-section.tsx`:

```tsx
// Round-1 BLOCKER #1 — was a hardcoded local 24h constant. Now
// receives the materialised window from the server component on
// every render, mirroring the server-side function output. No
// module-scope memoization; the prop refreshes on each page render.
//
// Round-2 WARN #2 — defensive fallback if the prop is missing or
// not a finite integer. Guards against TS-bypass paths (any-cast
// in a future caller, JSON-shape drift in a SSR hydration boundary
// edge case). Without this, `undefined * 60 * 60 * 1000 === NaN`
// and `diffMs < NaN === false` would silently leave the cancel
// button enabled — the WORST failure mode (UI shows enabled but
// server rejects, learner gets confusing 403 after click).
//
// Round-2 WARN #4 — the learner-facing copy "<24ч — через
// оператора" is recomputed from cancelWindowHours so a 6h policy
// shows "<6ч" not "<24ч".
type LessonsSectionProps = {
  // ...existing props...
  cancelWindowHours: number  // server-materialised; see app/cabinet/page.tsx
}

const FALLBACK_CANCEL_WINDOW_HOURS = 24

export function LessonsSection({ cancelWindowHours, ...rest }: LessonsSectionProps) {
  // Defensive runtime guard. Server-side TS will catch the
  // missing-prop case at compile time; this clamp handles any
  // out-of-band breakage.
  const effectiveWindow =
    Number.isFinite(cancelWindowHours) && Number.isInteger(cancelWindowHours)
      && cancelWindowHours >= 0
      ? cancelWindowHours
      : FALLBACK_CANCEL_WINDOW_HOURS
  const cancelThresholdMs = effectiveWindow * 60 * 60 * 1000

  function isTooLateToCancel(startAtIso: string): boolean {
    return new Date(startAtIso).getTime() - Date.now() < cancelThresholdMs
  }
  // ... in JSX, replace "<24ч — через оператора" with
  // `<${effectiveWindow}ч — через оператора` (Russian short-form
  // is grammatical at any integer). Replace the tooltip
  // "До начала менее 24 часов." with
  // `До начала менее ${effectiveWindow} ч.` (using "ч." instead of
  // "часов" sidesteps Russian plural agreement: ч. is invariant).
}
```

The local `HOURS_24_MS` constant + standalone `isTooLateToCancel` are removed. The closure version captures `cancelWindowHours` per render. React re-renders pick up the new value automatically; in practice the server-side `getLearnerCancelWindowHours()` only changes on app restart, so within one session the cabinet page sees a stable value.

### 3.5 Doc sweep (round-1 WARN #9 closure)

- `docs/plans/slots-split.md` — remove the `LEARNER_CANCEL_THRESHOLD_MS` export-surface entries; add a one-line note that policy now lives in `lib/scheduling/policy.ts`.
- `docs/plans/phase-5-lifecycle-24h-rule.md` — note that the 24h is the default, env-tunable via `LEARNER_CANCEL_WINDOW_HOURS` since POLICY-KNOBS (PR TBD).
- `docs/plans/prepay-postpay-billing.md` — same note.
- `docs/plans/admin-ux-coverage.md §3.3` — flip to "env-tunable today; /admin UI deferred to ALERTS-EDITOR follow-up."
- `ARCHITECTURE.md` — short note that the 24h gate is now `LEARNER_CANCEL_WINDOW_HOURS`-tunable; default unchanged.
- `OPERATIONS.md` — one-line pointer to `LEARNER_CANCEL_WINDOW_HOURS` env var + clamp range + "see private runbook for procedure" (per round-1 WARN #7 — does NOT attempt to land the private runbook delta).

## 4. Tests

`tests/scheduling/policy.test.ts` (new, unit, no DB):

1. **Default 24h.** No env set → `getLearnerCancelWindowHours() === 24`.
2. **Custom 6h.** Env `LEARNER_CANCEL_WINDOW_HOURS=6` → returns 6.
3. **No-gate 0h.** Env `=0` → returns 0; `getLearnerCancelThresholdMs() === 0`.
4. **Max 720h.** Env `=720` → returns 720.
5. **Strict parse — reject all malformed.** Each of these → returns 24 (default): `0.5`, `6h`, `24abc`, `+24`, ` 24 `, `24.0`, `-1`, `721`, ``, `abc`, `NaN`, `Infinity`. Pins round-1 BLOCKER #2 closure with explicit per-value assertions.
6. **No memoization.** `getLearnerCancelWindowHours()` returns 24, set env to `=12`, call again → returns 12 (no stale capture).

`tests/scheduling/can-learner-cancel.test.ts` (existing, extend):

7. **Exact-boundary case (round-1 WARN #6 closure).** Slot `start_at = now + 24h` exactly → `canLearnerCancel().ok === true` (the gate is `>= 24h`, so exactly-24h is allowed). Slot `start_at = now + 24h - 1ms` → `ok: false`. Pins the `<` vs `<=` fencepost across both TS and SQL (the SQL uses `>=` so equivalent).

`tests/integration/scheduling/cancel-learner-window-tunable.test.ts` (new, integration):

8. **Custom 6h actually gates the SQL UPDATE.** Set env to 6, create a booked slot 4h away, learner cancel → **403** `too_late_to_cancel` (round-1 WARN #5 — actual status is 403, not 422). Create another booked slot 7h away → 200 (cancelled).
9. **0h disables the gate.** Set env to 0, create a booked slot 1 minute away, learner cancel → 200 (cancelled). Confirms the WHERE clause degrades to `>= 0 hours` (always true for future-dated slots; past slots excluded by `status = 'booked'` invariants).
10. **Default 24h still works.** No env set, slot 25h away → 200, slot 23h away → 403. Pins the no-regression contract.

**Component-level testing — explicitly out of scope (round-2 WARN #3 closure).** `vitest.config.ts:7-11` includes only `tests/**/*.test.ts` (not `.tsx`), environment is `node`, and `package.json` has no `jsdom` or `@testing-library/react`. Introducing the full React-testing tier is its own wave (would need: jsdom dep + RTL dep + vitest config split for `node`/`jsdom` projects + setup file). NOT part of POLICY-KNOBS.

Coverage of the client prop wire is layered:

- **TS strict mode** catches the prop-threading mismatch at compile-time. `LessonsSection` declares `cancelWindowHours: number` as required; `app/cabinet/page.tsx` passes it; `npm run build` fails if the wire breaks.
- **The defensive runtime guard in §3.4** ensures that even if a hypothetical out-of-band caller misses the prop (any-cast, JSON drift), the UI defaults to 24h. The asymmetric failure modes:
  - **Server policy < 24h (e.g. 6h), prop broken → UI uses 24h.** UI shows button **disabled** for slots in [6h, 24h) where the server would actually accept. Conservative-confusing for the learner (sees "<24ч — через оператора" copy + disabled button when the server would have cancelled).
  - **Server policy > 24h (e.g. 48h), prop broken → UI uses 24h.** UI shows button **enabled** for slots in [24h, 48h) but the server returns 403. Learner sees the click silently fail (round-3 WARN #1 — the prior draft claimed this "cannot occur"; correction: it CAN occur if the prop wire breaks AND the operator policy is tighter than the fallback). Mitigated by: (a) TS strict mode catching the prop-threading mismatch at compile-time so this branch is unreachable on the happy path; (b) the 403 response payload still names `too_late_to_cancel` + `minutesUntilStart` for the cabinet's existing toast handler.

  The fallback is "least-surprise on a broken wire", not "perfect parity with the server" — perfect parity would require runtime fetch of the policy from the server, which adds a network round-trip to every render and creates its own SSR/CSR mismatch. TS + integration tests + the runtime guard together make this branch unreachable in practice.
- **Integration tests 8-10** cover the server policy end-to-end (HTTP + SQL gate). They do NOT cover the cabinet page rendering, but they verify that the policy that's threaded into the prop is the same one that gates the server side.
- An anchor comment in `app/cabinet/lessons-section.tsx` records: `// POLICY-KNOBS follow-up: component-level test once jsdom+RTL lands in vitest config`. Documented gap, not silent.

Full integration suite (existing) MUST stay green on the default path — `cancel-learner-flow`-style tests under `tests/integration/scheduling/lifecycle.test.ts` etc.

## 5. Failure modes / rollback

- **Env unset:** falls back to 24h. Identical to pre-POLICY-KNOBS.
- **Env malformed:** strict regex rejects → fallback to 24h. Pinned by test 5.
- **Operator sets `=0`:** gate disabled. Documented in OPERATIONS.md as an explicit operator decision.
- **Operator sets `=720` (max):** 30-day window. Edge but supported.
- **Operator sets `=721+`:** rejected → fallback to 24. Pinned by test 5.
- **Operator changes env without restart:** no effect. The server reads env on every request handler call, but Node's `process.env` snapshot is materialised at process start unless the operator explicitly updates the running process (which `systemctl restart` does by spawning a fresh process). The plan explicitly does NOT claim SIGHUP-style live-reload.
- **Mixed-instance topology:** N/A. Single-replica deployment today. If multi-instance lands later, ALERTS-EDITOR (DB-tunable) is the right vehicle for that — not env.
- **Rollback to pre-POLICY-KNOBS code:** env vars become inert. Safe.

## 6. Out of scope

- `/admin` UI knob (deferred to ALERTS-EDITOR follow-up).
- DB-backed `operator_settings` table.
- Refund-domain knobs (no separate constants exist — see §1.3).
- Per-teacher / per-pricing-tariff overrides.
- Audit log entry on env change.
- Multi-instance / rolling-deploy safety (single-replica deployment).
- Live `SIGHUP`-style reload without restart.

## 7. Acceptance

- New `lib/scheduling/policy.ts` exports `getLearnerCancelWindowHours()` + `getLearnerCancelThresholdMs()`, both memoization-free, strict-regex-parser.
- `lib/scheduling/slots/types.ts canLearnerCancel` reads the function on every call; `LEARNER_CANCEL_THRESHOLD_MS` constant + re-export removed.
- `lib/scheduling/slots/mutations-cancel.ts` cancel UPDATE binds the window into the SQL.
- `app/cabinet/page.tsx` server reads the policy + passes as prop; `app/cabinet/lessons-section.tsx` receives prop + removes its local hardcoded constant.
- New tests (unit + integration) green. Component-level tests explicitly deferred — gap documented in code anchor comment.
- Full integration suite (~650 tests) stays green.
- `npx tsc --noEmit` no new errors.
- Doc sweep: `slots-split.md`, `phase-5-lifecycle-24h-rule.md`, `prepay-postpay-billing.md`, `admin-ux-coverage.md`, `ARCHITECTURE.md`, `OPERATIONS.md` all updated.
- Plan-mode `/codex-paranoia` SIGN-OFF before code; wave-mode SIGN-OFF before PR.
- PR trailer: `Codex-Paranoia: SIGN-OFF round N/3` (standalone one-PR epic per skill §1.5).
