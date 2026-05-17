# LevelChannel Roadmap

## Current phase

MVP feature hardening around the package billing surface, calendar
sync, and admin operator tooling. Tariff-checkout + payment ops are
on the maintenance track; the active stage is rounding out the
cabinet + admin coverage so a single operator can run the platform
without SSH.

Shipped in the May 2026 wave:

- Calendly-style booking + two-way Google Calendar sync (push + pull
  + post-pull conflict detector).
- Learner-facing package catalog at `/cabinet/packages` with a buy
  CTA; race-safe purchase gates serialised against admin grants and
  delayed webhooks on the same `pkg-stack:` advisory lock.
- Operator-driven non-money package grant at `/admin/packages` →
  `Выдать пакет` (refund-credits, marketing comps, customer-service
  make-goods) with audit + idempotency.
- Operator observability for the systemd alert probes at
  `/admin/settings/alerts` (last run / last alert / effective
  thresholds + dry-run test-send).
- Operator reconciliation for `paid_not_granted` package orders at
  `/admin/reconciliation/package-grants` (retry-grant /
  attach-account / mark-resolved).

## Near-term work

- keep the payment and webhook flow robust under real operational load
- expand the cabinet and account lifecycle carefully on top of the shipped auth foundation
- continue Postgres-first migration while preserving file-mode fallback where useful
- reduce internal-only repository surface before any public release

## Medium-term work

- improve operator visibility and monitoring
- deepen compliance and retention automation
- turn the minimal cabinet into a fuller learner-facing product surface

## Constraints

- do not weaken payment safety for speed
- keep operational and legal responsibilities explicit
- avoid overstating current product scope beyond the shipped checkout and account foundation
