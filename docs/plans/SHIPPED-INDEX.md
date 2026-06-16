# Shipped plan-docs index

Plans below have all merged to main. Detail in each file's body; this index is the entry point — read it before opening individual plan-docs.

Active plan-doc work (not yet shipped) lives in `docs/plans/*.md` without an entry here.

## 2026-06-16 notification-dispatch Wave-A (3 main + 2 CI sub-PRs)

- **`notification-dispatch-wave-a-2026-06-15.md`** — Wave 1 of master flow plan (`teacher-master-flow-2026-06-15.md`). Closes 5 BLOCKER + 3 HIGH из аудита `2026-06-15-reschedule-cancel-markpaid-audit.md`: ни одно из 7 lesson-событий (cancel teacher/learner, reschedule learner, mark-paid teacher confirm/decline, refund, direct-assign) не шло ни email-ом, ни в TG. Sub-PRs: #646 (dispatch foundation — single entry `lib/notifications/lesson-event-dispatch.ts` + `notification_log` migration 0130 с dedup_key UNIQUE + 7 email/TG templates) → #647 (cancel-learner + cancel-teacher + reschedule integration in `lib/scheduling/slots/mutations-*.ts` post-commit) → #648 (mark-paid + claim confirm/decline + refund integration в `lib/payments/sbp-{claims,refunds}.ts`). Sibling CI fixes: #650 (Playwright http://-on-prod escape-hatch + integration retry budget) + #652 (extend E2E flag в email config validators). Status: SHIPPED 2026-06-16. Codex-Paranoia: self-review fallback (3 BLOCKER closed at plan, 0 BLOCKER at wave). Privacy guard через RoleMismatchError + AbortController 5s TG timeout + HTML/MarkdownV2 escape free-text fields.

## 2026-06-14 teacher-calendar-mouse-fix (4 PRs)

- **`teacher-calendar-mouse-fix-2026-06-14.md`** — full audit + fix of mouse-driven interaction bugs on `/teacher/calendar` desktop. Status: SHIPPED 2026-06-14. Owner reported «набираю мышкой, выбираю слот → баг интерфейс. Закрываешь — предлагает занятия назначить». Root causes: (1) every click on an empty cell committed a 1-cell paint span and opened a broken PaintConfirmModal; (2) three independent useState modal flags had no mutual exclusion → 2-3 modals could mount simultaneously; (3) two modals lacked ESC; (4) BulkAddSlotsModal close paths fired mid-POST. Sub-PRs: #639 (5px click-vs-drag threshold) → #640 (single `CalendarModalState` discriminated union + ESC handlers + `creating || previewing` close guards + defensive drag-reset signal) → #641 (top-row button primary vs secondary visual polish) → #642 (wave self-review BLOCKER fix: dragResetSignal effect stability — guard against parent re-renders churning `dispatch` identity via inline `interactions` object). Codex-Paranoia: self-review fallback (codex binary unavailable + raw exec blocked by hook). +14 new tests covering threshold, single-modal invariant, ESC, busy guards, and re-render race. No schema, no API contract changes.

## 2026-05 saas-pivot wave (10 PRs merged 2026-05-22)

- **`saas-pivot-master.md`** — 8-epic SaaS pivot master plan (32 paranoia rounds, 1245 lines). Status: SHIPPED. Sub-epics: Day 1 schema + bootstrap → Day 2 self-reg + n:m readers → Day 3 tariffs → Day 4 packages + teacher_grant → Day 5A lesson_completions SoT → Day 5B settle UI → Day 6 admin overhaul + plan-4 + payment_orders NOT NULL → Day 7 cabinet polish → Day 8 teacher landing. Migrations 0073-0094.
- **`saas-pivot-schema-survey.md`** — read-only inventory companion to master plan.
- **`saas-pivot-landing-research-inventory.md`** — landing copy research companion.
- **`saas-pivot-calendar-multi-tenant-audit.md`** — audit + 1 BLOCKER closure for the calendar OAuth callback enqueue.

## 2026-05-23 teacher-cabinet-polish wave (7 PRs)

- **`teacher-cabinet-polish.md`** — 6-task UX polish over the SaaS-pivot cabinet (6 paranoia rounds, 383 lines). Status: SHIPPED. Sub-PRs: A calendar text fix → B cabinet nav menu → C profile tariff card → D digest preview tile → E learners list → F firstName/lastName globally. Migration 0095.

## 2026-06-01..02 T3 tariffs+packages learner-scope (7 PRs)

