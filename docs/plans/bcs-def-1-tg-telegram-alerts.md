# BCS-DEF-1-TG — Telegram alert channel for operator-side probes

**Status:** DRAFT 2026-05-18 (plan-doc only; paranoia plan-mode is the next step).
**Wave name:** `bcs-def-1-tg` (one-PR epic — see §5).
**Trigger:** Telegram delivery deferred from the operator-only MVP
(`docs/plans/conflict-unresolved-alert.md:851-853` §10.2). Adds a second
channel to ALL four operator-side alert probes uniformly.
**Author:** Claude (autonomous).
**Per-operator chat-id mapping:** EXPLICITLY DEFERRED to BCS-DEF-1-TG-MULTIRECIP (§10).

---

## 0. Cross-refs

- `docs/plans/conflict-unresolved-alert.md` — operator-only MVP shipped
  2026-05-19; §10.2 defers Telegram to THIS plan.
- `docs/plans/bcs-def-1-fanout.md:97-123` §2.1 — establishes the
  **per-recipient row precedent** (one `probe_runs` row per recipient) that
  this plan reuses for `recipient_kind='telegram'` rows.
- `docs/plans/alerts-obs.md` — `probe_runs` observability sink.
- `docs/plans/alerts-editor.md` — `SETTING_SCHEMA` + `/admin/settings/alerts`
  page that gains a new "Telegram канал" section.

---

## 1. Goal

When any of the four operator-side probes (auth-flow, calendar-pathology,
webhook-flow, conflict-unresolved) decides to send an alert email, ALSO send
a Telegram message to a single operator-side chat-id (`ALERT_TELEGRAM_CHAT_ID`)
via a single shared bot (`TELEGRAM_BOT_TOKEN`). Email path keeps firing
unchanged. Channels are independent: either may succeed or fail without
affecting the other's `probe_runs` row or send attempt.

**MVP scope = operator-only single chat-id.** Per-operator chat-id mapping
deferred (§10).

---

## 1.1 Existing surface inventory

Per COMPANY.md §Survey-before-plan. Citations against `main` as of 2026-05-18.

### Probes (4 — each gets a Telegram sibling block)

| Probe | Resend block | Stateful? |
|---|---|---|
| auth-flow | `scripts/auth-flow-alert.mjs:234-331` | yes |
| calendar-pathology | `scripts/calendar-pathology-alert.mjs:137-215` | yes |
| webhook-flow | `scripts/webhook-flow-alert.mjs:137-215` | no |
| conflict-unresolved | `scripts/conflict-unresolved-alert.mjs:494-552` | yes |

Each probe is sibling-uniform: env-guard → `resend.emails.send(...)` →
on-success record `alert_sent` + advance state; on-failure record
`alert_send_failed`, do NOT advance. Telegram block lands as a SIBLING with
identical semantics; see §2.6.

### Shared helpers

- `scripts/lib/probe-runs.mjs` — `recordProbeRun()` accepts `recipientEmail`
  only today. §2.4 adds `recipientKind` + `recipientTelegramChatId`.
- `scripts/lib/operator-settings.mjs` — ESM mirror of
  `lib/admin/operator-settings.ts SETTING_SCHEMA`.

### `lib/admin/operator-settings.ts:17-31` ProbeName + `:59-` SETTING_SCHEMA

13 keys today (`scope: ProbeName`). §2.5 adds 2 channel-wide keys with
new `scope: 'telegram'` value (`SettingScope = ProbeName | 'telegram'`).

### probe_runs schema (`migrations/0053_probe_runs.sql:19-52`)

- `:21-23` `probe_name` CHECK — extended to include `'conflict-unresolved'`
  in `migrations/0058`. UNCHANGED here.
- `:25-39` `verdict_kind` CHECK — Telegram rows reuse `alert_sent`,
  `alert_send_failed`, `dedup_skip`, `config_missing`. UNCHANGED.
- `:41` `recipient_email text` — single string. Per-recipient row pattern
  (`docs/plans/bcs-def-1-fanout.md:97-123` §2.1) generalizes naturally.
- `:42` `alert_email_id text` — repurposed §2.4.1 (column-comment update,
  not rename).
- `:43-44` `fingerprint`, `stats` — reused per-row.

### `/admin/settings/alerts` (`app/admin/(gated)/settings/alerts/page.tsx`)

UI extension §2.7: new "Telegram канал" section above the existing 4 probe
sections (channel-wide, not per-probe).

