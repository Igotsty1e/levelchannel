# BCS-DEF-5-TG — Telegram channel for the daily 08:00 teacher digest

**Status:** DRAFT 2026-05-20 (plan-doc only; awaiting `/codex-paranoia plan`).
**Wave name:** `bcs-def-5-tg-teacher-telegram-reminders` (single-PR epic — see §5).
**Trigger:** Telegram channel deferred from `docs/plans/bcs-def-5-teacher-reminders.md`
§0a decision 6 + §10 ("Telegram DEFERRED — TG plan stacks on top of THIS plan's
`teacher_account_daily_digests` flag table + cron once the email MVP ships").
The parent epic SHIPPED 2026-05-19 (PR #393); the per-slot tick model in the
old draft of this plan is therefore obsolete and rewritten verbatim below.
**Author:** Claude (autonomous).
**Channel:** Telegram — adds a second delivery channel for the SAME daily digest
that `scripts/teacher-daily-digest.mjs` already sends via email.

> **HISTORICAL NOTE — REWRITE 2026-05-20.** The pre-rewrite draft of this plan
> mirrored the BCS-DEF-4-TG learner Telegram epic on top of a per-slot tick
> scheduler (`scripts/lesson-reminder-dispatch.mjs`, `teacher_reminder_dispatches`,
> default cadence `[60, 30, 10, 5]`). That world disappeared on 2026-05-19 when
> BCS-DEF-5 was re-cut as a daily 08:00 digest (PR #393). The per-slot design,
> `teacher_reminder_dispatches`, the unified scheduler, the "5-minute imminent
> ping" — none of that ships, none of it exists in code, and this plan no
> longer references it. The rewrite below stacks Telegram on top of the
> shipped digest cron without touching its email path.

---

## 0. Cross-refs

- **`docs/plans/bcs-def-5-teacher-reminders.md`** (PR #393, SHIPPED 2026-05-19)
  — **parent**. Defines the digest cron `scripts/teacher-daily-digest.mjs`,
  the dedup flag table `teacher_account_daily_digests` (migration 0067), the
  `probe_runs.probe_name='teacher-daily-digest'` widening (migration 0068),
  the timezone CHECK constraint on `account_profiles.timezone` (migration
  0069), the 3 operator-tunable knobs under `scope: 'teacher-daily-digest'`
  (`TEACHER_DIGEST_MASTER_SWITCH` / `TEACHER_DIGEST_RATE_LIMIT_PER_TICK` /
  `TEACHER_DIGEST_MAX_ATTEMPTS`), and the admin page at
  `/admin/settings/digest`. THIS plan stacks Telegram on top WITHOUT touching
  any of those contracts.
- **`docs/plans/bcs-def-4-tg-telegram-reminders.md`** — sibling learner-side
  Telegram epic. **PATTERN SOURCE** for the bind-code workflow, the
  `learner_telegram_subscriptions` table shape, the cabinet opt-in UI, the
  `/api/telegram/webhook` route, the `setWebhook` operator runbook, the
  `/start <code>` and `/stop` handlers, the 403-auto-unsubscribe semantics,
  and the redaction contract for token-bearing errors. THIS plan inherits
  that architecture verbatim, only swapping audience (`teacher` instead of
  `learner`) and surface (`/teacher/settings/digest` instead of
  `/cabinet/settings/reminders`).
- **`docs/plans/bcs-def-1-tg-telegram-alerts.md`** (PR #339, SHIPPED) —
  operator-alert precedent. **REUSE SOURCE** for `sendTelegramMessage` +
  `redactTelegramSecret` + `stringifyTelegramError` at
  `scripts/lib/telegram-alerts.mjs:77` / `:115` / `:277`, the env-loading
  contract (single `$ENV_FILE` rendered by `scripts/activate-prod-ops.sh`,
  no per-channel env.d/ fan-out), the master-switch / `scope: 'telegram'`
  pattern in `SETTING_SCHEMA` at `lib/admin/operator-settings.ts:50`, and
  the admin probe-status read pattern at `lib/admin/probe-status.ts`. THIS
  plan REUSES `TELEGRAM_BOT_TOKEN` — **NO new bot, NO new token, NO new
  `setWebhook` call** (BCS-DEF-4-TG already registered the webhook; this
  plan only adds a new bind-code `kind` discriminator).

---

## 1. Goal

When a teacher has bound Telegram via the cabinet bind-code flow AND
`TEACHER_DIGEST_TELEGRAM_ENABLED=1`, the digest cron sends the SAME daily
digest body via Telegram AFTER the email send for that teacher succeeds (or
is terminally skipped). Telegram is a SECOND channel — the email path is
unchanged.

**Hard requirements:**
- The email send path in `scripts/teacher-daily-digest.mjs` MUST remain
  bit-for-bit identical pre- and post-merge. The Telegram block is appended
  to the per-teacher TX after the email path commits (§2.4).
- One Telegram message per `(account_id, sent_date)` — idempotent. The
  existing PK `(account_id, sent_date)` on `teacher_account_daily_digests`
  is the email-channel idempotency primitive; Telegram gets its own
  per-channel dedup column on the same row (§2.2.2) so a sent email +
  failed Telegram leaves the row in a state where the next within-band
  tick retries ONLY Telegram, not the email.
- Soft-skip on missing binding: a teacher with no active
  `teacher_telegram_subscriptions` row gets the email and NO Telegram —
  the digest cron writes a `telegram_skipped_reason='no_telegram_binding'`
  marker on the dedup row and proceeds.
- Operator master switch `TEACHER_DIGEST_TELEGRAM_ENABLED` (default 0,
  OFF) gates the entire Telegram block. Default OFF lets the wave ship
  before any teacher has bound — operator flips after self-test.
- Telegram-side 403 ("bot blocked by user") auto-unsubscribes the binding;
  future digests skip Telegram for that teacher with reason
  `bot_blocked_by_user`.
- Token-bearing errors MUST funnel through `redactTelegramSecret` before
  any `recordProbeRun({errorMessage})` / `last_error` / log line / route
  response. Inherits BCS-DEF-1-TG §4.1 contract verbatim.

**Out of scope explicitly:** see §10.

---

## 1.1 Existing surface inventory

Cited against `main` HEAD as of 2026-05-20.

### Parent surface (BCS-DEF-5, SHIPPED PR #393)

- **`scripts/teacher-daily-digest.mjs`** — the digest cron. Currently 725 lines.
  - **`processOneTeacher({pool, candidate, now, maxAttempts, resendSend})`**
    at `scripts/teacher-daily-digest.mjs:272` — per-teacher TX. Inserts /
    updates the dedup row, sends the email via the dependency-injected
    `resendSend`, returns one of the 8 outcomes (`outside_band`,
    `already_sent`, `terminal_skip`, `terminal_send_failed`, `empty_day`,
    `email_missing`, `sent`, `send_failed_transient`). The Telegram block
    appends inside this same TX, after the email-success branch (§2.4).
  - **`main()`** at `scripts/teacher-daily-digest.mjs:525` — per-tick loop.
    Master-switch gate at `:556-567`. Resolves operator settings via
    `resolveOperatorSettingsForProbe(pool, 'teacher-daily-digest')` at `:541`.
    The Telegram master switch lands as a fourth key under the same probe
    scope (§2.3).
  - **`selectCandidateTeachers(db, maxAttempts, rateLimit)`** at
    `scripts/teacher-daily-digest.mjs:131` — candidate-set query. UNCHANGED
    by this wave; the Telegram retry-eligibility check happens inside
    `processOneTeacher`, not in the candidate-set SQL.
  - Counters at `scripts/teacher-daily-digest.mjs:585-595` — extended with
    `telegram_sent`, `telegram_skipped_no_binding`, `telegram_send_failed`,
    `telegram_bot_blocked` (§2.4).

- **`migrations/0067_teacher_account_daily_digests.sql`** — the dedup flag
  table. PK `(account_id, sent_date)` at `:35`. The `tadd_state_consistency`
  CHECK at `:42-73` already encodes the email channel's state machine. This
  wave adds Telegram-channel columns + a parallel sub-CHECK clause (§2.2.2).

- **`migrations/0068_probe_runs_teacher_daily_digest.sql`** — the
  `probe_runs.probe_name='teacher-daily-digest'` + 3 verdict-kind widening
  (`digest_sent`, `digest_skipped_disabled`, `digest_no_teachers`). The
  per-tick summary `recordProbeRun` already carries Telegram counters
  inside its `stats` JSON; **no new probe_name or verdict_kind is added by
  this wave** — the per-tick summary verdict stays `'digest_sent'`. (Per-
  recipient rows `recipient_kind='telegram'` are NOT used here — the digest
  is a single send per teacher, not the operator-alert fan-out pattern; the
  per-recipient discriminator from migration 0061 is unused on
  `'teacher-daily-digest'` probe_runs rows.)

- **`migrations/0069_account_profiles_timezone_check.sql`** — IANA TZ CHECK.
  UNCHANGED.

- **`lib/admin/operator-settings.ts`** — `SETTING_SCHEMA`. Lines
  `:248-280` define the 3 digest keys under `scope: 'teacher-daily-digest'`.
  This wave adds 1 NEW key under the SAME scope:
  `TEACHER_DIGEST_TELEGRAM_ENABLED`. `ChannelScope = 'telegram'` at `:50`
  is reserved for cross-probe Telegram knobs (BCS-DEF-1-TG); the per-digest
  master switch lives next to its siblings, not under `'telegram'` scope.
  Drift mirror at `scripts/lib/operator-settings.mjs` updated lockstep.

- **`app/admin/(gated)/settings/digest/page.tsx`** — admin surface for the
  digest, shipped in PR #393. Currently 3 sections (settings editor,
  last-tick widget, 7-day summary). This wave adds a 4th section "Telegram
  канал" parallel to BCS-DEF-1-TG's pattern: master switch row, active
  subscriptions count, recent unbinds (24h), per-tick Telegram-counter
  breakdown surfaced from `probe_runs.stats`.

- **`scripts/systemd/levelchannel-teacher-daily-digest.{service,timer}`** —
  systemd unit. UNCHANGED. `OnCalendar=*-*-* *:*:00` ticks every minute;
  Telegram delivery happens inside the SAME tick (§2.4).

### Sibling surface (BCS-DEF-1-TG, SHIPPED PR #339)

- **`scripts/lib/telegram-alerts.mjs`** — `sendTelegramMessage` at `:277`,
  `redactTelegramSecret` at `:77`, `stringifyTelegramError` at `:115`.
  **REUSE AS-IS, no fork.** Same retry policy (5xx + 1s linear backoff,
  4xx non-retryable, 429 honours `retry_after` capped at 5s, 5s
  AbortController wall-clock). 4096-char body cap is well above digest
  body (~600-1500 chars).
- **`TELEGRAM_BOT_TOKEN`** env var — REUSE. Single bot per VPS. The
  operator runbook §2.1 of this plan does NOT call `setWebhook` because
  BCS-DEF-4-TG already registered it for `https://levelchannel.ru/api/telegram/webhook`.

### Sibling surface (BCS-DEF-4-TG — pattern source)

`docs/plans/bcs-def-4-tg-telegram-reminders.md` is the **architecture
spec** this plan mirrors. Three things are inherited verbatim:

1. **Bind-code workflow.** `learner_telegram_bind_codes` (per BCS-DEF-4-TG
   §2.3 — 8-char `[A-Z0-9]` excluding I/O/0/1, 10-min TTL, single-use,
   `pg_advisory_xact_lock` serialization on `account_id`, partial unique
   index over not-yet-consumed/not-yet-expired). This plan adds the
   teacher-side analog `teacher_telegram_bind_codes` (§2.2.1).
2. **Subscription table.** `learner_telegram_subscriptions` (BCS-DEF-4-TG
   §2.3) — `(account_id, chat_id)` with `unsubscribed_at` + reason enum
   (`user_stop_command`, `bot_blocked_by_user`, `admin_revoked`,
   `rebound`); three partial indexes (active-by-account, active-by-chat,
   one-active-per-pair). This plan adds the structural clone
   `teacher_telegram_subscriptions` (§2.2.1).
3. **Webhook route.** `app/api/telegram/webhook/route.ts` (BCS-DEF-4-TG
   §2.4) — `X-Telegram-Bot-Api-Secret-Token` header auth, `/start <code>` +
   `/stop` + `/help` handlers, rate-limit 20 req/min/from-id, 200 on
   ignored / disabled. **EXTENDED, not forked** — §2.5 adds role-inferred
   dispatch when `kind='teacher'`.

---

## 1.2 Critical-path inventory

Per `docs/critical-path.md`:
- **`lib/admin/operator-settings.ts`** — on critical path. This plan adds
  1 key (additive). Same paranoia profile as BCS-DEF-5 Sub-PR.
- **`scripts/teacher-daily-digest.mjs`** — NOT on critical path (cron).
  This plan extends `processOneTeacher` with a post-email Telegram block.
- **`app/api/telegram/webhook/route.ts`** — NOT on critical path (already
  shipped by BCS-DEF-4-TG). This wave extends it with a `kind='teacher'`
  branch.

---

## 2. Design

### 2.1 Bot setup (operator runbook delta)

The bot exists, the webhook is already registered (BCS-DEF-4-TG §2.1
steps 1-4). This plan only adds the master switch flip:

1. **Verify env-file already carries `TELEGRAM_BOT_TOKEN` +
   `TELEGRAM_WEBHOOK_SECRET_TOKEN` + `TELEGRAM_BOT_USERNAME`.** Same
   `$ENV_FILE` that `scripts/activate-prod-ops.sh` manages — appended in
   the BCS-DEF-4-TG activation step. `cat $ENV_FILE | grep TELEGRAM` shows
   three lines.
2. **Confirm webhook health.** Optional probe:
   `curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | jq`
   — verifies the URL points at `https://levelchannel.ru/api/telegram/webhook`
   and `last_error_message` is empty.
3. **Apply migration.** `npm run migrate:up` on prod (via autodeploy).
   Migrations 0070-0072 are additive.
4. **Flip master switch.** `/admin/settings/digest` → "Telegram канал"
   section → `TEACHER_DIGEST_TELEGRAM_ENABLED=1`.
5. **Smoke test.** Operator self-binds a teacher account via
   `/teacher/settings/digest` (or a test teacher account); waits for the
   next 08:00 local tick; confirms Telegram arrives within 1 minute of
   email.

**Test-send caveat.** Mirrors BCS-DEF-1-TG WARN#2 limitation: there is
NO admin-side per-teacher TG-test-send button in this PR. Operator
verifies by self-binding and waiting for the next 08:00 tick (or by
inducing one — operator can manually `INSERT INTO lesson_slots` a slot
on the test teacher's "today" and wait for the next-day tick). A
proper dry-run is deferred to §10 BCS-DEF-5-TG-TESTSEND.

Full runbook lives in `docs/private/OPERATIONS.private.md` (operator-side,
out of public-repo scope, parity with BCS-DEF-1-TG §2.1).

### 2.2 Schema migrations

Three additive migrations, ordering deliberate.

#### 2.2.1 Migration 0070 — `teacher_telegram_bind_codes` + `teacher_telegram_subscriptions`

Structural clones of BCS-DEF-4-TG §2.3 tables. Same column shapes, same
partial indexes, same advisory-lock semantics. `account_id` references
`accounts(id) on delete cascade`. The teacher-archetype gate lives at the
Server Action layer (`/teacher/settings/digest` is wrapped by
`app/teacher/layout.tsx:50-56` which redirects non-teachers to
`/cabinet`) — the bind-code row carries no `kind` discriminator because
the table itself IS teacher-scoped (parallel to the learner table being
learner-scoped). Webhook resolution branches on which table holds the
code (§2.5 — UNION-SELECT).

```sql
-- BCS-DEF-5-TG (2026-05-20) — teacher-side Telegram bind codes and
-- subscriptions. Structural clone of learner tables from BCS-DEF-4-TG
-- (migrations/00XX_learner_telegram_bind_codes.sql +
-- 00XX_learner_telegram_subscriptions.sql).
-- Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.2.1.

create table if not exists teacher_telegram_bind_codes (
  code text primary key,                       -- 8 chars [A-Z0-9] no I/O/0/1
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,             -- created_at + 10 min
  consumed_at timestamptz null,
  consumed_chat_id bigint null
);

create unique index if not exists ttbc_one_active_per_teacher_idx
  on teacher_telegram_bind_codes (account_id)
  where consumed_at is null and expires_at > now();

create table if not exists teacher_telegram_subscriptions (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  chat_id bigint not null,
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz null,
  unsubscribe_reason text null
    check (unsubscribe_reason is null or unsubscribe_reason in (
      'user_stop_command', 'bot_blocked_by_user', 'admin_revoked', 'rebound'
    ))
);

create index if not exists tts_active_by_account_idx
  on teacher_telegram_subscriptions (account_id)
  where unsubscribed_at is null;

create index if not exists tts_active_by_chat_idx
  on teacher_telegram_subscriptions (chat_id)
  where unsubscribed_at is null;

create unique index if not exists tts_one_active_per_pair_idx
  on teacher_telegram_subscriptions (account_id, chat_id)
  where unsubscribed_at is null;

comment on table teacher_telegram_subscriptions is
  'BCS-DEF-5-TG (2026-05-20): teacher account ↔ Telegram chat-id bindings '
  'for the daily 08:00 digest. Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.2.1.';
```

**Note on partial-index `now()` semantics.** Same caveat as BCS-DEF-4-TG
§2.3 — `now()` is STABLE not IMMUTABLE; the partial unique index is
defence-in-depth. Server Actions enforce single-active via
`pg_advisory_xact_lock(hashtext('ttbc:' || account_id))` + DELETE of prior
unconsumed rows.

#### 2.2.2 Migration 0071 — `teacher_account_daily_digests` Telegram columns

The existing dedup row at `migrations/0067_teacher_account_daily_digests.sql`
encodes the **email channel** state machine in its `tadd_state_consistency`
CHECK. This wave adds parallel Telegram-channel columns. Strategy:
**append-only columns + a parallel sub-CHECK**, NOT a rewrite of the
existing CHECK (rewriting it would require dropping + recreating, which
risks blocking existing prod rows that satisfy the old CHECK but not the
new one mid-deploy).

```sql
-- BCS-DEF-5-TG (2026-05-20) — Telegram channel columns on the daily
-- digest dedup row. Email path on the same row is unchanged.
-- Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.2.2.

alter table teacher_account_daily_digests
  add column if not exists telegram_sent boolean not null default false;
alter table teacher_account_daily_digests
  add column if not exists telegram_skipped_reason text null;
alter table teacher_account_daily_digests
  add column if not exists telegram_message_id text null;
alter table teacher_account_daily_digests
  add column if not exists telegram_attempts integer not null default 0;
alter table teacher_account_daily_digests
  add column if not exists telegram_last_error text null;
alter table teacher_account_daily_digests
  add column if not exists telegram_sent_at timestamptz null;

alter table teacher_account_daily_digests
  add constraint tadd_telegram_skipped_reason_check
  check (telegram_skipped_reason is null or telegram_skipped_reason in (
    'no_telegram_binding',
    'bot_blocked_by_user',
    'channel_disabled',
    'send_failed'
  ));

-- Telegram channel state machine — parallel to the existing email
-- state machine. The existing tadd_state_consistency CHECK is
-- UNCHANGED. This new CHECK is independent: it only constrains the
-- relationship between the new columns.
alter table teacher_account_daily_digests
  add constraint tadd_telegram_state_consistency
  check (
    -- Sent: must have telegram_sent_at, no skipped_reason.
    (telegram_sent = true
     and telegram_sent_at is not null
     and telegram_skipped_reason is null)
    or
    -- Pending or transient-error: no skipped_reason, no sent_at,
    -- no message_id, attempts >= 0.
    (telegram_sent = false
     and telegram_skipped_reason is null
     and telegram_sent_at is null
     and telegram_message_id is null
     and telegram_attempts >= 0)
    or
    -- Non-retryable terminal (no_telegram_binding, channel_disabled,
    -- bot_blocked_by_user): no sent_at, no message_id.
    (telegram_sent = false
     and telegram_skipped_reason in (
       'no_telegram_binding', 'channel_disabled', 'bot_blocked_by_user'
     )
     and telegram_sent_at is null
     and telegram_message_id is null)
    or
    -- Retryable terminal (send_failed): no sent_at, no message_id,
    -- attempts >= 1.
    (telegram_sent = false
     and telegram_skipped_reason = 'send_failed'
     and telegram_sent_at is null
     and telegram_message_id is null
     and telegram_attempts >= 1)
  );

create index if not exists tadd_telegram_sent_at_idx
  on teacher_account_daily_digests (telegram_sent_at desc)
  where telegram_sent = true;
```

**ACCESS EXCLUSIVE briefly on `teacher_account_daily_digests`.** PG11+
adds a NOT NULL column with default WITHOUT rewriting the table
(metadata-only). Adding the CHECK as NOT VALID then VALIDATE would be
safer if the table grew big, but at MVP scale (90-day retention sweep
not yet implemented; ~thousands of rows max) the inline CHECK is fine.

#### 2.2.3 Migration 0072 — `operator_settings` key registration (no DDL)

This is a no-DDL migration — the schema for `operator_settings` is
already deployed. The new key `TEACHER_DIGEST_TELEGRAM_ENABLED` is
defined in `lib/admin/operator-settings.ts` SETTING_SCHEMA only; no
database row pre-seeding is needed (`resolveOperatorSettingsForProbe`
falls through to the `default: 0` value if the row is absent). Migration
file can be either omitted entirely OR be a single SQL comment
documenting the key registration for audit. Pick: **omit the file**;
the SETTING_SCHEMA addition + the drift mirror in
`scripts/lib/operator-settings.mjs` suffice. (`tests/admin/operator-settings.test.ts`
pins the drift.)

### 2.3 Operator settings — 1 new key

Extend `lib/admin/operator-settings.ts SETTING_SCHEMA` (around `:248-280`,
under the existing digest cluster) AND `scripts/lib/operator-settings.mjs`:

```ts
TEACHER_DIGEST_TELEGRAM_ENABLED: {
  kind: 'int',
  default: 0,
  min: 0,
  max: 1,
  envName: 'TEACHER_DIGEST_TELEGRAM_ENABLED',
  description: 'master switch (1=on/0=off) for sending the daily teacher '
    + 'digest via Telegram (in addition to email); reuses TELEGRAM_BOT_TOKEN '
    + 'and the webhook from BCS-DEF-4-TG (no setWebhook re-call). Default '
    + 'OFF — turn on after at least one teacher has bound via /teacher/settings/digest.',
  scope: 'teacher-daily-digest',
},
```

**Scope decision.** The key lives under `scope: 'teacher-daily-digest'`
(NOT `scope: 'telegram'`). Rationale: it's a per-digest feature flag, not
a cross-probe channel knob. `resolveOperatorSettingsForProbe(pool,
'teacher-daily-digest')` at `scripts/teacher-daily-digest.mjs:541` picks
it up alongside the existing 3 keys — no `resolveChannelSettings` call is
needed in the digest cron. (The Telegram channel-wide knob
`TELEGRAM_ALERTS_ENABLED` from BCS-DEF-1-TG is unrelated; it gates the
operator-alert probes, not the user-facing digest.)

### 2.4 Scheduler integration — Telegram block inside `processOneTeacher`

The Telegram send happens **inside the same per-teacher TX** as the email
send, AFTER the email path commits to its terminal email state. Sequence:

```
processOneTeacher(...)
  ...existing email path (steps a..i from BCS-DEF-5 §2.6)...
  email outcome ∈ {sent, already_sent, send_failed_transient,
                   terminal_send_failed, empty_day, email_missing,
                   outside_band, terminal_skip}

  -- NEW Telegram block (step j) — only runs when:
  --   * the row has NOT been rolled back (i.e. we didn't early-return)
  --   * candidate.accountId is not null
  --   * within firing band (already checked at step b)
  if (outcome != 'outside_band' && outcome != 'terminal_skip-lost-race') {
    runTelegramBlock(client, candidate, ymd, telegramEnabled, tgToken)
  }
```

`runTelegramBlock` runs inside the SAME `client` transaction as the email
path (so the COMMIT at step i / send-success / empty-day / email-missing
is the SAME COMMIT that persists the Telegram row state). Pseudocode:

```js
async function runTelegramBlock(client, candidate, ymd, telegramEnabled, tgToken, tgSend) {
  // 1. Master-switch off → write skipped row, return.
  if (!telegramEnabled) {
    await client.query(
      `update teacher_account_daily_digests
          set telegram_skipped_reason = 'channel_disabled'
        where account_id = $1 and sent_date = $2::date
          and telegram_sent = false
          and telegram_skipped_reason is null`,
      [candidate.accountId, ymd])
    return { tg: 'skipped_disabled' }
  }

  // 2. Look up active binding for this teacher.
  const sub = await client.query(
    `select chat_id from teacher_telegram_subscriptions
       where account_id = $1 and unsubscribed_at is null
       order by subscribed_at desc limit 1`,
    [candidate.accountId])
  if (!sub.rowCount) {
    await client.query(
      `update teacher_account_daily_digests
          set telegram_skipped_reason = 'no_telegram_binding'
        where account_id = $1 and sent_date = $2::date
          and telegram_sent = false
          and telegram_skipped_reason is null`,
      [candidate.accountId, ymd])
    return { tg: 'skipped_no_binding' }
  }

  // 3. Already sent today? Idempotency check.
  const existing = await client.query(
    `select telegram_sent, telegram_skipped_reason, telegram_attempts
       from teacher_account_daily_digests
       where account_id = $1 and sent_date = $2::date`,
    [candidate.accountId, ymd])
  const row = existing.rows[0] ?? {}
  if (row.telegram_sent === true) return { tg: 'already_sent' }
  if (row.telegram_skipped_reason !== null
      && row.telegram_skipped_reason !== undefined) {
    return { tg: 'already_terminal' }
  }
  if (Number(row.telegram_attempts ?? 0) >= maxAttempts) {
    // Mark terminal send_failed.
    await client.query(
      `update teacher_account_daily_digests
          set telegram_skipped_reason = 'send_failed'
        where account_id = $1 and sent_date = $2::date`,
      [candidate.accountId, ymd])
    return { tg: 'terminal_send_failed' }
  }

  // 4. Increment attempts BEFORE sending.
  await client.query(
    `update teacher_account_daily_digests
        set telegram_attempts = telegram_attempts + 1
      where account_id = $1 and sent_date = $2::date`,
    [candidate.accountId, ymd])

  // 5. Build the Telegram body (reuse the same rendered text from the
  //    email pass; see §2.4.1 below).
  const tgBody = buildTeacherDigestTelegram({ ... })

  // 6. Send via sendTelegramMessage (REUSE from BCS-DEF-1-TG).
  const result = await tgSend({
    botToken: tgToken,
    chatId: String(sub.rows[0].chat_id),
    text: tgBody,
    retryMax: 2,
  })

  // 7. Persist outcome.
  if (result.ok) {
    await client.query(
      `update teacher_account_daily_digests
          set telegram_sent = true,
              telegram_sent_at = now(),
              telegram_message_id = $3,
              telegram_last_error = null
        where account_id = $1 and sent_date = $2::date`,
      [candidate.accountId, ymd, result.messageId])
    return { tg: 'sent', messageId: result.messageId }
  }
  // 4xx 403 from Telegram = bot blocked → auto-unsubscribe + mark terminal.
  if (typeof result.error === 'string'
      && result.error.startsWith('telegram_403')) {
    await client.query(
      `update teacher_telegram_subscriptions
          set unsubscribed_at = now(),
              unsubscribe_reason = 'bot_blocked_by_user'
        where chat_id = $1 and unsubscribed_at is null`,
      [sub.rows[0].chat_id])
    await client.query(
      `update teacher_account_daily_digests
          set telegram_skipped_reason = 'bot_blocked_by_user',
              telegram_last_error = $3
        where account_id = $1 and sent_date = $2::date`,
      [candidate.accountId, ymd,
       redactTelegramSecret(result.detail || '', tgToken).slice(0, 1000)])
    return { tg: 'bot_blocked' }
  }
  // Transient — leave row pending; next tick within band retries.
  await client.query(
    `update teacher_account_daily_digests
        set telegram_last_error = $3
      where account_id = $1 and sent_date = $2::date`,
    [candidate.accountId, ymd,
     redactTelegramSecret(result.detail || result.error, tgToken).slice(0, 1000)])
  return { tg: 'send_failed_transient', error: result.error }
}
```

**Critical invariants:**
- The Telegram block does NOT write `telegram_last_error` without first
  passing the string through `redactTelegramSecret(text, tgToken)`. Same
  contract as BCS-DEF-1-TG §4.1; pinned by §3 redaction test.
- Email-side rows that already committed (`outcome='sent'`,
  `outcome='empty_day'`, `outcome='email_missing'`, etc.) all have a
  visible dedup row by the time the Telegram block runs — the UPDATEs
  above will find a row. Outcomes that rolled back (`terminal_skip`
  loser-of-race, `outside_band`) skip the Telegram block entirely
  (guarded at the call site).
- The Telegram block is **best-effort within the same TX**. If the
  Telegram code throws after the email already committed — wait, the
  email path doesn't commit independently; it commits at the END of
  `processOneTeacher`. The Telegram block runs BEFORE that final COMMIT.
  Re-reading `scripts/teacher-daily-digest.mjs:484-507`: the email-sent
  branch does `update ... set email_sent=true ... where account_id=...`
  THEN `client.query('commit')`. The Telegram block lands between those
  two queries. So both channels' state lands in the same COMMIT. If the
  Telegram block throws, the COMMIT rolls back BOTH channels' state —
  the next tick re-evaluates from scratch, the email path would run
  again and (assuming Resend is still up) re-send the email. **This is a
  blocker** — see §2.4.1 closure below.

#### 2.4.1 Two-COMMIT structure — closure of the rollback hazard

**Decision: split into TWO COMMITs.** Email path commits FIRST (preserving
the SHIPPED behaviour). Telegram block opens a SECOND short TX on the
same `client`:

```
processOneTeacher:
  ...existing email path → COMMIT (TX-A, unchanged)...
  email outcome ∈ {sent, empty_day, email_missing, send_failed_transient,
                   terminal_send_failed, already_sent, terminal_skip}

  if (outcome is one of {sent, empty_day, email_missing,
                         send_failed_transient, already_sent}) {
    await client.query('begin')        -- TX-B (Telegram-only)
    try {
      await runTelegramBlock(client, candidate, ymd, ...)
      await client.query('commit')
    } catch (err) {
      await client.query('rollback')
      logJson('warn', 'telegram block crashed', {
        accountId: candidate.accountId,
        err: redactTelegramSecret(stringifyTelegramError(err),
                                  TELEGRAM_BOT_TOKEN),
      })
    }
  }
```

Email path's row state is durably persisted before Telegram is touched.
Telegram block failing → email is still sent, dedup row says
`email_sent=true`. Next within-band tick re-evaluates ONLY the Telegram
columns (email path's `email_sent=true` makes it `already_sent` and skips
the email send). This preserves the SHIPPED email contract verbatim.

**Telegram body source.** The Telegram body is rendered fresh from the
same slot list the email used. To avoid re-querying `lesson_slots` +
`accounts` for the learner labels, the email path's intermediate values
(`slots`, `learnerLabels`, `rendered.subject`) are passed forward to the
Telegram block as in-memory args. A new helper
`scripts/lib/teacher-daily-digest-telegram-template.mjs` shapes the
plain-text body (parallel to `scripts/lib/teacher-daily-digest-template.mjs`).

#### 2.4.2 Telegram template

`scripts/lib/teacher-daily-digest-telegram-template.mjs` — plain text,
≤1024 chars (well under Telegram's 4096 cap), no `parse_mode`. Shape:

```
LevelChannel — занятия на сегодня

   2 занятия

   09:00 — Иванова И.
   14:30 — Петрова М. (zoom: https://meet.google.com/xxx-yyyy-zzz)

Открыть календарь: https://levelchannel.ru/teacher

Отписаться от Telegram-дайджеста: /stop
```

**PII deltas vs email** — none. The body shows the same learner-name
content the email template shows (first name + initial via the same
`renderTeacherDailyDigestEmail` PII policy from BCS-DEF-5 §4.1:
`first-name + initial`, email-first-letter fallback, NEVER full email).

Drift test pins the template's output against a frozen golden fixture
covering: 1-slot day, 5-slot day, slot with null `learner_account_id`,
slot with null `zoom_url`, 1024-char-cap probe (synthetic 12-slot day
with long display names).

### 2.5 Webhook route — extended for `kind='teacher'`

The webhook at `app/api/telegram/webhook/route.ts` (shipped by
BCS-DEF-4-TG) currently resolves `/start <code>` against
`learner_telegram_bind_codes`. This wave extends it to **UNION-resolve**
against both tables and branch on which one held the code:

```ts
// inside handleStart(code, chatId, fromId):
//   1. Trim, validate /^[A-Z0-9]{8}$/.
//   2. UNION-SELECT FOR UPDATE across both tables:
const found = await tx.query(
  `select 'learner' as kind, code, account_id
     from learner_telegram_bind_codes
     where code = $1 and consumed_at is null and expires_at > now()
   union all
   select 'teacher' as kind, code, account_id
     from teacher_telegram_bind_codes
     where code = $1 and consumed_at is null and expires_at > now()
   for update`,
  [code])
//   3. On miss → reply "Код просрочен или уже использован."
//   4. UPDATE the right table (set consumed_at, consumed_chat_id).
//   5. Insert into the right subscription table.
//   6. Audience-keyed reply:
//      - learner: "Готово. Вы будете получать напоминания о занятиях..."
//      - teacher: "Готово. Будете получать ежедневный дайджест занятий
//                  на день в 08:00 утра по вашему часовому поясу.
//                  Изменить параметры: levelchannel.ru/teacher/settings/digest.
//                  Отписаться: /stop."
```

**`/stop` handler — UNION across both tables.** Mirrors BCS-DEF-4-TG's
dual-archetype handling (a chat could be bound to both a learner and a
teacher account; `/stop` unsubscribes both). Reply names both audiences
that were active.

**Code-collision safety.** Both tables use 8-char `[A-Z0-9-IO01]` codes;
collision across the two tables is ~32^8 ≈ 10^12 probability per pair, so
the UNION cannot return >1 row in practice. Defensive: if UNION returns
2 rows (vanishingly rare; treated as bug), webhook replies with generic
"внутренняя ошибка, попробуйте ещё раз" and logs an alert.

### 2.6 Teacher cabinet UI — `/teacher/settings/digest`

NEW page under the teacher cabinet. Reuses the BCS-DEF-4-TG `/cabinet/settings/reminders`
Telegram-section pattern verbatim — only the URL surface and Server
Actions differ.

**URL:** `/teacher/settings/digest` (new). The teacher cabinet currently
exposes `/teacher` (calendar) and `/teacher/settings/calendar` (Google
Calendar binding); the digest settings page is a sibling under
`/teacher/settings/`.

**Page sections:**
1. **Header.** "Утренний дайджест занятий" — short copy explaining the
   08:00 local-time delivery + that it shows today's booked slots.
2. **Email channel status.** Always-on; says "Дайджест приходит на
   <email>." No opt-out (parent plan §0a decision 5).
3. **Telegram channel** — gated by `TEACHER_DIGEST_TELEGRAM_ENABLED`
   master switch (admin-side):
   - Master switch off → section hidden entirely.
   - Master switch on + no active binding → "Подключите Telegram, чтобы
     получать дайджест в мессенджере. [Получить код]" button POSTs
     Server Action `requestTeacherTelegramBindCode`.
   - Code issued + within TTL → render the 8-char code prominently +
     "Привязать через Telegram" deep-link button
     (`https://t.me/<TELEGRAM_BOT_USERNAME>?start=<code>`) + countdown
     timer "Код действует 9:47".
   - Active binding → "Telegram-дайджест включён. [Отвязать]" button
     POSTs Server Action `unbindTeacherTelegram`.

**Server Actions** (new file
`app/teacher/settings/digest/telegram-actions.ts`):
- `requestTeacherTelegramBindCode()`: rate-limit 5 req/hour/account
  (mirrors learner side); deletes prior unconsumed codes under
  `pg_advisory_xact_lock(hashtext('ttbc:' || account_id))`; generates new
  code via `crypto.randomBytes` mapped to the 32-char alphabet; INSERTs
  into `teacher_telegram_bind_codes`; returns `{code, expiresAt}`.
- `unbindTeacherTelegram()`: SELECT chat_id of active binding; UPDATE
  `teacher_telegram_subscriptions SET unsubscribed_at=now(),
  unsubscribe_reason='admin_revoked'` (semantically user-initiated
  unbind — reuse the enum); fire-and-forget courtesy Telegram message
  via `sendTelegramMessage`.

**Archetype gate.** `app/teacher/layout.tsx:50-56` already redirects
non-teachers to `/cabinet`. The Server Actions ALSO re-check
`listAccountRoles(account.id).includes('teacher')` as defence-in-depth —
a learner-archetype POST to `requestTeacherTelegramBindCode` returns 403
even if it bypasses the layout. (Identical posture to BCS-DEF-4-TG §2.8
defence-in-depth.)

### 2.7 Admin UI — `/admin/settings/digest` "Telegram канал" section

NEW section added to the existing admin digest page (currently at
`app/admin/(gated)/settings/digest/page.tsx`). Position: after the
"Settings editor" section (which already groups the 3 existing keys), as
a 4th section.

Content:
- **Master switch** — `TEACHER_DIGEST_TELEGRAM_ENABLED` (0/1 toggle via
  the existing `SettingEditor`).
- **Env presence indicators** — `TELEGRAM_BOT_TOKEN` set? (boolean only;
  value NEVER rendered). Render at the page level (shared across the
  Telegram-section and the other digest sections — drives the master
  switch's "ready to enable" gate).
- **Active subscriptions count** — `SELECT count(*) FROM
  teacher_telegram_subscriptions WHERE unsubscribed_at IS NULL`. Lives
  in a NEW helper `lib/admin/teacher-telegram-summary.ts` (sibling to
  `lib/admin/digest-summary.ts`).
- **Recent unbinds (last 24h)** — `SELECT count(*) WHERE unsubscribed_at
  > now() - interval '24 hours'`. Spike alarms operator attention
  (deferred to §10 BCS-DEF-5-TG-ALERT).
- **Per-tick Telegram counter breakdown** — sums the
  `stats.telegram_sent` / `stats.telegram_skipped_no_binding` /
  `stats.telegram_send_failed` / `stats.telegram_bot_blocked` counters
  from the last 24h of `probe_runs WHERE probe_name='teacher-daily-digest'`.

**Admin-side per-teacher TG-test-send is OUT OF SCOPE** for this PR
(mirrors BCS-DEF-1-TG WARN#2 limitation — operator verifies by inducing
a real low-blast-radius tick via self-binding, not by clicking a test
button).

---

## 3. Tests

### 3.1 Migration tests

`tests/integration/admin/teacher-telegram-migrations.test.ts`:
- 0070 (bind_codes + subscriptions) + 0071 (TADD columns) apply clean on
  a fresh DB.
- Post-0071: existing `tadd_state_consistency` CHECK still holds for an
  email-only row (no Telegram columns set); new `tadd_telegram_state_consistency`
  rejects invalid Telegram-state combinations.
- `unsubscribe_reason='slack'` fails the CHECK on `teacher_telegram_subscriptions`.
- `telegram_skipped_reason='unknown'` fails the CHECK on
  `teacher_account_daily_digests`.

### 3.2 Bind-code workflow

`tests/teacher/teacher-telegram-bind-code.test.ts` (mirrors BCS-DEF-4-TG §3.1 + §3.3):
- Generated code matches `/^[A-Z0-9]{8}$/` with no I/O/0/1.
- TTL is exactly 10 minutes (`expires_at - created_at`).
- Generating twice for same teacher account: first row replaced (advisory-lock pinned).
- `/start <code>` happy path: subscription row inserted, code row marked
  consumed; webhook reply matches the teacher-audience copy.
- **Replay protection**: same code redeemed twice → second redemption
  replies "Код просрочен или уже использован"; no duplicate subscription
  row.
- Cross-archetype gate: a learner-archetype Server Action POST to
  `requestTeacherTelegramBindCode` returns 403; no row inserted.

### 3.3 Digest send — Telegram fires for subscribed teacher

`tests/integration/scripts/teacher-daily-digest-telegram.test.ts`:
- `TEACHER_DIGEST_TELEGRAM_ENABLED=0` (default) → no Telegram API call;
  `telegram_skipped_reason='channel_disabled'` written on the dedup row;
  email path unaffected.
- Enabled + teacher with active binding + non-empty day → Resend send AND
  Telegram send both fire; dedup row has `email_sent=true,
  telegram_sent=true, telegram_message_id=<id>`.
- Enabled + teacher WITHOUT active binding → email sent; dedup row has
  `email_sent=true, telegram_skipped_reason='no_telegram_binding'`. **(c)
  spec.**
- Mocked Telegram 403 → email sent; subscription row marked
  `unsubscribed_at` + `bot_blocked_by_user`; dedup row has
  `telegram_skipped_reason='bot_blocked_by_user'`; future tick same day
  skips Telegram for this teacher.
- Mocked Telegram 5xx → email sent; dedup row has
  `telegram_attempts=1, telegram_last_error=<redacted>`. Next tick
  within band re-tries Telegram only; after 3 attempts marks
  `telegram_skipped_reason='send_failed'`.

### 3.4 Digest send — Telegram does NOT fire for unsubscribed teacher

`tests/integration/scripts/teacher-daily-digest-telegram-unsub.test.ts`
(separate file for explicit `(d)` spec coverage):
- Teacher with `teacher_telegram_subscriptions.unsubscribed_at IS NOT
  NULL` → digest tick: email sent; NO Telegram API call; dedup row has
  `telegram_skipped_reason='no_telegram_binding'`. Mocked `tgSend` is
  never invoked (`expect(tgSend).not.toHaveBeenCalled()`).
- Same teacher rebound (new subscription row, old marked `rebound`) →
  next tick within band: Telegram fires; previously-set
  `telegram_skipped_reason='no_telegram_binding'` is NOT overwritten
  retroactively (the dedup row for that sent_date is already terminal
  for the Telegram channel; the next morning's tick on `sent_date+1`
  re-evaluates from scratch with fresh row).

### 3.5 Redaction of Telegram errors in `probe_runs` + dedup row

`tests/integration/scripts/teacher-daily-digest-redaction.test.ts`:
- Mocked Telegram 5xx error string containing the token suffix → after
  the tick, `teacher_account_daily_digests.telegram_last_error` does NOT
  contain the token, the last-8-chars-of-token, or the `bot<token>`
  prefix; the literal string `[REDACTED]` is present.
- The per-tick `recordProbeRun({errorMessage})` (when the Telegram block
  crashes outside the inner try/catch) ALSO passes through the redactor;
  pinned via fixture mirror to BCS-DEF-1-TG §3.1b's frozen-string
  approach (load `tests/scripts/fixtures/telegram-fetch-errors.json`
  fixtures, run them through the digest's error path, assert no token
  leakage).

### 3.6 Cabinet UI

`tests/integration/teacher/digest-telegram-binding.test.ts`:
- GET `/teacher/settings/digest` as anonymous → 307 → `/login`.
- GET as learner-archetype → 307 → `/cabinet`.
- GET as teacher → 200; Telegram section hidden when master switch off.
- GET as teacher with master switch on + no binding → "Получить код"
  button visible.
- POST `requestTeacherTelegramBindCode` 6× in 1 hour → 6th call
  rate-limited.
- POST `unbindTeacherTelegram` with no active sub → no-op (idempotent).
- POST `unbindTeacherTelegram` with active sub → row UPDATEd; courtesy
  Telegram fire-and-forget attempted (mocked).

### 3.7 Admin UI

`tests/integration/admin/digest-telegram-row.test.ts`:
- GET `/admin/settings/digest` as admin → renders the new "Telegram канал"
  section; master switch round-trips; active-sub count matches DB seed.
- Env-presence indicator boolean reflects mocked env; **regression pin**:
  the bot-token value never appears in HTML.

### 3.8 Drift mirror

`tests/admin/operator-settings.test.ts` (modified):
- New key `TEACHER_DIGEST_TELEGRAM_ENABLED` present in BOTH
  `lib/admin/operator-settings.ts SETTING_SCHEMA` AND
  `scripts/lib/operator-settings.mjs` mirror; scope is
  `'teacher-daily-digest'`.

### 3.9 Template golden

`tests/notifications/teacher-digest-telegram-template.test.ts`:
- 1-slot day → expected golden text.
- 5-slot day → expected golden text.
- Slot with `learner_account_id IS NULL` → "Учащийся не привязан" line.
- Slot with `zoom_url IS NULL` → zoom-url omitted.
- 12-slot synthetic day with maximum-length display names → body still
  ≤1024 chars (truncation strategy: drop the zoom-url, then drop the
  trailing slots — emit "(+N ещё, см. календарь)").
- Plain text only (no `*`, `_`, `[`, `]` chars present in output).

---

## 4. Security analysis

INHERITED VERBATIM from BCS-DEF-4-TG §4.1-§4.8 + BCS-DEF-1-TG §4.1
redaction contract. Deltas specific to the teacher digest:

### 4.1 PII

Teacher Telegram body shows the SAME learner-name content the email body
shows (first-name + initial; email-first-letter fallback; NEVER full
email). Symmetric to BCS-DEF-5 §4.1; verified by §3.9 template tests.
Teacher already sees these learner names in `/teacher` calendar — no
incremental disclosure.

### 4.2 Cross-archetype binding spoofing

A learner CANNOT bind a teacher subscription because:
1. `/teacher/settings/digest` layout gate at `app/teacher/layout.tsx:50-56`
   redirects non-teachers to `/cabinet`.
2. `requestTeacherTelegramBindCode` Server Action re-checks the teacher
   role grant before INSERTing.
3. `teacher_telegram_bind_codes` is a SEPARATE table; there is no `kind`
   discriminator the attacker could spoof at insertion time.
4. The webhook's UNION-SELECT trusts the table-of-origin for audience
   routing — only role-gated paths write rows to the teacher table.

### 4.3 Token redaction

Inherited verbatim from BCS-DEF-1-TG §4.1: every string derived from a
Telegram-API exception passes through `redactTelegramSecret(text, token)`
BEFORE crossing into `teacher_account_daily_digests.telegram_last_error`,
`recordProbeRun({errorMessage})`, console.* log lines, or any HTTP
response body. Pinned by §3.5 redaction tests.

### 4.4 Race-with-other-tick

The Telegram block is gated by the row-level state read in step 3 of
`runTelegramBlock`: if `telegram_sent=true` already, return `already_sent`
without calling the API. Two ticks racing on the same teacher both
within band: first to commit wins (TX-B's UPDATE serializes against the
row's MVCC version). Telegram-side `Resend.idempotencyKey` equivalent —
**there is no idempotencyKey on the Telegram API**, so a pathological
double-send is possible if a tick reads `telegram_sent=false`, sends
successfully, and crashes before COMMIT; next tick reads
`telegram_sent=false` again and sends a SECOND message. Mitigation: the
attempts increment happens BEFORE the send (step 4); after 3 attempts
the row is marked terminal. Worst case: 3 duplicate Telegram messages on
a long crash loop. Accepted; documented in §6 RISK-2.

### 4.5 Migration ACCESS EXCLUSIVE

- 0070 — new tables, no existing-table locks.
- 0071 — ACCESS EXCLUSIVE briefly on `teacher_account_daily_digests`.
  PG11+ adds NOT NULL columns with default WITHOUT rewriting (metadata-only);
  the inline CHECK adds a brief scan. Table is small (90-day retention
  sweep not yet implemented but on roadmap; current row count <10K).
  Accepted.

### 4.6 GDPR / chat-id retention

Identical to BCS-DEF-4-TG §4.8 — `chat_id` cascades on `accounts on
delete cascade`. Full GDPR-erasure (null chat_id on unbind) tracked in §10.

---

## 5. Decomposition — independent epic, single PR

**Q: sub-PR of an open epic OR independent epic?**

**Decision: INDEPENDENT EPIC, single PR.** Three reasons:

1. BCS-DEF-5 SHIPPED 2026-05-19 (PR #393). No open epic to fold into.
2. BCS-DEF-4-TG precedent — shipped as independent single-PR epic AFTER
   BCS-DEF-4 closed. Symmetric handling here.
3. Paranoia surface is small (~900-1100 LOC of pure TG delta on a
   shipped digest cron); the standalone-epic trailer covers it cleanly.

**Single PR — epic IS the PR.** Estimated ~1000 LOC. Files:

```
docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md     (rewritten, this file)
migrations/0070_teacher_telegram_subscriptions_and_bind_codes.sql  (NEW)
migrations/0071_teacher_account_daily_digests_telegram_columns.sql (NEW)
lib/admin/operator-settings.ts                            (modified — 1 new key)
scripts/lib/operator-settings.mjs                         (mirror — 1 new key)
scripts/teacher-daily-digest.mjs                          (modified — Telegram block in processOneTeacher)
scripts/lib/teacher-daily-digest-telegram-template.mjs    (NEW)
lib/notifications/teacher-digest-telegram-template.ts     (NEW — TS mirror for tests)
app/api/telegram/webhook/route.ts                         (modified — UNION-resolve bind-code lookup)
app/teacher/settings/digest/page.tsx                      (NEW)
app/teacher/settings/digest/telegram-actions.ts           (NEW Server Actions)
app/admin/(gated)/settings/digest/page.tsx                (modified — 4th section "Telegram канал")
lib/admin/teacher-telegram-summary.ts                     (NEW)
tests/integration/admin/teacher-telegram-migrations.test.ts          (NEW)
tests/teacher/teacher-telegram-bind-code.test.ts                     (NEW)
tests/integration/scripts/teacher-daily-digest-telegram.test.ts      (NEW)
tests/integration/scripts/teacher-daily-digest-telegram-unsub.test.ts (NEW)
tests/integration/scripts/teacher-daily-digest-redaction.test.ts     (NEW)
tests/integration/teacher/digest-telegram-binding.test.ts            (NEW)
tests/integration/admin/digest-telegram-row.test.ts                  (NEW)
tests/notifications/teacher-digest-telegram-template.test.ts         (NEW)
tests/admin/operator-settings.test.ts                                (modified — drift pin)
tests/scripts/fixtures/telegram-fetch-errors.json                    (REUSED from BCS-DEF-1-TG)
ENGINEERING_BACKLOG.md                                               (modified — strikethrough)
docs/plans/bcs-def-5-teacher-reminders.md                            (modified — §10 cross-ref to this plan PR)
ARCHITECTURE.md                                                      (modified — teacher Telegram digest channel)
```

**Critical-path:** `lib/admin/operator-settings.ts` IS on critical path
(1 key added, additive). Trailer carries
`Codex-Paranoia: SIGN-OFF round N/3` (one-PR epic; plan + wave collapsed).

---

## 6. Risks + mitigations

Most risks INHERITED from BCS-DEF-4-TG §6 and BCS-DEF-1-TG §6 — the
bot-token rotation, code collision, webhook secret rotation, webhook
flood, learner-bot-blocked semantics all apply identically. Deltas
specific to the teacher digest:

### RISK-1 — Token reuse implications

The same `TELEGRAM_BOT_TOKEN` now serves THREE flows: operator alerts
(BCS-DEF-1-TG), learner per-slot reminders (BCS-DEF-4-TG), and teacher
daily digests (this plan). A bot-token rotation affects ALL THREE
contours simultaneously; a bot blocked by Telegram's anti-abuse system
takes all three contours down. **Mitigation:** operator runbook
documents the single-rotation contract (parity with BCS-DEF-4-TG
RISK-5). Blast radius = "all Telegram", not "all reminders" — email is
unaffected.

### RISK-2 — Telegram double-send on crash mid-send

Telegram's `sendMessage` API has no `idempotencyKey` equivalent (unlike
Resend). If the cron crashes between the API call returning success and
the dedup-row UPDATE that sets `telegram_sent=true`, the next tick will
re-send the same digest. **Mitigation:** the attempts-increment happens
BEFORE the API call (step 4 in §2.4); after 3 attempts the row is
terminal `send_failed`. Worst case: 3 duplicate messages on a long
crash loop. Single duplicate on a single crash is the more realistic
case. Accepted.

### RISK-3 — Opt-in churn

Teachers may bind/unbind frequently as they discover the channel. The
`teacher_telegram_subscriptions` table grows with one row per
bind/unbind cycle (history preserved). **Mitigation:** retention is
bounded by `accounts on delete cascade` (so churn × account lifetime is
the upper bound, not unbounded). 90-day sweep on the table is deferred
to §10 BCS-DEF-5-TG-RETENTION.

### RISK-4 — Digest-tick rate-limit interaction with TG retry budget

`TEACHER_DIGEST_RATE_LIMIT_PER_TICK` (default 200) caps the per-tick
send count for the EMAIL path. The Telegram block runs INSIDE the same
per-teacher iteration; it does NOT consume an additional rate-limit
budget slot (each teacher counts once). However, Telegram's retry
policy in `sendTelegramMessage` (5xx + 1s backoff + retryMax=2 = up to
3 attempts × 5s timeout = 15s per teacher worst case) can stall the
tick. **Mitigation:** the existing systemd timer ticks every minute
(60s); even worst-case Telegram failures on every teacher in the band
would consume 200 × 15s = 50 minutes — far past the next tick. So the
within-band drain might span multiple ticks; the next-tick re-evaluation
via the candidate-set's `attempts < max_attempts` filter handles this
cleanly (parent plan §0c BLOCKER 5 closure pattern). Accepted; verified
by §3.3 5xx retry test.

### RISK-5 — Cross-channel ordering — email arrives, Telegram doesn't

Operator-perceived UX: a teacher checks Telegram, sees no digest, thinks
the system is broken; opens email, finds it. **Mitigation:** the cabinet
UI states "Дайджест приходит на <email>" prominently and the Telegram
section is opt-in (not auto-enabled). Telegram is a courtesy bonus, not
a replacement. Cabinet copy makes this clear.

### RISK-6 — Body truncation under 1024-char cap

12-slot teacher with long display names + long zoom-urls could exceed
the 1024-char Telegram template cap. **Mitigation:** the template
truncates gracefully (drop zoom-url, then drop trailing slots, emit
"(+N ещё, см. календарь)"). §3.9 pins the truncation path. The full
content remains in the email — Telegram is a paging utility.

### RISK-7 — Webhook flood on activation

When `TEACHER_DIGEST_TELEGRAM_ENABLED=1` flips, the cabinet UI section
becomes visible and operators broadcast the feature. A burst of `/start`
binds is possible. **Mitigation:** webhook is rate-limited 20 req/min/from-id
(BCS-DEF-4-TG §2.4) — the cap is per-Telegram-user, not global. Backend
cabinet `requestTeacherTelegramBindCode` is rate-limited 5/hour/account.
A sustained 200 teachers/hour binding rate is well below any DB write
ceiling.

### RISK-8 — Migration 0071 CHECK addition fails on prod data

If some prod rows already violate the new `tadd_telegram_state_consistency`
CHECK (impossible — all new columns default to safe values, but
defensive note), the ALTER would fail. **Mitigation:** all new columns
are append-only with safe defaults (`telegram_sent=false`,
`telegram_skipped_reason=null`, etc.). The CHECK's "pending" clause
(`telegram_sent=false AND telegram_skipped_reason IS NULL AND ...
telegram_attempts >= 0`) is satisfied by every default-valued row.
Verified by §3.1 migration test.

---

## 7. Acceptance criteria

The PR ships when:
- Migrations 0070 + 0071 apply clean on a fresh test DB.
- `npm run test:run` green.
- `npm run test:integration` green (8 new test files, 1 modified).
- `npm run build` green.
- `/codex-paranoia plan` SIGN-OFF on this file (round N/3).
- `/codex-paranoia wave` SIGN-OFF on the implementation diff (round N/3).
- PR commit body trailer:
  ```
  Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
  Critical-Path-Touched: lib/admin/operator-settings.ts
  Skill-Used: /codex-paranoia plan + /codex-paranoia wave
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- `ENGINEERING_BACKLOG.md` strikethrough for `BCS-DEF-5-TG`.

Post-merge (operator-side activation):
- Webhook already registered (BCS-DEF-4-TG) — NO `setWebhook` re-call.
- Operator runs `npm run migrate:up` via autodeploy.
- Operator flips `TEACHER_DIGEST_TELEGRAM_ENABLED=1` at
  `/admin/settings/digest`.
- Operator self-binds a teacher account via `/teacher/settings/digest`;
  waits for next 08:00 local tick; confirms Telegram arrives.

---

## 8. Migration / rollout

1. PR opens with migrations 0070 + 0071 as the only DB changes.
2. CI runs migrations against test DB → green.
3. PR merges (squash) to main.
4. Autodeploy timer picks up the commit; `npm run build → npm run migrate:up →
   swap → health-check` per `docs/private/OPERATIONS.private.md:33-37` /
   `:254-259` (the source-of-truth cited by BCS-DEF-1-TG §9).
5. `TEACHER_DIGEST_TELEGRAM_ENABLED=0` → Telegram block writes
   `telegram_skipped_reason='channel_disabled'` on every dedup row for
   24h; email path completely unaffected; no Telegram API calls.
6. Operator flips master switch at `/admin/settings/digest`.
7. Teachers begin discovering the cabinet section + binding. The next
   morning's tick (or any morning after a teacher binds) starts sending
   Telegram alongside email for that teacher.

**No ordering hazard.** Migrations are purely additive. Until master
switch flips, no Telegram sends occur. The dedup rows track
`channel_disabled` on every teacher who's a digest candidate but the
column was added with default `telegram_sent=false`, so backfill is a
no-op for rows that pre-date the migration (they show
`telegram_skipped_reason=NULL` until the next tick re-evaluates them and
writes `channel_disabled` — purely cosmetic).

---

## 10. Out of scope — deferred follow-ups

- **BCS-DEF-5-TG-TESTSEND** — Admin dry-run button for Telegram digest
  per-teacher (parallel to BCS-DEF-1-TG-TESTSEND, currently §10.7 of
  that plan). Verifies the channel without waiting for a real 08:00
  tick.
- **BCS-DEF-5-TG-MULTI-CHAT** — One teacher binding multiple chats.
  MVP caps at 1 active binding per teacher.
- **BCS-DEF-5-TG-RICHFORMAT** — `parse_mode=MarkdownV2` with bold/links/
  inline keyboards. Visual upgrade; escape-char cost rejected for MVP.
- **BCS-DEF-5-TG-ALERT** — Operator alert on mass unbinds (>N in 24h
  spike). Defends against Telegram-side bug cascade.
- **BCS-DEF-5-TG-RECOVERY** — Admin UI button to un-revoke a subscription
  unsubscribed by `bot_blocked_by_user` (false-positive recovery).
- **BCS-DEF-5-TG-GDPR** — Null the chat-id on unbind to fully erase PII
  (binding-history row stays but chat-id column nulled).
- **BCS-DEF-5-TG-RETENTION** — 90-day sweep on
  `teacher_telegram_subscriptions` history rows (unsubscribed rows only).
- **Per-recipient content tailoring beyond email parity.** The Telegram
  body shows the SAME content the email body shows; per-channel
  customization (e.g. Telegram-only "imminent" pings, abbreviated
  Telegram subject lines, per-channel emoji rules) is rejected for MVP.
- **Per-teacher digest content opt-in/out (e.g. "show zoom-urls only" /
  "show learner names only")** — same posture as BCS-DEF-5 §10
  per-user-opt-out deferral.
- **Push (PWA) channel** — not on the roadmap.

---

## 11. Final trailer expectations

```
Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
Critical-Path-Touched: lib/admin/operator-settings.ts
Skill-Used: /codex-paranoia plan + /codex-paranoia wave
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

— END OF DRAFT (awaiting `/codex-paranoia plan`) —
