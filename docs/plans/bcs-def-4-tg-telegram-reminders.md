# BCS-DEF-4-TG — Telegram bot-handshake for learner lesson-start reminders

**Status:** SHIPPED 2026-05-20 — PR #405 merged (`cca4aba`). Learner Telegram channel + bind handshake landed end-to-end: migration 0070 (`learner_telegram_bind_codes`), `/start` writes `accounts.learner_telegram_enabled` + `accounts.learner_telegram_chat_id` directly, `/stop` UPDATEs the same single source, dispatcher gated behind `LEARNER_REMINDERS_TELEGRAM_ENABLED` operator master switch AND-ed onto existing `telegramChannelActive` line. Webhook hard-rejects non-private chats; every Telegram-derived egress passes through `redactTelegramSecret`. Plan-doc PLAN SIGN-OFF achieved on round 9/9 (30 BLOCKERs + 17 WARNs + 6 INFOs closed) — full paranoia history retained below for audit.
**Wave name:** `bcs-def-4-tg-telegram-reminders` (single-PR epic — see §5).
**Trigger:** Telegram handshake deferred from BCS-DEF-4 parent (`docs/plans/bcs-def-4-learner-reminders.md:188` — "BCS-DEF-4-TG continues to own the bot-handshake flow + the `LEARNER_REMINDERS_TELEGRAM_ENABLED` operator master switch").
**Author:** Claude (autonomous).
**Channel:** Telegram — flips the per-learner opt-in pair shipped in BCS-DEF-4 from a dormant scheduler branch into an end-to-end live binding.

---

## 0. Paranoia closure history (2026-05-20)

