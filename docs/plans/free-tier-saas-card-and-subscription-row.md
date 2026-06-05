# Free-tier «Стартовый» — card + subscription-row backfill (2026-06-05)

**Status:** Plan-paranoia round 8 (off-protocol cap; unverified due to Codex quota exhaustion at 2026-06-05 ~14:30 UTC). Round trail: r1 5B+2W+2I → §0a closures + owner add-on; r2 2B+2W+2I → §0b closures; r3 1B+2W+3I → §0c closures; r4 1B+3W+2I → inline closures; r5 1B+3W → §0d closures; r6 1B+3W → inline closures (survey expansion + type-shape scrub + persona); r7 1B+1W → inline closures (thorough Survey 4 enumeration + verified-teacher persona refinement); r8 codex-quota-exhausted, verification pending until ~18:30 UTC. Implementation proceeds under residual risk; wave-paranoia round MUST run before PR open per skill §1.5 one-PR-epic contract.
**Owner context:** Owner-flagged production regression on 2026-06-05. Two visible bugs:
1. `/teacher/subscription` page shows only «Базовый» + «Расширенный» cards. The free «Стартовый» card is missing despite the intro paragraph naming it. Source-level root cause: `app/teacher/subscription/page.tsx:43` hardcodes `['mid', 'pro']` filter AND `lib/billing/teacher-subscription.ts:31, 290-321` `SAAS_SUBSCRIPTION_TARIFFS` constant has no `'free'` entry.
2. `/teacher/tariffs` page shows «Создание тарифов недоступно на вашем тарифе» for `admin@levelchannel.ru` (who is also a teacher). Root cause: `resolveTeacherWriteCaps()` at `lib/billing/teacher-subscription.ts:411` returns `EMPTY_CAPS = {0, 0}` when there's no `teacher_subscriptions` row. The free-tier unlock landed (PR #498, `TIER_WRITE_CAPS.free = {1, 1}`) but only activates when a row exists — and `app/api/auth/register/route.ts:260` does not insert a free row on teacher registration. All teachers registered after the SAAS bootstrap mig 0083 (and `admin@levelchannel.ru` itself if it was demoted) hit `EMPTY_CAPS`.

**Parent plan:** `docs/plans/free-tier-1pkg-1tariff-unlock.md` (SHIPPED 2026-06-03, PR #498). This is the corrigendum/finish PR for §1.E row 7 (free-tier catalogue entry) and the missing registration-time write.

## 0. Plan-paranoia gate

This file MUST go through `/codex-paranoia plan` round 1 (one-PR epic per `~/.claude/skills/codex-paranoia/SKILL.md §1.5`). Hard cap = 3 rounds. Plan-paranoia is justified because the fix touches `app/api/auth/register/route.ts` (auth path) and `lib/billing/teacher-subscription.ts` (billing surface).

Round 1: 5 BLOCKER + 2 WARN + 2 INFO (raw: `/tmp/codex-paranoia-20260605T102154Z-free-tier-fix-plan/round-1.md`). All 9 findings closed in §0a below. Owner add-on: confirm `/teacher/packages` is also broken — answer: YES, same root cause (`resolveTeacherWriteCaps`), same fix (register-time INSERT + backfill mig). No additional code change for packages — `app/teacher/packages/client.tsx:48-49` already handles `writeCap=0` correctly; the fix below ensures `writeCap=1` reaches it.

## 0a. Round-1 findings closures (round-2 prep)

### Closure §0a-1 — BLOCKER #1 (type widening pollutes paid-only contracts)

`TeacherSubscriptionTier` is currently used as a PAID-ONLY contract by `createOrRenewTeacherSubscription` (`lib/billing/teacher-subscription.ts:148-155`) and `/api/teacher/subscribe` (`app/api/teacher/subscribe/route.ts:65-77`). Widening it to `'free' | 'mid' | 'pro'` would let a caller `createOrRenewTeacherSubscription({tier: 'free'})` which makes no semantic sense (free has `amountKopecks: 0` — would write a "paid" row for 0 ₽).

Fix: SPLIT the type:
- Keep `TeacherSubscriptionTier = 'mid' | 'pro'` (paid-only; unchanged signature for `createOrRenewTeacherSubscription` + subscribe route).
- Add NEW `SubscriptionCatalogTier = 'free' | 'mid' | 'pro'` (display-only; used by `SAAS_SUBSCRIPTION_TARIFFS` and the subscription page).
- `SAAS_SUBSCRIPTION_TARIFFS: Record<SubscriptionCatalogTier, SubscriptionTariff>` gets the `free` entry.
- `getSubscriptionTariff(tier: string)` accepts any string and returns the entry from the catalog (now including `free`).

### Closure §0a-2 — BLOCKER #2 (subscription page scope is wider than `page.tsx`)

The actual rendering lives in `app/teacher/subscription/client.tsx:8-15, 21-41, 266-335` (Client Component). The `page.tsx:43` filter is correct in the SSR-only PaidTier-derived list, but the CLIENT component receives that list and renders cards from it. Tests at `tests/teacher-cabinet-polish/subscription-ui-pick-tier.test.tsx:6-10, 43-48` explicitly pin "exactly 2 cards" + "no Стартовый". Both files need editing + the test needs updating.

Updated EXTEND list (§2 below) replaces "app/teacher/subscription/page.tsx" with BOTH `page.tsx` AND `client.tsx`.

### Closure §0a-3 — BLOCKER #3 (free-card semantics across pick-tier vs active states)

`/teacher/subscription` is bimodal: (a) if teacher has active paid row → renders that ONE active card with cancel/manage controls; (b) if no active paid row → renders the pick-tier grid (today: 2 cards; after this PR: 3 cards). Free is NEVER an "active paid card" — it's always the implicit default.

Locked semantics for this PR:
- **Pick-tier mode** (default state for free teachers): 3 cards. Стартовый shows «Доступен по умолчанию» chip (no button). Mid/Pro show «Подписаться».
- **Active-paid mode** (teacher on Mid/Pro): KEEP the existing single-card rendering. Стартовый is NOT shown — it's implicit (a Mid teacher already has > free's caps).
- **Cancelled-paid mode** (mid/pro with `state='cancelled'`): falls back to pick-tier mode (same as default state).

