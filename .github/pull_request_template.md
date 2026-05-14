<!-- LevelChannel PR template — keep this checklist in every PR. -->

## Summary

<!-- 1-3 bullets: what shipped + why. -->

## Test plan

<!-- Check what you actually ran. Don't leave unchecked items as
implicit promises. -->

- [ ] `npm run build` clean
- [ ] `npm run test:run` green (unit suite)
- [ ] `npm run test:integration` green (if domain logic / routes / DB touched)
- [ ] Manual click-through against `PAYMENTS_PROVIDER=mock` (if payment domain touched)

## Skill gates — per `AGENTS.md` §4 + `docs/skill-pipeline.md`

> Per-commit `Skill-Used:` trailer is enforced by hook + CI. This
> checklist is the human-readable mirror — fill in what applies.
>
> Mark **N/A** for gates that don't apply (e.g. doc-only PR), don't
> silently leave unchecked.

- [ ] `/plan-eng-review` — for waves spanning ≥3 PRs, or new architecture (or N/A)
- [ ] `/codex review` — independent adversarial pass before merge (or N/A)
- [ ] `/review` — for diffs touching `lib/payments/` or `lib/security/` (or N/A)
- [ ] `/ship` collected this PR — not raw `gh pr create` (or N/A — trivial typo / drive-by)
- [ ] `/document-release` scheduled post-merge — README / ARCHITECTURE / CHANGELOG / CLAUDE.md sync (or N/A)
- [ ] `/qa` after deploy — if route-level change to a user-facing flow (or N/A)
- [ ] `/investigate` was the entry point — if this PR closes a bug / 500 / regression (or N/A)
- [ ] `/learn` will run at session end if this PR uncovered a cross-project pattern (or N/A)

## Deferred / follow-ups

<!-- What you didn't do in this PR that was tempting. Names the
backlog item or paths a future PR will revisit. -->

## Legal-pipeline

<!-- Required if this PR touches app/offer, app/privacy, app/consent,
lib/legal, docs/legal, or scripts/legal-v1-templates. See
docs/legal-pipeline.md. -->

- [ ] N/A — no regulated text touched
- [ ] `Legal-Pipeline-Verified:` trailer present on every legal-touching commit
