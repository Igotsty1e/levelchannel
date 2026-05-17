# LevelChannel Architecture

## Overview

LevelChannel is a single Next.js application that combines a public marketing surface, a payment flow, and an account foundation.

## Main components

- `app/`: public pages, auth pages, legal pages, cabinet + admin surfaces, and API routes
- `components/`: presentation and interaction components, including checkout UI and calendar surfaces
- `lib/payments/`: payment config, provider integrations, webhook verification, one-click flow, and storage adapters
- `lib/auth/` and `lib/email/`: account lifecycle, sessions, consent recording, and transactional email
- `lib/scheduling/` and `lib/calendar/`: slot lifecycle, Calendly-style booking, and two-way Google Calendar sync (push + pull + post-pull conflict detector)
- `lib/pricing/` and `lib/billing/`: tariff catalog and package billing layer
- `lib/security/`: request validation, origin checks, and rate limiting
- `scripts/`: migrations, key rotation helpers, and systemd-driven probes / cron workers

## Core flows

1. A visitor lands on the public site and enters checkout details.
2. The app validates amount, e-mail, and consent before creating an order.
3. Payment status changes are reconciled through provider callbacks and server-side validation.
4. An authenticated learner can browse the package catalog and buy a multi-lesson package; race-safe purchase gates prevent concurrent pending or already-active duplicates of the same duration.
5. The operator can manage tariffs, packages, slots, and learner accounts from `/admin`. They can grant a package directly to a learner (refund-credits, marketing comps, customer-service make-goods) without going through the payment provider — recorded as a synthetic audit-bearing order with a separate provider taxonomy.
6. The operator can review alert-probe observability at `/admin/settings/alerts` (last run / last alert / effective thresholds + dry-run test-send) and operator-reconcile `paid_not_granted` package orders at `/admin/reconciliation/package-grants`.
7. Audit and telemetry layers record operational signals with different privacy levels.
8. The account layer supports registration, session handling, verification, and password reset for the cabinet surface.

## Design constraints

- the project is server-rendered and runs as a Node.js app
- payment integrity is server-owned
- legal consent capture is part of the runtime, not an afterthought
- file storage remains as a fallback, while Postgres is the intended long-term backend

## Boundaries

- public docs intentionally exclude production host details, operator contacts, and deploy runbooks
- internal operations remain documented separately from the product-facing architecture layer
