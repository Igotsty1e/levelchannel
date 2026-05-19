# BCS — Booking Calendly-style + Google Calendar sync

> **Extracted from `ENGINEERING_BACKLOG.md` 2026-05-19 (DOC-SPLIT task).** Top-level backlog is now an index; this file carries the full BCS surface (active follow-ups + hardening trail + invariants).

## Wave BCS — Booking Calendly-style + Google Calendar sync (design 2026-05-13, SIGN-OFF)

Full design: [`docs/plans/booking-calendly-style.md`](../plans/booking-calendly-style.md) — 7-round Codex paranoia loop (10→5→3→2→1→1→0 HIGH) before SIGN-OFF. Lock order, idempotency, push/pull contract, cancelled+200 healer all consistent.

Two product asks fold into one wave family because they share schema (slot integration columns) and the conflict UX is meaningless without both the Calendly UI and the Google sync:

- **Task 1**: replace learner booking UI with Calendly-style 3-screen flow + fast-path tiles for repeat users.
- **Task 2**: two-way Google Calendar sync (Google only in MVP, Yandex deferred). Push events on `slot.booked`, pull busy intervals to hide overlapping `open` slots, conflict surface with 4 resolution actions.

### Implementation queue (PR-decomposed)

Each PR ≤500 LOC and atomically green-able. Sequencing: A (schema) → B (UI) + C (OAuth) in parallel → D (pull) → E (push) → F (conflict UX) → G (reconcile + hidden slots).

