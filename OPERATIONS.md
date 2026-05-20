# Operations Note

The detailed production operations runbook for LevelChannel is intentionally
kept outside the tracked repository surface.

This file remains only as a public-safe pointer.

## What is private

- server inventory and access procedures
- deployment and rollback runbooks
- backup and retention operations
- incident response checklists
- operator-only alerting and maintenance procedures

## Public boundary

Public repository readers should use:

- `README.md` for project orientation
- `DOCUMENTATION.md` for the documentation map
- `ARCHITECTURE.md` for the runtime code map
- `SECURITY.md` for trust boundaries and hardening notes
- `docs/public/` for public-facing architecture and roadmap context

## Operator-tunable env knobs (pointers only — procedure lives in the private runbook)

- `LEARNER_CANCEL_WINDOW_HOURS` — minimum hours-until-start required
  for a learner self-service cancel. Default 24; clamp [0..720]; 0
  disables the gate (operator policy). Strict integer parser — any
  malformed value (whitespace, sign, decimal, non-digit) falls back
  to default 24. Implemented in `lib/scheduling/policy.ts` since
  POLICY-KNOBS (2026-05-17). See the private runbook for the
  operator procedure (env-file edit + systemctl restart).

- `SBP_ENABLED` — operator gate for the SBP QR endpoint
  `POST /api/payments/sbp/create-qr`. Default off (route responds
  503 `sbp_disabled`). Set to literal `'true'` to revive once the
  CloudPayments-side merchant terminal has SBP activated — flip
  this BEFORE testing the route, NOT after. Exact-match guard
  rejects truthy strings other than `'true'`. Operator procedure:
  (1) confirm SBP live in the CloudPayments dashboard, (2) edit
  `$ENV_FILE` → `SBP_ENABLED=true`, (3) `systemctl restart
  levelchannel`. The `/pay` UI does not need a re-ship — SBP
  surfaces as a payment method inside the standard CloudPayments
  widget. Added by PAY-SBP-REMOVAL (2026-05-20).

## Maintenance rule

Do not reintroduce production hostnames, server IPs, private SSH commands,
or operator procedures into this file.
