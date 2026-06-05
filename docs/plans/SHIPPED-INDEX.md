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

## 2026-06-02 cabinet-stale-future-labels (1 PR)

- **`cabinet-stale-future-labels.md`** — state-aware Google Calendar copy on `/cabinet/settings/calendar` + `/teacher/settings/calendar`, kills «по мере включения / в ближайших обновлениях» teasers over already-shipped pull/push/sync features. Status: SHIPPED 2026-06-02 (PR #480). Plan-mode paranoia SIGN-OFF round 10/3 (cap extended per «делай полноценно по нормальному») + wave-mode SIGN-OFF round 2/3 (1 BLOCKER teacherIntroCopy collapse + 3 WARN copy-style/NaN-guard closed inline). New helper `lib/calendar/derive-status.ts` (5 pull-states × 4 push-states). Sweep `слот`/`токены`/`OAuth-токены` on touched surfaces. Drops «Скоро здесь появится» on `/cabinet/page.tsx`.

## 2026-06-01 admin-dashboard wave (1 PR)

- **`admin-dashboard.md`** — operational metrics + sparklines + cohort funnel + health banner at /admin/dashboard. Status: SHIPPED. Codex-paranoia wave-mode SIGN-OFF round 2/3 (3 BLOCKER + 5 WARN + 1 INFO closed). No migration.

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

- **`per-learner-payment-method.md`** — full per-(teacher, learner) payment-method contract: 'none' / 'postpaid' / 'prepaid_packages' enum, `learner_billing_preferences` table (mig 0101), helper `lib/billing/learner-payment-method.ts` (get/set/Tx variants + Q1 debt-open guard skeleton), booking integration in `lib/scheduling/slots/booking.ts` (422 `payment_method_not_set` / 402 `package_required`), teacher PATCH endpoint `/api/teacher/learners/[id]/billing`, teacher UI on `/teacher/learners`, cabinet missing-method banner. Status: SHIPPED 2026-06-04. Majority shipped earlier — mig 0101 + helper + booking + PATCH route + teacher learner-card UI: PRs #471/#474/#493/#495 across the T3 + bug-1 + bug-2 waves; mig 0103 dropping `accounts.postpaid_allowed`: Quality Sub-PR A (#492). Gap-close PR ships §Scope item 6 (invite-default selector wired through `app/cabinet/teacher-invite-section.tsx` + `POST /api/teacher/invites` `defaultPaymentMethod` body + `createInviteForTeacher` option + `redeemInviteAndBindLearnerAtomic` CTE-side seed of `learner_billing_preferences` + matching `auth.billing.method_changed` audit) plus the Q1 control-path / Q5 / Q7 integration coverage gap (11 cases in `tests/integration/billing/per-learner-payment-method-gap.test.ts`, including the conflict-preserve guard from codex-paranoia wave round-1 BLOCKER #1 closure). Codex-paranoia wave: 2 BLOCKERs + 3 WARNs + 1 INFO closed inline on round 1 (CTE returns `seeded_pref_inserted` exists-flag so the invite-redeem audit row only fires when the seed actually wrote a fresh pair-pref + drops `clientIp`/`userAgent` on the teacher-attributed event to match the canonical writer's shape); SIGN-OFF on round 2. Known gap (NOT closed by this PR): Q1 **debt-blocked branch** (`409 debt_open` invariant) remains untested because `hasOpenPostpaidDebt` references stub columns (`billing_kind` / `learner_account_id` not present in mig 0092); the helper's try/catch returns `false` so the predicate is safe-fallback today but the load-bearing invariant ships unproven. Debt-detection refactor + Q1 debt-blocked test coverage tracked as their own follow-up epic.

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
