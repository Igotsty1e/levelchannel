# BCS-DEF-5-TG — Telegram channel for the daily 08:00 teacher digest

**Status:** DRAFT 2026-05-20 — **BLOCKED on BCS-DEF-4-TG-LINK** (see §0a). Plan-doc internally consistent at the §1.1 / §2.x level after round-1 paranoia closure; implementation cannot start until the learner-side handshake (`BCS-DEF-4-TG-LINK`) is shipped to main, because this plan stacks on the **resolved** learner handshake primitives (`accounts.teacher_telegram_{enabled,chat_id}` columns, the webhook route, and the shared bind-code table — whichever shape that wave lands).
**Wave name:** `bcs-def-5-tg-teacher-telegram-reminders` (single-PR epic — see §5).
**Trigger:** Telegram channel deferred from `docs/plans/bcs-def-5-teacher-reminders.md` §0a decision 6 + §10 ("Telegram DEFERRED — TG plan stacks on top of THIS plan's `teacher_account_daily_digests` flag table + cron once the email MVP ships"). Parent epic SHIPPED 2026-05-19 (PR #393); the per-slot tick model in the pre-rewrite draft of this plan is therefore obsolete and rewritten verbatim below.
**Author:** Claude (autonomous).
**Channel:** Telegram — adds a second delivery channel for the SAME daily digest that `scripts/teacher-daily-digest.mjs` already sends via email.

> **HISTORICAL NOTE — REWRITE 2026-05-20.** The pre-rewrite draft mirrored the BCS-DEF-4-TG learner Telegram epic on top of a per-slot tick scheduler (`scripts/lesson-reminder-dispatch.mjs`, `teacher_reminder_dispatches`, default cadence `[60, 30, 10, 5]`). That world disappeared on 2026-05-19 when BCS-DEF-5 was re-cut as a daily 08:00 digest (PR #393). The per-slot design, `teacher_reminder_dispatches`, the unified scheduler, the "5-minute imminent ping" — none of that ships, none of it exists in code, and this plan no longer references it.

## 0a. Round-1 + Round-2 paranoia closure (2026-05-20)

`/tmp/codex-paranoia-20260520T095006Z-bcs-def-5-tg/round-1.md` — Codex flagged **6 BLOCKERs + 5 WARNs + 6 INFOs** (R1). `/tmp/codex-paranoia-20260520T095006Z-bcs-def-5-tg/round-2.md` — Codex flagged **3 BLOCKERs + 3 WARNs + 1 INFO** (R2). All closed in-doc below; the inline §-references show where each landed.

### Round-2 closure table

| # | Severity | Closure ref |
|---|---|---|
| R2-1 | BLOCKER — `counts[\`telegram_${tgResult.tg}\`]++` lives inside `processOneTeacher` but `counts` is in `main()`; `processOneTeacher` signature doesn't carry it; data-flow doesn't close | §2.4.2 rewritten — `processOneTeacher` return shape EXTENDED with an optional `telegramOutcome` field (string, one of the `runTeacherTelegramBlock` tags), defaulting to `null` on non-`sent` outcomes. `main()` increments `counts[\`telegram_${result.telegramOutcome}\`]` after the function returns, at the existing per-outcome counter increment block. No `counts` object passed into `processOneTeacher`. |
| R2-2 | BLOCKER — Step 8 transient branch leaves dead pending state (`telegram_sent=false, telegram_skipped_reason=null, attempts=1`); candidate-set excludes `email_sent=true` so the row never gets re-tried; `attempts >= 2` is unreachable | §2.4 step 8 rewritten — **any non-403 send failure after email-sent is IMMEDIATELY terminal** (`telegram_skipped_reason='send_failed'`). The within-helper `tgSend` already exhausted its `retryMax=2` internally. No "leave row pending" branch. `maxAttempts` is removed from the helper signature (within-helper retries are the only retry budget; `tgSend`'s `retryMax` is the per-helper-call cap). The CHECK constraint's "Retryable terminal (send_failed)" branch requires `attempts >= 1` — we set `attempts=1` at step 4 and `skipped_reason='send_failed'` at step 8 ⇒ CHECK satisfied. |
| R2-3 | BLOCKER — `§2.5` proposed code-scoped lock `tgcode:code` but issuance side uses account-scoped lock `ttbc:account_id`; lock key-spaces don't intersect so issue and consume don't serialize | §2.5 rewritten — webhook `/start <code>` consume path FIRST does the SELECT to identify the `account_id` from `code` (no lock yet), THEN takes `pg_advisory_xact_lock(hashtext('ttbc:' || account_id::text))` for the teacher branch (or `'ltbc:' || account_id::text` for the learner branch), THEN re-SELECTs `FOR UPDATE` inside the lock to confirm the code is still consumable, THEN UPDATEs both tables. Same key-space as issuance. Race: two `/start <same-code>` invocations both observe the code in the initial SELECT; the first wins the lock and consumes; the second wins the lock after but its FOR UPDATE re-read sees `consumed_at IS NOT NULL` and bails. No deadlock because issuance + consume + auto-unbind all key off `account_id`, not `code`. |
| R2-4 | WARN — §3.3 fixture under-specified (CHECK requires non-null chat_id when enabled=true) | §3.3 rewritten — happy-path fixture explicitly INSERTs `accounts (id, ...) ... teacher_telegram_enabled=true, teacher_telegram_chat_id='123456789'` and the failing-CHECK assertion is added as a separate test case. |
| R2-5 | WARN — adding `rendered.telegramText` to `renderTeacherDailyDigestEmail` breaks the existing `{subject, text, html}` drift pin between TS + .mjs renderers + `tests/email/teacher-daily-digest.test.ts` | §2.4.3 rewritten — `rendered.telegramText` is NOT added to the existing email renderer. Instead, the Telegram body is rendered by a SEPARATE new helper `renderTeacherDailyDigestTelegram(slots, learnerLabels, teacherDisplayName, tz, siteUrl)` that lives in `scripts/lib/teacher-daily-digest-telegram-template.mjs` + `lib/notifications/teacher-digest-telegram-template.ts` (TS mirror for tests). The email renderer's signature + return shape stay bit-for-bit identical; existing `tests/email/teacher-daily-digest.test.ts` is untouched. New `tests/notifications/teacher-digest-telegram-template.test.ts` covers the Telegram renderer in isolation. The Telegram render runs in `processOneTeacher` AFTER the email COMMIT, BEFORE the Telegram block — it reuses the `slots` + `learnerLabels` already loaded for the email render (in-scope at that point per §2.4.4). |
| R2-6 | WARN — §0b gate is "semantic" ("merged to main"); doesn't verify the actual shipped table/route shape | §0b expanded — gate adds explicit `git grep -E "create table.*learner_telegram_bind_codes" migrations/` AND `ls app/api/telegram/webhook/route.ts` verification commands. The implementer (or any agent) running the plan MUST run those commands and confirm the actual shipped shape before opening the PR. If the shipped shape differs (e.g. single shared `telegram_bind_codes` table), the §2.5 fallback branch applies + the §0c re-paranoia trigger fires. |
| R2-7 | INFO — `r.rowCount === 0` at step 6 success path is "deeper invariant break", not benign race; should log error, not warn | §2.4 step 6 — log level for the success-UPDATE-affects-0-rows branch raised to `error`. Comment updated to reflect that under the FOR UPDATE lock ordering, this branch SHOULD be unreachable; if it fires, it indicates a deeper invariant break (e.g. row deleted by another path while we held the lock — which would also indicate a bug elsewhere). |

### Round-1 closure table

| # | Severity | Closure ref |
|---|---|---|
| 1 | BLOCKER — BCS-DEF-4-TG still DRAFT, webhook + bind_codes do not exist on main (`app/api/telegram/webhook/route.ts` absent; `migrations/` stops at 0069); `ENGINEERING_BACKLOG.md:49,57` confirms `BCS-DEF-4-TG-LINK` is the prereq | §0b Prerequisite gate — implementation STOPS until BCS-DEF-4-TG-LINK lands on main. §0 status banner now reads `BLOCKED on BCS-DEF-4-TG-LINK`. |
| 2 | BLOCKER — shipped learner state lives on `accounts.learner_telegram_{enabled,chat_id}` columns (migration 0065), not on a `learner_telegram_subscriptions` table; plan was mirroring stale sibling architecture | §2.2.1 rewritten — teacher state ALSO lives on **`accounts.teacher_telegram_{enabled,chat_id}`** columns (migration 0070). NO `teacher_telegram_subscriptions` table. The bind-code workflow is held in `teacher_telegram_bind_codes` (single new table). |
| 3 | BLOCKER — candidate-set SQL at `scripts/teacher-daily-digest.mjs:149-163` filters out rows where `email_sent=true`; the planned "next tick retries only Telegram" path is unreachable | §2.4 rewritten — Telegram block runs **in the SAME tick** as the email send, after the email COMMIT, within `processOneTeacher`. No "next tick re-evaluation for Telegram only" path. Failure of Telegram on a sent-email day is final for the day; the email already arrived. §6 RISK-2 retitled. |
| 4 | BLOCKER — two-COMMIT structure in §2.4.1 contradicted the actual `processOneTeacher` control flow (each terminal branch already COMMITs/ROLLBACKs and returns) | §2.4 rewritten — Telegram block is **invoked by the email-success branch ONLY** (the `sendResult.ok` path at `scripts/teacher-daily-digest.mjs:484-496`), via a helper `runTeacherTelegramBlock` that opens its own short TX after the email COMMIT. All other `processOneTeacher` terminal branches return as today (no Telegram call). Email path is bit-for-bit preserved on every non-`sent` outcome; on the `sent` outcome, the Telegram block executes AFTER the email COMMIT in a separate TX. |
| 5 | BLOCKER — race on `telegram_attempts` increment without `FOR UPDATE`; two parallel TX-B could both see `telegram_sent=false` and both send | §2.4 rewritten — Telegram block uses the SAME race-detection primitive the email path uses (`scripts/teacher-daily-digest.mjs:401-443`): `SELECT ... FOR UPDATE` to take row lock, then a guarded `UPDATE ... WHERE telegram_sent = false AND telegram_skipped_reason IS NULL AND telegram_attempts < $maxAttempts RETURNING ...` race-loser branch. Detailed in §2.4 step 4. |
| 6 | BLOCKER — outcome whitelist used `terminal_skip-lost-race`, which doesn't exist in code; the actual outcomes are 8 fixed strings | §2.4 rewritten — Telegram block is gated by the single `outcome === 'sent'` check at the email-success branch. No multi-string whitelist; no synthetic outcome names. The other 7 outcomes (`outside_band`, `already_sent`, `terminal_skip`, `terminal_send_failed`, `empty_day`, `email_missing`, `send_failed_transient`) skip Telegram entirely for that tick. |
| 7 | WARN — `runTelegramBlock` didn't check `rowCount` on UPDATEs | §2.4 step 1-7 all check `result.rowCount` and branch on 0 explicitly. Pseudocode rewritten with explicit `assertRowAffected` paths. |
| 8 | WARN — 0071 ACCESS EXCLUSIVE on a table the cron is actively reading, with no deploy-ordering guidance | §2.2.2 + §8 — operator runbook now requires `systemctl stop levelchannel-teacher-daily-digest.timer` BEFORE `npm run migrate:up` and `systemctl start ...` AFTER. Documented at §8 step 3.5/3.6. |
| 9 | WARN — `accounts on delete cascade` doesn't actually wipe TG PII because the project's retention sweep does anonymize-in-place UPDATE, not DELETE | §2.2.1 — `teacher_telegram_chat_id` is included in the existing retention anonymize column list (parallel to `learner_telegram_chat_id`'s retention handling once BCS-DEF-4-TG-LINK lands its retention contract). §10 BCS-DEF-5-TG-GDPR adjusted. |
| 10 | WARN — plan said both "migrations 0070-0072 are additive" AND "omit 0072" | §2.2 rewritten — only **migrations 0070 + 0071** ship in this plan. The operator-settings key is registered in `SETTING_SCHEMA` only; no `0072` file is referenced anywhere. |
| 11 | WARN — `runTelegramBlock` signature lists `tgSend` but call sites don't pass it | §2.4 — single canonical signature is `runTeacherTelegramBlock({client, accountId, ymd, telegramEnabled, tgToken, tgSend, maxAttempts, body})`. Both call paths (only ONE in this design — see BLOCKER 4 closure) pass all 8 args. |
| 12 | INFO — scope choice confirmed correct (`'teacher-daily-digest'`, not `'telegram'`) | §2.3 — no change needed; scope decision validated. |
| 13 | INFO — 0070/0071 free; no 0072 | §2.2 — only 0070 + 0071 referenced. |
| 14 | INFO — `/teacher/settings/digest` URL fine, but new surface (no extension of existing) | §2.6 — call out explicitly as NEW surface. |
| 15 | INFO — `.slice(0, 1000)` after redaction may truncate `[REDACTED]` but doesn't re-expose secret bytes | §2.4 step 8 — note added: truncation-after-redaction is safe by construction of `redactTelegramSecret` (full token + last-8 + `bot<token>` forms all replaced before truncation). |
| 16 | INFO — `logJson('warn', ...)` is valid | §2.4 — call retained as written. |
| 17 | INFO — counters at `:585-595` is the right object to extend | §2.4 — call out the exact lines (now `scripts/teacher-daily-digest.mjs:585-595`) the new counters land on. |

## 0b. Prerequisite gate

This plan **CANNOT start implementation** until the following lands on `main` AND is **shape-verified by repo grep**:

1. **BCS-DEF-4-TG-LINK** (`docs/plans/bcs-def-4-tg-telegram-reminders.md`) merges with its post-paranoia design — specifically:
   - A shipped `app/api/telegram/webhook/route.ts` route with `/start <code>` + `/stop` + `/help` handlers.
   - A shipped `learner_telegram_bind_codes` table with documented schema (8-char `[A-Z0-9-IO01]` codes, 10-min TTL, advisory-lock semantics keyed on `'ltbc:' || account_id::text`, `ltbc_consumed_consistency` CHECK).
   - The shipped operator runbook for `setWebhook` registration (`scripts/activate-prod-ops.sh` deltas).
   - The shipped redaction contract reuse from BCS-DEF-1-TG.
2. **Operator activation of BCS-DEF-4-TG-LINK on prod** — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`, `TELEGRAM_BOT_USERNAME` present in `$ENV_FILE`; webhook registered against `https://levelchannel.ru/api/telegram/webhook`.

**Mandatory shape-verification commands (R2 WARN #6 closure)** — the implementer MUST run these BEFORE opening the PR and pin the output in the PR description:

```bash
# Expected: one match — the BCS-DEF-4-TG-LINK migration file.
git grep -nE "create table.*learner_telegram_bind_codes" migrations/
# Expected: the route file exists.
ls -la app/api/telegram/webhook/route.ts
# Expected: prints the lock key — must match 'ltbc:' || account_id::text.
git grep -nE "pg_advisory_xact_lock\\(hashtext\\('ltbc:'" app/ scripts/
# Expected: prints UNION-SELECT or single-table SELECT against learner_telegram_bind_codes
# (whichever shape BCS-DEF-4-TG-LINK chose); informs the §2.5 fallback decision.
git grep -nE "learner_telegram_bind_codes|telegram_bind_codes" app/api/telegram/webhook/
```

If the third command shows a DIFFERENT lock key (e.g. `'tgbind:'`) OR the fourth command shows a single shared `telegram_bind_codes` table with a `kind` discriminator — that constitutes a shape change and the §0c re-paranoia trigger fires. Implementation does NOT start.

Until both items above happen AND the four grep commands return expected output, this plan stays DRAFT and `BCS-DEF-5-TG` in `ENGINEERING_BACKLOG.md:57` keeps its annotation. The PR for this plan opens AFTER all four are confirmed.

## 0b'. Wave-paranoia round-2 BLOCKER 1 (2026-05-21)

Wave-paranoia round 2 surfaced: the current production "teacher" identity is hybrid
`admin+teacher`, and `/teacher` SSR + Server Actions reject hybrid accounts (`lib/auth/
guards.ts:160` + `lib/auth/accounts.ts:259`). That means the BCS-DEF-5-TG bind surface
at `/teacher/settings/digest` is unreachable for the only "teacher" the platform has on
production today.

**Closure (deferred-activation gate, not code change):**

BCS-DEF-5-TG ships its code path correctly. Activation in production requires one of:

1. **SaaS-pivot Epic 1 ships first** (`docs/plans/saas-pivot-master.md` §2.9 — bootstrap
   teacher account migration). After that, the new teacher-only account binds Telegram
   via `/teacher/settings/digest`, operator flips `TEACHER_DIGEST_TELEGRAM_ENABLED=1`.

2. **Operator manually creates a teacher-only account** for testing (no admin role),
   binds, operator flips master switch. This account becomes the bootstrap teacher.

Until either path lands, `TEACHER_DIGEST_TELEGRAM_ENABLED` stays at 0 (the default).
The Code path is **shipped but dormant** — same posture as BCS-DEF-1-TG and BCS-DEF-4-TG
between their merge and their activation.

This is recorded as a SHIPPED-WITH-DOCUMENTED-DEFERRAL on the wave-paranoia trailer.

## 0c. Likely re-paranoia trigger

The handshake-table shape, retention contract, and webhook route shape are **inherited from BCS-DEF-4-TG-LINK**. If that wave's shape changes mid-flight (likely — it's been through 3+ paranoia rounds and an escalation), this plan must be **re-paranoia-reviewed** before implementation. The §2.2.1 + §2.2.2 + §2.5 sections explicitly call out which primitives are inherited and from where.

---

## 0. Cross-refs

- **`docs/plans/bcs-def-5-teacher-reminders.md`** (PR #393, SHIPPED 2026-05-19) — **parent**. Defines the digest cron `scripts/teacher-daily-digest.mjs`, the dedup flag table `teacher_account_daily_digests` (migration 0067), the `probe_runs.probe_name='teacher-daily-digest'` widening (migration 0068), the timezone CHECK constraint on `account_profiles.timezone` (migration 0069), the 3 operator-tunable knobs under `scope: 'teacher-daily-digest'` (`TEACHER_DIGEST_MASTER_SWITCH` / `TEACHER_DIGEST_RATE_LIMIT_PER_TICK` / `TEACHER_DIGEST_MAX_ATTEMPTS`), and the admin page at `/admin/settings/digest`. THIS plan stacks Telegram on top WITHOUT touching any of those contracts.
- **`docs/plans/bcs-def-4-tg-telegram-reminders.md`** (DRAFT, prerequisite per §0b) — sibling learner-side Telegram epic. **PATTERN SOURCE** for the bind-code workflow, the cabinet opt-in UI, the `/api/telegram/webhook` route, the `setWebhook` operator runbook, the `/start <code>` and `/stop` handlers, the 403-auto-unsubscribe semantics, and the redaction contract for token-bearing errors. THIS plan inherits the architecture that wave actually ships — specifically:
  - **State storage** lives on `accounts` columns (`accounts.learner_telegram_enabled`, `accounts.learner_telegram_chat_id` — already shipped via migration 0065). The teacher analog (this plan) adds `accounts.teacher_telegram_{enabled,chat_id}` columns to the SAME table (migration 0070).
  - **NO `learner_telegram_subscriptions` table exists** — the BCS-DEF-4-TG R1-#2 closure dropped it. This plan therefore ALSO does not introduce a `teacher_telegram_subscriptions` table.
  - **Bind-code table** — BCS-DEF-4-TG-LINK ships `learner_telegram_bind_codes`. This plan adds the SEPARATE `teacher_telegram_bind_codes` table (migration 0070) because role-gating on a single shared table requires a `kind` discriminator the attacker could spoof; the BCS-DEF-4-TG §4.2 cross-archetype-binding-spoofing closure used separate tables. We follow that precedent.
  - **Webhook route** — BCS-DEF-4-TG-LINK ships `/api/telegram/webhook` with learner-only `/start <code>`. This plan EXTENDS it (single sub-edit) to UNION-SELECT across both `*_telegram_bind_codes` tables. (§2.5.)
- **`docs/plans/bcs-def-1-tg-telegram-alerts.md`** (PR #339, SHIPPED) — operator-alert precedent. **REUSE SOURCE** for `sendTelegramMessage` + `redactTelegramSecret` + `stringifyTelegramError` at `scripts/lib/telegram-alerts.mjs:277` / `:77` / `:115`, the env-loading contract (single `$ENV_FILE` rendered by `scripts/activate-prod-ops.sh`, no per-channel env.d/ fan-out), the master-switch / `scope: 'telegram'` pattern in `SETTING_SCHEMA` at `lib/admin/operator-settings.ts:218-242`, and the admin probe-status read pattern at `lib/admin/probe-status.ts`. THIS plan REUSES `TELEGRAM_BOT_TOKEN` — **NO new bot, NO new token, NO new `setWebhook` call** (BCS-DEF-4-TG-LINK registers the webhook; this plan only adds a new bind-code table + an UNION-SELECT branch in the webhook).

---

## 1. Goal

When a teacher has bound Telegram via the cabinet bind-code flow AND `TEACHER_DIGEST_TELEGRAM_ENABLED=1`, the digest cron sends the SAME daily digest body via Telegram **inside the same tick**, AFTER the email send for that teacher succeeds. Telegram is a SECOND channel — the email path is unchanged.

**Hard requirements:**
- The email send path in `scripts/teacher-daily-digest.mjs` MUST remain bit-for-bit identical pre- and post-merge. The Telegram block is appended to the `sendResult.ok` branch AFTER the email TX commits (§2.4); all other terminal branches of `processOneTeacher` (`outside_band`, `already_sent`, `terminal_skip`, `terminal_send_failed`, `empty_day`, `email_missing`, `send_failed_transient`) skip Telegram for that tick and return as today.
- One Telegram message per `(account_id, sent_date)` — idempotent. The Telegram block uses the SAME race-detection primitive as the email path (insert/UPDATE `... RETURNING` with a state-machine WHERE clause; §2.4 step 4).
- **Telegram failure on the same day after email-sent is final** — the candidate-set SQL excludes rows with `email_sent=true` (`scripts/teacher-daily-digest.mjs:149-163`), so the next tick will NOT re-evaluate that teacher. If Telegram fails after email succeeded, the user simply doesn't get Telegram for that day (the email already arrived). §6 RISK-2 documents this trade-off explicitly.
- Soft-skip on missing binding: a teacher with `accounts.teacher_telegram_enabled=false` (or NULL chat_id) gets the email and NO Telegram — the Telegram block writes `telegram_skipped_reason='no_telegram_binding'` on the dedup row.
- Operator master switch `TEACHER_DIGEST_TELEGRAM_ENABLED` (default 0, OFF) gates the entire Telegram block. Default OFF lets the wave ship before any teacher has bound — operator flips after self-test.
- Telegram-side 403 ("bot blocked by user") sets `accounts.teacher_telegram_enabled=false` (auto-unsubscribe); future digests skip Telegram for that teacher with reason `bot_blocked_by_user`. NOTE: this is the SAME auto-unsubscribe semantics as BCS-DEF-4-TG-LINK's learner side — the UPDATE is scoped to `WHERE id = $accountId AND teacher_telegram_chat_id = $failedChatId` so a re-bind after a 403 doesn't get wiped retroactively.
- Token-bearing errors MUST funnel through `redactTelegramSecret` before any `recordProbeRun({errorMessage})` / `last_error` / log line / route response. Inherits BCS-DEF-1-TG §4.1 contract verbatim.

**Out of scope explicitly:** see §10.

---

## 1.1 Existing surface inventory

Cited against `main` HEAD as of 2026-05-20.

### Parent surface (BCS-DEF-5, SHIPPED PR #393)

- **`scripts/teacher-daily-digest.mjs`** — the digest cron. Currently 724 lines.
  - **`processOneTeacher({pool, candidate, now, maxAttempts, resendSend})`** at `scripts/teacher-daily-digest.mjs:272` — per-teacher TX. Inserts / updates the dedup row, sends the email via the dependency-injected `resendSend`, returns one of 8 outcomes (`outside_band`, `already_sent`, `terminal_skip`, `terminal_send_failed`, `empty_day`, `email_missing`, `sent`, `send_failed_transient`). The Telegram block hooks ONLY onto the `outcome === 'sent'` path; see §2.4.
  - **The `sendResult.ok` branch at `scripts/teacher-daily-digest.mjs:484-496`** — UPDATE the dedup row to `email_sent=true,sent_at=now(),...` and COMMIT. After this COMMIT, the Telegram block runs (still inside the same `processOneTeacher` call but on a fresh TX-B on the same `client`). See §2.4.
  - **`main()`** at `scripts/teacher-daily-digest.mjs:525` — per-tick loop. Master-switch gate at `:556-567`. Resolves operator settings via `resolveOperatorSettingsForProbe(pool, 'teacher-daily-digest')` at `:541`. The Telegram master switch lands as a fourth key under the same probe scope (§2.3).
  - **`selectCandidateTeachers(db, maxAttempts, rateLimit)`** at `scripts/teacher-daily-digest.mjs:131` — candidate-set query. UNCHANGED by this wave. Note: the `email_sent=false AND skipped_reason IS NULL AND attempts < maxAttempts` filter at `:159-162` excludes any teacher who has already gotten their email today — which means **Telegram failures on a sent-email day are not re-tried by the next tick.** This is intentional per §6 RISK-2.
  - Counters at `scripts/teacher-daily-digest.mjs:585-595` — currently 9 fields. Extended in this wave with `telegram_sent`, `telegram_skipped_no_binding`, `telegram_skipped_disabled`, `telegram_terminal_send_failed`, `telegram_bot_blocked`, `telegram_already_sent`, `telegram_row_missing`. R2-2 closure: no `telegram_send_failed_transient` counter (state collapsed to terminal). Surface via `logJson` at `:689` and via `recordProbeRun({stats})` at `:699`.

- **`migrations/0067_teacher_account_daily_digests.sql`** — the dedup flag table. PK `(account_id, sent_date)` at `:35`. The `tadd_state_consistency` CHECK at `:42-73` encodes the email channel's state machine. This wave adds Telegram-channel columns + a parallel sub-CHECK (§2.2.2).

- **`migrations/0068_probe_runs_teacher_daily_digest.sql`** — `probe_runs.probe_name='teacher-daily-digest'` + 3 verdict_kinds (`digest_sent`, `digest_skipped_disabled`, `digest_no_teachers`). The per-tick summary `recordProbeRun` carries Telegram counters inside its `stats` JSON; **no new probe_name or verdict_kind is added by this wave**.

- **`migrations/0069_account_profiles_timezone_check.sql`** — UNCHANGED.

- **`lib/admin/operator-settings.ts`** — `SETTING_SCHEMA`. Lines `:248-277` define the 3 digest keys under `scope: 'teacher-daily-digest'`. This wave adds 1 NEW key under the SAME scope: `TEACHER_DIGEST_TELEGRAM_ENABLED`. The `ChannelScope = 'telegram'` type at `:50` is reserved for cross-probe Telegram knobs; the per-digest master switch lives next to its siblings, not under `'telegram'` scope. Drift mirror at `scripts/lib/operator-settings.mjs` updated lockstep.

- **`app/admin/(gated)/settings/digest/page.tsx`** — admin surface shipped in PR #393. Currently 3 sections. This wave adds a 4th section "Telegram канал" parallel to BCS-DEF-1-TG's pattern: master switch row, active-bindings count, per-tick Telegram-counter breakdown.

- **`scripts/systemd/levelchannel-teacher-daily-digest.{service,timer}`** — UNCHANGED at the file level. Operator runbook §8 requires stopping the timer briefly for migration 0071 (§2.2.2).

### Sibling surface (BCS-DEF-1-TG, SHIPPED PR #339)

- **`scripts/lib/telegram-alerts.mjs`** — `sendTelegramMessage` at `:277`, `redactTelegramSecret` at `:77`, `stringifyTelegramError` at `:115`. **REUSE AS-IS, no fork.** Same retry policy (5xx + 1s linear backoff, 4xx non-retryable, 429 honours `retry_after` capped at 5s, 5s `AbortController` wall-clock). 4096-char body cap is well above digest body (~600-1500 chars).
- **`TELEGRAM_BOT_TOKEN`** env var — REUSE. Single bot per VPS. Operator runbook §8 does NOT call `setWebhook` because BCS-DEF-4-TG-LINK already registered it for `https://levelchannel.ru/api/telegram/webhook`.

### Sibling surface (BCS-DEF-4-TG-LINK — PREREQUISITE, not yet shipped)

`docs/plans/bcs-def-4-tg-telegram-reminders.md` is the **architecture spec** this plan stacks on. The shape it ships determines:

1. **Bind-code workflow.** BCS-DEF-4-TG-LINK ships `learner_telegram_bind_codes` (per its §2.3 — 8-char `[A-Z0-9]` excluding I/O/0/1, 10-min TTL, single-use, `pg_advisory_xact_lock` serialization on `account_id`, partial unique index over not-yet-consumed/not-yet-expired rows + a relaxed `ltbc_consumed_consistency` CHECK per its R3-#1 closure). This plan adds the teacher-side analog `teacher_telegram_bind_codes` (§2.2.1) with the SAME shape.
2. **State storage.** BCS-DEF-4-TG-LINK uses `accounts.learner_telegram_{enabled,chat_id}` columns shipped by migration 0065 (R1-#2 closure). This plan adds the teacher-side analog: `accounts.teacher_telegram_{enabled,chat_id}` columns (migration 0070) with the SAME shape + CHECKs.
3. **Webhook route.** BCS-DEF-4-TG-LINK ships `app/api/telegram/webhook/route.ts` with `X-Telegram-Bot-Api-Secret-Token` header auth, `chat.type === 'private'` hard-gate (its R1-#10 closure), `/start <code>` + `/stop` + `/help` handlers, rate-limit 20 req/min/from-id, 200 on ignored / disabled. **EXTENDED, not forked** — §2.5 adds the UNION-SELECT across both bind-code tables.

If BCS-DEF-4-TG-LINK lands with a different shape (e.g. a single shared `telegram_bind_codes` table with a `kind` discriminator instead of two parallel tables), this plan re-paranoia-reviews before implementation (per §0c).

---

## 1.2 Critical-path inventory

Per `docs/critical-path.md`:
- **`lib/admin/operator-settings.ts`** — on critical path. This plan adds 1 key (additive). Same paranoia profile as BCS-DEF-5 Sub-PR.
- **`scripts/teacher-daily-digest.mjs`** — NOT on critical path (cron). This plan extends `processOneTeacher` with a post-email Telegram block on the `sendResult.ok` branch only.
- **`app/api/telegram/webhook/route.ts`** — NOT on critical path (shipped by BCS-DEF-4-TG-LINK). This wave extends it with a UNION-SELECT branch in `/start <code>` resolution.

---

## 2. Design

### 2.1 Bot setup (operator runbook delta)

The bot exists, the webhook is already registered (BCS-DEF-4-TG-LINK §2.1). This plan only adds the master switch flip:

1. **Verify env-file already carries `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET_TOKEN` + `TELEGRAM_BOT_USERNAME`.** Same `$ENV_FILE` that `scripts/activate-prod-ops.sh` manages — appended in the BCS-DEF-4-TG-LINK activation step. `cat $ENV_FILE | grep TELEGRAM` shows three lines.
2. **Confirm webhook health.** Optional probe: `curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | jq` — verifies the URL points at `https://levelchannel.ru/api/telegram/webhook` and `last_error_message` is empty.
3. **Stop the digest timer.** `systemctl stop levelchannel-teacher-daily-digest.timer` (closure of round-1 WARN 8 — prevents the migration's brief ACCESS EXCLUSIVE on `teacher_account_daily_digests` from stalling an in-flight tick's `SELECT ... FOR UPDATE`).
4. **Apply migrations.** `npm run migrate:up` on prod (via autodeploy or manually). Migrations 0070 + 0071 are additive.
5. **Restart the digest timer.** `systemctl start levelchannel-teacher-daily-digest.timer`.
6. **Restart the Next.js app.** `systemctl restart levelchannel` — picks up the new `lib/admin/operator-settings.ts SETTING_SCHEMA` entry + the new webhook UNION-SELECT branch.
7. **Flip master switch.** `/admin/settings/digest` → "Telegram канал" section → `TEACHER_DIGEST_TELEGRAM_ENABLED=1`.
8. **Smoke test.** Operator self-binds a teacher account via `/teacher/settings/digest`; waits for the next 08:00 local tick; confirms Telegram arrives within 1 minute of email.

**Test-send caveat.** Mirrors BCS-DEF-1-TG WARN#2 limitation: there is NO admin-side per-teacher TG-test-send button in this PR. Operator verifies by self-binding and waiting for the next 08:00 tick. A proper dry-run is deferred to §10 BCS-DEF-5-TG-TESTSEND.

Full runbook lives in `docs/private/OPERATIONS.private.md` (operator-side, out of public-repo scope, parity with BCS-DEF-1-TG §2.1).

### 2.2 Schema migrations

**Two additive migrations** (round-1 WARN 10 closure — only 0070 + 0071, no 0072).

#### 2.2.1 Migration 0070 — teacher TG storage columns + `teacher_telegram_bind_codes`

Mirrors BCS-DEF-4 migration 0065 (storage columns on `accounts`) + BCS-DEF-4-TG-LINK migration NNNN (`learner_telegram_bind_codes`).

```sql
-- BCS-DEF-5-TG (2026-05-20) — teacher-side Telegram opt-in storage
-- columns and bind-code table. Mirrors BCS-DEF-4 migration 0065 +
-- BCS-DEF-4-TG-LINK bind-code table (shape inherited verbatim).
-- Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.2.1.
--
-- Postgres 11+ — ADD COLUMN ... DEFAULT false NOT NULL is metadata-only
-- (no table rewrite). The two CHECK constraints are pre-satisfied by
-- the default-false invariant on every existing row.

alter table accounts
  add column if not exists teacher_telegram_enabled boolean not null default false;

alter table accounts
  add column if not exists teacher_telegram_chat_id text null;

alter table accounts
  drop constraint if exists accounts_teacher_telegram_chat_id_len;
alter table accounts
  add constraint accounts_teacher_telegram_chat_id_len
  check (teacher_telegram_chat_id is null
         or length(teacher_telegram_chat_id) between 1 and 64);

alter table accounts
  drop constraint if exists accounts_teacher_telegram_consistency;
alter table accounts
  add constraint accounts_teacher_telegram_consistency
  check ((teacher_telegram_enabled = false)
         or (teacher_telegram_chat_id is not null));

comment on column accounts.teacher_telegram_enabled is
  'BCS-DEF-5-TG (2026-05-20): per-user opt-in flag for the daily 08:00 '
  'teacher digest delivered via Telegram. Default false. Toggling true '
  'requires teacher_telegram_chat_id to be non-null (CHECK constraint). '
  'This wave ships the storage + the digest-cron extension; the bind '
  'handshake reuses the webhook route at /api/telegram/webhook shipped '
  'by BCS-DEF-4-TG-LINK.';
comment on column accounts.teacher_telegram_chat_id is
  'BCS-DEF-5-TG (2026-05-20): Telegram numeric chat-id captured from the '
  '/start handshake. Wiped by the retention sweep alongside email / '
  'password_hash / learner_telegram_chat_id when scheduled_purge_at '
  'elapses (defense-in-depth against residual PII per 152-FZ).';

-- Teacher-side bind codes — separate table from learner_telegram_bind_codes
-- so role-gating at write time prevents cross-archetype spoofing (the
-- table itself IS teacher-scoped, parallel to the learner table being
-- learner-scoped). Schema mirrors BCS-DEF-4-TG-LINK's learner table
-- (R3-#1 relaxed CHECK shape included).

create table if not exists teacher_telegram_bind_codes (
  code text primary key,                       -- 8 chars [A-Z0-9] no I/O/0/1
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,             -- created_at + 10 min
  consumed_at timestamptz null,
  consumed_chat_id text null
);

-- ttbc_consumed_consistency — mirrors BCS-DEF-4-TG-LINK's R3-#1 relaxed
-- shape: unconsumed = both NULL; consumed = consumed_at set, chat_id
-- MAY be later NULLed by the retention scrub.
alter table teacher_telegram_bind_codes
  drop constraint if exists ttbc_consumed_consistency;
alter table teacher_telegram_bind_codes
  add constraint ttbc_consumed_consistency
  check (
    (consumed_at is null and consumed_chat_id is null)
    or
    (consumed_at is not null)
  );

create unique index if not exists ttbc_one_active_per_teacher_idx
  on teacher_telegram_bind_codes (account_id)
  where consumed_at is null and expires_at > now();

comment on table teacher_telegram_bind_codes is
  'BCS-DEF-5-TG (2026-05-20): teacher-side single-use bind codes for '
  'the Telegram digest channel. Mirror of learner_telegram_bind_codes. '
  'Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.2.1.';
```

**Note on partial-index `now()` semantics.** Same caveat as BCS-DEF-4-TG-LINK §2.3 — `now()` is STABLE not IMMUTABLE; the partial unique index is defence-in-depth. Server Actions enforce single-active via `pg_advisory_xact_lock(hashtext('ttbc:' || account_id::text))` + DELETE of prior unconsumed rows.

**Retention.** `teacher_telegram_chat_id` is added to the existing anonymize-on-purge column list in `scripts/db-retention-cleanup.mjs` (round-1 WARN 9 closure — explicit list, not implicit cascade). The expired/consumed bind-code rows are swept by the new pass that BCS-DEF-4-TG-LINK R2-#4 introduced; this plan extends that pass to also target `teacher_telegram_bind_codes` (single `OR`-clause addition).

#### 2.2.2 Migration 0071 — `teacher_account_daily_digests` Telegram columns

The existing dedup row at `migrations/0067_teacher_account_daily_digests.sql` encodes the **email channel** state machine in its `tadd_state_consistency` CHECK. This wave adds parallel Telegram-channel columns + a separate sub-CHECK.

```sql
-- BCS-DEF-5-TG (2026-05-20) — Telegram channel columns on the daily
-- digest dedup row. Email path on the same row is unchanged.
-- Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.2.2.
--
-- Operator runbook §2.1 / §8 requires stopping the digest timer
-- BEFORE this migration runs to avoid the brief ACCESS EXCLUSIVE
-- on teacher_account_daily_digests racing with an in-flight tick's
-- SELECT ... FOR UPDATE.

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
  drop constraint if exists tadd_telegram_skipped_reason_check;
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
-- UNCHANGED. This new CHECK only constrains the relationship between
-- the new columns.
alter table teacher_account_daily_digests
  drop constraint if exists tadd_telegram_state_consistency;
alter table teacher_account_daily_digests
  add constraint tadd_telegram_state_consistency
  check (
    -- Sent: telegram_sent_at set, no skipped_reason.
    (telegram_sent = true
     and telegram_sent_at is not null
     and telegram_skipped_reason is null)
    or
    -- Pending: no skipped_reason, no sent_at, no message_id, attempts >= 0.
    (telegram_sent = false
     and telegram_skipped_reason is null
     and telegram_sent_at is null
     and telegram_message_id is null
     and telegram_attempts >= 0)
    or
    -- Non-retryable terminal: no sent_at, no message_id.
    (telegram_sent = false
     and telegram_skipped_reason in (
       'no_telegram_binding', 'channel_disabled', 'bot_blocked_by_user'
     )
     and telegram_sent_at is null
     and telegram_message_id is null)
    or
    -- Retryable terminal: send_failed; attempts >= 1.
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

**ACCESS EXCLUSIVE briefly on `teacher_account_daily_digests`.** PG11+ adds NOT NULL columns with default WITHOUT rewriting the table (metadata-only). Adding the CHECK does a brief scan but the table is small (~thousands of rows). The runbook §2.1 step 3 stops the digest timer BEFORE the migration to avoid blocking an in-flight `SELECT ... FOR UPDATE` (round-1 WARN 8 closure).

### 2.3 Operator settings — 1 new key

Extend `lib/admin/operator-settings.ts SETTING_SCHEMA` (around `:248-277`, under the existing digest cluster) AND `scripts/lib/operator-settings.mjs`:

```ts
TEACHER_DIGEST_TELEGRAM_ENABLED: {
  kind: 'int',
  default: 0,
  min: 0,
  max: 1,
  envName: 'TEACHER_DIGEST_TELEGRAM_ENABLED',
  description: 'master switch (1=on/0=off) for sending the daily teacher '
    + 'digest via Telegram (in addition to email); reuses TELEGRAM_BOT_TOKEN '
    + 'and the webhook from BCS-DEF-4-TG-LINK (no setWebhook re-call). Default '
    + 'OFF — turn on after at least one teacher has bound via /teacher/settings/digest.',
  scope: 'teacher-daily-digest',
},
```

**Scope decision.** The key lives under `scope: 'teacher-daily-digest'` (NOT `scope: 'telegram'`) — see round-1 INFO 12 confirmation. `resolveOperatorSettingsForProbe(pool, 'teacher-daily-digest')` at `scripts/teacher-daily-digest.mjs:541` picks it up alongside the existing 3 keys.

### 2.4 Scheduler integration — Telegram block on the email-sent branch only

**Single insertion point:** `scripts/teacher-daily-digest.mjs:495` — immediately AFTER `await client.query('commit')` on the `sendResult.ok` branch (the only path where the email actually went out). All other 7 terminal branches of `processOneTeacher` return as today; Telegram is NOT attempted.

#### 2.4.1 New helper `runTeacherTelegramBlock`

Lives in `scripts/lib/teacher-daily-digest-telegram.mjs` (extracted for testability; .mjs sibling pattern mirrors `scripts/lib/teacher-daily-digest-template.mjs`). Signature (R2-1 closure — `maxAttempts` removed; the within-helper `tgSend` retry budget is the only retry budget; R2-2 closure — any post-email TG fail is terminal):

```js
/**
 * @param {{
 *   client: import('pg').PoolClient,
 *   accountId: string,
 *   ymd: string,
 *   telegramEnabled: boolean,
 *   tgToken: string,
 *   tgSend: typeof import('./telegram-alerts.mjs').sendTelegramMessage,
 *   body: string,
 * }} input
 * @returns {Promise<{ tg: 'sent' | 'skipped_disabled' | 'skipped_no_binding' | 'bot_blocked' | 'terminal_send_failed' | 'already_sent' | 'row_missing', messageId?: string | null, error?: string }>}
 *
 * NOTE: the candidate-set SQL at scripts/teacher-daily-digest.mjs:149-163
 * excludes any teacher with email_sent=true. So this helper is invoked
 * ONLY ONCE per (account_id, sent_date) — within the same tick as the
 * email send. There is no "next tick retries Telegram only" path
 * (§6 RISK-2). The within-helper tgSend.retryMax=2 is the entire retry
 * budget. Any non-403 failure after that is IMMEDIATELY terminal
 * (telegram_skipped_reason='send_failed').
 */
async function runTeacherTelegramBlock({
  client, accountId, ymd, telegramEnabled, tgToken, tgSend, body,
}) {
  try {
    await client.query('begin')

    // Step 1 — fast-path: master switch OFF. R3 INFO #14: this
    // branch is UNREACHABLE from the production call site (which
    // guards `if (telegramEnabled && tgToken)`). Retained as
    // defense-in-depth + as a clean test-only entry path so unit
    // tests can pass a misconfigured `telegramEnabled=false` and
    // verify the helper writes the expected `channel_disabled`
    // skip row.
    if (!telegramEnabled) {
      const r = await client.query(
        `update teacher_account_daily_digests
            set telegram_skipped_reason = 'channel_disabled'
          where account_id = $1 and sent_date = $2::date
            and telegram_sent = false
            and telegram_skipped_reason is null`,
        [accountId, ymd])
      await client.query('commit')
      return { tg: r.rowCount > 0 ? 'skipped_disabled' : 'row_missing' }
    }

    // Step 2 — look up binding on accounts (same source-of-truth as
    // BCS-DEF-4-TG-LINK; NO separate subscriptions table).
    const bindingRow = await client.query(
      `select teacher_telegram_enabled as enabled,
              teacher_telegram_chat_id as chat_id
         from accounts
        where id = $1
          and disabled_at is null
          and scheduled_purge_at is null
          and purged_at is null
        for update`,
      [accountId])
    if (bindingRow.rowCount === 0
        || bindingRow.rows[0].enabled !== true
        || !bindingRow.rows[0].chat_id) {
      const r = await client.query(
        `update teacher_account_daily_digests
            set telegram_skipped_reason = 'no_telegram_binding'
          where account_id = $1 and sent_date = $2::date
            and telegram_sent = false
            and telegram_skipped_reason is null`,
        [accountId, ymd])
      await client.query('commit')
      return { tg: r.rowCount > 0 ? 'skipped_no_binding' : 'row_missing' }
    }
    const chatId = String(bindingRow.rows[0].chat_id)

    // Step 3 — read dedup row WITH ROW LOCK (round-1 BLOCKER 5 closure
    // — eliminates the read-then-update race).
    const existing = await client.query(
      `select telegram_sent, telegram_skipped_reason, telegram_attempts
         from teacher_account_daily_digests
        where account_id = $1 and sent_date = $2::date
        for update`,
      [accountId, ymd])
    if (existing.rowCount === 0) {
      // Defensive — should not happen because the email path just
      // committed an UPDATE on this row (the dedup row exists by the
      // time we reach this helper). Log + bail.
      await client.query('rollback')
      logJson('warn', 'teacher telegram block: dedup row missing', { accountId, ymd })
      return { tg: 'row_missing' }
    }
    const row = existing.rows[0]
    if (row.telegram_sent === true) {
      await client.query('rollback')
      return { tg: 'already_sent' }
    }
    if (row.telegram_skipped_reason !== null) {
      await client.query('rollback')
      return { tg: 'already_sent' }  // any terminal Telegram state counts
    }

    // Step 4 — race-safe attempts bump. We always bump from 0 to 1 on
    // this single helper invocation (the candidate-set filter at
    // :149-163 guarantees this helper runs at most once per (account,
    // sent_date)). The guarded UPDATE detects races where another
    // process has already flipped a terminal state under us — in
    // which case we bail without sending.
    const bumped = await client.query(
      `update teacher_account_daily_digests
          set telegram_attempts = telegram_attempts + 1
        where account_id = $1 and sent_date = $2::date
          and telegram_sent = false
          and telegram_skipped_reason is null
        returning telegram_attempts`,
      [accountId, ymd])
    if (bumped.rowCount === 0) {
      // Another path flipped a terminal state under us. Bail.
      await client.query('rollback')
      return { tg: 'already_sent' }
    }

    // Step 5 — send. The helper enforces 5s timeout + retry budget
    // (retryMax=2 ⇒ up to 3 attempts within this single helper call).
    // Per §6 RISK-2 + the candidate-set filter, ANY failure after
    // these in-helper retries is IMMEDIATELY terminal — no across-
    // tick retry budget exists.
    const result = await tgSend({
      botToken: tgToken,
      chatId,
      text: body,
      retryMax: 2,
    })

    // Step 6 — success.
    if (result.ok) {
      const r = await client.query(
        `update teacher_account_daily_digests
            set telegram_sent = true,
                telegram_sent_at = now(),
                telegram_message_id = $3,
                telegram_last_error = null
          where account_id = $1 and sent_date = $2::date
            and telegram_sent = false
            and telegram_skipped_reason is null
          returning telegram_message_id`,
        [accountId, ymd, result.messageId ?? null])
      if (r.rowCount === 0) {
        // SHOULD BE UNREACHABLE — we hold FOR UPDATE on this row from
        // step 3 and we just confirmed our ownership via step 4's
        // guarded UPDATE. If this fires, it indicates a deeper
        // invariant break (e.g. row deleted under our lock by a
        // different code path — bug, not benign race). Log error.
        // R2-7 closure.
        await client.query('rollback')
        logJson('error', 'teacher telegram block: success UPDATE affected 0 rows — invariant break', { accountId, ymd })
        return { tg: 'already_sent' }
      }
      await client.query('commit')
      return { tg: 'sent', messageId: result.messageId ?? null }
    }

    // Step 7 — 403 ⇒ auto-unsubscribe + terminal. UPDATE is scoped to
    // chat_id to defend against the rebound race (round-1 implicit
    // dependency on BCS-DEF-4-TG-LINK R2-#2). R3 WARN #4 closure:
    // rowCount checked on both UPDATEs; 0-row on the accounts UPDATE
    // means the chat_id changed under us (re-bind race) — that's
    // benign, we still flip the dedup row.
    if (typeof result.error === 'string'
        && result.error.startsWith('telegram_403')) {
      const redactedDetail = redactTelegramSecret(
        result.detail ?? '', tgToken).slice(0, 1000)
      const unbindR = await client.query(
        `update accounts
            set teacher_telegram_enabled = false
          where id = $1
            and teacher_telegram_chat_id = $2`,
        [accountId, chatId])
      if (unbindR.rowCount === 0) {
        // Benign: chat_id changed under us (re-bind happened between
        // our step-5 send and step-7 unbind). The new binding's
        // chat_id is different; we don't touch it.
        logJson('info', 'teacher telegram block: 403 auto-unbind found 0 matching chat_id (re-bind race)', { accountId })
      }
      const dedupR = await client.query(
        `update teacher_account_daily_digests
            set telegram_skipped_reason = 'bot_blocked_by_user',
                telegram_last_error = $3
          where account_id = $1 and sent_date = $2::date
            and telegram_sent = false
            and telegram_skipped_reason is null`,
        [accountId, ymd, redactedDetail])
      if (dedupR.rowCount === 0) {
        // SHOULD BE UNREACHABLE under FOR UPDATE row lock from step 3.
        logJson('error', 'teacher telegram block: 403 dedup UPDATE affected 0 rows — invariant break', { accountId, ymd })
      }
      await client.query('commit')
      return { tg: 'bot_blocked' }
    }

    // Step 8 — any non-403 failure is IMMEDIATELY terminal. R2-2
    // closure: the candidate-set filter excludes email_sent=true rows
    // so there is no across-tick retry budget; the within-helper
    // tgSend.retryMax=2 already exhausted before we reach here.
    // CHECK constraint's "Retryable terminal (send_failed)" branch
    // requires telegram_attempts >= 1; step 4 incremented attempts
    // from 0 to 1, so the CHECK is satisfied.
    const errorString = String(result.detail ?? result.error ?? 'unknown')
    const redactedError = redactTelegramSecret(errorString, tgToken).slice(0, 1000)
    const terminalR = await client.query(
      `update teacher_account_daily_digests
          set telegram_skipped_reason = 'send_failed',
              telegram_last_error = $3
        where account_id = $1 and sent_date = $2::date
          and telegram_sent = false
          and telegram_skipped_reason is null`,
      [accountId, ymd, redactedError])
    if (terminalR.rowCount === 0) {
      // SHOULD BE UNREACHABLE under FOR UPDATE row lock from step 3.
      // R3 WARN #4 closure.
      logJson('error', 'teacher telegram block: send_failed UPDATE affected 0 rows — invariant break', { accountId, ymd })
    }
    await client.query('commit')
    return { tg: 'terminal_send_failed', error: result.error }
  } catch (err) {
    try {
      await client.query('rollback')
    } catch (_) { /* swallow rollback errors */ }
    logJson('warn', 'teacher telegram block crashed', {
      accountId,
      err: redactTelegramSecret(
        stringifyTelegramError(err), tgToken),
    })
    // R2-2 closure: crash path is also terminal — there is no
    // across-tick retry. We return 'terminal_send_failed' so the
    // counters cleanly aggregate; the dedup row state depends on
    // when the crash happened (pre-step-4 ⇒ row stays in pre-
    // existing state; post-step-4 ⇒ rollback unwinds the bump and
    // row stays in pre-existing state). The candidate-set filter
    // means this row won't be re-evaluated regardless.
    return { tg: 'terminal_send_failed', error: 'block_crashed' }
  }
}
```

**Critical invariants:**
- Every UPDATE checks `r.rowCount` (round-1 WARN 7 closure).
- The redaction-then-slice ordering is safe: `redactTelegramSecret()` replaces the full token + `bot<token>` + last-8-chars-of-token BEFORE the slice (round-1 INFO 15 confirmation; `scripts/lib/telegram-alerts.mjs:77-103`).
- The auto-unsubscribe UPDATE is scoped to `WHERE id = $1 AND teacher_telegram_chat_id = $2` so a fresh re-bind under a new chat_id is not retroactively wiped.
- The block always commits or rolls back its OWN TX-B — the outer email TX-A is already committed by the time runTeacherTelegramBlock is called (round-1 BLOCKER 4 closure — clean transactional boundary).

#### 2.4.2 Call-site delta in `processOneTeacher` + `main()`

R2-1 closure: the new `telegramOutcome` field is added to `processOneTeacher`'s return shape; `main()` does the counter increment.

**Change A — `processOneTeacher` signature + sendResult.ok branch** at `scripts/teacher-daily-digest.mjs:264-270` + `:484-496`. **Required import additions** (R3 WARN #1 closure) at the top of `scripts/teacher-daily-digest.mjs:1-50`:

```js
import { sendTelegramMessage } from './lib/telegram-alerts.mjs'
import { runTeacherTelegramBlock } from './lib/teacher-daily-digest-telegram.mjs'
import { renderTeacherDailyDigestTelegram } from './lib/teacher-daily-digest-telegram-template.mjs'
```

These join the existing `renderTeacherDailyDigestEmail` import at `:41`. The `.mjs` extensions are required by Node's ESM resolution.

```js
// New args added to processOneTeacher's destructured input:
export async function processOneTeacher({
  pool,
  candidate,
  now,
  maxAttempts,
  resendSend,
  // NEW (R2-1):
  telegramEnabled = false,    // boolean — master switch state
  tgToken = '',                // string — TELEGRAM_BOT_TOKEN value
  tgSend = sendTelegramMessage, // function — DI hook for tests
  renderTelegram = renderTeacherDailyDigestTelegram,  // function — DI hook
}) {
  // ...existing logic up to and including the sendResult.ok branch...

  if (sendResult.ok) {
    await client.query(
      `update teacher_account_daily_digests
          set email_sent=true,
              sent_at=now(),
              resend_email_id=$3,
              last_error=null,
              updated_at=now()
        where account_id=$1 and sent_date=$2::date`,
      [candidate.accountId, ymd, sendResult.emailId],
    )
    await client.query('commit')
    // NEW — Round-1 BLOCKER 4 + R2-1 + R2-2 closure: Telegram block
    // on email-sent branch only. Email durably persisted; best-
    // effort second-channel delivery.
    let telegramOutcome = null
    if (telegramEnabled && tgToken) {
      // R3 WARN #2 closure: pass the SAME normalized-slot shape the
      // email renderer received (NOT raw `slots`). Re-use the
      // mapped-slot expression via a local var to avoid the
      // duplicate `.map(...)` inline.
      const normalizedSlots = slots.map((s) => {
        const learner = s.learnerAccountId
          ? learnerLabels.get(s.learnerAccountId) ?? null
          : null
        return {
          startAtIso: s.startAtIso,
          learnerDisplayName: learner?.displayName ?? null,
          learnerEmail: learner?.email ?? '',
          zoomUrl: s.zoomUrl,
        }
      })
      // Implementer note: the email-render call site at :456-466
      // currently inlines this same `.map(...)`. Refactor: hoist
      // the mapped array into `normalizedSlots` (single local var)
      // and pass to BOTH renders. No behaviour change for the email
      // path. R3 WARN #2 closure invariant: email + Telegram renders
      // receive identical normalized-slot arrays.
      const tgBody = renderTelegram({
        slots: normalizedSlots,
        teacherDisplayName: candidate.displayName,
        teacherTimezone: tz,
        siteUrl: SITE_URL,
      })
      const tgResult = await runTeacherTelegramBlock({
        client,
        accountId: candidate.accountId,
        ymd,
        telegramEnabled: true,
        tgToken,
        tgSend,
        body: tgBody,
      })
      telegramOutcome = tgResult.tg
    }
    return {
      outcome: 'sent',
      emailId: sendResult.emailId,
      telegramOutcome,  // NEW
    }
  }
```

**Change B — `main()` per-outcome counter block** at `scripts/teacher-daily-digest.mjs:636-680` (per-iteration loop body). Currently the loop increments `counts[outcome]++`. R2-1 closure adds:

```js
const result = await processOneTeacher({
  pool,
  candidate,
  now,
  maxAttempts,
  resendSend,
  // NEW (R2-1):
  telegramEnabled: settings.TEACHER_DIGEST_TELEGRAM_ENABLED.value === 1,
  tgToken: (process.env.TELEGRAM_BOT_TOKEN ?? '').trim(),
})
counts[result.outcome] = (counts[result.outcome] ?? 0) + 1
// NEW (R2-1):
if (result.telegramOutcome !== null && result.telegramOutcome !== undefined) {
  const key = `telegram_${result.telegramOutcome}`
  counts[key] = (counts[key] ?? 0) + 1
}
```

`scripts/teacher-daily-digest.mjs:541-554` (operator-settings resolution) — settings.TEACHER_DIGEST_TELEGRAM_ENABLED is added to the destructured fields and to resolvedThresholds (1 new key).

Notes:
- `telegramEnabled` and `tgToken` are passed from `main()` to `processOneTeacher` via the new destructured args. Defaults preserve backward compatibility (`false` + `''` — tests that omit them get the no-Telegram path).
- The Telegram block executes INSIDE `processOneTeacher` on the same `client` connection AFTER the email TX-A committed. The `finally` block at `:518` releases the client whether the Telegram block committed, rolled back, or threw.
- All 7 other terminal branches (`outside_band`, `already_sent`, `terminal_skip`, `terminal_send_failed`, `empty_day`, `email_missing`, `send_failed_transient`) return with `telegramOutcome: null` (or simply omit the field — `result.telegramOutcome ?? null` in `main()`). No call to runTeacherTelegramBlock.

#### 2.4.3 Telegram template (R2-5 closure)

`scripts/lib/teacher-daily-digest-telegram-template.mjs` + `lib/notifications/teacher-digest-telegram-template.ts` (TS mirror for tests) — plain text, ≤1024 chars, no `parse_mode`. **The existing email renderer at `:452-468` is NOT extended** — R2-5 closure. The email renderer's `{subject, text, html}` return shape and the existing `tests/email/teacher-daily-digest.test.ts` drift pin stay bit-for-bit identical. The Telegram body is rendered by a SEPARATE new helper called from `processOneTeacher` AFTER the email COMMIT, BEFORE invoking `runTeacherTelegramBlock` (see §2.4.2 Change A). The new helper reuses the `slots` + `learnerLabels` already loaded for the email render (in-scope per §2.4.2 timing).

New helper signature:

```js
export function renderTeacherDailyDigestTelegram({
  slots,             // already-normalized: [{ startAtIso, learnerDisplayName, learnerEmail, zoomUrl }] — SAME shape as email renderer's `slots` arg per scripts/teacher-daily-digest.mjs:456-466 (R3 WARN #2 closure)
  teacherDisplayName,
  teacherTimezone,
  siteUrl,
}) {
  // ... emit plain text per §2.4.3 shape, ≤1024 chars,
  // truncation strategy per §3.9 ...
  return string  // plain Telegram body
}
```

Renderer input contract: the `slots` arg is the SAME normalized shape the email renderer accepts (`{startAtIso, learnerDisplayName, learnerEmail, zoomUrl}` per `scripts/teacher-daily-digest.mjs:456-466`). The Telegram renderer does NOT receive raw `slots` or `learnerLabels`. R3 WARN #2 closure pins this.

Shape:

```
LevelChannel — занятия на сегодня

   2 занятия

   09:00 — Иванова И.
   14:30 — Петрова М. (zoom: https://meet.google.com/xxx-yyyy-zzz)

Открыть календарь: https://levelchannel.ru/teacher

Отписаться от Telegram-дайджеста: /stop
```

**PII deltas vs email** — none. The body shows the same learner-name content the email template shows (first name + initial via the SAME `renderTeacherDailyDigestEmail` PII policy from BCS-DEF-5 §4.1: first-name + initial, email-first-letter fallback, NEVER full email).

Drift test (§3.9) pins the template's output against a frozen golden fixture covering: 1-slot day, 5-slot day, slot with null `learner_account_id`, slot with null `zoom_url`, 1024-char-cap probe (synthetic 12-slot day with long display names — graceful truncation: drop zoom-urls, then trailing slots, emit "(+N ещё, см. календарь)").

#### 2.4.4 Counters delta

`scripts/teacher-daily-digest.mjs:585-595` (round-1 INFO 17 confirmation) — extend the `counts` object initializer with the 7 Telegram counters (R2-2 closure removed `telegram_send_failed_transient`):

```js
const counts = {
  // ...existing 9 fields...
  telegram_sent: 0,
  telegram_skipped_no_binding: 0,
  telegram_skipped_disabled: 0,
  telegram_terminal_send_failed: 0,
  telegram_bot_blocked: 0,
  telegram_already_sent: 0,
  telegram_row_missing: 0,
}
```

The `counts[\`telegram_${result.telegramOutcome}\`]` increment in §2.4.2 Change B maps 1:1 to these keys. Surface via `logJson` at `:689` (untouched — `counts` is already serialized) and via `recordProbeRun({stats: counts})` at `:699`.

### 2.5 Webhook route — extended for UNION-SELECT across both bind-code tables

The webhook at `app/api/telegram/webhook/route.ts` is shipped by BCS-DEF-4-TG-LINK. This wave extends `/start <code>` to UNION-resolve against both tables:

```ts
// inside handleStart(code, chatId, fromId):
//   1. Trim + validate /^[A-Z0-9]{8}$/.
//
//   2. Pre-lock SELECT — find which table holds the code and what
//      account_id it belongs to. NO row lock yet.
const pre = await tx.query(
  `select 'learner' as kind, account_id
     from learner_telegram_bind_codes
     where code = $1
       and consumed_at is null
       and expires_at > now()
   union all
   select 'teacher' as kind, account_id
     from teacher_telegram_bind_codes
     where code = $1
       and consumed_at is null
       and expires_at > now()`,
  [code])
//   3. On 0 rows → reply "Код просрочен или уже использован."
//   4. On 2 rows (cross-table code collision, ~10^-12 probability)
//      → reply "внутренняя ошибка" + log alert.
//   5. On 1 row → take ACCOUNT-scoped advisory lock matching the
//      kind's issuance-side lock key (R2-3 closure: issue + consume
//      share the same key-space).
const { kind, account_id } = pre.rows[0]
const lockKey = kind === 'teacher'
  ? `ttbc:${account_id}`
  : `ltbc:${account_id}`
await tx.query(
  `select pg_advisory_xact_lock(hashtext($1))`,
  [lockKey])
//   6. Re-SELECT FOR UPDATE inside the lock — confirm the code is
//      still consumable (race-loser: another /start <same-code>
//      consumed it between step 2 and step 5).
const found = await tx.query(
  kind === 'teacher'
    ? `select code, account_id from teacher_telegram_bind_codes
        where code = $1 and consumed_at is null and expires_at > now()
        for update`
    : `select code, account_id from learner_telegram_bind_codes
        where code = $1 and consumed_at is null and expires_at > now()
        for update`,
  [code])
if (found.rowCount === 0) {
  // Two valid 0-row cases (R3 WARN #5 closure):
  //   (a) Race-lost: another /start handler consumed the code
  //       between step 2 and step 5.
  //   (b) Expired: the code's TTL elapsed (expires_at > now() in
  //       step 2 but expires_at <= now() in step 6).
  // Both cases get the same user-facing message.
  return reply('Код просрочен или уже использован.')
}
//   7. Gate on accounts (disabled/purge state per BCS-DEF-4-TG-LINK
//      R2-#5). On gate fail: reply "Аккаунт недоступен;
//      обратитесь в поддержку." + DO NOT consume the code.
//   8. UPDATE the right bind_codes table (set consumed_at,
//      consumed_chat_id = $chatId). UPDATE accounts to set the
//      right *_telegram_{enabled=true, chat_id=$chatId} pair based
//      on kind.
//   9. Audience-keyed reply:
//      - learner: existing copy (BCS-DEF-4-TG-LINK §2.4).
//      - teacher: "Готово. Будете получать ежедневный дайджест
//                  занятий на день в 08:00 утра по вашему часовому
//                  поясу. Изменить параметры:
//                  levelchannel.ru/teacher/settings/digest.
//                  Отписаться: /stop."
```

The lock key-space match (`ttbc:account_id` issued in `requestTeacherTelegramBindCode` and consumed in handleStart; `ltbc:account_id` issued by BCS-DEF-4-TG-LINK and consumed in handleStart) means issue + consume + auto-unbind on the SAME account serialize against each other. Issue across different accounts does not contend. No deadlock potential (single-key locking ordered by account_id).

**`/stop` handler — UNION across both tables.** Mirrors BCS-DEF-4-TG-LINK's `/stop` semantics (a chat could be bound to both a learner and a teacher account on the same Telegram user — we set BOTH `learner_telegram_enabled=false` AND `teacher_telegram_enabled=false` if BOTH columns have this chat_id). Reply names both audiences that were active.

**Code-collision safety.** Both tables use 8-char `[A-Z0-9-IO01]` codes; collision across the two tables is ~32^8 ≈ 10^12 probability per pair, so the UNION cannot return >1 row in practice. Defensive: if UNION returns 2 rows, webhook replies "внутренняя ошибка" and logs an alert (per BCS-DEF-4-TG-LINK conventions).

**FALLBACK if BCS-DEF-4-TG-LINK lands with a single shared `telegram_bind_codes` table + `kind` discriminator** (different shape from what §0 + this section assume): the UNION-SELECT is replaced by a single SELECT with `WHERE code = $1 AND kind IN ('learner','teacher')`. The role-gating at code-issuance side then enforces what `kind` value gets written. The §0c re-paranoia clause covers this branch.

### 2.6 Teacher cabinet UI — `/teacher/settings/digest` (NEW surface)

NEW page under the teacher cabinet (round-1 INFO 14 — confirmed NEW, not extending an existing page). Reuses the BCS-DEF-4-TG-LINK `/cabinet/profile` Telegram-section pattern verbatim — only the URL surface and Server Actions differ.

**URL:** `/teacher/settings/digest`. The teacher cabinet currently exposes `/teacher` (calendar) and `/teacher/settings/calendar` (Google Calendar binding); the digest settings page is a sibling under `/teacher/settings/`.

**Page sections:**
1. **Header.** "Утренний дайджест занятий" — short copy explaining the 08:00 local-time delivery + that it shows today's booked slots.
2. **Email channel status.** Always-on; says "Дайджест приходит на <email>." No opt-out (parent plan §0a decision 5).
3. **Telegram channel** — gated by `TEACHER_DIGEST_TELEGRAM_ENABLED` master switch (admin-side):
   - Master switch off → section hidden entirely.
   - Master switch on + `accounts.teacher_telegram_enabled = false` → "Подключите Telegram, чтобы получать дайджест в мессенджере. [Получить код]" button POSTs Server Action `requestTeacherTelegramBindCode`.
   - Code issued + within TTL → render the 8-char code + "Привязать через Telegram" deep-link button (`https://t.me/<TELEGRAM_BOT_USERNAME>?start=<code>`) + countdown "Код действует 9:47".
   - `accounts.teacher_telegram_enabled = true` → "Telegram-дайджест включён. [Отвязать]" button POSTs Server Action `unbindTeacherTelegram`.

**Server Actions** (new file `app/teacher/settings/digest/telegram-actions.ts`):
- `requestTeacherTelegramBindCode()`: rate-limit 5 req/hour/account (mirrors learner side); takes `pg_advisory_xact_lock(hashtext('ttbc:' || account_id::text))`; deletes prior unconsumed codes; generates new code via `crypto.randomBytes` mapped to the 32-char alphabet; INSERTs into `teacher_telegram_bind_codes`; returns `{code, expiresAt}`.
- `unbindTeacherTelegram()`: SELECT current chat_id; UPDATE `accounts SET teacher_telegram_enabled=false` (defensive: keep `teacher_telegram_chat_id` populated for short-window re-binds without re-handshake — but the CHECK constraint `accounts_teacher_telegram_consistency` permits `enabled=false` with any chat_id value; the retention sweep eventually nulls it); fire-and-forget courtesy Telegram message via `sendTelegramMessage`.

**Archetype gate.** `app/teacher/layout.tsx:50-56` already redirects non-teachers to `/cabinet`. The Server Actions ALSO re-check `listAccountRoles(account.id).includes('teacher')` as defence-in-depth — a learner-archetype POST to `requestTeacherTelegramBindCode` returns 403 even if it bypasses the layout.

### 2.7 Admin UI — `/admin/settings/digest` "Telegram канал" section

NEW section added to the existing admin digest page (`app/admin/(gated)/settings/digest/page.tsx`). Position: after the "Settings editor" section, as a 4th section.

Content:
- **Master switch** — `TEACHER_DIGEST_TELEGRAM_ENABLED` (0/1 toggle via the existing `SettingEditor`).
- **Env presence indicators** — `TELEGRAM_BOT_TOKEN` set? (boolean only; value NEVER rendered).
- **Active bindings count** — `SELECT count(*) FROM accounts WHERE teacher_telegram_enabled = true AND teacher_telegram_chat_id IS NOT NULL`. Lives in new helper `lib/admin/teacher-telegram-summary.ts`.
- **Recent unbinds (last 24h)** — derived from `probe_runs.stats.telegram_bot_blocked` cumulative sums over the last 24h of `'teacher-daily-digest'` rows; supplemented by an `audit_events` query if BCS-DEF-4-TG-LINK ships an unbind audit trail. (If unavailable, the section shows only "active bindings count" + "per-tick counter breakdown".)
- **Per-tick Telegram counter breakdown** — sums the `stats.telegram_*` counters from the last 24h of `probe_runs WHERE probe_name='teacher-daily-digest'`.

**Admin-side per-teacher TG-test-send is OUT OF SCOPE** for this PR (mirrors BCS-DEF-1-TG WARN#2 limitation).

---

## 3. Tests

### 3.1 Migration tests

`tests/integration/admin/teacher-telegram-migrations.test.ts`:
- 0070 + 0071 apply clean on a fresh DB.
- Post-0071: existing `tadd_state_consistency` CHECK still holds for an email-only row; new `tadd_telegram_state_consistency` rejects invalid Telegram-state combinations.
- `accounts_teacher_telegram_consistency` rejects `teacher_telegram_enabled=true AND teacher_telegram_chat_id IS NULL`.
- `telegram_skipped_reason='unknown'` fails the CHECK on `teacher_account_daily_digests`.

### 3.2 Bind-code workflow

`tests/teacher/teacher-telegram-bind-code.test.ts` (mirrors BCS-DEF-4-TG-LINK §3.1 + §3.3):
- Generated code matches `/^[A-Z0-9]{8}$/` with no I/O/0/1.
- TTL is exactly 10 minutes (`expires_at - created_at`).
- Generating twice for same teacher account: first row replaced (advisory-lock pinned).
- `/start <code>` happy path: `accounts.teacher_telegram_enabled` flipped to true, `chat_id` populated, code row marked consumed; webhook reply matches the teacher-audience copy.
- **Replay protection**: same code redeemed twice → second redemption replies "Код просрочен или уже использован"; binding state unchanged.
- Cross-archetype gate: a learner-archetype POST to `requestTeacherTelegramBindCode` returns 403; no row inserted.

### 3.3 Digest send — Telegram fires for subscribed teacher

`tests/integration/scripts/teacher-daily-digest-telegram.test.ts`:
- `TEACHER_DIGEST_TELEGRAM_ENABLED=0` (default) → no Telegram API call; email path completely unaffected; `counts.telegram_*` are all 0 (no skip writes because `runTeacherTelegramBlock` is never called when `telegramEnabled=false` at the call site at §2.4.2).

  > Correction: re-reading §2.4.2, the call site IS guarded by `if (telegramEnabled && tgToken)`. So when the master switch is OFF, `runTeacherTelegramBlock` is NOT invoked at all and the `telegram_skipped_reason='channel_disabled'` row is NOT written. This is intentional — there's nothing for the operator to see in the dedup row when the channel is globally off. If the operator wants visibility, they read `TEACHER_DIGEST_TELEGRAM_ENABLED` directly. Test asserts: no Telegram API call AND no UPDATE to telegram_* columns on the dedup row.

- Enabled + teacher with `teacher_telegram_enabled=true AND teacher_telegram_chat_id='123456789'` (R2-4 closure — non-null chat_id required by `accounts_teacher_telegram_consistency` CHECK; fixture explicitly sets both) + non-empty day → email send AND Telegram send both fire; dedup row has `email_sent=true, telegram_sent=true, telegram_message_id=<id>`.
- **Negative CHECK fixture (R2-4 closure):** attempting to INSERT a teacher account with `teacher_telegram_enabled=true AND teacher_telegram_chat_id IS NULL` fails the `accounts_teacher_telegram_consistency` CHECK at the DB layer. Pinned by §3.1 migration test, not §3.3.
- Enabled + teacher with `teacher_telegram_enabled=false` → email sent; dedup row has `email_sent=true, telegram_skipped_reason='no_telegram_binding'`.
- Mocked Telegram 403 → email sent; `accounts.teacher_telegram_enabled` flipped to false (scoped to chat_id); dedup row has `telegram_skipped_reason='bot_blocked_by_user'`; future tick same day skips Telegram for this teacher (but the candidate-set already excludes them post-email-sent; this is a within-helper guard for safety).
- Mocked Telegram 5xx → email sent; the within-helper retry budget (`retryMax=2`) exhausts; per R2-2 closure, the row is IMMEDIATELY terminal — `telegram_skipped_reason='send_failed'`, `telegram_attempts=1`, `telegram_last_error=<redacted>`. **Note: the candidate-set filter at `:159-162` excludes this teacher on the next tick** (because `email_sent=true`); test pins this — second tick has 0 candidates.

### 3.4 Same-day re-evaluation behaviour

`tests/integration/scripts/teacher-daily-digest-telegram-same-day.test.ts`:
- After Telegram fails on day X (`telegram_skipped_reason='send_failed'`), the next tick (same day) returns 0 candidates because `email_sent=true`. This is the §6 RISK-2 trade-off pinned in code.
- New day (X+1) — fresh dedup row; if `teacher_telegram_enabled=true` still, Telegram fires.

### 3.5 Redaction of Telegram errors in `probe_runs` + dedup row

`tests/integration/scripts/teacher-daily-digest-redaction.test.ts`:
- Mocked Telegram 5xx error string containing the token suffix → after the tick, `teacher_account_daily_digests.telegram_last_error` does NOT contain the token, the last-8-chars-of-token, or the `bot<token>` prefix; the literal string `[REDACTED]` is present (post-slice).
- The per-tick `recordProbeRun({stats})` does NOT propagate the raw error string (counters only; no error text in the stats payload). The crash-path log inside `runTeacherTelegramBlock` ALSO passes through the redactor.

### 3.6 Cabinet UI

`tests/integration/teacher/digest-telegram-binding.test.ts`:
- GET `/teacher/settings/digest` as anonymous → 307 → `/login`.
- GET as learner-archetype → 307 → `/cabinet`.
- GET as teacher → 200; Telegram section hidden when master switch off.
- GET as teacher with master switch on + no binding → "Получить код" button visible.
- POST `requestTeacherTelegramBindCode` 6× in 1 hour → 6th call rate-limited.
- POST `unbindTeacherTelegram` with no active binding → no-op (idempotent).
- POST `unbindTeacherTelegram` with active binding → `accounts.teacher_telegram_enabled` flipped to false; courtesy Telegram fire-and-forget attempted (mocked).

### 3.7 Admin UI

`tests/integration/admin/digest-telegram-row.test.ts`:
- GET `/admin/settings/digest` as admin → renders the new "Telegram канал" section; master switch round-trips; active-bindings count matches DB seed.
- Env-presence indicator boolean reflects mocked env; **regression pin**: the bot-token value never appears in HTML.

### 3.8 Drift mirror

`tests/admin/operator-settings.test.ts` (modified):
- New key `TEACHER_DIGEST_TELEGRAM_ENABLED` present in BOTH `lib/admin/operator-settings.ts SETTING_SCHEMA` AND `scripts/lib/operator-settings.mjs` mirror; scope is `'teacher-daily-digest'`.

### 3.9 Template golden

`tests/notifications/teacher-digest-telegram-template.test.ts`:
- 1-slot day → expected golden text.
- 5-slot day → expected golden text.
- Slot with `learner_account_id IS NULL` → "Учащийся не привязан" line.
- Slot with `zoom_url IS NULL` → zoom-url omitted.
- 12-slot synthetic day with maximum-length display names → body still ≤1024 chars (truncation: drop zoom-urls, then trailing slots, emit "(+N ещё, см. календарь)").
- Plain text only (no `*`, `_`, `[`, `]` chars present in output).

### 3.10 Race-safety unit tests

`tests/scripts/teacher-daily-digest-telegram-race.test.ts`:
- Simulate two concurrent `runTeacherTelegramBlock` invocations against the same (account_id, sent_date) — the `SELECT ... FOR UPDATE` at step 3 serializes them; only ONE produces `tg: 'sent'`, the other produces `tg: 'already_sent'`.
- Simulate the `bumped.rowCount === 0` branch by pre-setting the dedup row to a terminal Telegram state (`telegram_skipped_reason='channel_disabled'`) and asserting the helper returns `tg: 'already_sent'` without calling `tgSend`. R3 WARN #3 closure — the helper no longer carries a `maxAttempts` gate; the only way step 4's guarded UPDATE returns 0 rows is if another path has already flipped a terminal state.

---

## 4. Security analysis

INHERITED VERBATIM from BCS-DEF-4-TG-LINK §4.1-§4.8 + BCS-DEF-1-TG §4.1 redaction contract. Deltas:

### 4.1 PII

Teacher Telegram body shows the SAME learner-name content the email body shows (first-name + initial; email-first-letter fallback; NEVER full email). Symmetric to BCS-DEF-5 §4.1; verified by §3.9 template tests. Teacher already sees these learner names in `/teacher` calendar — no incremental disclosure.

### 4.2 Cross-archetype binding spoofing

A learner CANNOT bind a teacher subscription because:
1. `/teacher/settings/digest` layout gate at `app/teacher/layout.tsx:50-56` redirects non-teachers to `/cabinet`.
2. `requestTeacherTelegramBindCode` re-checks the teacher role grant before INSERTing.
3. `teacher_telegram_bind_codes` is a SEPARATE table; there is no `kind` discriminator the attacker could spoof.
4. The webhook's UNION-SELECT trusts the table-of-origin for audience routing — only role-gated paths write rows to the teacher table.

### 4.3 Token redaction

Inherited verbatim from BCS-DEF-1-TG §4.1: every string derived from a Telegram-API exception passes through `redactTelegramSecret(text, token)` BEFORE crossing into `teacher_account_daily_digests.telegram_last_error`, `recordProbeRun({stats})` (where applicable — stats are counters only), `console.*` log lines, or any HTTP response body. The `.slice(0, 1000)` truncation runs AFTER redaction — safe by construction (round-1 INFO 15).

### 4.4 Race-with-other-tick

`SELECT ... FOR UPDATE` at step 3 takes the row lock; subsequent guarded UPDATEs use `RETURNING` to detect race losers. §3.10 pins this.

**Within-helper crash mid-send.** Telegram's `sendMessage` API has no `idempotencyKey` equivalent. If the cron crashes after `tgSend` returns success but before the COMMIT — the next tick would NOT re-evaluate this teacher (candidate-set filter), so the worst case is "user got Telegram but the row says `telegram_sent=false`" — a phantom row state, not a double-send. **The candidate-set filter eliminates the double-send risk inherent to the BCS-DEF-1-TG operator-alert model.** §6 RISK-2 documents this trade-off.

### 4.5 Migration ACCESS EXCLUSIVE

- 0070 — new tables + new columns on `accounts`. Brief ACCESS EXCLUSIVE on `accounts` for the column adds (metadata-only PG11+). Long-running cron sweeps SHOULD pause for the migration window per BCS-DEF-4-TG-LINK precedent.
- 0071 — ACCESS EXCLUSIVE briefly on `teacher_account_daily_digests`. Operator runbook §2.1 step 3 stops the timer first (round-1 WARN 8 closure).

### 4.6 GDPR / chat-id retention

`accounts.teacher_telegram_chat_id` is added to the existing anonymize-on-purge column list in `scripts/db-retention-cleanup.mjs` (round-1 WARN 9 closure). `teacher_telegram_bind_codes` is swept by the existing BCS-DEF-4-TG-LINK retention pass (consumed/expired rows older than 30 days deleted; `consumed_chat_id` nulled on purged-account rows).

---

## 5. Decomposition — independent epic, single PR

**Decision: INDEPENDENT EPIC, single PR.** Three reasons:

1. BCS-DEF-5 SHIPPED 2026-05-19 (PR #393). No open epic to fold into.
2. BCS-DEF-4-TG-LINK (when it ships) precedent — also a single-PR epic. Symmetric handling.
3. Paranoia surface is small (~900-1100 LOC of pure TG delta on the shipped digest cron); standalone-epic trailer covers it cleanly.

**Single PR — epic IS the PR.** Estimated ~1100 LOC. Files:

```
docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md     (rewritten, this file)
migrations/0070_accounts_teacher_telegram_optin_and_bind_codes.sql  (NEW)
migrations/0071_teacher_account_daily_digests_telegram_columns.sql  (NEW)
lib/admin/operator-settings.ts                            (modified — 1 new key)
scripts/lib/operator-settings.mjs                         (mirror — 1 new key)
scripts/teacher-daily-digest.mjs                          (modified — Telegram block on sendResult.ok branch)
scripts/lib/teacher-daily-digest-telegram.mjs             (NEW — extracted runTeacherTelegramBlock helper)
scripts/lib/teacher-daily-digest-telegram-template.mjs    (NEW)
lib/notifications/teacher-digest-telegram-template.ts     (NEW — TS mirror for tests)
app/api/telegram/webhook/route.ts                         (modified — UNION-resolve bind-code lookup; depends on BCS-DEF-4-TG-LINK having shipped this file)
app/teacher/settings/digest/page.tsx                      (NEW)
app/teacher/settings/digest/telegram-actions.ts           (NEW Server Actions)
app/admin/(gated)/settings/digest/page.tsx                (modified — 4th section "Telegram канал")
lib/admin/teacher-telegram-summary.ts                     (NEW)
scripts/db-retention-cleanup.mjs                          (modified — extend anonymize list + bind_codes sweep clause)
tests/integration/admin/teacher-telegram-migrations.test.ts          (NEW)
tests/teacher/teacher-telegram-bind-code.test.ts                     (NEW)
tests/integration/scripts/teacher-daily-digest-telegram.test.ts      (NEW)
tests/integration/scripts/teacher-daily-digest-telegram-same-day.test.ts (NEW)
tests/integration/scripts/teacher-daily-digest-redaction.test.ts     (NEW)
tests/integration/teacher/digest-telegram-binding.test.ts            (NEW)
tests/integration/admin/digest-telegram-row.test.ts                  (NEW)
tests/notifications/teacher-digest-telegram-template.test.ts         (NEW)
tests/scripts/teacher-daily-digest-telegram-race.test.ts             (NEW)
tests/admin/operator-settings.test.ts                                (modified — drift pin)
tests/scripts/fixtures/telegram-fetch-errors.json                    (REUSED from BCS-DEF-1-TG)
ENGINEERING_BACKLOG.md                                               (modified — strikethrough)
docs/plans/bcs-def-5-teacher-reminders.md                            (modified — §10 cross-ref to this plan PR)
ARCHITECTURE.md                                                      (modified — teacher Telegram digest channel)
```

**Critical-path:** `lib/admin/operator-settings.ts` IS on critical path (1 key added, additive). Trailer carries `Codex-Paranoia: SIGN-OFF round N/3` (one-PR epic; plan + wave collapsed).

---

## 6. Risks + mitigations

Most risks INHERITED from BCS-DEF-4-TG-LINK §6 and BCS-DEF-1-TG §6. Deltas:

### RISK-1 — Token reuse implications

The same `TELEGRAM_BOT_TOKEN` now serves THREE flows: operator alerts (BCS-DEF-1-TG), learner per-slot reminders (BCS-DEF-4-TG-LINK), and teacher daily digests (this plan). A bot-token rotation affects ALL THREE simultaneously. **Mitigation:** operator runbook documents the single-rotation contract. Blast radius = "all Telegram", not "all reminders" — email is unaffected.

### RISK-2 — No same-day Telegram retry on email-sent day

The candidate-set SQL at `scripts/teacher-daily-digest.mjs:149-163` excludes any teacher with `email_sent=true`. So if Telegram fails AFTER the email succeeds on day X, the next tick on day X will NOT re-evaluate that teacher — the teacher simply doesn't get Telegram for that day. The within-helper retry budget (`retryMax=2` ⇒ 3 attempts total inside a single 15s helper invocation) is the ONLY retry budget. **Mitigation:** this is intentional — the email already arrived (the primary channel succeeded). The trade-off avoids the more complex alternative of forking the candidate-set SQL to consider `email_sent=true AND telegram_sent=false AND telegram_skipped_reason IS NULL AND telegram_attempts < maxAttempts`, which would re-enter `processOneTeacher` only for Telegram and require either (a) major restructuring of `processOneTeacher` to short-circuit the email path on a per-channel basis, or (b) a sibling "Telegram-only re-evaluator" cron pass. Both rejected for MVP scope; documented and accepted. §3.4 pins the test.

### RISK-3 — Telegram double-send on crash mid-send within helper

The within-helper bounded retry (`retryMax=2`) can hit success-then-crash before COMMIT once. Next tick excludes this teacher (candidate-set filter), so the worst case is "user got Telegram but the DB row says `telegram_sent=false`" — single phantom row, not a double-send to the user. Accepted.

### RISK-4 — Opt-in churn

Teachers may bind/unbind frequently. `accounts.teacher_telegram_{enabled,chat_id}` is per-account; toggling `enabled` is a single UPDATE; no history table grows. The `teacher_telegram_bind_codes` table sees 1 row per request (5/hour rate-limited); sweep is the existing BCS-DEF-4-TG-LINK retention pass. Accepted.

### RISK-5 — Digest-tick rate-limit interaction with TG retry budget

`TEACHER_DIGEST_RATE_LIMIT_PER_TICK` (default 200) caps the per-tick send count. The Telegram block runs INSIDE the same per-teacher iteration; each teacher counts once. Worst-case Telegram-stall: 200 × 15s = 50 minutes — but the candidate-set's next tick re-evaluates the OUTSIDE-band teachers cleanly via the `email_sent=false AND attempts < max_attempts` filter. Accepted.

### RISK-6 — Cross-channel ordering — email arrives, Telegram doesn't

Operator-perceived UX: a teacher checks Telegram, sees no digest, thinks the system is broken; opens email, finds it. **Mitigation:** cabinet copy states "Дайджест приходит на <email>" prominently and the Telegram section is opt-in (not auto-enabled).

### RISK-7 — Body truncation under 1024-char cap

12-slot teacher with long display names could exceed the 1024-char cap. **Mitigation:** template truncates gracefully (drop zoom-urls, then trailing slots, emit "(+N ещё, см. календарь)"). §3.9 pins.

### RISK-8 — Webhook flood on activation

When `TEACHER_DIGEST_TELEGRAM_ENABLED=1` flips, a burst of `/start` binds is possible. **Mitigation:** webhook rate-limited 20 req/min/from-id (BCS-DEF-4-TG-LINK); Server Action `requestTeacherTelegramBindCode` rate-limited 5/hour/account.

### RISK-9 — Migration 0071 ACCESS EXCLUSIVE racing the cron

Round-1 WARN 8. Operator runbook §2.1 step 3 (`systemctl stop levelchannel-teacher-daily-digest.timer`) + step 5 (`systemctl start ...`) bracket the migration window.

### RISK-10 — BCS-DEF-4-TG-LINK shape changes mid-flight

The bind_codes table schema, webhook route signature, retention contract, and `/start <code>` semantics are all inherited from BCS-DEF-4-TG-LINK. If that wave's shape changes, this plan re-paranoia-reviews before implementation (§0c).

---

## 7. Acceptance criteria

The PR ships when:
- **Prerequisite met (§0b):** BCS-DEF-4-TG-LINK is merged to main AND operator has activated it on prod. Without this, the PR does NOT open.
- Migrations 0070 + 0071 apply clean on a fresh test DB.
- `npm run test:run` green.
- `npm run test:integration` green (10 new test files, 1 modified).
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

Post-merge (operator-side activation): per §2.1.

---

## 8. Migration / rollout

1. PR opens with migrations 0070 + 0071 as the only DB changes — ONLY after BCS-DEF-4-TG-LINK has shipped (§0b).
2. CI runs migrations against test DB → green.
3. PR merges (squash) to main.
4. Autodeploy timer picks up the commit:
   - `npm run build`
   - **`systemctl stop levelchannel-teacher-daily-digest.timer`** (round-1 WARN 8 closure)
   - `npm run migrate:up`
   - **`systemctl start levelchannel-teacher-daily-digest.timer`**
   - `systemctl restart levelchannel` (Next.js — picks up the new SETTING_SCHEMA + webhook UNION-SELECT branch)
   - health-check per `docs/private/OPERATIONS.private.md:33-37`
5. `TEACHER_DIGEST_TELEGRAM_ENABLED=0` → runTeacherTelegramBlock is NOT called (call site guard); email path completely unaffected; no Telegram API calls.
6. Operator flips master switch at `/admin/settings/digest`.
7. Teachers begin binding via `/teacher/settings/digest`. The next morning's 08:00 tick sends Telegram alongside email for any bound teacher.

**No ordering hazard.** Migrations are purely additive. Until master switch flips, no Telegram sends occur. (Round-1 implicit: the timer-stop bracket eliminates the ACCESS EXCLUSIVE race.)

---

## 10. Out of scope — deferred follow-ups

- **BCS-DEF-5-TG-TESTSEND** — Admin dry-run button for Telegram digest per-teacher.
- **BCS-DEF-5-TG-MULTI-CHAT** — One teacher binding multiple chats. MVP caps at 1 (column-storage limitation).
- **BCS-DEF-5-TG-RICHFORMAT** — `parse_mode=MarkdownV2` with bold/links/inline keyboards.
- **BCS-DEF-5-TG-ALERT** — Operator alert on mass unbinds (>N in 24h).
- **BCS-DEF-5-TG-RECOVERY** — Admin UI button to un-revoke a teacher unsubscribed by `bot_blocked_by_user`.
- **BCS-DEF-5-TG-GDPR** — Explicit GDPR-erasure column-null path on unbind (column-storage model means `enabled=false` keeps `chat_id` around for the retention window; explicit early-erase is a follow-up).
- **BCS-DEF-5-TG-RETENTION-SCRUB** — If BCS-DEF-4-TG-LINK does NOT extend its retention pass to teacher tables in the same PR, an explicit follow-up PR does it.
- **BCS-DEF-5-TG-SAMEDAY-RETRY** — Re-introduce same-day Telegram retry after email-sent by extending the candidate-set SQL (rejected for MVP per §6 RISK-2).
- **Per-recipient content tailoring beyond email parity.**
- **Per-teacher digest content opt-in/out.**
- **Push (PWA) channel** — not on the roadmap.

---

## 11. Final trailer expectations

```
Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
Critical-Path-Touched: lib/admin/operator-settings.ts
Skill-Used: /codex-paranoia plan + /codex-paranoia wave
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

— END OF DRAFT (BLOCKED on BCS-DEF-4-TG-LINK per §0b; awaiting prerequisite + re-paranoia trigger per §0c) —
