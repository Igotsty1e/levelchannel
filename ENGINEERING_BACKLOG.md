# Engineering Backlog

Index of currently-active engineering work. Per-epic detail lives under [`docs/backlog/`](docs/backlog/).

This file is the **index**: a one-line pointer per epic. Detail (active items, hardening trail, closure rows, audit history) lives in the per-epic file. Top-level is intentionally lean (~80 lines) so future agents reading "what's next" don't blow context on a 200+ line wall.

If a task already works in code or on the server, it does not belong here.

## Active waves

- [BCS-DEF — Calendar follow-ups + Google sync](docs/backlog/bcs-def.md) — DEF-1 shipped, DEF-7 Phase 1 shipped, DEF-2 parked, DEF-4/5 + TG/PUSH plan-ready, DEF-1-TG/FANOUT plan-ready.
- [SaaS pivot (SAAS-1..6)](docs/backlog/saas-pivot.md) — SAAS-1 (5.A/5.D/5.F + FOLLOWUP-KEYBOARD shipped), SAAS-2 copy sweep complete, SAAS-3+4 shipped, SAAS-5 shipped, SAAS-6 multi-week.

## Cross-cutting tech debt

- [Cross-cutting tasks](docs/backlog/cross-cutting.md) — DOC-MODULE-CONTRACTS, API-BOUNDARIES, CRITICAL-PATH-INVENTORY, COVERAGE-PAYMENTS. DOC-SPLIT closed by this PR.

## Closed

- [Audit findings (2026-05-17 wave)](docs/backlog/audit-findings.md) — 20/20 SEC/CODE/DOC items shipped 2026-05-17.
- [Bug intake (2026-05-13)](docs/backlog/bug-intake.md) — 7/7 closed.
- [Historical archive](docs/backlog/archive/historical-2026-05.md) — pre-2026-05-15 waves.

## Recently shipped — 2026-05-19 autonomous wave

Single-day burst. See [`bcs-def.md`](docs/backlog/bcs-def.md), [`saas-pivot.md`](docs/backlog/saas-pivot.md), and [`archive/2026-05-19-autonomous-wave.md`](docs/backlog/archive/2026-05-19-autonomous-wave.md) for the categorised list of ~54 PRs.

## Invariants (BCS lock order, etc.)

See [`docs/backlog/bcs-def.md` §Invariants](docs/backlog/bcs-def.md#invariants).

## Archive rotation policy

When a wave is fully shipped + retro-recorded, its section moves to `docs/backlog/archive/<wave-name>.md` and a one-line pointer stays here (or in the per-epic file). Active surface stays lean; archive is for forensic / audit review.
