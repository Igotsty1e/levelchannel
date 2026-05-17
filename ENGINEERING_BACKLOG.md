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

- **BCS-DEF-1** — Email + Telegram alerts on unresolved conflicts >2h (operator + teacher). **Admin coverage required:** alert thresholds + recipient lists must be operator-editable from /admin. Now unblocked: BCS-F.1 wire-up gap closed by PR #251 (2026-05-17) — `external_conflict_at` actually gets stamped on prod, so an alert on "stamped >2h" is meaningful.
- **BCS-DEF-2** — Admin "Conflict feed" dashboard with last-30d view. Plan drafted as `docs/plans/conflict-feed.md` 2026-05-17; PARKED on round-1 paranoia with 4 BLOCKERs + 6 WARNs documented for future revival. Foundation gap (BCS-F.1 wire-up) closed by PR #251; revive when ready.
- **BCS-DEF-3** — Optional `zoomUrl` on slot — nullable at create, editable on already-booked slot.
- **BCS-DEF-4** — Lesson-start reminders for learner (per-user settings: 60/30/10 min, email/telegram/push). **Admin coverage required:** per-channel master switch + default windows operator-editable.
- **BCS-DEF-5** — Lesson-start reminders for teacher (mirror settings, same admin coverage).
- **BCS-DEF-7** — `syncToken`-based incremental pull (post-MVP optimization; replaces bounded full-rewrite for active teachers).
- ~~**BCS-DEF-6**~~ — **DROPPED 2026-05-15** (user decision: Yandex not on the roadmap).

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
- **AUDIT-SEC-2 (HIGH)** — Add `scripts/rotate-calendar-encryption.mjs` mirroring `scripts/rotate-audit-encryption.mjs`. Today `CALENDAR_ENCRYPTION_KEY` has no automated rotation path — if the key is ever lost, all encrypted teacher OAuth tokens become permanently unreadable. `getCalendarEncryptionKeyOld` is already scaffolded in `lib/calendar/encryption.ts` (matching the audit-encryption rotation shape). ETA: 4h dev.
- **AUDIT-SEC-3 (HIGH)** — Align `requireLearnerArchetypeAndVerified` with the canonical `LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL` predicate from `lib/auth/learner-archetype.ts`. Request-time guards today don't check `scheduled_purge_at` / `purged_at` — a user inside deletion-grace can still hit `/api/slots/*` book endpoints. Round-1 WARN #3 from a prior wave; never closed. ETA: 4h dev + 6 integration tests.
- **AUDIT-SEC-4 (MEDIUM) — DONE 2026-05-17.** Migration 0054 added bytea `channel_token_enc`. Dual-write in `lib/calendar/channel-renewer.ts setupChannelForIntegration` with top-of-function fail-closed guard (key+schema preflight before any external Google call); decrypt-aware read in `app/api/calendar/google/webhook/route.ts` with plaintext fallback for legacy rows. Rotation script + runbook updated to four columns. Phase B null-out via `scripts/null-plaintext-channel-token.mjs` (operator, post-rollback-window). 3-round paranoia plan-mode loop SIGN-OFF + post-loop runbook syntax fix per R3 BLOCKER #1.

### Code-quality findings (HIGH priority)