### `scripts/activate-prod-ops.sh`

UNCHANGED — Telegram is a delivery channel; no new systemd units.

---

## 2. Design

### 2.1 Bot setup (operator runbook)

1. Operator opens `@BotFather` → `/newbot` → `TELEGRAM_BOT_TOKEN`.
2. Operator sends `/start` to their own bot from the target Telegram account.
3. Capture chat-id:
   ```
   curl -s "https://api.telegram.org/bot$TG/getUpdates" |
     jq '.result[-1].message.chat.id'
   ```
4. Operator writes both to `/etc/levelchannel/env.d/telegram-alerts.env`
   (mode 0640, root:levelchannel):
   ```
   TELEGRAM_BOT_TOKEN=<token>
   ALERT_TELEGRAM_CHAT_ID=<chat-id-int>
   ```
5. Operator toggles `TELEGRAM_ALERTS_ENABLED=1` via `/admin/settings/alerts`.
6. Next probe alert tick fires Telegram alongside email.

Full runbook lives in `docs/operations.private.md` (operator-side, out of
public-repo scope). PR description carries activation steps inline.

### 2.2 Env contract — soft-skip, not boot-fail

Each probe reads at module scope (mirrors `ALERT_EMAIL_TO` at
`scripts/conflict-unresolved-alert.mjs:75`):

```js
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
const ALERT_TELEGRAM_CHAT_ID = process.env.ALERT_TELEGRAM_CHAT_ID?.trim() || ''
```

**Soft-skip, not boot-fail.** If `TELEGRAM_ALERTS_ENABLED=1` AND
(`TELEGRAM_BOT_TOKEN` empty OR chat-id empty) → write `config_missing` row
with `recipient_kind='telegram'`, do NOT advance state. Email path continues
on the same tick. Rationale: parity with the Resend soft-skip at
`scripts/conflict-unresolved-alert.mjs:475-491`. A hard boot-fail would
couple the two channels — Telegram misconfig would suppress email which is
the wrong default.

`TELEGRAM_ALERTS_ENABLED=0` (default) → skip the Telegram block entirely
(no row, no API call). Default OFF lets the wave ship before BotFather setup
completes.

### 2.3 Message format — short summary + deep-link

Telegram caps `sendMessage` at 4096 chars. Probe emails can hit 2-3KB.

**Decision: 4-6 line digest + deep-link to `/admin/settings/alerts`.** NOT
a Telegram-truncated body + email-full split.

**Rationale.** Truncated-but-substantive Telegram body risks misinformed
mobile action (operator reads truncated msg, takes action, never opens
email). A bare paging signal forces consultation of the full email or admin
page — same source of truth.

**Body shape** (per-probe — only the headline second-line varies):

```
LevelChannel ops — conflict-unresolved
12 unresolved conflicts at 5 teachers (>2h old)
Full report: https://levelchannel.ru/admin/settings/alerts
```

`buildTelegramBody(probeName, summary)` is a NEW pure helper exported from
EACH probe script (sibling to `buildEmail()`). Body MUST stay ≤ 1024 chars
(well under 4096); tested in §3.2.

**Plain text only.** No `parse_mode=Markdown` / `MarkdownV2` — escape-character
footguns aren't worth bold/links for paging utility. Tracked under §10.3.

### 2.4 probe_runs row shape — per-recipient rows + recipient_kind

**Decision: per-recipient rows, NOT a new sidecar column.**

| Option | Pros | Cons |
|---|---|---|
| **Per-recipient rows (chosen)** | Reuses FANOUT precedent (`docs/plans/bcs-def-1-fanout.md:97-123` §2.1); per-channel `verdict_kind` lands cleanly (email-OK + Telegram-fail ≠ partial-success enum hole); per-channel message id lands in the existing nullable column (repurposed §2.4.1); future channels (Slack, SMS) scale by adding `recipient_kind` values, NO per-channel migration. | Doubles tick row count: 1 email + 1 Telegram per tick. Within 90-day retention sweep capacity (4 probes × 1 tick/30min × 2 channels ≈ 384 rows/day = ~35K rows over 90 days — trivial). |
| Add `recipient_telegram_chat_id` column to existing row | Single row per tick | `alert_email_id` collides with Telegram msg id (ambiguous); `verdict_kind` cannot reflect "email sent + Telegram failed" (no partial enum); breaks FANOUT per-recipient pattern. |

