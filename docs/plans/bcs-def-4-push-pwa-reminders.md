# BCS-DEF-4-PUSH — PWA push channel for learner lesson-start reminders

**Status:** PLAN-PARANOIA ROUND 1 BLOCK (2026-06-06). 8 BLOCKERs + 3 WARNs surfaced — see §0a. Plan requires substantial rewrite before implementation. Do NOT start coding until plan is revised + re-paranoia'd.

## 0a. Plan-paranoia round-1 findings (2026-06-06, recorded; closures pending)

Raw output: `/tmp/codex-paranoia-20260606T042830Z-push-plan/round-1.md`.

| # | Severity | Finding (one-line) | Citations |
|---|----------|-------------------|-----------|
| 1 | BLOCKER | VAPID env-file location wrong — operator would set keys that aren't read. `/etc/levelchannel/env.d/push.env` is NOT loaded by Next.js OR systemd scheduler; the actual `EnvironmentFile` is rendered by `scripts/activate-prod-ops.sh`. | `:140-146,930-947`; `scripts/systemd/levelchannel-learner-reminder-dispatch.service:23-25`; `scripts/activate-prod-ops.sh:315-318,365-378` |
| 2 | BLOCKER | Plan reintroduces deprecated UI surfaces (`/cabinet/settings/reminders` + `/admin/settings/reminders`) that shipped main has REPLACED with `/admin/settings/alerts` + cabinet-side surfaces on existing pages. Drift vs. shipped SoT, not "add page". | `:21-26,77-79,533-571,793-795,934`; `app/admin/(gated)/settings/alerts/page.tsx:62-74,170-177,192-200`; `app/cabinet/profile/page.tsx:58-88,146-151` |
| 3 | BLOCKER | Retry model incompatible with shipped schema. Plan wants `markRetry()` + "next tick retries", but `learner_reminder_dispatches` is one-shot today: `status in ('claimed','sent','skipped')` + `UNIQUE(slot_id, channel)`. No retry path without changing state machine + query model entirely. | `:405-460,632-640`; `migrations/0064_learner_reminder_dispatches.sql:27-64`; `docs/critical-path.md:80` |
| 4 | BLOCKER | UNIQUE `(account_id, endpoint)` admits cross-account leak on shared devices. Web Push subscription is bound to browser profile/origin, NOT account. Learner B subscribing in the same browser where A previously subscribed → same endpoint stays active for both, push for A delivered to B. Need global uniqueness on active endpoint or explicit reassignment semantics. | `:226-231,704-719` |
| 5 | BLOCKER | Hardcoded prod origin in payload / service worker / tests. Repo has the canonical-origin contract (`lib/api/origin.ts`) precisely because staging/reverse-proxy/localhost break hardcoded URLs. Staging push would point at prod cabinet. | `:317,325,397,602,919`; `lib/api/origin.ts:1-18,30-59` |
| 6 | BLOCKER | TS/MJS boundary not designed. Plan places `push-templates.ts` + `web-push-wrapper.ts` in `lib/notifications/`, but dispatcher is plain Node ESM (`scripts/learner-reminder-dispatch.mjs`) and already imports only `scripts/lib/*.mjs`. Same class of error TG plan caught + fixed. | `:788-789`; `scripts/learner-reminder-dispatch.mjs:42-50`; `docs/plans/bcs-def-4-tg-telegram-reminders.md:43,496-501` |
| 7 | BLOCKER | "No ordering hazard" claim is wrong for this repo. Deploy-before-migrate window is normal here and explicitly closed by `migrationPending` / `42P01` / `42703` fallbacks. New cabinet read + admin counters + API routes on fresh table WITHOUT degrade path → 500 on rollout. | `:563-571,946-952`; `app/admin/(gated)/settings/alerts/page.tsx:38-41,130-167`; `lib/admin/operator-settings.ts:708-749`; `lib/admin/probe-status.ts:72-79` |
| 8 | BLOCKER | Self-contradiction on service-worker registration location. First says root-layout change, then revised decision moves registration to `app/cabinet/layout.tsx` — but that file is NOT in the file inventory. Critical-path + route ownership not fixed before code. | `:88-93,784,893-901` |
| 9 | WARN | CSRF/rate-limit contour weak. `POST /api/push/subscribe` plan uses IP-scoped `enforceRateLimit`, but authenticated per-account mutations in this repo already have `enforceAccountRateLimit`. Origin gate left as "audit at impl time", not mandatory contract. | `:246-250,547-556,740-743`; `lib/security/account-rate-limit.ts:5-23,24-31`; `lib/security/request.ts:148-177` |
| 10 | WARN | Push body includes `zoom_url` / meeting URL. Push notifications render on lock screen — this is a capability leak to anyone who sees the screen. Email precedent does not transfer 1:1. Safer: send reminder fact + deep-link into authenticated cabinet only. | `:395-397,420-431,730-736` |
| 11 | WARN | Doc sweep incomplete. Plan adds new trust boundary + env vars + routes/surfaces but file inventory missing `SECURITY.md`, `README.md`, `evals/PRODUCT_FLOWS.md`, `evals/URL_REDIRECT_CONTRACT.md`. | `:776-810`; `AGENTS.md:74-87,254-260`; `README.md:81-119`; `DOCUMENTATION.md:25-34,112-118` |

**Recommended next step:** rewrite §2 (Design) sections to address BLOCKERS 1-8 + re-paranoia. Estimated 4-6 hours of plan work before any code can be written. Defer implementation to a dedicated session.

---

