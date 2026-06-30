# Self-review — Telegram bind contract, modal fix, and teacher push disable on notifications page

**Plan under review:** [telegram-bind-contract-modal-fix-2026-06-30.md](/Users/ivankhanaev/LevelChannel/docs/plans/telegram-bind-contract-modal-fix-2026-06-30.md)  
**Review date:** 2026-06-30  
**Method:** gstack-style multi-lens self-review, grounded in `autoplan` / `plan-eng-review` / `plan-design-review` expectations, then reduced to one final sign-off decision.

## Final decision

**SIGN-OFF**

No remaining blocker was found for planning quality. Residual risk is implementation QA, not plan ambiguity.

## Findings and closures

### 1. BLOCKER, root cause ambiguity between prod outage and UI drift

Risk:

- If the real problem were webhook/proxy delivery, the plan would fix the wrong thing.

Closure:

- Production evidence on **June 30, 2026** shows `/start ZLNLZJFV` successfully binds.
- Therefore webhook delivery, secret auth, and bind consume logic are alive.
- The incident is correctly scoped as contract drift plus modal UX, not as a platform-wide Telegram outage.

Status: **closed**

### 2. BLOCKER, risk of creating a parallel Telegram bind surface

Risk:

- A rushed fix could add a new route or duplicate helper, increasing drift.

Closure:

- The plan explicitly extends:
  - `app/api/telegram/webhook/route.ts`
  - `components/teacher/digest-settings/bind-code-modal.tsx`
  - `components/teacher/digest-settings/telegram-card.tsx`
  - existing teacher bind action surface
- The plan explicitly forbids a new route.

Status: **closed**

### 3. BLOCKER, modal copy might remain misleading even if backend is fixed

Risk:

- If raw code is re-enabled but the modal still nudges raw-code-first behavior, the UX stays ambiguous.

Closure:

- The plan changes the canonical instruction to `/start <code>`.
- The copy button becomes `Скопировать команду`.
- Clipboard content becomes `/start <code>`.
- Raw code remains supported only as a compatibility alias, not as the primary taught flow.

Status: **closed**

### 4. BLOCKER, stale-state UX not fully addressed

Risk:

- Even after bind succeeds, user may still see `Не привязан`, which would preserve the "integration is broken" perception.

Closure:

- The plan adds explicit status reconciliation while the modal is open.
- Trigger points are defined:
  - focus return,
  - visibility return,
  - optional short interval while modal is open.
- The plan also calls out the current one-time `initialBound` local-state problem.

Status: **closed**

### 5. WARN, parser broadening might over-accept messages

Risk:

- Raw 8-character messages could broaden accepted input more than needed.

Closure:

- The accepted format stays narrow: `^[A-Z0-9]{8}$`.
- Mutation still goes through existing `handleStart`.
- Existing DB lookup, TTL, single-use semantics, and rate limit remain unchanged.

Status: **accepted risk**

### 6. WARN, plan could under-spec tests

Risk:

- Without explicit regression tests, the same drift could reappear.

Closure:

- The plan includes route, modal, state, and content-style coverage.
- The repo-required command bar is also included.
- Because a teacher cabinet surface is touched, the plan includes `npm run test:e2e:product-flows`.

Status: **closed**

### 7. BLOCKER, teacher notifications page still leaks unshipped Push

Risk:

- If the plan fixed only Telegram but left `/teacher/settings/digest` exposing Push as a live channel, the teacher notifications contract would remain misleading.

Closure:

- The plan now explicitly scopes `/teacher/settings/digest`.
- It identifies both current leaks:
  - intro copy claiming `Email, Telegram, Push`
  - active `Push` column in `NotificationPreferencesMatrix`
- It requires teacher Push to be absent or clearly deferred on that page until the dedicated teacher-push wave ships.

Status: **closed**

### 8. WARN, plugin/browser usage might be performative rather than useful

Risk:

- The owner explicitly asked to use strong skills/plugins. If the plan ignored that, the review process would be weak.

Closure:

- Skill docs were read before drafting:
  - `autoplan`
  - `plan-eng-review`
  - `plan-design-review`
  - `browse`
- Playwright plugin path was exercised against the local dev server.
- Result: browser binaries are absent on this machine, so live browser QA is an environment gap, not a planning blocker.

Status: **closed with environment note**

## Lens review

### CEO / product lens

Score: **8.5/10**

Good:

- Fixes the actual user pain, not the wrong subsystem.
- Keeps scope narrow and fast.
- Restores trust in the integration flow.
- Removes a second misleading teacher-notifications affordance instead of leaving an obvious half-shipped channel on screen.

Could have gone wrong:

- Over-scoping into webhook/proxy infra or a full integrations redesign.

Decision:

- Scope is right for an incident-response wave.

### Engineering lens

Score: **9/10**

Good:

- Reuses one bind path.
- No schema churn.
- No duplicate route.
- Explicitly calls out state ownership bug in the client.

Watch item:

- Implementation should keep status refresh minimal and not invent a large polling framework.

Decision:

- Architecture is coherent and sufficiently bounded.

### Design / UX lens

Score: **8/10**

Good:

- Primary action is made canonical.
- Copy becomes honest.
- Success state gets a defined feedback loop.
- Notifications page stops advertising an unready channel as if it were usable.

Still intentionally not solved in this wave:

- Full modal visual redesign.
- Broader integrations page polish beyond Telegram bind UX.

Decision:

- Strong enough for this wave. Visual redesign can stay separate.

### DX / maintenance lens

Score: **8.5/10**

Good:

- One-file route extension, one modal owner, one card owner.
- Regression tests are specified.
- Existing product/eval contract is respected.

Watch item:

- If implementation adds a read-only status helper, name it next to existing teacher bind actions, not in a new stray namespace.

Decision:

- Maintainable.

## Remaining residual risks

1. Live browser QA is blocked until Playwright browsers are installed locally.
2. The plan assumes no hidden prod-only branch in Telegram bot behavior beyond the evidence from June 30, 2026.
3. The exact implementation shape of status refresh still needs disciplined minimalism during coding.

None of these are blockers for implementation.

## Sign-off statement

This plan is ready for implementation.

It has:

- one confirmed root cause,
- one adjacent teacher-notifications contract cleanup,
- one bounded compatibility fix in the webhook,
- one honest modal contract,
- one explicit stale-state fix path,
- a clear regression test bar,
- no unresolved blocker.

**Decision: SIGN-OFF for implementation.**