No "Текущий тариф" chip on the free card (the active-paid teacher doesn't see it, the free teacher sees the «Доступен по умолчанию» chip which carries the same meaning).

§1 in-scope row 2 + risk #4 updated to match.

### Closure §0a-4 — BLOCKER #4 (register-time INSERT failure model)

The register route is intentionally non-transactional (per comment at `app/api/auth/register/route.ts:265-270`). Failure of any post-`createAccount` write leaves partial state on disk.

Locked failure model (mirrors `grantAccountRole` precedent at line 256-258):
- INSERT `teacher_subscriptions{plan_slug='free', state='active'}` is FATAL on error (NOT best-effort). If it fails, the route returns 500. The half-provisioned account stays on disk (account + role committed); user retries get "email already in use" → can use password reset to recover.
- `ON CONFLICT (account_id) DO NOTHING` makes the INSERT idempotent — re-running register on a partially-provisioned account is safe.
- Backfill mig (0105) is the safety net for any account that slipped through.

The rationale: returning `ok: true` without the row would silently put the teacher into `EMPTY_CAPS` — exactly the bug we're fixing. Fail-fast 500 prompts retry; the backfill mig then heals it.

### Closure §0a-5 — BLOCKER #5 (backfill must NOT filter `disabled_at`)

`reenableAccount()` at `lib/auth/accounts.ts:356-366` just clears `disabled_at` + `scheduled_purge_at`. If the backfill skips disabled teachers, re-enabled teachers stay row-less and hit `EMPTY_CAPS` again.

Backfill mig 0105 filters ONLY on `purged_at IS NULL` (excludes hard-purged accounts which are pending DB removal). `disabled_at` accounts are INCLUDED.

### Closure §0a-6 — WARN #6 (dual-role justification incorrect)

`grantAccountRole` throws `role/admin_exclusive` on consumer-role grants to admins (`lib/auth/accounts.ts:294-323`), so there's no "admin+teacher dual role" case via the register path. The `ON CONFLICT DO NOTHING` is justified by (a) re-running the backfill on the same DB, (b) the half-provisioned-account retry case from §0a-4. Removed the incorrect justification from risk #3.

### Closure §0a-7 — WARN #7 (existing test contracts will break)

Updated test plan (§4 below):
- `tests/billing/teacher-subscription.test.ts:69-75` — `getSubscriptionTariff('free')` currently expected to return `null`; update to assert it returns the new Стартовый entry.
- `tests/teacher-cabinet-polish/subscription-ui-pick-tier.test.tsx:6-10, 43-48` — currently asserts "exactly 2 cards" + "no Стартовый"; update to assert "exactly 3 cards" + "Стартовый visible with «Доступен по умолчанию» chip".
- `tests/integration/saas-pivot/free-tier-write-cap.test.ts:172` — case-7 "no-row" defensive pin stays; docstring renamed to "legacy no-row defensive state".
- NEW: `tests/integration/auth/register-free-subscription-row.test.ts` — pins register-time INSERT shape (teacher → row inserted; student → no row).
- NEW: integration test for backfill mig 0105 (idempotency + correct row selection).

### Closure §0a-8 — INFO #8 (0105 prefix free locally)

Confirmed by the guard added in PR #533 (`scripts/check-migration-prefixes.mjs`). Risk of an unmerged parallel branch with the same prefix is rebased-at-CI-time concern, not a planning blocker.

### Closure §0a-9 — INFO #9 (anti-spoof OK)

Register-time INSERT uses `account.id` from the server-created `createAccount` return value. No body-supplied id. Confirmed correct.

## 0b. Round-2 findings closures (round-3 prep)

### Closure §0b-1 — BLOCKER #1 (admin grant-teacher-role path missing free-row INSERT)

`app/api/admin/accounts/[id]/role/route.ts:95` is a SECOND writer-path to the `teacher` role (operator promotes a learner to teacher via admin UI). Today this path calls only `grantAccountRole(id, 'teacher', actorId)` and does NOT INSERT `teacher_subscriptions`. A teacher granted the role via admin would hit `EMPTY_CAPS` same as the self-register-without-row case.

Fix added to §1 scope: the SAME INSERT (`teacher_subscriptions{plan_slug='free', state='active'}` with `ON CONFLICT DO NOTHING`, FATAL on non-conflict error) lands at BOTH call sites:
- `app/api/auth/register/route.ts:260` (self-register `requestedRole === 'teacher'` branch).
- `app/api/admin/accounts/[id]/role/route.ts:95` (admin grants `teacher` role).

`app/api/admin/accounts/[id]/role/route.ts` added to §2 EXTEND list. Per-route integration test added to §4 covering admin-grant path.

### Closure §0b-2 — BLOCKER #2 (stale text in §3 + risk #1)

§3 (Migration safety) and risk #1 wording is updated to match §0a-4 and §0a-5:
- §3: backfill filter is `purged_at IS NULL` ONLY (NO `disabled_at` filter — re-enabled teachers keep row).
- Risk #1: failure mode is FATAL (500), NOT best-effort. Backfill mig 0105 is the safety net for any account that slipped through. Self-recoverable via password reset (per §0b-5 INFO).

### Closure §0b-3 — WARN #3 (webhook calls createOrRenewTeacherSubscription)

`app/api/payments/webhooks/cloudpayments/pay/route.ts:224` calls `createOrRenewTeacherSubscription({tier: tariff.tier, ...})` where `tariff` comes from `getSubscriptionTariff(plan_slug)`. If `getSubscriptionTariff('free')` now returns an entry, a malicious or buggy payment for the `free` slug would try to create a paid row for 0 ₽ — semantic violation.

Fix: introduce a NARROWING helper `getPaidSubscriptionTariff(tier: string): PaidSubscriptionTariff | null` that returns ONLY `mid` / `pro` entries (NEVER `free`). The webhook calls the paid helper; the catalog (subscription page) calls `getSubscriptionTariff` for the full catalog.

Concretely (final shape per §0c-3):
```ts
export type PaidSubscriptionTariff = SubscriptionTariff & {
  tier: 'mid' | 'pro'
}

export function getSubscriptionTariff(tier: string): SubscriptionTariff | null {
  if (tier === 'free' || tier === 'mid' || tier === 'pro') {
    return SAAS_SUBSCRIPTION_TARIFFS[tier]
  }
  return null
}

export function getPaidSubscriptionTariff(
  tier: string,
): PaidSubscriptionTariff | null {
  if (tier === 'mid' || tier === 'pro') {
    return SAAS_SUBSCRIPTION_TARIFFS[tier] as PaidSubscriptionTariff
  }
  return null
}
```

`app/api/payments/webhooks/cloudpayments/pay/route.ts:224` migrates from `getSubscriptionTariff(...)` to `getPaidSubscriptionTariff(...)`. TS guards against accidental free-tariff use. Added to §2 EXTEND list.

### Closure §0b-4 — WARN #4 (migration runner doesn't support per-migration replay)

Dropped the "idempotency via runner re-run" test approach. Instead, the new `tests/integration/migrations/migration-0105-backfill.test.ts` runs the mig SQL TWICE via raw `pool.query(rawSql)` and asserts:
1. First run: inserts N rows for N teachers without subscriptions.
2. Second run: 0 additional rows inserted (idempotent — `ON CONFLICT DO NOTHING`).
3. Selection rules: a purged teacher does NOT get a row; a disabled teacher DOES; a non-teacher (student-only) does NOT.

The test reads the migration file from disk by EXACT filename (§0d-3 closure): `readFileSync(path.resolve(REPO_ROOT, 'migrations/0105_teacher_subscriptions_free_backfill.sql'), 'utf8')`. NO glob expansion — filename is locked by the plan. This is a NEW pattern in `tests/integration/migrations/` (round-3 §0c-2 confirmed no existing precedent).

### Closure §0b-5 — INFO #5 (recoverability OK)

Partial-register-after-fatal-INSERT users can self-recover via `/api/auth/reset-request` → password reset flow. State is unpleasant but not stuck. Documented in §5 Rollback path.

### Closure §0b-6 — INFO #6 (/teacher/packages + /teacher/subscription scope confirmed)

`/teacher/packages` client has clean `noCreatesAtAll` / `atCap` branches — `writeCap=0→1` transition needs no client change. `/teacher/subscription/client.tsx` needs the new "no button" mode (current code only knows paid-tier cards with «Подписаться» button). Test pin update in §0a-7 already accounts for this.

## 0c. Round-3 findings closures (round-4 prep)

### Closure §0c-1 — BLOCKER #1 (admin-grant test missing from §4)

The §0b-1 admin-grant writer-path closure added the code change but didn't explicitly pin a test. Existing `tests/integration/admin/accounts-mutations.test.ts:192-210` only asserts `account_roles`; no row in `teacher_subscriptions` is asserted.

Added explicit test scope to §4: **NEW** `tests/integration/admin/admin-grant-teacher-free-subscription-row.test.ts` — pins admin route POST → teacher role granted AND `teacher_subscriptions{plan_slug='free', state='active'}` row inserted (using admin session via existing test fixture). Negative: granting student/admin role → NO `teacher_subscriptions` row.

### Closure §0c-2 — WARN #2 (cited precedent wrong)

`tests/integration/migrations/accounts-learner-telegram-checks.test.ts` does NOT replay raw SQL — it just exercises the post-mig schema. There's NO existing per-migration replay precedent. The plan no longer cites this file as precedent. The new test file `tests/integration/migrations/migration-0105-backfill.test.ts` is a NEW pattern; documented as such inline.

### Closure §0c-3 — WARN #3 (getPaidSubscriptionTariff signature inconsistency)

The §0b-3 example used `SubscriptionTariff | null` as return type which loses the compile-time guard. Corrected: introduce a new `PaidSubscriptionTariff` type that's a discriminated `SubscriptionTariff` with `tier: 'mid' | 'pro'`. Updated example:

```ts
export type PaidSubscriptionTariff = SubscriptionTariff & {
  tier: 'mid' | 'pro'
}

export function getPaidSubscriptionTariff(
  tier: string,
): PaidSubscriptionTariff | null {
  if (tier === 'mid' || tier === 'pro') {
    return SAAS_SUBSCRIPTION_TARIFFS[tier] as PaidSubscriptionTariff
  }
  return null
}
```

Webhook call-site can now rely on TS to refuse a 'free' return path. §0b-3 wording updated to match.

### Closure §0c-4 — INFO #4 (grantAccountRole has no audit entry)

Confirmed — no existing audit-event for role grants. The plan no longer implies audit coverage. Adding audit events to the role-grant path is OUT OF SCOPE for this PR (audit gap is pre-existing; tracked as a separate follow-up).

### Closure §0c-5 — INFO #5 (no other risky call-sites)

Confirmed — only the webhook is an untrusted-string path. `/api/teacher/subscribe` is hard-gated to `mid | pro`. No additional migration needed.

### Closure §0c-6 — INFO #6 (anti-spoof confirmed)

Admin grant path uses `id` from `params`. Plan unchanged.

## 0d. Round-5 findings closures + Existing surface inventory

### Closure §0d-1 — BLOCKER (Existing surface inventory section missing per company rule)

Per `~/.claude/COMPANY.md §151-159`, every plan-doc introducing new helpers/files needs a survey block with grep commands + match disposition. This section satisfies that rule:

**Survey 1**: `grep -rn "SAAS_SUBSCRIPTION_TARIFFS\|getSubscriptionTariff" lib/ app/ tests/` (excluding the plan-doc itself):
- `lib/billing/teacher-subscription.ts` — definition + helper. EXTEND per §1 item 1.
- `app/api/payments/webhooks/cloudpayments/pay/route.ts:224` — passes untrusted slug. EXTEND per §0b-3 (switch to `getPaidSubscriptionTariff`).
- `app/api/teacher/subscribe/route.ts:65-77` — already hard-gated to `mid|pro` before lookup. NO CHANGE.
- `app/teacher/subscription/page.tsx:43-71` — hardcoded `['mid','pro']` filter. EXTEND per §1 item 2.
- `app/teacher/subscription/client.tsx:8-15,21-41,266-335` — renders cards. EXTEND per §1 item 2.
- `tests/billing/teacher-subscription.test.ts:18-75` — unit pin. UPDATE per §1 item 6.
- `tests/teacher-cabinet-polish/subscription-ui-pick-tier.test.tsx:6-10,43-48` — UI pin. UPDATE per §1 item 6.

**Survey 2**: `grep -rn "resolveTeacherWriteCaps\|TIER_WRITE_CAPS" lib/ app/ tests/`:
- `lib/billing/teacher-subscription.ts:369-414` — definition. NO CHANGE (logic stays; new free-row INSERTs make `writeCap=1` reach callers).
- `app/teacher/tariffs/page.tsx`, `app/teacher/packages/page.tsx` — SSR consumers. NO CHANGE (already correctly render based on `writeCap`).
- `app/teacher/packages/client.tsx:47-49` — `noCreatesAtAll` branch. NO CHANGE (writeCap=1 unblocks form).
- `app/teacher/tariffs/tariff-editor.tsx:39-40` — same shape. NO CHANGE.
- `app/api/teacher/{tariffs,packages,packages/[id]}/route.ts` — server gates. NO CHANGE.
- `tests/integration/saas-pivot/free-tier-write-cap.test.ts:172` — case-7 pin. UPDATE per §1 item 6 (docstring only).

**Survey 3**: `grep -rn "grantAccountRole.*teacher\|grantAccountRole.*'teacher'" app/`:
- `app/api/auth/register/route.ts:260` — self-register writer-path. EXTEND per §1 item 3.
- `app/api/admin/accounts/[id]/role/route.ts:95` — admin writer-path. EXTEND per §1 item 3 + §0b-1.
- No third writer-path (`grep` returned 2 matches; confirmed by round-3 §0c-5 + round-4 INFO #5).

**Survey 4** (FULL enumeration per round-6+7 BLOCKER #1 closure): `grep -rn "teacher_subscriptions" lib/ app/ migrations/` returned:
- `lib/billing/teacher-subscription.ts` (multiple lines) — owns CRUD on the table. EXTEND per §1.
- `lib/payments/teacher-derivation.ts:100,113` — `isOperatorManagedTeacher` reads `plan_slug='operator-managed'`. NO CHANGE (orthogonal to the free unlock).
- `lib/billing/packages/catalog.ts:64,90,153` — buyer-side learner catalog JOINs `teacher_subscriptions`. NO CHANGE (the new free-row INSERT does not alter join semantics for active paid teachers).
- `lib/onboarding/teacher-plan-limit.ts:42` — reads sub for cap-warning UI. NO CHANGE (a backfilled free row will surface the correct «1 пакет, 1 тариф» limit; that's the desired fix outcome).
- `app/api/admin/teachers/[id]/plan/route.ts:124` — admin plan-edit endpoint. NO CHANGE (UPDATEs existing rows; not a writer for new accounts).
- `app/admin/(gated)/teachers/[id]/page.tsx:60` — admin teacher detail JOIN. NO CHANGE.
- `app/admin/(gated)/teachers/page.tsx:33,82` — admin teachers list JOIN. NO CHANGE.
- `app/teacher/profile/page.tsx:36,78` — reads active sub for profile display. NO CHANGE (rendering benefits from backfilled row).
- `app/t/[slug]/pay/page.tsx:21,61` — buyer-side gate JOINing teacher_subscriptions. NO CHANGE (the gate filters `plan_slug != 'free'` already; a free-row teacher correctly fails the buyer-side gate, which is the existing architectural escape valve — free teachers can't have their packages bought through the platform).
- `migrations/0073_teacher_subscription_plans.sql:13` — defines plans catalog incl `'free'` slug.
- `migrations/0074_teacher_subscriptions.sql` (multiple lines) — table definition + FK on `plan_slug → teacher_subscription_plans.slug` (NOT a CHECK; round-6 WARN #4 correction). The `'free'` slug exists in `teacher_subscription_plans` (mig 0073), so FK accepts the backfill.
- `migrations/0083_bootstrap_teacher_account.sql:148` — bootstrap teacher gets a free row historically (INSERT-pattern precedent).
- `migrations/0098_teacher_subscriptions_paid_periods.sql` — period columns (orthogonal).
- All other matches are tests. NO NEW DDL needed; backfill mig (0105) is INSERT-only.

**Survey 3** correction (round-7 BLOCKER #1): the literal `grep -rn "grantAccountRole.*teacher" app/` returns only the self-register match at `app/api/auth/register/route.ts:260`. The admin-grant writer-path lives at `app/api/admin/accounts/[id]/role/route.ts:102` and calls `grantAccountRole(accountId, role, actorId)` where `role` is dynamic from the body. Surfaced via a wider grep (`grep -rn "grantAccountRole" app/`): both writer-paths confirmed; no third writer.

### Closure §0d-2 — WARN #2 (§1 scope type drift)

§1 scope item 1 wording updated to match §0c-3 example. `getPaidSubscriptionTariff` returns `PaidSubscriptionTariff | null` (NOT `SubscriptionTariff | null`). The discriminated `PaidSubscriptionTariff` type is the compile-time guard. Updated in §1 below.

### Closure §0d-3 — WARN #3 (mig test glob not real)

§0b-4 updated to use concrete filename `migrations/0105_teacher_subscriptions_free_backfill.sql` directly via `readFileSync`. No glob expansion needed (the filename is locked by the plan).

### Closure §0d-4 — WARN #4 (admin account can't navigate to /teacher/*)

The `app/teacher/layout.tsx:54-59` redirects `admin` role to `/admin/slots`. `grantAccountRole` enforces `admin`/`teacher` mutually exclusive. Manual E2E persona in §4 + risk #3 updated:
- Manual E2E persona: a VERIFIED TEACHER account (NOT admin AND NOT unverified — `app/teacher/layout.tsx:47-50` redirects unverified teachers to `/cabinet`). The owner can: (a) register a new teacher via `/register` AND click the email-verify link in the dispatched email; OR (b) use an existing verified-teacher dev fixture; OR (c) test on the owner's own `admin@levelchannel.ru` account which is a verified teacher post-bootstrap mig 0083 (see §0d-4).
- Risk #3 obsolete: `admin@levelchannel.ru` per `migrations/0083_bootstrap_teacher_account.sql` is actually a row-MOVE that synthesises the prod admin AS-IF separate from the teacher account. The original prod email moves to the NEW (pure-teacher) account; admin gets a synthetic email. So the user's `admin@levelchannel.ru` in the screenshots was actually rendering `/teacher/subscription` BECAUSE the bootstrap re-pointed teacher data — they're NOT admin-role; they're a teacher logged in WITH the original prod admin email, which is now a teacher email. The fix for them: backfill mig 0105 inserts the missing `teacher_subscriptions` row for their account.

## 1. Scope

### In scope (single PR `epic/free-tier-saas-card-and-subscription-row`)

1. **`SAAS_SUBSCRIPTION_TARIFFS` extended + type split** (§0a-1 + §0c-3 + §0d-2 closures):
   - Keep `TeacherSubscriptionTier = 'mid' | 'pro'` (paid-only contract for `createOrRenewTeacherSubscription` + `/api/teacher/subscribe`).
   - Add `SubscriptionCatalogTier = 'free' | 'mid' | 'pro'` (display/catalog scope).
   - `SubscriptionTariff.tier` widens to `SubscriptionCatalogTier` so the catalog entry can carry the `'free'` discriminator.
   - `SAAS_SUBSCRIPTION_TARIFFS: Record<SubscriptionCatalogTier, SubscriptionTariff>` with new `free` entry: `tier: 'free'`, `titleRu: 'Стартовый'`, `amountKopecks: 0`, `learnerLimit: 1`, description + features (1 пакет, 1 тариф, расписание, etc).
   - `getSubscriptionTariff('free')` returns the entry; legacy `'mid' | 'pro'` callers unchanged.
   - NEW discriminated type `PaidSubscriptionTariff = SubscriptionTariff & { tier: 'mid' | 'pro' }`.
   - NEW narrowing helper `getPaidSubscriptionTariff(tier: string): PaidSubscriptionTariff | null` (returns ONLY mid/pro; compile-time guard against accidental 'free' use). Webhook consumes this.
2. **`/teacher/subscription` renders 3 cards in pick-tier mode** (§0a-2 + §0a-3 closures) — TWO files:
   - `app/teacher/subscription/page.tsx`: extend the hardcoded `['mid', 'pro']` to `['free', 'mid', 'pro']` ONLY when teacher has no active paid sub. When teacher IS on Mid/Pro, the existing single-card active-paid path is unchanged (Стартовый NOT shown).
   - `app/teacher/subscription/client.tsx`: extend pick-tier grid render to handle the free card — shows «Доступен по умолчанию» chip in place of «Подписаться» button. No state transitions; the card is purely informational.
3. **Free-row INSERT at BOTH writer-paths to `teacher` role** (§0a-4 + §0b-1 closures):
   - **Self-register** (`app/api/auth/register/route.ts:260`): after `grantAccountRole(account.id, 'teacher', null)`, INSERT `teacher_subscriptions{plan_slug='free', state='active'}`.
   - **Admin grant** (`app/api/admin/accounts/[id]/role/route.ts:95`): after `grantAccountRole(accountId, 'teacher', actorId)`, same INSERT.
   - Both use `ON CONFLICT (account_id) DO NOTHING` (idempotency for re-runs and dual-writer races).
   - **Failure is FATAL** (mirrors `grantAccountRole` precedent): on non-conflict error throw → 500. Don't silently return `ok: true` with a teacher who'd hit `EMPTY_CAPS`.
   - Uses the server-bound account id (anti-spoof; never body-supplied).
   - **Paid-only narrowing helper** (§0b-3 + §0c-3): introduce `getPaidSubscriptionTariff(tier: string): PaidSubscriptionTariff | null` where `PaidSubscriptionTariff = SubscriptionTariff & { tier: 'mid' | 'pro' }`. Returns ONLY `mid` / `pro` (compile-time guard). Webhook at `app/api/payments/webhooks/cloudpayments/pay/route.ts:224` migrates to the paid helper so a free-plan payment can never write a 0₽ paid row.
4. **Backfill migration** — `migrations/0105_teacher_subscriptions_free_backfill.sql` (§0a-5 closure):
   - For every account WITH the `teacher` role + `purged_at IS NULL` + NO `teacher_subscriptions` row, INSERT `{plan_slug='free', state='active'}`. NO `disabled_at` filter (re-enabled teachers must keep the row).
   - Idempotent (`ON CONFLICT (account_id) DO NOTHING`).
   - Pure additive INSERT — no DROP, no UPDATE on existing rows.
5. **Owner add-on: `/teacher/packages`** — already correctly handles `writeCap` via `noCreatesAtAll = !isUnlimited && writeCap === 0` (`app/teacher/packages/client.tsx:48-49`). Same root cause (`resolveTeacherWriteCaps` returns 0 for no-row). Same fix covers it: after the register-time INSERT + backfill, `writeCap=1` reaches the client and the form unlocks. NO additional client code change.
6. **Update existing tests** (§0a-7 closure):
   - `tests/billing/teacher-subscription.test.ts:69-75` — `getSubscriptionTariff('free')` flip from `null` expectation → assert new Стартовый entry shape.
   - `tests/teacher-cabinet-polish/subscription-ui-pick-tier.test.tsx:6-10, 43-48` — flip "exactly 2 cards" + "no Стартовый" → "exactly 3 cards" + "Стартовый with «Доступен по умолчанию» chip".
   - `tests/integration/saas-pivot/free-tier-write-cap.test.ts:172` — case-7 stays; docstring renamed to "legacy no-row defensive state".
7. **New tests**:
   - `tests/integration/auth/register-free-subscription-row.test.ts` — pins register-time INSERT shape (teacher → row inserted with `plan_slug='free', state='active'`; student → NO row).
   - `tests/integration/admin/admin-grant-teacher-free-subscription-row.test.ts` (§0c-1) — pins admin-grant writer-path INSERTs `teacher_subscriptions{plan_slug='free', state='active'}` when granting teacher role; negative pin: granting student/admin role does NOT insert.
   - `tests/integration/migrations/migration-0105-backfill.test.ts` — pins migration idempotency + correct row selection (purged accounts excluded; disabled accounts INCLUDED). New pattern (no precedent in repo per §0c-2).

### Out of scope

- Any «Текущий тариф» chip on ANY card (§0a-3 locked semantics: free-teachers see «Доступен по умолчанию» chip on Стартовый instead; active-paid teachers see single-card view as today). Adding a per-card current-marker is parent-plan scope.
- Admin role's separate caps — admin role is orthogonal; only the `teacher` role triggers the free-row insert.
- `expireOverdueSubscriptions` script — orthogonal scope (transition mid/pro → free on period_end; tracked in plan §6).
- Refunds / credit on the «Стартовый» card — N/A, it's free.

## 2. File-level inventory

### NEW
- `migrations/0105_teacher_subscriptions_free_backfill.sql` — backfill mig (§0a-5).
- `tests/integration/auth/register-free-subscription-row.test.ts` — pins register-time INSERT shape.
- `tests/integration/admin/admin-grant-teacher-free-subscription-row.test.ts` (§0c-1) — pins admin-grant INSERT.
- `tests/integration/migrations/migration-0105-backfill.test.ts` — pins backfill idempotency + selection rules.

### EXTEND
- `lib/billing/teacher-subscription.ts` — add `SubscriptionCatalogTier` (§0a-1); add `free` entry to `SAAS_SUBSCRIPTION_TARIFFS`; widen `getSubscriptionTariff` to accept `'free'`; NEW `getPaidSubscriptionTariff` paid-only helper (§0b-3).
- `app/teacher/subscription/page.tsx` — extend pick-tier list to `['free', 'mid', 'pro']` (§0a-3).
- `app/teacher/subscription/client.tsx` — render free card with «Доступен по умолчанию» chip in place of «Подписаться» button.
- `app/api/auth/register/route.ts` — register-time free-row INSERT (§0a-4 fatal-on-error).
- `app/api/admin/accounts/[id]/role/route.ts` — admin-grant free-row INSERT (§0b-1).
- `app/api/payments/webhooks/cloudpayments/pay/route.ts` — switch from `getSubscriptionTariff` → `getPaidSubscriptionTariff` (§0b-3).
- `tests/billing/teacher-subscription.test.ts` — flip `getSubscriptionTariff('free')` expectation + assert new entry shape; add `getPaidSubscriptionTariff('free') === null` pin.
- `tests/teacher-cabinet-polish/subscription-ui-pick-tier.test.tsx` — flip "2 cards" → "3 cards" pin (§0a-7).
- `tests/integration/saas-pivot/free-tier-write-cap.test.ts` — case-7 docstring rename.

## 3. Migration safety

- `0105_teacher_subscriptions_free_backfill.sql` (§0a-5 + §0b-2):
  - Pure additive INSERTs guarded by `ON CONFLICT (account_id) DO NOTHING`.
  - Reads from `account_roles WHERE role='teacher'`, joins on `accounts WHERE purged_at IS NULL` (NO `disabled_at` filter — re-enabled teachers must keep row).
  - No DROP, no UPDATE on existing rows.
  - Safe to re-run (idempotent) — pinned by `tests/integration/migrations/migration-0105-backfill.test.ts` running the raw SQL twice (§0b-4).
  - Pre-mig schema gate: `teacher_subscriptions.plan_slug` is an FK to `teacher_subscription_plans.slug` (mig 0074), where the `free` slug already exists (mig 0073). Round-6 WARN #4: this is an FK, NOT a CHECK; conclusion still holds — `'free'` rows are valid.

## 4. Test plan

- Unit: `SAAS_SUBSCRIPTION_TARIFFS.free` exists, has correct titleRu / amountKopecks=0 / learnerLimit=1. `getPaidSubscriptionTariff('free') === null`, `getPaidSubscriptionTariff('mid')` returns paid entry.
- Integration:
  - Register a new teacher → assert a `teacher_subscriptions` row with `plan_slug='free', state='active'` was inserted.
  - Register a new STUDENT → assert NO `teacher_subscriptions` row.
  - **Admin grants `teacher` role to an existing learner** (§0c-1) → assert `teacher_subscriptions{plan_slug='free', state='active'}` row inserted; negative: granting `admin` or `student` does NOT insert.
  - Existing free-tier-write-cap matrix still green.
  - Migration 0105 applies cleanly + is idempotent on re-run (raw-SQL replay test).
- E2E (not part of this PR, manual; §0d-4 + round-6 WARN #3 closures): owner logs in with a VERIFIED TEACHER account (NOT admin — `app/teacher/layout.tsx:50,54-59` redirects unverified teachers to `/cabinet` AND admin to `/admin/slots`; `lib/auth/accounts.ts:280-317` enforces admin/teacher mutually exclusive; `evals/PRODUCT_FLOWS.md:196` confirms verified-teacher persona for this flow). Owner's `admin@levelchannel.ru` in the screenshots is actually a VERIFIED teacher account post-bootstrap (mig 0083 row-MOVE re-pointed the prod admin email to the NEW pure-teacher account; the synthetic email is on the admin role). Navigate to `/teacher/subscription` → sees 3 cards; `/teacher/tariffs` → can create 1 tariff; `/teacher/packages` → can create 1 package.

## 5. Rollback path

- Code revert: standard `git revert` of the PR's squash commit. No DB-side rollback needed — the backfill mig's INSERTs are idempotent forward-only.
- DB: leaving the backfilled `teacher_subscriptions` rows in place is harmless (they enable the existing free-tier caps semantics). No down-migration.

## 6. Paranoia + PR trailer

Standalone one-PR epic per `~/.claude/skills/codex-paranoia/SKILL.md §1.5`:
- `/codex-paranoia plan` on this doc → SIGN-OFF before code lands.
- `/codex-paranoia wave` on the commit range → SIGN-OFF before PR opens.
- PR trailer: `Codex-Paranoia: SIGN-OFF round N/3` (one-PR epic).

## 7. Acceptance criteria

- `npm run build` green.
- Existing test suite green (197 unit + ~30 integration touching free-tier paths).
- New tests pass.
- Owner-visible: 3 cards on `/teacher/subscription`; `/teacher/tariffs` allows creating 1 tariff for any registered teacher.
- Codex paranoia plan + wave SIGN-OFF.

## 8. Risks + escalations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Register-time / admin-grant INSERT fails (DB hiccup). | FATAL on non-conflict error (§0a-4 + §0b-1) → 500. Half-provisioned account is self-recoverable via password reset (§0b-5). Backfill mig 0105 heals any account that slipped through on next deploy. |
| 2 | A test fixture that explicitly tests "no row → EMPTY_CAPS" breaks because register-time INSERT now populates the row. | The fixture uses `makeTeacher({planSlug: null})` which bypasses the register route (direct DB insert via `accounts` table). Test case 7 stays valid as a defensive pin. |
| 3 | The user's screenshots use `admin@levelchannel.ru` — but `admin` and `teacher` roles are mutually exclusive (`lib/auth/accounts.ts:280-317`). | Per §0d-4: mig 0083 row-MOVE re-points the prod admin email onto the NEW pure-teacher account. The screenshot's `admin@levelchannel.ru` is rendering the teacher cabinet because that email lives on the TEACHER account post-bootstrap. Backfill mig 0105 will INSERT the missing `teacher_subscriptions{plan_slug='free'}` row for that account. |
| 4 | Free-card render in pick-tier mode could be misleading for a teacher who's actually on Mid/Pro. | §0a-3 locked semantics: when teacher has an active paid sub, the page renders the single-card active-paid view (Стартовый NOT shown). Pick-tier mode (3 cards including Стартовый with «Доступен по умолчанию» chip) renders ONLY when no active paid sub. No per-card «Текущий тариф» chip is added in this PR. |
| 5 | Free-tier unlock plan §1.E row 7 didn't say WHO calls `INSERT free-row` on register — could conflict with future plans. | This PR makes the convention explicit + documents it inline in register route comment. Future PRs follow the same shape. |
