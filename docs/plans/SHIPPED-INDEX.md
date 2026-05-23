# Shipped plan-docs index

Plans below have all merged to main. Detail in each file's body; this index is the entry point — read it before opening individual plan-docs.

Active plan-doc work (not yet shipped) lives in `docs/plans/*.md` without an entry here.

## 2026-05 saas-pivot wave (10 PRs merged 2026-05-22)

- **`saas-pivot-master.md`** — 8-epic SaaS pivot master plan (32 paranoia rounds, 1245 lines). Status: SHIPPED. Sub-epics: Day 1 schema + bootstrap → Day 2 self-reg + n:m readers → Day 3 tariffs → Day 4 packages + teacher_grant → Day 5A lesson_completions SoT → Day 5B settle UI → Day 6 admin overhaul + plan-4 + payment_orders NOT NULL → Day 7 cabinet polish → Day 8 teacher landing. Migrations 0073-0094.
- **`saas-pivot-schema-survey.md`** — read-only inventory companion to master plan.
- **`saas-pivot-landing-research-inventory.md`** — landing copy research companion.
- **`saas-pivot-calendar-multi-tenant-audit.md`** — audit + 1 BLOCKER closure for the calendar OAuth callback enqueue.

## 2026-05-23 teacher-cabinet-polish wave (7 PRs)

- **`teacher-cabinet-polish.md`** — 6-task UX polish over the SaaS-pivot cabinet (6 paranoia rounds, 383 lines). Status: SHIPPED. Sub-PRs: A calendar text fix → B cabinet nav menu → C profile tariff card → D digest preview tile → E learners list → F firstName/lastName globally. Migration 0095.

## Pre-pivot waves (older, smaller plans)

- **`teacher-self-reg-invite.md`** (SAAS-3+4, 2026-05-18) — HMAC-signed teacher invite flow + register-with-invite atomicity.
- **`bcs-def-5-tg-teacher-telegram-reminders.md`** (BCS-DEF-5-TG, 2026-05-19) — teacher digest Telegram channel.
- **`bcs-def-1-tg-telegram-alerts.md`** + **`bcs-def-1-tg-testsend.md`** — operator probe Telegram channel.
- **`bcs-def-4-tg-telegram-reminders.md`** — learner reminder Telegram channel.
- **`bcs-def-2-conflict-feed-revive.md`** (BCS-DEF-2, 2026-05-19) — /admin/slots/conflicts dashboard revive.
- **`bcs-def-7-synctoken-pull.md`** — Google calendar synctoken pull.
- **`pay-sbp-removal-and-cp-ready-gate.md`** (SBP-PAY, 2026-05-20) — operator-gated SBP rollback.
- **`receipt-3ds-token.md`** — 3DS /thank-you receipt-token gate.
- **`pkg-learner-buy.md`** — /cabinet/packages learner buy flow.
- **`pkg-recon.md`** — paid_not_granted reconciliation UI.
- **`alerts-editor.md`** + **`alerts-obs.md`** — operator-tunable alert thresholds.
- **`policy-knobs.md`** — operator knob conventions.
- **`sec-4-channel-token-encryption.md`** — calendar channel_token encryption.

## How to use this index

When a new task starts, read this file first to know which plan-docs are already SHIPPED (their code is on main, status reflected in this index) vs which are open WIP. For shipped plans, the code is the source of truth; the plan-doc is historical context for paranoia-loop continuity.

For grep-able past-decision lookup, `git log --all --grep "<keyword>"` is faster than reading the plan-doc body.
