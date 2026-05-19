# Engineering Backlog

Concrete engineering task queue. This file describes what still needs
to be implemented, not the current actual state of production.

If a task already works in code or on the server, it does not belong
here.

## Wave BCS — Booking Calendly-style + Google Calendar sync (design 2026-05-13, SIGN-OFF)

Full design: [`docs/plans/booking-calendly-style.md`](docs/plans/booking-calendly-style.md) — 7-round Codex paranoia loop (10→5→3→2→1→1→0 HIGH) before SIGN-OFF. Lock order, idempotency, push/pull contract, cancelled+200 healer all consistent.

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
- ~~**BCS-DEF-1-TEST-FILLOUT**~~ — **SHIPPED 2026-05-19** (PRs #366 + #368 + #372 + #374). All 7 items closed: (1) execFile verdict-paths + (2) fairness regression in `tests/integration/scripts/conflict-unresolved-alert.test.ts` (PR #374); (3) `tests/admin/probe-status.test.ts` structural + (6) DB-helper unit mocks in `tests/scripts/conflict-unresolved-alert.test.ts` extension (PR #366); (4) `conflict-unresolved` block in `probe-resolver-integration.test.ts` (PR #372); (5) preflight integration test in `alerts-obs.test.ts` + (7) per-key route tests in `operator-settings-route.test.ts` (PR #368). 100+ new test cases pinning BCS-DEF-1 invariants.
- ~~**BCS-DEF-1-COPY-STYLE-SWEEP**~~ — **SHIPPED 2026-05-19** (PRs #365 + #367 + #373). All 3 items closed: (1) slot-id column + copy-button in `/admin/slots` table (PR #373); (2) probe email audit confirmed admin-side "слот" usage is acceptable per `docs/content-style.md:53` (PR #367); (3) "Алерт" → "Уведомление" nav-link sweep (PR #367), plus "Тестовый алерт" → "Тестовое уведомление" in test-send button (PR #365).
- **BCS-DEF-1-TG** — Telegram alert channel mirroring BCS-DEF-1 email path (operator-only chat-id; per-knob master switch). Plan-ready: `docs/plans/bcs-def-1-tg-telegram-alerts.md` (plan PR #339). Awaits product decision on bot setup (own bot vs. shared) before impl.
- ~~**BCS-DEF-1-FANOUT**~~ — **DROPPED 2026-05-19 by product owner.** Original goal (per-teacher fan-out emails listing teacher's conflicts) is **already covered** by the non-dismissable red banner in `/teacher` driven by `lesson_slots.external_conflict_at`. Banner wired into prod by **BCS-F.1 wire-up** (PR #251, 2026-05-17): `runConflictDetectionForTeacher` runs inside `pull-worker.processOneJob()` after every successful pull tick (~30 min). Teacher sees conflict in cabinet on next tick after Google Calendar adds the busy interval. Plan PR #332 (`docs/plans/bcs-def-1-fanout.md`) had 4 BLOCKERs from prior paranoia round; plan-doc retained as historical record; impl will NOT be revived.
- **BCS-DEF-2** — Admin "Conflict feed" dashboard with last-30d view. Plan drafted as `docs/plans/conflict-feed.md` 2026-05-17; PARKED on round-1 paranoia with 4 BLOCKERs + 6 WARNs documented for future revival. Foundation gap (BCS-F.1 wire-up) closed by PR #251; revive when ≥3 teachers on prod OR operator complaint about /admin-side visibility (product owner decision 2026-05-18).
- ~~**BCS-DEF-3**~~ — **SHIPPED 2026-05-18** (PRs #281 + #282). Migration 0056 `lesson_slots.zoom_url` (https-only, ≤512 chars, DB CHECK + app validator); `setSlotZoomUrl` atomic UPDATE; admin + teacher PATCH routes; cabinet "▶ Войти на занятие" link on booked slots; 10 unit + 9 integration cases. Drive-by fix: `nearFutureBusinessBandIso` MSK-midnight day-anchor bug.
- ~~**BCS-DEF-4**~~ — **SHIPPED 2026-05-19** as a single-window email MVP per `docs/plans/bcs-def-4-learner-reminders.md` (plan PR #383). One operator-tunable knob (`LEARNER_REMINDER_WINDOW_MINUTES`, default 60, min 5, max 360); cron tick 1/min via `levelchannel-learner-reminder-dispatch.timer`; idempotency via `learner_reminder_dispatches` (UNIQUE `(slot_id, channel)`); 3-state lifecycle (`claimed | sent | skipped`). Per-user TG opt-in storage columns shipped dormant (active toggle in BCS-DEF-4-TG-LINK). Operator surface at `/admin/settings/alerts` ("Напоминания учащимся" card).
- **BCS-DEF-4-TG-LINK** — Bot-handshake binding flow (one-time 8-char code + `/start <code>` webhook + cabinet "Bind Telegram" button) supersedes the schema portion of BCS-DEF-4-TG. Schema (`accounts.learner_telegram_{enabled,chat_id}` + 2 CHECKs) already shipped in BCS-DEF-4. Plan-doc (DRAFT — schema banner adjustment + handshake table): `docs/plans/bcs-def-4-tg-telegram-reminders.md` (plan PR #347).
- **BCS-DEF-4-PUSH** — PWA push channel for learner reminders (stacks on BCS-DEF-4 schema). Plan-ready: `docs/plans/bcs-def-4-push-pwa-reminders.md` (plan PR #350).
- **BCS-DEF-4-PER-USER-WIN** — Per-user reminder windows + multi-offset (60/30/10) editor. Deferred from BCS-DEF-4 single-window MVP. Would land `learner_reminder_preferences` table + cabinet multi-select page + csv-ints SETTING_SCHEMA validator.
- **BCS-DEF-4-ADMIN-PAGE** — Standalone `/admin/settings/reminders` admin surface (when channel growth makes the embedded "Напоминания учащимся" section on `/admin/settings/alerts` bloated).
- **BCS-DEF-4-UNSUB** — List-Unsubscribe header + signed-token `/api/reminders/unsubscribe?t=...`. Unauthenticated surface; defer until any unauth-unsubscribe primitive lands.
- **BCS-DEF-4-PER-SLOT** — Per-slot custom offsets (learner picks 5&nbsp;min for one specific lesson).
- **BCS-DEF-4-VOL-ALERT** — Daily aggregate volume alert defending Resend monthly quota. Mirrors `auth-flow-alert` shape.
- **BCS-DEF-5** — Lesson-start reminders for teacher (mirror of BCS-DEF-4, same admin coverage). Plan-ready: `docs/plans/bcs-def-5-teacher-reminders.md` (plan PR #336).
- **BCS-DEF-5-TG** — Telegram channel for teacher reminders (stacks on BCS-DEF-5 schema). Plan-ready: `docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md` (plan PR #355).
- **BCS-DEF-5-PUSH** — PWA push channel for teacher reminders (stacks on BCS-DEF-5 schema). Plan-ready: `docs/plans/bcs-def-5-push-teacher-pwa-reminders.md` (plan PR #353).
- ~~**BCS-DEF-6**~~ — **DROPPED 2026-05-15** (user decision: Yandex not on the roadmap).
- **BCS-DEF-7** — `syncToken`-based incremental Google Calendar pull (post-MVP optimization; replaces bounded full-rewrite for active teachers). **PHASE 1 SHIPPED 2026-05-19** (PR #352): migration 0060 + `next_sync_token` column on `teacher_calendar_integrations`. Phase 2 (pull-runner delta path) plan-ready: `docs/plans/bcs-def-7-synctoken-pull.md` (plan PR #337). **⚠️ Pre-condition for Phase 2 impl (logged 2026-05-19 readiness audit):** plan-doc has NO §0 paranoia SIGN-OFF — plan PR #337 commit body explicitly says `Codex-Paranoia: SKIPPED — plan-doc only`. Phase 1 self-asserted SUB-WAVE under an epic SIGN-OFF that doesn't exist. Per COMPANY.md mandate, run `/codex-paranoia plan docs/plans/bcs-def-7-synctoken-pull.md` BEFORE shipping the Phase 2 substantive code wave. Likely BLOCKER candidates per audit: migration number drift (plan says 0059, PR #352 used 0060), Phase 1 reconnect-clear hook absence in `upsertGoogleIntegration`, optimistic-guard race with concurrent webhook+cron, `showDeleted=true` only in delta mode.

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

### Invariants (cf. plan §8 — must survive future changes)

1. Lock order: `teacher_calendar_integrations` → `teacher_external_busy_intervals` → `lesson_slots` → `calendar_push_jobs + slot_lifecycle_intents` → `calendar_pull_jobs`. Violations are P0 deadlock risk.
2. `bookSlot` ALWAYS overlap-checks against fresh busy cache atomically. Stale cache (>10min) is IGNORED, never blocks.
3. `extendedProperties.shared.lc_origin/lc_slot_id/lc_epoch` are LC's ownership stamp, write-once. Pull reads, never mutates.
4. `cancel` ALWAYS enqueues `delete` intent even if `external_event_id IS NULL` (deterministic id via COALESCE).
5. Reconciliation is bounded + gated. No runaway re-enqueue on `terminal_failure` without `last_reconnected_at` advance.
6. OAuth tokens encrypted via separate `CALENDAR_ENCRYPTION_KEY` (blast-radius from `AUDIT_ENCRYPTION_KEY`).
7. Webhook is enqueue-only; never mutates busy intervals directly.
8. Foreign event `summary` stored encrypted, 64-char truncated, 30d retention.
9. MSK-only teachers in MVP (DB CHECK enforces).

## Audit findings — 2026-05-17

Three parallel sub-agent audits (code quality / documentation / security) on current main. Findings consolidated below as new backlog items. Each tagged with severity, owner doc/file, suggested action, estimated effort. None are correctness blockers shipping today; codebase is operationally strong. These are completion gaps, doc drift, and hardening refinements.

### Security findings (HIGH priority)

- ~~**AUDIT-SEC-1 (HIGH)**~~ — **CLOSED 2026-05-17.** Phase B null-out applied on prod via `scripts/null-plaintext-audit-pii.mjs --execute --confirm`. Sequence: prior Phase B left a stale snapshot blocking re-run; verified 18 prior-nulled rows decrypt cleanly under current `AUDIT_ENCRYPTION_KEY`; user authorized dropping the stale `payment_audit_events_pre_phase_b` snapshot; backfill caught 1 plaintext-only row (added since prior Phase B); fresh Phase B nulled all 32 rows (snapshot retained ≥7 days for rollback). Encryption-at-rest claim now holds across full `payment_audit_events`.
- ~~**AUDIT-SEC-2 (HIGH)**~~ — **Closed 2026-05-17** (PR #259). `scripts/rotate-calendar-encryption.mjs` ships mirroring `rotate-audit-encryption.mjs`; runbook documents the four-column rotation contract.
- ~~**AUDIT-SEC-3 (HIGH)**~~ — **Closed 2026-05-17** (PR #257). `requireLearnerArchetypeAndVerified` aligned with canonical `LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL`; 6 integration tests pin the `scheduled_purge_at` / `purged_at` deletion-grace cases.
- **AUDIT-SEC-4 (MEDIUM) — DONE 2026-05-17.** Migration 0054 added bytea `channel_token_enc`. Dual-write in `lib/calendar/channel-renewer.ts setupChannelForIntegration` with top-of-function fail-closed guard (key+schema preflight before any external Google call); decrypt-aware read in `app/api/calendar/google/webhook/route.ts` with plaintext fallback for legacy rows. Rotation script + runbook updated to four columns. Phase B null-out via `scripts/null-plaintext-channel-token.mjs` (operator, post-rollback-window). 3-round paranoia plan-mode loop SIGN-OFF + post-loop runbook syntax fix per R3 BLOCKER #1.

### Code-quality findings (HIGH priority)

- ~~**AUDIT-CODE-1 (HIGH)**~~ — **Closed 2026-05-17** (PR #255). `withIdempotency` wired on `POST /api/admin/accounts/[id]/disable` + `/role` + `/postpaid`; 13 integration cases in `tests/integration/admin/accounts-mutations.test.ts`.
- ~~**AUDIT-CODE-2 (HIGH)**~~ — **Closed 2026-05-17** (PR #254). Env preflight now runs BEFORE `withIdempotency` on test-send route; 422 cache poisoning fixed; regression test pins the contract.
- ~~**AUDIT-CODE-3 (MEDIUM)**~~ — **Closed 2026-05-17** (PR #261). `isUndefinedTableError` extracted to `lib/db/errors.ts` along with `ERR_UNIQUE_VIOLATION` / `ERR_FOREIGN_KEY_VIOLATION` / `ERR_CHECK_VIOLATION` siblings; consumers in `lib/admin/probe-status.ts`, `lib/admin/operator-settings.ts`, route file all import from one source.
- ~~**AUDIT-CODE-4 (MEDIUM)**~~ — **Closed 2026-05-17** (PR #266). `useUnknownInCatchVariables` enabled in `tsconfig.json`; all catch-blocks repo-wide now narrow via `instanceof Error` guards (compile-time enforcement).
- ~~**AUDIT-CODE-5 (MEDIUM)**~~ — **Closed-as-already-done 2026-05-17 (PR #255).** `tests/integration/admin/accounts-mutations.test.ts` covers all three admin account routes (disable, role, postpaid) with 13 cases including anon/non-admin/self-disable/role-flip/postpaid-on-off/idempotency. Created alongside AUDIT-CODE-1 wave. No further action.
- ~~**AUDIT-CODE-6 (MEDIUM)**~~ — **Closed 2026-05-17** (PR #267). `tests/integration/billing/learner-buy-end-to-end.test.ts` exercises the full `/cabinet/packages` buy → CloudPayments webhook → `grantPackageToAccount` seam in one transaction; closes the wire-up-gap failure mode.
- ~~**AUDIT-CODE-7 (LOW)**~~ — **Closed-as-already-done 2026-05-17.** `lib/calendar/pull-worker.ts:222-237` already emits the success-side `[pull-worker] conflict detector ok` log with `jobId`/`teacherAccountId`/outcome. Anchor comment carries the `AUDIT-CODE-7 (2026-05-17)` tag. No further action.
- ~~**AUDIT-CODE-8 (LOW)**~~ — **Closed 2026-05-17** (PR #265). `drainPullJobs` now emits per-job structured metrics line (`outcome`, `durationMs`, `jobId`, `teacherAccountId`); success-side observability matches the prior failure-side coverage.

### Documentation findings (MEDIUM priority)

- ~~**AUDIT-DOC-1 (HIGH)**~~ — **Closed 2026-05-17** (PR #264). `ARCHITECTURE.md §API surface map` now covers all 81 routes; missing 33 routes added with one-line responsibility entries.
- ~~**AUDIT-DOC-2 (HIGH)**~~ — **Closed 2026-05-17** (PR #263). `ARCHITECTURE.md §Database Schema (Recent Migrations)` lists 0049–0053 with semantic purpose per new table / column.
- ~~**AUDIT-DOC-3**~~ — **Closed 2026-05-17** (PR #262). PAYMENTS_SETUP.md §Admin-driven package grant теперь ссылается на §Package-buy init вместо дублирования полного `pg_advisory_xact_lock` контракта.
- ~~**AUDIT-DOC-4**~~ — **Closed 2026-05-17** (PR #256). Status headers обновлены на 4 shipped plan docs (pkg-recon, pkg-learner-buy, receipt-3ds-token, alerts-obs).
- ~~**AUDIT-DOC-5**~~ — **Closed-as-already-done.** PAYMENTS_SETUP.md §Receipt-token gate — dual-mode (~line 220) already documents the RECEIPT-3DS-TOKEN session fallback including `chargeWithSavedCard` writing `metadata.accountId`. No action needed.
- ~~**AUDIT-DOC-6 (MEDIUM)**~~ — **Closed 2026-05-17** (PR #263). `docs/public/ROADMAP.md` + `docs/public/ARCHITECTURE.md` refreshed with package catalog, admin grant, alerts observability entries.
- ~~**AUDIT-DOC-7**~~ — **Closed 2026-05-17** (PR #262). SECURITY.md §Auth and account layer теперь имеет sentence about the receipt-token gate's dual-mode (token + session-fallback), pointing at PAYMENTS_SETUP for full contract.
- ~~**AUDIT-DOC-8**~~ — **Closed-as-stale 2026-05-17.** ARCHITECTURE.md already documents `probe_runs` 90d retention (line 179). `slot_admin_actions` table belongs to CONFLICT-FEED epic which is PARKED — premature. Operator-facing private runbook deltas (`docs/private/OPERATIONS.private.md`) are out of public-repo scope.

### Aggregate

Total: 4 SEC + 8 CODE + 8 DOC = 20 actionable items. ~46h of dev work + some operator time. None are correctness blockers shipping today.

**Status 2026-05-17 (audit wave fully closed):** 20/20 items closed across PR #252-#268 + post-merge operator run for AUDIT-SEC-1 (Phase B null-out applied on prod, snapshot retained for the 7-day rollback window).

## SaaS-pivot scope — 2026-05-18 (added by product owner)

Product is pivoting from single-teacher-channel to multi-teacher SaaS. Each task gets its own plan doc + paranoia plan-mode pass + implementation. Cross-cutting foundation docs (`docs/design-system.md`, `docs/content-style.md`) come first; per-feature plans reference them.

- **SAAS-1 — Календарь Apple-style (1ч сетка + визуальный редизайн).** Сейчас admin /admin/slots + cabinet /cabinet/book показывают сетку с 30-мин шагом. Хочется: 1ч шаг (вертикально компактнее), Apple-Calendar-style визуал (тонкие divider'ы, скруглённые event chips, generous whitespace, hour-only timestamps, subtle hover). Это первая итерация полного редизайна #SAAS-6. План: `docs/plans/calendar-apple-redesign.md`.
- **SAAS-2 — Переписать все тексты (кроме лендинга).** Audit + rewrite admin UI labels (Аккаунты / Тарифы / Пакеты / Слоты / Платежи / Возвраты / Задолженности / Документы / Алерты / Реконсилиация — некоторые не лучшие), cabinet UI, error messages, tooltips, emails. Без технического языка, понятно и админу и юзеру. Foundation: `docs/content-style.md` (style guide + glossary). Multi-week sweep после foundation.
- **SAAS-3 — Регистрация с выбором роли «ученик / учитель».** Сейчас teacher-аккаунты создаёт оператор; меняем на self-service SaaS — любой может зарегистрироваться как учитель, сразу активен (без verification-флага). На /register добавляется radio-button. План: `docs/plans/teacher-self-reg-invite.md` (объединён с SAAS-4).
- **SAAS-4 — Учитель отправляет invite-ссылку с auto-bind.** Учитель в своём кабинете генерирует invite-ссылку (HMAC-signed token, expiry, scope=teacher-bind). Ученик регистрируется по ссылке → `assigned_teacher_id` проставляется автоматически. План объединён с SAAS-3.
- **SAAS-5 — Cabinet IA: «Профиль» как кнопка/модалка.** Текущий cabinet перегружен: профиль (имя, часовой пояс) + danger-zone занимают экранное место рядом с уроками. Сделать профиль скрытой панелью за кнопкой (открывается модалка / отдельный экран). Внутри: имя, часовой пояс, danger-zone. План: `docs/plans/cabinet-profile-button.md`.
- **SAAS-6 — Большой редизайн в стиле Apple.** Все интерфейсы — Apple HIG aesthetic (тонкие линии, generous spacing, SF Pro-style typography, subtle motion, скруглённые углы, vibrancy-style фон). Foundation: `docs/design-system.md` (palette, type-scale, spacing, radii, motion, primitive components). Multi-week sweep после foundation.

**CONFLICT-FEED — defer.** Foundation готова (BCS-F.1 wire-up закрыт PR #251); 4 design-BLOCKERs из round-1 паранойи остаются (см. `docs/plans/conflict-feed.md`). Решение product owner 2026-05-18: defer до тех пор, пока на проде не появится ≥3 учителей ИЛИ operator не пожалуется на отсутствие /admin-видимости конфликтов. До тех пор teacher banner и оператор-side SQL достаточны.

### Follow-ups out of immediate SAAS-1..6 scope

Captured here so future waves pick them up without re-discovering. All surfaced by `/codex-paranoia plan` rounds 2026-05-18.

- ~~**SAAS-1 5.A — token scoping under `.saas-chrome`**~~ — **SHIPPED 2026-05-19** (PR #341, plan PR #331 → `docs/plans/saas-1-5a-token-scoping.md`). SaaS design tokens now scoped under `.saas-chrome` class selector instead of `:root` to avoid bleed into the legacy admin/cabinet surface during the multi-week SAAS-6 rollout.
- ~~**SAAS-INFRA-1**~~ — **SHIPPED 2026-05-19** (PR #346, plan PR #338 → `docs/plans/saas-infra-1-jsdom-rtl.md`). `@testing-library/react` + `jsdom` + `@testing-library/user-event` added to `vitest.config.ts`; component-render assertions now land in the unit suite. Unblocks `SlotBlock` palette + `cabinet-profile-page` Server Component renders.
- ~~**SAAS-1-FOLLOWUP-KEYBOARD**~~ — **SHIPPED 2026-05-19** (PR #354, plan PR #344 → `docs/plans/saas-1-followup-keyboard.md`). Arrow-key cell navigation + Enter-to-create on empty cells in `/admin/slots` Calendar grid; `lib/calendar/grid-keyboard.ts` pure reducers; roving tabindex + 30 new tests (20 unit + 10 RTL via SAAS-INFRA-1). Closes WCAG 2.1 SC 2.1.1 Keyboard for the operator's primary action.
- ~~**SAAS-6-A11Y-1**~~ — **SHIPPED 2026-05-19** (PR #370). Skip-to-content link `&lt;a href="#main-content"&gt;Перейти к основному содержимому&lt;/a&gt;` in 8 page shells (`components/auth-shell.tsx`, `app/admin/(gated)/layout.tsx`, `app/teacher/layout.tsx`, `components/home/home-page-client.tsx`, `app/pay/page.tsx`, `app/checkout/[tariffSlug]/page.tsx`, `app/cabinet/packages/page.tsx`, `app/legal/v/[id]/page.tsx`); visually hidden via `translateY(-110%)` with `prefers-reduced-motion` respected; `&lt;main id="main-content" tabIndex={-1}&gt;` target. RTL tests under `tests/a11y/skip-to-content/`. Closes WCAG 2.1 SC 2.4.1 Bypass Blocks (Level A). Foundation for SAAS-6 design rollout.

## Cross-cutting backlog — 2026-05-18 (added by product owner)

- **DOC-SPLIT** — Разрезать ENGINEERING_BACKLOG.md на per-epic файлы в `docs/backlog/`. Top-level `ENGINEERING_BACKLOG.md` остаётся индексом; закрытые волны — в `docs/backlog/archive/`. Цель: больше не ронять контекст-окно на одном файле в 1000+ строк.
- **DOC-MODULE-CONTRACTS** — Извлечь module-contracts из `ARCHITECTURE.md` в `lib/*/README.md` per-module (billing/scheduling/auth/payments/calendar/admin/security/db). `ARCHITECTURE.md` остаётся как top-level overview + cross-module диаграмма; контракты на отдельные модули — у каждого модуля под рукой при работе с кодом.
- **API-BOUNDARIES** — Зафиксировать public/private surface между `lib/*` модулями. Каждый `lib/X` экспортирует через `index.ts`; импорт `lib/X/internal/*` или sibling-only файлов из соседнего `lib/Y` запрещён. CI-тест (ts-morph или regex sweep) ловит нарушения. Цель: предотвратить незаметное расширение surface, как было с `internal.ts` уходящим в чужие модули.
- **CRITICAL-PATH-INVENTORY** — Список 20 файлов, поломка которых = production incident: money-moving (`app/api/payments/webhooks/*`, `lib/billing/package-grant.ts`, `lib/payments/store-postgres.ts`), security gates (`lib/auth/sessions.ts`, `lib/auth/learner-archetype.ts`), calendar gates (`lib/scheduling/slots/mutations-cancel.ts`, `lib/calendar/pull-runner.ts`). Список в `docs/critical-path.md`. CI hook: PR трогающая файл из списка требует `Codex-Paranoia: SIGN-OFF` трейлер (не `SUB-WAVE self-reviewed`).
- **COVERAGE-PAYMENTS** — Branches coverage 75% → 85% на платёжных путях (`lib/billing/*`, `lib/payments/*`, `app/api/payments/**`, `app/api/checkout/**`). Coverage report → uncovered branches → тесты на edge cases (refund retry, 3DS callback, postpaid debt summary, advisory-lock contention, webhook signature failures). `vitest.config.ts` coverage thresholds для платёжных путей.

## Recently shipped — 2026-05-19 autonomous wave

Single-day burst that closed BCS-DEF-1 end-to-end, swept the SaaS-2 copy surface, registered 11 plan-docs across BCS-DEF-1/4/5/7 + SAAS-1/6 follow-ups, and ran three code-quality sweeps. Listed by category for cross-reference; individual entries above carry the durable record.

- **BCS-DEF-1 end-to-end** (1 impl + 1 backlog strikethrough + 1 test-surface sweep): PR #316 (RFC merged with full impl — migration 0058 + probe + systemd + activator + UI + 21 tests), #329 (backlog strikethrough), #330 (test-surface inventory).
- **SAAS-2 copy sweep** (23 atomic PRs): #295 (admin menu rename), #296 (reconciliation rewrite), #297 (accounts + dashboard headers), #298 (admin h1 alignment), #299 (payments/refunds subtitles), #300 (cabinet слот), #301 (dashboard cards), #306 (account detail), #308 (Загружаем…), #309 (Мои занятия), #311 (cabinet placeholder), #312 (admin slots h1), #317 (BookConfirmModal), #318 (Оплата после занятия), #319 (Уведомления оператора tab), #320 (3DS/чекаут glossary), #321 (learner-visible слот replace), #323 (Toolbar Загружаем…), #324 (aria-labels Занятие), #325 (global-error copy), #326 (empty-states), #327 (debt-summary headers), #328 (refund kind label). SAAS-2 surface effectively exhausted at end of session.
- **SAAS-1 impl + follow-ups** (3 PRs): #313 (SAAS-1 5.F drag-math seam → pure functions + tests), #341 (SAAS-1 5.A token scoping under `.saas-chrome`), #354 (SAAS-1-FOLLOWUP-KEYBOARD impl — arrow-key cell navigation + 30 tests).
- **Test infra** (1 PR): #346 (SAAS-INFRA-1 — jsdom + RTL added to vitest unit suite; unblocks component-render coverage).
- **Plan-docs registered** (13): #331 (SAAS-1 5.A token scoping), #332 (BCS-DEF-1-FANOUT), #333 (BCS-DEF-4 learner reminders), #336 (BCS-DEF-5 teacher reminders), #337 (BCS-DEF-7 syncToken pull), #338 (SAAS-INFRA-1), #339 (BCS-DEF-1-TG), #344 (SAAS-1-FOLLOWUP-KEYBOARD), #345 (SAAS-6-A11Y-1), #347 (BCS-DEF-4-TG), #350 (BCS-DEF-4-PUSH), #353 (BCS-DEF-5-PUSH), #355 (BCS-DEF-5-TG). All catalogued in the Active follow-up roadmap + SAAS-1..6 follow-ups sections above.
- **BCS-DEF-7 Phase 1 impl** (1 PR): #352 — `next_sync_token` column added to `teacher_calendar_integrations` (migration 0060). Phase 2 (pull-runner delta path) plan-ready.
- **Code-quality sweeps** (8 PRs): #334 (align stale «Мои уроки» comments), #335 (drop unused `headers` import from gated layout), #340 (align stale BCS-DEF-1 «Phase 2 will ship» comments), #342 (drop three dead local constants), #343 (drop two unused React imports), #348 (drop unused `useRouter` import), #349 (drop unused imports from lessons-section), #351 (drop dead imports + date-name constants in cabinet/book).
- **Bug fixes + backlog hygiene** (3 PRs): #315 (BUG-2026-05-13-1 thank-you session-aware back-link + 11 tests), #314 (strikethrough 11 stale AUDIT-* items).

Aggregate: ~54 PRs catalogued above for the 2026-05-19 burst (23 SAAS-2 + 13 plan-docs + 8 code-quality + 7 impls + 3 BCS-DEF-1 + bug-fix/hygiene). BCS-DEF-1 live on prod (code path) pending operator's `scripts/activate-prod-ops.sh` run to enable the 4th systemd timer.

## Bug intake — 2026-05-13

Reported by product owner. Each item: reproduce → verify → fix. Triage TBD; no severity assigned yet — confirm reproduction first, then prioritize.

- ~~**BUG-2026-05-13-1 — back button on payment page lands on home.**~~ **Закрыт 2026-05-19.** Корень: `/thank-you/page.tsx` был flat `'use client'` с hardcoded `primaryHref: '/'` для paid + `/#teacher` для failure/cancelled/pending. Авторизованный учащийся после оплаты получал только лендинг как «возврат». Фикс: server-wrapper + client-island по тому же паттерну, что у /pay и /checkout/[tariffSlug] — `cookies()` читает session-cookie, `hasSession` пробрасывается в `getStatusContent` и все ветки CTA указывают на `/cabinet` для авторизованного. `tests/thank-you/status-content.test.ts` пинит контракт (11 кейсов: anonymous/authenticated × paid/failed/cancelled/pending + invariants).
- ~~**BUG-2026-05-13-2 — нет удаления тарифа, только деактивация.**~~ **Закрыт 2026-05-14.** Добавлены `DELETE /api/admin/pricing/[id]` + helper `deleteTariffIfUnreferenced` + UI (🗑 кнопка + confirm-модалка). Hard-delete возможен ТОЛЬКО если zero references из `lesson_slots` (включая past/cancelled — FK `on delete set null` бы стирал аудит-связь). При наличии ссылок endpoint возвращает 409 с понятным сообщением и `slotCount`, UI предлагает деактивировать вместо удаления.
- ~~**BUG-2026-05-13-3 — у тарифа нет обязательного поля «длительность занятия».**~~ **Закрыт 2026-05-14.** Миграция 0046: `duration_minutes integer not null` (бэкфилл `60`), CHECK band 15-240, `pricing_tariffs_duration_guard` trigger (immutable после первой привязки к слоту). Lib + API: `durationMinutes` required в `TariffInput`, validateTariffInput, createTariff/updateTariff (с дружелюбными 409 на попытку поменять после привязки). UI: DurationSelect (30/45/60/90 + custom). Гейт: `assertTariffDurationMatches` в `createSlot` + `bulkCreateSlots` отказывает на `tariff.duration_minutes != slot.duration_minutes` через `SlotTariffDurationMismatchError`. Тесты: +3 в `pricing-crud` (missing dur 400, out-of-band 400, PATCH immutable 409). Все 243 integration теста (scheduling + admin + billing + payment) проходят локально.
- ~~**BUG-2026-05-13-4 — непонятное поле `Sort` (=0) в тарифах.**~~ **Закрыт 2026-05-14.** Лейбл переименован в «Порядок (для админки)», добавлена tooltip-подсказка через `title` + `ⓘ` иконка: «меньшее число — выше в дропдауне выбора тарифа при создании слота». Поле используется в админских дропдаунах, не убрано.
- ~~**BUG-2026-05-13-5 — непонятная шапка страницы тарифов.**~~ **Закрыт 2026-05-14.** Заголовок переписан на «Тарифы за одно занятие», подзаголовок описывает что это (стоимость одного урока разной длительности 60/90 минут), как привязывается к слоту, как влияет на списание из пакета, и что происходит с деактивированными.
- ~~**BUG-2026-05-13-6 — непонятный текст на вкладке «Возвраты».**~~ **Закрыт 2026-05-14.** Подзаголовок переписан бизнесовым языком: объясняет что в журнале (возврат за урок / списание из пакета / возврат за пакет), как именно возвращаются деньги (CloudPayments дашборд вручную или API после флага). Колонки таблицы `Kind` / `Target` переименованы в «Тип возврата» / «На что (ID)».
- ~~**BUG-2026-05-13-7 — непонятное поле «Порядок» (=100) на вкладке «Пакеты».**~~ **Закрыт 2026-05-14.** Лейбл уточнён до «Порядок (для каталога)», добавлена tooltip-подсказка: «меньшее число — выше в каталоге пакетов у ученика». Поле действительно используется в `order by pkg.display_order asc` (см. `app/admin/(gated)/packages/page.tsx`).

Definition of done для каждого: воспроизведено → принято решение (фикс или закрыть как not-a-bug) → шипнуто → проверено на проде.


## Archive

Closed waves, post-incident learnings, pre-ALERTS-EDITOR historical content (2026-05-07 .. 2026-05-15) extracted 2026-05-18 to `docs/backlog/archive/historical-2026-05.md`. Top-level keeps only the currently-active surface; archive is for forensic / audit review.

Future archive rotation: when a wave is fully shipped + retro-recorded, its section moves to `docs/backlog/archive/<wave-name>.md` and a one-line pointer stays here.
