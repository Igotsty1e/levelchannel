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

## 2026-06-01..02 T3 tariffs+packages learner-scope (7 PRs)

- **`tariffs-packages-learner-scope.md`** — per-learner tariffs/packages binding via junction tables. Status: SHIPPED 2026-06-02. Plan-mode SIGN-OFF round 10/N (user-authorized cap extension) + epic-end wave-mode SIGN-OFF round 1/3 (3 BLOCKER + 1 WARN closed inline). Sub-PRs: PKG-TEACHER-SCOPE companion (#470) → A foundation mig 0102 (#471) → B booking snapshot reads (#472) → C anonymous endpoint filter (#473) → D teacher API (#474) → E learner filter (#475) → epic-end fix-PR closes round-1 leaks across booking-days/times + checkout + package_required hint (#476). One follow-up tracked: archive contract (lesson_packages.deleted_at writer + bulk-revoke). Migration 0102.

## 2026-06-01 admin-dashboard wave (1 PR)

- **`admin-dashboard.md`** — operational metrics + sparklines + cohort funnel + health banner at /admin/dashboard. Status: SHIPPED. Codex-paranoia wave-mode SIGN-OFF round 2/3 (3 BLOCKER + 5 WARN + 1 INFO closed). No migration.

## Pre-pivot waves (older, smaller plans)

- **`teacher-self-reg-invite.md`** (SAAS-3+4, 2026-05-18) — HMAC-signed teacher invite flow + register-with-invite atomicity.
- **`bcs-def-5-tg-teacher-telegram-reminders.md`** (BCS-DEF-5-TG, 2026-05-19) — teacher digest Telegram channel.
- **`bcs-def-1-tg-telegram-alerts.md`** + **`bcs-def-1-tg-testsend.md`** — operator probe Telegram channel.
- **`bcs-def-4-tg-telegram-reminders.md`** (BCS-DEF-4-TG, 2026-05-20, PR #405) — learner reminder Telegram channel + bind handshake.
- **`conflict-feed.md`** (BCS-DEF-2, 2026-05-19, PR #389) — /admin/slots/conflicts dashboard revive.
- **`conflict-unresolved-alert.md`** (BCS-DEF-1, 2026-05-19, PR #316) — operator email alerts on unresolved external calendar conflicts >2h (+ Telegram fan-out via BCS-DEF-1-TG PR #386).
- **`admin-ux-coverage.md`** (BCS-ADMIN-UX discovery, 2026-05-15…2026-05-20) — operator-knob inventory; closed implicitly through BCS-DEF-1/2/3/4/5 + POLICY-KNOBS + ALERTS-EDITOR + PKG-RECON + PKG-LEARNER-BUY shipped waves.
- **`bcs-def-7-synctoken-pull.md`** — Google calendar synctoken pull.
- **`pay-sbp-removal-and-cp-ready-gate.md`** (SBP-PAY, 2026-05-20) — operator-gated SBP rollback.
- **`receipt-3ds-token.md`** — 3DS /thank-you receipt-token gate.
- **`pkg-learner-buy.md`** — /cabinet/packages learner buy flow.
- **`pkg-recon.md`** — paid_not_granted reconciliation UI.
- **`alerts-editor.md`** + **`alerts-obs.md`** — operator-tunable alert thresholds.
- **`policy-knobs.md`** — operator knob conventions.
- **`sec-4-channel-token-encryption.md`** (2026-05-17/18 audit wave) — calendar channel_token encryption.

## SAAS-1 calendar / design-system wave (2026-05-18/19)

- **`calendar-apple-redesign.md`** (SAAS-1, 2026-05-18, PR #289) — `/admin/slots` 1h grid + Apple-Calendar visual language. Sub-PRs below.
- **`saas-1-5a-token-scoping.md`** (SAAS-1 5.A, 2026-05-19, PR #341) — SaaS design-token block scoped under `.saas-chrome` class selector.
- **`saas-1-followup-keyboard.md`** (SAAS-1-FOLLOWUP-KEYBOARD, 2026-05-19, PR #354 + #359 + #361 + #364) — arrow-key grid navigation + Enter-to-create on `/admin/slots` Calendar.
- **`saas-infra-1-jsdom-rtl.md`** (SAAS-INFRA-1, 2026-05-19, PR #346 + #360) — jsdom + RTL added to vitest unit suite.

## Foundational pre-2026-05 waves (kept for git blame continuity)

- **`csp-hardening.md`** (CSP hardening, CLOSED 2026-05-09) — Content-Security-Policy lockdown for production.
- **`prepay-postpay-billing.md`** (billing wave, PR #118 + follow-ups) — prepaid/postpaid billing model + package consumption SoT.
- **`calendar-ui.md`** (Wave A, 2026-05-08) — base `/admin/slots` calendar UI before SAAS-1 redesign.
- **`booking-calendly-style.md`** (BCS-* base, 2026-05-09…2026-05-15) — Calendly-style booking flow + downstream BCS-DEF-1..7 waves.
- **`cabinet-profile-button.md`** (2026-05-18, PR #287) — `/cabinet/profile` button + page.
- **`slots-split.md`** (Wave 17, 2026-05-11, PR #151) — `lib/scheduling/slots.ts` split into 9-file folder facade.

## How to use this index

When a new task starts, read this file first to know which plan-docs are already SHIPPED (their code is on main, status reflected in this index) vs which are open WIP. For shipped plans, the code is the source of truth; the plan-doc is historical context for paranoia-loop continuity.

For grep-able past-decision lookup, `git log --all --grep "<keyword>"` is faster than reading the plan-doc body.