**Schema change.** Migration `0061_probe_runs_recipient_kind.sql`:

```sql
-- BCS-DEF-1-TG (2026-05-18) — recipient_kind discriminator on probe_runs
-- so per-recipient rows can disambiguate email vs Telegram.
-- ACCESS EXCLUSIVE briefly; probe_runs is small under 90-day retention
-- and recordProbeRun() is best-effort (swallows errors).
alter table probe_runs
  add column if not exists recipient_kind text not null default 'email'
  check (recipient_kind in ('email', 'telegram'));

create index if not exists probe_runs_telegram_latest_idx
  on probe_runs (ran_at desc)
  where recipient_kind = 'telegram' and is_test = false;
```

Default `'email'` backfills correctly: every row written to date carries an
email recipient. PostgreSQL 11+ adds a NOT NULL column with default WITHOUT
rewriting the table.

#### 2.4.1 `alert_email_id` semantics widened, not renamed

The column at `migrations/0053_probe_runs.sql:42` becomes channel-agnostic
via comment-update — holds Resend message id when `recipient_kind='email'`,
Telegram message id (numeric, stringified) when `recipient_kind='telegram'`.

Rename to `alert_message_id` rejected — touch-everywhere change (UI, helper,
test fixtures) for cosmetic gain.

### 2.5 Operator settings additions — 2 channel-wide keys

Adding to `lib/admin/operator-settings.ts SETTING_SCHEMA` AND
`scripts/lib/operator-settings.mjs`:

```ts
TELEGRAM_ALERTS_ENABLED: {
  kind: 'int',  // 0 or 1
  default: 0,
  min: 0, max: 1,
  envName: 'TELEGRAM_ALERTS_ENABLED',
  description: 'master switch (1=on, 0=off); requires TELEGRAM_BOT_TOKEN + '
    + 'ALERT_TELEGRAM_CHAT_ID env vars; OFF by default — turn on after BotFather setup',
  scope: 'telegram',
},
TELEGRAM_ALERTS_RETRY_MAX: {
  kind: 'int',
  default: 2,
  min: 0, max: 5,
  envName: 'TELEGRAM_ALERTS_RETRY_MAX',
  description: 'max retries (1s backoff) on transient Telegram API errors (5xx/network)',
  scope: 'telegram',
},
```

**Type-level**: introduce `SettingScope = ProbeName | 'telegram'`; SETTING_SCHEMA
`scope` field is typed `SettingScope`. Existing per-probe-scope UI grouping
(`scope === probeName`) continues to work for the 13 existing keys; the new
Telegram section reads `scope === 'telegram'`.

### 2.6 Per-probe Telegram send block (sibling to Resend)

Each of the 4 probes gains a block immediately after its Resend block:

1. Guard `settings.TELEGRAM_ALERTS_ENABLED.value === 1` (else skip — no row, no API call).
2. Build `buildTelegramBody(probeName, {headlineFields, siteUrl: SITE_URL})`.
3. If `!TELEGRAM_BOT_TOKEN || !ALERT_TELEGRAM_CHAT_ID` → `recordProbeRun({verdictKind: CONFIG_MISSING, recipientKind: 'telegram', errorMessage: 'missing_*'})`.
4. Else call `await sendTelegramMessage({botToken, chatId, text, retryMax: settings.TELEGRAM_ALERTS_RETRY_MAX.value})`.
5. `recordProbeRun({verdictKind: tgResult.ok ? ALERT_SENT : ALERT_SEND_FAILED, recipientKind:'telegram', recipientTelegramChatId, alertMessageId, fingerprint:fp, stats:enrichedStats, errorMessage: tgResult.ok ? null : tgResult.error})`.

`sendTelegramMessage()` lives in NEW `scripts/lib/telegram-alerts.mjs`
(zero deps — Node 22+ `fetch`). POSTs to
`https://api.telegram.org/bot<token>/sendMessage` with
`{chat_id, text, disable_web_page_preview: true}`. Returns
`{ok:true, messageId} | {ok:false, error}`. Retries 5xx/network with 1s
linear backoff up to `retryMax`. 4xx (bad token, blocked, chat-not-found)
non-retryable.

**State file controlled by EMAIL success.** Advances on email success
regardless of Telegram outcome. Telegram success/failure does NOT touch the
state file. If `dedup_skip` fires (offender set unchanged + within email
dedup window) → BOTH channels skipped (one `dedup_skip` row per channel).
MVP simplification; per-channel state deferred (§10.2). RISK-3 documents
the trade-off.