The pre-round-1 draft was authored 2026-05-18 against a stale snapshot.
Parent BCS-DEF-4 merged 2026-05-19 (PR #392) with a different design than
that draft assumed.

**Round 1 — 11 BLOCKERs + 2 WARNs** (all rooted in plan/main drift; closed by realignment):

- **R1-#1** (stale migration numbering 0061/0063/0064/0065) → renumbered to **0070** (one new migration only) + dropped non-existent `0059_learner_reminder_preferences.sql` reference. See §1.1, §2.10.
- **R1-#2** (re-designs canonical `accounts` schema) → dropped proposed `learner_telegram_subscriptions` table; reuse `accounts.learner_telegram_enabled` + `accounts.learner_telegram_chat_id` shipped by migration 0065. ONE new table: `learner_telegram_bind_codes`. See §2.3.
- **R1-#3** (dual-source state divergence) → `/start` writes directly to `accounts`; `/stop` UPDATEs the same. Dispatcher reads unchanged. Single source of truth. See §2.4.
- **R1-#4** (re-architecture of shipped dispatcher) → NO dispatcher rewrite. Only ADD `LEARNER_REMINDERS_TELEGRAM_ENABLED` operator gate AND-ed onto the existing `telegramChannelActive` line (`scripts/learner-reminder-dispatch.mjs:321`). See §2.5.
- **R1-#5** (queue contract drift `(slot_id, offset_minutes, channel)`) → removed; live contract is `UNIQUE (slot_id, channel)`.
- **R1-#6** (destructive CHECK rewrite) → REMOVED. CHECKs already permit `'telegram'` + the operative `skipped_reason` values.
- **R1-#7** (UI paths drift) → cabinet uses `app/cabinet/profile/page.tsx`; admin extends `app/admin/(gated)/settings/alerts/page.tsx`. See §2.8 + §2.9.
- **R1-#8** (master switch naming) → uses `LEARNER_REMINDERS_TELEGRAM_ENABLED` everywhere.
- **R1-#9** (env-file path drift) → single `$ENV_FILE` per `scripts/activate-prod-ops.sh:65`.
- **R1-#10** (non-private chats binding flaw) → webhook hard-rejects `chat.type !== 'private'` BEFORE state writes. See §2.4 step 5.
- **R1-#11** (missing redaction boundary) → every Telegram-derived egress passes through `redactTelegramSecret`. See §4.5.
- **R1-WARN-#12** (BotFather/getUpdates coupling) → §2.1 step 5 documents post-`setWebhook` inertness.
- **R1-WARN-#13** (test plan against obsolete world) → §3 rewritten against shipped paths.

**Round 2 — 7 BLOCKERs + 4 WARNs + 1 INFO** (real correctness/safety issues, NOT drift):

- **R2-#1** (deadlock on opposite lock order between cabinet code-issue and `/start <code>`) → unified lock order on write paths that contend on bind_codes: `requestLearnerTelegramBindCode` AND `/start <code>` BOTH now FIRST acquire `pg_advisory_xact_lock(hashtext('ltbc:' || account_id::text))`, THEN touch any rows. `/stop` and dispatcher auto-unbind do NOT take the advisory lock — they touch only the `accounts` row and do not contend on bind_codes; the row-level `WHERE` predicate is sufficient. (R3-WARN-#3 wording clarification.) See §2.4 + §2.8.
- **R2-#2** (auto-unbind race: stale 403 wipes a fresh re-bind) → UPDATE now scoped to `WHERE id = $accountId AND learner_telegram_chat_id = $failedChatId` so a different chat_id present after re-bind is NOT touched. See §2.5 auto-unbind.
- **R2-#3** (auto-unbind classifier wired to wrong helper surface) → helper returns `error: 'telegram_400'` / `'telegram_403'` (status-keyed), with `detail` carrying the human description. Classifier now matches on `error === 'telegram_403'` OR `error === 'telegram_400'` with `detail` substring on `chat not found` / `user is deactivated`. See §2.5 + new helper signature reference in §1.
- **R2-#4** (retention sweep does not delete bind_code rows; account purge is anonymize-in-place not DELETE → FK cascade dead) → §2.3 retention claim corrected: cleanup is an EXPLICIT new pass in `scripts/db-retention-cleanup.mjs` deleting consumed/expired bind_code rows older than 30 days AND nulling `consumed_chat_id` on rows whose `account_id` references a purged account.
- **R2-#5** (`/start` doesn't gate on disabled/purge state) → `/start` step 3 now joins `accounts` with the same gate the dispatcher uses (`disabled_at IS NULL AND scheduled_purge_at IS NULL AND purged_at IS NULL`). Code is consumed only if the account is live; otherwise reply "Аккаунт недоступен; обратитесь в поддержку." See §2.4.
- **R2-#6** (activation runbook missed Next.js restart after `$ENV_FILE` edit) → §2.1 step 3.5 + step 4.5 added: `systemctl restart levelchannel` AFTER appending env vars AND BEFORE calling `setWebhook`. Mirrors BCS-DEF-1-TG §2.1.
- **R2-#7** (missing-secret behavior contradiction: §2.2 said 401, hard-requirements bullet said 200+log) → unified: missing `TELEGRAM_WEBHOOK_SECRET_TOKEN` → 401 unconditionally (Telegram drops 4xx; this is the safer default — webhook is effectively wedged shut until secret is set). Hard-requirements bullet updated. See §2.2.
- **R2-WARN-#8** (operator-settings does not cache; risk/test text models a non-existent stale window) → removed all "cache TTL" / "cache invalidation" language; RISK-6 retitled to reflect the real model (each scheduler tick + each webhook request reads DB fresh). See §6 RISK-6.
- **R2-WARN-#9** (dispatcher is `.mjs`; template file as `.ts` won't import) → template lives at `scripts/lib/learner-reminder-telegram-template.mjs` (NOT `lib/notifications/*.ts`), mirroring the existing `scripts/lib/learner-reminder-template.mjs` precedent. Cabinet/webhook UI text (Russian copy) stays in `app/...` colocated with components. See §2.6 + §5.
- **R2-WARN-#10** (touched-test inventory missed `tests/cabinet/profile-telegram-placeholder.test.ts`) → file listed in §5 as MODIFIED (rewrite the assertions to match the new active section; OR delete the file outright since the post-merge `/cabinet/profile` no longer renders a placeholder by default).
- **R2-WARN-#11** (§0 said "renumbered to 0070/0071" but only 0070 ships) → corrected to "renumbered to 0070" above.
- **R2-INFO-#12** (no in-repo migration-number collision; only 0070 is free) → noted.

**Round 3 — 2 BLOCKERs + 2 WARNs** (subtleties surfacing from the R2 fixes):

- **R3-#1** (`ltbc_consumed_consistency` CHECK would block the retention scrub from nulling `consumed_chat_id` after account purge) → CHECK relaxed: the "both null OR both non-null at the SAME moment" requirement was over-tight; the new shape requires "unconsumed = both null; consumed = consumed_at set, consumed_chat_id may be later NULLed by retention." See §2.3 CHECK definition.
- **R3-#2** (auto-unbind classifier regex omitted `user is deactivated`) → regex extended to `chat not found|user not found|peer_id_invalid|user is deactivated`. See §2.5.
- **R3-WARN-#3** (closure text said "/start /stop / unbind all follow advisory lock order" but only /start + cabinet code-issue actually need it) → wording clarified: only bind_code contention paths need advisory; /stop and dispatcher auto-unbind touch only `accounts` rows. See §2.4 step 4 + R2-#1 entry above.
- **R3-WARN-#4** (§4.8 stale FK-cascade language) → updated to explicitly cite the explicit retention pass in §2.3 as the authoritative cleanup mechanism.

**Outcome**: round 3/3 BLOCK by skill contract (2 BLOCKERs surfaced and were closed in-loop AFTER the codex round-3 call returned BLOCK). All 4 R3 findings are closed in the current plan state. By the strict /codex-paranoia skill semantics (BLOCK round 3 ⇒ escalate to user), the next agent step is to surface this report to the user for go/no-go before implementation. Implementation against the CURRENT plan state is safe; the BLOCK trailer is procedural, not a live correctness gap.

---

## 1. Cross-refs

- **`docs/plans/bcs-def-4-learner-reminders.md`** — parent plan (merged via PR #392 on 2026-05-19).
  - `:40` — channel stacking model.
  - `:183-184` — read-only placeholder in `/cabinet/profile`; dormant dispatcher branch.
  - `:188` — explicit supersession: **TG follow-up owns handshake + master switch only; storage columns shipped in parent.**
  - `:458` — scheduler contract reserved name `LEARNER_REMINDERS_TELEGRAM_ENABLED`.
- **`docs/plans/bcs-def-1-tg-telegram-alerts.md`** — operator-side single-chat Telegram precedent (merged via PR #339). REUSES: BotFather runbook (§2.1), `sendTelegramMessage` + `redactTelegramSecret` from `scripts/lib/telegram-alerts.mjs`, `TELEGRAM_BOT_TOKEN` env var. DOES NOT REUSE: `TELEGRAM_ALERT_CHAT_ID` (single operator chat) — this plan introduces per-learner chat-ids stored on the `accounts` row.
- **`migrations/0064_learner_reminder_dispatches.sql`** — queue table, `UNIQUE (slot_id, channel)`, `channel CHECK ('email','telegram')`, `skipped_reason` includes `'no_telegram_binding'` + `'telegram_helper_not_shipped'`.
- **`migrations/0065_accounts_learner_telegram_optin.sql`** — `accounts.learner_telegram_enabled` + `accounts.learner_telegram_chat_id` + CHECK constraints.
- **`scripts/learner-reminder-dispatch.mjs:300-321`** — `telegramChannelActive = telegramHelperShipped`. THIS plan AND-s in `LEARNER_REMINDERS_TELEGRAM_ENABLED === 1`.
- **`scripts/learner-reminder-dispatch.mjs:130-160`** — existing purge-gate (`disabled_at IS NULL AND scheduled_purge_at IS NULL AND purged_at IS NULL`) is the model for the `/start` purge-gate in §2.4.
- **`scripts/lib/telegram-alerts.mjs:282-355`** — `sendTelegramMessage` return shape; status in `error: 'telegram_400'/'telegram_403'/...`, human description in `detail`. Classifier in §2.5 reads BOTH fields.
- **`scripts/lib/telegram-alerts.mjs:184,201,213`** — helper already pre-redacts `error` + `detail` via `redactTelegramSecret`.
- **`scripts/db-retention-cleanup.mjs:160-200`** — account purge is anonymize-in-place (UPDATE not DELETE). FK cascade on bind-codes therefore does NOT fire; explicit retention pass added in this wave (§2.3 cleanup block).
- **`app/cabinet/profile/page.tsx:55-65`** — read-only placeholder shipped by parent; THIS plan replaces it with the active binding section behind master-switch gate.
- **`app/admin/(gated)/settings/alerts/page.tsx:57-72`** — existing Telegram + learner-reminders cards. THIS plan adds 1 new key to `LEARNER_REMINDER_KEYS`.
- **`tests/cabinet/profile-telegram-placeholder.test.ts:23-36`** — existing pin that asserts NO interactive Telegram surface; this wave invalidates the assertion → delete or rewrite per §3.12.
- **`lib/admin/operator-settings.ts:401-449` + `scripts/lib/operator-settings.mjs:271-389`** — these settings resolvers do NOT cache; per R2-WARN-#8.

---

## 2. Goal

Activate the dormant Telegram delivery path shipped by BCS-DEF-4 by:

1. Adding ONE new operator master switch: `LEARNER_REMINDERS_TELEGRAM_ENABLED` (default 0).
2. Adding ONE new env var: `TELEGRAM_BOT_USERNAME` (deep-link host component).
3. Adding ONE new env var: `TELEGRAM_WEBHOOK_SECRET_TOKEN` (webhook auth).
4. Adding ONE new migration `0070_learner_telegram_bind_codes.sql` — 8-char-code TTL state.
5. Adding the `POST /api/telegram/webhook` route with `/start <code>`, `/stop`, `/help` handlers.
6. Replacing the read-only Telegram placeholder in `app/cabinet/profile/page.tsx` with an active "Get code → deep-link" flow when the master switch is on.
7. Adding the `LEARNER_REMINDERS_TELEGRAM_ENABLED` row to the existing admin alerts card.

**Storage state and dispatcher behavior are unchanged** — only the bot handshake + master gate are new.

**Hard requirements:**
- One ACTIVE binding per learner. Re-binding overwrites the prior `chat_id` (kept simple per parent's "lightest fit" principle).
- Code TTL 10 minutes, single-use, 8 chars `[A-Z0-9]` (alphabet excludes `I/O/0/1` per parent's operator-readability convention).
- `/stop` from the bot resets `learner_telegram_enabled=false` + nulls `learner_telegram_chat_id` (preserving the `accounts_learner_telegram_consistency` CHECK from migration 0065).
- Auto-unbind on Telegram returning a 403 family error during a real send (`bot blocked`, `chat not found`, `user is deactivated`).
- Master switch OFF by default. Turning it ON without `TELEGRAM_BOT_USERNAME` env var present surfaces a yellow warning in the admin card; the cabinet section hides the deep-link button but still renders the raw code. Turning it ON without `TELEGRAM_WEBHOOK_SECRET_TOKEN` env var present causes the webhook to return **401 unconditionally** (Telegram drops 4xx; the channel is wedged shut until the secret is set — see §2.2 table, R2-#7).
- All Telegram-derived error strings pass through `redactTelegramSecret(text, TELEGRAM_BOT_TOKEN)` before logs / DB / JSON.
- Webhook MUST reject non-private chats before consuming the code (BLOCKER #10).

**Out of scope explicitly:** see §10.

---

## 2.1 Bot setup (operator runbook)

The bot already exists from BCS-DEF-1-TG. This plan only adds **webhook
registration** for receiving learner updates, on the SAME bot.

1. **Verify bot exists.** `TELEGRAM_BOT_TOKEN` already lives in `$ENV_FILE` (the single env-file the activator script loads — see `scripts/activate-prod-ops.sh:65`). DO NOT create a separate `telegram-alerts.env` file; that file does not exist on this VPS.
2. **Resolve bot username.** From BotFather (`/myinfo`) capture the bot's `@username` without the leading `@`; we'll call it `<botUsername>`. Append to `$ENV_FILE`:
   ```
   TELEGRAM_BOT_USERNAME=<botUsername>
   ```
3. **Generate webhook secret token.** Random 256-bit hex:
   ```
   openssl rand -hex 32
   ```
   Append to `$ENV_FILE`:
   ```
   TELEGRAM_WEBHOOK_SECRET_TOKEN=<hex>
   ```
3.5. **Restart Next.js to load the new env vars.** Without this, `setWebhook` will deliver to an already-running app instance that still has the old env snapshot, and the webhook route will 401 every Telegram POST (closes R2-#6):
   ```
   systemctl restart levelchannel
   ```
   Wait for the service to report `active (running)` via `systemctl status levelchannel | head -3`.
4. **Register webhook** (one-off; idempotent — Telegram replaces a prior URL with each call):
   ```
   curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://levelchannel.ru/api/telegram/webhook",
       "secret_token": "'"${TELEGRAM_WEBHOOK_SECRET_TOKEN}"'",
       "allowed_updates": ["message"]
     }'
   ```
   Expected `{ "ok": true, "result": true }`. The existing Let's Encrypt cert covers the URL.
5. **`getUpdates` regression note for BCS-DEF-1-TG** (closes WARN #12): after `setWebhook` succeeds, the previously-documented `getUpdates` flow from `docs/plans/bcs-def-1-tg-telegram-alerts.md:196` becomes inert (Telegram refuses `getUpdates` while a webhook is registered, returning 409). Operator-alerts `ALERT_TELEGRAM_CHAT_ID` discovery is unaffected (it's already captured + persisted in `$ENV_FILE`). Document this in §2.1 of the BCS-DEF-1-TG plan as a cross-ref edit at PR-merge time.
6. **Flip operator master switch** at `/admin/settings/alerts` (`LEARNER_REMINDERS_TELEGRAM_ENABLED=1`).
7. **Smoke test:** operator binds their own learner account via `/cabinet/profile` → `/start <code>` → confirms binding text reply → books a test slot → observes Telegram delivery on the next tick of the 1-min scheduler.

**Rotation contract** (closes WARN #12 rotation half):
- Rotating `TELEGRAM_BOT_TOKEN` is a coordination event affecting BOTH BCS-DEF-1-TG (operator alerts) AND this wave (learner reminders). Re-run step 4 immediately after rotation; existing bindings continue to receive reminders during the brief window.
- Rotating `TELEGRAM_WEBHOOK_SECRET_TOKEN` requires re-running step 4 with the new secret. Until then, Telegram POSTs with the old `secret_token` header — our route rejects 401; Telegram does NOT retry 4xx; updates drop. Operator runbook: update `$ENV_FILE` → restart Next.js → curl `setWebhook`.

---

## 2.2 Env contract — soft-skip, not boot-fail

Three vars: one already shipped, two new. The three CHECK constraints
already on `accounts` (migration 0065) PLUS the soft-skip semantics below
guard against half-configured states.

```ts
const TELEGRAM_BOT_TOKEN          = process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
const TELEGRAM_BOT_USERNAME       = process.env.TELEGRAM_BOT_USERNAME?.trim() || ''
const TELEGRAM_WEBHOOK_SECRET_TOKEN = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim() || ''
```

**Soft-skip semantics:**

| Condition | Behaviour |
|---|---|
| `LEARNER_REMINDERS_TELEGRAM_ENABLED=0` (default) | Dispatcher gate evaluates `telegramHelperShipped && LEARNER_REMINDERS_TELEGRAM_ENABLED=1` → **false** → no Telegram rows enqueued, no sends, no `(slot_id, channel)` rows allocated. Legacy direct-SQL `learner_telegram_enabled=true` is honoured ONLY when master switch is ON (Round-4-equiv WARN #5 closure: removes pre-fix doc drift that implied legacy sends continued under master-off). Webhook returns 200 + structured log "channel disabled" (Telegram never retries 2xx). Activation atomic. |
| Master ON + `TELEGRAM_BOT_TOKEN` empty | **Dispatcher pre-flight (Round-4-equiv BLOCKER #1 closure):** before enqueueing the Telegram `(slot_id, channel)` row, `dispatchTelegramReminder()` checks `process.env.TELEGRAM_BOT_TOKEN?.trim()`; on empty → write a `probe_runs` row with `verdict_kind='config_missing'` + `error_message='telegram_bot_token_unset'`, and **do NOT insert any `learner_reminder_dispatches` row for the channel='telegram' slot**. Without this gate the dispatcher would call `sendTelegramMessage('')` → helper returns `{ok:false, error:'telegram_missing_token'}` → row marked terminal `send_failed` → reminder burned until manual cleanup. Admin card surfaces red warning + the same `config_missing` row in the per-probe history. Webhook returns 200 + log. |
| Master ON + `TELEGRAM_BOT_USERNAME` empty | Cabinet deep-link button hidden; only the raw 8-char code rendered (learner can `/start <code>` manually). |
| Master ON + `TELEGRAM_WEBHOOK_SECRET_TOKEN` empty | Webhook returns **401 unconditionally** (R2-#7 unified — secret absent means we can't auth, so reject as auth failure; Telegram does NOT retry 4xx so updates drop cleanly). Existing bindings continue receiving reminders. Admin card surfaces yellow warning. |
| `chat.type !== 'private'` on incoming `/start` | Hard reject — webhook replies "Привязка работает только в личном чате с ботом." NO code consumed. NO accounts update. NO logged chat_id. (BLOCKER #10 closure.) |

---

## 2.3 New table — `learner_telegram_bind_codes`

ONLY one new table. State that needs to live elsewhere:
`learner_telegram_enabled` + `learner_telegram_chat_id` ON `accounts` (already shipped, migration 0065). This table holds nothing but the 8-char-code TTL state.

```sql
-- BCS-DEF-4-TG (2026-05-20) — one-time binding codes for the learner ↔
-- chat_id handshake. Single-use; 10-min TTL; learner-scoped (one active
-- code per learner at a time; re-clicking "Get code" invalidates prior
-- pending rows).
--
-- Plan: docs/plans/bcs-def-4-tg-telegram-reminders.md §2.3.
--
-- Storage of learner_telegram_enabled + learner_telegram_chat_id lives
-- on accounts (migration 0065). This table is purely the handshake TTL.

create table if not exists learner_telegram_bind_codes (
  code text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  consumed_chat_id bigint null
);

-- Audit lookup: "show me the binding history for account X".
create index if not exists ltbc_account_created_idx
  on learner_telegram_bind_codes (account_id, created_at desc);

-- Pending-code lookup is by primary key (code), so no further index needed.

-- Alphabet: [A-Z0-9] excluding I/O/0/1 (32 chars; operator-readable).
-- Length: 8. Keyspace: 32^8 ≈ 1.1e12. PRIMARY KEY collision is the
-- collision-detection mechanism; the Server Action retries up to 3 times.
alter table learner_telegram_bind_codes
  drop constraint if exists ltbc_code_format;
alter table learner_telegram_bind_codes
  add constraint ltbc_code_format
  check (code ~ '^[A-HJ-NP-Z2-9]{8}$');

-- Expiry sanity: expires_at always after created_at.
alter table learner_telegram_bind_codes
  drop constraint if exists ltbc_expires_after_created;
alter table learner_telegram_bind_codes
  add constraint ltbc_expires_after_created
  check (expires_at > created_at);

-- Consumption sanity: consumed_at requires consumed_chat_id at the
-- moment of consumption (R3-#1 closure: consumed_chat_id is later NULLed
-- by the retention pass when the bound account is purged, so we drop
-- the "non-null together" half of the prior CHECK and keep only the
-- "either both null OR consumed_at set" direction).
alter table learner_telegram_bind_codes
  drop constraint if exists ltbc_consumed_consistency;
alter table learner_telegram_bind_codes
  add constraint ltbc_consumed_consistency
  check (
    -- An unconsumed row has both consumed columns null.
    (consumed_at is null and consumed_chat_id is null)
    -- A consumed row has consumed_at set; consumed_chat_id may be NULL
    -- if the retention sweep later scrubbed it after the account was
    -- purged. Either value is acceptable post-consumption.
    or (consumed_at is not null)
  );

comment on table learner_telegram_bind_codes is
  'BCS-DEF-4-TG (2026-05-20): one-time codes for the learner Telegram bind '
  'handshake. The Server Action deletes prior pending rows for the same '
  'account before INSERT, under pg_advisory_xact_lock(hashtext(''ltbc:''||account_id::text)). '
  'Cleanup is an explicit new pass added in this wave to scripts/db-retention-cleanup.mjs '
  '(R2-#4 closure): DELETE rows where consumed_at <= now() - interval ''30 days'' OR '
  'expires_at <= now() - interval ''30 days''. The ON DELETE CASCADE FK on accounts(id) '
  'is functionally inert because account purge anonymizes-in-place rather than DELETEing, '
  'so the explicit retention pass is the authoritative cleanup mechanism.';
```

**Retention pass — explicit new code in `scripts/db-retention-cleanup.mjs`** (R2-#4 closure):

```js
// Phase: bind-code purge — runs alongside the existing account/audit
// passes. Idempotent; deletes ≥30-day-old consumed OR expired rows in
// a single statement.
const bcRes = await client.query(`
  DELETE FROM learner_telegram_bind_codes
   WHERE (consumed_at IS NOT NULL AND consumed_at <= now() - interval '30 days')
      OR (consumed_at IS NULL  AND expires_at  <= now() - interval '30 days')
`)
// Additionally, NULL consumed_chat_id on rows whose account was purged
// (since purge is anonymize-in-place, the FK cascade does NOT remove
// the chat_id; we must scrub it explicitly):
await client.query(`
  UPDATE learner_telegram_bind_codes
     SET consumed_chat_id = null
   WHERE consumed_chat_id IS NOT NULL
     AND account_id IN (SELECT id FROM accounts WHERE purged_at IS NOT NULL)
`)
logJson('info', 'retention.bind_codes.cleaned', {
  deleted: Number(bcRes.rowCount ?? 0),
})
```

**Why ONE table not two** (closure of BLOCKER #2 + #3):
- Parent shipped `accounts.learner_telegram_enabled` + `accounts.learner_telegram_chat_id` as the canonical subscription state.
- The dispatcher reads ONLY those columns (`scripts/learner-reminder-dispatch.mjs:141`).
- Adding `learner_telegram_subscriptions` would duplicate this state and split the source of truth — fatal for `/stop` correctness.
- The bind-codes table only stores the 8-char-code TTL — once consumed, it writes the chat_id directly into `accounts`.

---

## 2.4 Webhook route — `POST /api/telegram/webhook`

Single route handler at `app/api/telegram/webhook/route.ts`. Auth via
Telegram's `X-Telegram-Bot-Api-Secret-Token` header.

```ts
export async function POST(req: Request) {
  // 1. Auth: header match against TELEGRAM_WEBHOOK_SECRET_TOKEN.
  //    Mismatch → 401. (Telegram doesn't retry 4xx.)
  // 2. Master switch: if LEARNER_REMINDERS_TELEGRAM_ENABLED !== 1
  //    → 200 + structured log "ignored: channel disabled". DO NOT 503
  //    or 5xx (Telegram would retry).
  // 3. Parse JSON body via zod. Malformed → 200 + log "invalid body".
  // 4. If !update.message → 200 (other update types ignored MVP).
  // 5. PRIVATE-CHAT GATE (BLOCKER #10): if message.chat.type !== 'private'
  //    → reply "Привязка работает только в личном чате с ботом."
  //    NO code consumed. NO accounts write. NO chat_id logged.
  //    Return 200.
  // 6. Rate-limit (Round-8 BLOCKER #1 closure) — the in-repo
  //    `enforceRateLimit(request, scope, limit, windowMs)` keys by
  //    CLIENT IP (`lib/security/request.ts:65-72`) which for a
  //    Telegram webhook is always Telegram's own server IP. To get
  //    per-`from.id` bucketing we call the lower-level primitive
  //    `takeRateLimit(key, limit, windowMs)` (`lib/security/rate-limit.ts`)
  //    directly with a composite key:
  //    ```ts
  //    import { takeRateLimit } from '@/lib/security/rate-limit'
  //    const fromId = String(message.from.id)
  //    const rl = await takeRateLimit(`tg-webhook:${fromId}`, 20, 60_000)
  //    if (!rl.allowed) {
  //      logJson('warn', 'tg webhook rate-limited', { fromId })
  //      return new Response(null, { status: 200 })  // 2xx so TG stops retrying
  //    }
  //    ```
  //    The IP-keyed `enforceRateLimit` is NOT used here — it would
  //    rate-limit ALL Telegram-sourced webhooks together (single
  //    bucket per Telegram IP), defeating per-user fairness.
  // 7. Token-route by first whitespace token:
  //    - "/start <code>" → handleStart(code, chatId, fromId)
  //    - "/start"        → reply "Чтобы привязать аккаунт, получите код в личном кабинете на levelchannel.ru → Профиль → Telegram → Получить код. Затем отправьте сюда /start <код>."
  //    - "/stop"         → handleStop(chatId, fromId)
  //    - "/help"         → reply help template (no DB write).
  //    - anything else   → reply help template (no DB write).
  // 8. ALL handlers: catch errors, run error.message through
  //    redactTelegramSecret(msg, TELEGRAM_BOT_TOKEN) before logJson(...).
  //    Return 200 (we own retry semantics via our own queue —
  //    Telegram never retries our route).
}
```

**`/start <code>` handler** (R2-#1 + R2-#5 closures — unified lock order + purge-gate):

```
1. Trim code; upper-case; validate /^[A-HJ-NP-Z2-9]{8}$/.
   Mismatch → reply "Код неверный. Получите код в личном кабинете на
   levelchannel.ru → Профиль → Telegram." STOP.

2. PEEK at the code WITHOUT locks (we need the account_id to acquire
   the advisory lock in the canonical order):
     SELECT account_id, expires_at, consumed_at
       FROM learner_telegram_bind_codes WHERE code = $1.
   If row missing OR consumed_at IS NOT NULL OR expires_at <= now() →
   reply "Код просрочен или уже использован. Получите новый код." STOP.
   (This peek is racy — that's fine; it's purely to skip the lock cost
   on obvious misses. Real serialization happens under the lock below.)

3. BEGIN TX.

4. Acquire pg_advisory_xact_lock(hashtext('ltbc:' || $accountId::text)).
   CANONICAL LOCK ORDER FOR BIND_CODES (R2-#1): advisory FIRST, row-level
   locks AFTER. `requestLearnerTelegramBindCode` (§2.8) AND `/start`
   follow this order. (R3-WARN-#3: `/stop` and dispatcher auto-unbind
   do not contend on bind_codes; they touch only `accounts` and use the
   row-level WHERE predicate for safety — no advisory lock needed.)

5. Re-SELECT the code under the lock with FOR UPDATE, plus the account
   purge-gate joined in (R2-#5):
     SELECT b.account_id, b.expires_at, b.consumed_at,
            a.disabled_at, a.scheduled_purge_at, a.purged_at
       FROM learner_telegram_bind_codes b
       JOIN accounts a ON a.id = b.account_id
      WHERE b.code = $1
      FOR UPDATE OF b, a.
   Outcomes:
     - row missing / consumed / expired → COMMIT, reply per step 2 copy.
     - a.disabled_at / scheduled_purge_at / purged_at IS NOT NULL →
       COMMIT (write nothing). Reply: "Аккаунт недоступен; обратитесь
       в поддержку." STOP. This guarantees a code can NEVER reintroduce
       a chat_id on a purged-or-purge-scheduled account (R2-#5 closure).

6. UPDATE accounts SET
     learner_telegram_enabled = true,
     learner_telegram_chat_id = $chatId::text,
     updated_at = now()
     WHERE id = $accountId.
   (chat_id stored as text per shipped migration 0065 CHECK length ≤ 64.)

7. UPDATE learner_telegram_bind_codes SET
     consumed_at = now(), consumed_chat_id = $chatId
     WHERE code = $code.

8. COMMIT.

9. Reply: "Готово. Вы будете получать напоминание о занятии за ~N минут до начала. Изменить настройки: levelchannel.ru/cabinet/profile. Отписаться: /stop."
   (N = LEARNER_REMINDER_WINDOW_MINUTES from `resolveOperatorSettingsForProbe`; rendered as integer. Per R2-WARN-#8, this resolver does NOT cache — fresh DB read each call.)
```

**`/stop` handler:**

```
1. BEGIN TX. SELECT id, learner_telegram_enabled
     FROM accounts WHERE learner_telegram_chat_id = $chatId::text
     AND learner_telegram_enabled = true FOR UPDATE.
2. If row missing → COMMIT, reply "Нет активной подписки."
3. UPDATE accounts SET
     learner_telegram_enabled = false,
     learner_telegram_chat_id = null,
     updated_at = now()
     WHERE id = $accountId.
4. COMMIT.
5. Reply: "Подписка отменена. Чтобы возобновить, получите новый код в личном кабинете."
```

**Note on auto-unbind from dispatcher 403** (defer from §2.5): the
dispatcher already classifies Telegram errors via the helper's
`{ok:false, error}` return. THIS plan adds a post-send hook
(`scripts/learner-reminder-dispatch.mjs`) where a 403-family error
triggers the same UPDATE as `/stop` step 3 (idempotent NULL-out).
Existing `finalizeSkipped` call records `'send_failed'` with the redacted
error string; the auto-unbind is the second write under a separate
transaction (no nested-tx complications).

---

## 2.5 Dispatcher integration — minimal AND-gate

`scripts/learner-reminder-dispatch.mjs:321` currently reads:

```js
const telegramChannelActive = telegramHelperShipped
```

THIS plan changes it to:

```js
const telegramMasterSwitchOn =
  probeSettings.LEARNER_REMINDERS_TELEGRAM_ENABLED.value === 1
const telegramChannelActive = telegramHelperShipped && telegramMasterSwitchOn
```

And `probeSettings` adds `LEARNER_REMINDERS_TELEGRAM_ENABLED` to the
`resolveOperatorSettingsForProbe(pool, 'learner-reminders')` set (via
the new SETTING_SCHEMA entry in §2.7).

`capturedThresholds` + `capturedThresholdsSource` include the new key
for audit (existing pattern at `scripts/learner-reminder-dispatch.mjs:324-336`).

**Auto-unbind on terminal Telegram errors** (R2-#2 + R2-#3 closures — race-safe scoping + correct classifier surface).

The shipped `sendTelegramMessage` return shape (verified at
`scripts/lib/telegram-alerts.mjs:313-319`) is:

```ts
{ ok: false, error: 'telegram_400' | 'telegram_403' | 'telegram_429_after_retries' | ..., detail?: string }
```

The status code is in `error` (status-keyed string); the human description
from Telegram is in `detail`. The classifier must look at BOTH:

```js
function isTelegramTerminalUnbind(result) {
  if (result.ok !== false) return false
  if (result.error === 'telegram_403') return true  // bot blocked / deactivated
  if (result.error === 'telegram_400' && typeof result.detail === 'string') {
    // Telegram returns 400 for "chat not found" and related terminal
    // states. R3-#2 closure: include 'user is deactivated' (the §0
    // closure-text named this case; the original regex omitted it).
    return /chat not found|user not found|peer_id_invalid|user is deactivated/i.test(result.detail)
  }
  return false
}

// Post-send hook in scripts/learner-reminder-dispatch.mjs (~line 540).
// RACE-SAFE (R2-#2): scope the UPDATE to (id, chat_id) BOTH so a fresh
// re-bind to a different chat is NOT overwritten by a stale 403 from
// the prior chat.
if (isTelegramTerminalUnbind(tgResult)) {
  await pool.query(
    `UPDATE accounts
        SET learner_telegram_enabled = false,
            learner_telegram_chat_id = null,
            updated_at = now()
      WHERE id = $1::uuid
        AND learner_telegram_chat_id = $2::text
        AND learner_telegram_enabled = true`,
    [row.accountId, row.learnerTelegramChatId],
  )
}
```

The `tgResult.detail` string is ALREADY redacted by the helper
(`scripts/lib/telegram-alerts.mjs:184,201,213`) — no additional
redaction needed at this layer.

**No other dispatcher changes.** Queue contract (`UNIQUE (slot_id, channel)`),
lifecycle (`claimed|sent|skipped`), idempotency, retention — all unchanged.

---

## 2.6 Telegram message template

Lives at **`scripts/lib/learner-reminder-telegram-template.mjs`** (NEW
file) — NOT under `lib/notifications/`. R2-WARN-#9 closure: the dispatcher
is a standalone `.mjs` systemd script with explicit no-`@/` imports
(`scripts/learner-reminder-dispatch.mjs:42-50`); a `.ts` file in
`lib/notifications/` would not be importable. The `.mjs` placement
mirrors the existing `scripts/lib/learner-reminder-template.mjs`
(email body) precedent.

Plain text only, ≤1024 chars (well under Telegram's 4096 cap).

```
LevelChannel — занятие через ~{N} мин

Когда: {date} {hh:mm} ({timezone})
Длительность: {duration} мин
Войти: {zoomUrl}

Изменить настройки напоминаний:
https://levelchannel.ru/cabinet/profile

Отписаться от Telegram-напоминаний: /stop
```

Conventions:
- `{N}` = `window_minutes_at_dispatch` (the actual captured value from the row).
- `{zoomUrl}` line omitted entirely when null (the parent's `lesson_slots.zoom_url` is nullable; existing CHECK https-only ≤512 chars).
- No `display_name` / `teacher_email` (PII guard, symmetric with operator alerts).
- **Plain text only** — no `parse_mode`, no Markdown, no inline keyboard (per BCS-DEF-1-TG §2.3 escape-char foot-guns rationale).

---

## 2.7 Operator settings — 1 new key

Extend `lib/admin/operator-settings.ts SETTING_SCHEMA` AND
`scripts/lib/operator-settings.mjs` (mirror):

```ts
LEARNER_REMINDERS_TELEGRAM_ENABLED: {
  kind: 'int',
  default: 0,             // OFF by default; turn on after BotFather setup
  min: 0,
  max: 1,
  envName: 'LEARNER_REMINDERS_TELEGRAM_ENABLED',
  description: 'master switch (1=on/0=off) for the learner Telegram reminders bot-handshake; '
    + 'requires TELEGRAM_BOT_TOKEN + TELEGRAM_BOT_USERNAME + TELEGRAM_WEBHOOK_SECRET_TOKEN env vars; '
    + 'the webhook URL must be registered via Telegram setWebhook before flipping; '
    + 'operator runbook: docs/plans/bcs-def-4-tg-telegram-reminders.md §2.1',
  scope: 'learner-reminders',
},
```

`scope: 'learner-reminders'` matches the existing `LEARNER_REMINDERS_EMAIL_ENABLED`
key (`lib/admin/operator-settings.ts:285`), so
`resolveOperatorSettingsForProbe(pool, 'learner-reminders')` picks it up
without further wiring.

`TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET_TOKEN` are deployment
env vars, NOT operator-tunable; they live in `$ENV_FILE` alongside the
existing `TELEGRAM_BOT_TOKEN`. No SETTING_SCHEMA entries.

---

## 2.8 Cabinet UI — `/cabinet/profile` (replace placeholder)

`app/cabinet/profile/page.tsx:55-65` currently renders a read-only
placeholder ("Telegram-напоминания скоро"). THIS plan replaces the
placeholder with a 4-state component:

| Server state | UI |
|---|---|
| `LEARNER_REMINDERS_TELEGRAM_ENABLED === 0` | Keep the placeholder copy (operator hasn't activated). |
| Master on, env vars present, learner has `learner_telegram_enabled=false` | "Подключите Telegram, чтобы получать напоминания в мессенджере. [Получить код]" — button posts Server Action `requestLearnerTelegramBindCode`. |
| Just clicked button + code returned | Render the 8-char code prominently + "Привязать через Telegram" deep-link button (`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}`) + countdown "Код действует N:NN". If `TELEGRAM_BOT_USERNAME` env empty, hide the deep-link button (raw code still shown). |
| Master on, learner has `learner_telegram_enabled=true` | "Telegram-напоминания включены. [Отвязать]" — button posts Server Action `unbindLearnerTelegram`. Same NULL-out as `/stop`. Best-effort courtesy DM sent via `sendTelegramMessage` (failures swallowed; user has already disabled). |

**Server Actions** (NEW file `app/cabinet/profile/telegram-actions.ts`):

- `requestLearnerTelegramBindCode()`:
  - **Round-5 BLOCKER #1 closure (revised in round 6)** — Server Actions in this codebase do NOT use a `requireAuthenticatedAccount()` helper (it doesn't exist) NOR `requireAuthenticated(request)` (that's a route-only helper at `lib/auth/guards.ts:16-30` expecting a `Request` arg). The cabinet SSR pattern is **`await cookies() → lookupSession(token) → if !session redirect('/login')`**, mirroring `app/cabinet/profile/page.tsx:33-43` line-for-line. In Next.js 16 `cookies()` returns a `Promise<ReadonlyRequestCookies>` and MUST be awaited. Apply that pattern at every Server Action call-site:
    ```ts
    'use server'
    import { cookies } from 'next/headers'
    import { lookupSession, SESSION_COOKIE_NAME } from '@/lib/auth/sessions'
    import { redirect } from 'next/navigation'

    export async function requestLearnerTelegramBindCode() {
      const cookieStore = await cookies()
      const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
      if (!cookieValue) redirect('/login')
      const session = await lookupSession(cookieValue)
      if (!session) redirect('/login')
      const accountId = session.account.id
      // … rate-limit check (see below) + bind-code issue body
    }
    ```
  - **Round-5 BLOCKER #1 closure (cont., revised in round 6)** — Rate-limit uses `enforceAccountRateLimit(accountId, scope, max, windowMs)` from `lib/security/account-rate-limit.ts:24-46`. The helper returns `NextResponse | null` (NOT throws). The route-handler precedent at `app/api/teacher/invites/route.ts:44-50` is `const rl = await enforceAccountRateLimit(...); if (rl) return rl`. **Server Actions don't return `NextResponse`**, they return data. So the Server Action variant is:
    ```ts
    const rl = await enforceAccountRateLimit(accountId, 'cabinet-tg-bind-code', 5, 3_600_000)
    if (rl) {
      // rl is a NextResponse with status 429. The retry-after lives
      // in the `Retry-After` HEADER (string seconds), NOT the body.
      // JSON body is just `{ error: 'Too many requests. Please try
      // again later.' }`. See lib/security/account-rate-limit.ts:37-46.
      const retryAfterSeconds = Number(rl.headers.get('Retry-After')) || 3600
      return { ok: false, error: 'rate_limited' as const, retryAfterSeconds }
    }
    ```
    The caller in the cabinet page reads the `{ok:false, error:'rate_limited'}` shape and renders "Слишком частые запросы, попробуйте через час."
  - **Apply at BOTH Server Actions** — `requestLearnerTelegramBindCode()` AND `unbindLearnerTelegram()`. Each issues its own scope (`cabinet-tg-bind-code` 5/hour; `cabinet-tg-unbind` 5/hour). Round-6 BLOCKER #2 closure: previously `unbindLearnerTelegram()` was missing the rate-limit call — now wired in.
  - Begin TX.
  - **CANONICAL LOCK ORDER (R2-#1)**: advisory FIRST, row-level locks AFTER.
    - `pg_advisory_xact_lock(hashtext('ltbc:' || accountId::text))`.
    - **Purge-gate** (R2-#5 belt-and-braces): `SELECT disabled_at, scheduled_purge_at, purged_at FROM accounts WHERE id = $accountId FOR UPDATE`. If any non-null → ROLLBACK; return `{ error: 'account_unavailable' }`. Cabinet UI shows "Аккаунт недоступен; обратитесь в поддержку."
    - `DELETE FROM learner_telegram_bind_codes WHERE account_id = $1 AND consumed_at IS NULL`.
  - Generate code via `crypto.randomBytes(8)` mapped into the 32-char alphabet (loop until codes pass the format regex; entropy preserved by truncating to 8 chars).
  - INSERT into bind_codes (TTL = now() + interval '10 minutes'). On PRIMARY KEY collision retry up to 3 times (entropy makes this functionally never).
  - COMMIT.
  - Return `{ code, expiresAt }`.
- `unbindLearnerTelegram()`:
  - **Round-5 BLOCKER #1 follow-on**: Use the Server Action SSR auth pattern — `cookies() → lookupSession(token) → redirect('/login') if !session` — NOT `requireAuthenticated(request)` (that's the route-handler helper expecting a `Request` arg). Same pattern as `requestLearnerTelegramBindCode()` above.
  - Begin TX.
  - `pg_advisory_xact_lock(hashtext('ltbc:' || accountId::text))` — canonical order (R2-#1).
  - **Round-4-equiv WARN #3 closure** — RETURNING gives the POST-update row, which after the nullout would be NULL. Capture the chat_id BEFORE the UPDATE: `SELECT learner_telegram_chat_id FROM accounts WHERE id=$accountId AND learner_telegram_enabled=true FOR UPDATE` → store in `priorChatId`. Then `UPDATE accounts SET learner_telegram_enabled=false, learner_telegram_chat_id=null, updated_at=now() WHERE id=$accountId`.
  - COMMIT.
  - If `priorChatId !== null`, fire-and-forget courtesy DM via `sendTelegramMessage`. The helper already redacts `error` + `detail` (`scripts/lib/telegram-alerts.mjs:184,201,213`); any caught exception around the call site still passes through `redactTelegramSecret(err.message, TELEGRAM_BOT_TOKEN)` before `logJson(...)`.

---

## 2.9 Admin UI — `/admin/settings/alerts` (extend existing card)

**Round-5 WARN #3 closure (revised round 6 — internal contradiction fixed)** — Scope on admin observability splits as follows:

**IN SCOPE this wave** (low-cost; reuse existing primitives):
- ONE new operator-tunable setting key (`LEARNER_REMINDERS_TELEGRAM_ENABLED`) rendered through existing `SettingEditor` (`app/admin/(gated)/settings/alerts/setting-editor.tsx`).
- Env-presence indicators (`TELEGRAM_BOT_TOKEN` present / absent + `LEARNER_REMINDERS_TELEGRAM_ENABLED` value) rendered as sub-text under the new row. Just a `Boolean(env)` server-render — no new helper needed. Pinned by §3.7 test "env-presence indicators reflect mocked env state".
- Active-subscription count rendered in the same card (`SELECT count(*) FROM accounts WHERE learner_telegram_enabled=true`). Single query, no new lib code.

**DEFERRED to `BCS-DEF-4-TG-ADMIN-OBS` follow-up epic**:
- Per-probe history for `learner-reminders` (would require widening `lib/admin/probe-status.ts:16-30` `PROBE_NAMES` iteration + DB partial-index changes + UI templating).
- Rich "last run" / "last alert" cards for the learner-reminders surface (BCS-DEF-4 ships only the basic key-editor cards).

**How operators currently observe a config-missing event in this wave** (round 6 follow-up — the prior "digest_sent" reference was a teacher-digest terminology bleed-through):
- `probe_runs.verdict_kind='config_missing'` rows written by the dispatcher pre-flight (Round-5 BLOCKER #2 regression pin) are queryable via raw admin SQL or the operator runbook.
- The new admin card's env-presence indicator shows "Telegram токен задан: нет" when `TELEGRAM_BOT_TOKEN` is empty, surfacing the gate state at-a-glance.

`app/admin/(gated)/settings/alerts/page.tsx:62-72` defines
`LEARNER_REMINDER_KEYS`. THIS plan adds `LEARNER_REMINDERS_TELEGRAM_ENABLED` to that array:

```ts
const LEARNER_REMINDER_KEYS: ReadonlyArray<SettingKey> = [
  'LEARNER_REMINDERS_EMAIL_ENABLED',
  'LEARNER_REMINDER_WINDOW_MINUTES',
  'LEARNER_REMINDERS_RATE_LIMIT_PER_TICK',
  'LEARNER_REMINDERS_TELEGRAM_ENABLED', // new
]
```

The existing card row-renders one row per key (the existing pattern;
inspect `LEARNER_REMINDERS_EMAIL_ENABLED` row UI for shape). NO new card
needed.

**Env-presence indicators** rendered in a tooltip / sub-text under the
new row:
- `TELEGRAM_BOT_TOKEN`: present? (boolean, NEVER value).
- `TELEGRAM_BOT_USERNAME`: present? (boolean).
- `TELEGRAM_WEBHOOK_SECRET_TOKEN`: present? (boolean).
- Active subscriptions count: `SELECT COUNT(*) FROM accounts WHERE learner_telegram_enabled = true`.

If master switch ON but any required env var missing → red warning text
inline: "Telegram setup incomplete — see plan §2.1."

---

## 2.10 Migration ordering

ONE new migration:

```
migrations/0070_learner_telegram_bind_codes.sql       (NEW table + CHECK constraints)
```

Pure additive. No locks on existing tables. No backfill. No CHECK
extensions on `learner_reminder_dispatches` (the live CHECK already
permits `'telegram'` per migration 0064). No accounts ALTER (the live
shape already supports the canonical state per migration 0065).

---

## 3. Tests

### 3.1 Unit — bind code generation

`tests/cabinet/learner-telegram-bind-code.test.ts`:
- Generated code matches `^[A-HJ-NP-Z2-9]{8}$` (no I/O/0/1).
- TTL is exactly 10 minutes (`expires_at - created_at`).
- Generating twice for same account: first call's pending row deleted; second call's code is the active one; both rows present in INSERT-only view because deleted row is gone.

### 3.2 Integration — webhook auth + private-chat gate

`tests/integration/api/telegram-webhook-auth.test.ts`:
- Missing `X-Telegram-Bot-Api-Secret-Token` → 401.
- Wrong secret token → 401.
- Correct token + master switch off → 200 + log "ignored: channel disabled".
- Correct token + master ON + `chat.type === 'group'` → reply "только в личном чате"; NO accounts write; NO code consumed (BLOCKER #10 pin).
- Correct token + master ON + `chat.type === 'supergroup'` → same as group.
- Correct token + master ON + `chat.type === 'channel'` → same.
- Malformed JSON body → 200 + log "invalid body".

### 3.3 Integration — `/start <code>` flow

`tests/integration/api/telegram-webhook-start.test.ts`:
- Valid unexpired code + private chat + live account → accounts row UPDATEd: `learner_telegram_enabled=true`, `learner_telegram_chat_id=<chatId>`; bind_code row marked consumed.
- Expired code → reply "Код просрочен"; NO accounts write.
- Already-consumed code → reply "Код просрочен или уже использован"; NO accounts write.
- Wrong format → reply "Код неверный".
- **R2-#5 purge-gate pins**: account with `disabled_at IS NOT NULL` → reply "Аккаунт недоступен"; NO accounts write; bind_code row NOT marked consumed.
- **R2-#5 purge-gate pin**: account with `scheduled_purge_at IS NOT NULL` → same as above.
- **R2-#5 purge-gate pin**: account with `purged_at IS NOT NULL` → same as above.
- Re-bind: existing `learner_telegram_chat_id` is overwritten with the new chat_id (one binding per learner). Bind_code row consumed.
- Re-bind same (account, chat) → accounts row UPDATEd identically (idempotent).
- Concurrent `/start` with same code from two chats → first wins under `FOR UPDATE`; second sees `consumed_at IS NOT NULL` → "уже использован".
- **R2-#1 lock-order pin**: concurrent `requestLearnerTelegramBindCode` Server Action + `/start <code>` for the SAME account complete without deadlock; one wins per the canonical advisory-first ordering.

### 3.4 Integration — `/stop` flow

`tests/integration/api/telegram-webhook-stop.test.ts`:
- Active subscription exists → accounts row UPDATEd: `enabled=false, chat_id=null`; reply "Подписка отменена". CHECK `accounts_learner_telegram_consistency` not violated (since `enabled=false`).
- No subscription for chat_id → reply "Нет активной подписки".
- `/stop` from a `chat_id` that matches a DIFFERENT account → no-op (defensive: only the bound account is updated). Actually — `/stop` flow uses `WHERE learner_telegram_chat_id = $chatId AND enabled = true`, so unmatched chat_id returns 0 rows.

### 3.5 Integration — scheduler dispatch + auto-unbind

`tests/integration/scripts/learner-reminder-dispatch-telegram.test.ts`:
- Master switch off → no Telegram rows enqueued/sent even with `learner_telegram_enabled=true`.
- **Round-5 BLOCKER #2 closure — config-missing regression pin (revised round 6)**: Master switch ON + `TELEGRAM_BOT_TOKEN` env empty/missing + learner enabled + chat_id present → dispatcher pre-flight `if (!process.env.TELEGRAM_BOT_TOKEN?.trim())` fires BEFORE the `(slot_id, channel='telegram')` row is allocated. Writes ONE `probe_runs` row with `verdict_kind='config_missing'` + `error_message='telegram_bot_token_unset'`. **Assertion**: no row in `learner_reminder_dispatches` for that slot+channel='telegram'. **Assertion**: the helper `sendTelegramMessage` is NEVER called (vi.spyOn pin). This pins the round-4 closure so the bug cannot silently regress on a future refactor that moves the gate position.
- **Round-6 BLOCKER #4 closure** — DROPPED the `TELEGRAM_ALERT_CHAT_ID` case from this test. That env var is the operator-side single chat-id (`scripts/auth-flow-alert.mjs:98-99`) and has no semantics in the learner-reminders channel — the dispatcher reads per-row `row.learnerTelegramChatId` at `scripts/learner-reminder-dispatch.mjs:526-531`, NOT `process.env.TELEGRAM_ALERT_CHAT_ID`. The relevant "no chat" path (learner enabled = true but `learner_telegram_chat_id IS NULL`) is already pinned by the existing test case at this section (existing line: "Master ON + learner enabled + chat_id NULL → per-row pre-check skips silently; no claim row"). The helper itself returns `telegram_missing_chat_id` on empty chat-id arg per `scripts/lib/telegram-alerts.mjs:287-292`, but this branch is unreachable because the dispatcher pre-check on `row.learnerTelegramChatId` short-circuits first.
- Master ON + helper present + learner enabled + chat_id present → 1 row per slot with `channel='telegram'`; tgResult.ok → row marked `sent`.
- Master ON + learner enabled + chat_id NULL → per-row pre-check at `scripts/learner-reminder-dispatch.mjs:466` skips silently; no claim row (existing behavior; we DON'T change it).
- Master ON + tgResult `{ok:false, error:'telegram_403'}` → row marked `skipped` AND accounts row updated to `enabled=false, chat_id=null` (R2-#3 closure: classifier reads `error` not the human description).
- Master ON + tgResult `{ok:false, error:'telegram_400', detail:'Bad Request: chat not found'}` → row marked `skipped` AND auto-unbind fires (R2-#3 covers 400 + detail substring).
- Master ON + tgResult `{ok:false, error:'telegram_400', detail:'Bad Request: message text is empty'}` → row marked `skipped`; auto-unbind does NOT fire (terminal classifier rejects non-chat-related 400s).
- **R2-#2 race pin**: scenario A — slot X enqueued, send returns 403 for chat=111; BEFORE the auto-unbind UPDATE runs, the learner re-binds to chat=222 via /start; the auto-unbind WHERE-clause MUST NOT null out the freshly bound chat=222 (test asserts `accounts.learner_telegram_chat_id === '222'` after the race).
- Master ON + tgResult transient 5xx → row marked `skipped` per existing classifier (no helper retry change THIS wave).
- Helper exports `redactTelegramSecret` and dispatcher uses redacted error strings (regression pin: error text in `last_error` column does NOT contain the bot-token suffix).

### 3.6 Integration — cabinet UI binding

`tests/integration/cabinet/profile-telegram-binding.test.ts`:
- GET as learner with master switch off → placeholder copy rendered.
- GET as learner with master ON + no binding → "Получить код" button rendered.
- POST `requestLearnerTelegramBindCode` → code returned matches format; expiresAt 10 min ahead; bind_code row INSERTed.
- POST 6 times in 1 hour → 6th call rate-limited.
- **R2-#5 belt-and-braces pin**: POST `requestLearnerTelegramBindCode` for a learner with `scheduled_purge_at IS NOT NULL` → returns `{ error: 'account_unavailable' }`; NO bind_code row INSERTed.
- GET with master ON + active binding → "Telegram-напоминания включены" + "Отвязать" button.
- POST `unbindLearnerTelegram` with active sub → accounts row UPDATEd to disabled+NULL; courtesy DM attempted (mocked).
- POST `unbindLearnerTelegram` with no active sub → no-op; ok status.

### 3.7 Integration — admin UI

`tests/integration/admin/alerts-learner-reminders-telegram-row.test.ts`:
- GET as admin → `LEARNER_REMINDERS_TELEGRAM_ENABLED` row rendered alongside existing keys.
- POST flip master switch → next scheduler tick + next webhook call sees the new value (no operator-settings caching — each read calls `resolveOperatorSettingsForProbe(pool, ...)` fresh, hitting Postgres directly per `lib/admin/operator-settings.ts:401-449`; **Round-7 WARN #3 closure** — prior wording said "cache invalidation works" which was misleading since there's no cache to invalidate; the test pin is fresh-read DOES pick up flipped value, period).
- Env-presence indicators reflect mocked env state.
- **Round-7 WARN #2 closure** — **active-subscription count regression pin**: Seed N learners with `learner_telegram_enabled=true` + M with `false`. GET as admin → the new admin card SHOWS "Активных подписок: N" (not N+M). Pins the `SELECT count(*) WHERE learner_telegram_enabled=true` query shape. Without this pin the §2.9 IN-SCOPE active-sub-count promise could silently break.
- **Regression pin** — `TELEGRAM_BOT_TOKEN` value never appears in rendered HTML.

### 3.8 Migration

`tests/integration/migrations/learner-telegram-bind-codes-migration.test.ts`:
- Migration 0070 applies clean on a fresh DB.
- INSERT with `code = 'AAAAAAAA'` ok; INSERT with `code = 'aaaaaaaa'` fails (`ltbc_code_format` CHECK).
- INSERT with `expires_at < created_at` fails (`ltbc_expires_after_created` CHECK).
- INSERT with `consumed_at` set + `consumed_chat_id` set ok (happy path consumption).
- INSERT with `consumed_at` null + `consumed_chat_id` set fails (`ltbc_consumed_consistency` CHECK — half-consumed shape rejected).
- **UPDATE of an already-consumed row scrubbing `consumed_chat_id` to NULL is accepted** (Round-4-equiv BLOCKER #2 closure: post-purge retention sweep nulls `consumed_chat_id` after the bound account is purged; the relaxed CHECK now allows that shape — `consumed_at not null` is the only invariant after consumption).
- accounts cascade: DELETE FROM accounts WHERE id = X → bind_code rows for X are removed (ON DELETE CASCADE).

### 3.9 Template unit

`tests/notifications/learner-reminder-telegram-template.test.ts`:
- Body ≤1024 chars on the worst case (long Zoom URL near 512-char cap, long timezone string).
- Headline shows `~N мин` rendered from `window_minutes_at_dispatch`.
- Zoom-url line omitted when null.
- Plain text only — `*`, `_`, `[`, `]` chars appear literal in worst-case inputs (no Markdown escape needed; we don't set `parse_mode`).

### 3.10 Drift pin

`tests/admin/operator-settings.test.ts` — extend the existing settings
drift pin: `LEARNER_REMINDERS_TELEGRAM_ENABLED` exists in SETTING_SCHEMA
AND the `.mjs` mirror; default = 0; scope = 'learner-reminders'.

### 3.11 Integration — retention sweep (R2-#4)

`tests/integration/scripts/db-retention-cleanup-bind-codes.test.ts`:
- Consumed bind_code row aged 29 days → NOT deleted.
- Consumed bind_code row aged 31 days → deleted.
- Unconsumed bind_code row past `expires_at` by 31 days → deleted.
- Unconsumed bind_code row past `expires_at` by 5 days → NOT deleted (still within audit window).
- Bind_code row with `consumed_chat_id` set, account_id references account with `purged_at IS NOT NULL` → `consumed_chat_id` UPDATEd to NULL (audit row preserved, PII scrubbed).

### 3.12 Placeholder test update (R2-WARN-#10)

`tests/cabinet/profile-telegram-placeholder.test.ts`:
- **Option A (preferred)**: delete the file. The placeholder it pins is gone after this wave; `tests/integration/cabinet/profile-telegram-binding.test.ts` (§3.6) covers the new live behavior.
- **Option B (alternative)**: rewrite to assert `LearnerTelegramPlaceholder` component is rendered ONLY when `LEARNER_REMINDERS_TELEGRAM_ENABLED=0`, and `LearnerTelegramBindSection` is rendered when `=1`.

PR diff chooses Option A unless reviewer flags Option B during /codex-paranoia wave.

---

## 4. Security analysis

### 4.1 Webhook auth boundary

Telegram's `secret_token` header is the only auth. Token leakage = attacker
can POST `/start <code>` to bind themselves to another learner IF they can
also guess an unconsumed code (8-char `[A-HJ-NP-Z2-9]` = 32^8 ≈ 10^12 keyspace,
10-min TTL). Mitigations:
- Token in `$ENV_FILE` (mode 0640 root:levelchannel — same controls as the bot token).
- 256-bit hex secret (`openssl rand -hex 32`).
- Bind codes single-use under `SELECT ... FOR UPDATE`.
- Defence-in-depth: log incoming POSTs with `from.id` + redacted error strings only.

### 4.2 Chat-id spoofing

Telegram's `message.chat.id` and `message.from.id` are server-side
authoritative — Telegram won't forge them. Binding trusts Telegram for
this. Per BLOCKER #10, we additionally require `chat.type === 'private'`
to prevent group/channel binding.

### 4.3 Code-replay / race

Two concurrent `/start <same-code>`: the `SELECT ... FOR UPDATE` +
`consumed_at IS NULL` predicate serializes; first wins, second sees
consumed → "уже использован".

### 4.4 PII in Telegram body

Per §2.6 — no learner name, no teacher email, no slot UUID, no
account_id. Body has slot time + zoom-url + cabinet link only. Zoom-url
is operator-supplied (CHECK https-only ≤512 chars per migration 0056).

### 4.5 Bot-token / webhook-secret secrecy + redaction boundary (BLOCKER #11)

Every egress point that touches a Telegram-derived string passes through
`redactTelegramSecret(text, TELEGRAM_BOT_TOKEN)`:
- Webhook route catch-block: error.message → `redactTelegramSecret` → log.
- Dispatcher post-send `last_error` write: helper already redacts (`scripts/lib/telegram-alerts.mjs:184,201,213`); no double-redaction risk.
- Courtesy DM attempt failure in `unbindLearnerTelegram`: error.message → `redactTelegramSecret` → log.
- Test pin in §3.5 asserts no token-suffix in `last_error` column.

### 4.6 Rate-limit / abuse

- Webhook route: 20 req/min/from-id via `takeRateLimit(`tg-webhook:${fromId}`, 20, 60_000)` (NOT `enforceRateLimit` — that helper is IP-keyed; see §2.4 step 6 + Round-8 BLOCKER #1 closure).
- Cabinet `requestLearnerTelegramBindCode` Server Action: 5 req/hour/account.
- Scheduler tick: existing `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK` already caps both channels together (no separate Telegram limit).

### 4.7 Migration safety

- 0070 is pure-new table, no existing-table locks. ACCESS SHARE only on `accounts` for the FK validation phase (fast on additive FK).

### 4.8 GDPR / chat-id retention

`accounts.learner_telegram_chat_id` is the canonical PII storage. The
retention sweep (`scripts/db-retention-cleanup.mjs`) already wipes it
when `scheduled_purge_at` elapses (per migration 0065 `comment on column`).
`/stop` and `unbindLearnerTelegram` and the auto-unbind on 403 all NULL
the chat_id immediately — no GDPR-erasure follow-up needed THIS wave
(closes parent's BCS-DEF-4-TG-GDPR §10 placeholder).

`learner_telegram_bind_codes` retains `consumed_chat_id` for audit. **R3-WARN-#4 closure**: account purge is anonymize-in-place (UPDATE on `accounts` setting `purged_at`, not DELETE), so the `ON DELETE CASCADE` FK does NOT fire on purge. The explicit retention pass added in §2.3 (the `UPDATE ... SET consumed_chat_id = null WHERE account_id IN (SELECT id FROM accounts WHERE purged_at IS NOT NULL)` statement) is the authoritative cleanup mechanism for purged-account chat_ids.

---

## 5. Decomposition — single-PR epic

Single PR. Files:

```
docs/plans/bcs-def-4-tg-telegram-reminders.md            (modified, this file)
docs/plans/bcs-def-4-learner-reminders.md                (modified — strike §10 BCS-DEF-4-TG-GDPR; add §10 cross-ref to this PR; **Round-5 WARN #4 closure** — strike the "helper-shipped / direct-SQL Telegram scheduler branch" wording at lines 184 + 1140 to remove the cross-doc contradiction with this plan's new master-off semantics ("no Telegram rows/sends when master switch off"))
docs/plans/bcs-def-1-tg-telegram-alerts.md               (modified — §2.1 cross-ref the post-setWebhook `getUpdates` inert note)
migrations/0070_learner_telegram_bind_codes.sql          (NEW)
lib/admin/operator-settings.ts                           (modified — 1 new key)
scripts/lib/operator-settings.mjs                        (mirror)
scripts/learner-reminder-dispatch.mjs                    (modified — AND-gate + race-safe auto-unbind hook)
scripts/db-retention-cleanup.mjs                         (modified — R2-#4: NEW bind-code retention pass + chat_id scrub on purged accounts)
scripts/lib/learner-reminder-telegram-template.mjs       (NEW — R2-WARN-#9: .mjs not .ts; mirrors scripts/lib/learner-reminder-template.mjs precedent)
app/api/telegram/webhook/route.ts                        (NEW)
app/cabinet/profile/page.tsx                             (modified — replace placeholder with active component)
app/cabinet/profile/telegram-actions.ts                  (NEW Server Actions)
app/admin/(gated)/settings/alerts/page.tsx               (modified — extend LEARNER_REMINDER_KEYS)
tests/cabinet/learner-telegram-bind-code.test.ts                            (NEW)
tests/cabinet/profile-telegram-placeholder.test.ts                          (modified — R2-WARN-#10: rewrite assertions for active section, or delete entirely since placeholder is gone)
tests/integration/api/telegram-webhook-auth.test.ts                          (NEW)
tests/integration/api/telegram-webhook-start.test.ts                         (NEW)
tests/integration/api/telegram-webhook-stop.test.ts                          (NEW)
tests/integration/scripts/learner-reminder-dispatch-telegram.test.ts         (NEW)
tests/integration/scripts/db-retention-cleanup-bind-codes.test.ts            (NEW — R2-#4 pin)
tests/integration/cabinet/profile-telegram-binding.test.ts                   (NEW)
tests/integration/admin/alerts-learner-reminders-telegram-row.test.ts        (NEW)
tests/integration/migrations/learner-telegram-bind-codes-migration.test.ts   (NEW)
tests/notifications/learner-reminder-telegram-template.test.ts               (NEW)
tests/admin/operator-settings.test.ts                    (modified — 1 new key drift pin)
ENGINEERING_BACKLOG.md                                   (modified — strikethrough BCS-DEF-4-TG)
ARCHITECTURE.md                                          (modified — learner Telegram channel diagram updated to "ACTIVE")
```

**Estimated diff:** ~900 LOC (smaller than pre-round-1 estimate because
schema/dispatcher delta shrank — most code lives in webhook + cabinet UI).

**Why single PR, not split:**
- Migration 0070 must land before the webhook can consume codes.
- Webhook + Server Actions + cabinet UI are tightly coupled; splitting creates dead-code intermediate states.
- Master switch defaults OFF; activation is operator-side after merge — no in-flight ordering hazard.

**Critical-path:** `lib/admin/operator-settings.ts` IS on critical path (per `docs/critical-path.md`). Trailer carries `Codex-Paranoia: SIGN-OFF round N/3` (one-PR epic; plan + wave collapsed).

---

## 6. Risks + mitigations

### RISK-1 — Webhook backlog flood at activation

When `setWebhook` is called, Telegram delivers any queued updates immediately. If learners stumbled into `/start`-ing the bot before activation, hundreds of updates could land at once.
**Mitigation**: rate-limit per from-id (20/min); unknown-code replies are cheap. Operator can `deleteWebhook` then `setWebhook` to drop the backlog before activation.

### RISK-2 — Spurious 403 cascading auto-unbinds

Telegram-side glitch returning 403 on `sendMessage` could falsely cascade-unbind valid learners.
**Mitigation**: 403 strings are documented terminal (`"Forbidden: bot was blocked by the user"`, `"chat not found"`, `"user is deactivated"`). Re-binding is one button-click in `/cabinet/profile`. Section §10 carries `BCS-DEF-4-TG-RECOVERY` for an admin un-revoke surface (out of scope this wave).

### RISK-3 — Code collision

32^8 ≈ 10^12 keyspace; birthday-paradox at 10^6 active codes ≈ 0.05% per gen. Collision → PRIMARY KEY violation → Server Action retries up to 3 times. Operationally nil.

### RISK-4 — Webhook secret rotation

Until `setWebhook` is re-run with the new secret, Telegram POSTs with the old header → 401 → updates drop.
**Mitigation**: operator runbook §2.1 documents the two-step rotate.

### RISK-5 — Single bot shared with operator alerts

A token rotation affects both flows.
**Mitigation**: same runbook step for both; rotation is rare; documented.

### RISK-6 — Mid-flight master-switch flip races a webhook POST (RETITLED R2-WARN-#8)

The operator-settings readers do NOT cache (`lib/admin/operator-settings.ts:401-449`, `scripts/lib/operator-settings.mjs:271-389` — each call hits the DB). A flip propagates on the very next webhook request / scheduler tick. The "stale-window" risk I previously described does not exist.

What CAN still happen: a webhook POST and an admin flip arrive within the same millisecond. Postgres MVCC serializes naturally — the read path uses a plain `SELECT` (`lib/admin/operator-settings.ts:411`) and the admin write path takes `FOR UPDATE` (`lib/admin/operator-settings.ts:542`). The worst case is a single update processed under either the pre-flip OR post-flip value depending on whose transaction commits first; the failure mode is bounded (one update, easily corrected via cabinet UI). **Round-8 WARN #1 closure** — prior wording said "serializes via `select_for_share`" which was inaccurate; the actual mechanism is plain MVCC read vs `FOR UPDATE` on the write path. Either way the bounded-risk conclusion stands.
**Mitigation**: accepted; no code change.

### RISK-7 — Non-private chat learner mistake

Learner mistakenly sends `/start <code>` in a group with the bot. The private-chat gate (BLOCKER #10) hard-rejects without consuming the code — learner can retry in DM.

### RISK-8 — Concurrent webhook POSTs (Telegram retries on our side 5xx)

We never return 5xx (only 200 + log or 401). Telegram does NOT retry 2xx/4xx. Therefore no duplicate-handler race on our side.

---

## 7. Acceptance criteria

The PR ships when:
- Migration 0070 applies clean on a fresh test DB.
- `npm run test:run` green.
- `npm run test:integration` green (9 new test files + 1 modified drift pin).
- `npm run build` green.
- `npm run typecheck` green.
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
- Operator follows §2.1 runbook (verify token, set username, generate webhook secret, call `setWebhook`).
- Operator flips `LEARNER_REMINDERS_TELEGRAM_ENABLED=1` at `/admin/settings/alerts`.
- Operator self-binds own learner account via `/cabinet/profile`; books test slot; confirms Telegram delivery on the next scheduler tick.

---

## 8. Migration / rollout

1. PR opens.
2. CI runs migration 0070 against test DB → green.
3. PR merges (squash) to main.
4. Autodeploy timer picks up the commit; Next.js restarts.
5. `LEARNER_REMINDERS_TELEGRAM_ENABLED=0` → channel dormant (dispatcher AND-gate fails); webhook returns 200 + log "ignored: channel disabled" for any stray POSTs.
6. Operator follows §2.1 (env vars + `setWebhook`).
7. Operator flips master switch.
8. Cabinet section becomes active for learners. As learners bind, the dispatcher's per-row pre-check (existing code) sees enabled+chat_id and sends.

**No ordering hazard.** Migration is purely additive. Until master switch flips, the AND-gate keeps the dispatcher silent.

**First-tick safety**: at activation, no learners have bindings yet (all `accounts.learner_telegram_enabled = false`). The dispatcher's `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK` already caps both channels together, so the first non-zero TG tick is bounded.

---

## 9. Pre-canned answers for paranoia round 2

**Q1.** Why store `chat_id` on `accounts` instead of a separate subscriptions table?
**A:** Parent BCS-DEF-4 §1.6 REVISED locked the schema as the canonical "lightest fit" — two nullable columns on `accounts` + the consistency CHECK. The dispatcher reads only these columns. Adding a sibling table now would create a dual-source-of-truth problem (Codex round-1 BLOCKER #3). When/if we need multi-chat per learner, we promote `learner_telegram_chat_id` to a 1:N table in BCS-DEF-4-TG-MULTI-CHAT (§10).

**Q2.** Why one bot for operator alerts + learner reminders, not two bots?
**A:** Operational simplicity — one BotFather artifact, one token, one webhook URL. The two flows share only bot-identity; chat-ids partition cleanly.

**Q3.** Why `/start <code>` flow not direct chat-id entry?
**A:** Trust boundary — chat_id from a learner pasting it manually can't be verified; the code flow binds the chat that consumed the code, which is exactly the chat we'll send to.

**Q4.** Auto-unbind on 403 too aggressive?
**A:** Telegram's 403 codes are documented terminal. Re-binding is one click. False-positive recovery is cheap.

**Q5.** Use a job queue instead of cron?
**A:** Out of scope — parent §2.1 decision picked polling cron + DB queue; this plan extends that.

**Q6.** Why no Markdown?
**A:** Escape-char foot-guns per BCS-DEF-1-TG §2.3. Reminder text is paging-utility; bold/links not required.

**Q7.** What if learner blocks bot but rebinds later?
**A:** §3.3 covers re-bind: existing `chat_id` overwritten; future dispatches use the new chat. Auto-unbind from a prior 403 already set `enabled=false`, so the learner has to deliberately re-bind via cabinet.

**Q8.** What about teacher Telegram reminders?
**A:** Out of scope — see BCS-DEF-5-TG (§10).

**Q9.** Are webhook updates idempotent if Telegram retries?
**A:** Telegram only retries 5xx; we never return 5xx (200 or 401 only). `/start` is guarded by single-use code FOR UPDATE; `/stop` is idempotent by `WHERE enabled = true`. No double-processing.

**Q10.** What if the webhook route is offline (Next.js restart mid-deploy)?
**A:** Telegram retries 5xx with exponential backoff (~24h). Updates recover after restart. If outage exceeds the retry window, learners re-send `/start`.

**Q11.** Why is the master switch in operator-settings (not just an env var)?
**A:** Operator-tunable without a re-deploy. Each scheduler tick + each webhook call reads `operator_settings` fresh from DB (NO cache layer — see R2-WARN-#8 + Round-7 WARN #3 closure). Flip is effectively instant. Same precedent as `LEARNER_REMINDERS_EMAIL_ENABLED`.

**Q12.** What if `TELEGRAM_BOT_USERNAME` env var is missing but master is on?
**A:** Cabinet renders only the raw 8-char code, hides the deep-link button. Learner can still type `/start <code>` manually. Admin card shows a yellow warning.

---

## 10. Out of scope — deferred follow-ups

- **BCS-DEF-5-TG** — Teacher Telegram reminders. Sibling plan; mirrors this with the teacher digest scheduler.
- **BCS-DEF-4-PUSH** — PWA push channel.
- **BCS-DEF-4-TG-MULTI-CHAT** — One learner binding multiple chats (e.g. personal + work). Requires accounts schema promotion to 1:N. MVP caps at 1.
- **BCS-DEF-4-TG-RICHFORMAT** — `parse_mode=MarkdownV2` with bold/links/inline keyboard. Visual upgrade; escape-char cost.
- **BCS-DEF-4-TG-ALERT** — Operator alert on mass unbinds (>N in 24h spike). Defends against false 403 cascade.
- **BCS-DEF-4-TG-RECOVERY** — Admin UI button to un-revoke a subscription unsubscribed by auto-403 (false positive recovery).
- **Localization** of Telegram body across non-Russian browsers — platform is Russian-first MVP.

---

## 11. Final trailer expectations

```
Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
Critical-Path-Touched: lib/admin/operator-settings.ts
Skill-Used: /codex-paranoia plan + /codex-paranoia wave
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

— END OF DRAFT (rounds 1+2+3 closures applied; round-3 codex returned BLOCK with 2 BLOCKERs + 2 WARNs, all closed in-loop after the call; per /codex-paranoia hard-cap semantics this requires user sign-off before implementation) —
