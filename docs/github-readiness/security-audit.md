# Security Audit

## Summary

- Risk level: Low
- Safe for public: Yes
- Critical issues:
  - none in the tracked source tree after cleanup

## Findings

| Severity | File | Issue | Risk | Fix |
|---|---|---|---|---|
| Low | `app/offer/page.tsx`, `app/privacy/page.tsx`, `app/consent/personal-data/page.tsx`, `app/page.tsx`, `lib/legal/public-profile.ts` | legal pages now depend on env-driven operator identity and banking details | deployment can still drift if env values are managed carelessly | keep production-time validation and align deployment env values with the intended public company profile |
| Low | `scripts/public-surface-check.sh`, `.githooks/pre-commit`, `.github/workflows/public-surface-check.yml` | guardrail is pattern-based, so new infra identifiers must be added intentionally when the private/public boundary changes | drift can reappear if the denylist is not maintained | update the guardrail in the same diff whenever a new private path or identifier family appears |

## Required fixes

- none beyond normal deployment hygiene for public legal profile env values

## Recommended fixes

- keep public-facing docs separate from private operations runbooks
- prefer repository-relative links in committed docs
- keep `.env*`, logs, and generated files ignored by git
- keep legal operator identity and banking details outside committed source by default