### 2.7 UI extension — `/admin/settings/alerts`

NEW "Telegram канал" section above the 4 existing probe sections:

- **Master switch row** — `TELEGRAM_ALERTS_ENABLED` (0/1 toggle).
- **Retry knob** — `TELEGRAM_ALERTS_RETRY_MAX`.
- **Env-presence indicators** — `TELEGRAM_BOT_TOKEN` set? chat-id set?
  (server-only env-presence boolean; NEVER value).
- **Last Telegram run** — latest row across all probes where
  `recipient_kind='telegram' and is_test=false`.

`PROBE_TITLES`, `PROBE_NAMES`, `ProbeName` union — UNCHANGED. Telegram is a
delivery channel, not a probe.

---

## 3. Tests

- **3.1 Shared helper** (`tests/scripts/telegram-alerts.test.ts` NEW) —
  happy path; 5xx retry succeeds; 5xx exhaustion → `telegram_5xx_after_retries`;
  4xx non-retry (403 "bot blocked") single attempt; network throw retries;
  body >4096 → `telegram_body_too_long` no API call; `disable_web_page_preview=true`
  always set.
- **3.2 Per-probe `buildTelegramBody`** (4 files extended) — deterministic
  ≤1024-char output with deep-link; headline numbers present (probe-specific);
  idempotent; **regression pin** §4.5 — no `@` or UUID substrings (PII guard).
- **3.3 Per-probe send integration** (`tests/integration/scripts/telegram-alerts-per-probe.test.ts`
  NEW, parametrized over 4 probes):
  - `TELEGRAM_ALERTS_ENABLED=0` → no Telegram row; email unchanged.
  - Enabled + missing token / chat-id → `config_missing` row `recipient_kind='telegram'`.
  - Enabled + mocked 200 → `alert_sent` row + `alert_message_id` populated.
  - Enabled + mocked 403 → `alert_send_failed` row.
  - Email-OK + Telegram-fail → email `alert_sent`, Telegram `alert_send_failed`; state advances (email-driven, §2.6).
  - Email-fail + Telegram-OK → Telegram `alert_sent`, email `alert_send_failed`; state NOT advanced.
  - `dedup_skip` → ONE row per channel.
- **3.4 Migration** (`tests/integration/admin/probe-runs-recipient-kind.test.ts`
  NEW) — post-migration INSERT `recipient_kind='telegram'` ok; `'slack'` fails
  CHECK; pre-migration rows backfilled to `'email'`; index
  `probe_runs_telegram_latest_idx` exists.
- **3.5 Admin page** (`tests/integration/admin/alerts-page-telegram-section.test.ts`
  NEW) — Telegram канал section rendered; master switch reflects DB;
  env-presence indicators reflect server env (mocked); **regression pin**
  — `TELEGRAM_BOT_TOKEN` value never in HTML response body.
- **3.6 Settings drift** (`tests/admin/operator-settings.test.ts` modified) —
  Telegram keys in expected schema; `scope='telegram'` in `validScopes`.

---

## 4. Security analysis

- **4.1 Bot-token secrecy.** Long-lived shared secret; compromise = attacker
  sends arbitrary messages to operator's bot conversation (phishing risk).
  Mitigations: `/etc/levelchannel/env.d/telegram-alerts.env` mode 0640
  root:levelchannel (same as `RESEND_API_KEY`); never logged; never in
  `error_message`; never in client bundle. §3.5 regression-pins the
  no-client-leak property.
- **4.2 Chat-id integrity.** Not secret per se, but env-file write would
  redirect alerts. Same file-perm control as the token.
- **4.3 Bot blocked.** Telegram returns 403; probe records
  `alert_send_failed`; operator notices missing pages + UI panel. Runbook
  step: don't block the ops bot.
- **4.4 Rate limit.** Telegram: 30 msg/s global, 1 msg/s per chat. Peak
  ~1 msg/min. Not a real risk. Documented only.
- **4.5 No PII in Telegram body.** §2.3 keeps Telegram body to headlines +
  deep-link. NO teacher emails, slot IDs, calendar event IDs. Email body
  remains the full report (operator inbox under TLS). §3.2 regression-pinned.
- **4.6 Migration ACCESS EXCLUSIVE.** Migration 0061 adds a NOT NULL column
  with default — PostgreSQL 11+ metadata-only, no table rewrite. CHECK
  validation scan is sub-second on a small table.

