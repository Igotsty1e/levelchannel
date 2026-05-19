# BCS-DEF-1-TG — Telegram alert channel for operator-side probes

**Status:** SIGN-OFF 2026-05-19 — plan-paranoia round-3 returned SIGN-OFF (0 BLOCKERs, 4 WARNs + 2 INFOs); WARN/INFO closures applied inline (see §0c). Plan unblocked for implementation.
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

## 0a. Plan-paranoia round-1 closure summary (2026-05-19)

Round 1 returned **BLOCK** with **6 BLOCKERs + 2 WARNs**. Every finding was substantive and grounded in real call-sites; closures applied below (concrete plan edits referenced § anchors after this table).

| Round-1 finding | Closure |
|---|---|
| **BLOCKER#1** — `scope: 'telegram'` keys would be silently dropped by both `resolveOperatorSettingsForProbe()` paths (`scripts/lib/operator-settings.mjs:180-187` filters `schema.scope === probeName`; `lib/admin/operator-settings.ts:277-283` does the same). New Telegram channel-scope keys are invisible to probes. | §2.5 revised — replace per-probe-scope filter with a TWO-source resolve contract. NEW `resolveChannelSettings(pool, channel)` ESM + TS twin returns Telegram channel-scope keys. Each probe calls BOTH `resolveOperatorSettingsForProbe(pool, probeName)` AND `resolveChannelSettings(pool, 'telegram')`; the Telegram block reads from the channel snapshot, not the probe snapshot. §1.1 inventory expanded to flag both helper files. §3.6 test additions in §3.6a below.  |
| **BLOCKER#2** — Env-loading contract mismatch. Probes use `EnvironmentFile=__LEVELCHANNEL_ENV_FILE__` (single file rendered by `scripts/activate-prod-ops.sh`); Next.js admin page reads the same single file via autodeploy. `/etc/levelchannel/env.d/telegram-alerts.env` is unreferenced by any unit — operator writing there is a no-op. | §2.1 runbook rewritten — operator appends `TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID` to the SAME existing `$ENV_FILE` that `activate-prod-ops.sh` manages (path is operator-specific; runbook uses the script's resolved `ENV_FILE` shell var). §1.1 inventory keeps `scripts/activate-prod-ops.sh` UNCHANGED for systemd units but flags the env-file contract: both probes and Next.js consume the same file, no env.d/ fan-out introduced. RISK-9 added — env-file rotation lock-step. |
| **BLOCKER#3** — Channel-independence promise breaks because email control flow has multiple `return` early-exits BEFORE the Telegram sibling block would run. `scripts/calendar-pathology-alert.mjs:251-268, :271-314` and `scripts/conflict-unresolved-alert.mjs:560-577, :579-618` all return-early on `config_missing` / transport-throw / `sent.error`. Telegram never executes on those ticks. | §2.6 rewritten — channels now run via a **gather-then-dispatch** orchestration. Each probe's send-decision computes a single `AlertVerdict {fingerprint, subject, emailBody, telegramSummary, enrichedStats}` BEFORE entering channel-dispatch. Then TWO independent `try/await` blocks fire in sequence inside their own try-scopes (`tryEmailChannel(verdict)` then `tryTelegramChannel(verdict)`); neither returns from the outer `main()`. Each block records its own `probe_runs` row and returns its own status; outer `main()` advances state only on email-OK (RISK-3 unchanged) but ALWAYS reaches the Telegram block, even if email threw or returned a config_missing verdict. §3.3 test cases EXPANDED — "email transport throws → Telegram block still runs and records alert_sent or alert_send_failed depending on Telegram mock", with explicit assertions on both probe_runs rows. The same refactor lands across all 4 probes; §5 file list flagged the auth-flow + webhook-flow paths (which use a single `sendAlertEmail()` helper instead of inline) as needing the same gather-then-dispatch shape. |
| **BLOCKER#4** — Secret-redaction not enforceable. `recordProbeRun()` writes `errorMessage` raw (`scripts/lib/probe-runs.mjs:70-103`); probe logs print raw `err.message`; test-send route returns provider error in JSON. Telegram 4xx description fields may echo token suffix → token leaks to DB, journald, and operator response. | §4.1 + §2.6 + §2.7 hardened. NEW pure helper `redactTelegramSecret(text, token)` in `scripts/lib/telegram-alerts.mjs` — replaces ANY occurrence of `token`, the last 8 chars of `token`, and the substring after the `bot` keyword in error strings with `[REDACTED]`. Every call site that touches a Telegram error MUST funnel through this helper BEFORE: (a) `recordProbeRun({errorMessage})`, (b) `console.warn/error` log lines, (c) the test-send route's JSON response. §3.1 test additions in §3.1a — fixture errors containing token are confirmed redacted on the way out. §1.1 inventory: this helper is module-scoped, no `process.env` capture (token passed in as arg so it's not a global lookup). |
| **BLOCKER#5** — Deploy-before-migrate window: `lib/admin/probe-status.ts:80-138` only handles `42P01` (relation missing) via `isUndefinedTableError`; once admin queries reference `recipient_kind`, a `42703` (column missing) on the pre-migration window 500s the admin page. | §9 rewritten with a HARD ordering requirement: migration 0061 MUST apply BEFORE the new build lands. Two-step deploy: (a) PR merges with migration 0061 file added, autodeploy script runs migrations FIRST then restarts Next.js (audit `scripts/activate-prod-ops.sh` to confirm migrate-before-restart ordering — added to §1.1 as a PRE-PR audit); (b) NEW pure helper `isUndefinedColumnError(err)` in `lib/db/errors.ts` (sibling to `isUndefinedTableError`) checks `err.code === '42703'`. `lib/admin/probe-status.ts` catch-block widened to return `{migrationPending: true}` on EITHER 42P01 OR 42703. §3.4 test additions in §3.4a pin both fallback paths. §1.1 inventory: add `lib/db/errors.ts` and `lib/admin/probe-status.ts` widening to the touch list. |
| **BLOCKER#6** — Per-probe admin queries conflate channels post-migration. `getProbeStatus()` runs "latest row per probe" + "latest alert per probe" without channel filter; UI labels as `recipientEmail` and `resend:`. Telegram rows will mis-render under the email-channel UI. | §2.7 + §2.4 revised: every existing per-probe query in `lib/admin/probe-status.ts:83-100, :118-130` gains `and recipient_kind = 'email'` filter so the legacy "Last run" / "Last alert" cards keep email-channel semantics. NEW `getLatestTelegramRun()` helper (already in §1.1 inventory) renders into the dedicated "Telegram канал" section (§2.7). UI never reads a Telegram row and labels it `Resend`. §3.5 test additions in §3.5a — after seeding both email and Telegram rows for the same probe, the per-probe card shows ONLY the email row; the Telegram section shows ONLY the Telegram row. |
| **WARN#1** — `tests/integration/admin/alerts-obs.test.ts:188-222` manually recreates `probe_runs` after `drop table` to test migration_pending. Schema shadow drifts from migration 0061. | §3.4 / §5 — the test-shadow CREATE TABLE / index re-creation must mirror migration 0061: add `recipient_kind text not null default 'email' check (...)` and the new partial index. Added to §5 file inventory as `tests/integration/admin/alerts-obs.test.ts` (modified). §3.4 acceptance pin — assertion that the recreated shadow rejects `recipient_kind='slack'`. |
| **WARN#2** — Plan silently skips Telegram test-send while the live `/api/admin/settings/alerts/[probe]/test-send/route.ts` + UI button are hard-coded email-only. Operator has no BotFather verification before first real incident. | §10.7 NEW deferred entry — **BCS-DEF-1-TG-TESTSEND** — adds a parallel Telegram test-send path. Explicit limitation documented in §2.1 runbook ("test-send button currently only verifies Resend; verify Telegram by inducing a real low-impact alert tick — see runbook footnote"). §10 follow-up unblocks the standalone testability story once the core MVP ships. WARN#2 closure is documentation-only, not impl. |

