# LevelChannel Architecture

## Overview

LevelChannel is a single Next.js application that combines a public marketing surface, a payment flow, and an account foundation.

## Main components

- `app/`: public pages, auth pages, legal pages, and API routes
- `components/`: presentation and interaction components, including checkout UI
- `lib/payments/`: payment config, provider integrations, webhook verification, one-click flow, and storage adapters
- `lib/auth/` and `lib/email/`: account lifecycle, sessions, consent recording, and transactional email
- `lib/security/`: request validation, origin checks, and rate limiting
- `scripts/`: migrations and operational helpers

## Core flows

1. A visitor lands on the public site and enters checkout details.
2. The app validates amount, e-mail, and consent before creating an order.
3. Payment status changes are reconciled through provider callbacks and server-side validation.
4. Audit and telemetry layers record operational signals with different privacy levels.
5. The account layer supports registration, session handling, verification, and password reset for the growing cabinet surface.

## Design constraints

- the project is server-rendered and runs as a Node.js app
- payment integrity is server-owned
- legal consent capture is part of the runtime, not an afterthought
- file storage remains as a fallback, while Postgres is the intended long-term backend

## Boundaries

- public docs intentionally exclude production host details, operator contacts, and deploy runbooks
- internal operations remain documented separately from the product-facing architecture layer
