# Legal pipeline guardrail

Cross-project rule (`~/.claude/CLAUDE.md` § legal-rf): any work involving
Russian legal source-of-truth — public oferta, privacy policy, consent text,
and the on-server consent metadata — must flow through
`legal-rf-router → profile skill → legal-rf-qa` before landing.

This guardrail makes that rule **mechanically enforced** in the LevelChannel
repo. It does not verify that the pipeline literally ran (we cannot inspect
a different agent's session). It does enforce that every commit which mutates
a regulated file leaves a written record of intent — making silent bypass
visible at the commit/PR level.

## Protected scope

Any change to these files or paths is treated as legal-sensitive:

| Path | What it carries |
|---|---|
| `app/offer/page.tsx` | Public публичная оферта |
| `app/privacy/page.tsx` | Public политика обработки ПДн |
| `app/consent/personal-data/page.tsx` | Public consent text used at checkout |
| `lib/legal/**` | Server-side legal SoT (consent versions, snapshot helpers) |
| `docs/legal/**` | Future legal-only doc surface (currently empty) |
| `app/{offer,privacy,consent}/**` | Catches new legal pages added under same trees |

If you find yourself editing a file that carries legal commitments but is
not in the list above (e.g. a new `app/dpa/page.tsx`), update the list in
[`scripts/legal-pipeline-check.sh`](../scripts/legal-pipeline-check.sh) in
the same commit and run the pipeline.

## The marker

A git commit message trailer:

```
Legal-Pipeline-Verified: <non-empty value>
```

Required when any file in the protected scope is touched (added, modified,
or deleted). Free-form value, but two recommended shapes:

**Substantive change (default):**

```
Legal-Pipeline-Verified: legal-rf-router → legal-rf-commercial → legal-rf-qa (2026-04-29)
```

Records which skills consulted, plus the date qa cleared the change.

**Trivial / non-substantive (sparingly):**

```
Legal-Pipeline-Verified: trivial-fix — typo only, no semantic change
```

Use only when the diff is provably non-substantive (typo, formatting, dead
link, asset path). The reason is part of the audit trail; an over-broad
"trivial-fix" claim will surface in future review.

## How enforcement works

| Layer | Where | What it does |
|---|---|---|
| Commit-msg hook | `.githooks/commit-msg` | Local refusal: rejects the commit if any staged file is legal-sensitive and the message has no trailer. |
| CI check | `.github/workflows/legal-pipeline.yml` | Per-commit walk on every PR: every commit touching legal scope must carry the trailer. Failing CI blocks merge. |
| Shared logic | `scripts/legal-pipeline-check.sh` | Single matching/trailer implementation reused by hook and CI. |

The hook activates when `core.hooksPath` is set to `.githooks`. The
`postinstall` npm script wires this on every fresh clone. To set it
manually (for example in a worktree before `npm install` runs):

```bash
git config core.hooksPath .githooks
```

## Bypass paths

You **cannot** silently bypass the CI check; PRs to `main` require it.

You **can** bypass the hook locally with `git commit --no-verify`. The CI
check then catches it on the PR. Don't rely on `--no-verify` — the trailer
is the cheaper path. Project policy ([`AGENTS.md`](../AGENTS.md) § Risk
discipline) treats `--no-verify` as a hard stop requiring explicit user
approval.

## Adding a new project to the same pattern

The guardrail is intentionally portable. To add it to another repo:

1. Copy `scripts/legal-pipeline-check.sh`, edit `LEGAL_PATHS` /
   `LEGAL_PREFIXES` for that repo's legal SoT.
2. Copy `.githooks/commit-msg` (or vendor `.git/hooks/commit-msg`).
3. Copy `.github/workflows/legal-pipeline.yml`.
4. Add `postinstall` script to set `core.hooksPath`.

For company-level reference, this pattern is mentioned in
`~/.claude/CLAUDE.md` § legal-rf.
