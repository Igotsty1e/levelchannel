# BCS-DEF-4-PUSH — PWA push channel for learner lesson-start reminders

**Status:** SHIPPED 2026-06-06 (one-PR epic). Plan-paranoia: 9 substantive Codex rounds (8/3 → 2/2) + round-10 self-review fallback after Codex quota exhausted at 14:02 +07 (user-authorized per `/codex-paranoia` skill §7; Codex paranoia debt recorded for post-quota plan + wave rounds — `auto-memory/2026-06-06_push_pwa_codex_debt.md`).
**Wave name:** `bcs-def-4-push-pwa-reminders` (single-PR epic).
**Author:** Claude (autonomous).
**Channel:** Browser Web Push (PWA, via `web-push` Node lib + VAPID).

This document REPLACES the 2026-05-18 DRAFT after plan-paranoia round-1 surfaced 8 BLOCKERs + 3 WARNs (see PR #543 + auto-memory `2026-06-06_push_pwa_plan_blocked.md`). Each finding is closed inline below. Companion plan `bcs-def-5-push-teacher-pwa-reminders.md` (teacher) DEFERRED — depends on `teacher_reminder_dispatches` (BCS-DEF-5 main) which is not shipped.

---

## 1. Goal

Add Web Push as a delivery channel for the learner-reminder scheduler. When a learner has opted-in (i.e. registered a Push subscription from their browser) AND `LEARNER_REMINDERS_PUSH_ENABLED=1` AND VAPID env present, the scheduler dispatches each due reminder via the push channel in addition to email (and telegram if enabled). Soft-skip when subscription is absent.

**Hard requirements:**
- Idempotent per `(slot_id, channel='push')` — one row per slot via existing `lrd_slot_channel_unique` index (mig 0064).
- Operator master switch `LEARNER_REMINDERS_PUSH_ENABLED` (default `0`).
- Soft-skip on missing subscription: row written `status='skipped'`, `skipped_reason='no_push_subscription'`. Other channels unaffected.
- Auto-unsubscribe on Web Push 410 Gone / 404 Not Found: subscription row flipped to `unsubscribed_at=now()`. Future ticks skip.
- Multi-device per learner: each device = separate active subscription row; scheduler fans out to ALL active subs per (slot, channel='push'). **Hard cap** (round-8 BLOCKER 1 closure): `MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_ACCOUNT = 10` enforced in subscribe route. On 11th subscribe attempt: oldest-active row flipped to `unsubscribed_at=now()` (FIFO eviction) + audit event `push.subscription.unsubscribed.auto` (reason='cap_reached'). Bounds the fanout multiplier so rate-limit invariant holds (10 × budget unit, not unbounded).
- Cross-account endpoint reassignment: when subscribing with an endpoint URL that already exists for a DIFFERENT account, the existing row is flipped to `unsubscribed_at=now()` + audit event before the new INSERT (round-1 BLOCKER 4 closure).
- iOS Safari 16.4+ best-effort; older iOS / non-PWA modes return `Notification.permission === 'denied'` early.

## 2. Existing surface inventory (Survey-before-plan)

Verbs: `dispatch reminder`, `subscribe browser`, `serve manifest`.

```bash
rg -nl --type ts -t mjs 'LEARNER_REMINDERS|learner_reminder_dispatches|TELEGRAM_BOT_TOKEN' lib scripts app
```

### Reminder scheduler (shipped)
- `migrations/0064_learner_reminder_dispatches.sql` — table with `channel text not null check (channel in ('email', 'telegram'))` + `lrd_slot_channel_unique`. **Disposition: extend** — new mig 0108 widens CHECK to add `'push'` + adds `'no_push_subscription'` + `'push_helper_not_shipped'` to `skipped_reason` CHECK. (Round-6 WARN 3: unified taxonomy uses generic `'send_failed'` for the send-failure case; `'no_push_subscription'` covers zero-subs steady-state.)
- `scripts/learner-reminder-dispatch.mjs` (731 lines) — main scheduler. **Disposition: extend** — add `await runPushBranch(client, slot)` mirroring the existing telegram branch (`telegramHelperResolved` lazy-import pattern).
- `scripts/lib/operator-settings.mjs` — .mjs mirror of `lib/admin/operator-settings.ts`. **Disposition: extend** — both files gain `LEARNER_REMINDERS_PUSH_ENABLED` entry.
- `lib/admin/operator-settings.ts:307-325` — operator setting schema with existing `LEARNER_REMINDERS_*` entries. **Disposition: extend**.

### Operator dashboard (shipped)
- `app/admin/(gated)/settings/alerts/page.tsx:192-200` — learner-reminders scheduler card (master switch + window + rate-limit + recent dispatches summary). **Disposition: extend** — add Push row beneath email/telegram. NO new `/admin/settings/reminders` page (round-1 BLOCKER 2 closure).

### Cabinet learner UI (shipped)
- `app/cabinet/profile/page.tsx:7` — imports `LearnerTelegramBinding` from `components/cabinet/learner-telegram-binding`. **Disposition: extend** — add `LearnerPushSubscription` section beneath telegram binding.

### Canonical-origin contract (shipped)
- `lib/api/origin.ts::resolveCanonicalOrigin` — env-first with prod fail-closed (PR #539). **Disposition: USE** for SW scope + deep links in push payload (round-1 BLOCKER 5 closure).
- `lib/payments/config.ts::paymentConfig.siteUrl` — module-load capture for email/template surfaces. **Disposition: USE** in `.mjs` template via `process.env.NEXT_PUBLIC_SITE_URL` (round-1 BLOCKER 5 closure).

### Env file rendering (shipped)
- `scripts/activate-prod-ops.sh` — renders a single env file consumed by both Next.js (PM2/systemd) AND `levelchannel-learner-reminder-dispatch.service`. **Disposition: extend** — add `PUSH_VAPID_PUBLIC_KEY` + `PUSH_VAPID_PRIVATE_KEY` + `PUSH_VAPID_SUBJECT` + `LEARNER_REMINDERS_PUSH_ENABLED` to the single env render (round-1 BLOCKER 1 closure). No separate `push.env`.

### Migration-pending degrade pattern (shipped)
- `lib/db/errors.ts::isUndefinedTableError` / `isUndefinedColumnError` — used by admin reads to return `{ migrationPending: true }` on 42P01/42703 before the new mig has been applied (BCS-DEF-1-TG pattern). **Disposition: USE** in all new admin/cabinet reads (round-1 BLOCKER 7 closure).

### TS/MJS boundary
- `scripts/lib/learner-reminder-template.mjs` — .mjs template imported by dispatcher.
- `lib/email/templates/learner-lesson-reminder.ts` — .ts template imported by app code.
- Drift: in this codebase the email template is parallel-implemented (mjs + ts). **Disposition: same pattern** — `scripts/lib/learner-push-template.mjs` (dispatcher) + `scripts/lib/web-push.mjs` (web-push wrapper). App code (subscribe/unsubscribe routes) imports the same `.mjs` via Next.js Node-mode ESM (works in API routes; verified via PR #517 + #534 pattern). NO `lib/notifications/*.ts` parallel — single .mjs source of truth (round-1 BLOCKER 6 closure).

### Web Push semantics
- Web Push subscription = `{ endpoint, p256dh, auth }`. Endpoint is browser-generated URL containing an opaque token; same endpoint for the SAME browser-profile-application origin. If user logs out + new user logs in same browser AND new user subscribes → browser MAY return SAME endpoint (depending on SW state). Round-1 BLOCKER 4: handle this by `unsubscribed_at=now()` on the PRE-existing row before INSERTing the new account binding.

## 3. Design

### 3.1 Migration 0108 — channel + skipped_reason CHECK extension + auth_audit_events.event_type widening

(Round-2 INFO 6: unified taxonomy — keep generic `send_failed` for all channels; do NOT add `push_send_failed`.)
(Round-2 BLOCKER 2: add the 5 new audit event types to the CHECK here.)

```sql
-- BCS-DEF-4-PUSH (2026-06-06).
-- (a) Extend learner_reminder_dispatches.channel to include 'push'.
-- (b) Extend skipped_reason CHECK with push-specific skip values.
-- (c) Widen auth_audit_events.event_type for push.subscription.*.
--
-- No data rewrites; CHECK widening only.

alter table learner_reminder_dispatches
  drop constraint learner_reminder_dispatches_channel_check;
alter table learner_reminder_dispatches
  add constraint learner_reminder_dispatches_channel_check
  check (channel in ('email', 'telegram', 'push'));

alter table learner_reminder_dispatches
  drop constraint learner_reminder_dispatches_skipped_reason_check;
alter table learner_reminder_dispatches
  add constraint learner_reminder_dispatches_skipped_reason_check
  check (skipped_reason is null or skipped_reason in (
    'slot_no_longer_booked', 'email_missing', 'past_send_by',
    'send_failed',
    'no_telegram_binding', 'telegram_helper_not_shipped',
    'no_push_subscription', 'push_helper_not_shipped'
  ));

-- Widen auth_audit_events for the 5 push event types.
-- Full enumeration of pre-existing + new (mirroring T3 mig 0102 pattern).
alter table auth_audit_events
  drop constraint auth_audit_events_event_type_check;
alter table auth_audit_events
  add constraint auth_audit_events_event_type_check
  check (event_type in (
    -- pre-existing (verbatim from mig 0102:263-287)
    'auth.login.success', 'auth.login.failed',
    'auth.register.created', 'auth.reset.requested', 'auth.reset.confirmed',
    'auth.verify.success', 'auth.session.revoked',
    'auth.teacher.self_registered',
    'auth.invite.created', 'auth.invite.revoked', 'auth.invite.redeemed',
    'auth.teacher.saas_offer_accepted', 'auth.teacher.saas_offer_backfilled',
    'auth.onboarding.reset', 'auth.billing.method_changed',
    'auth.tariff_access.granted', 'auth.tariff_access.revoked',
    'auth.package_access.granted', 'auth.package_access.revoked',
    -- BCS-DEF-4-PUSH additions:
    'push.subscription.created',
    'push.subscription.reassigned',
    'push.subscription.revived',
    'push.subscription.unsubscribed.user',
    'push.subscription.unsubscribed.auto'
  ));
```

### 3.2 Migration 0109 — `learner_push_subscriptions`

```sql
-- BCS-DEF-4-PUSH (2026-06-06) — per-learner per-device Web Push subscriptions.
-- One row per (active endpoint). Multi-device per learner via multiple
-- active rows. Cross-account endpoint reassignment: when a new account
-- subscribes with an endpoint already bound to a DIFFERENT account, the
-- existing row is flipped to unsubscribed_at=now() FIRST, then INSERT
-- proceeds (closes the BLOCKER 4 leak class).
--
-- Plan: docs/plans/bcs-def-4-push-pwa-reminders.md

create table if not exists learner_push_subscriptions (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete restrict,
  endpoint text not null,
  p256dh_b64url text not null,
  auth_b64url text not null,
  user_agent text null,
  unsubscribed_at timestamptz null,
  last_used_at timestamptz null,
  last_status_code integer null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Active endpoint is globally unique (Web Push endpoint is browser-bound
-- URL; reuse across accounts means stale account binding — handle via
-- reassign-then-insert at app layer).
create unique index if not exists learner_push_subs_endpoint_active_unique
  on learner_push_subscriptions (endpoint)
  where unsubscribed_at is null;

-- Hot path: scheduler iterates active subs per account.
create index if not exists learner_push_subs_account_active_idx
  on learner_push_subscriptions (account_id)
  where unsubscribed_at is null;

create index if not exists learner_push_subs_created_at_idx
  on learner_push_subscriptions (created_at desc);

comment on table learner_push_subscriptions is
  'BCS-DEF-4-PUSH (2026-06-06): per-(account, browser-device) Web Push '
  'subscriptions. Active endpoint is globally UNIQUE — cross-account '
  'reassignment handled by flipping the existing row to unsubscribed_at '
  'before insert (anti-leak). Auto-unsubscribed by scheduler on Web Push '
  '410 Gone / 404 Not Found.';
```

### 3.3 VAPID env contract

Add to the single env file rendered by `scripts/activate-prod-ops.sh`:
```
LEARNER_REMINDERS_PUSH_ENABLED=0
PUSH_VAPID_PUBLIC_KEY=
PUSH_VAPID_PRIVATE_KEY=
PUSH_VAPID_SUBJECT=mailto:ops@levelchannel.ru
```
Soft-skip semantics (round-7 BLOCKER 1 unification — single contract):
- `LEARNER_REMINDERS_PUSH_ENABLED=0` (default) → scheduler skips push branch entirely (pre-flight gate per §3.7).
- `LEARNER_REMINDERS_PUSH_ENABLED=1` AND any VAPID env empty → scheduler ALSO skips push branch entirely via pre-flight gate per §3.7. **No row written**, no slot burned. Operator can fix env on the next minute. The CHECK constraint still ALLOWS `'push_helper_not_shipped'` for forward-compat / manual operator insertion, but the scheduler never emits it at runtime.

Operator generates VAPID keypair once with `npx web-push generate-vapid-keys` (documented in `OPERATIONS.md` operator notes section in this PR's doc sweep).

### 3.4 Service worker + manifest

- **`public/manifest.webmanifest`**: name "LevelChannel", short_name "LevelChannel", start_url `/cabinet`, display `standalone`, theme_color `#0a0c10`, background_color `#0a0c10`, icons 192/512 PNGs (use existing `favicon.svg` rasterized — operator note to generate via separate `scripts/generate-pwa-icons.mjs` ONE-OFF; PR ships PNGs in `public/icons/`).
- **`public/sw.js`** (round-5 BLOCKER 3 — explicit shape: CLASSIC service worker, NOT module): registered as `navigator.serviceWorker.register('/sw.js', { scope: '/' })` (no `type: 'module'`). The SW uses `importScripts('/sw-lib/resolve-open-url.js')` at the top to pull in the same-origin URL resolver helper. Both files are static assets in `public/`. No bundler / build step. Listens to `push` events → `event.waitUntil(self.registration.showNotification(title, opts))`. Listens to `notificationclick` → calls `resolveOpenUrl(payload.url, self.location.origin)` (same-origin resolver from sw-lib) → `clients.openWindow(resolved)`. Notification payload: `{ title, body, url }` (no zoom_url; round-1 WARN 10 closure).
- **`public/sw-lib/resolve-open-url.js`** (round-8 BLOCKER 4 closure — testable from jsdom): a plain script that assigns `self.resolveOpenUrl = function(url, ownOrigin) {...}` so the SW picks it up via `importScripts(...)`. Tests import via dynamic `import()` of the file as ESM (Node's ESM can load a script that mutates a sandboxed `self` and read the binding afterwards). NO `export` keyword in `sw.js` itself.
- **`app/layout.tsx`**: add `<link rel="manifest" href="/manifest.webmanifest" />` and `<meta name="theme-color" content="#0a0c10" />` to `<head>`. Register the SW from a new client island `<ServiceWorkerRegistration />` mounted in `app/layout.tsx`. Registration scope: `/` (root) — required for cabinet routes + OAuth callback paths. Locked: root layout, NOT cabinet layout (round-1 BLOCKER 8 closure).

### 3.5 Push templates (`scripts/lib/learner-push-template.mjs`)

```js
// Push notification payload for learner lesson-start reminders.
// Privacy-safe per round-1 WARN 10: no zoom URL, no lesson title.
//
// Output shape (sent as JSON in the encrypted Web Push payload):
//   { title: string, body: string, url: string }

export function renderLearnerPushPayload({
  windowMinutes,
  cabinetUrl,
}) {
  return {
    title: 'Скоро урок',
    body: `Через ${windowMinutes} мин начинается ваше занятие. Откройте кабинет, чтобы подключиться.`,
    url: cabinetUrl,
  }
}
```

`cabinetUrl` derived in dispatcher from `process.env.NEXT_PUBLIC_SITE_URL` (env-first, no hardcoded fallback; round-1 BLOCKER 5 closure).

### 3.6 Web-push wrapper (`scripts/lib/web-push.mjs`)

```js
// Thin wrapper around the web-push npm lib. Handles VAPID setup, encrypted
// payload encoding, and 410/404 detection for auto-unsubscribe.

import webpush from 'web-push'

let vapidConfigured = false

export function configureVapidIfNeeded(env = process.env) {
  if (vapidConfigured) return true
  const publicKey = env.PUSH_VAPID_PUBLIC_KEY?.trim() ?? ''
  const privateKey = env.PUSH_VAPID_PRIVATE_KEY?.trim() ?? ''
  const subject = env.PUSH_VAPID_SUBJECT?.trim() ?? ''
  if (!publicKey || !privateKey || !subject) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
  return true
}

export async function sendWebPush(subscription, payload, env = process.env) {
  if (!configureVapidIfNeeded(env)) {
    return { ok: false, reason: 'vapid_unconfigured' }
  }
  try {
    const res = await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh_b64url,
          auth: subscription.auth_b64url,
        },
      },
      JSON.stringify(payload),
      { TTL: 60 * 30 }, // 30-min TTL — past send-by point reminder is stale.
    )
    return { ok: true, statusCode: res.statusCode }
  } catch (err) {
    const sc = err?.statusCode ?? 0
    const isGone = sc === 410 || sc === 404
    return {
      ok: false,
      reason: isGone ? 'endpoint_gone' : 'send_failed',
      statusCode: sc,
      error: err?.body ?? String(err?.message ?? err),
    }
  }
}
```

### 3.7 Scheduler integration (`scripts/learner-reminder-dispatch.mjs`)

Mirror the telegram lazy-import pattern. **Pre-flight gate FIRST** (round-6 BLOCKER 2): before allocating any (slot, 'push') row, check:
- `LEARNER_REMINDERS_PUSH_ENABLED === 1` from `resolveOperatorSettingsForProbe('learner-reminders')`.
- VAPID env triple non-empty.
If EITHER missing → skip the push branch entirely. NO `learner_reminder_dispatches` row inserted for `channel='push'`. The (slot, 'push') idempotency slot stays open for the next tick once misconfig is resolved — does NOT permanently burn the reminder. Mirrors telegram pre-flight pattern at `scripts/learner-reminder-dispatch.mjs:325-334`.

**Rate-limit contract** (round-7 BLOCKER 2 closure): `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK` continues to count `(slot, channel)` rows, not provider sends. Pushing to N devices for one slot counts as **1 unit** against the budget — same semantics as a fanned-out email send to one recipient. Rationale: the rate-limit guards against operator-side mistake (e.g. forgot to bump for high-traffic tick), not against per-device cost. Multi-device fanout is bounded by the per-account subscription count (typically 1-3 devices); the absolute send count stays within an order-of-magnitude of the current contract. Tests pin: `RATE_LIMIT_PER_TICK=3`, 5 due slots each with 4 active subs → 3 rows written, 2 skipped past_send_by; total provider sends = 12 (3 × 4) — verifies the unit is row, not send.

**Inline push branch** (round-10 self-review BLOCKER 2 closure — simpler than factoring out): the push branch lives INLINE in `tick()` after the telegram branch, mirroring the existing email + telegram branches. `let sendBudget` from line 391 stays as-is; the push branch mutates it directly in the same lexical scope. No `runPushBranch(...)` helper, no `budgetRef` wrapper.

Per-slot push flow (round-10 self-review BLOCKER 1 closure — mirrors shipped CLAIM-then-gate-then-budget pattern at `scripts/learner-reminder-dispatch.mjs:419-460`, NOT pre-claim budget check):

1. **CLAIM FIRST**. Call `attemptInsertDispatchRow(pool, slot, 'push')` (INSERT ... ON CONFLICT (slot_id, channel) DO NOTHING RETURNING id). If 0 rows → another tick / branch won, return without touching budget.
2. **Send-time recheck** (round-9 BLOCKER 2 closure; matches `reFetchAndGate` at line 439). Re-fetch slot: `SELECT cancelled_at, learner_account_id, start_at FROM lesson_slots WHERE id=$1`. If cancelled OR `learner_account_id` changed OR `start_at < now() - past_send_by_minutes` window → finalize row `status='skipped', skipped_reason='slot_no_longer_booked'|'past_send_by'`; **DO NOT consume budget** (matches comment at line 437-438: "Skip-at-gate finalizations do not consume sendBudget"). Return.
3. **Budget check** (round-10 BLOCKER 1 — shipped pattern). If `budgetRef.remaining <= 0` → finalize row `status='skipped', skipped_reason='past_send_by'`, increment `stats.sends_overflowed_rate_limit`. Return. (This burns the slot, consistent with email branch at line 454-458.)
4. **Decrement budget**: `budgetRef.remaining -= 1`. The decrement is unconditional once we pass step 3, even if step 6 (fanout) emits zero provider sends. Rationale: 1 (slot, push) row consumes 1 budget unit, regardless of device count — rate-limit invariant per round-7 BLOCKER 2.
5. **SELECT all active subs** for `account_id`: `SELECT id, endpoint, p256dh_b64url, auth_b64url FROM learner_push_subscriptions WHERE account_id = $1 AND unsubscribed_at IS NULL ORDER BY id ASC`. (Round-8 cap means ≤ 10 rows.)
6. **If 0 active subs**: finalize `status='skipped', skipped_reason='no_push_subscription'`. Return. (Legitimate steady-state per round-6 BLOCKER 2 — not a misconfig.)
7. **Fan out** to each subscription: call `sendWebPush(sub, payload, process.env)`.
   - On `ok`: UPDATE sub `last_used_at=now(), last_status_code=res.statusCode`.
   - On `reason='endpoint_gone'` (410/404): UPDATE sub `unsubscribed_at=now(), last_status_code, last_error`. Emit `push.subscription.unsubscribed.auto` audit row via `scripts/lib/push-events.mjs::recordPushSubscriptionUnsubscribedAuto`.
   - On `reason='send_failed'`: UPDATE sub `last_status_code, last_error`. (Sub stays active; transient failure.)
8. **Final row outcome**: if ≥ 1 sub returned `ok` → row `status='sent', sent_at=now()`. Else (all failed/gone) → row `status='skipped', skipped_reason='send_failed', last_error=<first failure summary>`. Note: `'push_helper_not_shipped'` is CHECK-allowed for forward-compat but the scheduler never emits it at runtime (pre-flight gate filters misconfig before allocation).

NO retry semantics. One-shot per slot consistent with email + telegram (round-1 BLOCKER 3 closure: keep shipped contract).

### 3.8 API routes

#### `GET /api/push/vapid-public-key/route.ts`
- Public endpoint; returns `text/plain` with the VAPID public key.
- 503 + body `vapid_unconfigured` if env unset.
- 503 + body `push_disabled` if `const setting = await resolveOperatorSetting('LEARNER_REMINDERS_PUSH_ENABLED'); if (setting.dbErrored || setting.value !== 1)` (round-5+6 BLOCKER 1: `kind:'int'` so `.value` is `number`. Round-9 WARN 3: also fail-closed on `dbErrored` so DB blips can't accidentally re-enable channel when operator flipped OFF; same pattern as `lib/auth/guards.ts:312` SAAS_OFFER_GATE.) (round-1 v2 BLOCKER 1 closure: route consults the SAME DB-row→env→default contract as `lib/admin/operator-settings.ts`. Operator flip in `/admin/settings/alerts` immediately enables the route).

#### `POST /api/push/subscribe/route.ts`
- **Master-switch gate FIRST** (round-4 BLOCKER 1): if `const setting = await resolveOperatorSetting('LEARNER_REMINDERS_PUSH_ENABLED'); if (setting.dbErrored || setting.value !== 1)` (round-5+6 BLOCKER 1: `kind:'int'` so `.value` is `number`. Round-9 WARN 3: also fail-closed on `dbErrored` so DB blips can't accidentally re-enable channel when operator flipped OFF; same pattern as `lib/auth/guards.ts:312` SAAS_OFFER_GATE.) OR VAPID env triple unset → return 503 `{error: 'push_disabled'}`. Same gate as vapid-public-key route. Mutations off the moment operator/env flips OFF.
- `requireLearnerArchetypeAndVerified` (round-1 v2 BLOCKER 2 closure) + `enforceTrustedBrowserOrigin` + `enforceAccountRateLimit('push:subscribe', 30, 60_000)`.
- Body: `{ endpoint: string, p256dh: string, auth: string, userAgent?: string }`.
- **Endpoint validation** (round-1 v2 BLOCKER 3 + round-3 BLOCKER 1 closure): parse `endpoint` as URL; protocol MUST be `https:`; (hostname + pathname prefix) MUST match the exact allowlist via shared helper `lib/notifications/push-provider-allowlist.ts::isAllowedPushEndpoint(url)`:
  ```ts
  // Exact host + path prefix per provider — tighter than suffix regex to
  // block attacker.googleapis.com / attacker.windows.com etc.
  const ALLOWED_PUSH_ENDPOINTS: Array<{ host: string; pathPrefix: string }> = [
    // FCM (Chrome / Edge / Android)
    { host: 'fcm.googleapis.com', pathPrefix: '/fcm/send/' },
    // Firefox Push Service
    { host: 'updates.push.services.mozilla.com', pathPrefix: '/wpush/' },
    // Safari 16.4+
    { host: 'web.push.apple.com', pathPrefix: '/' },
  ]
  ```
  (Round-3 BLOCKER 1: dropped WNS — deprecated Edge legacy. Tightened googleapis.com to literal `fcm.googleapis.com` + path prefix; mozilla.com to literal `updates.push.services.mozilla.com` + path prefix; apple.com to literal `web.push.apple.com` exact host.)
  Reject any other host/path with 400 `invalid_endpoint`.
- p256dh + auth: base64url-encoded; validate via regex `/^[A-Za-z0-9_-]+={0,2}$/` and length bounds (p256dh ≥ 80 chars, auth ≥ 20).
- **Transaction** (concurrent-safe per round-2 BLOCKER 1):
  1. Acquire `pg_advisory_xact_lock(hashtextextended('push_sub:' || endpoint, 0))` — serialises all writers contending for the same endpoint URL.
  2. SELECT existing active sub for the endpoint URL (regardless of account).
  3. If exists AND `account_id != auth.account.id`: UPDATE that row `unsubscribed_at=now()`, emit audit event `push.subscription.reassigned`.
  4. If exists AND same account: **UPDATE the existing row's `p256dh_b64url`/`auth_b64url`/`user_agent`/`updated_at`** (round-8 BLOCKER 2 closure — browser may rotate keys for same endpoint; same-account re-subscribe must refresh crypto material). Return 200 with that row's id (no audit event — it's a key refresh, not a new subscription).
  4a. **Cap enforcement** (round-8 BLOCKER 1): count active subs for `account_id`. If `count >= MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_ACCOUNT (10)` AND this insert would create the 11th: SELECT MIN(id) active sub for the account → flip its `unsubscribed_at=now()` + emit `push.subscription.unsubscribed.auto` (payload reason='cap_reached'). Proceed to insert.
  5. SELECT most-recent ANY-state row for `(account_id, endpoint) ORDER BY id DESC LIMIT 1`. If exists AND `unsubscribed_at IS NOT NULL`: UPDATE that row `unsubscribed_at=null, p256dh_b64url=$2, auth_b64url=$3, user_agent=$4, updated_at=now()` — REVIVE.
  6. Otherwise INSERT new row.
  7. On `23505` (unique violation) anywhere in the path: rollback, re-read winner, return 200 with the winner's id — defense-in-depth for the advisory-lock-bypassed race (round-2 BLOCKER 1).
- Wrap reads in try/catch on `42P01` → return 503 `migration_pending` (round-1 BLOCKER 7 closure).
- 200 with `{ ok: true, subscriptionId }`.

#### `POST /api/push/unsubscribe/route.ts`
- **NO master-switch gate** (round-8 WARN 5 closure): users MUST always be able to delete their stored endpoint regardless of operator/env state. Privacy/ownership invariant. Subscribe is gated; unsubscribe is not.
- Same FULL perimeter as subscribe (round-3 WARN 3 closure): `requireLearnerArchetypeAndVerified` + `enforceTrustedBrowserOrigin` + `enforceAccountRateLimit('push:unsubscribe', 30, 60_000)`.
- Body: `{ endpoint: string }`.
- **Endpoint validation** (round-10 self-review WARN 1 closure): URL format + `https:` protocol + reasonable length cap (8 KiB). **DO NOT** enforce the `ALLOWED_PUSH_ENDPOINTS` host allowlist here — if a future PR tightens the subscribe allowlist (e.g. removes a deprecated provider), the legacy endpoint already stored in `learner_push_subscriptions` must remain deletable by its owner. Privacy/ownership invariant trumps host validation on the delete path.
- **Acquire advisory lock** (round-4 WARN 3): `pg_advisory_xact_lock(hashtextextended('push_sub:' || endpoint, 0))` — same key as subscribe so subscribe/unsubscribe contests serialize.
- UPDATE all active subs for `account_id = auth.account.id AND endpoint = $1` → `unsubscribed_at = now()`.
- Emit `push.subscription.unsubscribed.user` audit event per affected row.
- 200 with `{ ok: true }`.

### 3.9 Cabinet UI (extend existing surface)

**SSR helper** (round-10 self-review WARN 4 closure): `lib/notifications/learner-push-state.ts::resolveLearnerPushState(accountId)` returns:

```ts
type LearnerPushState =
  | { kind: 'disabled' }
  | { kind: 'unconfigured' }
  | { kind: 'migrationPending' }
  | {
      kind: 'ready'
      vapidPublicKey: string
      activeDevices: Array<{ id: string; userAgent: string | null; lastUsedAt: string | null }>
    }
```

Resolution order:
1. `const setting = await resolveOperatorSetting('LEARNER_REMINDERS_PUSH_ENABLED')`. If `setting.dbErrored || setting.value !== 1` → `{kind:'disabled'}`.
2. Read VAPID env triple. If any empty → `{kind:'unconfigured'}`.
3. Read active devices via `SELECT id, user_agent, last_used_at FROM learner_push_subscriptions WHERE account_id=$1 AND unsubscribed_at IS NULL ORDER BY id DESC`. Wrap in `try/catch` on `isUndefinedTableError` → `{kind:'migrationPending'}`.
4. Otherwise → `{kind:'ready', vapidPublicKey, activeDevices}`.

`components/cabinet/learner-push-subscription.tsx` (NEW client island) — mounted into `app/cabinet/profile/page.tsx` BENEATH the existing `<LearnerTelegramBinding>`. **SSR parent** conditionally renders: if `state.kind === 'disabled'` → render nothing (section hidden); else → render the client island with `state` as initial prop.

**State machine** (round-1 v2 WARN 8 closure — single contract):
| State | Trigger | SSR render | Client controls |
|---|---|---|---|
| Disabled | `LEARNER_REMINDERS_PUSH_ENABLED='0'` (or unset) | Section hidden entirely | none |
| Unconfigured | flag=1 + VAPID env missing | "Скоро будет — оператор завершает настройку напоминаний в браузере" placeholder | none |
| MigrationPending | flag=1 + VAPID OK + 42P01 on read | "Скоро будет" placeholder | none |
| Ready | flag=1 + VAPID + migration ready | "Напоминания о начале урока в браузере" section with active-device list + "Подключить" button | subscribe / unsubscribe |

Acceptance assertion (round-1 v2 WARN 8): "section hidden in Disabled state; placeholder in Unconfigured/MigrationPending; full UI in Ready". `evals/PRODUCT_FLOWS.md` FLOW pins all 4 states.

Client controls in Ready state (round-2 WARN 3 closure — explicit feature detection + base64url → Uint8Array conversion):
1. **Feature detection**: bail with "Браузер не поддерживает уведомления о начале урока" if ANY missing: `'serviceWorker' in navigator`, `'PushManager' in window`, `'Notification' in window`.
2. **Permission check**: `Notification.permission`:
   - `granted` → proceed.
   - `default` → `await Notification.requestPermission()`; if not `'granted'` → abort.
   - `denied` → show hint "Браузер запретил уведомления. Включите их в настройках сайта."
3. **VAPID key fetch + decode** (round-3 WARN 4 closure): `const res = await fetch('/api/push/vapid-public-key')`. If `!res.ok` (503 push_disabled / vapid_unconfigured / etc): show "Подключение временно недоступно — попробуйте позже" + abort. On 200: `const text = await res.text()` → `const applicationServerKey = urlBase64ToUint8Array(text)` (shared helper inline; standard MDN pattern: replace `-` with `+`, `_` with `/`, pad with `=`, then `Uint8Array.from(atob(...), c => c.charCodeAt(0))`).
4. **Subscribe**: `await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
5. **POST** subscription to `/api/push/subscribe` (endpoint + p256dh base64url + auth base64url + navigator.userAgent).
6. **Unsubscribe**: list of active devices (from SSR-fetched state) with "Напомнить иначе" buttons → POST `/api/push/unsubscribe`.

(Round-2 WARN 5 / content-style closure: button copy uses "Подключить напоминания в браузере" — NOT "push". Section heading "Напоминания о начале урока в браузере". Inline copy says "Браузер показывает напоминание о начале занятия даже если вкладка LevelChannel закрыта".)

### 3.10 Admin UI (extend existing card) + reader surface (round-5 WARN 4)

`app/admin/(gated)/settings/alerts/page.tsx` — extend the existing learner-reminders scheduler card with a Push row:
- Show `LEARNER_REMINDERS_PUSH_ENABLED` flag value.
- Show VAPID env presence: ✓ / ✗.
- Show counts (last 1h): sent / skipped (by reason).
- Wrap reads in try/catch on 42P01 → render "Скоро будет" placeholder.

**NEW reader surface (round-5 WARN 4 closure)**: `lib/admin/learner-reminder-push-stats.ts::getRecentPushDispatchCounts(windowMinutes = 60)` returns `{ sent: number; skipped: Record<SkippedReason, number>; migrationPending: boolean }`. SQL:
```sql
SELECT status, skipped_reason, COUNT(*) AS n
  FROM learner_reminder_dispatches
 WHERE channel = 'push'
   AND created_at >= now() - ($1 || ' minutes')::interval
 GROUP BY status, skipped_reason
```
Wrapped in `isUndefinedTableError` → `migrationPending: true` short-circuit.

NO new `/admin/settings/reminders` page (round-1 BLOCKER 2 closure — drift vs. shipped SoT).

### 3.11 Audit events

(Round-2 BLOCKER 2 + round-3 BLOCKER 2 closure: explicit schema + executable contract.)

Migration 0108 widens `auth_audit_events.event_type` CHECK to include 5 new push event types. AUTH_AUDIT_EVENT_TYPES in `lib/audit/auth-events.ts` updated; drift test validates parity.

New event types:
- `push.subscription.created` — first INSERT for (account_id, endpoint).
- `push.subscription.reassigned` — endpoint moved from one account to another.
- `push.subscription.revived` — same-account unsubscribed sub re-activated.
- `push.subscription.unsubscribed.user` — user-initiated.
- `push.subscription.unsubscribed.auto` — Web Push 410/404 from scheduler.

**Writer contract (round-3 BLOCKER 2): the existing `recordAuthAuditEvent` sink requires `email` for hashing.** For push events the email may come from different sources depending on event:
- `subscription.created` / `revived` / `unsubscribed.user`: route handler has `auth.account.email` from `requireLearnerArchetypeAndVerified` session → pass directly.
- `subscription.reassigned`: route handler has the NEW account's email (current session) + needs lookup of the OLD account's email (the displaced one). Lookup via `getAccountById(oldAccountId)` from `lib/auth/accounts.ts` (sync read inside the same TX). Emit TWO audit rows: one against the new account (eventType=`reassigned`, email=new) and one against the old account (eventType=`unsubscribed.auto`, email=old, payload mentions reason='reassigned-by-other-account').
- `subscription.unsubscribed.auto` from scheduler (Web Push 410): scheduler has `account_id` from the sub row; lookup `getAccountById(accountId)` to fetch email. Wrap in try/catch — if account row deleted (rare; accounts are never hard-deleted, only anonymised), fall back to `email=''` + log a `console.warn`.

**Two writer surfaces** (round-4 BLOCKER 2 — scheduler is .mjs and cannot import TS):
- **App/route side** (TS): NEW `lib/audit/push-events.ts` exporting typed shortcuts (`recordPushSubscriptionCreated`, `recordPushSubscriptionReassigned`, `recordPushSubscriptionRevived`, `recordPushSubscriptionUnsubscribedUser`) that perform the email lookup internally and call `recordAuthAuditEvent`.
- **Scheduler side** (.mjs): NEW `scripts/lib/push-events.mjs` exporting `recordPushSubscriptionUnsubscribedAuto({accountId, endpoint, statusCode})`. **Routes through dedicated audit pool** (round-8 BLOCKER 3 closure — does NOT INSERT through the primary scheduler client; that would bypass the `levelchannel_audit_writer` role boundary established in mig 0029). NEW `scripts/lib/audit-pool.mjs` is a .mjs port of `lib/audit/pool.ts`: lazily opens a Pool against `AUDIT_DATABASE_URL` (falls back to `DATABASE_URL` if unset, matching TS behaviour). All raw SQL `INSERT INTO auth_audit_events` from .mjs writers uses this dedicated pool. **Email hash strategy** (round-5 BLOCKER 2): port `lib/auth/email-hash.ts::hashEmailForRateLimit` to `scripts/lib/email-hash.mjs::hashEmailForAudit(email)`. Algorithm: HMAC-SHA256(secret=AUTH_RATE_LIMIT_SECRET, msg=email.toLowerCase().trim()).hex. Email looked up via `SELECT email FROM accounts WHERE id = $1` on the primary pool (read-only lookup); on missing → `email_hash=''` + `console.warn`. Drift test pins TS↔mjs hash equality.

Tests for TS writer pin: `recordPushSubscriptionCreated({accountId, endpoint})` → audit row inserted with correct hashed email; reassign emits 2 rows; auto-unsubscribe (via scheduler .mjs writer) tested in scheduler suite.

## 4. Tests

### Unit
- `tests/notifications/learner-push-template.test.ts` — render template; verify no zoom_url, no lesson title, deep-link present.
- `tests/notifications/web-push-wrapper.test.ts` — mock `web-push` SDK; verify VAPID setup is one-shot; 410 → reason `endpoint_gone`; 500 → reason `send_failed`; missing env → reason `vapid_unconfigured`.
- `tests/notifications/push-provider-allowlist.test.ts` — isAllowedPushEndpoint accepts FCM (fcm.googleapis.com/fcm/send/X), Mozilla (updates.push.services.mozilla.com/wpush/X), Apple (web.push.apple.com/X); rejects http://, rejects non-allowlist hosts, rejects malformed.
- `tests/public/sw-open-url.test.ts` (round-2 WARN 4 + round-8 BLOCKER 4 closure) — tests import `public/sw-lib/resolve-open-url.js` directly (NOT `sw.js`, which uses classic `importScripts`); helper is exposed via the in-script `self.resolveOpenUrl = function(url, ownOrigin) {...}` assignment that jsdom can capture by evaluating the script against a sandboxed `self`. Unit tests verify: payload.url same-origin → returned; cross-origin → falls back to '/cabinet'; malformed → falls back; null/undefined → falls back.

### Integration
- `tests/integration/api/push-vapid-public-key.test.ts` — 503 when env empty; 503 when operator setting `LEARNER_REMINDERS_PUSH_ENABLED='0'` even with env set (proves DB-row→env→default contract per round-1 v2 BLOCKER 1); 200 + body when both set.
- `tests/admin/operator-settings.test.ts` (round-1 v2 WARN 7 closure) — extend the hard-coded 4-key invariant to include `LEARNER_REMINDERS_PUSH_ENABLED`; verify the new key participates in the standard schema shape.
- `tests/integration/api/push-subscribe.test.ts`:
  - happy path: new endpoint → INSERT → 200 with subscriptionId.
  - **key refresh** (round-8 BLOCKER 2 + round-9 WARN 4 pin): same account + same active endpoint + DIFFERENT p256dh/auth/user_agent body → 200 with existing id; SQL assertion that p256dh/auth/user_agent/updated_at ALL changed to the new values.
  - REVIVE: same account + previously unsubscribed endpoint → row resurrected (unsubscribed_at NULL, refreshed keys).
  - reassign: DIFFERENT account + same active endpoint → existing row's `unsubscribed_at` set, audit event emitted, NEW row inserted under new account.
  - **cap eviction** (round-8 BLOCKER 1 + round-9 WARN 4 pin): single account with 10 active subs; 11th subscribe → MIN(id) sub flipped to `unsubscribed_at`, new row inserted, `push.subscription.unsubscribed.auto` audit row emitted with payload `{reason: 'cap_reached'}`.
  - Endpoint validation (round-1 v2 BLOCKER 3): reject `http://...`, reject hostname not in allowlist (e.g. `https://attacker.example/`), reject malformed URL — all 400 `invalid_endpoint`.
  - 401 anon; 403 wrong-archetype (teacher/admin); 403 wrong origin; 429 rate limit; 400 missing field.
- `tests/integration/api/push-unsubscribe.test.ts` — user-initiated unsubscribe; idempotent on already-unsubscribed.
- `tests/integration/scripts/learner-reminder-dispatch-push.test.ts`:
  - `LEARNER_REMINDERS_PUSH_ENABLED=0` → push branch never runs; NO `(slot,'push')` row written.
  - `=1` + VAPID unset → pre-flight gate fires; NO `(slot,'push')` row written; idempotency slot stays open for next tick (round-7 BLOCKER 1 closure — unified with §3.3 + §3.7).
  - `=1` + VAPID set + 0 subs → row `skipped_reason='no_push_subscription'`.
  - `=1` + VAPID + 2 subs, both succeed → row `sent`, both subs `last_used_at` updated.
  - one sub returns 410 → row `sent` (other succeeded), failed sub `unsubscribed_at` set.
  - all subs fail (500/410/etc) → row `skipped, skipped_reason='send_failed'`.
- `tests/integration/admin/reminders-push-row.test.ts` — admin alerts page renders push row; migrationPending → placeholder; counters from DB.

### Migration
- `tests/integration/calendar/trigger-direct-evidence.test.ts` — pattern reference (raw SQL evidence).
- New `tests/integration/migrations/0109-push-subscriptions.test.ts`:
  - Active endpoint UNIQUE — INSERT two rows same endpoint, both unsubscribed_at NULL → second INSERT raises 23505.
  - Same endpoint with first row unsubscribed → second INSERT succeeds.

## 5. Deploy ordering

- `LEARNER_REMINDERS_PUSH_ENABLED=0` is the default — channel dormant post-merge until operator flips.
- Migrations 0108 + 0109 apply via existing autodeploy timer.
- All new reads use `isUndefinedTableError` / `isUndefinedColumnError` to surface `migrationPending: true` (closes round-1 BLOCKER 7).
- No order coupling with other in-flight migrations.

## 6. Doc sweep

(Round-1 WARN 11 + round-1 v2 BLOCKER 5 + WARN 6 + WARN 9 closures.)

- `.env.example` (round-1 v2 BLOCKER 5 — primary SoT for `scripts/check-env-contract.mjs`) — add `LEARNER_REMINDERS_PUSH_ENABLED`, `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` with explanatory comments.
- `OPERATIONS.md` (if present — verify at impl time) + `scripts/activate-prod-ops.sh` — extend the env render to write the new vars to the systemd EnvironmentFile (single env file, parity with TG bot token).
- `scripts/systemd/levelchannel-learner-reminder-dispatch.service` — no change (already loads the rendered EnvironmentFile); commented note in the unit refers to the new env vars.
- `ARCHITECTURE.md` — add `learner_push_subscriptions` row to migration table; add `lib/notifications/push-provider-allowlist.ts` to library surface.
- `SECURITY.md` — add §"Web Push channel": VAPID public key public by design; private key server-only; endpoint URL treated as capability (subscribe gated by `requireLearnerArchetypeAndVerified` + origin gate + account-rate-limit + provider-host allowlist); cross-account reassignment audit-logged; payload RFC 8291 encrypted by `web-push` lib; payload omits PII / capability URLs.
- `README.md` — add `LEARNER_REMINDERS_PUSH_ENABLED`, `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` to env section.
- `OPERATIONS.md` (round-6 WARN 6 closure: owner-doc for runbooks lives here, NOT PAYMENTS_SETUP) — add operator note: "If learner push reminders are desired, run `npx web-push generate-vapid-keys`, set the three `PUSH_VAPID_*` env vars in `$ENV_FILE`, restart `levelchannel.service` (the actual app service per `scripts/systemd/`), then flip `LEARNER_REMINDERS_PUSH_ENABLED=1` via `/admin/settings/alerts`."
- `scripts/check-env-contract.mjs` (round-6 WARN 5 closure) — add `LEARNER_REMINDERS_PUSH_ENABLED`, `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` to the dynamic-env allowlist so the doc-drift check stays green on the new keys.
- `evals/PRODUCT_FLOWS.md` — add FLOW-CABINET-PROFILE-PUSH-001 with the 4-state UI contract per §3.9.
- `ENGINEERING_BACKLOG.md` — strikethrough BCS-DEF-4-PUSH.
- `docs/plans/bcs-def-4-learner-reminders.md` §10 cross-ref to this plan SHIPPED.
- `app/cabinet/settings/calendar/page.tsx` footer (round-1 v2 WARN 6) — update the "reminders OFF" copy from "email reminders off" to "email + push reminders both off"; show "off" only when BOTH email_enabled AND push_enabled are 0.
- `tests/cabinet/calendar-settings-state-matrix.test.tsx` (round-8 WARN 6) — exact-match strings in the test pin the old single-channel copy; update the matrix to reflect the new dual-channel footer + add a regression case for `email_enabled=0 + push_enabled=1` (footer should NOT show "выключены" — push is still on).
- `docs/plans/cabinet-stale-future-labels.md` (round-8 WARN 6) — note that the §«Календарь» footer SoT was rewritten in this wave; add a one-line cross-ref to this plan.
- `docs/plans/bcs-def-5-push-teacher-pwa-reminders.md` (round-1 v2 WARN 9) — replace stale references: `/admin/settings/reminders` → `/admin/settings/alerts`; `lib/notifications/web-push-wrapper.ts` → `scripts/lib/web-push.mjs`; service-worker test inheritance updated to match this rewrite.

## 7. File inventory

```
docs/plans/bcs-def-4-push-pwa-reminders.md            (modified — this rewrite)
migrations/0108_learner_reminder_dispatches_push_channel.sql  (NEW)
migrations/0109_learner_push_subscriptions.sql        (NEW)
.env.example                                          (extend — 4 new push env vars)
scripts/activate-prod-ops.sh                          (extend — render new push vars)
package.json + package-lock.json                       (add web-push dep)
public/manifest.webmanifest                            (NEW)
public/sw.js                                           (NEW)
public/sw-lib/resolve-open-url.js                     (NEW — testable same-origin resolver; SW loads via importScripts, tests load directly per round-8 BLOCKER 4)
public/icons/icon-192.png                              (NEW)
public/icons/icon-512.png                              (NEW)
app/layout.tsx                                         (modified — manifest link + SW client island)
app/service-worker-registration.tsx                    (NEW client island)
lib/admin/operator-settings.ts                         (extend with PUSH_ENABLED)
scripts/lib/operator-settings.mjs                      (mirror)
scripts/learner-reminder-dispatch.mjs                  (extend — push branch)
scripts/lib/learner-push-template.mjs                  (NEW)
scripts/lib/web-push.mjs                               (NEW)
lib/notifications/learner-push-state.ts                (NEW — server SSR helper for cabinet UI)
app/api/push/vapid-public-key/route.ts                 (NEW)
app/api/push/subscribe/route.ts                        (NEW)
app/api/push/unsubscribe/route.ts                      (NEW)
lib/notifications/push-provider-allowlist.ts          (NEW — host allowlist + isAllowedPushEndpoint)
app/cabinet/profile/page.tsx                           (modified — mount LearnerPushSubscription)
app/cabinet/settings/calendar/page.tsx                 (modified — reminder-off footer copy update per round-1 v2 WARN 6)
components/cabinet/learner-push-subscription.tsx       (NEW client island)
app/admin/(gated)/settings/alerts/page.tsx             (extend — push row + counters)
lib/audit/push-events.ts                              (NEW — TS app/route writer)
scripts/lib/push-events.mjs                           (NEW — .mjs scheduler writer per round-4 BLOCKER 2)
scripts/lib/audit-pool.mjs                            (NEW — .mjs port of lib/audit/pool.ts; dedicated audit role per round-8 BLOCKER 3)
scripts/lib/email-hash.mjs                            (NEW — .mjs port of hashEmailForRateLimit per round-5 BLOCKER 2)
lib/admin/learner-reminder-push-stats.ts              (NEW — reader surface per round-5 WARN 4)
tests/admin/operator-settings.test.ts                  (modified — extend hard-coded key invariant)
docs/plans/bcs-def-5-push-teacher-pwa-reminders.md     (modified — sync delta-doc per round-1 v2 WARN 9)
ARCHITECTURE.md + SECURITY.md + README.md +
  OPERATIONS.md + evals/PRODUCT_FLOWS.md +
  ENGINEERING_BACKLOG.md +
  docs/plans/bcs-def-4-learner-reminders.md            (doc sweep)
tests/                                                  (per §4)
```

Estimated diff: ~1300 LOC + 25 files.

## 8. Risks + mitigations

- **R1 — VAPID rotation downtime.** Documented in operator runbook (OPERATIONS.md). Default: do NOT rotate unless key is leaked.
- **R2 — `web-push` audit surface.** Single new runtime dep. Pin exact version; verify Node 22 compat at impl time; mark for next CSO monthly cycle.
- **R3 — Cross-account endpoint leak (round-1 BLOCKER 4).** Closed via active-endpoint UNIQUE index + app-layer reassign-then-insert logic + audit event.
- **R4 — Lock-screen capability leak (round-1 WARN 10).** Closed via payload sanitisation: title/body/url only, no zoom_url, no lesson title.
- **R5 — Deploy-before-migrate window (round-1 BLOCKER 7).** Closed via `isUndefinedTableError` guards on all new reads.
- **R6 — Service worker stuck on stale version.** SW versioning: `const SW_VERSION = '1'`; bump on changes. Activation event clears old caches if needed.
- **R7 — iOS Safari 16.4+ only.** Documented in cabinet UI hint: "Push доступен в Chrome / Firefox / Edge / Safari 16.4+ в режиме PWA".
- **R8 — Notification flood (3 reminders × N devices = 3N pings).** Acceptable: device sub is opt-in, user can unsubscribe individual devices.

## 9. Out of scope

- Teacher push (bcs-def-5-push-teacher-pwa-reminders.md) — DEFERRED (depends on unshipped `teacher_reminder_dispatches`).
- Custom notification icons per-event (uses single PWA icon).
- Push-action buttons in notification (e.g. "Mark as read").
- Multi-tenant VAPID keypairs.
- Auto-resubscribe on browser refresh (browser handles silently within validity).

## 10. Acceptance

- [ ] Mig 0108 + 0109 deployed; channel CHECK now includes `'push'`; `learner_push_subscriptions` table exists with active-endpoint UNIQUE.
- [ ] `LEARNER_REMINDERS_PUSH_ENABLED=0` → scheduler does NOT touch push branch; no push subscriptions surfaced in cabinet (UI hidden); subscribe + vapid-public-key routes return 503 `push_disabled`.
- [ ] `dbErrored` fail-closed: simulated DB blip on operator_settings read → routes 503; scheduler skips push branch.
- [ ] With env set + flag flipped: learner subscribes from Chrome → row in `learner_push_subscriptions`; next due slot dispatches push; `learner_reminder_dispatches` row `status='sent'` for `(slot_id, 'push')`.
- [ ] **Cap eviction** (round-10 self-review WARN 5): single account with 10 active subs; 11th subscribe → MIN(id) sub flipped `unsubscribed_at`, audit `push.subscription.unsubscribed.auto` emitted with `reason='cap_reached'`.
- [ ] **Key refresh** (round-10 self-review WARN 5): same-account + same-active-endpoint re-subscribe with rotated p256dh/auth → existing row updated, NO new row, NO audit event.
- [ ] **Budget unit** (round-10 BLOCKER 1 pin): `RATE_LIMIT_PER_TICK=3`, 5 due slots × 4 active subs each → 3 push rows `sent`, 2 `skipped past_send_by`; total provider sends = 12 (verifies 1-slot = 1-budget regardless of fanout).
- [ ] Cross-account reassign: learner B subscribes with same endpoint that learner A previously used → A's row `unsubscribed_at` set, audit event `push.subscription.reassigned` emitted, B's row active.
- [ ] **User unsubscribe of legacy endpoint** (round-10 self-review WARN 1): endpoint whose host was removed from `ALLOWED_PUSH_ENDPOINTS` after subscription → unsubscribe POST still succeeds (no host gate on delete path).
- [ ] Endpoint 410 from FCM → scheduler flips sub `unsubscribed_at`; future ticks skip; row `skipped_reason='send_failed'` only if NO other sub succeeded.
- [ ] Admin alerts page renders push row with VAPID env presence + per-status counters; deploy-before-mig window shows placeholder (NO 500).
- [ ] All push payloads contain only title/body/url — no zoom URL, no lesson title.
- [ ] Doc sweep complete: ARCHITECTURE.md + SECURITY.md + README.md + OPERATIONS.md + evals/PRODUCT_FLOWS.md updated.
- [ ] Trailer: `Codex-Paranoia: SELF-REVIEW round 10 fallback (Codex quota exhausted; debt recorded for post-quota plan+wave rounds)`.