After these closures the design is no longer free-form: it explicitly hooks the new helper to a CHANNEL-scope resolve, threads the redactor through three sinks, widens the migration-pending guard, refactors the probe control flow to gather-then-dispatch, and pins the test-shadow to mirror migration 0061. Round 2 will adversarially re-attack the revised plan.

---

## 0b. Plan-paranoia round-2 closure summary (2026-05-19)

Round 2 returned **BLOCK** with **3 BLOCKERs + 2 WARNs**. Every finding was substantive; closures applied below.

| Round-2 finding | Closure |
|---|---|
| **R2 BLOCKER#1** — §9 invented a wrong autodeploy order (`git pull → npm install → migrate:up → build → restart`) and pointed the audit at `scripts/activate-prod-ops.sh`, which does NOT run migrations. The real autodeploy contract is in `docs/private/OPERATIONS.private.md:33-37,254-259`: `<autodeploy-runner binary>` does `clone → npm ci → npm run build → npm run migrate:up → swap → health-check` — meaning `migrate:up` runs AFTER `npm run build` but BEFORE the symlink swap (under the OLD live process). Migrations are required to be additive-only so the OLD code keeps working over them. | §9 rewritten to cite the real source-of-truth (`docs/private/OPERATIONS.private.md:33-37` table row + `:254-259` runner wiring) and the real ordering: `npm run build → npm run migrate:up → swap → health-check`. Column 0061 is additive-only (NOT NULL + default 'email' = metadata-only on PG11+); the OLD shipped code never reads `recipient_kind`, so build-before-migrate is safe. The widened 42703 catch (§2.7.2) remains the belt-and-suspenders defense for the post-swap brief window where NEW code is live but `recipient_kind` may have been ROLLED-BACK in a deploy-recovery scenario. Pre-PR audit item DELETED — the contract is already documented in OPERATIONS.private.md and the wave conforms to it. |
| **R2 BLOCKER#2** — gather-then-dispatch refactor still ambiguous on (a) where the conflict-unresolved REPEATABLE READ snapshot block lives, (b) whether `tryEmailChannel` is shared across 4 probes or per-probe, (c) how webhook-flow's existing `sendAlertEmail()` return-contract helper unifies with the new shape. | §2.6 expanded with §2.6.1 — explicit per-probe commitment: each probe gets its OWN `tryEmailChannel()` and `tryTelegramChannel()`, NOT shared (the 4 probes' verdict shapes diverge enough that shared extraction would force unstable abstractions; copy-paste cost is accepted under RISK-7). For `conflict-unresolved`, the REPEATABLE READ snapshot block stays IN PLACE in `main()` (the existing `pool.connect() → BEGIN → SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` at `scripts/conflict-unresolved-alert.mjs:472-510`); after the snapshot reads close (`COMMIT + release`), the resulting `counts/offenders/perTeacherOmitted/fingerprintTuples` form the `verdict` object passed to BOTH channels. For `webhook-flow`, the existing `sendAlertEmail()` helper at `scripts/webhook-flow-alert.mjs:133-217` is renamed `tryEmailChannel()` and the new `tryTelegramChannel()` is its sibling — its return-contract `{ok, error, emailId}` shape already matches the new shared contract; minimal change. For `auth-flow` and `calendar-pathology` the inline email blocks are extracted in-place into per-probe `tryEmailChannel()` helpers; no shared module. RISK-7 updated to acknowledge the per-probe boilerplate IS ~30-50 lines per probe, NOT the old ~6-line claim. |
| **R2 BLOCKER#3** — Redaction fixture set tests the WRONG threat surface (invented JSON bodies, not real `TypeError`/abort messages that carry the request URL `/bot<TOKEN>/...`). Plan pseudocode references `redactedMsg(err)` which is not defined anywhere. | §3.1a fixture set rewritten in §3.1b below — fixtures now use REAL error shapes produced by `fetch()`+`AbortController` against an invalid Telegram URL (TypeError with URL in message, AbortError with cause carrying request init). §2.6 + §4.1 explicitly say the redactor's threat-surface contract: "any string derived from an exception thrown by `sendTelegramMessage()`, BEFORE it crosses into recordProbeRun / log line / route response." Pseudocode renamed `redactedMsg(err)` → `redactTelegramSecret(stringifyErr(err), TELEGRAM_BOT_TOKEN)`; the helper signature is `(text: string, token: string) => string` — error stringification is the caller's job. §2.6 pseudocode updated. |
| **R2 WARN#1** — Channel-scope resolver test doesn't pin the full DB→env→default precedence and merge-order collision invariant. | §3.6a extended in §3.6b below — adds env-override-only assertion, env-override-overridden-by-DB assertion, and explicit no-collision invariant test. §2.5.1 gains a one-line normative statement: "Channel-scope key names MUST NOT collide with any probe-scope key name; CI test §3.6b asserts the partition." |
| **R2 WARN#2** — Dedup-skip branch contradicts master-switch semantics: §2.5 says `TELEGRAM_ALERTS_ENABLED=0` ⇒ no Telegram row, no API call; §2.6 says dedup_skip emits TWO rows (one per recipient_kind) BEFORE channel fan-out. With master switch off, the Telegram dedup_skip row would still write. | §2.6 dedup-skip branch revised — the SHARED skip emits exactly the email row unconditionally and ONLY emits the Telegram dedup_skip row if `settings.TELEGRAM_ALERTS_ENABLED.value === 1`. §3.3 dedup_skip test cases extended in §3.3b below to cover both states of the master switch. |