---

## 5. Decomposition — one-PR epic

Single PR. Files:

```
docs/plans/bcs-def-1-tg-telegram-alerts.md                   (NEW, this file)
migrations/0061_probe_runs_recipient_kind.sql                (NEW)
scripts/lib/telegram-alerts.mjs                              (NEW ~120 LOC)
scripts/lib/probe-runs.mjs                                   (modified — recipientKind + recipientTelegramChatId params)
scripts/lib/operator-settings.mjs                            (modified — 2 keys; SettingScope mirror)
lib/admin/operator-settings.ts                               (modified — SettingScope type + 2 keys)
lib/admin/probe-status.ts                                    (modified — getLatestTelegramRun helper)
scripts/auth-flow-alert.mjs                                  (modified — Telegram block + buildTelegramBody)
scripts/calendar-pathology-alert.mjs                         (modified — same)
scripts/webhook-flow-alert.mjs                               (modified — same)
scripts/conflict-unresolved-alert.mjs                        (modified — same)
app/admin/(gated)/settings/alerts/page.tsx                   (modified — Telegram канал section)
tests/scripts/telegram-alerts.test.ts                        (NEW)
tests/scripts/{auth-flow,calendar-pathology,webhook-flow,conflict-unresolved}-alert.test.ts  (extended)
tests/integration/scripts/telegram-alerts-per-probe.test.ts  (NEW)
tests/integration/admin/probe-runs-recipient-kind.test.ts    (NEW)
tests/integration/admin/alerts-page-telegram-section.test.ts (NEW)
tests/admin/operator-settings.test.ts                        (modified)
ENGINEERING_BACKLOG.md                                       (modified — strikethrough BCS-DEF-1-TG)
docs/plans/conflict-unresolved-alert.md                      (modified — §10.2 cross-ref)
docs/plans/bcs-def-1-fanout.md                               (modified — §10 cross-ref)
ARCHITECTURE.md                                              (modified — alert delivery channels)
lib/admin/README.md                                          (modified — Telegram channel row)
```

**Estimated diff:** ~900 LOC.

**Why one PR, not split per-probe:**

- The 4 probe edits are mechanical mirrors. Splitting creates 4 PRs that all touch the same shared helper + migration — high re-merge friction.
- Migration must land BEFORE any probe writes `recipient_kind='telegram'`. Coupling probe edits + migration avoids ordering hazards.
- `TELEGRAM_ALERTS_ENABLED` OFF by default → channel dormant post-merge; activation is operator-side env+toggle, decoupled from PR landing.

**Critical-path:** `lib/admin/operator-settings.ts` IS on critical path. Trailer
carries `Codex-Paranoia: SIGN-OFF round N/3` (one-PR epic; plan + wave collapsed).

---

## 6. Risks + mitigations

- **RISK-1 — Bot-token rotation breaks alerts silently.** Rotate without
  updating env → 401 every tick; email still works. `alert_send_failed`
  rows accumulate; UI panel surfaces the verdict. Red-badge for N
  consecutive failures deferred to BCS-DEF-1-TG-UX (§10.6).
- **RISK-2 — Chat-id stability.** Telegram chat-ids are stable per
  (bot, user). Delete-and-re-`/start` returns the same id (keyed on user,
  not chat instance). Account-switch requires env rotation; same
  mitigation as RISK-1.
- **RISK-3 — Email-success state-advance loses Telegram retries.** State
  file controlled by email success (§2.6). Telegram-only failure for the
  same offender set is NOT retried next tick. Acceptable for MVP — email
  is primary; offender set preserved in `probe_runs` for forensic recovery.
  Per-channel state deferred to BCS-DEF-1-TG-PERCHANNEL-STATE (§10.2);
  §3.3 pins behavior.
- **RISK-4 — Alert-spam: both channels fire same incident.** Intentional —
  Telegram is paging, email is the report; complementary not redundant.
  `TELEGRAM_ALERTS_ENABLED` master switch + default OFF cap blast radius.
- **RISK-5 — Bot blocked by recipient.** See §4.3. Documented in operator
  runbook; verdict surfaces in UI.
- **RISK-6 — Telegram network outage.** Retries 5xx/network up to
  `TELEGRAM_ALERTS_RETRY_MAX`; falls through to `alert_send_failed`. Email
  path unaffected (independent HTTP txn).
