# Documentation Map

This file defines the documentation layout. When an agent does not
know which document to read first, it starts here.

## Principle

Every topic has a single owner document. If the same rule is described
in two places, agents will almost certainly drag in the stale version.

## Quick agent routing

### Get oriented quickly

1. `README.md`
2. `DOCUMENTATION.md`
3. the topic-specific owner document

### Code and architecture

1. `ARCHITECTURE.md`
2. `PAYMENTS_SETUP.md` if the payment contract changes
3. `SECURITY.md` if the trust boundary or hardening changes

### Prod, server, DB, deploy, logs, backups

1. private operations runbook (not committed to the public repository surface)
2. never stage `docs/private/*` or `*.private.*`; `public-surface-check`
   blocks them locally and in CI

### Strategy and next stage

1. `ROADMAP.md` for product, operational, and legal priorities
2. `ENGINEERING_BACKLOG.md` for the concrete implementation queue

### Public legal text

1. `app/offer/page.tsx`
2. `app/privacy/page.tsx`
3. `app/consent/personal-data/page.tsx`
4. `OPERATIONS.md` if the question hinges on actual storage, retention, or server

### Historical context

1. private historical PRD copy
2. `docs/plans/*`: archive of planning and review artifacts, not source of truth

### Public-facing docs

1. `docs/public/ARCHITECTURE.md`
2. `docs/public/ROADMAP.md`
3. `docs/public/AI_WORKFLOW.md`

### Repository readiness

1. `docs/github-readiness/security-audit.md`
2. `docs/github-readiness/final-report.md`

## Ownership matrix

| Document | Owns | Should not carry |
|---|---|---|
| `README.md` | project entry, stack, commands, doc map | backlog, runbook, temporary statuses |
| `DOCUMENTATION.md` | doc map, navigation rules, ownership zones | product decisions, infra details, backlog |
| `ARCHITECTURE.md` | file-by-file system map and runtime flow | roadmap, deploy checklist, operator instructions |
| `PAYMENTS_SETUP.md` | payment contract, env contract, webhook contract, payment modes | production runbook, backlog, product strategy |
| `SECURITY.md` | security boundaries, threat model, hardening gaps | deploy steps, product roadmap |
| `OPERATIONS.md` | public-safe operations note that points to the private runbook | detailed server inventory, secrets handling, incident runbook |
| `ROADMAP.md` | high-level product, operations, and compliance priorities | low-level implementation tasks |
| `ENGINEERING_BACKLOG.md` | implementation task queue | deploy facts, public legal text |
| `PRD.md` | public-safe note that points to the private historical PRD | current decisions as source of truth |
| `docs/plans/*` | archive of design / implementation plans | current shipped state and owner contracts |

## Conflict rule

If documents disagree, priority is:

1. code and actual runtime
2. the topic owner document
3. `README.md`
4. `ROADMAP.md` and `ENGINEERING_BACKLOG.md`, which carry intent, not fact
5. private historical PRD copy, as historical context only

## Update rules

- If the code structure changes, update `ARCHITECTURE.md`.
- If the payment flow, env contract, webhook flow, or one-click changes, update `PAYMENTS_SETUP.md`.
- If prod, deploy, server, retention, backup, or rollback changes, update the private operations runbook and keep `OPERATIONS.md` as a public-safe pointer.
- If you need a private runbook copy locally, keep it under `docs/private/`
  only as an ignored file. Do not remove that ignore rule.
- If the trust boundary, consent capture, headers, rate limit, or webhook verify changes, update `SECURITY.md`.
- If a new idea or direction appears, first decide whether it is a strategic priority or an implementation task:
  - outcome-level work goes to `ROADMAP.md`
  - concrete engineering work goes to `ENGINEERING_BACKLOG.md`
- Do not duplicate the same backlog across `ROADMAP.md`, `README.md`, and `PAYMENTS_SETUP.md`.

## Rule for agents

Before editing a document, answer two questions:

1. Does this file own the topic or only refer to it?
2. After my edit, will there be a second source of truth on the same topic?

If the second answer is "yes", the edit is wrong.
