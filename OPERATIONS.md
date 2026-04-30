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

## Maintenance rule

Do not reintroduce production hostnames, server IPs, private SSH commands,
or operator procedures into this file.