**Status (original):** DRAFT 2026-05-18 (plan-doc only; awaiting `/codex-paranoia plan`).
**Wave name:** `bcs-def-4-push-pwa-reminders` (single-PR epic — see §5).
**Trigger:** Push channel deferred from BCS-DEF-4 MVP
(`docs/plans/bcs-def-4-learner-reminders.md:7` "MVP = email only"; §10
"BCS-DEF-4-PUSH — PWA web push. Needs service worker + VAPID keys +
subscription store.").
**Author:** Claude (autonomous).
**Channel:** Browser Web Push (PWA, via `web-push` Node lib + VAPID).

---

## 0. Cross-refs

- **`docs/plans/bcs-def-4-learner-reminders.md`** — parent plan (merged via PR #333).
  §2.2 reserves `learner_reminder_dispatches.channel` for `'push'`; §10 defers
  this work explicitly.
- **`docs/plans/bcs-def-4-tg-telegram-reminders.md`** — sibling Telegram channel
  plan (in flight as PR #347). Shares: scheduler per-channel dispatch branch
  pattern (§2.5 of TG plan); cabinet `/cabinet/settings/reminders` page
  extension idiom; admin `/admin/settings/reminders` master-switch row idiom.
  Does NOT share: webhook surface (push has no inbound webhook — subscription
  payloads come from the browser via a Server Action / API route).
- **`docs/plans/admin-ux-coverage.md §3.4 / §5.4`** — closed at BCS-DEF-4;
  this PR extends `/admin/settings/reminders` with a Push master switch row.

---

## 1. Goal

Add Web Push as a delivery channel for the unified learner-reminder scheduler.
When a learner has opted-in AND a Push subscription has been registered for
their account, the scheduler dispatches each due reminder via **all enabled
channels** (email + push, plus telegram if that PR has landed).

**Hard requirements:**
- Each learner subscribes from their browser; we store the PushSubscription
  payload (endpoint + p256dh public key + auth secret).
- Idempotent per `(slot_id, offset_minutes, channel)` — `channel='push'`
  slots into the existing CHECK extension precedent from BCS-DEF-4-TG.
- Operator master switch `LEARNER_PUSH_ENABLED` (OFF by default) — channel
  dormant until VAPID keys are generated AND operator flips switch.
- Soft-skip on missing subscription: row created with `status='skipped'` +
  `skipped_reason='no_push_subscription'`; other channels unaffected.
- Auto-unsubscribe on Web Push 410 Gone / 404 Not Found responses (the
  endpoint has been invalidated by the browser); subscription row marked
  unsubscribed; future dispatches skip.
- Multi-device per learner: a learner can subscribe from multiple browsers
  (laptop Chrome + phone Safari iOS 16.4+); each device = separate row;
  scheduler fans out to ALL active subscriptions per (slot, offset).
- iOS Safari 16.4+ support documented as best-effort; older iOS / non-PWA
  modes return `Notification.permission === 'denied'` early.

**Out of scope explicitly:** see §10.

---

## 1.1 Existing surface inventory

Cited against `main` HEAD as of 2026-05-18.

### Parent surface (BCS-DEF-4)

- **`migrations/0061_learner_reminder_dispatches.sql`** — the dispatch queue
  table (per BCS-DEF-4 §2.2). `channel text not null check (channel in ('email'))`
  — this plan extends the CHECK to include `'push'`. If BCS-DEF-4-TG (the
  sibling plan) lands first, this is a re-extension; if BCS-DEF-4-PUSH lands
  first, it's the first extension. **Migration ordering coordination needed
  if both ship in parallel** — see §2.10 + RISK-9.
- **`migrations/0059_learner_reminder_preferences.sql`** — per-learner offset
  list. NO new column needed; subscription existence acts as implicit opt-in.
- **`scripts/learner-reminder-dispatch.mjs`** — the scheduler tick. Extended
  with per-channel iteration (already designed for in BCS-DEF-4 §2.4 step 5b).
- **`lib/admin/operator-settings.ts`** — adds 1 new key `LEARNER_PUSH_ENABLED`
  with `scope: 'learner-reminders'`.
- **`app/admin/(gated)/settings/reminders/page.tsx`** — adds a "Push канал" row.
- **`app/cabinet/settings/reminders/page.tsx`** — adds a "Push-уведомления"
  section with browser opt-in button + multi-device list.

### NEW surface — service worker + PWA manifest

LevelChannel has NO PWA today:
- **No `public/manifest.json`** — verified via `ls public/`: only `anastasia.jpg` and `favicon.svg`.
- **No `public/sw.js`** — no service worker.
- **No `next-pwa` / `@ducanh2912/next-pwa`** in `package.json` dependencies.

This plan introduces ALL THREE as new artifacts:
- `public/manifest.webmanifest` (PWA install descriptor).
- `public/sw.js` (service worker — push event handler + notification click
  routing). Hand-rolled NOT generated by `next-pwa` — see §2.5 decision.
- `app/layout.tsx` reference to `manifest.webmanifest` + service worker
  registration script (deferred client component).

### NEW surface — web-push library

`web-push` (npm package) is the de-facto Node implementation of RFC 8030
(Web Push) + RFC 8291 (Encrypted Payload) + RFC 8292 (VAPID). Adding it
adds ONE runtime dep (~75KB minified). Alternative `@aws-sdk/client-sns`
+ AWS Pinpoint Push rejected — it's a managed-service detour we don't need
and adds a third-party network hop.

### Sibling surface (BCS-DEF-1-TG / BCS-DEF-4-TG)

Push does NOT reuse any Telegram-specific helper. BUT it copies the SAME
plan structure (env-contract soft-skip; per-channel scheduler branch;
master-switch + env-presence indicators in admin UI).

---

## 1.2 Critical-path inventory

Per `docs/critical-path.md`:
- **`lib/admin/operator-settings.ts`** — on critical path. 1 new key (additive).
- **`scripts/learner-reminder-dispatch.mjs`** — NOT on critical path.
- **`app/layout.tsx`** — on critical path (root layout). This plan adds a
  `<link rel="manifest">` + a small client-side service-worker registration
  script. Touches NEED careful paranoia (root layout shipped to every page).

---

## 2. Design

### 2.1 VAPID key generation + storage

**VAPID (RFC 8292)** keys are a single (public, private) ECDSA P-256 keypair
identifying the application to push services (FCM, Mozilla, Apple). They are
NOT per-user — one keypair per deployment.

**Generation** (one-off, on first deploy of this PR — operator runs once):
```
npx web-push generate-vapid-keys
```
Output (example):
```
Public Key:  BNb...85-char-base64url
Private Key: kP3...43-char-base64url
```

**Storage** — `/etc/levelchannel/env.d/push.env` (mode 0640 root:levelchannel,
parity with `/etc/levelchannel/env.d/telegram-alerts.env`):
```
PUSH_VAPID_PUBLIC_KEY=BNb...
PUSH_VAPID_PRIVATE_KEY=kP3...
PUSH_VAPID_SUBJECT=mailto:ops@levelchannel.ru
```

**`PUSH_VAPID_SUBJECT`** is required by VAPID — a `mailto:` or `https:` URL
identifying the application contact. Push services use it for abuse reports.
Plan picks `mailto:ops@levelchannel.ru` (operator-controlled, no PII).

**Rotation** is HEAVY — rotating the keypair invalidates ALL existing
subscriptions (browser stores `applicationServerKey` at subscription time
and rejects mismatched VAPID signatures). Operator runbook documents this
as "rotate only on compromise; expect all learners to re-subscribe".

**Public key exposure** — `PUSH_VAPID_PUBLIC_KEY` is rendered into the
client bundle (the browser's `subscribe()` call requires it). Public is by
design; private is server-only. Pattern: a server-only Route Handler
`GET /api/push/vapid-public-key` returns the public key as text/plain; the
cabinet client fetches it (instead of inlining into the bundle — avoids
hard-coding a deploy-time secret into Next.js build output).

### 2.2 Env contract — soft-skip, not boot-fail

```js
const PUSH_VAPID_PUBLIC_KEY = process.env.PUSH_VAPID_PUBLIC_KEY?.trim() || ''
const PUSH_VAPID_PRIVATE_KEY = process.env.PUSH_VAPID_PRIVATE_KEY?.trim() || ''
const PUSH_VAPID_SUBJECT = process.env.PUSH_VAPID_SUBJECT?.trim() || ''
```

**Soft-skip semantics** (parity with BCS-DEF-1-TG §2.2 / BCS-DEF-4-TG §2.2):
- `LEARNER_PUSH_ENABLED=0` (default) → scheduler skips Push branch; `/api/push/vapid-public-key` returns 503; cabinet section hidden.
- `LEARNER_PUSH_ENABLED=1` AND any VAPID env empty → scheduler records `config_missing`; cabinet section renders a notice "Канал временно недоступен"; other channels unaffected.

### 2.3 Subscription per learner — `learner_push_subscriptions`

Browser produces a `PushSubscription` object on `registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey})`:
```js
{
  endpoint: "https://fcm.googleapis.com/fcm/send/abc-def-...",
  expirationTime: null,
  keys: {
    p256dh: "BNb...88-char-base64url",  // client ECDH public key
    auth:   "x5Y...22-char-base64url"   // 16-byte HMAC key
  }
}
```

**New table** `learner_push_subscriptions`:

```sql
-- BCS-DEF-4-PUSH (2026-05-XX) — per-learner per-device Web Push subscriptions.
-- One row per (account_id, endpoint). Multi-device per learner supported
-- via multiple rows. Unsubscribed rows kept for audit.
-- Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §2.3.

create table if not exists learner_push_subscriptions (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  endpoint text not null,                      -- push service URL (FCM, Mozilla, Apple)
  p256dh_key text not null,                    -- base64url, ~88 chars (uncompressed ECDH public key)
  auth_key text not null,                      -- base64url, 22 chars (16 raw bytes)
  user_agent text null,                        -- captured on subscribe (audit; truncated to 256 chars)
  subscribed_at timestamptz not null default now(),
  last_succeeded_at timestamptz null,          -- updated on every successful send
  unsubscribed_at timestamptz null,
  unsubscribe_reason text null
    check (unsubscribe_reason is null or unsubscribe_reason in (
      'user_revoked', 'endpoint_gone_410', 'endpoint_not_found_404',
      'payload_too_large', 'admin_revoked', 'vapid_rotated'
    )),
  constraint lps_keys_format
    check (
      length(p256dh_key) between 80 and 100
      and length(auth_key) between 20 and 30
      and length(endpoint) between 16 and 1024
    )
);

-- Active subscription lookup: scheduler joins by account_id WHERE unsubscribed_at IS NULL.
create index if not exists lps_active_by_account_idx
  on learner_push_subscriptions (account_id)
  where unsubscribed_at is null;

-- Idempotent re-subscribe: one ACTIVE row per (account, endpoint). If the
-- learner re-subscribes from the same browser (e.g. re-grants permission),
-- the endpoint stays the same; we UPDATE keys + clear unsubscribed_at.
create unique index if not exists lps_one_active_per_endpoint_idx
  on learner_push_subscriptions (account_id, endpoint)
  where unsubscribed_at is null;
```

**Why store `user_agent`?** Multi-device per learner: helps cabinet UI render
"Chrome on Linux • last delivered 2h ago" rather than opaque endpoint URLs.
Truncated 256-char cap defends against absurd UA strings; treated as
display-only (NO trust signals derived from UA).

**Endpoint as part of unique-key, NOT primary key**: endpoints can be 1KB
(`endpoint between 16 and 1024`); PG doesn't index such varlena efficiently
as PK. Surrogate `bigserial id` PK + partial unique index is the standard
pattern.

### 2.4 Subscribe / unsubscribe API routes

**`POST /api/push/subscribe`** (NEW):
- Auth: requires authenticated learner session (`requireLearnerArchetypeAndVerified` precedent from `app/api/slots/[id]/book/route.ts:39`).
- Body: `{endpoint, keys: {p256dh, auth}}` — exact shape of `PushSubscription.toJSON()`.
- Validation: zod schema with length CHECKs mirroring the DB CHECKs (§2.3).
- Rate-limit: 10 req/hour/account (`enforceRateLimit`).
- Logic:
  ```
  Begin TX.
  Look for existing (account_id, endpoint) row.
  If exists and unsubscribed_at IS NULL → UPDATE keys + last_succeeded_at=null; commit; return {ok, status: 'refreshed'}.
  If exists and unsubscribed_at IS NOT NULL → UPDATE clear unsubscribed_at + keys; commit; return {ok, status: 'reactivated'}.
  Else → INSERT new row; commit; return {ok, status: 'subscribed'}.
  ```

**`POST /api/push/unsubscribe`** (NEW):
- Auth: same.
- Body: `{endpoint}`.
- Logic: UPDATE matching row SET `unsubscribed_at=now(), unsubscribe_reason='user_revoked'` WHERE `account_id=$session.id AND endpoint=$body.endpoint AND unsubscribed_at IS NULL`.
- Returns `{ok}` regardless of row count (idempotent).
- Browser also calls `subscription.unsubscribe()` client-side — we don't trust that, the server-side row is the source of truth.

**`GET /api/push/vapid-public-key`** (NEW):
- Public route (no auth) — VAPID public key is intentionally public.
- Returns `text/plain` body with `PUSH_VAPID_PUBLIC_KEY`.
- 503 if `LEARNER_PUSH_ENABLED=0` OR env empty.
- Cache-Control: `public, max-age=300` (5 min — operator key-rotation flips on master switch flip, cached responses tolerated).

### 2.5 Service worker — `public/sw.js`

**Hand-rolled, NOT generated.** Decision rationale:

| Option | Pros | Cons |
|---|---|---|
| **`next-pwa` plugin** | Auto-injects manifest, SW, offline cache. | Wraps `next build` with its own webpack config; adds offline-caching surface area we DON'T want; touches the build pipeline (risk to autodeploy). |
| **`@ducanh2912/next-pwa`** | Active fork of next-pwa. | Same build-pipeline coupling concern. |
| **Hand-rolled minimal SW (CHOSEN)** | ~80 LOC, scope-limited to push event + click. No offline caching. No build-pipeline touch. Easy to audit. | Manual maintenance — but the SW is dead-simple and rarely changes. |

**`public/sw.js`** content (sketch):

```js
// public/sw.js — BCS-DEF-4-PUSH learner reminders.
// MINIMAL service worker. Push event handler + notification click handler.
// NO offline caching. NO precache. NO background sync.
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §2.5.

self.addEventListener('install', (event) => {
  // Activate immediately; no precache.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    return
  }
  const { title, body, url, tag } = payload
  if (!title || !body) return

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: tag || 'levelchannel-reminder',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: url || 'https://levelchannel.ru/cabinet' },
      renotify: false,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || 'https://levelchannel.ru/cabinet'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Focus an existing tab if open on the cabinet, else open new.
      for (const win of windows) {
        if (win.url.includes('/cabinet') && 'focus' in win) {
          win.focus()
          return
        }
      }
      if (self.clients.openWindow) {
        self.clients.openWindow(targetUrl)
      }
    })
  )
})
```

**Tag behaviour**: `tag` field collapses notifications with the same tag.
Default tag `levelchannel-reminder` means a 60-min reminder is REPLACED by
the 30-min reminder if both arrive within visibility (rare — they're 30 min
apart). If learner wants both as separate notifications, scheduler can emit
unique tags `levelchannel-reminder-<slotId>-<offsetMinutes>` — **MVP picks
the unique-tag form** to preserve all 3 reminders. See §2.7 payload shape.

### 2.6 PWA manifest — `public/manifest.webmanifest`

```json
{
  "name": "LevelChannel",
  "short_name": "LevelChannel",
  "description": "Языковые занятия с преподавателями",
  "start_url": "/cabinet",
  "scope": "/",
  "display": "browser",
  "background_color": "#ffffff",
  "theme_color": "#0a0a0a",
  "icons": [
    {
      "src": "/favicon.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any"
    }
  ]
}
```

`display: browser` — NOT `standalone`. Decision: this plan is push-only; we
don't want to ship a full installable PWA experience that triggers Chrome's
"Install app?" banner. iOS Safari requires `display: standalone` for "Add to
Home Screen" push to work — **iOS push is documented as best-effort for
out-of-PWA users; documented as a follow-up** (`BCS-DEF-4-PUSH-IOS` §10).

**Why `start_url=/cabinet`** — most push interactions deep-link to
notification-context (a specific slot view), but if Chrome treats this as a
home-screen-installable app, the default landing is the cabinet.

`app/layout.tsx` head adds:
```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#0a0a0a" />
```

### 2.7 Push payload shape + scheduler dispatch

**Payload (JSON, sent server-side via `web-push`):**

```json
{
  "title": "Через ~60 мин — занятие на LevelChannel",
  "body": "2026-06-01 17:00 • 60 мин\nВойти: meet.google.com/xxx",
  "url": "https://levelchannel.ru/cabinet",
  "tag": "lc-reminder-<slotUuid8>-<offsetMinutes>"
}
```

**Size constraint**: Web Push services cap encrypted payload at ~4KB; our
plaintext body is well under 200B. We don't need fragmentation.

**Per-row send branch** (in `scripts/learner-reminder-dispatch.mjs`):

```js
} else if (row.channel === 'push') {
  // Look up ALL active subscriptions for this learner.
  const subs = await pool.query(
    `SELECT id, endpoint, p256dh_key, auth_key
       FROM learner_push_subscriptions
      WHERE account_id = $1 AND unsubscribed_at IS NULL`,
    [row.account_id]
  )
  if (!subs.rowCount) {
    await markSkipped(row.id, 'no_push_subscription')
    continue
  }
  const payload = JSON.stringify(buildLearnerReminderPushPayload({
    offsetMinutes: row.offset_minutes,
    slot: { id, startAt, durationMinutes, zoomUrl, timezone },
  }))
  let anySucceeded = false
  let lastError = null
  for (const sub of subs.rows) {
    const result = await sendWebPush({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
      payload,
      vapid: { publicKey: PUSH_VAPID_PUBLIC_KEY, privateKey: PUSH_VAPID_PRIVATE_KEY, subject: PUSH_VAPID_SUBJECT },
    })
    if (result.ok) {
      anySucceeded = true
      await pool.query(
        `UPDATE learner_push_subscriptions SET last_succeeded_at=now() WHERE id=$1`,
        [sub.id]
      )
    } else if (result.statusCode === 410 || result.statusCode === 404) {
      // Endpoint dead — auto-unsubscribe THIS subscription only.
      await pool.query(
        `UPDATE learner_push_subscriptions
           SET unsubscribed_at=now(),
               unsubscribe_reason=$2
         WHERE id=$1`,
        [sub.id, result.statusCode === 410 ? 'endpoint_gone_410' : 'endpoint_not_found_404']
      )
    } else {
      lastError = result.error
      // Transient (5xx, network) — don't unsub; will retry on next tick if any-subscription failed.
    }
  }
  if (anySucceeded) {
    await markSent(row.id, /* alert_email_id stores: */ 'multi-device')
  } else if (subs.rowCount > 0 && lastError) {
    // All endpoints transient-failed — retry next tick.
    await markRetry(row.id, lastError)
  } else {
    // All endpoints 410/404'd — mark skipped (queue-level).
    await markSkipped(row.id, 'no_push_subscription')
  }
}
```

**`sendWebPush()`** is a thin wrapper around `web-push` lib's
`webpush.sendNotification(subscription, payload, options)`. Returns
`{ok: true, statusCode}` | `{ok: false, statusCode?, error}`. The
fan-out-then-aggregate pattern means ONE queue row covers all device
deliveries — operator sees per-(slot, offset, channel='push') status, not
per-device. Sub-row visibility deferred (§10).

### 2.7.1 Reconcile-enqueue extension

Same shape as BCS-DEF-4-TG §2.5:

```sql
INSERT INTO learner_reminder_dispatches ...
  CROSS JOIN LATERAL (
    SELECT unnest(
      array_remove(
        array[
          'email',
          CASE WHEN $2::bool AND EXISTS (
            SELECT 1 FROM learner_telegram_subscriptions lts
             WHERE lts.account_id = s.learner_account_id
               AND lts.unsubscribed_at IS NULL
          ) THEN 'telegram' END,
          CASE WHEN $3::bool AND EXISTS (
            SELECT 1 FROM learner_push_subscriptions lps
             WHERE lps.account_id = s.learner_account_id
               AND lps.unsubscribed_at IS NULL
          ) THEN 'push' END
        ],
        NULL
      )
    ) AS channel
  ) c
```

Three params: `$1` default offsets, `$2` `LEARNER_TELEGRAM_ENABLED`, `$3` `LEARNER_PUSH_ENABLED`.

**Coordination with BCS-DEF-4-TG**: if BCS-DEF-4-TG lands first, this PR
just extends the existing 2-channel reconcile to 3. If BCS-DEF-4-PUSH lands
first, the `lts` join is conditionally absent (depends on whether TG
migration has landed) — RISK-9 covers the ordering.

### 2.8 CHECK extensions

```sql
-- migrations/0066 (or 0067 — depending on BCS-DEF-4-TG ordering) —
-- extend channel CHECK to include 'push'.
alter table learner_reminder_dispatches
  drop constraint if exists learner_reminder_dispatches_channel_check;
alter table learner_reminder_dispatches
  add constraint learner_reminder_dispatches_channel_check
  check (channel in ('email', 'telegram', 'push'));

alter table learner_reminder_dispatches
  drop constraint if exists learner_reminder_dispatches_skipped_reason_check;
alter table learner_reminder_dispatches
  add constraint learner_reminder_dispatches_skipped_reason_check
  check (skipped_reason is null or skipped_reason in (
    'slot_no_longer_booked', 'learner_opted_out', 'email_missing',
    'past_send_by', 'channel_disabled_by_operator',
    'no_telegram_binding', 'bot_blocked_by_user',
    'no_push_subscription'
  ));
```

If BCS-DEF-4-TG hasn't landed, the value set is `('email', 'push')` only —
RISK-9 documents the conditional migration form.

### 2.9 Cabinet UI — `/cabinet/settings/reminders` extension

NEW section "Push-уведомления" below the Telegram section (or below email if
TG not landed). UI states (driven by `Notification.permission` + server-side
subscription state):

| Browser state | Server state | UI |
|---|---|---|
| `Notification` undefined (older browser) | any | "Ваш браузер не поддерживает push-уведомления. Используйте email или Telegram." |
| `Notification.permission === 'denied'` | any | "Push заблокированы в настройках браузера. Разблокируйте в иконке замка слева от адреса." |
| `Notification.permission === 'default'`, no subscription | enabled | "[Подписаться на push]" button → triggers `Notification.requestPermission()` → on grant, calls `pushManager.subscribe()` → POSTs to `/api/push/subscribe`. |
| `Notification.permission === 'granted'`, subscription present | enabled | "Push включены: Chrome on Linux • Safari on iOS" (list of active devices with unsub button per device). |
| `LEARNER_PUSH_ENABLED=0` | — | Section hidden entirely. |

**Server Action / client component split**: subscription registration MUST
run client-side (browser is the only one with `Notification` + `navigator.serviceWorker`).
The flow:

1. Client component `<PushSubscribeButton>` mounted under the section.
2. On click → `navigator.serviceWorker.register('/sw.js', {scope: '/'})`.
3. `Notification.requestPermission()`.
4. `registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: vapidPublicKey})`.
5. POST `subscription.toJSON()` to `/api/push/subscribe`.
6. On success → revalidate the section via Server Action.

`applicationServerKey` is the URL-base64-decoded VAPID public key (a Uint8Array).
The cabinet page fetches `/api/push/vapid-public-key` server-side AND inlines
it as a hidden `<input>` value (or `<script>` data attribute) to avoid a
client-side network call.

### 2.10 Admin UI extension — `/admin/settings/reminders`

NEW row "Push канал":
- **Master switch** — `LEARNER_PUSH_ENABLED`.
- **VAPID env presence** — `PUSH_VAPID_PUBLIC_KEY` set? `PUSH_VAPID_PRIVATE_KEY` set? `PUSH_VAPID_SUBJECT` set? (booleans only).
- **Subject value** — rendered (it's not secret; it's an operator email).
- **Active subscriptions count** — across all learners.
- **Recent unsubscribes (last 24h)** — split by reason (`user_revoked`, `endpoint_gone_410`, etc.).
- **Recent failures (last 1h)** — count of `attempts > 0` push rows.

### 2.11 Migration ordering

If both BCS-DEF-4-TG and BCS-DEF-4-PUSH ship:

- **Scenario A — TG lands first.** This plan picks the next free migration
  numbers: `0066_learner_push_subscriptions.sql`, `0067_learner_reminder_dispatches_push_channel.sql`.
- **Scenario B — PUSH lands first.** This plan picks `0063_learner_push_subscriptions.sql`,
  `0064_learner_reminder_dispatches_push_channel.sql`. TG plan re-rebases on
  next numbers.
- **Scenario C — both PRs open simultaneously.** Whichever lands first uses
  0063/0064; the second uses 0065/0066 (or 0066/0067 depending on TG's count).
  The plan-doc claims numbers loosely; numbering finalized at implementation
  time.

**The CHECK ALTER is the only conflict point.** If both PRs alter the
`channel` CHECK in the same migration ordinal range, the second to merge
re-bases by widening the existing CHECK (which is idempotent given the
`drop constraint if exists`). §6 RISK-9 details.

---

## 3. Tests

### 3.1 Unit — payload builder

`tests/notifications/learner-reminder-push.test.ts`:
- `buildLearnerReminderPushPayload(offsetMinutes=60, slot)` → `{title, body, url, tag}` with title containing `~60 мин`.
- Body ≤200 chars on worst case.
- Tag pattern `lc-reminder-<slotId8>-<offset>`.
- Url uses `https://levelchannel.ru` (or `NEXT_PUBLIC_SITE_URL`).
- Zoom-url omitted from body when null.

### 3.2 Integration — VAPID key endpoint

`tests/integration/api/push-vapid-public-key.test.ts`:
- Master switch on + env set → 200 text/plain with key.
- Master switch off → 503.
- Env empty → 503.
- Cache-Control header set.

### 3.3 Integration — subscribe / unsubscribe

`tests/integration/api/push-subscribe.test.ts`:
- POST as unauthenticated → 401.
- POST as teacher → 403.
- POST as learner with valid body → row inserted; status='subscribed'.
- POST same body again → row updated; status='refreshed'.
- POST after `unsubscribe` → row reactivated; status='reactivated'.
- POST with malformed body (missing `keys.p256dh`) → 400.
- POST with endpoint length 2000 → 400 (CHECK violation surfaced via zod).
- 11 POSTs in 1 hour → 11th rate-limited.

`tests/integration/api/push-unsubscribe.test.ts`:
- POST as learner with matching endpoint → row UPDATEd; reason='user_revoked'.
- POST as learner with no matching row → 200 (idempotent).
- POST as different learner with another's endpoint → 200 but no row updated (auth scopes to session).

### 3.4 Integration — scheduler dispatch

`tests/integration/scripts/learner-reminder-dispatch-push.test.ts`:
- Master switch off → no `channel='push'` rows enqueued.
- Enabled + learner with 1 active subscription → row enqueued; mocked `web-push` 201 → marked sent.
- Enabled + learner with 2 subscriptions → ONE queue row + 2 fan-out sends; if 1 succeeds + 1 transient-fails → row marked sent.
- Mocked 410 Gone → matching subscription auto-unsubscribed; row marked sent if other subs succeeded.
- All 2 subs 410'd → row → `skipped_reason='no_push_subscription'`; subs unsubscribed.
- Mocked transient 502 → `attempts++`; next tick retries.
- Mid-flight unsubscribe: row pending, learner unsubscribes all → next tick → `skipped_reason='no_push_subscription'`.
- Per-channel idempotency with `FOR UPDATE SKIP LOCKED`.

### 3.5 Integration — cabinet UI

`tests/integration/cabinet/reminder-push-section.test.ts`:
- Master switch off → section absent from HTML.
- Master switch on, no subscription → "Подписаться на push" button rendered.
- Master switch on, 2 subscriptions → 2 device rows + per-device unsub button.

(SSR-only tests; the browser flow — `requestPermission`, `subscribe()` — needs
jsdom or playwright; deferred to a playwright spec in BCS-DEF-4-PUSH-E2E §10.)

### 3.6 Integration — admin UI

`tests/integration/admin/reminders-push-row.test.ts`:
- GET as admin → "Push канал" section rendered; master switch reflects DB.
- VAPID-env-presence indicators reflect mocked env; **regression pin** — PRIVATE key never appears in HTML.
- POST flip master → next scheduler tick honours it.

### 3.7 Migration

`tests/integration/admin/learner-push-migrations.test.ts`:
- Migrations apply clean.
- Post-migration `INSERT ... channel='push'` ok; `'sms'` fails.

### 3.8 Service worker unit (jsdom)

`tests/public/sw.test.ts` (if vitest jsdom config supports it — per recent
SAAS-INFRA-1 plan that adds jsdom):
- Push event with valid payload → `showNotification` called with expected args.
- Push event with malformed JSON → no notification.
- Push event with empty payload → no notification.
- Notificationclick → existing `/cabinet` window focused if present, else new window opened.

If jsdom can't load `public/sw.js` cleanly, **fallback**: refactor SW into a
testable pure module + thin SW shell; test the pure module.

### 3.9 VAPID library smoke

`tests/notifications/web-push-wrapper.test.ts`:
- `sendWebPush({endpoint, keys, payload, vapid})` calls `web-push.sendNotification` with the expected args.
- 201 response → `{ok: true, statusCode: 201}`.
- 410 response → `{ok: false, statusCode: 410}`.
- Network throw → `{ok: false, error}`.

---

## 4. Security analysis

### 4.1 VAPID private key secrecy

`PUSH_VAPID_PRIVATE_KEY` is the application's signing key. Compromise allows
attacker to send pushes from "LevelChannel" identity to any subscribed
endpoint (the attacker still needs the endpoint URLs, which are NOT
publicly listed — but they're sent to push services per-message).

**Mitigations:**
- `/etc/levelchannel/env.d/push.env` mode 0640 root:levelchannel (parity with bot tokens).
- NEVER logged; NEVER in error messages; NEVER in client bundle.
- §3.6 regression-pins no-client-leak.
- Rotation path documented (§2.1) — all subscriptions invalidate.

### 4.2 Endpoint URL as a capability

Each `PushSubscription.endpoint` is effectively a server-side capability
URL: anyone with it + the VAPID key + the `auth` secret can deliver a
notification to that device. Endpoints leak via:
- Push service logs (we trust FCM / Mozilla / Apple).
- Our own DB.
- Network in flight (TLS — defended).

**`learner_push_subscriptions.endpoint`** is sensitive. NOT secret-tier
(rotation isn't critical), but exposing it to non-owners is a privacy issue
(reveals which push service the learner uses → indirect device fingerprint).

**Mitigations:**
- `/api/push/unsubscribe` body shape: learner sends endpoint; server scopes by `account_id=$session.id` so cross-learner endpoint enumeration is impossible.
- Admin UI does NOT render endpoint URLs (only counts).
- Logging: endpoint truncated to first 40 chars + "..." for audit logs.
- Backup / dump policy: same as `accounts.email` (encrypt-at-rest already in place).

### 4.3 Payload encryption

`web-push` library encrypts payloads per RFC 8291 (ECDH + AES-128-GCM)
client-side keys. The push service (FCM, Mozilla, Apple) cannot read the
payload — only the recipient browser, holding the private ECDH key and the
auth secret, can decrypt. We trust the `web-push` lib for this. **No
sensitive data even if FCM is compromised** (titles + bodies are
informational, not credential-bearing).

### 4.4 Notification content boundaries

Same as email (BCS-DEF-4 §4.1):
- Slot start time + zoom-url (validated https-only ≤512 chars by DB CHECK).
- No teacher PII.
- No payment info.
- No tokens.

### 4.5 CSRF on Server-Action subscribe / unsubscribe

Next.js Server Actions are CSRF-protected by default (Origin header check).
The POST routes use the same `requireLearnerArchetypeAndVerified` precedent.
Add explicit Origin check on `/api/push/subscribe` if the existing helper
doesn't already include it (audit at impl time).

### 4.6 Service worker scope

`scope: '/'` means the SW intercepts all paths. We DO NOT add `fetch`
handlers — the SW is purely `push` + `notificationclick`. **Defensive**:
unit test pins that the SW source has no `addEventListener('fetch', ...)`
line (regression-pin against future drift to a full PWA offline cache).

### 4.7 Browser-side `userVisibleOnly: true`

We MUST pass `userVisibleOnly: true` to `pushManager.subscribe`. Required
by Chrome / Mozilla — disallows silent push (which is treated as a tracking
risk). Without it, the call rejects. Pinned in §3.5 client-side smoke.

### 4.8 Multi-device privacy

A learner with 3 devices has 3 rows. Listing them in cabinet UI reveals
device count + UA strings to the learner themselves (no cross-account
leakage). **Accepted** — operator-side observability through admin counts
only (no per-learner device list).

### 4.9 Migration ACCESS EXCLUSIVE

- New table — no locks on existing tables.
- CHECK alter on `learner_reminder_dispatches` — brief ACCESS EXCLUSIVE; table is small under retention. Same risk profile as BCS-DEF-4-TG §4.7.

---

## 5. Decomposition — single-PR epic

Single PR. Files:

```
docs/plans/bcs-def-4-push-pwa-reminders.md              (NEW, this file)
migrations/0066_learner_push_subscriptions.sql          (NEW — see §2.11 ordering caveat)
migrations/0067_learner_reminder_dispatches_push_channel.sql  (NEW)
package.json                                            (modified — add web-push dep)
package-lock.json                                       (modified)
public/manifest.webmanifest                             (NEW)
public/sw.js                                            (NEW)
app/layout.tsx                                          (modified — manifest link + sw registration script)
lib/admin/operator-settings.ts                          (modified — 1 new key)
scripts/lib/operator-settings.mjs                       (mirror)
scripts/learner-reminder-dispatch.mjs                   (modified — per-channel push branch)
lib/notifications/push-templates.ts                     (NEW)
lib/notifications/web-push-wrapper.ts                   (NEW — thin web-push wrapper)
app/api/push/subscribe/route.ts                         (NEW)
app/api/push/unsubscribe/route.ts                       (NEW)
app/api/push/vapid-public-key/route.ts                  (NEW)
app/cabinet/settings/reminders/page.tsx                 (modified — Push section)
app/cabinet/settings/reminders/push-subscribe-button.tsx (NEW client component)
app/admin/(gated)/settings/reminders/page.tsx           (modified — Push row)
tests/notifications/learner-reminder-push.test.ts       (NEW)
tests/notifications/web-push-wrapper.test.ts            (NEW)
tests/integration/api/push-vapid-public-key.test.ts     (NEW)
tests/integration/api/push-subscribe.test.ts            (NEW)
tests/integration/api/push-unsubscribe.test.ts          (NEW)
tests/integration/scripts/learner-reminder-dispatch-push.test.ts (NEW)
tests/integration/cabinet/reminder-push-section.test.ts (NEW)
tests/integration/admin/reminders-push-row.test.ts      (NEW)
tests/integration/admin/learner-push-migrations.test.ts (NEW)
tests/public/sw.test.ts                                 (NEW — if jsdom supports)
tests/admin/operator-settings.test.ts                   (modified)
ENGINEERING_BACKLOG.md                                  (modified — strikethrough BCS-DEF-4-PUSH)
docs/plans/bcs-def-4-learner-reminders.md               (modified — §10 cross-ref)
ARCHITECTURE.md                                         (modified — PWA + push channel section)
```

**Estimated diff:** ~1500 LOC.

**Why single PR, not split:**
- New runtime dep `web-push` couples to the dispatcher branch. Splitting deps from consumer creates a half-functional state.
- Service worker + manifest + cabinet button are all required for any single subscribe to work end-to-end.
- `LEARNER_PUSH_ENABLED=0` default keeps channel dormant post-merge.

**Critical-path:** `lib/admin/operator-settings.ts` + `app/layout.tsx` are
critical-path. Trailer carries `Codex-Paranoia: SIGN-OFF round N/3` (one-PR
epic; plan + wave collapsed).

---

## 6. Risks + mitigations

### RISK-1 — `web-push` library audit surface

Adding a new runtime dep with ~10 transitive deps. **Mitigation**: pin exact
version; audit transitives at impl time; verify Node 22 compat (lib's stable
since Node 14); rely on the CSO security audit skill on next monthly cycle.

### RISK-2 — VAPID key rotation downtime

Operator rotates keys → ALL subscriptions invalidate; all learners must
re-subscribe. **Mitigation**: documented in runbook; rotation is a rare
event (compromise-only); operator can pre-warn learners via in-app banner
(out of scope MVP).

### RISK-3 — Service worker stuck on stale version

Browsers cache SW aggressively. A bug fix in `sw.js` may not propagate until
the user navigates twice. **Mitigation**: hand-rolled SW is small + simple;
the `skipWaiting()` + `clients.claim()` calls force activation immediately
on update detection. Worst case: a learner sees a slightly-stale notification
behavior for one session.

### RISK-4 — iOS Safari PWA push not supported in `display: browser`

iOS Safari (16.4+) requires the page be added to home screen (PWA mode)
for push permission to be available. With our `display: browser` manifest,
iOS push is effectively non-functional. **Decision**: out of scope MVP;
cabinet UI shows "Push не поддерживаются на этом устройстве" for iOS users
(detected via UA + `Notification` undefined). Documented as BCS-DEF-4-PUSH-IOS.

### RISK-5 — `Notification.permission === 'denied'` is sticky

If a learner denies once, the browser caches that decision; we cannot
re-prompt. **Mitigation**: cabinet UI shows clear instructions to unblock
in browser settings. No re-prompt loop.

### RISK-6 — Endpoint privacy in DB dumps

`learner_push_subscriptions.endpoint` columns in a leaked DB dump could be
abused (with VAPID key compromise) to spam users. **Mitigation**: §4.2 +
the existing encrypt-at-rest policy + tight VAPID private-key controls.

### RISK-7 — Notification flood (3 reminders × N devices = 3N pings)

A learner with 3 devices gets 9 notifications per slot (3 offsets × 3 devices).
Some learners will find this annoying. **Mitigation**: cabinet UI lets them
unsubscribe per-device. Also, the default offsets (60/30/10) are 3 distinct
notification moments — per-device, that's 3 timestamps, not 9. Per-device
×3-offsets is the expected behavior.

### RISK-8 — Mass-unsubscribe on VAPID misconfig

If VAPID keys change accidentally (bad env reload), `web-push.sendNotification`
returns 401 from the push service. **Decision**: 401 / 403 from push services
is NOT auto-unsubscribe — only 410 / 404. Transient-treat 401/403 as retry-able
(attempts++); operator notices via admin UI "Recent failures" count spike.

### RISK-9 — Migration ordinal collision with BCS-DEF-4-TG

Both plans propose adjacent migration numbers. **Mitigation**: §2.11 — the
plan-doc claims numbers loosely; whichever PR lands first uses 0063/0064/0065
(TG) or 0063/0064 (PUSH); the second re-bases. The CHECK ALTER uses
`drop constraint if exists` so it's idempotent. Both PRs documented as
mutually-rebasable.

### RISK-10 — Service worker registration timing in `app/layout.tsx`

Registering the SW in the root layout means EVERY page load triggers it,
including the public landing page. **Decision**: the registration script
is conditional — only fires when `navigator.serviceWorker` exists AND
when the page is `/cabinet/*` OR the user is authenticated. The
registration is deferred via a small client component
`<ServiceWorkerRegistrar>` mounted in the cabinet layout, NOT root layout.
**Revised plan**: SW registration lives in `app/cabinet/layout.tsx`, NOT
`app/layout.tsx`. Only the `<link rel="manifest">` goes in root layout
(PWA-install detection works there).

### RISK-11 — Critical-path drift on `app/layout.tsx`

Only `<link rel="manifest">` + `<meta name="theme-color">` are added to
root layout. Both are static HTML head elements; no JS, no logic, no
server-side computation. Critical-path-touched but low-risk.

---

## 7. Acceptance criteria

The PR ships when:
- Migrations apply clean on a fresh test DB.
- `npm install` resolves `web-push` cleanly.
- `npm run test:run` green.
- `npm run test:integration` green (10 new test files).
- `npm run build` green (including SW + manifest serving as static).
- Service worker accessible at `https://prod/sw.js` returning 200 + correct MIME type.
- `/codex-paranoia plan` SIGN-OFF on this file (round N/3).
- `/codex-paranoia wave` SIGN-OFF on the implementation diff (round N/3).
- PR commit body trailer:
  ```
  Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
  Critical-Path-Touched: lib/admin/operator-settings.ts, app/layout.tsx
  Skill-Used: /codex-paranoia plan + /codex-paranoia wave
  ```
- ENGINEERING_BACKLOG.md strikethrough BCS-DEF-4-PUSH.

Post-merge (operator-side activation):
- Operator generates VAPID keypair via `npx web-push generate-vapid-keys`.
- Operator writes env-file `/etc/levelchannel/env.d/push.env`.
- Operator restarts Next.js.
- Operator flips `LEARNER_PUSH_ENABLED=1` at `/admin/settings/reminders`.
- Operator self-subscribes from a test browser; books a slot; confirms
  notification delivery within the next 1-min scheduler tick.

---

## 8. Migration / rollout

1. PR opens.
2. CI runs migrations against test DB → green.
3. PR merges (squash) to main.
4. Autodeploy timer picks up the commit; Next.js restarts.
5. `LEARNER_PUSH_ENABLED=0` → channel dormant; `/api/push/vapid-public-key` returns 503; cabinet section hidden.
6. Operator runs `npx web-push generate-vapid-keys`; writes env-file; restarts Next.js to pick up env.
7. Operator flips master switch.
8. Reconcile-enqueue begins emitting `channel='push'` rows for learners with active subscriptions (initially zero).

**No ordering hazard.** Migrations additive. Dormant until master switch +
VAPID env set.

**First-tick safety**: no learners have subscriptions at activation; first
push enqueue happens after first learner subscribes. Then on next tick,
reminder is enqueued + dispatched. Operator can watch admin "Active
subscriptions count" rise as learners opt in.

---

## 9. Pre-canned answers for paranoia round 2

**Q1.** Why hand-roll SW instead of `next-pwa`? **A:** §2.5 — minimal scope
+ no build-pipeline coupling. Easier audit.

**Q2.** Why store endpoint as text, not hash? **A:** We need the original
URL for `web-push.sendNotification`; can't hash + recover. Encrypt-at-rest
column-level deferred to BCS-DEF-4-PUSH-COLENC.

**Q3.** Why no Firebase / OneSignal? **A:** Out of scope — managed-service
detour. Self-hosted Web Push with `web-push` lib is industry standard.

**Q4.** What about iOS push? **A:** §RISK-4 — requires PWA `display: standalone`;
out of scope MVP.

**Q5.** Multi-device per learner OK? **A:** Yes (§2.3). Fan-out at send-time.

**Q6.** Notification flood (3 offsets × N devices)? **A:** §RISK-7 — expected;
per-device unsub available.

**Q7.** What if `web-push` upgrades introduce breaking change? **A:** Pin
exact version; integration test catches at upgrade time.

**Q8.** VAPID public key cacheable? **A:** Yes — `Cache-Control: public, max-age=300`
(§2.4 `/api/push/vapid-public-key`).

**Q9.** Service worker fetch handler? **A:** Explicitly NONE (§4.6); pinned
by regression test.

**Q10.** Why one queue row per (slot, offset, channel='push') for multi-device
fan-out instead of per-device row? **A:** §2.7 — keeps queue volume bounded
(N learners × 3 offsets, NOT N learners × 3 offsets × 3 devices). Send-time
fan-out is in-process; observability deferred to BCS-DEF-4-PUSH-PERDEVICE-OBS.

---

## 10. Out of scope — deferred follow-ups

- **BCS-DEF-5-PUSH** — Teacher push reminders. Sibling plan; mirrors with
  `teacher_push_subscriptions` + parallel cabinet-teacher UI.
- **BCS-DEF-4-TG** — Telegram channel (sibling plan, open in parallel as PR #347).
- **BCS-DEF-4-PUSH-IOS** — Full PWA install flow (`display: standalone` +
  iOS-specific install instructions banner) for iOS Safari push support.
- **BCS-DEF-4-PUSH-RICH** — Rich notifications (image attachments,
  action buttons "Mark seen" / "Snooze 5 min"). Requires extending payload
  shape + SW notification-click router.
- **BCS-DEF-4-PUSH-E2E** — Playwright end-to-end test of the full subscribe
  → notify → click flow in a real browser. Out of scope MVP (jsdom +
  integration tests cover the seams).
- **BCS-DEF-4-PUSH-PERDEVICE-OBS** — Per-device send-status visibility in
  admin / cabinet (current MVP aggregates at queue-row level).
- **BCS-DEF-4-PUSH-COLENC** — Column-level encryption of
  `learner_push_subscriptions.endpoint`. Reduces DB-dump leak blast.
- **BCS-DEF-4-PUSH-OFFLINE** — Service worker offline caching for /cabinet.
  Different feature; would require build-pipeline integration.
- **Localization across non-Russian browsers** — out of scope here.

---

## 11. Final trailer expectations

```
Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
Critical-Path-Touched: lib/admin/operator-settings.ts, app/layout.tsx
Skill-Used: /codex-paranoia plan + /codex-paranoia wave
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

— END OF DRAFT (awaiting `/codex-paranoia plan`) —
