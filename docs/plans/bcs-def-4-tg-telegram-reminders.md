# BCS-DEF-4-TG — Telegram channel for learner lesson-start reminders

**Status:** DRAFT 2026-05-18 (plan-doc only; awaiting `/codex-paranoia plan`).
**Wave name:** `bcs-def-4-tg-telegram-reminders` (single-PR epic — see §5).
**Trigger:** Telegram channel deferred from BCS-DEF-4 MVP
(`docs/plans/bcs-def-4-learner-reminders.md:7` "MVP = email only"; §10 "BCS-DEF-4-TG
— Telegram channel. Needs bot setup + per-account chat_id linkage + admin
surface. Mirror BCS-DEF-1-TG precedent.").
**Author:** Claude (autonomous).
**Channel:** Telegram — adds a second `channel` value to the unified scheduler.

---

## 0. Cross-refs

- **`docs/plans/bcs-def-4-learner-reminders.md`** — parent plan (merged via PR #333).
  §2.2 reserves `learner_reminder_dispatches.channel` for expansion to
  `'telegram'` / `'push'`. §10 explicitly defers Telegram to THIS plan.
- **`docs/plans/bcs-def-1-tg-telegram-alerts.md`** — operator-side single-chat
  Telegram precedent (merged via PR #339). REUSES: BotFather runbook (§2.1),
  env-contract soft-skip shape (§2.2), `sendTelegramMessage` helper at
  `scripts/lib/telegram-alerts.mjs`, `TELEGRAM_BOT_TOKEN` env var. DOES NOT
  REUSE: `ALERT_TELEGRAM_CHAT_ID` (operator-only single id) — this plan
  introduces per-learner chat-id linkage.
- **`docs/plans/admin-ux-coverage.md §3.4 / §5.4`** — closed at the parent plan;
  this PR extends `/admin/settings/reminders` with a Telegram master switch row.

---

## 1. Goal

Add Telegram as a delivery channel for the unified learner-reminder scheduler
shipped in BCS-DEF-4. When a learner has opted-in AND a Telegram chat-id has
been bound to their account, the scheduler dispatches each due reminder via
**both email AND Telegram** (independent send paths; per-channel queue rows).

**Hard requirements:**
- Each learner has their own Telegram `chat_id`; we never share one chat-id
  across learners. Discovered via a binding flow initiated by the learner.
- Idempotent per `(slot_id, offset_minutes, channel)` — same UNIQUE precedent
  from `migrations/0061_learner_reminder_dispatches.sql` (BCS-DEF-4 §2.2)
  with `channel='telegram'` slotting in via the existing CHECK extension.
- Operator master switch `LEARNER_TELEGRAM_ENABLED` (OFF by default) — channel
  dormant until BotFather setup completes + operator flips switch.
- Soft-skip on missing chat-id: if a learner has no binding row, the Telegram
  dispatch row is created with `status='skipped'` + `skipped_reason='no_telegram_binding'`;
  the email path is unaffected.
- Unbind on `/stop` from the bot OR on Telegram returning 403 "bot blocked";
  binding row marked unsubscribed; future dispatches skip with reason.

**Out of scope explicitly:** see §10.

---

## 1.1 Existing surface inventory

Cited against `main` HEAD as of 2026-05-18.

### Parent surface (BCS-DEF-4)

- **`migrations/0061_learner_reminder_dispatches.sql`** — the dispatch queue table
  (per BCS-DEF-4 §2.2). `channel text not null check (channel in ('email'))`
  — this plan extends the CHECK to `'telegram'`. Idempotency index
  `lrd_slot_offset_channel_unique on (slot_id, offset_minutes, channel)`
  remains unchanged — `channel='telegram'` is a new row dimension, NOT a
  conflict with existing `channel='email'` rows.
- **`migrations/0059_learner_reminder_preferences.sql`** — per-learner offset
  list + email opt-in. This plan does NOT add a `telegram_opt_in` column;
  binding existence (`learner_telegram_subscriptions` row with
  `unsubscribed_at IS NULL`) acts as implicit opt-in. Rationale §2.4.
- **`scripts/learner-reminder-dispatch.mjs`** — the scheduler tick. §2.4 of
  the parent plan describes the per-channel iteration; this plan adds a
  Telegram dispatch branch parallel to the email send branch in step 5b.
- **`lib/admin/operator-settings.ts`** — `SETTING_SCHEMA` + `ProbeName` +
  `SettingScope` (the `| 'telegram'` widening that BCS-DEF-1-TG added).
  This plan adds 1 NEW key `LEARNER_TELEGRAM_ENABLED` with
  `scope: 'learner-reminders'` (NOT `scope: 'telegram'` — that scope is
  reserved for operator-side channel-wide knobs; this is a learner-channel
  feature flag).
- **`app/admin/(gated)/settings/reminders/page.tsx`** — the admin page shipped
  in BCS-DEF-4 Sub-PR C. This plan adds a "Telegram канал" row with the
  master switch + bot-presence indicator + recent binding-events log.
- **`app/cabinet/settings/reminders/page.tsx`** — the learner cabinet page
  shipped in BCS-DEF-4 Sub-PR D. This plan adds a "Telegram-напоминания"
  section: shows binding status + one-time code generator + `/stop` hint.

### Sibling surface (BCS-DEF-1-TG)

- **`scripts/lib/telegram-alerts.mjs`** — `sendTelegramMessage({botToken, chatId, text, retryMax})`.
  REUSE AS-IS. No fork — both operator alerts AND learner reminders flow
  through the same helper. Retry semantics + 5xx/4xx classification unchanged.
- **`TELEGRAM_BOT_TOKEN`** env var — REUSE. Single bot per VPS; operator
  alerts and learner reminders are messages from the SAME bot. Rationale
  §2.2.
- **BotFather runbook** (`docs/plans/bcs-def-1-tg-telegram-alerts.md §2.1`) —
  the steps 1-4 (create bot, capture token, write env-file) are unchanged.
  Steps 5-6 (operator self-chat-id + master switch) are replaced by §2.1
  here (webhook URL registration via `setWebhook`).

### Webhook surface (NEW)

- NO existing `/api/telegram/*` route. This plan adds **`POST /api/telegram/webhook`**
  as the first such route. Auth via Telegram's `X-Telegram-Bot-Api-Secret-Token`
  header (set when we `setWebhook` with `secret_token`).
- Cross-ref to LevelChannel's existing webhook precedent
  (`app/api/cloudpayments/webhook/route.ts`) — HMAC-verified body + idempotent
  by event-id pattern. Telegram's pattern is simpler (secret-token header
  match) but the route structure mirrors.

---

## 1.2 Critical-path inventory

Per `docs/critical-path.md`:
- **`lib/admin/operator-settings.ts`** — on critical path. This plan adds 1
  key (additive). Same paranoia profile as BCS-DEF-4 Sub-PR A.
- **`scripts/learner-reminder-dispatch.mjs`** — NOT on critical path (it's a
  cron). This plan extends the per-channel switch in step 5b.
- **`app/api/telegram/webhook/route.ts`** — NEW; not on critical path until
  it grows; documented in `docs/critical-path.md` cross-ref note.

---

## 2. Design

### 2.1 Bot setup (operator runbook)

The bot already exists from BCS-DEF-1-TG. This plan only adds **webhook
registration** for receiving learner `/start` updates.

1. **Verify bot exists.** `TELEGRAM_BOT_TOKEN` is already in
   `/etc/levelchannel/env.d/telegram-alerts.env` (mode 0640 root:levelchannel).
2. **Generate webhook secret token.** Random 256-bit hex:
   `openssl rand -hex 32`. Write to env-file:
   ```
   TELEGRAM_WEBHOOK_SECRET_TOKEN=<hex>
   ```
3. **Register webhook** (operator runs this once on prod activation; idempotent):
   ```
   curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://levelchannel.ru/api/telegram/webhook",
       "secret_token": "'"${TELEGRAM_WEBHOOK_SECRET_TOKEN}"'",
       "allowed_updates": ["message"]
     }'
   ```
   Telegram verifies HTTPS + valid cert. LevelChannel's existing Let's Encrypt
   cert covers this.
4. **Set bot description** (one-off, via BotFather `/setdescription`):
   ```
   Бот LevelChannel для напоминаний о занятиях.
   Чтобы подписаться, получите код в личном кабинете на levelchannel.ru
   → «Настройки» → «Напоминания» → «Telegram» → «Привязать».
   Отправьте сюда команду /start <код>.
   Чтобы отписаться: /stop.
   ```
5. **Flip operator master switch** at `/admin/settings/reminders` (`LEARNER_TELEGRAM_ENABLED=1`).
6. **Smoke test:** operator binds their own account, books a test slot, observes
   Telegram delivery within the next 1-min scheduler tick.

Full runbook lives inline in this plan + cross-referenced from `docs/operations.private.md`
(operator-side, out of public-repo scope, parity with BCS-DEF-1-TG §2.1).

### 2.2 Env contract — soft-skip, not boot-fail

Mirrors BCS-DEF-1-TG §2.2 shape. Three vars:

```js
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
const TELEGRAM_WEBHOOK_SECRET_TOKEN = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim() || ''
// No per-learner chat-id env — chat-ids live in learner_telegram_subscriptions.
```

**Soft-skip semantics:**
- `LEARNER_TELEGRAM_ENABLED=0` (default) → scheduler skips the entire Telegram
  branch; no rows enqueued with `channel='telegram'`; webhook route returns
  503 "telegram channel disabled" (keeps spam off the route).
- `LEARNER_TELEGRAM_ENABLED=1` AND `TELEGRAM_BOT_TOKEN` empty → scheduler
  records `verdict_kind='config_missing'` per probe-tick (same shape as
  BCS-DEF-1-TG `recipient_kind='telegram'` rows); email path unaffected.
- `LEARNER_TELEGRAM_ENABLED=1` AND `TELEGRAM_WEBHOOK_SECRET_TOKEN` empty →
  webhook route returns 503; no new bindings accepted; existing bindings
  continue to receive reminders. Rationale: don't break in-flight reminders
  if operator forgets the secret-token env var.

### 2.3 Per-learner chat-id binding — `learner_telegram_subscriptions`

**The central design challenge: how does a learner's `accounts.id` get mapped
to a Telegram `chat_id`?** Three options considered:

| Option | Pros | Cons |
|---|---|---|
| **A. Learner pastes their chat-id into /cabinet** — they get the chat-id from `@userinfobot` or similar and enter it manually. | Zero webhook surface. | Fragile UX (third-party bot dependency). Trust boundary — we'd need to verify the chat-id actually belongs to them (it doesn't by default; a malicious learner could enter another learner's chat-id and reroute their reminders). |
| **B. One-time code binding via webhook (chosen).** Learner clicks "Bind Telegram" in /cabinet → server generates a one-time code (8-char alphanumeric, TTL 10 min, single-use) → learner sends `/start <code>` to the bot → webhook verifies code, writes binding row. | Server-controlled trust boundary. Symmetric to email-verification flow (`migrations/0010_account_email_verifications.sql` precedent). Chat-id is whatever Telegram tells us it is — no spoofing window. | One extra table (`learner_telegram_bind_codes`) + bot must run. |
| **C. Magic-link via deep-link `https://t.me/LevelChannelBot?start=<code>`** — Telegram supports auto-prefill of the `/start` payload. | Same trust as B but slicker UX. | Same backend; just adds a `tg://resolve?...` link. **CHOSEN AS LAYER ON TOP OF B** — code generation and webhook handler unchanged; cabinet page renders both the code AND the deep-link button. |

**Decision: B + C combined.** Cabinet shows the code with a "Bind via Telegram"
button that opens `https://t.me/<botUsername>?start=<code>`. Operator-known
`TELEGRAM_BOT_USERNAME` env var (NEW) is the URL component.

**New table** `learner_telegram_bind_codes`:

```sql
-- BCS-DEF-4-TG (2026-05-XX) — one-time binding codes for learner ↔ chat-id
-- linkage. Single-use; 10-min TTL; learner-scoped (one active code per learner
-- at a time — re-clicking "Bind" invalidates the previous code).
-- Plan: docs/plans/bcs-def-4-tg-telegram-reminders.md §2.3.

create table if not exists learner_telegram_bind_codes (
  code text primary key,                       -- 8 chars [A-Z0-9], no I/O/0/1 (operator-readable)
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,             -- created_at + 10 min
  consumed_at timestamptz null,                -- single-use marker
  consumed_chat_id bigint null                 -- audit: which chat consumed
);

-- One active code per learner: enforce via partial unique index over
-- the not-yet-consumed/not-yet-expired set.
create unique index if not exists ltbc_one_active_per_learner_idx
  on learner_telegram_bind_codes (account_id)
  where consumed_at is null and expires_at > now();
-- NOTE: WHERE clauses with now() are NOT immutable; partial index works
-- but planner won't auto-use the predicate. We enforce uniqueness in
-- code by deleting prior pending rows before INSERT (single-TX guarded
-- by advisory lock on account_id). Index above is BELT — code is BRACES.
```

**Note on the partial-index `now()` caveat:** Postgres treats `now()` as STABLE
not IMMUTABLE, so the partial index WHERE clause is technically a foot-gun
(rows that expired remain in the index until VACUUM). Mitigation: cabinet
"Bind" Server Action first deletes any rows for the learner with
`consumed_at IS NULL`, then inserts the new code under
`pg_advisory_xact_lock(hashtext('ltbc:' || account_id))`. Index is defence-in-depth.

**New table** `learner_telegram_subscriptions`:

```sql
-- BCS-DEF-4-TG (2026-05-XX) — bound learner ↔ chat-id pairs.
-- One row per (account_id, chat_id). Unsubscribed rows kept for audit
-- (e.g. learner /stops, rebinds, /stops again — keep the history).
-- Plan: docs/plans/bcs-def-4-tg-telegram-reminders.md §2.3.

create table if not exists learner_telegram_subscriptions (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  chat_id bigint not null,                     -- Telegram chat id (signed 64-bit)
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz null,
  unsubscribe_reason text null
    check (unsubscribe_reason is null or unsubscribe_reason in (
      'user_stop_command', 'bot_blocked_by_user', 'admin_revoked', 'rebound'
    ))
);

-- Active subscription lookup: scheduler queries by account_id for the most
-- recent un-unsubscribed row.
create index if not exists lts_active_by_account_idx
  on learner_telegram_subscriptions (account_id)
  where unsubscribed_at is null;

-- Reverse lookup: webhook handler receiving a /stop needs to find the
-- subscription by chat_id (the message's `from.id`).
create index if not exists lts_active_by_chat_idx
  on learner_telegram_subscriptions (chat_id)
  where unsubscribed_at is null;

-- One ACTIVE binding per (account, chat) pair. If a learner re-binds the
-- same chat (e.g. after /stop), we mark the prior row unsubscribed
-- (reason='rebound') and insert a new row — easier than UPDATE for audit.
create unique index if not exists lts_one_active_per_pair_idx
  on learner_telegram_subscriptions (account_id, chat_id)
  where unsubscribed_at is null;
```

**Schema decision: NOT `(account_id) primary key` on the subscriptions table.**
A learner could theoretically bind multiple chats (personal + work) — but MVP
caps to ONE active binding per learner (the existing-row check in the webhook
handler `/start` path rebinds to the new chat, marking the old `rebound`).
Multi-chat-per-learner is `BCS-DEF-4-TG-MULTI-CHAT` (§10).

### 2.4 Webhook route — `POST /api/telegram/webhook`

Single route handler. Receives all Telegram updates Telegram chose to deliver
(scoped via `allowed_updates: ['message']` in the `setWebhook` call).

**Auth:** Telegram sends `X-Telegram-Bot-Api-Secret-Token: <our-secret>` on
every update. Route compares against `TELEGRAM_WEBHOOK_SECRET_TOKEN`; mismatch
→ 401 (NOT 403 — Telegram retries on 5xx but not 4xx, so 401 ends Telegram-side
retries cleanly).

**Per-update handling** (covers the only two commands MVP supports):

```ts
// app/api/telegram/webhook/route.ts (~120 LOC)
export async function POST(req: Request) {
  // 1. Auth: header match against TELEGRAM_WEBHOOK_SECRET_TOKEN. Reject 401 on mismatch.
  // 2. Master switch: if LEARNER_TELEGRAM_ENABLED != 1 → 503 "channel disabled". Telegram retries 5xx — but we want it to back off; return 200 to skip retry, just log.
  //    DECISION: return 200 + log "ignored: channel disabled". Operator can re-enable later; we don't want a retry storm.
  // 3. Parse update JSON. Guard against malformed bodies (zod schema).
  // 4. If !update.message → 200 (other update types ignored MVP).
  // 5. Extract text + chat.id + from.id.
  // 6. Route by first token:
  //    - "/start <code>" → handleStart(code, chatId, fromId)
  //    - "/stop"         → handleStop(chatId)
  //    - "/help"         → reply text (template literal); no DB write.
  //    - anything else   → reply text "Доступные команды: /start <код>, /stop, /help"; no DB write.
  // 7. ALL handlers: catch errors, log JSON, return 200 (we own the retry
  //    semantics via our own queue — never let Telegram retry our webhook).
}
```

**`/start <code>` handler:**

```
1. Trim code; validate /^[A-Z0-9]{8}$/ (the 32-char-alphabet subset).
   On mismatch → reply "Код неверный. Получите код в личном кабинете на levelchannel.ru."
2. Begin TX. SELECT ... FROM learner_telegram_bind_codes WHERE code=$1
     AND consumed_at IS NULL AND expires_at > now() FOR UPDATE.
   On miss → reply "Код просрочен или уже использован. Получите новый."
3. UPDATE learner_telegram_bind_codes SET consumed_at=now(), consumed_chat_id=$chatId
     WHERE code=$1.
4. Check existing active binding for the same (account_id, chat_id):
     If exists → unusual but tolerated; just commit + reply "Уже привязано."
     If different active row for same account_id → UPDATE old row
       SET unsubscribed_at=now(), unsubscribe_reason='rebound'.
5. INSERT INTO learner_telegram_subscriptions (account_id, chat_id) ...
6. COMMIT.
7. Reply: "Готово. Вы будете получать напоминания о занятиях за 60/30/10 минут
   до начала. Изменить расписание: levelchannel.ru/cabinet/settings/reminders.
   Отписаться: /stop."
```

**`/stop` handler:**

```
1. UPDATE learner_telegram_subscriptions
     SET unsubscribed_at=now(), unsubscribe_reason='user_stop_command'
     WHERE chat_id=$1 AND unsubscribed_at IS NULL
   RETURNING account_id.
2. If 0 rows → reply "Нет активной подписки."
3. Else → reply "Подписка отменена. Чтобы возобновить, получите новый код в личном кабинете."
```

**Rate-limit:** `enforceRateLimit(scope='telegram-webhook', key=fromId, max=20, windowMs=60_000)`.
A misbehaving Telegram-side client / typo-storm can't DoS the route. Reuses
`lib/security/request` precedent.

### 2.5 Scheduler dispatch — Telegram branch

`scripts/learner-reminder-dispatch.mjs` is extended (§2.4 of parent plan
describes the per-row TX in step 5). The dispatch loop becomes per-channel
iteration.

**Reconcile-enqueue extension (step 3 of parent plan):** the cross-join
unnest currently produces one row per (slot, offset) for `channel='email'`.
Extension: emit BOTH channels per (slot, offset) — when
`LEARNER_TELEGRAM_ENABLED=1` AND learner has an active subscription row, the
Telegram row is enqueued too. Implementation:

```sql
-- Pseudo: replace the single-channel insert with a 2-channel cross-join.
INSERT INTO learner_reminder_dispatches (slot_id, account_id, channel, offset_minutes, due_at, send_by_at)
  SELECT s.id, s.learner_account_id, c.channel, o.offset_minutes,
         s.start_at - (o.offset_minutes * interval '1 minute'),
         s.start_at - (o.offset_minutes * interval '1 minute')
           + (lateTolerance * interval '1 minute')
  FROM lesson_slots s
  LEFT JOIN learner_reminder_preferences p ON p.account_id = s.learner_account_id
  CROSS JOIN LATERAL (
    SELECT unnest(coalesce(p.offsets_minutes, $1::integer[])) AS offset_minutes
  ) o
  CROSS JOIN LATERAL (
    SELECT unnest(
      CASE WHEN $2::bool AND EXISTS (
        SELECT 1 FROM learner_telegram_subscriptions lts
         WHERE lts.account_id = s.learner_account_id
           AND lts.unsubscribed_at IS NULL
      )
      THEN array['email', 'telegram']
      ELSE array['email']
      END::text[]
    ) AS channel
  ) c
  WHERE s.status = 'booked'
    AND s.start_at > now()
    AND (p.email_opt_in IS NULL OR p.email_opt_in = true OR c.channel != 'email')
    -- Telegram has no analogous opt-in; binding = opt-in.
  ON CONFLICT (slot_id, offset_minutes, channel) DO NOTHING;
```

Two params: `$1` = default offsets CSV, `$2` = `LEARNER_TELEGRAM_ENABLED`.

**Per-row send branch (step 5b of parent plan):** when popping a pending row,
inspect `channel`:

```
if (row.channel === 'email') {
  // existing path: sendLearnerLessonReminder(...)
} else if (row.channel === 'telegram') {
  // NEW: look up active subscription
  const sub = await pool.query(
    `SELECT chat_id FROM learner_telegram_subscriptions
       WHERE account_id = $1 AND unsubscribed_at IS NULL
       ORDER BY subscribed_at DESC LIMIT 1`,
    [row.account_id]
  )
  if (!sub.rowCount) {
    // Mid-flight unbind: skip row.
    await markSkipped(row.id, 'no_telegram_binding')
    continue
  }
  const text = buildLearnerReminderTelegram({
    offsetMinutes: row.offset_minutes,
    slot: { startAt, durationMinutes, zoomUrl, timezone, displayName },
  })
  const result = await sendTelegramMessage({
    botToken: TELEGRAM_BOT_TOKEN,
    chatId: sub.rows[0].chat_id,
    text,
    retryMax: 2,
  })
  if (result.ok) {
    await markSent(row.id, /* alert_email_id */ String(result.messageId))
  } else if (result.error.includes('403') || result.error.includes('blocked')) {
    // Auto-unsubscribe: future dispatches will skip.
    await pool.query(
      `UPDATE learner_telegram_subscriptions
         SET unsubscribed_at = now(), unsubscribe_reason = 'bot_blocked_by_user'
       WHERE chat_id = $1 AND unsubscribed_at IS NULL`,
      [sub.rows[0].chat_id]
    )
    await markSkipped(row.id, 'bot_blocked_by_user')
  } else {
    // Transient: retry next tick.
    await markRetry(row.id, result.error)
  }
}
```

**Reuse:** `sendTelegramMessage` from `scripts/lib/telegram-alerts.mjs`. No
fork. The probe-runs sink is NOT used for learner reminders — reminders track
their own queue + per-row status; observability is via the dispatch table.

### 2.5.1 CHECK extension on `learner_reminder_dispatches.channel`

Migration:

```sql
-- BCS-DEF-4-TG (2026-05-XX) — extend channel CHECK to include 'telegram'.
-- Same ALTER-CHECK idiom as migrations/0058 (probe_runs.probe_name).
-- ACCESS EXCLUSIVE on learner_reminder_dispatches; the table is small in
-- steady state (90-day retention sweep deletes sent rows; pending rows
-- only exist for booked-future-slots within 48h).
alter table learner_reminder_dispatches
  drop constraint if exists learner_reminder_dispatches_channel_check;
alter table learner_reminder_dispatches
  add constraint learner_reminder_dispatches_channel_check
  check (channel in ('email', 'telegram'));
```

**CHECK extension on `skipped_reason`:**

```sql
alter table learner_reminder_dispatches
  drop constraint if exists learner_reminder_dispatches_skipped_reason_check;
alter table learner_reminder_dispatches
  add constraint learner_reminder_dispatches_skipped_reason_check
  check (skipped_reason is null or skipped_reason in (
    'slot_no_longer_booked', 'learner_opted_out', 'email_missing',
    'past_send_by', 'channel_disabled_by_operator',
    'no_telegram_binding', 'bot_blocked_by_user'
  ));
```

### 2.6 Telegram message template

Lives at `lib/notifications/telegram-templates.ts` (NEW file — not under
`lib/email/templates/` since the channel is different). Plain text only,
≤1024 chars (same convention as BCS-DEF-1-TG §2.3 — no `parse_mode` foot-guns).

```
LevelChannel — занятие через ~60 мин

   Когда: 2026-06-01 17:00 (Asia/Yekaterinburg)
   Длительность: 60 минут
   Войти: https://meet.google.com/xxx-yyyy-zzz

Изменить расписание напоминаний:
https://levelchannel.ru/cabinet/settings/reminders

Отписаться от Telegram-напоминаний: /stop
```

Subject line is implicit (Telegram has no subject). `display_name` not included
in MVP (PII guard symmetric with operator alerts §4.5). Zoom-url line omitted
when null. **Plain text — no Markdown — no inline keyboard.**

### 2.7 Operator settings — 1 new key

Extend `lib/admin/operator-settings.ts SETTING_SCHEMA` AND
`scripts/lib/operator-settings.mjs`:

```ts
LEARNER_TELEGRAM_ENABLED: {
  kind: 'int',
  default: 0,             // OFF by default; turn on after BotFather + webhook setup
  min: 0,
  max: 1,
  envName: 'LEARNER_TELEGRAM_ENABLED',
  description: 'master switch (1=on/0=off) for learner Telegram reminders; '
    + 'requires TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET_TOKEN + '
    + 'TELEGRAM_BOT_USERNAME env vars; webhook URL must be registered '
    + 'via Telegram setWebhook (operator runbook §2.1)',
  scope: 'learner-reminders',
},
```

`TELEGRAM_BOT_USERNAME` is a NEW env var (e.g. `levelchannel_bot`) — used for
constructing the `https://t.me/<username>?start=<code>` deep-link in the
cabinet binding UI. NOT in SETTING_SCHEMA (not operator-tunable; it's a
deployment constant; lives in the same `/etc/levelchannel/env.d/telegram-alerts.env`
file alongside the existing token).

### 2.8 Cabinet UI extension — `/cabinet/settings/reminders`

NEW section "Telegram-напоминания" rendered below the existing email section
(shipped in BCS-DEF-4 Sub-PR D). UI states:

| Server state | UI |
|---|---|
| `LEARNER_TELEGRAM_ENABLED=0` | Hide the section entirely (operator hasn't enabled it). |
| Enabled + no active binding for learner | "Подключите Telegram, чтобы получать напоминания в мессенджере. [Получить код]" — button POSTs Server Action `requestTelegramBindCode`. |
| Just clicked button + got a code | Render the 8-char code prominently + "Привязать через Telegram" button (deep-link `https://t.me/<botUsername>?start=<code>`) + countdown timer "Код действует 9:47". |
| Enabled + active binding | "Telegram-напоминания включены. [Отвязать]" — button posts Server Action `unbindTelegram` which UPDATEs the subscription row + sends a `/stop`-style courtesy message via `sendTelegramMessage`. |

**Server Actions** (new file `app/cabinet/settings/reminders/telegram-actions.ts`):
- `requestTelegramBindCode()`: rate-limit 5 req/hour/account; deletes prior
  unconsumed codes for the account (under `pg_advisory_xact_lock`); generates
  new code via `crypto.randomBytes` mapped to the 32-char alphabet; returns
  `{ code, expiresAt }`. Cabinet client renders.
- `unbindTelegram()`: SELECT chat_id of the active binding, UPDATE
  `unsubscribed_at=now(), unsubscribe_reason='admin_revoked'` (semantically
  "user-initiated unbind" — reuse the enum). Fire-and-forget courtesy message.

### 2.9 Admin UI extension — `/admin/settings/reminders`

NEW row "Telegram канал" above the existing email-channel rows:

- **Master switch** — `LEARNER_TELEGRAM_ENABLED` (0/1 toggle).
- **Env presence indicators** — `TELEGRAM_BOT_TOKEN` set? `TELEGRAM_WEBHOOK_SECRET_TOKEN` set? `TELEGRAM_BOT_USERNAME` set? (booleans only; values NEVER rendered).
- **Webhook status** — last successful webhook hit timestamp (most recent row across all bindings: `max(subscribed_at)` from `learner_telegram_subscriptions`). If null + master switch on → render warning "Webhook setup may be incomplete (no incoming /start observed)".
- **Active subscriptions count** — `COUNT(*) FROM learner_telegram_subscriptions WHERE unsubscribed_at IS NULL`.
- **Recent unbinds (last 24h)** — `COUNT(*) WHERE unsubscribed_at > now() - interval '24 hours'`. Spike alarms operator attention (deferred to BCS-DEF-4-TG-ALERT, §10).

### 2.10 Migration ordering

```
0063_learner_telegram_subscriptions.sql       (NEW table)
0064_learner_telegram_bind_codes.sql          (NEW table)
0065_learner_reminder_dispatches_telegram_channel.sql  (ALTER CHECK x2)
```

All additive. 0063 + 0064 are pure-new tables (no locks on existing tables).
0065 is ACCESS EXCLUSIVE briefly on `learner_reminder_dispatches`; the table
is small (90-day retention; pending rows only span 48h forward). No
backfill — `'email'` rows remain in the existing set; `'telegram'` rows are
new inserts post-activation.

---

## 3. Tests

### 3.1 Unit — bind code generation

`tests/cabinet/telegram-bind-code.test.ts`:
- Generated code matches `/^[A-Z0-9]{8}$/` with no I/O/0/1.
- TTL is exactly 10 minutes (`expires_at - created_at`).
- Generating twice for same account: first call's row marked irrelevant /
  replaced (second call's code is the active one; advisory-lock pinned).

### 3.2 Integration — webhook auth

`tests/integration/api/telegram-webhook-auth.test.ts`:
- Missing `X-Telegram-Bot-Api-Secret-Token` → 401.
- Wrong secret token → 401.
- Correct token + master switch off → 200 + log "ignored: channel disabled".
- Malformed JSON body → 200 + log "invalid body" (Telegram does NOT retry 4xx; we return 200 to be defensive).

### 3.3 Integration — `/start <code>` flow

`tests/integration/api/telegram-webhook-start.test.ts`:
- Valid unexpired code → subscription row inserted; code row marked consumed.
- Expired code → reply "Код просрочен"; no subscription.
- Already-consumed code → reply "Код просрочен или уже использован".
- Wrong format → reply "Код неверный".
- Re-bind: existing active subscription for same account+different chat → old row marked `rebound`; new row inserted.
- Re-bind same (account, chat) → existing row preserved; no duplicate.

### 3.4 Integration — `/stop` flow

`tests/integration/api/telegram-webhook-stop.test.ts`:
- Active subscription exists → UPDATE marks unsubscribed; reply "Подписка отменена".
- No subscription → reply "Нет активной подписки".

### 3.5 Integration — scheduler dispatch

`tests/integration/scripts/learner-reminder-dispatch-telegram.test.ts`:
- `LEARNER_TELEGRAM_ENABLED=0` → no `channel='telegram'` rows enqueued; email path unchanged.
- Enabled + learner with active subscription → 2× rows per (slot, offset) (one email + one telegram); both delivered (mocked Resend + mocked `sendTelegramMessage`).
- Enabled + learner WITHOUT subscription → only `channel='email'` rows enqueued.
- Mocked Telegram 403 ("bot blocked") → subscription marked unsubscribed; row marked `skipped_reason='bot_blocked_by_user'`.
- Mocked Telegram 5xx → attempts++, status stays 'pending'; next tick retries.
- Mid-flight unbind: row already pending, learner unbinds, tick → row → `skipped_reason='no_telegram_binding'`.
- Per-channel idempotency: tick twice → same row picked exactly once via `FOR UPDATE SKIP LOCKED`.

### 3.6 Integration — cabinet UI binding

`tests/integration/cabinet/reminder-telegram-binding.test.ts`:
- GET as unauthenticated → 401 / redirect.
- GET as learner with master switch off → section hidden.
- POST `requestTelegramBindCode` → row inserted; code length 8; deep-link rendered with correct username.
- POST 6 times in 1 hour → 6th call rate-limited.
- POST `unbindTelegram` with no active sub → no-op (idempotent); ok status.
- POST `unbindTelegram` with active sub → row UPDATEd; courtesy message attempted (mocked).

### 3.7 Integration — admin UI

`tests/integration/admin/reminders-telegram-row.test.ts`:
- GET as admin → "Telegram канал" section rendered; master switch reflects DB.
- POST flip master switch → next scheduler tick sees the new value.
- Env-presence indicators reflect mocked env; **regression pin** — bot token value never in HTML.

### 3.8 Migration

`tests/integration/admin/learner-telegram-migrations.test.ts`:
- 0063 + 0064 + 0065 apply clean on fresh DB.
- Post-0065: `INSERT ... channel='telegram'` ok; `'slack'` fails CHECK.
- Existing email rows backfilled correctly (no-op since channel is unchanged).

### 3.9 Template unit

`tests/notifications/learner-reminder-telegram.test.ts`:
- Body ≤1024 chars on the worst case (long timezone, long zoom-url).
- Headline shows nominal `~N мин` (rounding rule from parent plan §2.8).
- Zoom-url line omitted when null.
- Plain text only (no `*`, `_`, `[`, `]` chars escaped — verify literal output).

---

## 4. Security analysis

### 4.1 Webhook auth boundary

Telegram's `secret_token` header is the ONLY auth boundary. Token leakage =
attacker can POST arbitrary `/start <code>` to bind themselves to anyone's
account (IF they can guess an unconsumed code). **Mitigations**:
- Token stored in `/etc/levelchannel/env.d/telegram-alerts.env` (mode 0640 root:levelchannel) — same controls as the bot token.
- 256-bit hex token (`openssl rand -hex 32`) — brute force infeasible.
- The code itself is the secondary boundary: 8-char `[A-Z0-9-IO01]` = 32^8 ≈ 1 trillion; TTL 10 min; one active per learner; attacker would need to (a) leak the secret token AND (b) brute-force a live code in 10 min.
- **Defence-in-depth**: log all incoming webhook POSTs with `from.id` + truncated body (no full token); abnormal volume alerts via the existing observability rails.

### 4.2 Chat-id spoofing

Telegram sends `message.chat.id` and `message.from.id` — these are server-side
authoritative (Telegram won't forge them). A user CANNOT impersonate another
user's chat-id via the bot API. Our binding flow trusts Telegram for this.

### 4.3 Code-replay / race

Two concurrent `/start <same-code>` from different chats: the `SELECT ... FOR UPDATE`
+ `consumed_at IS NULL` predicate serializes; first wins, second sees consumed
code → "уже использован". Verified by §3.3.

### 4.4 PII in Telegram body

§2.6 — **no learner name, no teacher email, no slot UUID** in the body.
Subject is bot-name only; the body has slot time + zoom-url + deep-link to
cabinet. Zoom-url is operator-supplied (CHECK https-only ≤512 chars per
`migrations/0056_lesson_slots_zoom_url.sql`). Regression-pinned §3.9.

### 4.5 Bot-token secrecy

Reused from BCS-DEF-1-TG §4.1 — same controls (env-file mode 0640, no client
bundle, no logging). The webhook secret token is a NEW secret with identical
controls.

### 4.6 Rate-limit / abuse

- Webhook route: 20 req/min/from-id via `enforceRateLimit` — defends against typo storms.
- Cabinet `requestTelegramBindCode` Server Action: 5 req/hour/account.
- Scheduler tick: existing `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK` caps BOTH channels together (no separate Telegram limit MVP — Telegram has its own 30-msg/s global cap which is well above our blast).

### 4.7 Migration ACCESS EXCLUSIVE

- 0063 + 0064 — new tables, no existing-table locks.
- 0065 — ACCESS EXCLUSIVE briefly on `learner_reminder_dispatches`. Table is
  small (90d retention; ~hours-of-rows on prod at MVP scale). Same risk
  profile as `migrations/0058`. Accepted.

### 4.8 GDPR / chat-id retention

`learner_telegram_subscriptions.chat_id` is PII (it's a stable Telegram-issued
id linkable to a user). On account deletion (`accounts on delete cascade`),
the subscription row cascades — chat-id removed. Unbind keeps the row for
audit but the chat-id remains until the account is deleted. **MVP accepts
this**; a full GDPR-erasure flow would null the chat-id on unbind. Tracked
in §10 as `BCS-DEF-4-TG-GDPR`.

---

## 5. Decomposition — single-PR epic

Single PR (no sub-volumes). Files:

```
docs/plans/bcs-def-4-tg-telegram-reminders.md     (NEW, this file)
migrations/0063_learner_telegram_subscriptions.sql        (NEW)
migrations/0064_learner_telegram_bind_codes.sql           (NEW)
migrations/0065_learner_reminder_dispatches_telegram_channel.sql  (NEW — CHECK extends)
lib/admin/operator-settings.ts                    (modified — 1 new key)
scripts/lib/operator-settings.mjs                 (mirror)
scripts/learner-reminder-dispatch.mjs             (modified — per-channel branch)
lib/notifications/telegram-templates.ts           (NEW)
app/api/telegram/webhook/route.ts                 (NEW)
app/cabinet/settings/reminders/page.tsx           (modified — Telegram section)
app/cabinet/settings/reminders/telegram-actions.ts (NEW Server Actions)
app/admin/(gated)/settings/reminders/page.tsx     (modified — Telegram row)
tests/cabinet/telegram-bind-code.test.ts          (NEW)
tests/integration/api/telegram-webhook-auth.test.ts        (NEW)
tests/integration/api/telegram-webhook-start.test.ts       (NEW)
tests/integration/api/telegram-webhook-stop.test.ts        (NEW)
tests/integration/scripts/learner-reminder-dispatch-telegram.test.ts  (NEW)
tests/integration/cabinet/reminder-telegram-binding.test.ts (NEW)
tests/integration/admin/reminders-telegram-row.test.ts     (NEW)
tests/integration/admin/learner-telegram-migrations.test.ts (NEW)
tests/notifications/learner-reminder-telegram.test.ts      (NEW)
tests/admin/operator-settings.test.ts             (modified — 1 new key drift pin)
ENGINEERING_BACKLOG.md                            (modified — strikethrough BCS-DEF-4-TG)
docs/plans/bcs-def-4-learner-reminders.md         (modified — §10 cross-ref)
docs/plans/bcs-def-1-tg-telegram-alerts.md        (modified — §10 cross-ref)
ARCHITECTURE.md                                   (modified — learner Telegram channel section)
```

**Estimated diff:** ~1200 LOC.

**Why single PR, not split:**
- Migration must land BEFORE webhook route writes rows. Splitting creates ordering hazard.
- `LEARNER_TELEGRAM_ENABLED=0` default keeps channel dormant post-merge; activation is operator-side.
- The webhook route + scheduler branch + binding UI are tightly coupled; reviewing each in isolation creates re-merge friction.

**Critical-path:** `lib/admin/operator-settings.ts` IS on critical path. Trailer
carries `Codex-Paranoia: SIGN-OFF round N/3` (one-PR epic; plan + wave collapsed).

---

## 6. Risks + mitigations

### RISK-1 — Webhook flood after activation

When `setWebhook` is called Telegram will deliver any queued updates immediately.
If the bot has been around (operator alerts) and learners have stumbled into
sending it `/start` over time, Telegram's queue could have hundreds of pending
updates. **Mitigation**: webhook route is rate-limited per-from-id (20/min);
unknown codes reply "неверный код" cheaply. Operator can also call
`deleteWebhook` then `setWebhook` to drop the backlog before activation.

### RISK-2 — Bot blocked / chat deleted mid-flight

Telegram returns 403 on `sendMessage`. Scheduler auto-unsubscribes on 403
(§2.5 send branch). Risk: false positive — a temporary 403 (Telegram-side
glitch) could unsubscribe a valid binding. **Decision**: accepted. The 403
codes ("Forbidden: bot was blocked by the user", "chat not found", "user is
deactivated") are documented as terminal by Telegram. Re-binding is one
button-click in /cabinet.

### RISK-3 — Code collision

8-char `[A-Z0-9-IO01]` = 32^8 ≈ 10^12 codes. Birthday-paradox at 10^6 active
codes (well above MVP scale) ≈ 0.05% collision per gen. Collision triggers
PRIMARY KEY violation → Server Action retries up to 3 times. Operationally
nil.

### RISK-4 — Webhook secret token rotation

Operator rotates the token → must call `setWebhook` again with the new
`secret_token`. Until then, Telegram POSTs with the old header; our route
rejects 401; Telegram retries 5xx but not 4xx → updates dropped. **Mitigation**:
operator runbook documents the two-step rotate (update env-file → restart
Next.js → curl `setWebhook` with new token). Brief downtime accepted.

### RISK-5 — Single bot for both operator alerts + learner reminders

Bot blocked by operator (RISK-2-equivalent) breaks BOTH channels.
**Mitigation**: operator runs ops bot in a separate chat from their main
account; learner reminders flow from the same bot but to per-learner chats.
The two paths share only the bot identity, not chat-id. A bot-token rotation
affects both, accepted.

### RISK-6 — Mass-unbind on Telegram API outage

A Telegram-side network outage returns 5xx (handled — attempts++) NOT 403.
A localized Telegram bug returning 403 spuriously could cascade-unsubscribe.
**Mitigation**: §3.5 pins behavior; manual rollback path is a single SQL
UPDATE on the subscription rows (`unsubscribe_reason='bot_blocked_by_user'`
flipped back); admin-side surface in §10 (`BCS-DEF-4-TG-RECOVERY`).

### RISK-7 — Learner expects Telegram but gets only email

The cabinet section is gated by master switch. If operator hasn't enabled,
the learner doesn't see the UI at all. If master switch is on but the
learner hasn't bound, the section shows "Подключите Telegram" — clear UX.
If bound and reminder fires only as email (transient Telegram failure) — the
learner gets the email, no confusion. **Acceptable.**

### RISK-8 — Webhook URL change (deploy URL drift)

If the prod domain changes (`levelchannel.ru` → something else), `setWebhook`
must be re-called. **Mitigation**: documented in deploy runbook; operator
action on deploy.

### RISK-9 — Reuse of `alert_email_id` column for Telegram message id

The parent plan reserved `resend_email_id text` on `learner_reminder_dispatches`.
Telegram message id is numeric. **Decision**: stringify Telegram's int and
store in the same column. Reader code treats it as opaque. Rename to
`channel_message_id` rejected (touch-everywhere). Same precedent as
BCS-DEF-1-TG §2.4.1.

---

## 7. Acceptance criteria

The PR ships when:
- Migrations 0063 + 0064 + 0065 apply clean on a fresh test DB.
- `npm run test:run` green.
- `npm run test:integration` green (10 new test files).
- `npm run build` green.
- `/codex-paranoia plan` SIGN-OFF on this file (round N/3).
- `/codex-paranoia wave` SIGN-OFF on the implementation diff (round N/3).
- PR commit body trailer:
  ```
  Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
  Critical-Path-Touched: lib/admin/operator-settings.ts
  Skill-Used: /codex-paranoia plan + /codex-paranoia wave
  ```
- ENGINEERING_BACKLOG.md strikethrough BCS-DEF-4-TG.

Post-merge (operator-side activation):
- Operator runs `setWebhook` (§2.1 step 3).
- Operator flips `LEARNER_TELEGRAM_ENABLED=1` at `/admin/settings/reminders`.
- Operator self-binds their own learner account; books a test slot; confirms
  Telegram delivery within the next 1-min scheduler tick.

---

## 8. Migration / rollout

1. PR opens.
2. CI runs 0063/0064/0065 against test DB → green.
3. PR merges (squash) to main.
4. Autodeploy timer picks up the commit; Next.js restarts.
5. `LEARNER_TELEGRAM_ENABLED=0` → channel dormant; webhook route returns 200 + log "ignored: channel disabled" for any stray Telegram POSTs.
6. Operator follows §2.1 runbook (generate webhook secret, call `setWebhook`, set `TELEGRAM_BOT_USERNAME`).
7. Operator flips master switch at `/admin/settings/reminders`.
8. Reconcile-enqueue in the next 1-min tick begins enqueueing `channel='telegram'` rows for any learners with active subscriptions (initially zero — they need to bind first).

**No ordering hazard.** Migrations are purely additive. Until master switch
flips, no Telegram rows are produced.

**First-tick safety**: when activated, the reconcile-enqueue catches up any
already-booked future slots (limited to 48h forward) for learners with
bindings. Since bindings are empty at activation, the first activation tick
produces zero Telegram sends. As learners bind one-by-one, their next-due
reminders pick up Telegram delivery.

---

## 9. Pre-canned answers for paranoia round 2

**Q1.** Why per-learner chat-id instead of broadcast channel? **A:** Privacy
+ correctness — each reminder reveals slot time + zoom-url; a broadcast channel
leaks each learner's schedule to all members.

**Q2.** Why single bot for operator alerts + learner reminders, not two bots?
**A:** Operational simplicity — one BotFather artifact, one token, one webhook
URL. The two flows share only bot-identity (the `from` user of the messages);
chat-ids partition cleanly.

**Q3.** Why `/start <code>` flow not `/start` + cabinet shows chat-id?
**A:** Trust boundary — relying on the learner to copy-paste their chat-id
correctly is fragile (and re-bindable to a different chat). The code flow
binds the chat that consumed the code, which is exactly the chat we'll send
reminders to.

**Q4.** Auto-unsubscribe on 403 too aggressive? **A:** Telegram's 403 codes
are documented as terminal (`Forbidden: bot was blocked by the user`,
`chat not found`, `user is deactivated`). Re-binding is one click. False-positive
recovery is cheap.

**Q5.** Use a job queue instead of cron? **A:** Out of scope — parent plan
§2.1 Decision picked polling cron + DB queue; this plan extends that.

**Q6.** Why no Markdown? **A:** Escape-char foot-guns per BCS-DEF-1-TG §2.3.
Reminder text is paging-utility; bold/links not required.

**Q7.** What if learner blocks bot but rebinds later? **A:** §3.3 covers
re-bind: old row marked `bot_blocked_by_user`, new row inserted (different
or same chat-id), future dispatches use the new active row.

**Q8.** What about teacher Telegram reminders? **A:** Out of scope — see
BCS-DEF-5-TG (§10).

**Q9.** Are webhook updates idempotent if Telegram retries? **A:** Yes —
`/start` is guarded by the single-use code SELECT FOR UPDATE; `/stop` is
idempotent by `WHERE unsubscribed_at IS NULL`. A duplicate retry of either is
a no-op.

**Q10.** What if the webhook route is offline (Next.js restart mid-deploy)?
**A:** Telegram retries 5xx with exponential backoff for ~24h; updates
recover after restart. If the outage exceeds the retry window, learners
re-send `/start` (operator-side runbook step).

---

## 10. Out of scope — deferred follow-ups

- **BCS-DEF-5-TG** — Teacher Telegram reminders. Sibling plan; mirrors this
  with `teacher_telegram_subscriptions` + parallel webhook route handler /
  binding flow. Out of scope here.
- **BCS-DEF-4-PUSH** — PWA push channel (sibling plan, opens in parallel).
- **BCS-DEF-4-TG-MULTI-CHAT** — One learner binding multiple chats (e.g.
  personal + work). Requires UI expansion + scheduler iteration across
  multiple active rows per account. MVP caps at 1.
- **BCS-DEF-4-TG-RICHFORMAT** — `parse_mode=MarkdownV2` with bold/links/
  inline keyboard. Visual upgrade; escape-char cost.
- **BCS-DEF-4-TG-ALERT** — Operator alert on mass unbinds (>N in 24h spike).
  Defends against RISK-6 (Telegram-side bug cascade).
- **BCS-DEF-4-TG-RECOVERY** — Admin UI button to un-revoke a subscription
  unsubscribed by `bot_blocked_by_user` (in case of false positive).
- **BCS-DEF-4-TG-GDPR** — Null the chat-id on unbind to fully erase PII (the
  binding-history row stays but chat-id column nulled).
- **Localization of Telegram body across non-Russian browsers** — out of
  scope here (whole platform is Russian-first MVP).

---

## 11. Final trailer expectations

```
Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
Critical-Path-Touched: lib/admin/operator-settings.ts
Skill-Used: /codex-paranoia plan + /codex-paranoia wave
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

— END OF DRAFT (awaiting `/codex-paranoia plan`) —
