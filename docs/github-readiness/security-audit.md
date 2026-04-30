# Security Audit

## Summary

- Risk level: Medium
- Safe for public: Almost
- Critical issues:
  - production legal and support contact values still require an intentional publication review before release

## Findings

| Severity | File | Issue | Risk | Fix |
|---|---|---|---|---|
| Medium | `app/offer/page.tsx`, `app/privacy/page.tsx`, `app/consent/personal-data/page.tsx`, `app/page.tsx`, `lib/legal/public-profile.ts` | legal pages now depend on env-driven operator identity and banking details | wrong or unintended public contact data can still be deployed if env values are reviewed poorly | keep production-time validation and require a human publication pass over the final values |

## Required fixes

- confirm the production legal profile values are intentionally public before publication

## Recommended fixes

- keep public-facing docs separate from private operations runbooks
- prefer repository-relative links in committed docs
- keep `.env*`, logs, and generated files ignored by git
- keep legal operator identity and banking details outside committed source by default