After these closures the plan now cites the real autodeploy contract, commits to per-probe (not shared) channel-dispatch helpers with explicit snapshot-block preservation, anchors the redactor to the real `fetch` error surface, and seals the master-switch×dedup-skip interaction. Round 3 will adversarially re-attack the round-2 revised plan.

---

## 0c. Plan-paranoia round-3 SIGN-OFF + WARN/INFO closures (2026-05-19)

Round 3 returned **SIGN-OFF** with 0 BLOCKERs, 4 WARNs + 2 INFOs. WARN/INFO closures applied inline below.

| Round-3 finding | Closure |
|---|---|
| **INFO#1** — R2 core BLOCKER closures verified against live sources: §9 matches autodeploy in `docs/private/OPERATIONS.private.md:33,254`; conflict-unresolved snapshot at `scripts/conflict-unresolved-alert.mjs:472`; webhook-flow `{ok,error,emailId}` helper at `scripts/webhook-flow-alert.mjs:136`; redaction sinks threaded in §2.6. | No action — positive confirmation. |
| **WARN#2** — §2.6.1 wrong about auth-flow needing inline extraction: auth-flow already has `sendAlertEmail()` at `scripts/auth-flow-alert.mjs:233` with call-site at `:424`, mirroring webhook-flow. | §2.6.1 auth-flow bullet revised: rename `sendAlertEmail()` → `tryEmailChannel()` (mirrors webhook-flow path). Only calendar-pathology genuinely needs inline-block extraction. |
| **WARN#3** — §3.1b fixture capture is non-deterministic across platforms (sinkholed DNS / unreachable IP error strings vary). | §3.1b revised to use a frozen-string approach: capture each `TypeError`/`AbortError` fixture ONCE at test-suite-bootstrap by hitting `http://127.0.0.255:1` (RFC-5735 unreachable address) with a 5ms `AbortController` timeout, freeze the resulting `err.message` + `String(err.cause)` into `tests/scripts/fixtures/telegram-fetch-errors.json` (committed). Tests assert against the frozen strings; fixture regeneration is a manual step documented in §3.1b. Removes CI flakiness. |
| **WARN#4** — Post-merge Telegram verification underspecified — operator may wait days for next real alert. | §2.1 step 7 expanded with concrete prod-safe verification: operator induces a synthetic alert by temporarily setting `CALENDAR_PATHOLOGY_HOURLY_THRESHOLD=0` via the admin UI (lowest-blast-radius probe, fires at next 30-min tick with zero offenders → alert verdict + no PII). Operator confirms Telegram delivery, restores the threshold. Single-command rollback. §10.7 BCS-DEF-1-TG-TESTSEND remains the proper long-term fix. |
| **WARN#5** — Round-2 doc-truth gaps: §2.1 cites nonexistent `docs/operations.private.md` (real path is `docs/private/OPERATIONS.private.md`); §6 RISK-7 still claims "~6 lines" while §2.6.1 says 30-50. | Both fixed: §2.1 footer corrected to `docs/private/OPERATIONS.private.md`; §6 RISK-7 LOC estimate revised to 30-50 lines per probe. |
| **INFO#6** — §3.6b key-disjointness invariant should be scope-set-based, not name-prefix-based, for future-proofing. | §2.5.1 + §3.6b sharpened: the invariant test now iterates `Object.keys(SETTING_SCHEMA)` and asserts the set of keys with `scope === 'telegram'` is DISJOINT from the set of keys whose scope is in `ProbeName`, partitioning the schema cleanly. No reliance on name prefix. |

All round-3 closures are documentation-only edits; no design or correctness change since the round-2 SIGN-OFF-equivalent state. Implementation is **unblocked**.

PR commit body trailer:
```
Codex-Paranoia: SIGN-OFF round 3/3 (BCS-DEF-1-TG plan checkpoint; impl unblocked)
Skill-Used: /codex-paranoia plan
```

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
  `lib/admin/operator-settings.ts SETTING_SCHEMA`. **R1 BLOCKER#1** —
  `resolveOperatorSettingsForProbe()` at `:180-187` filters
  `schema.scope === probeName`; channel-scope keys are invisible. §2.5
  adds a SECOND helper `resolveChannelSettings(pool, channel)` that
  filters `schema.scope === channel`.
