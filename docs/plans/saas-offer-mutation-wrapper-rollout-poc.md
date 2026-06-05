# SaaS-offer mutation-gate wrapper rollout — proof-of-concept (2026-06-04)

**Status:** SIGN-OFF round 5/3 (off-protocol cap extension; codex 2026-06-05). Path: r1 5B+3W (§0a) → r2 2B+3W+1I (§0b) → r3 2B+3W (§0c) → r4 2B+1W+1I (inline scrubbing of stale text in §0a-7/§0b-1/§0b-3 + body-shape-validation-inside-wrapper carve-out added to §0b-5 + audit-return-value check added to §2 account-scoped example) → **r5 SIGN-OFF (2 WARN + 1 INFO; WARNs are doc-index hygiene, fixed inline below)**.
**Author:** Claude (autonomous).
**Owner context:** Follow-up to `docs/plans/saas-offer-and-landing-redesign.md` (SIGN-OFF round 12/3). The parent plan defines an atomic Sub-A.2-3-5 bundle that migrates 24 mutating `/api/teacher/**` routes onto a race-safe saas-offer gate; this PoC is a SCOUTING PR that proves the wrapper pattern works on a 3-route subset BEFORE the full atomic bundle ships.
**Parent plan invariants this PoC respects:**
- `SAAS_OFFER_GATE_ENABLED` env-flag remains OFF in production after this PR (round-1 BLOCKER #1 closure §0a-1). No operator activation. Atomic activation lands with the parent Sub-A.2-3-5 bundle that covers all 24 routes simultaneously. CI tests exercise gate=ON to pin semantics.
- 2-rejection + 1-commit semantics at the wrapper boundary (round-1 WARN #8 closure §0a-8): `evaluateSaasOfferGateForMutation` returns `awaiting_publication` (503) or `consent_required` (403) as the only two rejection verdicts; everything else (`granted`, `gate_disabled`) falls through to the callback. The "4-state" wording in earlier drafts was wrong.
- Anti-spoof: `teacherId = session.account.id`, NEVER from body / params / URL — drift-test pinned (round-1 WARN #7 closure §0a-7).

## 0. Plan-paranoia gate

This file MUST go through `/codex-paranoia plan` rounds 1-3 BEFORE the PoC PR opens.

Round 1: 5 BLOCKER + 3 WARN (raw: `/tmp/codex-paranoia-20260605T062928Z-saas-offer-poc-plan/round-1.md`). All 8 findings closed in §0a.
Round 2: 2 BLOCKER + 3 WARN + 1 INFO (raw: `/tmp/codex-paranoia-20260605T062928Z-saas-offer-poc-plan/round-2.md`). All 6 findings closed in §0b.
Round 3: 2 BLOCKER + 3 WARN (raw: `/tmp/codex-paranoia-20260605T062928Z-saas-offer-poc-plan/round-3.md`). All 5 findings closed in §0c.
Round 4 (off-protocol cap extension): 2 BLOCKER + 1 WARN + 1 INFO (raw: `/tmp/codex-paranoia-20260605T062928Z-saas-offer-poc-plan/round-4.md`). Closures applied INLINE (no separate §0d section — fixes landed directly in §0a-7 / §0b-1 / §0b-3 / §0b-5 / §2 account-scoped example): (a) stale "uniform ordering" + "AST-aware" wording scrubbed; (b) for `orphan-slots/ignore` ONLY, body-SHAPE validation moves INSIDE the wrapper callback (the upstream JSON parse via `readJsonObjectOr400()` STAYS outside — it's content-agnostic); (c) audit-return-value check added to account-scoped example.
Round 5 (off-protocol cap extension): 2 WARN + 1 INFO. SIGN-OFF — fixed inline (status header + round-4 summary tightened to remove "§0d" / "body-parse-inside-wrapper" shorthand drift).

## 0a. Round-1 findings closures (round-2 prep)

### Closure §0a-1 — BLOCKER #1 (partial perimeter risk)

The PoC does NOT request operator activation of `SAAS_OFFER_GATE_ENABLED` in production. `SAAS_OFFER_GATE_ENABLED` remains DEFAULT OFF, and the existing fail-closed-on-DB-blip semantics in `lib/auth/guards.ts:300` + `tests/auth/saas-offer-gate-fail-closed.test.ts:72` are preserved unchanged (§0b-6 wording refinement).

The 2-step wrapper code lives in `lib/auth/guards.ts` and is exercised by the 3 migrated routes. CI tests exercise gate=ON to pin semantics. Atomic activation lands with the parent Sub-A.2-3-5 bundle (24 routes) — not this PR.

The drift-test in §0a-7 + §0b-3 pins that any future caller MUST use `runInSaasOfferMutationGate(auth.account.id, ...)`.

### Closure §0a-2 — BLOCKER #2 (abort contract ambiguity)

The abort contract is now SINGLE-PATH: the wrapper rolls back ONLY when the callback throws a `MutationGateAbort` (or any other throwable). Callback return values are ALWAYS treated as commit. Helpers that signal failure via return values (e.g. `{ ok: false }`) must NOT trigger rollback — the route maps them to a NextResponse AFTER the wrapper commits. If a route needs rollback on a typed failure, it MUST throw `MutationGateAbort.fromResponse(...)`.

Concrete contract documented inline in the wrapper docblock + pinned by 2 unit tests (rollback on throw vs commit on `{ok: false}` return).

### Closure §0a-3 — BLOCKER #3 (sentinel needs to carry the full response)

`MutationGateAbort` now carries a `response: NextResponse` field, constructed by the caller. The wrapper catches the sentinel and returns `err.response` unchanged. No status-code table inside `lib/auth/guards.ts`; each route keeps its own error-mapping logic.

```ts
class MutationGateAbort extends Error {
  constructor(public readonly response: NextResponse) { super('mutation_gate_abort') }
  static fromJson(body: unknown, init: ResponseInit): MutationGateAbort {
    return new MutationGateAbort(NextResponse.json(body, init))
  }
}
```

### Closure §0a-4 — BLOCKER #4 (uncomplete is not simple)

`app/api/teacher/lessons/[id]/uncomplete/route.ts` is dropped from PoC scope (owns its own TX + FOR UPDATE + 3 pre-delete gates + trigger error mapping — not a clean "wrap the helper" candidate). Replaced with `app/api/teacher/calendar/orphan-slots/ignore/route.ts`:
- 2 helper paths (`ignoreOrphanSelfSlot(...)` for single-slot, `ignoreAllOrphanSelfSlotsForTeacher(...)` for bulk).
- IP-scoped rate-limit (matches the existing perimeter shape).
- No retry loop, no advisory lock, no FOR UPDATE.
- Each helper gains optional `{ client?: PoolClient }` param.

Migration shape for each of the 3 routes (final scope):

| # | Route | Rate-limit | Helper(s) |
|---|---|---|---|
| 1 | `app/api/teacher/invites/[id]/revoke/route.ts` | account-scoped (existing) | `revokeInvite(inviteId, teacherId, opts?)` |
| 2 | `app/api/teacher/slots/[id]/dismiss-conflict/route.ts` | IP-scoped (existing) | inline `UPDATE lesson_slots ...` (no helper extracted; route passes `client` to `client.query`) |
| 3 | `app/api/teacher/calendar/orphan-slots/ignore/route.ts` | IP-scoped (existing) | `ignoreOrphanSelfSlot(...)` + `ignoreAllOrphanSelfSlotsForTeacher(...)` (both gain optional `{ client? }`) |

### Closure §0a-5 — BLOCKER #5 (incomplete test matrix)

The per-route test matrix expands from 5 to **7 cases**:

| # | Case | Pre-condition | Expected |
|---|---|---|---|
| 1 | happy path | gate OFF (flag unset) | 200/201 OK, side-effect persisted |
| 2 | wrong_role | anon OR learner | 401 / 403, no side-effect |
| 3 | rate-limit | N+1 requests in window | 429, no side-effect |
| 4 | gate_awaiting_publication | gate ON, placeholder live | 503 saas_offer_awaiting_publication, no side-effect, TX rolled back |
| 5 | gate_consent_required | gate ON, no consent | 403 saas_offer_consent_required, no side-effect, TX rolled back |
| 6 | granted (gate ON happy) | gate ON, consent present | 200/201 OK, side-effect persisted, TX committed |
| 7 | MutationGateAbort sentinel | callback throws sentinel | typed NextResponse, side-effect rolled back |

Per-route regression cases are ADDITIVE to this matrix — preserve the existing branch coverage:
- `invites/[id]/revoke`: 404 wrong-owner / wrong-id (case 1.a), 404 already-revoked (case 1.b).
- `slots/[id]/dismiss-conflict`: 404 not_found_or_no_conflict (slot not owned OR no conflict to dismiss).
- `calendar/orphan-slots/ignore`: `slotId` path + `all:true` path; 400 invalid_body; 404 single-slot not_found.

### Closure §0a-6 — WARN #6 (rate-limit type drift)

The 3 migrated routes span BOTH rate-limit patterns: `invites/[id]/revoke` is account-scoped (existing `enforceAccountRateLimit`); `slots/[id]/dismiss-conflict` and `calendar/orphan-slots/ignore` are IP-scoped (existing `enforceRateLimit`). The PoC PRESERVES each route's existing rate-limit type — no IP→account conversion is part of this PR. The example route-shape in §2 below shows both flavours explicitly.

If/when the parent Sub-A.2-3-5 bundle decides to unify rate-limit types, that's a separate decision with its own paranoia round.

### Closure §0a-7 — WARN #7 (drift guardrail)

Add a structure drift-test at `tests/security/saas-offer-mutation-gate-perimeter.test.ts`. Per §0c-2 refinement, the test uses an EXPLICIT ALLOWLIST + regex-based comment-strip token search (NOT a full AST parse — over-engineering for a 3-route allowlist; documented limitations in §0c-2):

1. `const POC_ROUTES = ['app/api/teacher/invites/[id]/revoke/route.ts', 'app/api/teacher/slots/[id]/dismiss-conflict/route.ts', 'app/api/teacher/calendar/orphan-slots/ignore/route.ts']`.
2. For each file: strip comments (` *// .*$` + `/\* ... \*/`), then assert the token sequence `runInSaasOfferMutationGate(auth.account.id,` appears in the handler body.
3. Negative assertion: each file must NOT contain `runInSaasOfferMutationGate(body.` / `runInSaasOfferMutationGate(params.` / `runInSaasOfferMutationGate(ctx.` (anti-spoof catch).
4. Per-route perimeter ordering pin (§0c-1 refinement): each route has its OWN expected token sequence (NOT uniform across routes — `invites/[id]/revoke` is `origin → auth → RL → gate`; the other two are `origin → RL → auth → gate`).

This complements `tests/security/teacher-perimeter-enumeration.test.ts` which pins canonical-guard + rate-limit presence but doesn't pin the gate-wrapper call shape or perimeter ordering.

### Closure §0a-8 — WARN #8 (4-state claim wrong)

Plan header rewritten to "2-rejection + 1-commit semantics at the wrapper boundary". Per §0b-4 refinement (SoT verification):

The wrapper's `evaluateSaasOfferGateForMutation` returns one of THREE verdicts (`lib/auth/guards.ts:432`): `ok` (commit path — covers BOTH gate-disabled AND granted-consent cases; these are NOT distinguished at the wrapper boundary), `consent_required` (→ 403), `awaiting_publication` (→ 503). The wrapper does not expose telemetry distinguishing "gate was OFF" from "consent matched". The parent plan's atomic Sub-A.2-3-5 bundle is the right place to add 4th-state observability if needed; this PoC explicitly does NOT introduce it.

## 0b. Round-2 findings closures (round-3 prep)

### Closure §0b-1 — BLOCKER #1 (test matrix still incomplete: origin + per-route perimeter ordering)

The 3 PoC routes have DIFFERENT perimeter orderings preserved from their live shape:

| Route | Perimeter ordering |
|---|---|
| `invites/[id]/revoke` | `origin → auth → account-RL → gate` |
| `slots/[id]/dismiss-conflict` | `origin → IP-RL → auth → gate` |
| `calendar/orphan-slots/ignore` | `origin → IP-RL → auth → gate` |

Test matrix expands from 7 to **9 cases per route**:

| # | Case | Pre-condition | Expected |
|---|---|---|---|
| 1 | happy path | gate OFF | 200/201 OK, side-effect persisted |
| 2 | wrong_role | anon OR learner | 401 / 403, no side-effect |
| 3 | rate-limit | N+1 in window | 429, no side-effect, gate NOT consulted (drained-bucket → no DB) |
| 4 | gate_awaiting_publication | gate ON, placeholder live | 503, no side-effect, TX rolled back |
| 5 | gate_consent_required | gate ON, no consent | 403, no side-effect, TX rolled back |
| 6 | granted (gate ON happy) | gate ON, consent present | 200/201, side-effect persisted, TX committed |
| 7 | MutationGateAbort sentinel | callback throws | typed NextResponse, side-effect rolled back |
| 8 | origin reject | cross-site POST | 403 origin, gate NOT consulted, NO DB |
| 9 | gate-first ordering | gate ON + consent_required + malformed UUID | 403 consent_required (NOT 404 not_found) |

Case 9 closes §0b-5 below — input validation must NOT leak before the gate verdict when gate=ON.

Additionally, the drift-test pin at `tests/security/saas-offer-mutation-gate-perimeter.test.ts` ALSO asserts per-route perimeter ordering using a per-route expected-sequence array (NOT uniform across routes; see §0c-1 for the exact per-route mapping). This is a separate concern from the call-shape pin in §0a-7 + §0b-3.

### Closure §0b-2 — BLOCKER #2 (recordAuthAuditEvent does not accept client)

The §2 account-scoped example was wrong: `recordAuthAuditEvent({ ..., client })` doesn't compile because `recordAuthAuditEvent` writes through a separate audit pool (`lib/audit/auth-events.ts:78-115`). The fix: keep the audit-event write OUTSIDE the wrapper TX, AFTER the wrapper commits successfully. The audit pool has its own connection lifecycle and is intentionally decoupled from the main mutation TX (audit is best-effort observability, not part of the atomic mutation contract).

Corrected example shape:
```ts
const result = await runInSaasOfferMutationGate(auth.account.id, async (client) => {
  const ok = await revokeInvite(id, auth.account.id, { client })
  if (!ok) throw MutationGateAbort.fromJson({error: 'not_found'}, {status: 404, headers: NO_STORE})
  return { ok: true }
})
if (result instanceof NextResponse) return result
// Audit-event AFTER commit (best-effort, separate pool).
await recordAuthAuditEvent({ eventType: 'auth.invite.revoked', accountId: auth.account.id, ... })
return NextResponse.json(result, { status: 200, headers: NO_STORE })
```

§2 example + §4 file inventory updated accordingly: NO change to `lib/audit/auth-events.ts`.

### Closure §0b-3 — WARN #3 (drift test too weak)

The drift test at `tests/security/saas-offer-mutation-gate-perimeter.test.ts` is rewritten with TWO complementary assertions:
1. **Explicit allowlist**: PoC defines `const POC_ROUTES = ['app/api/teacher/invites/[id]/revoke/route.ts', 'app/api/teacher/slots/[id]/dismiss-conflict/route.ts', 'app/api/teacher/calendar/orphan-slots/ignore/route.ts']`. The test reads each file, strips comments via regex (per §0c-2 — NOT AST parsing), then asserts the canonical call shape: each file must contain `runInSaasOfferMutationGate(auth.account.id,` as a literal token sequence in non-comment code.
2. **Negative assertion**: each file must NOT contain `runInSaasOfferMutationGate(body.` or `runInSaasOfferMutationGate(params.` or `runInSaasOfferMutationGate(ctx.` (anti-spoof drift catch).

Comment lines are stripped via a regex (` *// .*$` and `/\*[\s\S]*?\*/`) before the token search. The test file documents this trimming + its limitations (per §0c-2: not robust to comment-like tokens inside template literals, acceptable for the 3-route allowlist).

### Closure §0b-4 — WARN #4 (verdict claim still wrong)

§0a-8 rewritten to match SoT exactly:

> The wrapper's `evaluateSaasOfferGateForMutation` returns one of THREE verdicts: `ok` (commit path; covers BOTH gate-disabled and granted-consent cases — these are NOT distinguished at the wrapper boundary), `consent_required` (→ 403), `awaiting_publication` (→ 503). The wrapper does not expose telemetry distinguishing "gate was OFF" from "consent matched". The parent plan's atomic Sub-A.2-3-5 bundle is the right place to add 4th-state observability if needed; this PoC explicitly does NOT introduce it.

### Closure §0b-5 — WARN #5 (validation order leaks before gate)

The §2 dismiss-conflict example was wrong: UUID validation lived OUTSIDE the wrapper callback, which means a gate-rejected teacher with a malformed UUID would get 404 instead of 403/503. This violates the parent plan's "gate first" invariant.

Fix: per-route input validation moves INSIDE the wrapper callback. The wrapper opens a TX even for malformed inputs (small connection-acquisition cost), but the gate verdict is checked before ANY user-input observation surfaces. Test case 9 in §0b-1 pins this.

Corrected dismiss-conflict example:
```ts
const result = await runInSaasOfferMutationGate(auth.account.id, async (client) => {
  if (!UUID_PATTERN.test(id)) {
    throw MutationGateAbort.fromJson({error: 'not_found_or_no_conflict'}, {status: 404, headers: NO_STORE})
  }
  const r = await client.query(`update lesson_slots ...`, [id, auth.account.id])
  if (r.rows.length === 0) {
    throw MutationGateAbort.fromJson({error: 'not_found_or_no_conflict'}, {status: 404, headers: NO_STORE})
  }
  return { dismissed: id }
})
```

**Body-parse exception** (§0c-2 round-4 BLOCKER #2 closure): Body-parse stays OUTSIDE the wrapper ONLY when the route's body has no semantic content that could leak resource shape. For `dismiss-conflict` and `invites/[id]/revoke` there's no body. For `calendar/orphan-slots/ignore` the body discriminates `{ slotId: '<uuid>' }` vs `{ all: true }` — a malformed-body 400 leaks the schema BEFORE the gate verdict surfaces. Fix: `readJsonObjectOr400(request)` STAYS outside (just JSON parse), but the body-shape validation (`if (body.all === true) {...} else if (typeof body.slotId !== 'string') return 400`) MOVES INSIDE the wrapper callback for `orphan-slots/ignore` so a gate-rejected teacher sees 403/503 first. Concretely:

```ts
// In orphan-slots/ignore/route.ts:
const parsed = await readJsonObjectOr400(request, { coded: true })
if (!parsed.ok) return parsed.response  // generic JSON-malformed; gate semantics not yet relevant

const result = await runInSaasOfferMutationGate(auth.account.id, async (client) => {
  const body = parsed.body
  if (body.all === true) {
    return await ignoreAllOrphanSelfSlotsForTeacher(auth.account.id, { client })
  }
  if (typeof body.slotId !== 'string') {
    throw MutationGateAbort.fromJson(
      { error: 'invalid_body', message: 'Provide either `all: true` or `slotId: <uuid>`.' },
      { status: 400, headers: NO_STORE },
    )
  }
  const r = await ignoreOrphanSelfSlot({ teacherAccountId: auth.account.id, slotId: body.slotId, client })
  if (!r.ok) {
    throw MutationGateAbort.fromJson(
      { error: 'not_found', message: 'No orphan-self slot matched.' },
      { status: 404, headers: NO_STORE },
    )
  }
  return r
})
if (result instanceof NextResponse) return result
return NextResponse.json({ ignored: result.ignored }, { headers: NO_STORE })
```

### Closure §0b-6 — INFO #6 (over-strong "stays OFF" language)

§0a-1 rewritten: "The PoC does NOT request operator activation in production. `SAAS_OFFER_GATE_ENABLED` remains DEFAULT OFF, and the existing fail-closed-on-DB-blip semantics in `lib/auth/guards.ts:300` + `tests/auth/saas-offer-gate-fail-closed.test.ts:72` are preserved unchanged."

## 0c. Round-3 findings closures (round-4 prep)

### Closure §0c-1 — BLOCKER #1 (uniform perimeter ordering claim conflicts with per-route table)

The §0b-1 drift test mistakenly required a uniform `origin → RL → auth → gate` ordering across all 3 routes, but `invites/[id]/revoke` is `origin → auth → account-RL → gate` (auth-then-RL because the account-scoped rate-limit needs `auth.account.id`). The drift test now pins EACH route to its OWN documented ordering via a per-route expected-sequence array:

```ts
const POC_ROUTES_PERIMETER: Record<string, ReadonlyArray<string>> = {
  'app/api/teacher/invites/[id]/revoke/route.ts': [
    'enforceTrustedBrowserOrigin', 'requireTeacherAndVerified', 'enforceAccountRateLimit', 'runInSaasOfferMutationGate',
  ],
  'app/api/teacher/slots/[id]/dismiss-conflict/route.ts': [
    'enforceTrustedBrowserOrigin', 'enforceRateLimit', 'requireTeacherAndVerified', 'runInSaasOfferMutationGate',
  ],
  'app/api/teacher/calendar/orphan-slots/ignore/route.ts': [
    'enforceTrustedBrowserOrigin', 'enforceRateLimit', 'requireTeacherAndVerified', 'runInSaasOfferMutationGate',
  ],
}
```

The test reads each file, strips comments + block comments, then asserts the tokens appear in the documented order. §0a-7 + §0b-3 text in this doc is now correctly summarized as "per-route ordering pin, NOT uniform".

### Closure §0c-2 — BLOCKER #2 (AST-aware claim overstated)

§0b-3 wording is corrected: the drift test uses a regex-based comment strip (` *// .*$` for line comments; `/\*[\s\S]*?\*/` for block comments), NOT a full AST parse. The PoC's 3-route allowlist is small enough that regex-strip is sufficient; full AST parsing (e.g. via TypeScript Compiler API) is over-engineering for this scope.

Known limitations of the regex approach (documented in the test file's docblock so a future reader doesn't mis-trust the assertion):
- `//` or `/*` inside template literals or string literals would be incorrectly stripped. Mitigation: the 3 PoC routes don't contain such literals in their POST handlers (manually verified at PR review time + grep-pinned).
- The regex doesn't see TypeScript types. Acceptable — the test asserts handler call shape, not type information.

If the parent Sub-A.2-3-5 bundle's 24-route allowlist needs a more robust pin, a follow-up PR can swap the regex for a TypeScript Compiler API pass. Out of scope here.

### Closure §0c-3 — WARN #3 (audit-post-commit silent loss)

`recordAuthAuditEvent()` returns `boolean` (false = pool null OR swallowed DB error). The route example now checks the return value and emits a `console.warn` + Sentry breadcrumb (via the existing `lib/sentry/breadcrumbs.ts` if present, else just `console.warn`) when audit fails. The mutation still persists (correct), but operators get a signal that audit observability dropped a row.

Updated example shape (account-scoped):
```ts
const auditOk = await recordAuthAuditEvent({...})
if (!auditOk) {
  console.warn('[teacher.invites.revoke] audit-event recorder returned false', {
    accountId: auth.account.id, inviteId: id,
  })
  // Optional: addSentryBreadcrumb('auth_audit_dropped', { route: 'invites.revoke' })
}
```

This matches the existing best-effort semantics of `recordAuthAuditEvent` (it's intentionally separate from the mutation TX) while making the silent-drop case observable.

### Closure §0c-4 — WARN #4 (9-case matrix vs §7 acceptance drift; case 9 needs per-route framing)

- §7 acceptance criterion now says "9-test matrix" (was "7-test"). Doc-drift fixed.
- Case 9 is reframed: "gate-first ordering — for any input shape the route validates (UUID format, body schema, etc), a teacher with `consent_required` MUST see 403 BEFORE the input-shape error surfaces". The per-route mapping:

| Route | Case 9 trigger |
|---|---|
| `invites/[id]/revoke` | non-UUID `id` in URL path |
| `slots/[id]/dismiss-conflict` | non-UUID `id` in URL path |
| `calendar/orphan-slots/ignore` | missing `slotId` AND `all` in body |

### Closure §0c-5 — WARN #5 (parent plan doc-drift on consent_required status code)

`docs/plans/saas-offer-and-landing-redesign.md:1534-1542` mentions `consent_required` as `409` with a "verdict subtype" framing. This conflicts with the actual SoT (`lib/auth/guards.ts:591-614` returns 403) AND with this PoC. The PoC ITSELF is internally consistent with the SoT (403 throughout); the parent plan drift is OUT OF SCOPE for this PR.

Mitigation: added to §8 Risks as risk #8 (parent-plan reconciliation TODO for the next paranoia round on `saas-offer-and-landing-redesign.md`).

## 1. Scope

### In scope (single PR, codenamed `saas-offer-mutation-wrapper-poc`)

1. **Wrapper refactor — split into 2 composable helpers** (round-1 §0a-2 closure refined):
   - Keep existing `requireTeacherWithMutationGate(request, fn)` API for back-compat (already used by `tests/integration/legal/saas-offer-mutation-wrapper.test.ts`).
   - Add `runInSaasOfferMutationGate(accountId, fn)` that does ONLY the TX + gate + run-callback halves. No auth — caller authenticates first.
   - Refactor `requireTeacherWithMutationGate` internally to compose `requireTeacherAndVerified` + `runInSaasOfferMutationGate`. Single source of truth for the gate semantics.
   - Add `MutationGateAbort` class (§0a-3 closure) — caller throws to roll back + return a typed NextResponse.

2. **Migrate 3 representative teacher mutating routes** to the 2-step pattern. Final scope per §0a-4 table above.

3. **Each migrated route's helper gains optional `{ client?: PoolClient }` param** (additive object-destructured param; existing positional callers stay correct).

4. **Drift tests + per-route regression coverage** per §0a-5 + §0a-7.

### Out of scope (deferred to the atomic Sub-A.2-3-5 bundle in the parent plan)

- The remaining 21 mutating teacher routes.
- SSR-only cabinet layout gate.
- New `/api/teacher/saas-offer-accept` route.
- `lib/teacher-telegram-bind/actions.ts` extension.
- `legal-pipeline-check.sh` LEGAL_PATHS / LEGAL_PREFIXES extension (none of the 3 PoC routes are in legal scope).
- `docs/legal-pipeline.md` extension.
- Operator activation of `SAAS_OFFER_GATE_ENABLED` in production.

## 2. Example route shapes

### Account-scoped (e.g. `invites/[id]/revoke`)

```ts
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = enforceTrustedBrowserOrigin(request)
  if (origin) return origin

  const auth = await requireTeacherAndVerified(request)
  if (!auth.ok) return auth.response

  const rl = await enforceAccountRateLimit(auth.account.id, 'invite-revoke', 30, 60 * 60_000)
  if (rl) return rl

  const { id } = await context.params

  const result = await runInSaasOfferMutationGate(auth.account.id, async (client) => {
    const ok = await revokeInvite(id, auth.account.id, { client })
    if (!ok) {
      throw MutationGateAbort.fromJson(
        { error: 'not_found', message: 'Приглашение не найдено.' },
        { status: 404, headers: NO_STORE },
      )
    }
    return { ok: true }
  })
  if (result instanceof NextResponse) return result  // gate rejected
  // Audit event AFTER commit. §0b-2 closure: audit uses a separate pool
  // (lib/audit/auth-events.ts) and is best-effort; NOT part of the
  // atomic mutation TX. §0c-3 closure: check the return value + log on
  // silent drop so operators see observability gaps.
  const auditOk = await recordAuthAuditEvent({
    eventType: 'auth.invite.revoked',
    accountId: auth.account.id,
    email: auth.account.email,
    clientIp: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
    payload: { inviteId: id },
  })
  if (!auditOk) {
    console.warn('[teacher.invites.revoke] audit-event recorder returned false', {
      accountId: auth.account.id, inviteId: id,
    })
  }
  return NextResponse.json(result, { status: 200, headers: NO_STORE })
}
```

### IP-scoped (e.g. `slots/[id]/dismiss-conflict`)

```ts
export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(request, 'teacher:slot:dismiss-conflict:ip', 30, 60_000)
  if (rl) return rl

  const auth = await requireTeacherAndVerified(request)
  if (!auth.ok) return auth.response

  const { id } = await params

  // §0b-5 closure: per-route input validation moves INSIDE the wrapper
  // callback so the gate verdict runs FIRST. A teacher without consent
  // gets 403/503 even on a malformed UUID — never 404 (which would leak
  // resource-shape information).
  const result = await runInSaasOfferMutationGate(auth.account.id, async (client) => {
    if (!UUID_PATTERN.test(id)) {
      throw MutationGateAbort.fromJson(
        { error: 'not_found_or_no_conflict' },
        { status: 404, headers: NO_STORE },
      )
    }
    const r = await client.query(
      `update lesson_slots set ... where id = $1 and teacher_account_id = $2 ... returning id`,
      [id, auth.account.id],
    )
    if (r.rows.length === 0) {
      throw MutationGateAbort.fromJson(
        { error: 'not_found_or_no_conflict' },
        { status: 404, headers: NO_STORE },
      )
    }
    return { dismissed: id }
  })
  if (result instanceof NextResponse) return result
  return NextResponse.json({ ok: true, ...result }, { status: 200, headers: NO_STORE })
}
```

## 3. Rationale for the 2-step split (vs. afterAuth callback)

The existing wrapper does auth INSIDE itself, then opens a TX. Rate-limit happens AFTER auth in the standard route shape — putting rate-limit INSIDE the callback (= inside the TX) holds a Postgres connection while doing a Redis-like check, which is bad practice under load.

Two options were considered:

**Option A — `afterAuth` callback param**:
```ts
requireTeacherWithMutationGate(request, fn, { afterAuth: (account) => Promise<NextResponse | null> })
```
Concerns: extra closure passed by the caller; the wrapper signature grows; the rate-limit lives "inside" a higher-order function which is awkward to read.

**Option B — split into 2 composable helpers** (CHOSEN):
```ts
const auth = await requireTeacherAndVerified(request)
if (!auth.ok) return auth.response
const rl = await enforceAccountRateLimit(...)
if (rl) return rl
const result = await runInSaasOfferMutationGate(auth.account.id, async (client) => {...})
```
Pros: each step is a vanilla function call; rate-limit lives where it always has; no extra callback wrapping; back-compat preserved via the legacy `requireTeacherWithMutationGate` composing both halves internally; test surface stays narrow.
Cons: 2 extra LOC per route (negligible).

**Decision:** Option B. The legacy `requireTeacherWithMutationGate` stays as sugar for routes that DON'T need rate-limit (the test file is one such caller); new migrated routes call the 2 halves separately.

## 4. File-level inventory

### EXTEND

- `lib/auth/guards.ts` — add `runInSaasOfferMutationGate(accountId, fn)`; add `MutationGateAbort` class; refactor `requireTeacherWithMutationGate` to compose the two halves internally.
- `lib/auth/teacher-invites.ts` — `revokeInvite()` gains optional `{ client? }` param.
- `lib/calendar/orphan-cleanup.ts` (or wherever the orphan-slots-ignore helpers live) — `ignoreOrphanSelfSlot(...)` + `ignoreAllOrphanSelfSlotsForTeacher(...)` gain optional `{ client? }` params.
- `app/api/teacher/invites/[id]/revoke/route.ts` — migrate to 2-step pattern.
- `app/api/teacher/calendar/orphan-slots/ignore/route.ts` — same.
- `app/api/teacher/slots/[id]/dismiss-conflict/route.ts` — same (inline UPDATE pattern; no helper extraction needed).

### NEW

- `tests/security/saas-offer-mutation-gate-perimeter.test.ts` — drift test pin per §0a-7.

### TESTS

- `tests/integration/legal/saas-offer-mutation-wrapper.test.ts` — add coverage for `runInSaasOfferMutationGate` direct callers + the `MutationGateAbort` sentinel (rollback on throw vs commit on `{ok: false}` return).
- 3 per-route integration test files (or extend existing if present) — each covers the **9-case matrix** per §0b-1 (7 from §0a-5 + 2 new: origin-reject + gate-first-ordering).

## 5. Rollout

Single PR. The `SAAS_OFFER_GATE_ENABLED` env flag stays DEFAULT OFF in production. CI tests exercise gate=ON to pin semantics. No operator activation in this PR — atomic activation lands with the parent Sub-A.2-3-5 bundle.

## 6. Paranoia + PR trailer

This is a standalone one-PR epic per `~/.claude/skills/codex-paranoia/SKILL.md §1.5`:
- `/codex-paranoia plan` on this doc → SIGN-OFF before any code lands.
- `/codex-paranoia wave` on the commit range → SIGN-OFF before PR open.
- PR trailer: `Codex-Paranoia: SIGN-OFF round N/3` (one-PR epic; plan + wave collapsed).

## 7. Acceptance criteria

- All 3 migrated routes pass the **9-test matrix per route** (§0c-4 corrected from §0a-5's earlier "7-test" wording).
- `tests/integration/legal/saas-offer-mutation-wrapper.test.ts` passes (back-compat) + new tests for the 2-step path + MutationGateAbort sentinel.
- `tests/security/saas-offer-mutation-gate-perimeter.test.ts` passes (drift pin).
- `npm run build` green.
- `npm run check:env-contract` green.
- Codex paranoia plan + wave SIGN-OFF.
- Owner-relevant invariants preserved: anti-spoof (`auth.account.id` only), gate-OFF default in prod, gate-ON 2-rejection-or-commit semantics, no auth-bypass.

## 8. Risks + escalations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Helper refactor (optional `client?` param) breaks existing callers that pass positional args. | The optional param is ADDITIVE (object destructured at end of arg list). All existing positional call-sites stay correct. |
| 2 | `MutationGateAbort` thrown across an `await` chain could be swallowed by a try/catch in helper internals. | Helpers MUST NOT catch `MutationGateAbort` (only route code throws it). Drift-test pin: grep `catch.*MutationGateAbort` in `lib/**` returns empty. |
| 3 | Future drift-PR might move auth + rate-limit + body-parse INSIDE the gate TX. | Drift test §0a-7 pins call-shape; `tests/security/teacher-perimeter-enumeration.test.ts` already pins canonical-guard + rate-limit presence. |
| 4 | Test pollution between cases (account_consents / legal_document_versions persisted). | Per-test `delete from` cleanup inside `beforeEach` / inside the `seedLiveVersion` helper (existing pattern). |
| 5 | Race between gate verdict read + commit (BLOCKER #6 closure on parent plan §0af). | `set transaction isolation level repeatable read` already in wrapper — preserved. |
| 6 | Caller passes `params.id` or `body.teacherId` to `runInSaasOfferMutationGate` instead of `auth.account.id` (anti-spoof slip). | Drift test §0a-7 regex-pin; grep at PR review time as backup. |
| 7 | `MutationGateAbort` thrown from callback gets re-wrapped by a generic try/catch in the route → wrapper sees a non-sentinel Error, rolls back AND throws. | Route examples show NO catch around `runInSaasOfferMutationGate` call. Convention documented in the wrapper docblock. |
| 8 | Parent `saas-offer-and-landing-redesign.md:1534-1542` references `consent_required` as 409, conflicting with SoT (403). | Out of scope for this PoC PR. TODO for the next paranoia round on the parent plan-doc — reconcile to match SoT (`lib/auth/guards.ts:591-614`). §0c-5 closure. |