- **AUDIT-CODE-1 (HIGH)** — Add idempotency wrapper to `POST /api/admin/accounts/[id]/disable` + `/role` + `/postpaid`. Today a double-click revokes sessions twice / flips role twice. Money-moving routes already use `withIdempotency`; account-mutation routes don't. ETA: 4h dev.
- **AUDIT-CODE-2 (HIGH)** — Fix idempotency cache poisoning on `POST /api/admin/settings/alerts/[probe]/test-send` 422 path: env-var checks happen AFTER a `probe_runs` row is written; if operator then sets `ALERT_EMAIL_TO` and retries with the same Idempotency-Key, the cached 422 wins. Fix: env preflight before any DB write, OR exclude 4xx from idempotency cache. ETA: 2h dev.
- **AUDIT-CODE-3 (MEDIUM)** — Extract `isUndefinedTableError` helper into `lib/db/errors.ts` and import from `lib/admin/probe-status.ts` + `app/api/admin/settings/alerts/[probe]/test-send/route.ts`. Today duplicated; risk of silent drift. ETA: 1h refactor.
- **AUDIT-CODE-4 (MEDIUM)** — Standardize catch blocks to `catch (err: unknown)` + `err instanceof Error` guards repo-wide. Several catch sites today access `.message` on untyped errors — string-throw or object-throw would crash. ETA: 4h sweep.
- ~~**AUDIT-CODE-5 (MEDIUM)**~~ — **Closed-as-already-done 2026-05-17 (PR #255).** `tests/integration/admin/accounts-mutations.test.ts` covers all three admin account routes (disable, role, postpaid) with 13 cases including anon/non-admin/self-disable/role-flip/postpaid-on-off/idempotency. Created alongside AUDIT-CODE-1 wave. No further action.
- **AUDIT-CODE-6 (MEDIUM)** — Add end-to-end integration test covering full learner-buy → webhook → package-grant → purchase cycle. Today each leg is tested in isolation; no test exercises the seam. Mirrors the BCS-F.1 wire-up gap failure mode (module tested, wire-up not). ETA: 6h test work.
- ~~**AUDIT-CODE-7 (LOW)**~~ — **Closed-as-already-done 2026-05-17.** `lib/calendar/pull-worker.ts:222-237` already emits the success-side `[pull-worker] conflict detector ok` log with `jobId`/`teacherAccountId`/outcome. Anchor comment carries the `AUDIT-CODE-7 (2026-05-17)` tag. No further action.
- **AUDIT-CODE-8 (LOW)** — Add explicit success-side metrics on `drainPullJobs` (events pulled, duration, outcome counts). ETA: 2h.

### Documentation findings (MEDIUM priority)

- **AUDIT-DOC-1 (HIGH)** — Expand `ARCHITECTURE.md §API routes` to cover all 81 routes (currently ~48 documented). The 33 missing are concentrated in `app/api/admin/`, `app/api/account/`, `app/api/admin/reconciliation/`, `app/api/admin/settings/`, `app/api/teacher/` recent additions. Agents discovering API contracts today have to code-read. ETA: 4h sweep.
- **AUDIT-DOC-2 (HIGH)** — Add `ARCHITECTURE.md §Database Schema (Recent Migrations)` section listing migrations 0049–0053 with one-line semantic purpose per new table: `package_grant_resolutions` (PKG-RECON), `probe_runs` (ALERTS-OBS), plus 0051's new `granted_by_operator_id` column with triple-CHECK. ETA: 1h.
- ~~**AUDIT-DOC-3**~~ — **Closed 2026-05-17** (PR #262). PAYMENTS_SETUP.md §Admin-driven package grant теперь ссылается на §Package-buy init вместо дублирования полного `pg_advisory_xact_lock` контракта.
- ~~**AUDIT-DOC-4**~~ — **Closed 2026-05-17** (PR #256). Status headers обновлены на 4 shipped plan docs (pkg-recon, pkg-learner-buy, receipt-3ds-token, alerts-obs).
- ~~**AUDIT-DOC-5**~~ — **Closed-as-already-done.** PAYMENTS_SETUP.md §Receipt-token gate — dual-mode (~line 220) already documents the RECEIPT-3DS-TOKEN session fallback including `chargeWithSavedCard` writing `metadata.accountId`. No action needed.
- **AUDIT-DOC-6 (MEDIUM)** — `docs/public/ROADMAP.md` + `docs/public/ARCHITECTURE.md` lag the May 14-17 wave: no mention of package catalog, admin grant, alerts observability. ETA: 1h.
- ~~**AUDIT-DOC-7**~~ — **Closed 2026-05-17** (PR #262). SECURITY.md §Auth and account layer теперь имеет sentence about the receipt-token gate's dual-mode (token + session-fallback), pointing at PAYMENTS_SETUP for full contract.
- ~~**AUDIT-DOC-8**~~ — **Closed-as-stale 2026-05-17.** ARCHITECTURE.md already documents `probe_runs` 90d retention (line 179). `slot_admin_actions` table belongs to CONFLICT-FEED epic which is PARKED — premature. Operator-facing private runbook deltas (`docs/private/OPERATIONS.private.md`) are out of public-repo scope.

### Aggregate

Total: 4 SEC + 8 CODE + 8 DOC = 20 actionable items. ~46h of dev work + some operator time. None are correctness blockers shipping today.

**Status 2026-05-17 (audit wave fully closed):** 20/20 items closed across PR #252-#268 + post-merge operator run for AUDIT-SEC-1 (Phase B null-out applied on prod, snapshot retained for the 7-day rollback window).

## Cross-cutting backlog — 2026-05-18 (added by product owner)

- **DOC-SPLIT** — Разрезать ENGINEERING_BACKLOG.md на per-epic файлы в `docs/backlog/`. Top-level `ENGINEERING_BACKLOG.md` остаётся индексом; закрытые волны — в `docs/backlog/archive/`. Цель: больше не ронять контекст-окно на одном файле в 1000+ строк.
- **DOC-MODULE-CONTRACTS** — Извлечь module-contracts из `ARCHITECTURE.md` в `lib/*/README.md` per-module (billing/scheduling/auth/payments/calendar/admin/security/db). `ARCHITECTURE.md` остаётся как top-level overview + cross-module диаграмма; контракты на отдельные модули — у каждого модуля под рукой при работе с кодом.
- **API-BOUNDARIES** — Зафиксировать public/private surface между `lib/*` модулями. Каждый `lib/X` экспортирует через `index.ts`; импорт `lib/X/internal/*` или sibling-only файлов из соседнего `lib/Y` запрещён. CI-тест (ts-morph или regex sweep) ловит нарушения. Цель: предотвратить незаметное расширение surface, как было с `internal.ts` уходящим в чужие модули.
- **CRITICAL-PATH-INVENTORY** — Список 20 файлов, поломка которых = production incident: money-moving (`app/api/payments/webhooks/*`, `lib/billing/package-grant.ts`, `lib/payments/store-postgres.ts`), security gates (`lib/auth/sessions.ts`, `lib/auth/learner-archetype.ts`), calendar gates (`lib/scheduling/slots/mutations-cancel.ts`, `lib/calendar/pull-runner.ts`). Список в `docs/critical-path.md`. CI hook: PR трогающая файл из списка требует `Codex-Paranoia: SIGN-OFF` трейлер (не `SUB-WAVE self-reviewed`).
- **COVERAGE-PAYMENTS** — Branches coverage 75% → 85% на платёжных путях (`lib/billing/*`, `lib/payments/*`, `app/api/payments/**`, `app/api/checkout/**`). Coverage report → uncovered branches → тесты на edge cases (refund retry, 3DS callback, postpaid debt summary, advisory-lock contention, webhook signature failures). `vitest.config.ts` coverage thresholds для платёжных путей.

## Bug intake — 2026-05-13

Reported by product owner. Each item: reproduce → verify → fix. Triage TBD; no severity assigned yet — confirm reproduction first, then prioritize.

- **BUG-2026-05-13-1 — back button on payment page lands on home.** Repro: учеником под логином уйти на оплату занятия → нажать «назад» в браузере. Ожидание: возврат в кабинет / к экрану выбора оплаты. Факт: выкидывает на главный лендинг. Фикс: проверить history-stack / `router.push` vs `router.replace` на пути в чекаут; возможно, лишний `replace` на промежуточной странице.
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