- **`tariffs-packages-learner-scope.md`** — per-learner tariffs/packages binding via junction tables. Status: SHIPPED 2026-06-02. Plan-mode SIGN-OFF round 10/N (user-authorized cap extension) + epic-end wave-mode SIGN-OFF round 1/3 (3 BLOCKER + 1 WARN closed inline). Sub-PRs: PKG-TEACHER-SCOPE companion (#470) → A foundation mig 0102 (#471) → B booking snapshot reads (#472) → C anonymous endpoint filter (#473) → D teacher API (#474) → E learner filter (#475) → epic-end fix-PR closes round-1 leaks across booking-days/times + checkout + package_required hint (#476). One follow-up tracked: archive contract (lesson_packages.deleted_at writer + bulk-revoke). Migration 0102.

## 2026-06-02 cabinet-stale-future-labels (1 PR)

- **`cabinet-stale-future-labels.md`** — state-aware Google Calendar copy on `/cabinet/settings/calendar` + `/teacher/settings/calendar`, kills «по мере включения / в ближайших обновлениях» teasers over already-shipped pull/push/sync features. Status: SHIPPED 2026-06-02 (PR #480). Plan-mode paranoia SIGN-OFF round 10/3 (cap extended per «делай полноценно по нормальному») + wave-mode SIGN-OFF round 2/3 (1 BLOCKER teacherIntroCopy collapse + 3 WARN copy-style/NaN-guard closed inline). New helper `lib/calendar/derive-status.ts` (5 pull-states × 4 push-states). Sweep `слот`/`токены`/`OAuth-токены` on touched surfaces. Drops «Скоро здесь появится» on `/cabinet/page.tsx`.

## 2026-06-01 admin-dashboard wave (1 PR)

- **`admin-dashboard.md`** — operational metrics + sparklines + cohort funnel + health banner at /admin/dashboard. Status: SHIPPED. Codex-paranoia wave-mode SIGN-OFF round 2/3 (3 BLOCKER + 5 WARN + 1 INFO closed). No migration.

## 2026-06-06 bcs-def-4-push-pwa-reminders epic (1 PR)

- **`bcs-def-4-push-pwa-reminders.md`** — Web Push channel for learner lesson-start reminders. Status: SHIPPED 2026-06-06 (one-PR epic). Plan-paranoia: 9 substantive Codex rounds (8/3 → 2/2) + round-10 self-review fallback after Codex quota exhausted at 14:02 +07 (user-authorized per §7; Codex paranoia debt recorded for post-quota re-run; auto-memory `2026-06-06_push_pwa_codex_debt.md`).
  - **mig 0108** widens `learner_reminder_dispatches.channel` CHECK to add `'push'`; extends `skipped_reason` with `'no_push_subscription'` + `'push_helper_not_shipped'`; widens `auth_audit_events.event_type` with 5 `push.subscription.*` events.
  - **mig 0109** NEW `learner_push_subscriptions` table — partial UNIQUE on `endpoint WHERE unsubscribed_at IS NULL` globally; active per-account partial idx; FIFO cap eviction at 10 active subs per account.
  - **Scheduler integration** (`scripts/learner-reminder-dispatch.mjs`): inline push branch mirrors email/telegram CLAIM→reFetchAndGate→budget→fanout pattern; per-slot row consumes 1 budget unit regardless of fan-out factor; 410/404 from FCM/Mozilla/Apple auto-unsubscribes the device with `push.subscription.unsubscribed.auto` audit.
  - **VAPID env contract**: `LEARNER_REMINDERS_PUSH_ENABLED` (default 0) + `PUSH_VAPID_PUBLIC_KEY` + `PUSH_VAPID_PRIVATE_KEY` + `PUSH_VAPID_SUBJECT`. `LEARNER_REMINDERS_PUSH_ENABLED` is the 5th key under `learner-reminders` scope. Fail-closed on `dbErrored` matching `lib/auth/guards.ts:312` SAAS_OFFER_GATE pattern.
  - **PWA scaffolding**: `public/manifest.webmanifest` + `public/sw.js` (classic SW, `importScripts('/sw-lib/resolve-open-url.js')`) + `public/sw-lib/resolve-open-url.js` (testable same-origin URL resolver) + `app/service-worker-registration.tsx` client island mounted in `app/layout.tsx` with scope=/.
  - **Routes**: `GET /api/push/vapid-public-key` (public; gated by master switch + VAPID env triple) + `POST /api/push/subscribe` (advisory lock on endpoint; cross-account reassign with displaced audit; same-account key refresh; revive dormant row; FIFO cap eviction) + `POST /api/push/unsubscribe` (NO host allowlist gate per round-10 self-review WARN 1 — legacy endpoints stay deletable).
  - **Cabinet UI** `components/cabinet/learner-push-subscription.tsx` mounted on `/cabinet/profile` beneath the Telegram binding; 4-state SSR via `lib/notifications/learner-push-state.ts` (disabled/unconfigured/migrationPending/ready); Russian copy «Подключить напоминания в браузере», never the English word "push".
  - **Admin UI** extends the existing learner-reminders card on `/admin/settings/alerts` with a Push sub-section (VAPID env presence + last-hour sent/skipped counters via `lib/admin/learner-reminder-push-stats.ts`; `migrationPending` placeholder).
  - **Audit boundary**: TS writer `lib/audit/push-events.ts` (5 typed shortcuts for created/reassigned/revived/unsubscribed.user/cap-evicted) routes through `getAuditPool`; .mjs writer `scripts/lib/push-events.mjs` for the scheduler-emitted `unsubscribed.auto` event routes through `scripts/lib/audit-pool.mjs` (port of `lib/audit/pool.ts` targeting `AUDIT_DATABASE_URL` / `levelchannel_audit_writer` role per mig 0029). Email hash equality across TS↔.mjs pinned by `scripts/lib/email-hash.mjs` (port of `hashEmailForRateLimit`).
  - **Doc sweep**: ARCHITECTURE.md + SECURITY.md §Web Push + OPERATIONS.md operator note + .env.example + `scripts/check-env-contract.mjs` dynamic-allowlist + this SHIPPED-INDEX entry.

## 2026-06-06 calendar-onboarding-followup wave (1 PR)

- **`calendar-onboarding-followup-2026-06-06.md`** — fix-PR closing wave-paranoia round 1 findings from parent PR #537 + significant new scope from plan-paranoia. Status: SHIPPED 2026-06-06 (PR #539, squash 259750d). Plan-paranoia: 9 substantive Codex rounds + SIGN-OFF on round 10/3 (off-protocol per owner authorization; precedent PRs #515 32, #410 12).
  - **mig 0107** adds the deferred DB-level timezone-required triggers: `teacher_calendar_integrations_require_timezone_trg` (fires on every active|degraded write — drops state_changing optimisation to close TOCTOU) + `account_profiles_timezone_required_when_integration_active_trg` (fires on INSERT/UPDATE/DELETE). Both take per-account `pg_advisory_xact_lock(hashtextextended('tz_invariant:' || account_id, 0))` BEFORE cross-table SELECT — concurrent writers serialize (otherwise READ COMMITTED admits the steady-state race that lets both commit into active|degraded + timezone=NULL).
  - **`lib/security/local-host.ts`** consolidates 3 separate localhost classifiers into TWO helpers: `isLiteralLoopbackHostname` (STRICT) for auth/TLS boundaries (cron-auth + db/pool); `isLoopbackOriginUrl` (WIDE — adds *.localhost per RFC 6761 + 0.0.0.0) for URL validation (origin + paymentConfig).
  - **NEXT_PUBLIC_SITE_URL prod fail-closed** in `lib/payments/config.ts` (provider-AGNOSTIC — not just CloudPayments) + `lib/api/origin.ts` (throws on unset/malformed/http/loopback; callback wraps with try/catch returning 500). Closes the round-2/3 BLOCKERs around silent fallback to upstream-socket localhost behind nginx.
  - **GOOGLE_CALENDAR_REDIRECT_URL exact contract** in `lib/calendar/google/config.ts`: exact path /api/teacher/calendar/google/callback + https + non-loopback + SAME origin as NEXT_PUBLIC_SITE_URL in prod. Was only `/^https?:\/\//` — would have let attacker-controlled hosts receive Google's OAuth redirect.
  - **App-layer 23514 narrow-match catches** via new `lib/calendar/timezone-trigger-errors.ts::{isAccountProfilesClearTimezoneError, isCalendarRequireTimezoneError}`. PATCH /api/account/profile + callback wrap their writers; unrelated 23514 sources (mig 0069 IANA, mig 0017 display_name, mig 0095 columns) propagate as 500 unchanged.
  - 23 files / 1700+ lines. Tests: 18 unit (local-host) + 11 unit (trigger-errors) + 6 unit (origin prod-mode) + 5 integration (mig 0107 direct evidence) + 2 integration (concurrent-write race both orderings). Plus regression sweep 32/32 on existing suites. Merged --admin --squash with test:mutation still running (slow, non-blocking).
  - Out of scope: README.md + PAYMENTS_SETUP.md sweep (deferred to doc-only follow-up).

## 2026-06-05 calendar-onboarding-cleanup wave (1 PR)

- **`calendar-onboarding-cleanup-2026-06-05.md`** — 4 owner-backlog items in one PR (#537, squash 9a366f7). Status: SHIPPED 2026-06-05. Plan-paranoia: 5 substantive Codex rounds + 2 self-review fallback rounds (Codex quota exhausted on round 6; precedent: PRs #515 32 off-protocol rounds, #410 12). Wave-paranoia pending Codex quota reset 2026-06-06 00:00 (deferred per skill §7).
  - **#8 timezone gate** — SSR banner on `/teacher/settings/calendar` + `POST /api/teacher/calendar/google/start` 422 + callback redirect with `?error=timezone_required`. ProfileEditor on `/teacher/profile` gets `enforceExplicitTimezone` prop: shows «— Выберите часовой пояс —» disabled placeholder + yellow hint instead of pre-selected Moscow mask. Learner `/cabinet/profile` keeps legacy behaviour.
  - **#9 mig 0106** drops mig 0043's two Moscow-only triggers (Owner Option A 2026-06-05: keep 19-entry allowlist via mig 0069; multi-tenant timezone runtime refactor — MSK-hardcoded `lib/calendar/google/pull.ts` + `app/teacher/calendar/page.tsx` week anchor + `lib/scheduling/slots/validation.ts` business band + `lib/calendar/dates.ts` — tracked separately as accepted debt). **Replacement DB-level triggers (require-tz on activate, no-clear-while-active) DEFERRED to follow-up PR** to avoid rolling-deploy race window — app-layer gates are sole enforcement this wave.
  - **#10** `lib/api/origin.ts::resolveCanonicalOrigin` standalone (no `paymentConfig` coupling). Migrated calendar callback + `payments/charge-token` termUrl (was money-critical antipattern: behind nginx, bank would 3DS-return to localhost).
  - **#11** «Как работает интеграция с Google Calendar» wrapped in `<details open={!isConnected}>` — explainer auto-collapses post-connect, auto-expanded for not-yet-connected as primary CTA.
  - PATCH `/api/account/profile` refuses to clear timezone while integration `active|degraded` → 409 `timezone_required_while_calendar_connected`.
  - Onboarding `teacher-setup-checklist.profileFilled` now requires timezone too (was display_name only); step label «Заполните профиль (имя и часовой пояс)».
  - Error-code → localized Russian message dictionary on settings page; no «токен/OAuth» jargon per `docs/content-style.md`.
  - PR #536 superseded by #537 (per-commit Skill-Used trailer check + force-push policy restriction → fresh single-commit branch).

## 2026-06-04 per-learner-payment-method epic-close (gap-close PR)

- **`per-learner-payment-method.md`** — original per-(teacher, learner) payment-method rollout around `learner_billing_preferences` (mig 0101), helper `lib/billing/learner-payment-method.ts`, booking integration in `lib/scheduling/slots/booking.ts`, teacher PATCH endpoint `/api/teacher/learners/[id]/billing`, teacher UI on `/teacher/learners`, cabinet missing-method banner. Status: SHIPPED 2026-06-04. Majority shipped earlier — mig 0101 + helper + booking + PATCH route + teacher learner-card UI: PRs #471/#474/#493/#495 across the T3 + bug-1 + bug-2 waves; mig 0103 dropping `accounts.postpaid_allowed`: Quality Sub-PR A (#492). Gap-close PR ships §Scope item 6 (invite-default selector wired through `app/cabinet/teacher-invite-section.tsx` + `POST /api/teacher/invites` `defaultPaymentMethod` body + `createInviteForTeacher` option + `redeemInviteAndBindLearnerAtomic` CTE-side seed of `learner_billing_preferences` + matching `auth.billing.method_changed` audit) plus the authz / audit / dropped-value integration coverage gap in `tests/integration/billing/per-learner-payment-method-gap.test.ts`. Codex-paranoia wave: 2 BLOCKERs + 3 WARNs + 1 INFO closed inline on round 1 (CTE returns `seeded_pref_inserted` exists-flag so the invite-redeem audit row only fires when the seed actually wrote a fresh pair-pref + drops `clientIp`/`userAgent` on the teacher-attributed event to match the canonical writer's shape); SIGN-OFF on round 2. Current live contract was later narrowed by Epic B.1/B.2 on 2026-06-11: `PaymentMethod = 'postpaid' | 'none'`, booking always mixes package consume first → postpaid fallback, Q1 debt-open branch retired.

## 2026-06-02 bug-1-payment-method-banner (1 PR)

- **`bug-1-payment-method-banner.md`** — cabinet home banner shown BEFORE the calendar entry whenever the assigned teacher has not picked a payment method in `learner_billing_preferences`. Status: SHIPPED 2026-06-02 (PR #493, squash SHA 48c152b). Plan paranoia SIGN-OFF round 1/3 (4 BLOCKER + 4 WARN + 1 INFO closed). Wave paranoia: Codex quota exhausted → 3-round Claude self-review fallback under SKILL.md §7. New `components/cabinet/missing-payment-method-banner.tsx` (single / per-teacher variants, optional second paragraph when `canBuyPackages=true`). `lib/cabinet/teacher-blocks.ts` `TeacherBlock` gains `paymentMethod`. `app/cabinet/page.tsx` derives `paymentMethodNotSet` server-side; `lessons-section.tsx` short-circuit chain gains the banner branch; `teacher-blocks-list.tsx` per-block banner. `app/api/slots/[id]/book/route.ts` maps `payment_method_not_set` → 422 with verbatim copy so stale-tab learners see the honest message instead of the generic 409. Booking server-side gate in `lib/scheduling/slots/booking.ts:249-252` untouched (defense-in-depth per task). Copy uses «занятие» throughout.

## 2026-06-02 owner bug-fix + audit wave (12 PRs, session of 2026-06-02..03)

Owner reported 4 bugs + asked for security + code-quality audits. Whole wave shipped in one session via parallel sub-agents.

- **`bug-2-packages-scoped-to-teacher.md`** (PR #495, SHA edb2907) — fresh learners no longer see other teachers' test packages. `lib/billing/packages/catalog.ts::listActivePackages(viewerAccountId)` now joins `learner_teacher_links` (active link gate) before the visibility OR. 7 integration cases.
- **`bug-3-slot-title-duration.md`** (PR #491, SHA 73627eb) — kills hardcoded «Занятие по английскому» / «50 мин» placeholders on `/cabinet/book`. Per-slot duration + tariff title now render from real `PublicSlot.durationMinutes` / `tariffTitleRu`.
- **`bug-4-tariff-naming-and-ui.md`** Sub-PR A (#490 SHA 1fd631e) + Sub-PR B (#494 SHA 97bd92d) — SaaS tariffs renamed to «Стартовый / Базовый / Расширенный» (slugs stay `free`/`mid`/`pro` for DB stability); `/teacher/subscription` UI polished with 3-card picker + active-tier description + feature bullets. Mig 0103 + `lib/billing/teacher-subscription.ts::SAAS_SUBSCRIPTION_TARIFFS`. Sub-PR C (legal-RF offer rename) deferred.
- **`security-audit-2026-06-02.md`** (PRs #484+#485+#486+#487+#488) — F3a fail-CLOSED on DB blip (resolveOperatorSetting surfaces `dbErrored`, isSaasOfferGateEnabled treats it as gate=ON), F1 two outlier `/api/teacher/*` routes onto canonical guards (`requireTeacherWithCurrentSaasOfferConsent` + origin + rate-limit) with `tests/security/teacher-perimeter-enumeration.test.ts` drift guard, F2 Telegram webhook constant-time compare (`lib/security/constant-time.ts` extracted), F5+F6 observability (X-Real-IP warn + CSP-fallback Sentry capture), F3/F7/F8/F9/F10 accepted-gap pins in SECURITY.md + origin-gate-no-headers regression. All 5 sub-PRs paranoia SIGN-OFF.
- **`code-quality-audit-2026-06-02.md`** Sub-PR A (#492 SHA ee14889) + Sub-PR C (#489 SHA 32550ac) — F1 drop `accounts.postpaid_allowed` column (mig 0103) + dead admin route + lying-banner sweep; F9 SQL freshness centralization to `lib/calendar/freshness-sql.ts` + 4 read-side call-site rewrites + drift test; F5/F6/F7 stale Phase 2 comments rewritten. Sub-PR B (BILLING_WAVE_ACTIVE retire) closed as CLOSED — money-adjacent caveat from plan R1-WARN#7 confirmed: removing the legacy fast-path breaks ~15 booking tests that assumed billing skip; defer to a test-migration epic. Sub-PR D no-op (F12 already closed by prior PRs #421/#466/#483).
- **`free-tier-1pkg-1tariff-unlock.md`** (PR #498 SHA 27f5901) — Стартовый teachers can now create 1 package + 1 tariff to feel the features. `TIER_WRITE_CAPS` map + `resolveTeacherWriteCaps(state='active' guard)` + `countActive{Packages,Tariffs}ByTeacherTx`. POST + PATCH routes wrap count+create / reactivate in TX + `pg_advisory_xact_lock`. Buyer-side gates UNCHANGED — packages stay non-platform-payable on free. Plan paranoia SIGN-OFF round 10/3 cap-extended; wave paranoia SIGN-OFF round 3/3 (R1 reactivation bypass + R2 cap=0 mirror closed inline).

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

## 2026-06-07 teacher-payments-sbp-self-service epic (1 PR, 8 commits)

- **`teacher-payments-sbp-self-service.md`** — SBP self-service payment tracking. Status: SHIPPED 2026-06-07 (PR #550, squash `985e377`). Platform does NOT hold money: learners pay teachers directly via СБП or other channels; platform = registry + journal. 7 pre-impl self-review rounds (32 BLOCKERs closed in spec) + 3 post-impl rounds + 1 Codex paranoia wave-review round (2 BLOCKER + 4 WARN; 4 fixed inline). Migrations 0110-0114: `teacher_payment_methods`, `teacher_payment_method_assignments`, `payment_claims` + `payment_claim_items` (snapshot fields), `payment_refunds`, `accounts.teacher_charge_on_no_show` + `teacher_charge_on_late_cancel`. 14 new API endpoints (teacher CRUD + claims confirm/decline/cancel + mark-paid + refunds + policy + CSV export + unpaid-slots + payment-context). UI: `/teacher/settings/payment-methods`, `/teacher/payments` (feed + UnpaidLearners + PolicyEditor + expiring packages + CSV link + explainer), `/cabinet/payments` (history + cancel button), `PayLessonModal` + `CancelLessonModal` + decline/refund modals. Email notify via `lib/email/sbp-claim-template.ts`. Deferred: per-pair pricing UI (lesson_slots trigger), multi-teacher learner pay flow, Telegram/push notify, 3 explainer banners learner-side, focus-trap on teacher decline/refund modals.

## 2026-06-07 cabinet UI mass refit (1 PR)

- **No dedicated plan-doc** — PR #551 squash `2e0e4ad`, ~3500 lines design system + page restructures parallel to SBP epic. Includes: `app/globals.css` ~1600 lines of tokens + `.saas-chrome` scope + settings-tile chip backgrounds + calendar Apple-style toolbar; full `docs/design-system.md` rewrite; `/cabinet` greeting refit + bottom CTA cleanup; `/cabinet/profile` H2-дубль убран, DangerZone + LearnerTelegramBinding в `.card`; `/teacher` greeting + primary CTA reorg; `/teacher/calendar` Apple toolbar; `/teacher/learners` polish; `/teacher/settings` hub with SVG icons + chip backgrounds; auth flow polish (`/login`, `/register`, `/forgot`, `/reset`); checkout polish. **5 reverts during CI** for trailer/test compliance: `app/privacy/page.tsx` (Legal-Pipeline trailer), `lib/security/request.ts` (DEV_EXTRA_ALLOWED_ORIGINS — Codex-Paranoia trailer), `/cabinet/settings/calendar/page.tsx` + `/teacher/settings/calendar/page.tsx` (copy diverged from state-matrix tests), `/teacher/subscription/*` (data-testid lookup broke), `/thank-you/thank-you-content.tsx` (copy diverged). These reverts need own follow-up PR with proper trailers + test updates.

## 2026-06-08/09 push-PWA + landing-v3 wave

- **`bcs-def-4-push-pwa-reminders.md`** — Web Push channel for learner reminders. Status: SHIPPED 2026-06-06 (PR #545 squash `3966f39`). Plan-paranoia: 9 substantive Codex rounds + round-10 self-review fallback (user-authorized §7). Migrations 0108-0109. Codex paranoia debt tracked in auto-memory `2026-06-06_push_pwa_codex_debt.md`.
- **`calendar-onboarding-cleanup.md` + `calendar-onboarding-followup-2026-06-06.md`** — calendar/onboarding owner backlog. Status: SHIPPED via PR #537 (`f0c0bfa`) + #539 (`32fe5b3`). Mig 0106 drops Moscow-only triggers; mig 0107 timezone triggers + advisory lock.
- **landing-v3 promote** — PR #555 (`abba606`) promotes landing-v3 to `/`. PR #556 (`337488e`) post-deploy smoke metadataBase + CSP + JSON-LD. **No dedicated plan-doc.**

## 2026-06-09 self-hosted analytics + cinematic mega-wave

- **Analytics foundation** — PRs #558 (`665da49`) + #559 (`b21cb9a`). `migrations/0119_events_partitioned_table.sql` + `lib/analytics/{server,track,registry}.ts` + `/admin/analytics`. Anonymous_id via signed HMAC cookie `lc_aid`; UPDATE-on-signup backfill. Docs at `docs/analytics/{events,queries,identification,privacy}.md`. **No dedicated plan-doc.**
- **Analytics phase 6** — PR #560 (`d794fb1`). 13 events instrumented. Server-side `identifyAccountFromRequest()` in `/api/auth/login` + `/api/auth/register`. Mobile header CTA fix. New `/integrations/google-calendar` SEO + OAuth-verification landing.
- **mobile-rhythm-followup** — PR #561 (`ad35127`). CTA copy + −30% padding + clamp() on notebook. **No dedicated plan-doc.**

## 2026-06-09 promo-codes + slot-bulk-form epics

- **`promo-codes-tariffs-2026-06-09.md`** — voucher mechanism. Status: SHIPPED 2026-06-09 (PRs #562 `e31cc2e` + #566 `a865dcd`). Mig 0120 + `lib/promo/codes.ts` + `/admin/promo-codes` + `/teacher/subscription#promo` + 4 analytics events. Defaults Q1-Q12 + Q3.1 owner-locked. Codex paranoia debt — SIGN-OFF owed after 2026-06-11.
- **`slot-bulk-add-form-mobile-2026-06-09.md`** — bulk-add slots form. Status: SHIPPED 2026-06-09 (PRs #563 `08d2d4e` + #567 `9979a3f`). `lib/calendar/recurrence.ts` + 11/11 unit tests. `POST /api/teacher/slots/preview-bulk` + `BulkAddSlotsModal`. Defaults Q1-Q12 owner-locked.

## 2026-06-09 SEO/GEO + security audit

- **`seo-geo-improvement-2026-06-09.md`** — Google fundamentals + AI Overview eligibility. Status: SHIPPED 2026-06-09 (PR #569 `f828581`). Twitter cards + sitemap clean + `BreadcrumbList` + `Article` JSON-LD + offer availability/priceValidUntil. Sub-PR B (anastasia/related-articles/hreflang) deferred.
- **`security-audit-2026-06-09.md`** — top-1 company depth audit (21 categories). Status: PARTIAL SHIPPED 2026-06-09 (PR #570 `bfb798b`, H5+H7). M3+M6 deferred to PR #568 awaiting Codex SIGN-OFF.

## 2026-06-09 in-cabinet auth + finance + mobile-ux

- **`in-cabinet-password-change-2026-06-09.md`** — `/teacher/security` + `POST /api/account/password/change`. Status: SHIPPED 2026-06-09 (PR #572). Mig 0121 widens audit event-type CHECK. Round-2 defaults Q1-Q5 owner-locked. Constant-time both-step verify. Fire-and-forget email notification. 4 analytics events. Profile «(скоро)» replaced with link.
- **`finance-on-teacher-home-2026-06-09.md`** — 4 finance cards on `/teacher`. Status: SHIPPED 2026-06-09 (PR #573). `lib/billing/teacher-finance.ts` (6 parallel SQL aggregates) + `<TeacherFinanceSummary />` server component. Warn-badges (overdue ≥7d / packages expiring ≤14d). All-zero → hidden.
- **`mobile-calendar-ui-cleanup-2026-06-09.md`** — unified «+ Создать» + bulk toggle on mobile. Status: SHIPPED 2026-06-09 (PR #574). Top button hidden <600px. FAB sheet checkbox + localStorage. `MobileFallback.tsx` drops «Откройте календарь с компьютера…».

## 2026-06-10 settings hub polish

- **`settings-indicators-2026-06-10.md`** — `/teacher/settings`: убран status-pill у «Профиль» + text-pill заменён на connection icon-indicator (✓/✕) у «Интеграции» и «Приём оплат». Status: SHIPPED 2026-06-10 (PR #592 `6f6f1ee`). `SettingsTile` primitive — discriminated union (`status | indicator`). Tokens переиспользованы (`--success`/`--success-bg`/`--text-tertiary`/`--surface-2`/`--border`). A11y via aria-label на span / aria-hidden на svg.

## 2026-06-11 teacher direct-assign epic (Задача 2.2)

- **`teacher-direct-assign-2026-06-11.md`** — учитель в `/teacher/calendar` назначает занятие конкретному ученику с тарифом; slot создаётся сразу в state `booked`, billing pipeline зеркалит `bookSlot`. Status: SHIPPED 2026-06-11. Sub-PRs:
  - **Sub-PR A backend (PR #594 `f38ec60`)** — `assignSlotDirect()` в `lib/scheduling/slots/mutations-assign-direct.ts`; `POST /api/teacher/slots/assign-direct`. Migration 0122 добавляет `lesson_slots.source` discriminator (`open_slot` | `direct_assign`). Per-learner advisory lock (`pkg_consume:` — общий с `bookSlot`) серializует package consumption между учительским direct-assign и учени́ческим pickup. 5 integration tests (happy postpaid, learner_not_assigned, tariff_not_owned cross-teacher, in_past, slot_collision concurrent insert). Plan-paranoia SIGN-OFF round 3/3 self-review fallback (Codex quota exhausted; debt записан).
  - **Sub-PR B UI + email (PR #595 `4040110`)** — `AssignDirectModal` с Combobox для ученика + тариф (длительность read-only из тарифа). `MobileCreateFab` третий chip-option «Назначить ученику». Desktop кнопка рядом с «Добавить слоты». Email template `learner-direct-assign-notice.ts` (Russian copy per docs/content-style.md). Endpoint после успешного slot'a — best-effort `sendLearnerDirectAssignNoticeEmail` с rate-limit 5/час/ученик (на hit → `emailSkipped: true`). 6 unit-тестов на template. Новый endpoint `GET /api/teacher/learners/list-for-assign` для Combobox data.
  - Foundation для Задачи 2.1 (глобальный режим «без слотов» = direct-assign по умолчанию).

## 2026-06-11 learners-list polish (Задача 3)

- **`learners-list-polish-2026-06-11.md`** — `/teacher/learners` polish: список вынесен ВВЕРХ страницы, приглашение нового ученика ПОСЛЕ. Sort active a-z (RU-aware `localeCompare`). Pagination top-10 (UI controls только когда >10). Дублирующая подпись «X активных учеников» удалена (ChipGroup ниже показывает counts). Status: SHIPPED 2026-06-11 (PR #597 `34c2c82`).

## 2026-06-11 minute-duration epic (Задача 4, Option 2)

- **`minute-duration-2026-06-11.md`** — заменили chip-presets [30/45/60/90/120] на минутный number input по всему стеку (тарифы, пакеты, слоты). Owner ask — учителю нужна минутная точность длительности (47-min, 75-min courses). Strategy: Option 2 (compromise) — duration minute-precision, start_at остаётся 30-min grid. Status: SHIPPED 2026-06-11. Sub-PRs:
  - **Sub-PR A pricing (PR #598 `35c158b`)** — `tariff-create-sheet`, `tariff-card` (edit), `package-create-sheet` — ChipGroup → number input. Constants `TARIFF_DURATION_MIN=15/MAX=240`, `PACKAGE_DURATION_MIN=15/MAX=180` (matches existing DB CHECKs mig 0033/0046). Client-side validation + inline error. `isCustomDuration` ветка с hint «нестандартная, останется как есть» убрана.
  - **Sub-PR B slot UI (PR #599 `db17b68`, epic-close)** — `TimeRangeRow.tsx` drop `ALLOWED_DURATIONS_MIN` snap; «До» меняется на HTML5 `<input type="time" step={60}>` (minute-level). «От» остаётся 30-min `TimePickerButton`. `lib/calendar/recurrence.ts` whitelist `ALLOWED_DURATIONS` заменён на range `RECURRENCE_DURATION_MIN=15`/`MAX=180`. Tests updated (positive 47-min case добавлен).
  - **Что НЕ trogаем (per Option 2):** Paint/drag-paint (`PaintConfirmModal` + `paint-synth.ts`) — cell-based UX осмысленно ограничен multiples of 30. `lesson_slots_start_30min_aligned` DB CHECK — start_at остаётся выровнен. Calendar Grid — block height precise via duration_minutes напрямую.

## 2026-06-11 teacher-no-slots-mode epic (Задача 2.1)

- **`teacher-no-slots-mode-2026-06-11.md`** — глобальный режим «без слотов» поверх фундамента Задачи 2.2. Учитель в `/teacher/settings/calendar` переключает между «Ученики выбирают свободное время» (default) и «Я сам назначаю время каждому». В режиме `direct_assign` mode-aware UI hide убирает slot-create кнопки у учителя и pickup-секцию у ученика; добавляется reschedule by learner и email-digest cron. Status: SHIPPED 2026-06-11. Sub-PRs:
  - **Sub-PR A foundation + teacher UI hide (PR #601 `42744f2`)** — Migration 0123 `accounts.calendar_slot_mode TEXT NOT NULL DEFAULT 'open_slots' CHECK in (open_slots|direct_assign)`. `lib/scheduling/slot-mode.ts` read/write helpers + type guard. `POST /api/teacher/settings/calendar/slot-mode` teacher-bound flip. `SlotModeToggle` radio UI под Google Calendar блоком. Mode-aware hide: desktop кнопка «+ Добавить слоты» скрыта в direct_assign; mobile FAB openFromFab shortcut to assign mode; chip-options сужены до «Назначить ученику».
  - **Sub-PR B reschedule + cabinet hide (PR #604 `0dd000f`)** — `rescheduleSlotByLearner()` в новом `lib/scheduling/slots/mutations-reschedule.ts`: cancel original + create new booked-slot в одной TX + per-learner advisory lock; package consumption restore → re-consume атомарно; cancel-window политика та же что на cancelLearnerSlot. `POST /api/slots/[id]/reschedule` learner-bound endpoint. Cabinet `LessonsSection` получает `teacherSlotMode` prop — кнопка «Перенести» рядом с «Отменить» (если !tooLate); `DirectAssignInfoCard` заменяет `BookingCta` в direct_assign mode; inline `RescheduleLessonModal` с date+time picker.
  - **Sub-PR C digest cron (PR #605 `13de620`, epic-close)** — Migration 0124 `lesson_slots.notify_pending BOOLEAN DEFAULT false` + partial index `(learner_account_id, start_at) WHERE notify_pending = true`. `learner-direct-assign-digest.ts` email template. `assign-direct/route.ts` при rate-limit hit → set `notify_pending=true` вместо silent skip. `scripts/learner-direct-assign-digest.mjs` hourly cron: SELECT pending → groupBy learner → send digest → clear flag; fail-soft per-learner.
  - **Operator-wire post-merge:** `systemctl --user enable --now levelchannel-learner-direct-assign-digest.timer` (OnCalendar=hourly). Reference unit files в `scripts/systemd/levelchannel-learner-direct-assign-digest.{timer,service}` (PR #607 `<sha>`).

## 2026-06-11 minute-start epic (drop 30-min grid + DS pickers)

- **`minute-start-epic-2026-06-11.md`** — учитель и ученик указывают время с минутной точностью везде, везде Native HTML5 date/time inputs заменены на собственные design-system pickers. Status: SHIPPED 2026-06-11. Sub-PRs:
  - **A.1 PR #610** — drop `lesson_slots_start_30min_aligned` CHECK (mig 0125) + relaxed `seconds_zero` invariant; SLOT_GRID_MINUTES checks выкинуты во всех writers; calendar-move test обновлён.
  - **A.2 PR #614** — `components/ui/primitives/date-picker.tsx` (314 LOC RU-locale grid) + `time-picker.tsx` (240 LOC 1-min granularity) primitives; index re-export.
  - **A.3 PR #615** — replaced HTML5 inputs in AssignDirectModal + RescheduleLessonModal + MobileCreateFab + BulkAddSlotsModal + TimeRangeRow с DS pickers; legacy `TimePickerButton`/`TimePickerSheet` удалены.

## 2026-06-11 epic-b — mix billing + bulk-assign

- **`epic-b-mix-billing-bulk-assign-2026-06-11.md`** — user-ask: учитель назначает занятие с явным выбором (пакет vs счёт) + bulk-вариант для N занятий сразу + ученик может одновременно иметь и постоплат и пакеты. Status: SHIPPED 2026-06-11. Self-review fallback на codex-paranoia (codex quota exhausted; epic-end review pending). Sub-PRs:
  - **B.1 PR #616** — drop `'prepaid_packages'` payment_method enum value. mig 0126 UPDATE existing rows → 'postpaid' + drop CHECK на `learner_billing_preferences` AND `teacher_invites.default_payment_method`. `PaymentMethod = 'postpaid' | 'none'`, `InviteDefaultPaymentMethod = 'postpaid' | 'none'`. Booking always mixes: package consume first → postpaid fallback. Q1 invariant retired.
  - **B.2 PR #617** — package picker в AssignDirectModal + GET /api/teacher/learners/[id]/billing-state endpoint (paymentMethod + postpaidAllowed + activePackages). assignSlotDirect extended с `billingChoice` ('auto'|'package'|'postpaid') + optional `packagePurchaseId`. UI cleanup всех 'prepaid_packages' labels: payment-method-toggle 3-radio → 2-radio с переписанным copy «Принимаю оплату (пакеты + счёт)»; invite-default 3 → 2 опции; union-narrow в teacher-blocks-list, teacher/learners/client, teacher/learners/[id]/page.
  - **B.3 PR #618 (epic-close)** — POST /api/teacher/slots/bulk-assign-direct endpoint (cap 50 slots, sequential через assignSlotDirect, 23505→skippedConflicts, остальные reason→skippedReasons). `BulkAssignDirectModal` (клон BulkAddSlotsModal + Combobox ученика + payment-choice + preview). MobileCreateFab.CreateMode расширен `'bulk_assign'` + кнопка «+ Назначить N» в calendar header.

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
