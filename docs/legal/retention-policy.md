# Personal data retention and deletion policy

> **Status: SKELETON.** This is an engineering skeleton: structure, the
> list of personal-data categories, and existing mechanisms. Retention
> periods, legal grounds, and formal wording **must be filled in**
> through `legal-rf-router → legal-rf-private-client → legal-rf-qa`,
> and only after that is the document a working policy. Every cell
> with `<!-- legal-rf: TODO -->` is waiting for legal review.

> This document is operator-facing. The public commitments on
> personal-data processing live in `app/privacy/page.tsx` and
> `app/consent/personal-data/page.tsx`. Any divergence between the
> public text and this document is resolved through the legal-rf
> pipeline in a single PR.

## 1. Purpose

- record the **personal-data categories** we actually collect
- for each category, where it lives, on what legal basis, with what retention period, and by what deletion mechanism
- give the operator a runbook for personal-data subject requests (152-FZ art.14, art.20, art.21)
- make the policy **auditable**: a regulator or auditor can match the declaration with the fact

## 2. Current consent mechanisms (already shipped)

This section describes the **existing** state, not a plan.

### 2.1 Versioning of signed consents

| Surface | Where the version lives | What is stored |
|---|---|---|
| Registration (`/register`) | `account_consents` (migration 0011) | `(account_id, document_kind='personal_data', document_version, document_path, accepted_at, ip, user_agent)`. Audit-trail row-per-acceptance; history is not collapsed. |
| Guest checkout (`/api/payments`) | `payment_orders.metadata.personalDataConsent` | snapshot from `buildPersonalDataConsentSnapshot()` in `lib/legal/personal-data.ts`: `documentVersion`, `documentPath`, `policyPath`, `acceptedAt`, `source='checkout'`, `ipAddress`, `userAgent`. Stored in order metadata; persists for the order's lifetime. |

**Current document version:** `PERSONAL_DATA_DOCUMENT_VERSION =
'2026-04-29.4'` (`lib/legal/personal-data.ts:1`). When a new revision
ships, the version is bumped in code; a fresh `account_consents` row
or a new `payment_orders.metadata` snapshot then automatically captures
which version the user signed.

### 2.2 The consent and policy text itself

| File | What |
|---|---|
| `app/offer/page.tsx` | public oferta |
| `app/privacy/page.tsx` | personal-data processing policy |
| `app/consent/personal-data/page.tsx` | consent on personal-data processing |
| `lib/legal/personal-data.ts` | server-side `PERSONAL_DATA_DOCUMENT_VERSION` plus snapshot helper |

Changes to those files go through `legal-rf-router → ... → legal-rf-qa`
(see `docs/legal-pipeline.md`) and land in commits with the
`Legal-Pipeline-Verified:` trailer.

## 3. Personal-data categories in the system

The list is based on the current code (the actual write points for
personal data).

| # | Category | Where stored | Purpose | Legal basis | Retention | Deletion mechanism |
|---|---|---|---|---|---|---|
| 1 | E-mail of a registered user | `accounts.email` (migration 0005) | identity in the cabinet, verification, password reset | <!-- legal-rf: TODO --> | <!-- legal-rf: TODO --> | <!-- legal-rf: TODO --> |
| 2 | Password hash | `accounts.password_hash` | authentication | <!-- legal-rf: TODO --> | <!-- legal-rf: TODO --> | deleted along with the `accounts` row |
| 3 | Sessions (cookie + DB row) | `account_sessions` (0007) | logged-in state | <!-- legal-rf: TODO --> | <!-- legal-rf: TODO; technically revoked on logout, expires via `SESSION_TTL_MS` --> | revoke endpoint plus cron on expired (cron pending; see backlog) |
| 4 | Email verification token | `email_verifications` (0008) | e-mail confirmation | <!-- legal-rf: TODO --> | until consume or expire | single-use enforcement in code; cleanup of expired pending |
| 5 | Reset-password token | `password_resets` (0009) | password reset | <!-- legal-rf: TODO --> | until consume or expire | single-use; cleanup of expired pending |
| 6 | Consent audit trail | `account_consents` (0011) plus the withdrawal column in 0013 | prove which version of the document the user signed; record the fact of consent withdrawal (152-FZ art.9 §5) | 152-FZ art.9 (consent itself, art.7 object); the audit itself is legitimate interest under art.6 §7 | <!-- legal-rf: TODO; suggestion: aligned with the 152-FZ statute of limitations --> | `withdrawConsent()` stamps `revoked_at`; the row remains as a fact of acceptance at time T but is no longer considered active. `getActiveConsent()` returns only unrevoked rows. |
| 7 | Payer e-mail (guest checkout) | `payment_orders.customer_email`, `payment_orders.receipt_email` | accept payment, send chek (54-FZ) | <!-- legal-rf: TODO; 54-FZ art.4.7 for the chek --> | <!-- legal-rf: TODO; 54-FZ requires storing OFD data ~5 years --> | <!-- legal-rf: TODO --> |
| 8 | Payment amount and status | `payment_orders.amount_rub`, `status`, `provider_transaction_id` | accept payment, reconcile with CloudPayments | <!-- legal-rf: TODO --> | <!-- legal-rf: TODO; 54-FZ for kassa records --> | append-only, not deleted |
| 9 | Guest consent snapshot | `payment_orders.metadata.personalDataConsent` | prove the fact of acceptance at payment | 152-FZ art.9 | lives for the lifetime of the order row | deleted along with the order |
| 10 | Saved card token (one-click) | `payment_card_tokens` (0002) | repeat payment without re-entering details | 152-FZ art.6 §5 (contract performance) when `rememberCard=true` | <!-- legal-rf: TODO --> | DELETE `/api/payments/saved-card` (user opt-out); the token is not persisted without consent |
| 11 | Checkout-funnel telemetry | `payment_telemetry` (0003) | product analytics | 152-FZ art.6 §7 (legitimate interest, privacy-friendly) | <!-- legal-rf: TODO --> | append-only; **e-mail stored as HMAC hash, IP /24-masked** |
| 12 | Payment audit log | `payment_audit_events` (0012) | incident forensics, audit obligation | 152-FZ art.6 §7 (legitimate interest), 54-FZ for payment operations | <!-- legal-rf: TODO; suggestion ~3 years --> | append-only, immutable; ON DELETE NO ACTION on the FK to `payment_orders` |
| 13 | Idempotency records | `idempotency_records` (0004) | dedup money-moving requests | art.6 §5 (contract performance) | <!-- legal-rf: TODO; ~24h to 7d is enough --> | cron cleanup pending; see backlog |