- **BCS-A schema** (4 PRs): migrations 0042–0045 (lesson_slots additions, teacher_calendar_integrations, teacher_external_busy_intervals, calendar_push/pull_jobs + slot_lifecycle_intents).
- **BCS-B Calendly UI** (5 PRs): agenda capture, booking-days API, booking-times API, confirm screen + POST, fast-path tiles + cabinet entry.
- **BCS-C OAuth scaffolding** (6 PRs): `CALENDAR_ENCRYPTION_KEY` env + lib, Google OAuth client + state nonce + rate-limit, /api/teacher/calendar/google/* endpoints, /teacher/settings/calendar UI, /cabinet/settings/calendar (learner read-only), plain-language onboarding copy + tooltips.
- **BCS-D pull contract** (5 PRs): pull lib (bounded full-rewrite), pull worker + cron, webhook endpoint with security checks, channel renewal cron, **bookSlot freshness contract + atomic overlap check (P0 fix)**.
- **BCS-E push contract** (5 PRs): push worker (TX1), deterministic event id + shared extendedProperties idempotency, TX2 sync_state flip on auth failure, slot_lifecycle_intents + worker + cancel split into 2 TX, move push (events.patch).
- **BCS-F conflict UX** (4 PRs): post-pull conflict detector, non-dismissable red banner on /teacher main, in-calendar highlight, 4-action resolution endpoints (dismiss/delete-external/cancel/move).
- **BCS-G reconcile + hidden slots** (4 PRs): bounded reconcile sweep (F9‴ gated), hidden-slots surface (`GET /api/teacher/hidden-slots` + cabinet card), `blocked_integration` revival sweep + pathology alert, orphan-self cleanup UI (post-disconnect drift).

Total estimate: 33 PRs across 7 waves. Reference cadence: billing-wave was 7 PRs / ~3 days; BCS is ~5x scope, expect 2-3 weeks of sustained shipping.

### Hardening follow-ups inside BCS

- ~~**BCS-HARDEN-1**~~ — **Закрыт 2026-05-14** (PR #214, commit `232ca10`). `/api/slots/[id]/book` теперь явно отказывает с 404 на NULL-assignedTeacher; 9 интеграционных тестов + 1 unit-тест переписаны с явным `assignedTeacherId`. Codex-Paranoia: SIGN-OFF round 3/3.
- ~~**BCS-HARDEN-2**~~ — **Закрыт 2026-05-13** (PR #202, commit `934e6a2`). Dead `_DEAD_BookSection` / `TabButton` / `fmtSlotTime` / `currentMondayYmd` declarations deleted from `app/cabinet/lessons-section.tsx`.
- ~~**BCS-HARDEN-3**~~ — **Закрыт 2026-05-15** (PR #223, commit `fa5c862`). `claimNextIntent` теперь делает CTE-based atomic `UPDATE ... SET status='in_progress' RETURNING ...`, флипает статус в той же statement что и FOR UPDATE SKIP LOCKED — overlapping tick не может re-claim ту же row.
- ~~**BCS-HARDEN-4**~~ — **Закрыт 2026-05-15** (PR #223 same commit). `last_pulled_at >= now()-30m` gate в `reviveBlockedIntents` снят — revival больше не ждёт двух cron-ticks после reconnect.

### Active follow-up roadmap (after BCS-OP-ROLLOUT activation, 2026-05-15)

- ~~**BCS-DEF-1**~~ — **SHIPPED 2026-05-19** (PR #316, squash `21380f9`). Operator-only MVP for email alerts on unresolved external calendar conflicts >2h. Migration 0058 (probe_runs CHECK extension); probe script `scripts/conflict-unresolved-alert.mjs` with per-teacher window-function cap + full-tuple fingerprint dedup; 4 operator-tunable knobs at `/admin/settings/alerts` (threshold-minutes / per-teacher-limit / report-limit / dedup-window-ms); systemd unit + timer; activate-prod-ops.sh allowlist extension; 21 new tests (15 unit + 6 integration). Plan: `docs/plans/conflict-unresolved-alert.md` (3 paranoia rounds + §0c mechanical closure). Activation: operator runs `scripts/activate-prod-ops.sh` on VPS to install + enable the new systemd timer.
- **BCS-DEF-1-TG** — Telegram alert channel mirroring BCS-DEF-1 email path (operator-only chat-id; per-knob master switch). Plan-ready: `docs/plans/bcs-def-1-tg-telegram-alerts.md` (plan PR #339). Awaits product decision on bot setup (own bot vs. shared) before impl.
- **BCS-DEF-1-FANOUT** — Per-teacher fan-out emails on top of BCS-DEF-1 (operator-only today → teacher self-serve next). Plan-ready: `docs/plans/bcs-def-1-fanout.md` (plan PR #332). Awaits scheduling.
- **BCS-DEF-2** — Admin "Conflict feed" dashboard with last-30d view. Plan drafted as `docs/plans/conflict-feed.md` 2026-05-17; PARKED on round-1 paranoia with 4 BLOCKERs + 6 WARNs documented for future revival. Foundation gap (BCS-F.1 wire-up) closed by PR #251; revive when ≥3 teachers on prod OR operator complaint about /admin-side visibility (product owner decision 2026-05-18).
- ~~**BCS-DEF-3**~~ — **SHIPPED 2026-05-18** (PRs #281 + #282). Migration 0056 `lesson_slots.zoom_url` (https-only, ≤512 chars, DB CHECK + app validator); `setSlotZoomUrl` atomic UPDATE; admin + teacher PATCH routes; cabinet "▶ Войти на занятие" link on booked slots; 10 unit + 9 integration cases. Drive-by fix: `nearFutureBusinessBandIso` MSK-midnight day-anchor bug.
- **BCS-DEF-4** — Lesson-start reminders for learner: email MVP + scheduler + per-user schema (60/30/10-min windows). Plan-ready: `docs/plans/bcs-def-4-learner-reminders.md` (plan PR #333). **Admin coverage required:** per-channel master switch + default windows operator-editable. Awaits product decision on scheduler cadence + per-user prefs schema.
- **BCS-DEF-4-TG** — Telegram channel for learner reminders (stacks on BCS-DEF-4 schema). Plan-ready: `docs/plans/bcs-def-4-tg-telegram-reminders.md` (plan PR #347).
- **BCS-DEF-4-PUSH** — PWA push channel for learner reminders (stacks on BCS-DEF-4 schema). Plan-ready: `docs/plans/bcs-def-4-push-pwa-reminders.md` (plan PR #350).
- **BCS-DEF-5** — Lesson-start reminders for teacher (mirror of BCS-DEF-4, same admin coverage). Plan-ready: `docs/plans/bcs-def-5-teacher-reminders.md` (plan PR #336).
- **BCS-DEF-5-TG** — Telegram channel for teacher reminders (stacks on BCS-DEF-5 schema). Plan-ready: `docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md` (plan PR #355).
- **BCS-DEF-5-PUSH** — PWA push channel for teacher reminders (stacks on BCS-DEF-5 schema). Plan-ready: `docs/plans/bcs-def-5-push-teacher-pwa-reminders.md` (plan PR #353).
- ~~**BCS-DEF-6**~~ — **DROPPED 2026-05-15** (user decision: Yandex not on the roadmap).
- **BCS-DEF-7** — `syncToken`-based incremental Google Calendar pull (post-MVP optimization; replaces bounded full-rewrite for active teachers). **PHASE 1 SHIPPED 2026-05-19** (PR #352): migration 0060 + `next_sync_token` column on `teacher_calendar_integrations`. Phase 2 (pull-runner delta path) plan-ready: `docs/plans/bcs-def-7-synctoken-pull.md` (plan PR #337).

### Shipped post-BCS-OP-ROLLOUT (2026-05-15…2026-05-17)

For chronological context — items closed since the BCS-OP-ROLLOUT activation note above:

- ~~**PKG-RECON**~~ (2026-05-15, PRs #227 + #232-#236) — `/admin/reconciliation/package-grants` reconciliation UI for `paid_not_granted` orders; three operator actions (retry-grant / attach-account / mark-resolved); migration 0049 `package_grant_resolutions`.
- ~~**PKG-LEARNER-BUY**~~ (2026-05-16, PRs #237-#241) — `/cabinet/packages` learner buy CTA; race-safe gates on shared `pkg-stack:` advisory-lock prefix; CloudPayments widget intent threaded inline with receipt token in `successRedirectUrl`.
- ~~**RECEIPT-3DS-TOKEN**~~ (2026-05-16, PR #242) — receipt-token gate accepts authenticated learner session matching `order.metadata.accountId` (generic fallback, anti-spoof rejects admin/teacher). Closes 3DS-callback /thank-you 401.
- ~~**PKG-ADMIN-GRANT**~~ (2026-05-16, PRs #243 cal nav + #245 LBL.0 + #246 LBL.1 + #247 LBL.2 + #248 epic-close) — operator-driven non-money grant via `POST /api/admin/packages/[id]/grant` with synthetic `payment_orders` rows (`provider='admin_grant'`, `status='granted'`, `paid_at=NULL`). Migration 0051 triple-CHECK. Shared `pkg-stack:` lock unifies admin-grant with learner-buy + webhook serialization.
- ~~**ALERTS-OBS**~~ (2026-05-17, PR #249) — read-only `/admin/settings/alerts` per-probe observability for the 3 systemd cron alert probes. Migration 0053 `probe_runs`. Shared `scripts/lib/probe-runs.mjs` ESM helper (no `@/` aliases). 3-round paranoia plan + 1-round paranoia wave.
- ~~**BCS-F.1 wire-up gap**~~ (2026-05-17, PR #251) — `runConflictDetectionForTeacher()` was a module without a production call-site; teacher banner never fired on prod. Wired into `pull-worker.processOneJob()` after success. Surfaced by CONFLICT-FEED plan-mode paranoia round 1 as BLOCKER #1.

### BCS-ADMIN-UX — admin tooling review round (queued 2026-05-15)

Cross-cutting review wave queued ahead of BCS-DEF-1/4/5 implementation. Goal: catalogue every operator-facing setting that currently lives only in code / .env / SQL and needs an /admin UI before the corresponding feature can ship. Open questions surfaced by the product owner:

- The package catalog (`pricing_packages`) has no /admin surface — operator currently can't see / buy / sell packages from the dashboard.
- Reminder cadences / channels for BCS-DEF-4/5 must be operator-tunable, not hardcoded.
- Conflict-alert thresholds (BCS-DEF-1) must be operator-tunable.

Process: I run a discovery pass + Codex `/codex` adversarial second-opinion on the resulting admin-feature list. Output is a prioritised plan doc at `docs/plans/admin-ux-coverage.md` to feed back into BCS-DEF-1/2/3/4/5 implementation order.

## Invariants

(cf. plan §8 — must survive future changes)

1. Lock order: `teacher_calendar_integrations` → `teacher_external_busy_intervals` → `lesson_slots` → `calendar_push_jobs + slot_lifecycle_intents` → `calendar_pull_jobs`. Violations are P0 deadlock risk.
2. `bookSlot` ALWAYS overlap-checks against fresh busy cache atomically. Stale cache (>10min) is IGNORED, never blocks.
3. `extendedProperties.shared.lc_origin/lc_slot_id/lc_epoch` are LC's ownership stamp, write-once. Pull reads, never mutates.
4. `cancel` ALWAYS enqueues `delete` intent even if `external_event_id IS NULL` (deterministic id via COALESCE).
5. Reconciliation is bounded + gated. No runaway re-enqueue on `terminal_failure` without `last_reconnected_at` advance.
6. OAuth tokens encrypted via separate `CALENDAR_ENCRYPTION_KEY` (blast-radius from `AUDIT_ENCRYPTION_KEY`).
7. Webhook is enqueue-only; never mutates busy intervals directly.
8. Foreign event `summary` stored encrypted, 64-char truncated, 30d retention.
9. MSK-only teachers in MVP (DB CHECK enforces).
