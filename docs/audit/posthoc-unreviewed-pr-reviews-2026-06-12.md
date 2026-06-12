# Post-hoc Review — Unreviewed PR Cluster (2026-06-11..12)

Post-factum review memo for the recent merged PR cluster that did **not**
receive a real Codex sign-off before merge. Intended as a handoff artifact
for Claude Code follow-up.

## Scope

Reviewed merged PRs from the current unreviewed cluster:

- PR #617 — `feat(scheduling,billing): package picker + billing-state endpoint`
- PR #618 — `feat(scheduling): bulk-assign-direct`
- PR #620 — `fix(time-picker): scroll-snap wheel`
- PR #621 — `fix(seed): wipe covers payment_claims/refunds/dispatches/push subs`
- PR #622 — `fix(mobile): keep "+ Назначить ученику" visible on mobile`
- PR #623 — `feat(calendar): unify top-row buttons + drop slot_mode setting`
- PR #624 — `fix(single-slot): use TimeRangeRow`
- PR #625 — `fix(teacher): restore payment-methods editor access`
- PR #626 — `fix(payments): design audit — mobile clearance + dedup + action overflow`
- PR #627 — `fix(payments): localize errors + package coverage + past status + no-show copy`

Selection rule:

- PR body explicitly says `self-review`, `Codex quota`, `epic-end review pending`,
  or
- PR body has no meaningful `Codex-Paranoia` review trail at all.

Method: merged diff review + current `main` code inspection. This is a
post-merge review, not a pre-landing gate.

## Findings

### P1 — PR #617 + PR #618: direct-assign UI exposes payment choices that the backend hard-rejects when pair payment method is `none`

Files:

- [components/calendar/AssignDirectModal.tsx](/Users/ivankhanaev/LevelChannel/components/calendar/AssignDirectModal.tsx:365)
- [components/calendar/AssignDirectModal.tsx](/Users/ivankhanaev/LevelChannel/components/calendar/AssignDirectModal.tsx:882)
- [lib/scheduling/slots/mutations-assign-direct.ts](/Users/ivankhanaev/LevelChannel/lib/scheduling/slots/mutations-assign-direct.ts:165)

What happens:

- The modal auto-selects `billingChoice='package'` whenever matching packages exist.
- The UI still renders both `Списать с пакета` and `Счёт после` choices even when
  `billingState.paymentMethod === 'none'`.
- The backend rejects **all** such submissions at the earlier per-pair gate:
  `method === 'none' -> payment_method_not_set`.

Why this is a bug:

- The modal presents actionable choices that are dead on submit.
- The warning copy is also misleading: it says the lesson "will be assigned"
  but postpaid will not work, while the server currently blocks the whole flow.

Claude follow-up:

1. Decide the real contract:
   - either `payment_method='none'` blocks direct-assign completely,
   - or package-backed direct-assign should still be allowed.
2. Then align both layers:
   - if blocked: disable/hide both choices and replace with a blocking banner,
   - if allowed for package: move the `payment_method_not_set` gate after the
     package-consume branch and test the package-only path.
3. Add an integration test for `paymentMethod='none' + active package`.

### P2 — PR #627: learner rename form regressed from specific server validation messages to a generic failure

Files:

- [app/teacher/learners/[id]/rename-form.tsx](/Users/ivankhanaev/LevelChannel/app/teacher/learners/%5Bid%5D/rename-form.tsx:17)
- [app/teacher/learners/[id]/rename-form.tsx](/Users/ivankhanaev/LevelChannel/app/teacher/learners/%5Bid%5D/rename-form.tsx:71)
- [lib/i18n/teacher-errors.ts](/Users/ivankhanaev/LevelChannel/lib/i18n/teacher-errors.ts:6)
- [app/api/teacher/learners/[id]/rename/route.ts](/Users/ivankhanaev/LevelChannel/app/api/teacher/learners/%5Bid%5D/rename/route.ts:155)

What happens:

- The form comment still says "We surface server-side errors verbatim via `data.message`".
- The implementation no longer does that. It only tries `localizeTeacherError(data?.error)`
  and otherwise falls back to a generic message.
- `localizeTeacherError` does **not** cover rename-specific route errors like
  `email_in_use`, `displayName_too_long`, `firstName_too_long`, `lastName_too_long`,
  `wrong_archetype`, `noop`, etc.

Why this is a bug:

- A teacher now loses field-specific feedback for common validation failures.
- This is worse than the previous behavior and contradicts the inline contract comment.

Claude follow-up:

1. Restore `data.message` fallback for this form, or
2. Expand `localizeTeacherError()` with the full rename-route error surface.
3. Add a render/integration test that asserts `email_in_use` and `*_too_long`
   show actionable text, not the generic save failure.

### P2 — PR #627: past refunded lessons are mislabeled as `не оплачено`

Files:

- [app/cabinet/lessons-section.tsx](/Users/ivankhanaev/LevelChannel/app/cabinet/lessons-section.tsx:144)
- [app/cabinet/lessons-section.tsx](/Users/ivankhanaev/LevelChannel/app/cabinet/lessons-section.tsx:503)

What happens:

- `derivedSlotLabel()` only receives `isPaid`.
- Past `booked` slots that were paid and later refunded are not in `paidSet`,
  so they render as `не оплачено`.
- The component already has `refundedSet`, but the derived-label path ignores it.

Why this is a bug:

- `не оплачено` is not the same state as "was paid, then refunded".
- The new status derivation introduced by PR #627 collapses these two cases.

Claude follow-up:

1. Thread `isRefunded` into `derivedSlotLabel()`, or
2. Render a separate refunded label in the past list, analogous to the existing
   upcoming-slot refunded pill.
3. Add a component test for `past + booked + refunded`.

## Reviewed With No Material Findings

No material review findings found in this pass for:

- PR #620
- PR #621
- PR #622
- PR #623
- PR #624
- PR #625
- PR #626

This is not a proof of perfection. It means no clear bug/regression surfaced
from the merged diff + current-main inspection in this pass.

## Suggested Next Work Order

1. Fix the direct-assign `paymentMethod='none'` contract mismatch (PR #617/#618).
2. Restore specific rename validation messages (PR #627).
3. Fix refunded past-slot status derivation (PR #627).
