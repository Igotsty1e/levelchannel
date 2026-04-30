# PR Notes

## Summary

Prepare the repository for public-readiness review without publishing
it. The branch removes internal operational detail from the tracked
surface, moves legal/public profile values to environment
configuration, and adds public-facing documentation.

## Main Changes

- rewrite the public-facing `README.md`
- add `SECURITY.md`
- add `docs/public/` architecture, roadmap, and AI workflow notes
- add `docs/github-readiness/` audit and final report
- replace tracked `OPERATIONS.md` and `PRD.md` with public-safe stubs
- move sensitive legal operator and bank details out of committed page
  code
- add production-time validation for required public legal profile env
  vars
- remove the telemetry hashing fallback secret

## Validation

- `npm run test:run -- tests/payments/telemetry-store.test.ts tests/audit/webhook-flow-decide.test.ts`
- production-like smoke check for missing legal env vars

## Remaining Manual Follow-Up

- keep deployment env values aligned with the intended public company
  profile