- **RISK-7 — Per-probe drift.** 4 probes carry copy-paste blocks. Shared
  `sendTelegramMessage` + uniform body shape reduce per-probe boilerplate
  to ~6 lines. A higher-order `withTelegramChannel(probe, sendEmail)`
  wrapper deferred.
- **RISK-8 — `alert_email_id` repurpose.** Per §2.4.1 we keep the column
  name + update the comment. Future renamer touches fewer places; reader
  treats the field as opaque.

---

## 7. Acceptance criteria

The PR ships when:

- Migration 0061 applies clean on a fresh test DB.
- `npm run test:run` green.
- `npm run test:integration` green.
- `npm run build` green.
- `/codex-paranoia plan` SIGN-OFF on this file (round N/3).
- `/codex-paranoia wave` SIGN-OFF on the implementation diff (round N/3).
- PR commit body trailer:
  ```
  Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
  Critical-Path-Touched: lib/admin/operator-settings.ts
  Skill-Used: /codex-paranoia plan + /codex-paranoia wave
  ```
- ENGINEERING_BACKLOG.md strikethrough BCS-DEF-1-TG.

Post-merge (operator-side):

- Operator runs BotFather setup (§2.1).
- Operator writes env vars; toggles master switch.
- Next probe alert tick fires Telegram → operator confirms receipt.

---

## 8. Pre-canned answers for paranoia round 2

- **Q1.** Telegram Markdown for clickable links? **A:** No (§2.3) — escape
  footguns. Future §10.3.
- **Q2.** Default ENABLED ON? **A:** No — OFF lets the wave ship without
  forcing BotFather setup pre-merge.
- **Q3.** Telegram-truncated + email-full? **A:** Rejected (§2.3) —
  partial-info mobile action risk.
- **Q4.** Per-operator chat-id map MVP? **A:** No — admin onboarding flow
  non-trivial. §10.1.
- **Q5.** Slack / SMS? **A:** Same per-recipient row pattern + new
  `recipient_kind` value; out of scope (§10.5).
- **Q6.** Email-controlled state-advance? **A:** §2.6 + RISK-3. MVP
  simplification; PERCHANNEL-STATE follow-up.

---

## 9. Migration / rollout

1. PR opens.
2. CI runs migration 0061 against test DB → green.
3. PR merges (squash) to main.
4. Autodeploy timer picks up the commit; Next.js restarts.
5. `TELEGRAM_ALERTS_ENABLED=0` → Telegram dormant; email path unchanged.
6. Operator follows §2.1 runbook.
7. Next alert tick fires Telegram → confirmed via UI "Last Telegram run".

**No ordering hazard.** Migration 0061 is purely additive. Probe scripts
gated by enabled-switch; first row only after activation.

---

## 10. Out of scope — deferred follow-ups

- **10.1 BCS-DEF-1-TG-MULTIRECIP** — per-operator chat-id mapping. Needs
  admin `/start` onboarding flow; bot-side HTTP webhook handler (NEW
  Next.js API route); per-admin opt-in toggle in `/admin/profile`;
  `recipient_telegram_chat_id` column on `probe_runs` (or join table).
  Out of scope until a second operator joins.
- **10.2 BCS-DEF-1-TG-PERCHANNEL-STATE** — per-channel state file. Per
  §2.6 + RISK-3. Lets Telegram retry independently of email. Deferred
  until operator reports Telegram-only failure recurrence.
- **10.3 BCS-DEF-1-TG-RICHFORMAT** — `parse_mode=MarkdownV2` + inline
  keyboard. Visual upgrade; escape-footgun cost.
- **10.4 Teacher fan-out over Telegram** — requires BCS-DEF-1-FANOUT
  (teacher email — pending) AND BCS-DEF-1-TG-MULTIRECIP (per-teacher
  chat-id capture).
- **10.5 Slack / SMS / other channels** — pattern set by this plan
  (per-recipient rows + `recipient_kind` discriminator). Each future
  channel = separate plan + new helper + new CHECK value.
- **10.6 BCS-DEF-1-TG-UX** — red badge in `/admin/settings/alerts` after
  N consecutive Telegram failures.

---

## 11. Final trailer expectations

```
Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
Critical-Path-Touched: lib/admin/operator-settings.ts
Skill-Used: /codex-paranoia plan + /codex-paranoia wave
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

— END OF DRAFT (awaiting paranoia plan-mode round 1) —
