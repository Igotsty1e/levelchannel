---
title: 2026-05-31 — cleanup wave + prod bug fixes + onboarding paranoia
status: IN PROGRESS
date: 2026-05-31 (autonomous orchestrator session)
---

# 2026-05-31 — cleanup wave + prod bug fixes + onboarding paranoia

Orchestration document для autonomous session 2026-05-31: shipped 3 small
production-fix PRs (#458/#459/#460), готовит onboarding-волну через 3-round
paranoia loop, и трекает plan G (`/login?invite` redeem) как новый sub-PR
prerequisite для Sub-PR C learner hints.

---

## Goals

1. **Code-style fixes** из `/tmp/code-style-review.md` — verify-email redirect,
   meeting-link copy, h2 rename, dead `console.log`, URL label sync.
2. **Onboarding spec** — восстановить из adversarial review reports
   (corrupted artefacts) + закрыть 5 BLOCKER round-2 → 3-round paranoia loop.
3. **Prod bugs** из обоих reviews (5 small fixes от code-style review + 5
   BLOCKER из onboarding review r1, plus 5 BLOCKER из r2).
4. **Plan G** — `/login?invite=<token>` redeem route как pre-req для Sub-PR C
   onboarding wave (либо drop the hint).

---

## Tracked PRs

- **#458** — SHIPPED 2026-06-01 (commit be99ff4): prod bug fixes
  - verify-email role-aware redirect (`app/api/auth/verify/route.ts:81-86`)
  - meeting-link copy в `app/cabinet/book/page.tsx:145`
  - dead `console.log` removal в `app/saas/page.tsx:34`
  - «Тарифы» → «Цены занятий» rename
- **#459** — SHIPPED: plan-doc Status flips (SHIPPED-INDEX maintenance)
- **#460** — SHIPPED: DigestPreviewTile reintegration на `/teacher` главную

---

## Plan A — Prod bug fixes

**Status:** SHIPPED в PR #458 (commit be99ff4).

Список фиксов (см. `/tmp/code-style-review.md`):

| # | File | Change |
|---|------|--------|
| A.1 | `app/saas/page.tsx:34` | Remove dead `console.log('saas page hit', siteUrl)` |
| A.2 | `app/api/auth/verify/route.ts:69-72` → :81-86 | Role-aware redirect (admin → /admin/slots, teacher → /teacher, else /cabinet) |
| A.3 | `app/cabinet/book/page.tsx:144-145` | Replace «📹 Ссылку на встречу пришлём после подтверждения» → «📹 Ссылку на встречу пришлёт учитель — обычно за день до занятия» |
| A.4 | `components/teacher/tariff-comparison-card.tsx:124` | h2 rename для нового SaaS-pivot terminology |
| A.5 | `/teacher/tariffs` URL label sync — header «Цены занятий» во всех call-sites |

См. PR #458 body для деталей.

---

## Plan B — Plan-doc Status flips

**Status:** SHIPPED в PR #459.

Обновил `docs/plans/SHIPPED-INDEX.md` со ссылками на новые shipped wave (saas-offer + brand-mark Option O + cabinet mobile-first restructure PR #457). Также flipped Status: PLANNING → SHIPPED для нескольких stale plan-doc'ов.

---

## Plan C — DigestPreviewTile reintegration

**Status:** SHIPPED в PR #460.

Возвращён DigestPreviewTile на `/teacher` главную как 4-й блок (после
restructure в PR #457 он остался без mount'а; в текущем `/teacher/page.tsx` он
УЖЕ интегрирован). Verify: `app/teacher/page.tsx` рендерит 4 блока.

---

## Plan D — Onboarding paranoia round 2

**Status:** COMPLETED — verdict REVISE, see `/tmp/onboarding-review-r2.md`.

Round 2 surfaced 5 BLOCKER + 10 WARN over the round-1-fixed spec'и. Round-1
BLOCKER all closed (5/5 closure verified), но 4 из 5 round-2 BLOCKER — это
**новые fact-checking errors** в round-1 fixes:

1. `lib/i18n/plural-ru.ts` (wrong path — real path `lib/copy/plural-ru.ts`).
2. A0.3 `/login?invite` orchestration mismatch (referenced PR which doesn't
   exist in cleanup-and-bugs.md → плана G).
3. `teacher_invites.inviting_teacher_id` (wrong column — real `teacher_account_id`).
4. `isLearnerTelegramMasterSwitchOn()` (wrong helper — real
   `LEARNER_REMINDERS_TELEGRAM_ENABLED` operator setting).
5. SSR ACCESS SHARE / ACCESS EXCLUSIVE risk (memory pitfall not prevented в
   §2.3 helper contract).

Spec **rewritten from scratch** in this PR (artefacts corrupted by concurrent
agent edit; reviews were preserved as authoritative contract). All 5 round-2
BLOCKER closed:

1. ✅ `lib/copy/plural-ru.ts` path + `pluralRu(n, one, few, many)` signature
   + correct nominative gender («активный ученик» for one).
2. ✅ A0.3 added to this plan as **plan G** below; spec ссылается на plan G.
3. ✅ `teacher_invites.teacher_account_id` (verified mig 0057:23).
4. ✅ `LEARNER_REMINDERS_TELEGRAM_ENABLED` operator setting (verified
   `lib/admin/operator-settings.ts:341-346`) + `resolveOperatorSetting(...)`
   resolver helper pattern.
5. ✅ §2.3 helper contract «No schema mutation in helpers» + cross-ref
   memory `postgres_create_table_locks_during_active_tx.md`.

Plus closures для round-1 BLOCKER #1-5 (verified в round-2 INFO #16-#20).

---

## Plan E — Onboarding paranoia round 3

**Status:** PENDING — orchestrator кикает после restore-spec PR мерджа.

Round 3 will attack:
- 5 round-2 BLOCKER closures (verify the verify pass).
- 10 round-2 WARN closures.
- Any new fact-checking errors introduced by spec rewrite.

Hard cap 3 rounds — если round 3 surfaces remaining BLOCKER, work STOPS и
эскалация owner per `~/.claude/skills/codex-paranoia` contract.

---

## Plan G — `/login?invite=<token>` redeem route (new)

**Контракт:**

Существующий learner (зарегистрированный учитель A1) попадает на инвайт-ссылку
от учителя A2: `/login?invite=<token>`. После успешного логина — POST
`/api/auth/login/redeem-invite` с `{ token, accountId }` → атомически
redeem'ит invite + создаёт `learner_teacher_links` row (если ещё нет;
multi-teacher support) → redirect на `/cabinet`.

**Surfaces:**
- `app/login/page.tsx` — passthrough query `?invite=<token>` через login form;
  hidden input в form preserves token across POST.
- `app/api/auth/login/route.ts` — на success path, если invite query param
  присутствует, после установки session cookie вызывает helper redeem.
- `lib/auth/invite-redeem.ts` (new) — переиспользует логику из register flow
  (`app/api/auth/register/route.ts` invite branch).
- `app/api/auth/login/redeem-invite/route.ts` — optional dedicated route ИЛИ
  inline в login route (simpler).

**Атомарность:** Helper `lib/auth/invite-redeem.ts` вызывает existing
`redeemInviteAndBindLearnerAtomic(inviteId, learnerAccountId)` из
`lib/auth/teacher-invites.ts:399-441` — same helper что register flow
использует. Гарантирует:
- `pg_advisory_xact_lock(hashtext('lc-saas-pivot:learner-teacher-links:<learner_uuid>'))`
  — anti-race с concurrent redeem от разных учителей.
- Dual-write `accounts.assigned_teacher_id` (legacy column нужен до
  post-MVP `0084_drop_assigned_teacher_id`).
- Anti-spoof verify что inviter всё ещё teacher.
- INSERT в `learner_teacher_links` с `ON CONFLICT DO NOTHING`.

⚠️ **НЕ inline CTE** — round-3 WARN #4 явно запретил дублировать логику.
Drift риск vs helper update path.

**Anti-enumeration:** на expired/revoked token — return generic «не удалось
войти, попробуйте обновить ссылку», не «токен expired» (валидный security
concern).

**Тесты:** integration —
1. Учитель А1 пригласил Lerner L (L регистрируется, link A1↔L создан).
2. Учитель А2 шлёт Lerner L новый invite token.
3. L открывает `/login?invite=<token>` → вводит пароль → success.
4. После redirect на `/cabinet` L видит обоих учителей в `TeacherLearnersSection`
   ИЛИ teacher-switcher.
5. Repeat redeem с тем же token → fail (used_at set).

**Owner:** Sub-PR per onboarding wave — отдельный PR (НЕ внутри Sub-PR A
foundation), но depends on Sub-PR A foundation (нужен accountId для redeem).
Ship before Sub-PR C learner hints (Sub-PR C референсит этот route в
`learner-invite-already-registered-link` hint).

**Owner decision required:**
- (a) Ship plan G + keep `learner-invite-already-registered-link` as must-have.
- (b) Drop plan G + drop the hint (понижается до nice-to-have в Sub-PR D или
  убирается полностью).

**Default:** (a) ship plan G — multi-teacher invite — реальный prod gap для
учителей, которые приглашают друг друга по ученикам.

**Estimate:** ~3-4h (route + helper + integration test).

---

## Cross-references

- Round 1 review: `/tmp/onboarding-review-r1.md` (5 BLOCKER + 8 WARN).
- Round 2 review: `/tmp/onboarding-review-r2.md` (5 BLOCKER + 10 WARN).
- Onboarding flows: `docs/plans/onboarding-flows-2026-05-31.md`.
- Onboarding tooltips: `docs/plans/onboarding-tooltips-spec-2026-05-31.md`.

---

**End of 2026-05-31-cleanup-and-bugs.md.**
