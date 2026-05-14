# Skill-pipeline guardrail

Cross-project rule (`~/.claude/COMPANY.md` § "GSTACK skills as primary
execution layer"): non-trivial engineering moves go through a GSTACK
skill (`/ship`, `/review`, `/codex`, `/investigate`, `/document-release`,
etc.) — not via hand-rolled `gh pr create`, ad-hoc `codex exec`, or
manual debug sessions.

This guardrail makes that rule **mechanically enforced** in the
LevelChannel repo. Mirrors the structure of `docs/legal-pipeline.md`.

We cannot inspect a different agent's session to prove a skill literally
ran. We can enforce that every commit carrying a non-trivial diff leaves
a written record of which skill (or documented exception) covered the
work. Silent freehand becomes visible at the commit / PR level.

## Why this exists

Failure mode caught 2026-05-14 (LevelChannel session shipping waves
BCS-E.worker → BUG-3): the agent shipped 7 PRs back-to-back via raw
`git commit` + `gh pr create` + bespoke `codex exec` invocations.
None of the skills `/ship`, `/codex`, `/review`, `/document-release`,
`/investigate` were called. Cost: re-derived checklists round-by-round,
missed structural quality gates (VERSION bump, CHANGELOG voice
polish, doc sweep), lost cross-wave learnings that `/learn` captures.

Documentation alone (AGENTS.md § Skill routing) wasn't sufficient. The
commit-msg trailer + CI gate makes the bypass visible.

## Protected scope

Any commit whose diff exceeds the **size threshold** below is treated
as non-trivial and requires the trailer.

| Threshold | Value |
|---|---|
| ≥ N files in `app/`, `lib/`, `tests/`, `migrations/` | 3 |
| OR ≥ N lines added+removed in those trees | 100 |

Doc-only commits (touching only `*.md`, `docs/`, `CHANGELOG.md`,
`README.md`, etc.) are exempt. Comment-only diffs are exempt
(see "Trivial exceptions" below).

If a commit's diff is below the threshold (e.g. a one-line config
tweak, a typo fix, a copy edit), no trailer is required — same
philosophy as legal-pipeline's per-file-list scope.

## The marker

A git commit message trailer:

```
Skill-Used: <non-empty value>
```

Required when any commit exceeds the threshold above.

**Recommended values (substantive change):**

```
Skill-Used: /ship
Skill-Used: /codex review (round 2 LGTM)
Skill-Used: /investigate — flaky integration test root cause
Skill-Used: /review — pre-merge diff audit
Skill-Used: /document-release — post-ship doc sweep
Skill-Used: /plan-eng-review — wave plan locked
Skill-Used: /qa — post-deploy regression
Skill-Used: /context-save — session handoff snapshot
```

Multiple skills allowed, comma-separated:

```
Skill-Used: /investigate, /codex review (round 1)
```

**Trivial / non-substantive (use sparingly):**

```
Skill-Used: trivial — typo, no semantic change
Skill-Used: trivial — comment polish only
Skill-Used: trivial — dependency bump auto-merge
Skill-Used: drive-by — flaky test fix during ship of unrelated PR
```

`trivial` is a documented exception: the diff happens to exceed the
threshold but didn't benefit from skill coordination cost (e.g. a
3-file sed-rename, an auto-formatted diff). The reason is part of the
audit trail. Over-broad `trivial` claims surface in `/review`.

`drive-by` is for fixes piggybacked into another wave's PR (e.g. the
`refunds.test.ts` flaky fix landed in PR #205 BUG-2 rather than its
own PR). The reason names the unrelated work; the PR description
must call out the drive-by separately so future agents can attribute
correctly.

## How enforcement works

| Layer | Where | What it does |
|---|---|---|
| Commit-msg hook | `.githooks/commit-msg` | Local refusal: rejects the commit if its diff exceeds the threshold and the message has no trailer. |
| CI check | `.github/workflows/skill-pipeline.yml` | Per-commit walk on every PR. Every commit whose diff exceeds the threshold must carry the trailer. Failing CI blocks merge. |
| Shared logic | `scripts/skill-pipeline-check.sh` | Single threshold + matcher implementation reused by hook and CI. |

The hook activates when `core.hooksPath` is set to `.githooks`. The
`postinstall` npm script wires this on every fresh clone (already in
`package.json`, set up by the legal-pipeline guardrail). To set it
manually:

```bash
git config core.hooksPath .githooks
```

## Bypass paths

You **cannot** silently bypass the CI check; PRs to `main` require it
to pass.

You **can** bypass the hook locally with `git commit --no-verify`. The
CI check then catches it on the PR. Don't rely on `--no-verify`; the
trailer is the cheaper path. Project policy (`AGENTS.md` § Risk
discipline) treats `--no-verify` as a hard stop that requires explicit
user approval.

Merge commits, revert commits, and squash-merge "Merge pull request"
commits are exempt — they don't represent freshly-authored work.
Dependabot / Renovate bot commits are exempt.

## Adding the guardrail to another project

The pattern is portable. To add it elsewhere:

1. Copy `scripts/skill-pipeline-check.sh`, adjust `WATCHED_TREES`
   and the threshold values to match the new repo's source layout.
2. Wire `.githooks/commit-msg` to call it (chain after any existing
   guardrails the repo carries).
3. Copy `.github/workflows/skill-pipeline.yml`, point it at the new
   workflow name.
4. Add a `postinstall` script that sets `core.hooksPath` (or merge
   with the existing one).
5. Copy `.github/pull_request_template.md` and tune the skill checklist
   to the project's primary routing surface.

For company-level reference, this pattern is mentioned in
`~/.claude/COMPANY.md` § "GSTACK skills as primary execution layer".

## Relationship to legal-pipeline

The two guardrails are independent and additive. A single commit can
require both trailers — e.g. a substantive edit to `app/offer/page.tsx`
needs `Legal-Pipeline-Verified:` AND `Skill-Used:`. The hooks chain;
each one fails its own way; both must clear.

## Audit signal

`scripts/session-audit.sh` is a read-only diagnostic that reports
whether a recent session's commits carry the trailer. Use after a
multi-PR session to confirm the trail before closing out:

```bash
bash scripts/session-audit.sh --since "2 hours ago"
```

Exit code is informational (does not block); the goal is visibility,
not a second blocking gate.
