# Roadmap

This file holds high-level priorities for the next stage. Concrete
engineering tasks live in `ENGINEERING_BACKLOG.md`.

## P0

### Compliance

- ~~file the Roskomnadzor notification on the start of personal data processing~~: **closed 2026-05-04**. Filed by the operator.
- promote the retention / deletion policy from skeleton to ACTIVE: the skeleton is already at [`docs/legal/retention-policy.md`](docs/legal/retention-policy.md), retention periods and legal wording get filled in through `legal-rf-router → legal-rf-private-client → legal-rf-qa`
- machine-readable data-export endpoint is **not planned**: 152-FZ art.14 is satisfied by a free-form operator reply over e-mail

### Production operations

- ~~wire up uptime monitor on `/api/health`~~: closed (see `OPERATIONS.md §9`)
- routinely verify `pg_dump` backups and the restore drill (cron active since 2026-04-29)
- routinely verify the rollback drill and the state of the git-based autodeploy

## P1

### Operator visibility

- get usable visibility into payments and their statuses
- get a clear handle on payment failures and incidents

### Service reliability

- improve observability over the app and the webhook contour

## P2

### Operator tooling and growth

- add operator notifications for significant payment events
- improve payment funnel analytics
- if a measurable conversion case appears, return to product-level checkout improvements

## Notes

- `ROADMAP.md` carries outcome-level priorities
- `ENGINEERING_BACKLOG.md` carries the implementation queue
- `OPERATIONS.md` carries the actual production state