- `lib/db/errors.ts` — currently exports `isUndefinedTableError(err)`
  (`err.code === '42P01'`). §1.1.5 (BLOCKER#5) adds sibling
  `isUndefinedColumnError(err)` (`err.code === '42703'`).
- NEW `scripts/lib/telegram-alerts.mjs` — `sendTelegramMessage` +
  `redactTelegramSecret(text, token)` (BLOCKER#4). Module-scoped,
  zero deps, no `process.env` capture (token passed as arg).

### `lib/admin/operator-settings.ts:17-31` ProbeName + `:59-` SETTING_SCHEMA

13 keys today (`scope: ProbeName`). §2.5 adds 2 channel-wide keys with
new `scope: 'telegram'` value (`SettingScope = ProbeName | 'telegram'`).
**R1 BLOCKER#1**: live `resolveOperatorSettingsForProbe()` at `:277-283`
filters `schema.scope === probeName`. §2.5 adds twin
`resolveChannelSettings()` in TS that filters `schema.scope === channel`;
the existing helper remains untouched so the 13 per-probe keys keep
their current resolution path.

### `lib/admin/probe-status.ts:72-138` deploy-before-migrate guard

**R1 BLOCKER#5**: today only `42P01` is treated as "migration pending"
(`isUndefinedTableError`). §2.4 column add introduces a window where
`42703` (column missing) can fire if Next.js code referencing
`recipient_kind` boots before migration 0061 applies. §1.1.5 + §2.4
widen the catch to BOTH SQLSTATEs.

### `scripts/activate-prod-ops.sh` env-file contract (NOT a migration runner)

**R1 BLOCKER#2 + R2 BLOCKER#1**: `scripts/activate-prod-ops.sh`
(a) renders `EnvironmentFile=$ENV_FILE` into systemd unit drop-ins
(`:65-80` / `:127-149` / `:164-179` / `:214-218`), (b) writes
operator-supplied env vars into the SAME `$ENV_FILE` consumed by both
Next.js and probes. It does NOT run migrations — that's
`<autodeploy-runner binary>`'s job, documented at
`docs/private/OPERATIONS.private.md:33-37` / `:254-259`. The Telegram
runbook §2.1 must append to `$ENV_FILE`, not introduce a new file.
Migrate-before-swap ordering already lives in the autodeploy runner;
§9 cites the real source.

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

**R1 BLOCKER#2 closure** — no new env-file path. The systemd probe units
+ the Next.js process load the SAME `$ENV_FILE` rendered by
`scripts/activate-prod-ops.sh` (single-file contract). Telegram env vars
append to that file.

1. Operator opens `@BotFather` → `/newbot` → `TELEGRAM_BOT_TOKEN`.
2. Operator sends `/start` to their own bot from the target Telegram account.
3. Capture chat-id:
   ```
   curl -s "https://api.telegram.org/bot$TG/getUpdates" |
     jq '.result[-1].message.chat.id'
   ```
4. Operator appends both to the SAME prod env file that
   `scripts/activate-prod-ops.sh` manages (`$ENV_FILE` shell var — the
   private runbook resolves the operator-specific path; same file the
   existing `RESEND_API_KEY` / `ALERT_EMAIL_TO` lines live in). Mode +
   ownership remain whatever the operator's existing file uses; no
   `env.d/` sub-tree is introduced.
   ```
   TELEGRAM_BOT_TOKEN=<token>
   ALERT_TELEGRAM_CHAT_ID=<chat-id-int>
   ```
5. Operator restarts the Next.js service AND reloads the systemd
   probe-timer units so both pick up the new env (existing pattern;
   activator runbook step-list documents the exact `systemctl reload-or-restart`
   sequence).
6. Operator toggles `TELEGRAM_ALERTS_ENABLED=1` via `/admin/settings/alerts`
   ONLY after migration 0061 is confirmed applied on prod (see §9).
7. Next probe alert tick fires Telegram alongside email.

**Test-send caveat (R1 WARN#2):** the existing
`/api/admin/settings/alerts/[probe]/test-send` button verifies the
Resend path only. There is NO Telegram test-send in this PR — a
Telegram-specific dry-run is deferred to §10.7 BCS-DEF-1-TG-TESTSEND.

**Post-runbook verification (R3 WARN#4 closure)** — operator confirms
BotFather setup on prod by inducing a synthetic alert:

1. Open `/admin/settings/alerts`, navigate to the `calendar-pathology`
   section, temporarily set `CALENDAR_PATHOLOGY_HOURLY_THRESHOLD=0`
   (lowest blast radius — fires on any non-zero offender count, but
   even zero offenders would not page; the alert body carries
   threshold-context and no PII).
2. Wait ≤30 min for the next probe tick (or `systemctl start
   levelchannel-calendar-pathology-alert.service` for an immediate
   tick).
3. Confirm Telegram delivery in the operator chat AND the new
   "Telegram канал" section's "Last Telegram run" row updates with
   `alert_sent`.
4. Restore the threshold to its prior value via the same admin UI.

This is a one-shot prod-safe verification. §10.7 BCS-DEF-1-TG-TESTSEND
will replace it with a dedicated dry-run button.

Full runbook lives in `docs/private/OPERATIONS.private.md` (operator-side,
out of public-repo scope). PR description carries activation steps inline.

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

### 2.5 Operator settings additions — 2 channel-wide keys + channel-scope resolver

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

#### 2.5.1 NEW channel-scope resolver (R1 BLOCKER#1 closure)

Today's `resolveOperatorSettingsForProbe(pool, probeName)` filters
`schema.scope === probeName` (live code at
`scripts/lib/operator-settings.mjs:180-187` + `lib/admin/operator-settings.ts:277-283`).
A `scope: 'telegram'` key never appears in the per-probe snapshot — the
plan as originally drafted would have left
`settings.TELEGRAM_ALERTS_ENABLED` permanently `undefined` in every
probe's runtime.

Closure — **add a sibling helper** in both files:

```js
// scripts/lib/operator-settings.mjs (mirrors TS twin)
export async function resolveChannelSettings(pool, channel, env = process.env) {
  const keys = Object.entries(SETTING_SCHEMA)
    .filter(([, schema]) => schema.scope === channel)
    .map(([k]) => k)
  // ...identical DB-read + env-fallback logic as resolveOperatorSettingsForProbe,
  // returning { [KEY]: { value, source, rawDb, rawEnv } } for every channel key.
}
```

```ts
// lib/admin/operator-settings.ts
export async function resolveChannelSettings(
  channel: 'telegram',
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, ResolvedSetting>> { /* same shape */ }
```

Each probe `main()` calls BOTH helpers and merges into one local
settings record:

```js
const probeSettings = await resolveOperatorSettingsForProbe(pool, PROBE_NAME)
const channelSettings = await resolveChannelSettings(pool, 'telegram')
const settings = { ...probeSettings, ...channelSettings }
```

Existing 13-key resolution path UNCHANGED — the channel helper is
purely additive. §3.6 test `expectedSchemaKeys` extended to assert both
helpers return the right partitions of `SETTING_SCHEMA`.

**No-collision invariant (R2 WARN#1 + R3 INFO#6 closure):** channel-scope
key names MUST NOT collide with ANY probe-scope key name. The merge
`{...probeSettings, ...channelSettings}` lets channel keys shadow
probe keys on collision; to keep per-probe semantics deterministic,
the CI test §3.6b asserts disjoint key partitions BY SCOPE
MEMBERSHIP (not name prefix): the set
`{k ∈ Object.keys(SETTING_SCHEMA) : SETTING_SCHEMA[k].scope === 'telegram'}`
is disjoint from
`{k ∈ Object.keys(SETTING_SCHEMA) : SETTING_SCHEMA[k].scope ∈ ProbeName}`.
Future channel scopes added beyond `'telegram'` extend the same
disjoint-partition invariant. Any future setting that needs to apply
to both scopes lands as TWO keys (one per scope), not one with
overlapping membership.

### 2.6 Channel dispatch — gather verdict, then fan out (R1 BLOCKER#3 closure)

**Round-1 BLOCKER#3 surfaced:** the original "Telegram block immediately
after Resend block" wording would have placed Telegram code inside a
region where the email path already does `return` early on
`config_missing` / transport-throw / `sent.error` (live early-returns at
`scripts/calendar-pathology-alert.mjs:251-268, :271-314` and
`scripts/conflict-unresolved-alert.mjs:560-577, :579-618`). Email failure
would silently kill the Telegram page — the opposite of the
"independent channels" promise in §1.

**Closure — gather-then-dispatch.** Each probe's send-decision now
computes the alert verdict ONCE, then fans out to channels via two
INDEPENDENT try-blocks that never `return` from outer `main()`:

```js
// Pseudocode for the shape across all 4 probes (PER-PROBE helpers,
// not shared — see §2.6.1).
const verdict = decideVerdict(...)               // probe-specific
if (verdict.kind === 'dedup_skip') {
  await recordProbeRun(pool, {
    probeName: PROBE_NAME,
    verdictKind: VERDICT_KINDS.DEDUP_SKIP,
    recipientKind: 'email',
    recipientEmail: recipientEmailSnapshot,
    fingerprint: verdict.fingerprint,
    stats: verdict.enrichedStats,
  })
  if (settings.TELEGRAM_ALERTS_ENABLED.value === 1) {
    // R2 WARN#2 closure: gated by master switch.
    await recordProbeRun(pool, {
      probeName: PROBE_NAME,
      verdictKind: VERDICT_KINDS.DEDUP_SKIP,
      recipientKind: 'telegram',
      fingerprint: verdict.fingerprint,
      stats: verdict.enrichedStats,
    })
  }
  return
}
if (verdict.kind !== 'alert' && verdict.kind !== 'config_missing') {
  // no-failures / within_thresholds / no_offenders / ok / etc.
  // Single email-only row preserved (per-probe semantics unchanged).
  return
}

const fp = verdict.fingerprint
const enrichedStats = verdict.enrichedStats
const emailBody = verdict.emailBody          // built once
const telegramSummary = buildTelegramBody(   // built once
  PROBE_NAME, verdict.summary, SITE_URL
)

// CHANNEL 1 — email, NEVER returns from main()
let emailOk = false
try {
  emailOk = await tryEmailChannel({ pool, verdict, emailBody, fp, enrichedStats })
} catch (err) {
  // tryEmailChannel itself swallows; outer catch is defensive.
  // Email errors don't carry the Telegram token — no redaction needed.
  logJson('error', 'tryEmailChannel threw unexpectedly', {
    err: err instanceof Error ? err.message : String(err),
  })
}

// CHANNEL 2 — Telegram, runs regardless of email outcome
if (settings.TELEGRAM_ALERTS_ENABLED.value === 1) {
  try {
    await tryTelegramChannel({
      pool,
      verdict,
      telegramSummary,
      fp,
      enrichedStats,
      botToken: TELEGRAM_BOT_TOKEN,
      chatId: ALERT_TELEGRAM_CHAT_ID,
      retryMax: settings.TELEGRAM_ALERTS_RETRY_MAX.value,
    })
  } catch (err) {
    // Telegram errors CAN carry token (URL leaks via TypeError) — redact.
    const raw = err instanceof Error ? err.message : String(err)
    logJson('error', 'tryTelegramChannel threw unexpectedly', {
      err: redactTelegramSecret(raw, TELEGRAM_BOT_TOKEN),
    })
  }
}

// State-file advance (still email-controlled — RISK-3)
if (emailOk) await writeState({ lastAlertAt: now, lastFingerprint: fp })
```

#### 2.6.1 R2 BLOCKER#2 closure — per-probe helpers, snapshot-block stays put

The 4 probes' verdict shapes diverge too much for clean shared extraction
of `tryEmailChannel` / `tryTelegramChannel`. Per-probe helpers (one pair
in each `scripts/{auth-flow,calendar-pathology,webhook-flow,conflict-unresolved}-alert.mjs`)
is the chosen shape. Per-probe details:

- **conflict-unresolved** (`scripts/conflict-unresolved-alert.mjs`): the
  REPEATABLE READ snapshot block (`pool.connect() → BEGIN → SET
  TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` at the existing
  `:472-510`) **stays in `main()`** and runs BEFORE the channel-dispatch.
  Its outputs (`counts`, `offenders`, `perTeacherOmitted`,
  `fingerprintTuples`) compose the `verdict` object. Channel-dispatch
  happens AFTER `COMMIT + snapshotClient.release()`. No DB consistency
  regression vs the existing shipped flow.
- **webhook-flow** (`scripts/webhook-flow-alert.mjs:133-217`): the
  existing `sendAlertEmail({stats, verdict})` helper IS the email
  channel — rename to `tryEmailChannel()` (return shape `{ok, error,
  emailId}` already matches), then add `tryTelegramChannel()` as a
  sibling. No state file; no dedup_skip path; webhook-flow's Telegram
  block fires on every 'alert' verdict.
- **auth-flow** (`scripts/auth-flow-alert.mjs`): **R3 WARN#2 closure** —
  auth-flow ALREADY has `sendAlertEmail()` at `:233` with call-site at
  `:424`, mirroring webhook-flow's shape. Rename → `tryEmailChannel()`;
  no inline extraction needed. State file behavior preserved.
- **calendar-pathology** (`scripts/calendar-pathology-alert.mjs`): the
  only probe where the email send-block is genuinely inline (no
  pre-extracted helper) — extract in-place into a local
  `tryEmailChannel()` function; shape mirrors the others' return
  contract.

RISK-7 updated: per-probe boilerplate is ~30-50 lines per probe (not
~6). The trade-off is "stable abstractions over premature DRYing."

`tryEmailChannel` and `tryTelegramChannel` are NEW per-probe helpers
(or shared if 4-way extraction is clean — drift risk traded against
copy-paste cost; see RISK-7). Each:

- Handles its own config_missing / send_failed / send_succeeded branch.
- Records exactly ONE `probe_runs` row (recipientKind set correctly).
- Returns a boolean `ok` / does not throw to outer `main()`.

`tryTelegramChannel` internals:

1. If `!TELEGRAM_BOT_TOKEN || !ALERT_TELEGRAM_CHAT_ID` →
   `recordProbeRun({verdictKind: CONFIG_MISSING, recipientKind: 'telegram',
   errorMessage: 'missing_*'})` and return `false`.
2. Else `await sendTelegramMessage({botToken, chatId, text, retryMax})`.
3. `recordProbeRun({verdictKind: tgResult.ok ? ALERT_SENT : ALERT_SEND_FAILED,
   recipientKind:'telegram', alertMessageId: tgResult.messageId,
   fingerprint:fp, stats:enrichedStats,
   errorMessage: tgResult.ok ? null : redactTelegramSecret(tgResult.error, botToken)})`.

`sendTelegramMessage()` lives in NEW `scripts/lib/telegram-alerts.mjs`
(zero deps — Node 22+ `fetch`). POSTs to
`https://api.telegram.org/bot<token>/sendMessage` with
`{chat_id, text, disable_web_page_preview: true}`. Returns
`{ok:true, messageId} | {ok:false, error}`. Retries 5xx/network with 1s
linear backoff up to `retryMax`. 4xx non-retryable. **429 retry_after
handling:** Telegram returns 429 with `parameters.retry_after` (seconds).
Helper treats 429 as retryable up to `retryMax`, but the wait between
retries respects `min(retry_after, 5)` seconds (cap to avoid blocking
the probe job past its expected tick budget). If 429 persists past
`retryMax`, return `{ok:false, error:'telegram_429_after_retries',
retryAfterSeconds}`. **Wall-clock budget:** every `fetch` call uses an
`AbortController` with `setTimeout(controller.abort, 10_000)` so a
hung Telegram connection cannot stall the systemd job indefinitely.

**State file controlled by EMAIL success.** Advances on email success
regardless of Telegram outcome. Telegram success/failure does NOT touch the
state file. If `dedup_skip` fires (offender set unchanged + within email
dedup window) → BOTH channels skipped (TWO `dedup_skip` rows, one per
recipient_kind; emitted from a shared "we're skipping this tick"
branch BEFORE the channel-dispatch fan-out). MVP simplification;
per-channel state deferred (§10.2). RISK-3 documents the trade-off.

**Stateless-probe note (R1 audit candidate #7):** `webhook-flow` has no
state file → no `dedup_skip` path. Plan §2.6 dedup-row-doubling applies
only to the 3 stateful probes. §3.3 test cases parametrized over 4
probes EXCLUDE the dedup case for webhook-flow.

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

#### 2.7.1 R1 BLOCKER#6 closure — preserve email semantics on per-probe cards

After migration 0061 lands, both email and Telegram rows live in
`probe_runs` for the same probes. The existing per-probe cards rendered
by `app/admin/(gated)/settings/alerts/page.tsx:278-293` label
`lastAlert.recipientEmail` and `lastAlert.alertEmailId` with copy that
assumes the email channel. Without a filter, a Telegram row would
surface there as "Resend: <telegram_message_id>" with `(нет адреса)` for
the recipient — incoherent UI.

Closure — `lib/admin/probe-status.ts` queries `getProbeStatus()` at
`:83-100` and `:118-130` gain `and recipient_kind = 'email'` to the
`where` clause. The "Last run" card and "Last alert" card now show
EMAIL-channel rows only. Telegram rows render exclusively in the new
"Telegram канал" section via `getLatestTelegramRun()` (which filters
`recipient_kind = 'telegram'`).

#### 2.7.2 R1 BLOCKER#5 closure — widen migration-pending catch to 42703

`lib/admin/probe-status.ts:133-138` catch currently fires
`{migrationPending: true}` only on `isUndefinedTableError(err)`
(`42P01`). NEW sibling helper `isUndefinedColumnError(err)` in
`lib/db/errors.ts` checks `err.code === '42703'`. `getProbeStatus()` and
the new `getLatestTelegramRun()` widen the catch:

```ts
} catch (err) {
  if (isUndefinedTableError(err) || isUndefinedColumnError(err)) {
    return { migrationPending: true }
  }
  throw err
}
```

Test-send route (`app/api/admin/settings/alerts/[probe]/test-send/route.ts`)
preflight pattern (currently checks 42P01 only) stays as-is for THIS
PR — the route does not query `recipient_kind`. If §10.7
BCS-DEF-1-TG-TESTSEND lands, that PR widens the preflight.

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

### 3.1a R1 BLOCKER#4 closure tests — token redaction (NEW)

`tests/scripts/telegram-alerts.test.ts` extends 3.1 with redaction
fixtures. ~~See §3.1b for the round-2-revised realistic fixtures.~~

### 3.1b R2 BLOCKER#3 closure tests — REAL `fetch`+abort threat surface

The original §3.1a fixtures imagined "token-in-JSON-body" errors —
Telegram doesn't actually echo the token in the response. The REAL
threat surface is the request URL `https://api.telegram.org/bot<TOKEN>/sendMessage`,
which Node's `fetch` includes in `TypeError.message` on connect failure
and in `AbortError.cause` on AbortController abort.

Revised fixture set (every fixture is a string produced by REAL
`fetch()` failure modes; **R3 WARN#3 closure — fixtures are FROZEN to
`tests/scripts/fixtures/telegram-fetch-errors.json` and committed**,
NOT captured live at test-bootstrap, to eliminate CI flakiness from
platform-specific `fetch` error variance):

1. **`TypeError` from unreachable host** — capture once locally by hitting `https://127.0.0.255:1/bot1234567890:ABCDEFGHijklmnopQRSTuvwxyz_-XYZ123/sendMessage` (RFC-5735 special-purpose unreachable address) with a 5ms `AbortController` budget. Freeze the resulting `err.message` + `String(err.cause ?? '')` into the fixture file.
2. **`AbortError` from controller.abort()** — same target, force abort at 1ms BEFORE connection completes. Freeze both `err.message` and `String(err.cause ?? '')` into the fixture file.
3. **`SyntaxError` from JSON parse** — synthesized at test time (no network): `await new Response('not json').json()` throws; this error string is platform-stable, no freezing needed.
4. **JSON body with literal token** — defensive fixture for paranoid forward-compat: synthesize `JSON.stringify({description: 'Forbidden: bot was blocked, token suffix XYZ123'})`.

Fixture regeneration is a manual step documented in a header comment of `tests/scripts/fixtures/telegram-fetch-errors.json`:

```bash
# To regenerate fixtures (run on Node 22+; output is platform-stable enough on linux/darwin
# that one capture covers CI + local):
node tests/scripts/fixtures/regenerate-telegram-fetch-errors.mjs > tests/scripts/fixtures/telegram-fetch-errors.json
```

Each assertion checks: (a) `[REDACTED]` present; (b) full token absent; (c) last 8 chars of token (`_-XYZ123`) absent; (d) `bot1234567890` substring absent. Redactor must redact all FOUR forms in the same pass.

### 3.3b R2 WARN#2 closure tests — dedup_skip × master-switch

Extending §3.3:

- "stateful probe + offenders unchanged + dedup window active + `TELEGRAM_ALERTS_ENABLED=1`" → TWO `probe_runs` rows with `verdict_kind='dedup_skip'`, one each `recipient_kind='email'` / `'telegram'`. No fetch call.
- "stateful probe + offenders unchanged + dedup window active + `TELEGRAM_ALERTS_ENABLED=0`" → ONE `probe_runs` row, `recipient_kind='email'`, `verdict_kind='dedup_skip'`. NO Telegram row, NO fetch call.
- "webhook-flow probe (stateless) — dedup_skip case N/A — alert verdict fires both channels every tick regardless of dedup state". (Already covered by §3.3 enable/disable; restated here for completeness.)

### 3.3a R1 BLOCKER#3 closure tests — channels independent on email failure

Parametrized over 4 probes (or 3, excluding webhook-flow for the
dedup-only subcase). Inside the per-probe block:

- "email config_missing + Telegram enabled" → email row
  `verdict_kind='config_missing' recipient_kind='email'`, Telegram row
  `verdict_kind='alert_sent' recipient_kind='telegram'` (Telegram path
  still runs).
- "email transport throws + Telegram enabled + Telegram 200" → email
  row `verdict_kind='alert_send_failed' recipient_kind='email'`,
  Telegram row `verdict_kind='alert_sent' recipient_kind='telegram'`,
  state file NOT advanced.
- "email transport throws + Telegram 4xx" → both `alert_send_failed`,
  Telegram errorMessage redacted.
- "email 200 + Telegram 5xx exhausts retries" → email `alert_sent`,
  Telegram `alert_send_failed`, state file advanced (email-driven per
  RISK-3).

### 3.4a R1 BLOCKER#5 closure tests — migration-pending 42703

`tests/integration/admin/probe-runs-recipient-kind.test.ts` extends
with: after applying migration 0061 then `alter table probe_runs drop
column recipient_kind`, `getProbeStatus(probeName)` returns
`{migrationPending: true}` (not 500). Symmetric to the existing 42P01
case in `alerts-obs.test.ts:160-181`.

### 3.5a R1 BLOCKER#6 closure tests — per-probe cards filter email-only

`tests/integration/admin/alerts-page-telegram-section.test.ts`
seeding: for a single probe, insert TWO `probe_runs` rows at distinct
`ran_at` — newer Telegram row, older email row. Assert:

- The per-probe card's "Последнее уведомление" shows the OLDER email
  row (its `recipient_email` + `alert_email_id`).
- The "Telegram канал" section's "Last Telegram run" shows the NEWER
  Telegram row.
- No Telegram message id is labeled "Resend".

### 3.6a R1 BLOCKER#1 closure tests — channel-scope resolver

`tests/admin/operator-settings.test.ts` adds:

- `resolveOperatorSettingsForProbe(pool, 'conflict-unresolved')` does
  NOT return `TELEGRAM_ALERTS_ENABLED`.
- `resolveChannelSettings(pool, 'telegram')` returns
  `TELEGRAM_ALERTS_ENABLED` + `TELEGRAM_ALERTS_RETRY_MAX` with default
  values when DB and env are empty.
- DB override of `TELEGRAM_ALERTS_ENABLED=1` propagates through
  `resolveChannelSettings` with `source: 'db'`.
- ESM and TS twins return identical shapes for the same fixture.

### 3.6b R2 WARN#1 closure tests — full precedence + collision invariant

Extending §3.6a:

- **Env-override-only**: DB has no row; `process.env.TELEGRAM_ALERTS_RETRY_MAX='4'` → `resolveChannelSettings(pool, 'telegram')` returns `{value: 4, source: 'env'}`.
- **DB-overrides-env**: DB has row `TELEGRAM_ALERTS_RETRY_MAX='3'`; env has `'4'` → returns `{value: 3, source: 'db'}` (DB beats env, mirrors existing per-probe precedence).
- **Env-malformed → default**: DB no row; env has `'not-a-number'` → returns `{value: 2, source: 'default', rawEnv: 'not-a-number'}` (validate-fail falls through to default — mirrors existing resolver semantics).
- **Channel-scope partition invariant (R3 INFO#6 closure — scope-set-based, not name-prefix-based)**: iterate `Object.keys(SETTING_SCHEMA)`; partition by `SETTING_SCHEMA[k].scope`. Assert `{k : scope === 'telegram'}` ∩ `{k : scope ∈ ProbeName}` is the empty set, where `ProbeName = 'auth-flow' | 'calendar-pathology' | 'webhook-flow' | 'conflict-unresolved'`. Test does NOT rely on name prefix (`TELEGRAM_*`) — it asserts the partition over scope membership directly, so future channel-scope expansions (`'slack'`, `'sms'`, etc.) automatically inherit the invariant.

---

## 4. Security analysis

- **4.1 Bot-token secrecy.** Long-lived shared secret; compromise = attacker
  sends arbitrary messages to operator's bot conversation (phishing risk).
  Mitigations:
  - Stored in the SAME prod `$ENV_FILE` as `RESEND_API_KEY` (R1 BLOCKER#2
    closure — no `env.d/` fan-out). File-perm matches the operator's
    existing convention for that file.
  - **Token redactor enforced at three sinks (R1 BLOCKER#4 closure):**
    NEW `redactTelegramSecret(text, token)` in
    `scripts/lib/telegram-alerts.mjs`. Every Telegram error string MUST
    pass through this helper BEFORE: (a) `recordProbeRun({errorMessage})`,
    (b) `console.warn/error` log lines, (c) any future test-send route
    JSON response (§10.7). The redactor replaces (a) the full token,
    (b) the token's last 8 chars, (c) any `bot<...>` substring in the
    error string with `[REDACTED]`. §3.1a pins fixtures.
  - Never in client bundle. §3.5 regression-pins the no-client-leak
    property (existing test extends to assert no `TELEGRAM_BOT_TOKEN`
    fragment in the admin page HTML response).
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
scripts/lib/telegram-alerts.mjs                              (NEW ~140 LOC — sendTelegramMessage + redactTelegramSecret + 429/AbortController handling)
scripts/lib/probe-runs.mjs                                   (modified — recipientKind + recipientTelegramChatId params)
scripts/lib/operator-settings.mjs                            (modified — 2 keys + NEW resolveChannelSettings)
lib/admin/operator-settings.ts                               (modified — SettingScope type + 2 keys + NEW resolveChannelSettings TS twin)
lib/admin/probe-status.ts                                    (modified — getProbeStatus widened catch to 42703; per-probe queries gain `and recipient_kind='email'`; getLatestTelegramRun helper)
lib/db/errors.ts                                             (modified — NEW isUndefinedColumnError sibling)
scripts/auth-flow-alert.mjs                                  (modified — gather-then-dispatch refactor + tryTelegramChannel)
scripts/calendar-pathology-alert.mjs                         (modified — same)
scripts/webhook-flow-alert.mjs                               (modified — same; webhook-flow has no state file, no dedup_skip case)
scripts/conflict-unresolved-alert.mjs                        (modified — same)
app/admin/(gated)/settings/alerts/page.tsx                   (modified — Telegram канал section)
tests/scripts/telegram-alerts.test.ts                        (NEW — includes §3.1a redaction fixtures)
tests/scripts/{auth-flow,calendar-pathology,webhook-flow,conflict-unresolved}-alert.test.ts  (extended)
tests/integration/scripts/telegram-alerts-per-probe.test.ts  (NEW — includes §3.3a channel-independence cases)
tests/integration/admin/probe-runs-recipient-kind.test.ts    (NEW — includes §3.4a 42703 case)
tests/integration/admin/alerts-page-telegram-section.test.ts (NEW — includes §3.5a per-probe-card-filter case)
tests/integration/admin/alerts-obs.test.ts                   (modified — R1 WARN#1 closure: schema-shadow CREATE TABLE adds recipient_kind column + partial index)
tests/admin/operator-settings.test.ts                        (modified — includes §3.6a channel-scope-resolver assertions)
ENGINEERING_BACKLOG.md                                       (modified — strikethrough BCS-DEF-1-TG; add BCS-DEF-1-TG-TESTSEND entry per §10.7)
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
- **RISK-7 — Per-probe drift.** 4 probes carry per-probe
  `tryEmailChannel()` + `tryTelegramChannel()` helpers (R2 BLOCKER#2
  closure committed per-probe extraction, not shared). Per-probe
  boilerplate is **~30-50 lines per probe** (NOT the original "~6
  lines" estimate; R3 WARN#5 closure). Shared `sendTelegramMessage`
  + uniform body shape + frozen redactor reduce the duplication risk;
  §3.2 regression-pins per-probe body shape; §3.3a + §3.3b + §3.6b
  regression-pin per-channel and per-scope semantics. A higher-order
  `withTelegramChannel(probe, sendEmail)` wrapper deferred — would
  force an unstable abstraction across 4 verdict shapes that diverge
  in the snapshot block (conflict-unresolved), state-file presence
  (webhook-flow), and helper-vs-inline (calendar-pathology).
- **RISK-8 — `alert_email_id` repurpose.** Per §2.4.1 we keep the column
  name + update the comment. Future renamer touches fewer places; reader
  treats the field as opaque.
- **RISK-9 — env-file rotation lock-step (R1 BLOCKER#2 closure).** The
  Telegram env vars live in the SAME prod `$ENV_FILE` as
  `RESEND_API_KEY`. Operator rotating one secret + forgetting to
  `systemctl restart levelchannel + systemctl restart` the probe
  timers will leave the running process on stale env. Mitigation:
  runbook §2.1 step 5 makes the restart explicit; ops-page UI shows
  env-presence indicator that reads from the LIVE process — so a
  stale-env indicator flips visibly after a rotation+forgot-to-restart
  drift.

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

**R2 BLOCKER#1 closure:** the real autodeploy contract is documented in
`docs/private/OPERATIONS.private.md:33-37` (table row) and `:254-259`
(runner wiring). The runner is `<autodeploy-runner binary>`,
triggered by `levelchannel-autodeploy.timer` once a minute; its
sequence is:

```
git clone (atomic release dir) → npm ci → npm run build → npm run migrate:up → swap symlink → health-check
```

Migrations run **after build, before swap**, under the OLD live code.
Migrations MUST be additive-only so OLD code keeps working over them.
Migration 0061 is additive-only (NOT NULL column with literal-default
'email' is metadata-only on PG11+; new partial index does NOT rewrite
the table). The OLD shipped code never references `recipient_kind`, so
`build → migrate → swap` is safe.

The 42703-widened `migrationPending` guard (§2.7.2) is belt-and-
suspenders for an edge case: a deploy-recovery scenario where the
column was rolled back AFTER NEW code already swapped in. In that
scenario the admin page renders `migrationPending: true` instead of
500. NOT a normal happy-path concern — defensive against
human-recovery error.

1. PR opens.
2. CI runs migration 0061 against test DB → green.
3. PR merges (squash) to main.
4. `levelchannel-autodeploy.timer` picks up the commit on the next minute. The runner executes the documented sequence above. Build-before-migrate ordering is the long-standing contract; this wave conforms.
5. `TELEGRAM_ALERTS_ENABLED=0` (default) → Telegram dormant; email path unchanged. Admin page renders the new "Telegram канал" section with master switch OFF and env-presence indicators showing whatever the prod env file holds for `TELEGRAM_BOT_TOKEN` / `ALERT_TELEGRAM_CHAT_ID` (likely UNSET pre-runbook).
6. Operator follows §2.1 runbook — appends `TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID` to the SAME prod env file (the one `systemctl show levelchannel | grep EnvironmentFile` resolves to — operator-specific path; `docs/private/OPERATIONS.private.md` documents the exact path), THEN: (a) `systemctl restart levelchannel` so the admin page sees the new env, (b) `systemctl restart levelchannel-{auth-flow,calendar-pathology,webhook-flow,conflict-unresolved}-alert.timer` (or `systemctl daemon-reload` if any timer .service drop-in changed — none expected here), so the next probe tick picks up the new env. THEN operator flips `TELEGRAM_ALERTS_ENABLED=1` in the admin UI.
7. Next alert tick fires Telegram → confirmed via UI "Last Telegram run".

**Ordering hazard mitigated.** Migration 0061 is additive. Probe scripts
gated by enabled-switch (default OFF). 42703 widening covers
deploy-recovery edge cases. RISK-9 covers operator-forgets-to-restart
after env rotation.

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
- **10.7 BCS-DEF-1-TG-TESTSEND (R1 WARN#2 closure)** — extend
  `/api/admin/settings/alerts/[probe]/test-send/route.ts` and the
  test-send UI button with a parallel Telegram dry-run path. Today's
  route is hard-coded Resend-only; operator has no out-of-band
  BotFather verification until a real incident fires. Deferred to keep
  THIS PR scoped; on the to-do list IMMEDIATELY after BCS-DEF-1-TG
  merges. Future PR also widens the route's preflight catch with
  `isUndefinedColumnError` so it gracefully handles the
  before-migration-applies window.

---

## 11. Final trailer expectations

**Plan-paranoia checkpoint (THIS PR — doc-only, paranoia plan-mode SIGN-OFF):**
```
Skill-Used: /codex-paranoia plan
Codex-Paranoia: SIGN-OFF round 3/3 (BCS-DEF-1-TG plan checkpoint; impl unblocked)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Implementation PR (follow-up wave-mode pass on the impl diff):**
```
Skill-Used: /codex-paranoia plan + /codex-paranoia wave
Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan SIGN-OFF inherited from #<this-PR>; wave SIGN-OFF on impl diff)
Critical-Path-Touched: lib/admin/operator-settings.ts
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

— PLAN SIGNED OFF 2026-05-19 round 3/3; implementation unblocked —
