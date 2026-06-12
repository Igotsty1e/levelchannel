# Engineering Backlog

Concrete engineering task queue. This file describes what still needs
to be implemented, not the current actual state of production.

If a task already works in code or on the server, it does not belong
here.

This file is now a thin **index**. Each epic lives in its own file
under [`docs/backlog/`](docs/backlog/) — see DOC-SPLIT entry below for
the rationale. Historical / fully-shipped waves live under
[`docs/backlog/archive/`](docs/backlog/archive/).

## Active epics

- [Wave BCS — Booking Calendly-style + Google Calendar sync](docs/backlog/bcs-wave.md) — main calendar/sync epic family; BCS-DEF-1/2/3/4/5/7 + SBP-PAY shipped; BCS-DEF-4-TG-LINK / -PUSH / -PER-USER-WIN / -ADMIN-PAGE / -UNSUB / -PER-SLOT / -VOL-ALERT + BCS-DEF-5-TG / -PUSH + SBP-REFUND-AUTO + BCS-ADMIN-UX still ACTIVE.
- [SaaS-pivot scope](docs/backlog/saas-pivot.md) — SAAS-1..SAAS-6 product pivot from single-teacher-channel to multi-teacher SaaS; foundation docs first, multi-week sweep; SAAS-1 + follow-ups + SAAS-6-A11Y-1 SHIPPED, SAAS-2..6 ACTIVE.
- [Cross-cutting backlog](docs/backlog/cross-cutting.md) — DOC-SPLIT (this file) / DOC-MODULE-CONTRACTS / API-BOUNDARIES / CRITICAL-PATH-INVENTORY / COVERAGE-PAYMENTS; status ACTIVE.

## Cross-cutting / tech debt

- [Coverage ratchet plan](docs/tech-debt/COVERAGE_RATCHET_PLAN.md) — gradual
  expansion of `vitest.config.ts` coverage thresholds from the original
  12-file base to load-bearing `lib/billing`, `lib/scheduling/slots`,
  `lib/calendar`, `lib/teacher-ledger`, `lib/audit`, `lib/admin` modules.
  Status: partially shipped (unit + integration ratchet passes landed
  2026-06-03); remaining next-pass priorities refreshed 2026-06-12.
- [Backend architecture + business-process audit (2026-06-12)](docs/audit/backend-architecture-and-business-process-audit-2026-06-12.md) —
  owner-facing audit note covering post-MVP backend seams: unstable
  full-suite signal, reminder-cron fixture/integrity issue, `payment_orders`
  multi-writer drift, operator-settings mirror debt, and suggested next
  PR order for Claude follow-up.
- [Post-hoc review of unreviewed PR cluster (2026-06-11..12)](docs/audit/posthoc-unreviewed-pr-reviews-2026-06-12.md) —
  merged PRs #617/#618/#620..#627 reviewed after the fact; AssignDirectModal
  paymentMethod=none contract aligned + rename form errors + refunded label
  shipped in Wave 1 follow-up (2026-06-12); 0 actionable findings remain.
- [Product-flow evals registry](evals/PRODUCT_FLOWS.md) +
  [URL/redirect contract](evals/URL_REDIRECT_CONTRACT.md) — live source of truth
  for flow-level expectations enforced by Playwright + content-style +
  env-contract checks via `.github/workflows/product-flow-evals.yml`.

## Closed / informational

- [Audit findings — 2026-05-17](docs/backlog/audit-2026-05-17.md) — three parallel sub-agent audits (4 SEC + 8 CODE + 8 DOC); status SHIPPED (20/20 closed across PR #252-#268).
- [Bug intake — 2026-05-13](docs/backlog/bug-intake-2026-05-13.md) — 7 product-owner bug reports; status SHIPPED (all 7 closed).
- [Recently shipped — 2026-05-19 autonomous wave](docs/backlog/recently-shipped-2026-05-19.md) — single-day burst, ~54 PRs; status SHIPPED (informational cross-reference).

## Archive

Closed waves, post-incident learnings, pre-ALERTS-EDITOR historical content (2026-05-07 .. 2026-05-15) extracted 2026-05-18 to [`docs/backlog/archive/historical-2026-05.md`](docs/backlog/archive/historical-2026-05.md). Top-level keeps only the currently-active surface; archive is for forensic / audit review.

Future archive rotation: when a wave is fully shipped + retro-recorded, its section moves to `docs/backlog/archive/<wave-name>.md` and a one-line pointer stays here.