## 4. Personal-data subject requests (SAR)

### 4.1 What the subject can request (152-FZ)

- art.14: receive **information** on processing (what is stored, purposes, periods, legal basis)
- art.20: demand **clarification** or supplementation of data
- art.21: demand **cessation** of processing and / or **destruction**

### 4.2 Current process

**Right now: manual, by e-mail.** The subject writes to the operator's
contact e-mail (`<!-- FILL IN: contact e-mail from app/privacy/page.tsx -->`),
and the operator manually:

1. Verifies identity (the e-mail must match the registration / payment one).
2. For an art.14 request, prepares and sends back the §3 table with concrete values for that user.
3. For an art.21 request, runs the §5 sequence below.

**A machine-readable data export (GDPR-style data portability) is NOT
implemented and is not planned**: 152-FZ does not require it, and
art.14 is satisfied by an operator's free-form reply.

### 4.3 When a dedicated `/api/account/delete` endpoint is needed

When the manual process becomes the bottleneck, i.e. when deletion
requests exceed ~1/week. Until then, an engineering skeleton for the
endpoint is premature optimization. Implementation is a separate
backlog item, gated by actual load.

## 5. Cascade on art.21 deletion (skeleton)

For a full account-deletion request:

| Step | What | Where | Action |
|---|---|---|---|
| 1 | revoke sessions | `account_sessions` | `delete from account_sessions where account_id = $1` |
| 2 | invalidate verification / reset tokens | `email_verifications`, `password_resets` | `delete ... where account_id = $1` |
| 3 | delete the account | `accounts` | `delete from accounts where id = $1` (CASCADE to `account_roles`, `account_consents`) |
| 4 | anonymize payments | `payment_orders` | <!-- legal-rf: TODO; **do not delete**, conflicts with 54-FZ. Approach: replace email / name with `__erased__@__erased__` and mark metadata `{erased_at, erased_reason}`. Confirm wording. --> |
| 5 | delete card tokens | `payment_card_tokens` | `delete from payment_card_tokens where customer_email = $1` |
| 6 | anonymize audit | `payment_audit_events` | <!-- legal-rf: TODO; audit is immutable, but the e-mail can be replaced with `__erased__`. Conflicts with the audit goal of incident forensics; resolve via legal-rf. --> |
| 7 | telemetry | `payment_telemetry` | already privacy-friendly (HMAC e-mail plus /24 IP); no separate handling needed |

**The «full delete vs 54-FZ keep checks 5 years» conflict requires a
legal decision.** Working assumption: **anonymization, not deletion**.
Final wording from `legal-rf-private-client` and `legal-rf-qa`.

## 6. What's needed to flip SKELETON to ACTIVE

1. `legal-rf-router → legal-rf-private-client` fills every `<!-- legal-rf: TODO -->` cell: **retention period** plus **legal basis** plus **formal wording**.
2. `legal-rf-qa` review.
3. A PR with the finalized doc and trailer `Legal-Pipeline-Verified: legal-rf-router → legal-rf-private-client → legal-rf-qa (YYYY-MM-DD)`.
4. In parallel, add the contact e-mail for SAR requests to `app/privacy/page.tsx` (if not already present) **in the same PR**, through the same legal-rf pipeline.
5. File the Roskomnadzor notification on the start of personal-data processing (if not yet filed). Operator-side task, not code.

## 7. See also

- Versioning mechanics implementation: `lib/legal/personal-data.ts`, `lib/auth/consents.ts`, `migrations/0011_account_consents.sql`, `migrations/0012_payment_audit_events.sql`.
- Public consent and policy text: `app/offer/`, `app/privacy/`, `app/consent/personal-data/`.
- Hard guards for legal-file changes: `docs/legal-pipeline.md`.
- Architectural overview: `ARCHITECTURE.md` § Audit log plus § Auth and account layer.
- Operator runbook (psql, backup, retention): `OPERATIONS.md §5`.
