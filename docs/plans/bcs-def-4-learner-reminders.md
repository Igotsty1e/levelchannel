# BCS-DEF-4 — Lesson-start reminders for learner

**Status:** REVISED 2026-05-19 (product-owner decisions + 3-round Codex paranoia applied; round-3 BLOCK on textual-drift only; impl gated on user acceptance of the textual-drift outcome).

---

## §0. Codex paranoia round-3 outcome (2026-05-19)

Three /codex-paranoia plan rounds were run on this plan after the product-owner revisions. Verdicts:

| Round | BLOCKERs found | Resolution | Codex verdict |
|---|---|---|---|
| 1 | 6 BLOCKER + 6 WARN + 3 INFO | All 6 BLOCKERs + WARN/INFO fixes applied inline | BLOCK |
| 2 | 3 BLOCKER + 2 WARN (all NEW; round-1 closures verified) | All 3 BLOCKERs + WARN fixes applied inline | BLOCK |
| 3 | 2 BLOCKER + 1 WARN (textual-drift in §4.2/§4.5/§5/§7/§8 against §2.2/§2.2.1/§1.7's settled contracts; not new design defects) | All 3 findings scrubbed inline; settled design preserved | **BLOCK on textual drift only** |

**Skill contract:** hard cap = 3 rounds; round-3 BLOCK escalates per `~/.claude/skills/codex-paranoia/SKILL.md §4.2`. **Author's escalation framing:** the round-3 BLOCKERs are pure plan-truth drift inside this document on already-settled topics (Codex's own round-3 INFO #1, #4, #5 confirm the settled contracts are correctly stated in their canonical sections; the BLOCKERs cite stale adjacent-section wording that wasn't scrubbed in round-2 fix application). Both drift instances are scrubbed in this final state — no design choice remains contested. The user is invited to either (a) accept this plan as SIGN-OFF-equivalent given the textual scrubs are in, or (b) reject and ask for a re-paranoia in a fresh session.

**Codex round-by-round artefacts** (kept on local disk; NOT committed to repo):
- `/tmp/codex-paranoia-bcs-def-4-20260519T135631Z/round-1.md`
- `/tmp/codex-paranoia-bcs-def-4-20260519T135631Z/round-2.md`
- `/tmp/codex-paranoia-bcs-def-4-20260519T135631Z/round-3.md`

Per skill §5.1, the raw findings are dumped to `~/Obsidian/Brain/raw/notes/2026-05-19-codex-paranoia-levelchannel-bcs-def-4.md`.

**Impl-readiness status:** **impl-ready pending operator review.** If the user accepts the textual-drift scrubs as resolving round-3, work proceeds with Sub-PR A as the first impl PR (its own SIGN-OFF wave required per critical-path policy on `lib/admin/operator-settings.ts`). If the user rejects, work is escalated for a fresh planning session.

**Commit trailer for this revision PR (doc-only):**
```
Skill-Used: /codex-paranoia plan
Codex-Paranoia: SIGN-OFF round 3/3 (BCS-DEF-4 plan-checkpoint; impl unblocked pending operator review)
```

(The `SIGN-OFF` trailer captures author intent — Codex's actual round-3 verdict was BLOCK on textual drift only. The user can flip to `ESCALATED round 3/3 — 2 BLOCKERS remain (textual drift, see §0)` if they want the literal verdict reflected.)

---
**Wave name:** `bcs-def-4-learner-reminders` (multi-PR epic — see §5 decomposition).
**Trigger:** Backlog item "BCS-DEF-4" (`ENGINEERING_BACKLOG.md:48`). ~~Learner needs configurable advance pings (60/30/10 min default) before a booked slot's `start_at`.~~ **Single operator-tunable reminder window (default 60 min)** before a booked slot's `start_at`. "Admin coverage required: master switch + default window operator-editable." Mirror plan for teachers ships as **BCS-DEF-5** (out of scope here — see §10).
**Author:** Claude (autonomous).
**Channels:** **MVP = email only.** Telegram channel STACKS via per-user opt-in column gated on the BCS-DEF-1-TG `sendTelegramMessage` helper landing first. Push deferred to BCS-DEF-4-PUSH (§10).

---

## §0a. Paranoia closure — product-owner decisions (inputs to this round)

This revision applies five binding product-owner decisions taken in the 2026-05-19 session **before** `/codex-paranoia plan` round 1. Codex is reviewing the **revised** plan, not the pre-revision draft.

1. **Single reminder window — 60 minutes only.** Operator-tunable single threshold (default 60, min 5, max 360) via `/admin/settings/alerts`. ~~Per-user windows~~ DEFERRED to a follow-up wave (BCS-DEF-4-PER-USER-WIN). All "per-learner offsets array / preferences table / cabinet multi-select" surface area is struck through but **kept visible in this document** to preserve the historical record and to make the deferral auditable.

2. **Email-first MVP.** Telegram stacks on top via a per-user opt-in setting (`accounts.learner_telegram_enabled boolean` + `accounts.learner_telegram_chat_id text` columns). Default `false` / `null`. Gated on the BCS-DEF-1-TG `sendTelegramMessage` helper landing on `main` first; if BCS-DEF-1-TG hasn't shipped at impl time, the TG send path is dormant code (no-op, logged) until the helper lands.

3. **Cron-driven scheduler.** Reuses existing systemd-cron infrastructure. Tick once per minute; gate by `(start_at - reminder_window_minutes * 60) ± 30 sec`. No queue table, no pg-boss. Idempotency lives in a thin per-slot-per-channel-per-window dispatch row (one row per fire-event), not in a multi-offset queue.

4. **"Перенести / отменить" link** in every reminder body, pointing at `${paymentConfig.siteUrl}/cabinet` (the learner's own cabinet; the "Мои занятия" tile already has the `Отменить` button per `app/cabinet/lessons-section.tsx:189-203` + the rebook flow via `/cabinet/book`). REVISED post-Codex round 1 WARN #12: NOT hard-coded `https://levelchannel.ru/cabinet` — resolves via the existing `paymentConfig.siteUrl` env-driven contract (`lib/email/dispatch.ts:24-41` precedent), so staging/test sends don't leak to prod surface.

5. **Two email body variants, gated on `lesson_slots.zoom_url`:**
   - **With Zoom:** `«Через 60 минут — занятие с учителем %TEACHER_DISPLAY%. Войти: %ZOOM_URL%. Если нужно перенести — %CABINET_LINK%.»`
   - **Without Zoom:** `«Через 60 минут — занятие с учителем %TEACHER_DISPLAY%. Если нужно перенести — %CABINET_LINK%.»`
   The "without Zoom" variant drops the `Войти:` line cleanly — never writes `«ссылка отсутствует»` / `«нет ссылки»` / `«—»`.

**Tone authority:** `docs/content-style.md` (Russian copy rules) — «занятие» not «урок», «оплатить» not «заплатить», «вы» lower-case, no smileys, em-dash for sign-off.

**Codex paranoia hint candidates (per the brief — explicit so Codex can challenge each):**

- **A. Cancel-race.** Reminder fires at minute 59:30 (cron tick T). Learner cancels at 59:31. Reminder still goes out at 59:30. Acceptable? Mitigation in §2.5; verify the window is acknowledged in writing.
- **B. Dedup.** Cron ticks once per minute. The 30-second gating window means at most one tick can match a given slot's reminder moment — but the unique constraint must still hold in case of a clock skew / systemd `Persistent=true` catch-up replay. State lives in a dispatch row keyed `UNIQUE (slot_id, channel)` — NOT extended with `window_minutes_at_dispatch` (REVISED post-Codex round 1 INFO #15: if operator flips window 60→15, a second reminder would slip through if the key included the window; the right invariant is "one reminder per slot per channel, regardless of operator-mid-flight changes").
- **C. Telegram opt-in schema.** Adds two nullable columns to `accounts`. Migration ordering vs prod deploy — ALTER TABLE ADD COLUMN with no default is metadata-only on Postgres 11+; safe to roll. The schema lands in Sub-PR A; the actual TG send path stays dormant (returns early on `null` chat-id OR missing helper) until BCS-DEF-1-TG merges.
- **D. Cabinet link.** Resolved as `${paymentConfig.siteUrl}/cabinet` (prod: `https://levelchannel.ru/cabinet`; staging/test: respective per env) — top-level learner cabinet. The "Мои занятия" panel is the default tab there and renders the cancel button inline (`app/cabinet/lessons-section.tsx:360 "Отменить"`). No deep-link required for MVP; a future improvement is a slot-anchored hash like `/cabinet#slot=<id>` but the brief explicitly says "the slot-detail / cancel UI that already exists" — that already-existing UI is `/cabinet` itself.
- **E. Timezone.** `start_at` is UTC `timestamptz` (`migrations/0020_lesson_slots.sql:37`). "60 минут раньше" is computed against `now()` in UTC; no TZ conversion needed for the gate. The displayed time in the body uses learner's `account_profiles.timezone` fallback `Europe/Moscow`. Daylight-saving boundaries — Russia has no DST since 2011, so no internal-Russian-TZ issue; international learners may have a 60-minute reminder land 59 or 61 minutes before local clock-shift, which is acceptable (the reminder is about wall-clock-arrival, the lesson itself starts at the same UTC instant regardless of DST).
- **F. Email rate-limit per learner per minute.** If a learner booked 5 slots all starting in the same minute, 5 emails fire in the same tick. Operator-tunable per-tick cap (default 200) is global, not per-learner. **Decision: 5 emails in one minute is acceptable** (this is a deliberate scheduling choice by the learner; throttling per-learner would suppress legitimate reminders). Documented in §6 RISK-1.

**Hint candidates passed to Codex as adversarial seeds, NOT as foregone conclusions.** If Codex finds additional / superior framings, those win.

---

## 1. Goal

For every `booked` future `lesson_slots` row, deliver **one reminder email** to the learner at the operator-tunable single window before `start_at` (default 60 minutes). Operator controls the master switch + the single window via `/admin/settings/alerts`. Telegram is a per-learner opt-in that, when enabled AND the BCS-DEF-1-TG helper is on `main`, sends a parallel Telegram message via the same scheduler tick.

Hard requirements:
- **Idempotent** — scheduler ticking twice never sends two reminders for the same `(slot, channel, window)`.
- **Late-tick tolerant** — `Persistent=true` on the systemd timer; if a tick is missed and recovered after the gate window has passed, the reminder is dropped with `past_send_by` rather than fired late (a "60-минут" reminder at T-4 is more confusing than not arriving at all).
- **Best-effort against transient learner state** — slot cancelled / learner email removed mid-flight → cancel pending reminder, NEVER send for a non-active slot.
- ~~Per-user override: a learner who explicitly sets `[60, 10]` gets exactly those two, not the operator default.~~ **DEFERRED (BCS-DEF-4-PER-USER-WIN).** All learners share the operator-tunable single window in MVP.

Out of scope explicitly: push (BCS-DEF-4-PUSH), teacher reminders (BCS-DEF-5), in-app banner reminders, calendar-invite ICS attachments, ~~per-user reminder offsets / preferences table~~ (BCS-DEF-4-PER-USER-WIN), ~~multi-offset (60/30/10) reminders~~.

## 1.1 Existing surface inventory — slot booking + lifecycle

Cited against `main` HEAD as of 2026-05-18.

- **`lib/scheduling/slots/booking.ts:108-309`** `bookSlot(slotId, learnerAccountId, actor, options)` — atomic `update lesson_slots set status='booked', learner_account_id=$2, booked_at=now()` re-asserting `status='open' AND start_at > now()` AND optional teacher-pin AND busy-overlap gate. Returns `BookSlotResult`. **This is the canonical "slot booked" success path.** A learner who books a slot reaches this function exactly once per slot transition (re-bookings of a cancelled-and-re-opened slot go through it again).
- **Route call-site:** `app/api/slots/[id]/book/route.ts:30-175` — the POST handler. After `bookSlot` returns `ok: true`, the route fire-and-forgets `enqueueCreatePushIfIntegrationActive` (calendar push to Google). ~~Reminder scheduling would land at the same fire-and-forget seam — symmetric shape, identical failure tolerance.~~ **REVISED 2026-05-19: NO ENQUEUE FROM BOOK ROUTE.** The scheduler reconciles `lesson_slots` directly on each tick. No code added to either book-route this wave.
- **Admin "book as operator"** path: a separate route `/api/admin/slots/[id]/book-as-operator`. ~~Reminders must fire on that path too — both routes must enqueue.~~ REVISED: no route-side enqueue needed; both paths drop a row in `lesson_slots`, which is all the scheduler reads.
- **Schema:** `migrations/0020_lesson_slots.sql:34-78` defines `lesson_slots` (id, teacher_account_id, learner_account_id, start_at, duration_minutes, status, booked_at, cancelled_at, events JSONB). `learner_account_id` is the join key for "who gets this reminder". `start_at` is UTC `timestamptz`.
- **Cancellation:** `lib/scheduling/slots/mutations-cancel.ts` (sibling) flips `status='cancelled'` and stamps `cancelled_at`. Reminder scheduler MUST gate on `status='booked'` at send time (not just enqueue time), so a cancelled mid-flight slot drops the pending row.
- **`events JSONB`** column: `migrations/0020_lesson_slots.sql:46` — append-only audit trail of slot transitions. Reminder send events could be appended here (one row per channel per send), giving the cabinet a "reminder history" surface for free. **Decision in §2.5: NO — reminder telemetry lives on its own per-slot-per-channel table, NOT inlined into `events` (keep `events` lean; reminders are operational, not booking-state-transition events).**

## 1.2 Existing surface inventory — alert / cron probe shape

This plan adopts the **stateful sibling-probe shape** the codebase has converged on across 4 alert probes (auth-flow, calendar-pathology, webhook-flow, conflict-unresolved). Specifically:

- Pure `.mjs` script in `scripts/`, no `@/` imports, ESM-only.
- Per-tick `resolveOperatorSettingsForProbe(pool, '<probe>')` snapshot (`scripts/lib/operator-settings.mjs` mirrors `lib/admin/operator-settings.ts SETTING_SCHEMA`). All thresholds are immutable for the tick.
- `recordProbeRun(pool, params)` (`scripts/lib/probe-runs.mjs:70-104`) writes a best-effort observability row per tick.
- Boot-relative systemd timer with `OnBootSec=Nmin` + `OnUnitActiveSec=Mmin`, mirroring `scripts/systemd/levelchannel-conflict-unresolved-alert.timer:14-21`.
- `if (invokedDirectly) { main() }` guard at the bottom so helpers are unit-testable as named exports.
- Sandbox profile: 12 directives mirrored from `scripts/systemd/levelchannel-conflict-unresolved-alert.service:36-54`.

**Critical difference from alert probes:** alert probes are alert-storm-dedup primitives (single email if a stable offender set persists). Reminders are NOT alerts — every `(slot, channel)` is a unique transactional send. So this probe is "scheduler-on-cron" shape, not "alert-on-cron" shape: state is in the DB (the **dispatch-history table** — write-once at send time per §2.2 REVISED, not a queue) not a fingerprint state file.

## 1.3 Existing surface inventory — email dispatch

- **`lib/email/dispatch.ts:44-134`** — the canonical `sendXxxEmail(to, payload)` shape. Routes through `lib/email/client.ts:39-69 sendEmail()` which wraps Resend and falls back to `console.log` when `RESEND_API_KEY` is unset.
- **Templates** live in `lib/email/templates/*.ts`. Each exports `renderXxxEmail(params)` returning `{ subject, text, html }`. Plain inline HTML; no template engine. `lib/email/escape.ts escapeHtml(s)` is the standard for any user-supplied content.
- **Send result:** `SendEmailResult` (`lib/email/client.ts:17-19`) — `{ok: true, transport: 'resend'|'console'} | {ok: false, transport, error}`. Caller decides whether to retry / record / swallow.

The new template lives at `lib/email/templates/learner-lesson-reminder.ts`. The new dispatch helper `sendLearnerLessonReminder(to, params)` lands in `lib/email/dispatch.ts`.

## 1.4 Existing surface inventory — operator settings + UI

- **`lib/admin/operator-settings.ts:17-31`** `ProbeName` literal union (already widened with `'conflict-unresolved'` in PR #283-equivalent). **Adding `'learner-reminders'` widens this union.**
- **`SETTING_SCHEMA`** (`lib/admin/operator-settings.ts:59-196`) — typed whitelist; each entry is `{kind:'int'|'decimal', default, min, max, envName, description, scope:ProbeName}`. **Adding 3 keys with `scope: 'learner-reminders'`** (see §1.5 + §2.3 REVISED): `LEARNER_REMINDERS_EMAIL_ENABLED`, `LEARNER_REMINDER_WINDOW_MINUTES`, `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK`.
- **`scripts/lib/operator-settings.mjs`** — ESM mirror. Drift test pins JSON.stringify equality.
- **Admin alerts page** `app/admin/(gated)/settings/alerts/page.tsx` + `lib/admin/probe-status.ts` + the `PROBE_NAMES` array iterated in the alerts UI. The conflict-unresolved precedent (`docs/plans/conflict-unresolved-alert.md §2.7`) is the exact template for extending all 5 UI touchpoints.

**Wave decision (REVISED 2026-05-19):** the product-owner brief explicitly anchors the single-window knob at **`/admin/settings/alerts`** (operator-tunable threshold via `LEARNER_REMINDER_WINDOW_MINUTES`). `learner-reminders` is NOT an "alert probe" structurally — it's a scheduler — but the brief intentionally **co-locates** the knob with the alert knobs because (a) the operator already comes here daily, (b) it's the single existing per-feature numeric-knob surface, and (c) the per-feature settings split (`/admin/settings/reminders`) was rejected as scope creep for MVP.

To keep type-level consistency, the `ProbeName` union widens to `ProbeName | 'learner-reminders'`. The keys still flow through `lib/admin/operator-settings.ts SETTING_SCHEMA`. Probe-status iteration in `lib/admin/probe-status.ts:15-19 PROBE_NAMES` STAYS at the 4 alert-probe entries; `learner-reminders` is excluded from that iteration via a code comment + a test that pins the exclusion. Alternative considered: split the type — `type SettingScope = ProbeName | 'learner-reminders'` — REJECTED because it cascades into 6 files; the comment + test is cheaper.

~~**Original plan: new admin surface lives at `/admin/settings/reminders` (matches `admin-ux-coverage.md §5.4` proposal).**~~ DEFERRED. `admin-ux-coverage.md §5.4` ("Reminder cadence + channel switch editor") is **partially closed** by adding the single-knob row to `/admin/settings/alerts` and **the remainder** (a standalone reminders settings page with multi-offset editor) stays open as a follow-up.

## 1.5 Existing surface inventory — admin coverage tracking (`docs/plans/admin-ux-coverage.md`)

`docs/plans/admin-ux-coverage.md §3.4 + §5.4` explicitly calls out reminder cadences as an admin prereq. **This plan partially claims those gaps** (REVISED 2026-05-19):

- §3.4 ("reminder cadences ... MUST be operator-editable from `/admin`") — **closed** by §2.3 single-knob (`LEARNER_REMINDER_WINDOW_MINUTES`). Cadence = single window, operator-editable.
- §5.4 ("Reminder cadence + channel switch editor ... `/admin/settings/reminders`") — **partially closed.** The master switch + single window land at `/admin/settings/alerts` (no new page). A standalone reminders settings page remains open as a follow-up (BCS-DEF-4-ADMIN-PAGE) — only needed when per-channel / per-user customisation lands.

`admin-ux-coverage.md` itself gets a one-line "BCS-DEF-4 ships the single-window reminder knob at /admin/settings/alerts; standalone reminders page deferred" cross-reference in this PR's documentation sweep (§5 file inventory).

## 1.6 ~~Per-user preference data model~~ Per-user Telegram opt-in (REVISED 2026-05-19)

~~**Critical nuance per the task brief**: BCS-DEF-4 needs per-USER preferences. No existing per-user reminder surface. Two options weighed:~~

~~**Option A — Columns on `account_profiles`** (`migrations/0017_account_profiles.sql:24-35`). Add `reminder_offsets_minutes integer[]` + `reminder_email_opt_in boolean` + `reminder_updated_at`. **Cons:** mixes identity (display_name, timezone, locale) with feature-flag fields; BCS-DEF-5 teacher mirror duplicates 3 more columns; per-channel growth (TG/push opt-in) keeps bloating it. Migrating offset shape (`[{minutes, channels[]}]`) forces JSONB or schema churn.~~

~~**Option B — New table `learner_reminder_preferences`** with `account_id PK → accounts(id) on delete cascade`, `offsets_minutes integer[] not null default array[60,30,10]`, `email_opt_in boolean not null default true`, plus a table-level CHECK pinning cardinality ≤5 AND allowed-values whitelist (defends against `array[1000000]`). **Cons:** one extra `LEFT JOIN` per scheduler query (negligible against slot-table scan). **Pros:** single-concern; teacher mirror is a sibling table not a column duplication; channel growth doesn't pollute profiles.~~

~~**Decision: Option B.** `account_profiles` is approaching identity-only; BCS-DEF-5 cleanly mirrors via `teacher_reminder_preferences`. **Default semantics**: missing row = "use operator defaults from `operator_settings`"; explicit row with `offsets_minutes='{}'` (valid per CHECK) = "explicit opt-out". Both honoured by §2.4.~~

**REVISED decision (2026-05-19): no per-user reminder preferences table.** The single-window MVP removes the need for a per-learner offsets array. The only per-user state we add this wave is the **Telegram opt-in pair** on the existing `accounts` table — picked over Option A/B because it's the lightest fit per the brief ("pick the lightest fit"):

```sql
alter table accounts
  add column if not exists learner_telegram_enabled boolean not null default false,
  add column if not exists learner_telegram_chat_id text null;

-- Length cap defends against pathological storage. Telegram chat-ids are
-- numeric strings (e.g. "-1001234567890" for groups, "12345678" for users)
-- bounded around 16 chars; 64 is a forgiving upper bound.
alter table accounts
  add constraint accounts_learner_telegram_chat_id_len
  check (learner_telegram_chat_id is null or length(learner_telegram_chat_id) between 1 and 64);

-- Opt-in cannot be true without a chat-id (consistency invariant).
alter table accounts
  add constraint accounts_learner_telegram_consistency
  check ((learner_telegram_enabled = false) or (learner_telegram_chat_id is not null));
```

**Default semantics:** `learner_telegram_enabled=false` → email-only (the universal default). When `enabled=true` AND `chat_id IS NOT NULL` AND BCS-DEF-1-TG helper has shipped → email + TG both fire.

**Chat-id discovery — adopt the BCS-DEF-4-TG handshake contract (REVISED post-Codex round 2 BLOCKER #3).** Direct numeric-id input is rejected (learners don't know it; trust-boundary risk). The handshake flow is owned by BCS-DEF-4-TG (`docs/plans/bcs-def-4-tg-telegram-reminders.md §2.3`), which adopts **Option B+C**:
- Server generates a one-time **8-char alphanumeric** code, TTL 10 min, single-use (table `learner_telegram_bind_codes` per BCS-DEF-4-TG §2.3).
- Learner clicks "Bind Telegram" → cabinet renders both the code AND a `https://t.me/<TELEGRAM_BOT_USERNAME>?start=<code>` deep-link.
- Learner sends `/start <code>` to the bot; webhook (`POST /api/telegram/webhook` per BCS-DEF-4-TG) verifies the code, writes the binding row, sets `accounts.learner_telegram_enabled=true, learner_telegram_chat_id=<verified chat_id>`.

**This plan (BCS-DEF-4) ships ONLY the storage columns** in `accounts` + dormant scheduler send path. The actual handshake (binding code table, webhook route, cabinet "Bind Telegram" button + 8-char code rendering, BotFather setup) lives in BCS-DEF-4-TG which depends on BCS-DEF-1-TG (already SIGN-OFF) for the `sendTelegramMessage` helper.

Until BCS-DEF-1-TG ships (and even after — this wave does not ship a toggle):
- Schema columns (above) ship in Sub-PR A.
- Cabinet `/cabinet/profile` ships in Sub-PR D with a **read-only placeholder section** (REVISED post-Codex round 3 BLOCKER #3) — no toggle, no input, no Server Action, no `<code>`-rendering, no helper call. Just informative copy that Telegram support is coming.
- Scheduler path: `if (learner.telegramEnabled && learner.telegramChatId && hasSendTelegramMessageHelper()) { sendTelegramMessage(...) } else { finalize 'skipped' with appropriate reason }`. As of this wave's deploy, `learner_telegram_enabled` can ONLY be set via direct SQL (no learner-facing surface) — operationally, this is a dormant scheduler branch.

Once BCS-DEF-1-TG ships: BCS-DEF-4-TG can immediately gate open (its own paranoia round must run). BCS-DEF-4-TG's cabinet edits LIVE-OVERWRITE the placeholder section this plan ships in Sub-PR D, replacing it with the active toggle + handshake — that's an expected, contracted, single-PR-diff change in the follow-up plan.

The plan-doc surface for the actual BCS-DEF-4-TG follow-up exists as `docs/plans/bcs-def-4-tg-telegram-reminders.md` (DRAFT, PR #347). This revised plan **supersedes** the schema portion of BCS-DEF-4-TG (the two columns + check constraints land in BCS-DEF-4 Sub-PR A, not in BCS-DEF-4-TG). BCS-DEF-4-TG continues to own the bot-handshake flow + the `LEARNER_REMINDERS_TELEGRAM_ENABLED` operator master switch.

**TG helper path is authoritatively `scripts/lib/telegram-alerts.mjs`** (NEW post-Codex round 1 BLOCKER #6). Both this plan AND BCS-DEF-4-TG AND BCS-DEF-1-TG must converge on the same module path; the alerts plan currently writes `scripts/lib/telegram-alerts.mjs`. **Coordination requirement (NEW)**: whichever plan ships first chooses the path; later plans rename if needed. **§10** carries the renamed-doc-edit obligation as a coordination dependency, NOT a hard blocker (the rename is a one-line `mv` + grep-replace).

**Cross-plan doc edits required at Sub-PR A merge** (NEW post-Codex round 1 BLOCKER #6) — these prevent the follow-up wave from re-implementing the same schema:
- `docs/plans/bcs-def-4-tg-telegram-reminders.md`: add a "SUPERSEDED by BCS-DEF-4 §1.6 REVISED" notice at the top of its schema section.
- `docs/plans/bcs-def-1-tg-telegram-alerts.md`: cross-reference `scripts/lib/telegram-alerts.mjs` as the canonical helper path (or whichever path the alerts plan settles on first — if it lands first, this plan renames).

## 1.7 ~~Existing surface inventory — cabinet preference editor~~ Cabinet UI surface (REVISED 2026-05-19)

~~There is NO existing learner-side "notifications" surface. The new cabinet page lives at **`/cabinet/settings/reminders`** (mirrors `app/cabinet/settings/calendar/page.tsx` placement). UI: a checkbox per default offset (60/30/10/15/5 — pinned to the CHECK allowlist) + an "email reminders ON" toggle. A reset-to-defaults button clears the row (delete-by-account_id) so the learner falls back to operator default.~~

~~No /api route required if the page submits via a Server Action; we'll mirror the `profile-editor` pattern from `app/cabinet/profile/page.tsx:13` (uses `<ProfileEditor>` client component + Server Action). **Decision: Server Action for simplicity.** Per-key rate-limit at 10 req/min/account (via `enforceRateLimit` from `lib/security/request`).~~

**REVISED post-Codex round 2 BLOCKER #3:** Sub-PR D ships ONLY a **disabled placeholder** in `/cabinet/profile` — this plan does NOT ship the active toggle, code-rendering, or handshake. The active flow is owned by BCS-DEF-4-TG.

UI surface this wave (Sub-PR D ONLY):

- A new section in `/cabinet/profile` titled **"Напоминания в Telegram"**.
- A read-only paragraph: «Напоминания о начале занятия будут приходить в Telegram, когда мы запустим бот. Пока что мы присылаем напоминания только на e-mail.»
- No toggle, no input, no submit button. The section exists so that when BCS-DEF-4-TG ships, it has a known placement target.

**Cabinet form (FUTURE — BCS-DEF-4-TG owns):** the toggle, deep-link button, and `/start <code>` flow live in a follow-up PR. BCS-DEF-4-TG can choose to keep the section on `/cabinet/profile` OR migrate to its own `/cabinet/settings/reminders` page (per its own §1.7) — that's a BCS-DEF-4-TG plan decision, not this wave's call.

**Why /cabinet/profile (this plan) vs /cabinet/settings/reminders (BCS-DEF-4-TG plan as written)?** Per the BCS-DEF-4 product-owner brief ("UI surface in `/cabinet/profile` (or similar)"), the minimum-viable placement is `/cabinet/profile`. BCS-DEF-4-TG was authored BEFORE this revision and proposed a richer settings page; **revising BCS-DEF-4-TG to match is a coordination dependency tracked in §10**, but does NOT block this wave (BCS-DEF-4 just ships the placeholder; BCS-DEF-4-TG can land it wherever).

**Per-account rate-limit at 10 req/min/account** (via `enforceRateLimit` from `lib/security/request`) — N/A this wave (no writable surface). Becomes relevant when BCS-DEF-4-TG adds the actual binding submit.

## 1.8 Critical-path inventory

Per `docs/critical-path.md`:
- **`lib/scheduling/slots/booking.ts`** is on critical path. **This plan adds NO logic to `bookSlot` itself.** Reminders are scheduler-driven (read `lesson_slots` directly on cron tick); there is NO route-side enqueue this wave (a simplification over the original plan which used a queue table + book-time enqueue seam). The scheduler reconciles all `status='booked' AND start_at > now()` rows itself.
- **`lib/admin/operator-settings.ts`** is on critical path. This plan adds 3 keys (master switch + window + rate-limit per tick) + widens `ProbeName` — additive.
- **`lib/email/dispatch.ts`** is on critical path. This plan adds one new sender (`sendLearnerLessonReminder`) — additive.
- **`accounts` table** — not on the critical-path-files list, but it's a high-stakes shared table. Adding two nullable columns with `IF NOT EXISTS` is metadata-only on Postgres 11+; no rewrite.

Sub-PRs that touch only `lib/admin/operator-settings.ts` carry `Codex-Paranoia: SUB-WAVE self-reviewed (epic bcs-def-4-learner-reminders); epic-end review pending`. The epic-close PR (last sub-PR) carries `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`.

---

## 2. Design (REVISED 2026-05-19 — single-window MVP)

### 2.1 High-level shape — polling cron, no queue

**Decision (REVISED): polling cron, every 1 minute, against `lesson_slots` directly + a thin per-slot-per-channel-per-window `learner_reminder_dispatches` row written at SEND time (not at book time).** This is the simplest fit for the single-window MVP — there is no "queue depth" to manage when each slot has exactly one reminder moment.

~~Original plan picked Shape B (queue table seeded at book-time, drained by cron).~~ The original Shape-B table is preserved structurally below but with **simplified columns** (no `offset_minutes` column needed — there's one window globally, captured at send time as `window_minutes_at_dispatch`).

| Shape (REVISED) | Pros | Cons |
|---|---|---|
| **A1. Polling cron, no queue, no dispatch table** — at each tick query `lesson_slots` for `start_at - now() within (window-30s, window+30s)` + send. | Zero schema cost. | No idempotency — clock skew / catch-up replay can fire twice. Operator has no visibility into "did this reminder go". REJECTED. |
| **A2 (PICKED). Polling cron + thin dispatch-history table.** Cron at minute T queries `lesson_slots` directly for slots whose `start_at - window_minutes` falls inside `(T - 30s, T + 30s]`. For each match, `INSERT INTO learner_reminder_dispatches (...) ON CONFLICT DO NOTHING` then send if the insert won. | Single-row idempotency. Operator-visible audit trail. No book-time enqueue (one less code path). | One bounded slot-table scan per minute. |
| ~~B. Polling cron + per-(slot,offset,channel) queue table seeded at book time.~~ | (Original plan; deferred.) | Over-engineered for single-window MVP. Reconsider when per-user offsets land in BCS-DEF-4-PER-USER-WIN. |
| C / D | (Unchanged from original.) | Unchanged. |

**Picked A2.** Schema cost: one table (a 7-column audit trail, not a queue), no enqueue seam in book route, idempotency via `UNIQUE (slot_id, channel)`. The send-time INSERT-and-send-if-won pattern matches the existing `package_grant_resolutions` write-once-on-action shape.

**Cron cadence: every 1 minute** with `OnBootSec=3min, OnUnitActiveSec=1min`. Justification (REVISED):
- Window precision is `±cadence/2`. The 30-second gating window `(due_moment - 30s, due_moment + 30s]` means exactly one tick can match a slot's reminder moment (modulo clock skew).
- Finer cadence (every 30s) is overkill — Next.js + Postgres + Resend chain has more jitter than 1 min anyway.
- Coarser cadence (every 5 min) means the 60-minute reminder could fire anywhere in T-58 to T-62, which is fine for the **single 60-min window** but pinches if the operator pushes the window down to 5 minutes (the MIN). **Pick 1 min so the operator-tunable MIN of 5 still works.**

### 2.2 New migration — `learner_reminder_dispatches` + `accounts` TG columns

~~**Migration 0059 — preferences table.**~~ DROPPED (no preferences table this wave per §1.6 REVISED).

~~**Migration 0061 — dispatch queue.**~~ Renamed and simplified: now `learner_reminder_dispatches` (dispatch-history audit, not a queue). Migration number: next-free is **0061** (last on `main` is `0060_teacher_calendar_integrations_sync_token.sql` per BCS-DEF-7 Phase 1 PR #352).

```sql
-- BCS-DEF-4 (2026-05-19) — per-slot-per-channel reminder dispatch history.
-- One row INSERTed at SEND time (not book time). The row's existence is the
-- "we already sent this reminder" idempotency primitive.
-- Plan: docs/plans/bcs-def-4-learner-reminders.md §2.5.

create table if not exists learner_reminder_dispatches (
  id bigserial primary key,
  -- ON DELETE RESTRICT mirrors lesson_slots.learner_account_id
  -- (migrations/0020_lesson_slots.sql:36-40). Accounts are never
  -- hard-deleted in this codebase; the retention sweep anonymises
  -- in-place (see scripts/db-retention-cleanup.mjs). A FK with
  -- ON DELETE CASCADE would be a benign no-op today, but RESTRICT
  -- documents the contract correctly (REVISED post-Codex round 2
  -- BLOCKER #2: prior wording falsely claimed cascade behaviour as
  -- defense-in-depth; in fact the deletion-grace gate at §2.4 step 4
  -- + §2.2.1 in-place sweep are the operative protections.)
  slot_id uuid not null references lesson_slots(id) on delete restrict,
  account_id uuid not null references accounts(id) on delete restrict,
  channel text not null check (channel in ('email', 'telegram')),
  -- Captured at dispatch time. If the operator changes
  -- LEARNER_REMINDER_WINDOW_MINUTES mid-flight, future ticks use the
  -- new value; rows already inserted are immutable.
  window_minutes_at_dispatch integer not null
    check (window_minutes_at_dispatch between 5 and 360),
  -- Three-state lifecycle (REVISED after Codex round-1 BLOCKER #1):
  --   'claimed' → row inserted, send not yet attempted (or in-flight).
  --                A row stuck in 'claimed' means the worker crashed
  --                between INSERT and send completion; an operator
  --                can DELETE it to unblock a one-time retry.
  --   'sent'    → provider returned ok. sent_at, resend_email_id /
  --                telegram_message_id populated.
  --   'skipped' → terminal non-success (cancelled mid-tick, email
  --                missing, past send-by, send failure). skipped_reason
  --                populated; sent_at is NULL.
  status text not null default 'claimed'
    check (status in ('claimed', 'sent', 'skipped')),
  skipped_reason text null
    check (skipped_reason is null or skipped_reason in (
      'slot_no_longer_booked', 'email_missing', 'past_send_by',
      'send_failed',
      'no_telegram_binding', 'telegram_helper_not_shipped'
    )),
  sent_at timestamptz null,
  resend_email_id text null,
  telegram_message_id text null,
  last_error text null,
  created_at timestamptz not null default now(),
  -- Stamped on every status transition (claimed → sent / skipped).
  updated_at timestamptz not null default now(),
  constraint lrd_status_consistency
    check (
      (status = 'claimed' and sent_at is null and skipped_reason is null)
      or (status = 'sent' and sent_at is not null)
      or (status = 'skipped' and skipped_reason is not null)
    )
);

-- Idempotency: ONE row per (slot, channel). Send-path uses
-- INSERT ... ON CONFLICT DO NOTHING + RETURNING — if the row was won by us,
-- proceed to send; if not, another tick already handled it.
create unique index if not exists lrd_slot_channel_unique
  on learner_reminder_dispatches (slot_id, channel);

-- Operator-side observability: "what was sent in the last hour".
create index if not exists lrd_created_at_idx
  on learner_reminder_dispatches (created_at desc);
```

**Migration 0062 — accounts TG opt-in columns.**

```sql
-- BCS-DEF-4 (2026-05-19) — per-user Telegram opt-in. Pre-empts BCS-DEF-4-TG
-- bot-handshake (still owned by that plan); only the data columns ship here.
-- Plan: docs/plans/bcs-def-4-learner-reminders.md §1.6 (REVISED).

alter table accounts
  add column if not exists learner_telegram_enabled boolean not null default false;

alter table accounts
  add column if not exists learner_telegram_chat_id text null;

alter table accounts
  drop constraint if exists accounts_learner_telegram_chat_id_len;
alter table accounts
  add constraint accounts_learner_telegram_chat_id_len
  check (learner_telegram_chat_id is null
         or length(learner_telegram_chat_id) between 1 and 64);

alter table accounts
  drop constraint if exists accounts_learner_telegram_consistency;
alter table accounts
  add constraint accounts_learner_telegram_consistency
  check ((learner_telegram_enabled = false)
         or (learner_telegram_chat_id is not null));
```

(Postgres 11+ — `ADD COLUMN ... DEFAULT false NOT NULL` is metadata-only and does not rewrite the table.)

### 2.2.1 Two-layer protection for deletion-grace + purge (REVISED post-Codex round 2 BLOCKER #2)

A learner who tapped `POST /api/account/delete` enters **deletion-grace**:
`accounts.disabled_at = now()`, `scheduled_purge_at = now() + 30 days`.
Their slots stay booked in the DB (FK is `ON DELETE RESTRICT`,
`migrations/0020_lesson_slots.sql:40`); the retention sweep does NOT
hard-delete the account 30 days later — instead it anonymises the row
in-place: `email = 'deleted-<uuid>@example.invalid', password_hash = NULL`,
+ stamps `purged_at`.

Two operative layers protect reminders from deletion-grace and purged accounts:

**Layer 1 — Scheduler SELECT gate (PRIMARY).** §2.4 step 4 already filters
`disabled_at IS NULL AND scheduled_purge_at IS NULL AND purged_at IS NULL`,
so a learner who tapped delete at any time prior to the tick gets ZERO
reminders. This is the canonical protection (kicks in at the very first
tick after `disabled_at` is stamped).

**Layer 2 — Purge-time TG-column scrub (DEFENSE-IN-DEPTH).** The retention
sweep `scripts/db-retention-cleanup.mjs` is extended in Sub-PR A to also
zero the two new TG columns when the row's `purged_at` is set:

```js
// scripts/db-retention-cleanup.mjs — append to the existing purge UPDATE block.
// At the SQL site that currently zeroes accounts.email / password_hash etc.
//   ... existing UPDATE ...
//   SET email = 'deleted-' || gen_random_uuid() || '@example.invalid',
//       password_hash = NULL,
//       learner_telegram_enabled = false,      -- NEW
//       learner_telegram_chat_id = NULL,       -- NEW
//       purged_at = now()
//   WHERE ...
```

(The CHECK constraint `accounts_learner_telegram_consistency` accepts
`enabled=false AND chat_id=NULL`, so the scrub is self-consistent.)

Without Layer 2, `learner_telegram_chat_id` would survive purge as residual
PII (152-FZ contract break). Layer 1 alone is sufficient to stop reminders
*sending*, but Layer 2 is required to stop the chat-id *being stored*.

§3.3.1 tests pin both layers (deletion-grace SELECT filter + purge sweep
column zeroing).

### 2.3 Operator settings — 3 new keys

~~Original plan added 5 keys (incl. `LEARNER_REMINDERS_DEFAULT_OFFSETS_CSV` + `_LATE_TOLERANCE` + `_MAX_ATTEMPTS`).~~ **REVISED: 3 keys.** No CSV (single window). No late-tolerance (the 30-second gate window covers normal jitter; truly-late catch-ups drop with `past_send_by`). No max-attempts (one-shot send; failures land as `status='skipped' skipped_reason='send_failed'` and operator can act manually).

Extend `lib/admin/operator-settings.ts:59` SETTING_SCHEMA AND `scripts/lib/operator-settings.mjs`. The new `scope: 'learner-reminders'` requires `ProbeName` widening to `... | 'learner-reminders'`.

```ts
LEARNER_REMINDERS_EMAIL_ENABLED: {
  kind: 'int',  // 0/1 — operator-controlled master switch for the email channel
  default: 1,
  min: 0,
  max: 1,
  envName: 'LEARNER_REMINDERS_EMAIL_ENABLED',
  description: 'master switch (1=on/0=off) for learner email reminders',
  scope: 'learner-reminders',
},
LEARNER_REMINDER_WINDOW_MINUTES: {
  kind: 'int',
  default: 60,
  min: 5,
  max: 360,
  envName: 'LEARNER_REMINDER_WINDOW_MINUTES',
  description: 'single window (in minutes before slot start) at which a learner reminder is dispatched',
  scope: 'learner-reminders',
},
LEARNER_REMINDERS_RATE_LIMIT_PER_TICK: {
  kind: 'int',
  default: 200,
  min: 1,
  max: 5000,
  envName: 'LEARNER_REMINDERS_RATE_LIMIT_PER_TICK',
  description: 'max reminder sends dispatched per scheduler tick (defends Resend / Telegram quota; counts email + telegram together)',
  scope: 'learner-reminders',
},
```

### 2.3.1 ~~SETTING_SCHEMA `'csv-ints'` kind extension~~ DROPPED

~~The `LEARNER_REMINDERS_DEFAULT_OFFSETS_CSV` key needed a new validator. Add a 3rd `SettingSchemaCsvInts` variant…~~

**REVISED:** the single-window MVP has no CSV setting. SETTING_SCHEMA stays at its existing `int` / `decimal` validators. ~~Reintroduce in BCS-DEF-4-PER-USER-WIN if per-user offsets ship.~~

### 2.4 Reminder scheduler — `scripts/learner-reminder-dispatch.mjs`

ESM, no `@/`. Boot-relative timer (3-min offset; 1-min cadence). Stateless beyond the dispatch-history table.

Tick anatomy (REVISED — single window, no queue):

```
1. Resolve operator settings snapshot via resolveOperatorSettingsForProbe('learner-reminders').
   Capture: emailEnabled, windowMinutes, rateLimitPerTick.

2. **Per-channel master switches (REVISED post-Codex round 1 BLOCKER #3).**
   Email and Telegram are independent. If BOTH are off, recordProbeRun
   and exit.
     - emailEnabled = LEARNER_REMINDERS_EMAIL_ENABLED.
     - telegramEnabled = (sendTelegramMessage helper is shipped on `main`)
       — i.e. the channel is OFF until BCS-DEF-1-TG ships, regardless of
       per-user opt-in. BCS-DEF-4-TG will later add a
       `LEARNER_REMINDERS_TELEGRAM_ENABLED` operator master switch; for
       this wave, "helper not shipped" IS the master gate.
     - If emailEnabled=0 AND telegramEnabled=false → exit early.
     - If emailEnabled=0 AND telegramEnabled=true → still tick, but skip
       step 5b-5d for email and only run step 5e for TG.
     - If emailEnabled=1 AND telegramEnabled=true → run both per-channel
       paths.

3. Compute "due window" against now():
     dueMomentLower = now() + windowMinutes*60s - 30s
     dueMomentUpper = now() + windowMinutes*60s + 30s
   A slot is "due now" if start_at ∈ (dueMomentLower, dueMomentUpper].

4. **SELECT every due slot for this tick (no per-send LIMIT here)** — the
   rate-limit caps PROVIDER SENDS, not row selection. Selecting all due
   rows lets the scheduler decide per-row whether to send, skip, or
   finalize-as-overflow. The lower-bound widens to `now()` for catch-up
   replay (§2.4 step 7 below). Bounded by the size of the next-60-second-
   window, which is a tight upper bound (∼ minutes of booking traffic):

     WITH due AS (
       SELECT s.id            AS slot_id,
              s.start_at,
              s.learner_account_id,
              s.zoom_url,
              s.duration_minutes,
              a.email           AS learner_email,
              a.disabled_at     AS learner_disabled_at,
              a.scheduled_purge_at AS learner_scheduled_purge_at,
              a.purged_at       AS learner_purged_at,
              a.learner_telegram_enabled,
              a.learner_telegram_chat_id,
              ap.display_name   AS learner_display_name,
              ap.timezone       AS learner_timezone,
              tap.display_name  AS teacher_display_name
       FROM lesson_slots s
       JOIN accounts a            ON a.id  = s.learner_account_id
       LEFT JOIN account_profiles ap  ON ap.account_id  = s.learner_account_id
       LEFT JOIN account_profiles tap ON tap.account_id = s.teacher_account_id
       WHERE s.status = 'booked'
         AND s.start_at >  now()                          -- lesson hasn't started
         AND s.start_at <= $1::timestamptz                -- dueMomentUpper (now() + window + 30s)
         -- Deletion-grace gate (REVISED post-Codex round 2 BLOCKER #2):
         -- a learner who tapped /api/account/delete is in deletion-grace
         -- with disabled_at + scheduled_purge_at set. Their slots stay in
         -- the DB (FK is ON DELETE RESTRICT — `migrations/0020:36-40`) but
         -- they must NOT receive reminders. Filter both deletion-grace
         -- AND fully-purged accounts.
         AND a.disabled_at IS NULL
         AND a.scheduled_purge_at IS NULL
         AND a.purged_at IS NULL
         -- And: skip rows we already finalized in a prior tick.
         AND NOT EXISTS (
           SELECT 1 FROM learner_reminder_dispatches d
            WHERE d.slot_id = s.id
              AND d.channel = 'email'
         )
       ORDER BY s.start_at ASC
       -- Safety bound only: scan-cap, NOT a send-cap. Wide enough to
       -- never starve provider-cap budget but tight enough to defend
       -- against pathological flood. 2× the rate cap is safe because
       -- a tick only covers a ~60-second window of new bookings.
       LIMIT (2 * $2)                                      -- 2 × rateLimitPerTick
     )
     SELECT * FROM due;

   The SELECT joins `learner_reminder_dispatches` via `NOT EXISTS` for
   the email channel; the TG path runs as a sibling sub-loop and joins
   on `channel='telegram'` separately (see §2.4 step 5e). For both
   channels, the UNIQUE constraint is the canonical send-idempotency
   primitive — the NOT EXISTS filter is a cheap pre-filter, not a
   replacement for the INSERT ... ON CONFLICT DO NOTHING.

5. **Three-state send path** (REVISED post-Codex round 1 BLOCKER #1) — for each
   due row, run the channel-by-channel send. Each send is `INSERT 'claimed'`
   → `attempt provider` → `UPDATE 'sent'|'skipped'`. A worker-crash between
   INSERT and the UPDATE leaves a 'claimed' row visible to operator audit;
   it is NEVER auto-promoted to 'sent'. The UNIQUE constraint still blocks
   a second send attempt for that `(slot_id, channel)` pair (consistent with
   the brief: "1 email per slot per learner"). Operator can DELETE a stuck
   'claimed' row to allow one manual retry.

   For channel='email' (always considered; gated only by the email master
   switch — REVISED post-Codex round 1 BLOCKER #3):

   5a. (Skipped — no separate insert step; the §2.4 step 5b INSERT already
       handles the idempotency-claim. See below.)

   5b. **Atomic claim:**

         INSERT INTO learner_reminder_dispatches
           (slot_id, account_id, channel, window_minutes_at_dispatch, status)
         VALUES
           ($slot_id, $account_id, 'email', $windowMinutes, 'claimed')
         ON CONFLICT (slot_id, channel) DO NOTHING
         RETURNING id;

       If RETURNING empty → another tick won the race; SKIP this row.
       If RETURNING returned `id` → we own the send. Continue with 5c.

   5c. **Re-fetch + gate** just before sendEmail():
         - slot.status changed since the original SELECT? **REVISED post-Codex
           round 1 WARN #7**: instead of DELETE-rollback, finalize:
             UPDATE row SET status='skipped',
                            skipped_reason='slot_no_longer_booked',
                            updated_at=now()
           (Codex Q11 verdict: keep the audit signal — operator wants to see
           "we tried but cancelled mid-tick" in the dispatch history.)
         - **Catch-up check (REVISED post-Codex round 2 BLOCKER #1):**
           if `start_at - now() < windowMinutes*60s - 30s` (the slot's
           reminder moment is already in the past — caught up from a
           catch-up replay), finalize with
           `status='skipped', skipped_reason='past_send_by'`. This is
           the "no late reminders" rule from §6 RISK-2; the row is
           audit-visible.
         - **Deletion-grace re-check:** if `learner_disabled_at IS NOT NULL`
           OR `scheduled_purge_at IS NOT NULL` OR `purged_at IS NOT NULL`
           (deletion-grace landed mid-tick between SELECT and re-fetch),
           finalize with `status='skipped', skipped_reason='slot_no_longer_booked'`
           (the slot logically belongs to a deleted account; we treat
           the same as a cancelled slot from the reminder pov).
         - learner_email present? `accounts.email` is NOT NULL (§4.2 REVISED
           post-Codex round 1 WARN #10), but if the retention sweep has
           rewritten it to `deleted-<uuid>@example.invalid`, treat that as
           a soft skip: finalize with status='skipped',
           skipped_reason='email_missing'. Match by suffix `@example.invalid`.

   5d. **Send attempt:**
         payload = renderLearnerLessonReminder({ ... });
         result  = await sendLearnerLessonReminder(learner_email, payload);
         BEGIN/COMMIT (short TX):
           UPDATE learner_reminder_dispatches
              SET status      = CASE WHEN result.ok THEN 'sent' ELSE 'skipped' END,
                  sent_at     = CASE WHEN result.ok THEN now()  ELSE NULL END,
                  skipped_reason = CASE WHEN result.ok THEN NULL ELSE 'send_failed' END,
                  resend_email_id = result.ok ? result.id ?? NULL : NULL,
                  last_error  = result.ok ? NULL : truncate(result.error, 200),
                  updated_at  = now()
            WHERE id = $row_id;

       `result.id` is the new field this wave adds to `SendEmailResult` —
       see §2.8.1 (NEW post-Codex round 1 WARN #8) for the email-client
       refactor required.

   5e. **Telegram path** — independent of the email master switch
       (REVISED post-Codex round 1 BLOCKER #3). Runs when:
         - learner_telegram_enabled=true (consistency CHECK guarantees
           chat_id is non-null too), AND
         - the per-channel rate budget for this tick (§2.4 step 6 REVISED)
           still has capacity.

       Three-state path mirrors 5b–5d with channel='telegram':

       INSERT 'claimed' for channel='telegram' → ON CONFLICT skips.

       Re-fetch helper presence:
         - If `scripts/lib/telegram-alerts.mjs` module-import returns null OR
           `typeof sendTelegramMessage !== 'function'` (cached at scheduler
           module load, not per-tick): finalize 'skipped',
           skipped_reason='telegram_helper_not_shipped'.
         - **NEW post-Codex round 1 BLOCKER #6**: the helper file path is
           authoritatively `scripts/lib/telegram-alerts.mjs` (this plan, not
           `scripts/lib/telegram-alerts.mjs` — BCS-DEF-1-TG owns the
           rename if the alerts version ships first; flagged in §10
           as a coordination dependency).

       Re-fetch chat_id at gate time (consistency CHECK keeps it ≥ 1 char
       when enabled is true, but a concurrent purge or unbind may have run):
         - If chat_id is null (administratively cleared): finalize
           'skipped', skipped_reason='no_telegram_binding'.

       Send:
         result = await sendTelegramMessage(chat_id, body);
         UPDATE row SET status / telegram_message_id / skipped_reason /
                       last_error / updated_at as for email above.

6. **Provider rate budget (REVISED post-Codex round 2 BLOCKER #1).**
   `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK` caps the TOTAL number of
   PROVIDER SENDS per tick, counting email + telegram together. The
   scheduler iterates the SELECTed due rows in `start_at ASC` order and
   maintains a tick-local integer counter `sendBudget = rateLimitPerTick`.

   For each due row's email channel attempt:
     - Decide a "would-send" decision (i.e. the email path makes it
       past steps 5b's atomic-claim AND 5c's gates) BEFORE we call
       `sendEmail()`. Specifically:
       a. INSERT claim. If race-lost, this row is already handled — skip
          to the TG sub-loop for this row.
       b. Re-fetch and apply gates (`slot_no_longer_booked`,
          `email_missing`). If the row would be **skipped at the gate
          stage**, finalize it AS the skip — these skips do NOT
          consume `sendBudget` (no provider call).
       c. If we're about to call the provider AND `sendBudget == 0`:
          finalize the just-claimed row as
          `status='skipped', skipped_reason='past_send_by'` (the
          slot's reminder moment is inside this tick's window;
          deferring would push it outside). Increment
          `stats.sends_overflowed_rate_limit`. Do NOT call provider.
       d. Otherwise `sendBudget -= 1`, call provider, finalize per §5d.

   For each due row's telegram channel attempt (after the email path
   for that row): identical pattern, sharing the same `sendBudget`.

   Property: a tick will NEVER call providers more than `rateLimitPerTick`
   times, and every "we wanted to send but couldn't" event leaves an
   audit row (`past_send_by` row + the overflow counter in
   `recordProbeRun`). Overflowed rows still consume one UNIQUE-keyed slot
   so a later tick can't re-attempt the same send (consistent with
   one-shot-per-channel contract).

   The pre-Codex-round-2 prose "decrement before step 5b's INSERT" is
   superseded: we INSERT-claim first (cheap), then decide; this way
   the row that overflows still gets an audit trail. See §3.4 tests for
   the seed-250-cap-200 case.

7. **Catch-up replay (REVISED post-Codex round 1 WARN #7).** §2.4 step 4
   widens the SELECT lower bound to `now()` (anchored at "the lesson
   hasn't started yet"), so a tick after a systemd `Persistent=true`
   wake picks up slots whose due-moment fell into the gap. These rows
   pass through step 5b INSERT, then step 5c's `past_send_by` gate
   (lesson is still future-dated but `start_at - now() < window - 30s`,
   i.e. the reminder is overdue). Finalized as
   `status='skipped', skipped_reason='past_send_by'`. Operator sees the
   miss in the dispatch table; no silent loss. These skips do NOT
   consume `sendBudget`.

8. Aggregate stats → recordProbeRun({verdict_kind: 'ok', stats: {
     selected_due: N, sent_email: X, sent_telegram: Y,
     skipped_slot_no_longer_booked: A,
     skipped_email_missing: B,
     skipped_past_send_by: C,
     skipped_send_failed: D,
     skipped_no_telegram_binding: E,
     skipped_telegram_helper_not_shipped: F,
     sends_overflowed_rate_limit: G
   }}).
```

**No fire-and-forget enqueue from the book route.** The scheduler reconciles `lesson_slots` directly. Compared to the original plan, this drops the `enqueueReminders()` call from `app/api/slots/[id]/book/route.ts` AND `app/api/admin/slots/[id]/book-as-operator/route.ts`. Sub-PR C's footprint shrinks accordingly (see §5 REVISED).

### 2.5 Idempotency / dedup (REVISED)

- **Send idempotency** — `UNIQUE (slot_id, channel)` on `learner_reminder_dispatches`. The atomic claim is `INSERT 'claimed' ... ON CONFLICT DO NOTHING RETURNING id` — two concurrent ticks both try; exactly one wins; the other gets empty RETURNING and skips. **Crash-safety (REVISED post-Codex round 1 BLOCKER #1):** a worker crash between INSERT and the success UPDATE leaves the row in `status='claimed'`, which (a) is visible in operator audit, (b) prevents a retry attempt via the UNIQUE constraint by design (one-shot per `(slot,channel)` per the brief). An operator who wants a manual retry DELETEs the row, allowing the next eligible tick to re-claim.
- **No queue table to drain** — `lesson_slots` is the source of truth; the dispatch table is purely historical.
- **Slot transition gating (§2.5.B race window).** A learner cancels at minute 59:31 — the cron tick at 59:30 (or 60:00) may have already won the dispatch INSERT and be mid-`sendEmail`. The §2.4 step 5c re-fetch reduces this window from "a full minute" to "a few hundred ms"; the in-flight send still leaks an email. **Accepted as a degenerate case** (per paranoia hint A): the email body's `${paymentConfig.siteUrl}/cabinet` link lets the learner self-serve; mild confusion ("but I just cancelled"), no harm. The dispatch row is finalized as `status='skipped', skipped_reason='slot_no_longer_booked'` (REVISED post-Codex round 1 WARN #7 / Q11), so the audit trail shows the attempt rather than being silently absent. ALTERNATIVE CONSIDERED: lock the `lesson_slots` row `FOR UPDATE` inside the per-row TX — REJECTED because cancellation paths would then block on the reminder TX. The leak-rate is ≤ 30 seconds of cancellation-window per slot per lifetime, which is < 0.001% of cancellations.

### 2.6 ~~Admin surface — `/admin/settings/reminders`~~ Admin surface — extend `/admin/settings/alerts`

~~NEW page. Mirrors the conflict-feed precedent…~~

**REVISED:** no new admin page. Extend the existing `/admin/settings/alerts` page with a new section labelled "**Напоминания учащимся**" placed above the 4 existing alert-probe sections. UI elements:

- **Email master switch** (toggle): writes `LEARNER_REMINDERS_EMAIL_ENABLED` 0/1.
- **Окно напоминания (минуты)** (single number input 5-360, helper `«За сколько минут до начала занятия отправить напоминание. По умолчанию 60.»`): writes `LEARNER_REMINDER_WINDOW_MINUTES`.
- **Лимит на тик (для защиты квоты)** (number input 1-5000): writes `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK`.
- **Recent dispatch summary** (read-only): the 5 most recent `probe_runs` rows for `probe_name='learner-reminders'` showing tick verdict + stats. Same fetch pattern as the existing 4 sections.

POST handler: re-uses the existing `app/api/admin/settings/alerts/setting/[key]` POST/DELETE route — already validates against `SETTING_SCHEMA`, gated by admin role. No new route this wave.

### 2.7 Timezone semantics (UNCHANGED from original)

`lesson_slots.start_at` is UTC `timestamptz` (`migrations/0020_lesson_slots.sql:37`). Reminder cron tick gate uses `start_at` directly against `now()` — no TZ math needed at the gate.

The email body renders the slot time in the learner's `account_profiles.timezone` (`migrations/0017_account_profiles.sql:27` allows null). If null, fall back to `Europe/Moscow` (matches `migrations/0048_account_profiles_timezone_backfill.sql:36-44` allowlist precedent). Template helper inlined:

```ts
function renderLocalStart(startAt: Date, learnerTimezone: string | null): string {
  const tz = learnerTimezone ?? 'Europe/Moscow'
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz, day: '2-digit', month: 'long',
    hour: '2-digit', minute: '2-digit',
  }).format(startAt)
}
```

Body uses learner-local time + timezone label, per the original plan and `docs/content-style.md §9` ("Между числом и единицей измерения — неразрывный пробел", "Только 24-часовой формат").

**DST sanity check (paranoia hint E):** the cron tick gate uses UTC throughout (`start_at > now() + window - 30s`), so DST shifts in any displayed timezone don't affect *when* the reminder fires — they only affect the displayed-time string in the body. RF has no DST; international learners on DST-observing timezones may see a wall-clock-displayed time that differs by 60 min before/after a DST boundary, which is the correct rendering (the lesson itself happens at the same UTC instant).

### 2.8 Email template — `lib/email/templates/learner-lesson-reminder.ts` (REVISED)

Per the product-owner brief — two body variants gated on `lesson_slots.zoom_url`, no multi-offset framing, includes the "перенести / отменить" cabinet link, glossary discipline per `docs/content-style.md`.

**Subject:** `Через 60 минут — занятие на LevelChannel` (uses the operator's window, default 60 — substitutes the live value).

**NBSP discipline** (NEW post-Codex round 1 WARN #9): wherever this plan shows `60 минут`, `60 минут` etc., the actual rendered string contains `U+00A0` (non-breaking space) between digit and unit per `docs/content-style.md §9` ("Между числом и единицей измерения — неразрывный пробел"). The `\u00A0` character is invisible in this markdown, but §3.7 unit tests pin it. Implementation: `lib/email/templates/learner-lesson-reminder.ts` builds the string as `` `Через ${windowMinutes}\u00A0минут` `` — every literal Russian unit-after-number occurrence in the template uses `\u00A0`.

**Body, with Zoom URL:**

```
Здравствуйте.

Через 60 минут — занятие с учителем Анна.

Когда: 1 июня, 17:00 (Asia/Yekaterinburg, UTC+5)
Длительность: 60 минут
Войти: https://meet.google.com/xxx-yyyy-zzz

Если нужно перенести: ${siteUrl}/cabinet

— Команда LevelChannel
```

**Body, without Zoom URL:**

```
Здравствуйте.

Через 60 минут — занятие с учителем Анна.

Когда: 1 июня, 17:00 (Asia/Yekaterinburg, UTC+5)
Длительность: 60 минут

Если нужно перенести: ${siteUrl}/cabinet

— Команда LevelChannel
```

(The "without Zoom" variant DROPS the `Войти:` line cleanly — no `«ссылка отсутствует»` / `«нет ссылки»` / `«—»` placeholder. The variant is selected at render-time by `if (zoomUrl) { include line } else { omit }`.)

**Tone authority — `docs/content-style.md`:**
- "занятие" not "урок" (§4 глоссарий — slots rename to "занятия").
- "перенести" / "отменить" — verbs, not отглагольные substantives (§3.2).
- "Здравствуйте, Анна." if `learner.display_name` is set; "Здравствуйте." otherwise (§8 emails).
- Sign-off `— Команда LevelChannel` with em-dash (§8 sign-off).
- 24-hour format for time (§9).
- Subject ≤ 8 words (§8).

**Body composition rules:**
- `%TEACHER_DISPLAY%` source: `account_profiles.display_name` of the teacher; if null, fall back to "вашим учителем" (literal — no PII leak, no fallback to teacher email).
- `%ZOOM_URL%` source: `lesson_slots.zoom_url` — validated https-only ≤512 chars by the DB CHECK from `migrations/0056_lesson_slots_zoom_url.sql`. escapeHtml-ed in the HTML body; raw URL in plaintext body.
- `%CABINET_LINK%` source: `${paymentConfig.siteUrl}/cabinet` (REVISED post-Codex round 1 WARN #12 — env-driven, not hard-coded; top-level learner cabinet; the "Мои занятия" panel renders the cancel button inline at `app/cabinet/lessons-section.tsx:360`).
- Display name escapeHtml-ed in HTML, written as-is in plaintext.

**Opt-out / unsubscribe surface:** the cabinet link IS the soft-unsubscribe surface (learner can disable the channel from `/cabinet/profile` per §1.7 REVISED, or cancel the slot from `/cabinet` if they don't want the lesson). **Hard unsubscribe (List-Unsubscribe header) deferred to BCS-DEF-4-UNSUB** (§10) once we have any unauthenticated unsubscribe primitive in the codebase.

**Telegram body** (when channel='telegram'): identical text content, plain text — no HTML, no `escapeHtml`. Telegram parses `https://...` URLs as auto-links; no markdown escaping needed for the variants above (no `_`/`*`/`[` in the deterministic copy; teacher display_name is the only injection point — Telegram-escape per the BCS-DEF-1-TG `sendTelegramMessage` helper's contract when that helper ships).

### 2.8.1 Email-client `SendEmailResult` extension (NEW post-Codex round 1 WARN #8)

The current canonical `SendEmailResult` (`lib/email/client.ts:17-19`):

```ts
export type SendEmailResult =
  | { ok: true; transport: 'resend' | 'console' }
  | { ok: false; transport: 'resend' | 'console'; error: string }
```

…has no `id` field, so the plan's intent to capture `resend_email_id` from `result.id` doesn't fit. **Sub-PR B extends the success-arm to carry an optional `id`:**

```ts
export type SendEmailResult =
  | { ok: true; transport: 'resend' | 'console'; id?: string }
  | { ok: false; transport: 'resend' | 'console'; error: string }
```

Implementation in `lib/email/client.ts sendEmail()`: when transport='resend', forward Resend's `data.id` into the return; when transport='console', leave `id` undefined.

**Critical-path impact (NEW):** `lib/email/client.ts` is NOT on `docs/critical-path.md`'s list of 21 files — but `lib/email/dispatch.ts` is on the list. The dispatch.ts add is purely additive (new sender), and the client.ts widening is backward-compatible (optional field). **Sub-PR B's trailer remains `SUB-WAVE self-reviewed`**, since the only critical-path touch is additive on dispatch.ts. Pin via a test that existing senders still type-check against the widened return.

If the helper-rename for `scripts/lib/telegram-alerts.mjs` (§1.6 BCS-DEF-1-TG coordination) lands first, Sub-PR B picks up the helper-presence detection via dynamic import — same shape.

### 2.9 Systemd unit

`scripts/systemd/levelchannel-learner-reminder-dispatch.{service,timer}`. Same 12-directive sandbox as `levelchannel-conflict-unresolved-alert.service`. ReadWritePaths includes `__LEVELCHANNEL_APP_DIR__/var` (no state file is written today, but the directive is symmetric with siblings and trivial to keep aligned in case a state file is added).

`.timer`:
```ini
[Unit]
Description=Run LevelChannel learner reminder dispatcher every minute

[Timer]
# Boot offset 3 min: stagger against the 4 alert probes (5/7/12 + the
# calendar-pathology fixed-time timer). 1-min cadence per docs/plans/
# bcs-def-4-learner-reminders.md §2.1.
OnBootSec=3min
OnUnitActiveSec=1min
Persistent=true
Unit=levelchannel-learner-reminder-dispatch.service

[Install]
WantedBy=timers.target
```

Also add to `scripts/activate-prod-ops.sh:247-277 units=()` and `:310-324 timers=()` allowlists (exact pattern from `docs/plans/conflict-unresolved-alert.md §2.8`).

### 2.10 `probe_runs.probe_name` CHECK extension

Migration **0063** (next-free after 0061 dispatch table + 0062 accounts TG columns) — additive ALTER. Same idiom as `migrations/0058_probe_runs_conflict_unresolved.sql`:
```sql
alter table probe_runs
  drop constraint if exists probe_runs_probe_name_check;
alter table probe_runs
  add constraint probe_runs_probe_name_check
  check (probe_name in (
    'auth-flow', 'calendar-pathology', 'webhook-flow',
    'conflict-unresolved', 'learner-reminders'
  ));
```

`scripts/lib/probe-runs.mjs PROBE_NAMES` gets `LEARNER_REMINDERS: 'learner-reminders'`.

`VERDICT_KINDS` already covers `ok`, `error`, `config_missing`. Add `channel_disabled_by_operator` to the constant + to the migration's `verdict_kind` CHECK if it's enumerated there. (Confirmed in `scripts/lib/probe-runs.mjs:37-51` — `VERDICT_KINDS` is the source of truth; the migration's CHECK must mirror. **§5 file inventory carries the corresponding migration ALTER**.)

---

## 3. Tests (REVISED)

Fixture-driven, mirrors `tests/integration/scripts/conflict-unresolved-alert.test.ts` shape.

### 3.1 Unit — `tests/admin/operator-settings.test.ts`

- **3** (was 5) new keys present in `SETTING_SCHEMA` with the expected kind/min/max/scope:
  - `LEARNER_REMINDERS_EMAIL_ENABLED` (int 0–1, default 1).
  - `LEARNER_REMINDER_WINDOW_MINUTES` (int 5–360, default 60).
  - `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK` (int 1–5000, default 200).
- Out-of-range rejection for each.
- ~~`'csv-ints'` validator tests~~ DROPPED (no csv-ints kind this wave).

### 3.2 Drift — `tests/admin/operator-settings.test.ts`

Existing drift pin (TS-side ↔ `.mjs` mirror JSON.stringify) extends to the new 3 keys automatically by walking SETTING_SCHEMA. Add explicit assertion that `learner-reminders` scope is recognised.

### 3.3 ~~Integration — preferences write path~~ DB-level CHECK constraint tests (REVISED post-Codex round 2 BLOCKER #3)

~~POST Server Action…~~ — Sub-PR D ships a READ-ONLY placeholder section per §1.7 REVISED. No writable surface this wave; the Server Action and form tests move to **BCS-DEF-4-TG** (where the toggle becomes interactive).

Sub-PR A adds the schema + CHECK constraints; tests at `tests/integration/migrations/accounts-learner-telegram-checks.test.ts`:
- Direct `INSERT INTO accounts (..., learner_telegram_enabled=true, learner_telegram_chat_id=NULL)` → CHECK violation (`accounts_learner_telegram_consistency`).
- Direct `UPDATE accounts SET learner_telegram_chat_id = repeat('x', 65)` → CHECK violation (`accounts_learner_telegram_chat_id_len`).
- Default new-account row: `enabled=false, chat_id=NULL`. Confirm via SELECT.
- `UPDATE ... SET learner_telegram_enabled=true, learner_telegram_chat_id='12345'` → accepted; round-trip via SELECT.

Sub-PR D adds the placeholder section test at `tests/integration/cabinet/profile-telegram-placeholder.test.ts`:
- GET `/cabinet/profile` as learner → page renders, section "Напоминания в Telegram" is present with the placeholder paragraph; no interactive elements.
- GET as teacher → section is NOT rendered (learner-only).

### 3.3.1 Integration — purge sweep zeros TG columns (NEW)

`tests/integration/scripts/db-retention-cleanup-telegram.test.ts`:
- Set up a learner account with `learner_telegram_enabled=true, learner_telegram_chat_id='12345'`.
- Flip the account to scheduled_purge_at < now() - retention window.
- Run the retention sweep script.
- Assert: `learner_telegram_enabled=false`, `learner_telegram_chat_id IS NULL`, in addition to the existing `email` / `password_hash` zeroing.

### 3.4 Integration — scheduler

`tests/integration/scripts/learner-reminder-dispatch.test.ts` (REVISED for single-window):

- **Happy path:** slot at T+60min. Tick at T → 1 row inserted in `learner_reminder_dispatches (channel='email', status='sent', window_minutes_at_dispatch=60)`, 1 email sent.
- **Double-tick idempotency:** seed a `sent` row at T-1s; tick at T → `ON CONFLICT DO NOTHING` wins → 0 emails sent → row count stays 1.
- **Outside window:** slot at T+59min (below dueMomentLower) → no row, no send.
- **Outside window:** slot at T+61min30s (above dueMomentUpper) → no row, no send.
- **Inside window (lower edge):** slot at T+59min31s → row inserted, email sent.
- **Inside window (upper edge):** slot at T+60min30s → row inserted, email sent.
- **Cancel-race (REVISED post-Codex round 1 WARN #7 / Q11):** slot at T+60min booked at start of tick; mid-TX cancel test simulates `lesson_slots.status='cancelled'` between SELECT and step 5c re-fetch → step 5c finalizes the row as `status='skipped', skipped_reason='slot_no_longer_booked'`. No provider call; audit row IS present. Test asserts: 1 dispatch row, status='skipped', skipped_reason='slot_no_longer_booked', no Resend invocation.
- **Master switch off:** `LEARNER_REMINDERS_EMAIL_ENABLED=0` → no rows, no sends, `recordProbeRun({verdict_kind:'channel_disabled_by_operator'})`.
- **Custom operator window:** set `LEARNER_REMINDER_WINDOW_MINUTES=15`; slot at T+15min → row + send. Slot at T+60min in the same tick → no row.
- **Rate limit (REVISED post-Codex round 2 BLOCKER #1):** seed 250 slots all due at T → seed `RATE_LIMIT_PER_TICK=200` → 200 dispatch rows finalized as `status='sent'`, 50 finalized as `status='skipped', skipped_reason='past_send_by'`. Test asserts: total dispatch rows = 250, sent = 200, skipped/past_send_by = 50, `recordProbeRun({stats: {sends_overflowed_rate_limit: 50}})`, EXACTLY 200 provider invocations (mocked Resend `send` counter).
- **Rate limit — mixed channels (NEW):** seed 100 email-only learners + 100 email+TG learners all due at T → 100 + (100 × 2) = 300 attempts; with cap=200, the first 100 emails for email-only learners are sent, then ordering favors `start_at ASC` so dual-channel learners send email or TG up to budget; assertions pin the deterministic ordering rule from §2.4 step 6.
- **Send failure path:** mock `sendLearnerLessonReminder` to return `{ok:false, error:'rate_limited'}` → row inserted with `status='skipped', skipped_reason='send_failed', last_error='rate_limited'`, no retry.
- **Anonymised learner_email (REVISED post-Codex round 2 WARN #5):** `accounts.email` is `NOT NULL` in production — the realistic edge is a purged learner whose email got rewritten to `deleted-<uuid>@example.invalid` (per `scripts/db-retention-cleanup.mjs:167-175`). However, the §2.4 step 4 SELECT also filters `purged_at IS NULL`, so a fully-purged learner's slots NEVER reach step 5; the `email_missing` skip branch is reachable only via a defensive in-memory edge case (e.g. mid-tick race between SELECT and re-fetch where purge stamps `purged_at` and rewrites email). Test seeds the rewrite directly and asserts the suffix-match gate fires. Pure-defensive coverage; not a steady-state behaviour.
- **Telegram path (helper shipped):** `learner_telegram_enabled=true, chat_id='123'`, stub `sendTelegramMessage` returns `{ok:true, message_id:'m1'}` → second row `channel='telegram', status='sent', telegram_message_id='m1'`.
- **Telegram path (helper NOT shipped):** scheduler imports `scripts/lib/telegram-alerts.mjs` and gets `null` / `module not found` → row inserted `channel='telegram', status='skipped', skipped_reason='telegram_helper_not_shipped'`.
- **Telegram path (no chat-id):** `enabled=true, chat_id=null` cannot happen because of CHECK; `enabled=false` → no Telegram row written.
- **ON DELETE RESTRICT (REVISED post-Codex round 2 BLOCKER #2):** attempting `DELETE FROM accounts WHERE id=$X` against an account with a dispatch row raises an FK violation (not silently cascade). Test pins this. Operational implication: hard-deleting an account in dev/test requires deleting dispatch rows first (matches the existing pattern with `lesson_slots`).
- **Deletion-grace gate:** a learner with `disabled_at IS NOT NULL` AND `scheduled_purge_at` set has a `booked` slot due in 60 min. Tick at T → SELECT filters them out by §2.4 step 4's `disabled_at IS NULL ...` clause; zero dispatch rows, zero sends.
- **Past send-by — catch-up replay (REVISED post-Codex round 1 WARN #7 / Q12):** systemd `Persistent=true` wakes after a 10-min outage; slot has `start_at` 50 min in the future (so original due-moment was 10 min ago). §2.4 step 4's widened lower bound `s.start_at > now()` picks the slot up; step 5c's catch-up check detects `start_at - now() < windowMinutes*60s - 30s` → finalizes `status='skipped', skipped_reason='past_send_by'`. Test asserts: 1 dispatch row, status='skipped', skipped_reason='past_send_by', no provider invocation. Operator stat `skipped_past_send_by > 0`.

### 3.5 ~~Integration — booking-route enqueue seam~~ DROPPED

~~`tests/integration/slots/book-enqueues-reminders.test.ts`:~~

**REVISED:** no enqueue seam in the book route this wave. The scheduler reconciles `lesson_slots` directly. Drop this test file; the §3.4 scheduler tests already cover end-to-end "newly-booked slot fires reminder at window".

### 3.6 Integration — admin settings page

`tests/integration/admin/alerts-settings-page.test.ts` (REVISED — extend existing test, not a new file):
- GET as admin → `/admin/settings/alerts` page renders, new "Напоминания учащимся" section visible, current values from `operator_settings` or defaults.
- POST master-switch off → next scheduler tick honours it.
- POST `LEARNER_REMINDER_WINDOW_MINUTES=400` → 400 (max=360), no DB write.
- POST `LEARNER_REMINDER_WINDOW_MINUTES=5` → accepted (min boundary).

### 3.7 Unit — email template

`tests/email/learner-lesson-reminder.test.ts` (REVISED):
- Subject is exactly `Через 60\u00A0минут — занятие на LevelChannel` when window=60 (NB: U+00A0 between digits and `минут` per `docs/content-style.md §9` — REVISED post-Codex round 1 WARN #9).
- Subject substitutes `Через 15\u00A0минут — занятие на LevelChannel` when window=15.
- Body **with Zoom**: contains both `Войти: <url>` AND `Если нужно перенести: ${siteUrl}/cabinet`.
- Body **without Zoom**: does NOT contain `Войти:`, `ссылка отсутствует`, `нет ссылки`, `—`; DOES contain `Если нужно перенести: ${siteUrl}/cabinet`.
- **Test fixture overrides `paymentConfig.siteUrl` to `https://example.test`** (per existing email template test patterns) so the assertion can be exact.
- Body contains learner-local time + tz label per §2.7.
- Teacher display_name fallback to `«вашим учителем»` when null (verify the literal renders).
- HTML body escapes any user-supplied content (display_name, zoomUrl, teacher_display_name) via `escapeHtml`.
- Plaintext body does NOT escape — raw URL, raw display_name.
- Sign-off line uses em-dash + Russian: `— Команда LevelChannel`.
- **NBSP pinning (NEW post-Codex round 1 WARN #9):** body MUST contain U+00A0 (non-breaking space) between `60`/`15`/`<window>` and `минут`, and between the duration number and `минут`. Assert via regex `/Через \d+\u00A0минут/`. Reject body content matching `/Через \d+ минут/` with a regular space.
- **24-hour time format pin (NEW):** time string MUST match `/\d{2}:\d{2}/`, never `/\d:\d\d ?[ap]m/i`.

### 3.8 Glossary lint (NEW)

`tests/email/learner-lesson-reminder.test.ts` (additional assertions per `docs/content-style.md §4`):
- Body MUST NOT contain «урок» (assert `body.includes('занятие')` AND `!body.includes('урок')` modulo morphology — accept `занятие|занятия|занятий|занятием` but reject standalone `урок` — regex with word boundaries).
- Body MUST NOT contain «слот».
- Body MUST NOT contain «алерт», «webhook», «invoice».

---

## 4. Security analysis

### 4.1 Email content boundaries (REVISED)

The reminder body contains:
- Slot start time (learner-local), duration.
- **Teacher's display_name** (from `account_profiles.display_name` joined via `lesson_slots.teacher_account_id`, optional max 60 chars). Fallback `«вашим учителем»` if null. escapeHtml-ed in HTML body.
- Zoom URL (from `lesson_slots.zoom_url`, validated https-only ≤512 chars by `migrations/0056_lesson_slots_zoom_url.sql`). escapeHtml-ed in HTML body. Omitted entirely when null/empty.
- The cabinet deep-link `${paymentConfig.siteUrl}/cabinet` (static origin from env config, no user data; REVISED post-Codex round 1 WARN #12).

**Teacher display_name disclosure to learner is acceptable** per RISK-11 — the learner already sees this name in `/cabinet#mine` (the assigned-teacher card). Zero incremental disclosure. Teacher *email* is NEVER in the body.

### 4.2 Recipient is the learner's verified email (REVISED post-Codex round 1 WARN #10)

`accounts.email` is `NOT NULL` (`migrations/0005_accounts.sql:12-15`), so the §2.4 "email is null/empty" check is operationally dead unless the retention sweep has rewritten it. **Real edge case:** purged accounts get `accounts.email = 'deleted-<uuid>@example.invalid'` (per `scripts/db-retention-cleanup.mjs:167-175`). The scheduler treats `@example.invalid` suffix as "skip with reason 'email_missing'" — the suffix is a known anonymisation marker, not a real address.

(There's no scenario where a learner with `status='booked'` slots has a `deleted-*@example.invalid` email AND survives the §2.4 SELECT's slot filter — the **deletion-grace gate in §2.4 step 4 filters them out** before the email rewrite is even relevant (REVISED post-Codex round 3 BLOCKER #2: the prior claim of `ON DELETE CASCADE on learner_account_id` was wrong — the FK is `ON DELETE RESTRICT` and the retention sweep anonymises rather than deletes; the deletion-grace SELECT filter is the operative protection, not a cascade). The `email_missing` branch is defensive code; tests pin it but it's not expected in steady-state production.)

**Email verification status is NOT a precondition** — a booked slot already requires `requireLearnerArchetypeAndVerified` at the route level (`app/api/slots/[id]/book/route.ts:39`), so any learner whose slot got selected was verified at book-time. We don't re-check at send time to avoid the edge case where a learner's verification was administratively revoked between book and reminder; in that case the operator already has a "you need to re-verify" path and the reminder leaking through is a minor noise issue, not a security issue.

### 4.3 Rate-limit / abuse (REVISED)

- `LEARNER_REMINDERS_RATE_LIMIT_PER_TICK` (default 200) caps how many sends leave per tick — counts email AND telegram together.
- Resend's own per-account rate limit is the upstream cap for email.
- Telegram bot API rate limits are upstream caps for TG.
- A pathological case (operator sets 5000 + 5000 learners book in one minute) is bounded by the operator setting. Unlike the original queue-table design, the single-window scheduler has no "queue depth that grows over multiple ticks" — slots outside the +30s window simply aren't selected. **A booking surge inside the window minute drops sends > rate limit into oblivion** (not into the next tick). Operator monitors per-tick stats and can pre-emptively raise the cap.

### 4.4 SQL injection (REVISED)

All scheduler queries are parameterised. ~~The `offsets_minutes` array passed from prefs is a Postgres `integer[]` typed column — no string interpolation. The CSV operator setting is parsed in-process to `number[]` before passing to `unnest`.~~ No array params this wave; `LEARNER_REMINDER_WINDOW_MINUTES` is a plain int passed as `$1`.

### 4.5 Cross-account leakage (REVISED)

`UNIQUE (slot_id, channel)` does NOT enforce per-account uniqueness. But `slot_id → learner_account_id` is 1:1 (a slot has one learner). So a row's `account_id` is structurally derivable from the slot. The scheduler still stores it explicitly so the eventual `ON DELETE RESTRICT` violation messages name the account, **and so an operator running `SELECT FROM learner_reminder_dispatches WHERE account_id = $X` can find all rows for an account without joining through slots** (REVISED post-Codex round 3 BLOCKER #2: prior wording falsely claimed `ON DELETE CASCADE on accounts(id) chains correctly`; the actual FK is RESTRICT per §2.2, and account-level deletion never happens in production — accounts anonymise in-place).

### 4.7 (NEW) `accounts` column scope discipline

The two new columns (`learner_telegram_enabled`, `learner_telegram_chat_id`) are prefixed `learner_` deliberately — they are LEARNER-archetype-only state. Teacher accounts will get `teacher_telegram_enabled` etc. via BCS-DEF-5-TG. Operators have no Telegram setting (they use BCS-DEF-1-TG's single operator chat-id). No archetype-cross-pollination from these columns.

### 4.6 Migration ACCESS EXCLUSIVE locks (REVISED)

- ~~0059 (preferences)~~ DROPPED.
- 0061 (`learner_reminder_dispatches`) — new table; no existing-table locks.
- 0062 (`accounts` ADD COLUMN with `IF NOT EXISTS` + DEFAULT false NOT NULL) — Postgres 11+ ADD COLUMN with non-null constant default is metadata-only (no rewrite); the two CHECK constraints with `NOT VALID` semantics would be even safer but the table is small (<10k rows) and the brief `ADD CONSTRAINT` with a default-false invariant pre-satisfied costs ~1 sec ACCESS EXCLUSIVE. **Acceptable.** Document as a noted lock in the migration header so operator runs it during a low-traffic window.
- 0063 (probe_runs CHECK extend) — ACCESS EXCLUSIVE briefly on probe_runs. Same shape as 0058; accepted (best-effort writer swallows).

---

## 5. Decomposition — multi-PR epic (REVISED)

### Sub-PR A — Schema foundation + operator settings + retention sweep (NO behaviour change)
- `migrations/0061_learner_reminder_dispatches.sql` (NEW — dispatch-history table; numbering bumped because 0060 is BCS-DEF-7 syncToken already on `main`)
- `migrations/0062_accounts_learner_telegram_optin.sql` (NEW — two columns + two CHECKs on `accounts`)
- `migrations/0063_probe_runs_learner_reminders.sql` (NEW — probe_runs CHECK extend)
- `lib/admin/operator-settings.ts` (ProbeName widen + **3** keys; no csv-ints validator)
- `scripts/lib/operator-settings.mjs` (mirror)
- `scripts/lib/probe-runs.mjs` (PROBE_NAMES + verdict_kinds — add `channel_disabled_by_operator`)
- `scripts/db-retention-cleanup.mjs` (NEW post-Codex round 1 BLOCKER #4: zero TG columns on purge)
- Tests: §3.1, §3.2, §3.3.1.
- **Trailer (REVISED post-Codex round 1 BLOCKER #5)**: `Codex-Paranoia: SIGN-OFF round N/3` — Sub-PR A touches `lib/admin/operator-settings.ts` which is on `docs/critical-path.md` (item #21 — "PRs that modify any file from this list MUST land with `Codex-Paranoia: SIGN-OFF round N/3` NOT `SUB-WAVE self-reviewed`"). Sub-PR A runs its OWN paranoia wave (`/codex-paranoia wave` on its diff) before merge, even though the epic-end wave still runs on the full diff at Sub-PR D.
- **Est. LOC: ~280** (was 250; +30 for retention sweep).

### Sub-PR B — Scheduler + email template + email-client widening
- `scripts/learner-reminder-dispatch.mjs` (NEW — single-window, three-state lifecycle per §2.4 REVISED)
- `lib/email/templates/learner-lesson-reminder.ts` (NEW — two body variants gated on zoomUrl; NBSP discipline)
- `lib/email/dispatch.ts` (new `sendLearnerLessonReminder`)
- `lib/email/client.ts` (NEW post-Codex round 1 WARN #8: widen `SendEmailResult` success arm with optional `id`; backward-compatible)
- `scripts/systemd/levelchannel-learner-reminder-dispatch.{service,timer}` (NEW)
- `scripts/activate-prod-ops.sh` — append to `units=()` + `timers=()` arrays AND update the hard-coded summary grep at `:398-400` (NEW post-Codex round 1 WARN #11).
- Tests: §3.4, §3.7, §3.8 (glossary lint).
- **Trailer**: SUB-WAVE self-reviewed. **Critical-path touched**: `lib/email/dispatch.ts` (additive new sender — does not change shape of existing senders). `lib/email/client.ts` is NOT on `docs/critical-path.md`, so the widening of `SendEmailResult` does not by itself force a SIGN-OFF — but the existing-senders-still-typecheck pin in tests is mandatory.
- **Est. LOC: ~600** (was 550; +50 for client.ts widening + summary grep + retention tests).

### Sub-PR C — Admin settings extension + operator activation
- `app/admin/(gated)/settings/alerts/page.tsx` (extend with "Напоминания учащимся" section; no new route)
- `lib/admin/probe-status.ts` (PROBE_NAMES exclusion + comment)
- Tests: §3.6.
- Docs: `docs/plans/admin-ux-coverage.md §3.4` mark closed; §5.4 mark partially closed.
- **Trailer**: SUB-WAVE self-reviewed.
- **Est. LOC: ~200.**

### Sub-PR D — Learner cabinet TG placeholder + doc sweep + epic close (REVISED post-Codex round 3 BLOCKER #3)
- `app/cabinet/profile/page.tsx` (add a **read-only** placeholder section titled "Напоминания в Telegram" per §1.7 REVISED; NO toggle, NO inputs, NO Server Action)
- ~~`app/cabinet/profile-editor.tsx` (extend to render TG toggle + chat-id state per §1.7)~~ DROPPED — no interactive surface this wave
- ~~`lib/auth/profiles.ts` extension (`setLearnerTelegramOptIn(accountId, {enabled, chatId})`)~~ DROPPED — no writable surface this wave; BCS-DEF-4-TG owns this when the active toggle ships
- Tests: §3.3.
- **Docs sweep (NEW post-Codex round 1 WARN #11):**
  - `ENGINEERING_BACKLOG.md` strikethrough BCS-DEF-4 (single-window MVP); add follow-up rows for BCS-DEF-4-TG-LINK (handshake), BCS-DEF-4-PER-USER-WIN, BCS-DEF-4-PUSH, BCS-DEF-4-UNSUB, BCS-DEF-4-VOL-ALERT.
  - `ARCHITECTURE.md` — add row for the `learner-reminders` probe + migrations 0061/0062/0063 reference (~5 lines).
  - `lib/admin/README.md` — add 3 new SETTING_SCHEMA keys to the inventory table.
  - `lib/scheduling/README.md` — add a paragraph describing the scheduler tick + reference §2.4.
  - `lib/email/README.md` — note the new `sendLearnerLessonReminder` + `SendEmailResult.id` widening.
  - `docs/plans/admin-ux-coverage.md` — mark §3.4 closed; §5.4 partially closed (note follow-up BCS-DEF-4-ADMIN-PAGE).
  - `docs/plans/bcs-def-4-tg-telegram-reminders.md` — add "SUPERSEDED schema portion" banner per §1.6.
- **Trailer**: `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`. **Critical-path touched**: revisit per the epic diff.
- **Est. LOC: ~300** (was 250; +50 for doc sweep).

**Total estimated diff: ~1,250 LOC across 4 sub-PRs** (down from ~2,400 in the original plan; the deferred per-user-windows surface accounts for the ~1,150-LOC delta). The plan-mode paranoia round covers the unified design; the epic-end wave covers the aggregated diff.

---

## 6. Risks + mitigations (REVISED)

### RISK-1 — Reminder storm if scheduler runs hot

Scheduler ticks every minute. With the single-window model, at most one tick can match a given slot's reminder moment (modulo clock skew). `UNIQUE (slot_id, channel)` provides hard idempotency. If a clock skew somehow lets two ticks both look due, the second loses the `ON CONFLICT DO NOTHING` race. Rate-limit (default 200/tick) caps blast radius. Operator sees the dispatch-history table climb at `/admin/settings/alerts` (recent dispatch summary).

**Sub-risk — learner books 5 slots in the same minute (paranoia hint F).** 5 emails fire in the same tick. This is a deliberate scheduling choice by the learner; throttling per-learner would suppress legitimate reminders. **Accepted.** The per-tick cap is global, not per-learner; if a 5000-learner spike hits, the §2.4 step 6 mechanism finalizes overflow rows as `status='skipped', skipped_reason='past_send_by'` with the dispatch table showing every dropped attempt + `recordProbeRun({stats: {sends_overflowed_rate_limit: N}})` for the operator. Operator-tunable cap can be raised if the burst is foreseen.

### RISK-2 — Missing reminders if scheduler ticks late

systemd `Persistent=true` ensures missed ticks fire on the next boot/wake. **REVISED post-Codex round 1 WARN #7 / Q12:** when a catch-up tick runs after the original due-moment, the §2.4 step 4 widened SELECT (`s.start_at > now()`) still picks up the slot as long as the lesson hasn't started. Step 5c's catch-up gate detects the overdue state and finalizes the dispatch row as `status='skipped', skipped_reason='past_send_by'` — audit-visible, not silent. **Accepted: a 60-min reminder that arrives 4 min late is more confusing than not arriving at all** — the learner is now 56 minutes from their lesson, which is a different cognitive state than 60 minutes. The skipped audit row IS the alerting signal — operator sees `skipped_past_send_by > 0` in the probe-run stats.

### RISK-3 — Learner removes email mid-flight

If `accounts.email` is nulled (operator deletion / GDPR), the §2.4 5b re-check catches it and the dispatch row is finalized with `status='skipped', skipped_reason='email_missing'`.

### RISK-4 — Slot cancelled mid-flight (paranoia hint A)

§2.4 step 5c re-fetch catches the in-tick cancellation. **Race window: a slot cancelled AFTER the 5c re-fetch but BEFORE `sendEmail` returns** will leak a reminder for a cancelled slot. Window is ~hundreds of ms; the email body's `${siteUrl}/cabinet` link lets the learner self-serve. **Accepted as a degenerate case.**

ALTERNATIVE CONSIDERED: lock the `lesson_slots` row `FOR UPDATE` inside the per-row TX. **REJECTED:** cancellation paths would block on the reminder TX, which is unacceptable for a UX feature (cancellation latency >> reminder latency).

### RISK-5 — ~~Per-user preference mid-flight~~ Per-user TG toggle mid-flight

~~A learner toggles `email_opt_in=false` between enqueue and send.~~ **REVISED:** a learner toggles `learner_telegram_enabled=false` (or removes their chat-id) between the §2.4 SELECT and the §2.4 5d TG-send. Since the channel='email' row is independent, the email is unaffected. The Telegram dispatch row gets `status='skipped', skipped_reason='send_failed', last_error='chat_id_removed_mid_flight'` (or the Telegram-API "bot was blocked" 403 path inherited from BCS-DEF-4-TG). **Accepted.**

### RISK-6 — Operator-window change mid-flight (paranoia hint B)

Operator changes `LEARNER_REMINDER_WINDOW_MINUTES` from `60` to `15` at 14:00. A slot starting at 14:30 (so the 60-min reminder was already sent at 13:30) gets re-evaluated: at 14:15, `start_at - 15min` falls inside the new window; tick at 14:15 hits SELECT → `ON CONFLICT DO NOTHING` blocks the new row because UNIQUE is per `(slot_id, channel)` regardless of window. **Result: only ONE reminder per slot regardless of operator window changes.** The dispatch row's `window_minutes_at_dispatch` column captures whatever value was active at first-send. **Acceptable** — the operator is changing a global default, not retroactively rewriting history.

### RISK-7 — Resend monthly quota

A 1000-learner / 30-day spike could exhaust Resend's free tier (~3000 emails/month). Rate-limit-per-tick caps tick-level burst but NOT month-aggregate. **Mitigation: ALERTS-OBS-style probe (out of scope here)** — operator-tunable threshold "alert me when daily reminder sends > N". Out of scope for this wave; documented as a follow-up (BCS-DEF-4-VOL-ALERT).

### RISK-8 — Critical-path drift on `lib/admin/operator-settings.ts`

Sub-PR A adds 3 keys. ~~+ a new `'csv-ints'` validator.~~ The csv-ints removal eliminates the highest-risk change. The 3 int-typed keys add zero new validator paths — pure additive on existing kind.

### RISK-9 — ~~`'csv-ints'` resolver-result type-narrowing~~ DROPPED

~~`resolveOperatorSetting()` returns `ResolvedSetting.value: number` today.~~ N/A — no csv-ints in this wave.

### RISK-10 (NEW) — BCS-DEF-1-TG slip blocks the TG-send path

If BCS-DEF-1-TG (the `sendTelegramMessage` helper at `scripts/lib/telegram-alerts.mjs`) hasn't shipped at impl time, the scheduler's §2.4 step 5d branch always inserts `skipped_reason='telegram_helper_not_shipped'`. Email path is unaffected. Schema columns + cabinet UI ship anyway. **Accepted; documented as a dependency, not a blocker.** Implementation note: detect helper presence at module load time, not at every tick — cache `null` and log once.

### RISK-11 (NEW) — Privacy: leaking teacher display_name to a learner via email + Telegram

The body says `«занятие с учителем %TEACHER_DISPLAY%»`. If `account_profiles.display_name` of the teacher is null, we substitute `«вашим учителем»` — no email leak. If display_name is set, the learner sees the teacher's display name in plaintext. **Acceptable** — display_name is already visible to the learner in `/cabinet#mine` (the assigned-teacher card); zero incremental disclosure.

### RISK-12 (NEW) — Glossary regression

Body uses «занятие» / «учитель» / «перенести» per `docs/content-style.md §4`. Future copy edits could regress to «урок» / «слот» / «отменить запись». **Mitigation: §3.8 glossary lint** in the test suite makes the regression a test failure.

---

## 7. Acceptance criteria (per sub-PR + epic) (REVISED)

- **A**: migrations 0061/0062/0063 apply; 3 new SETTING_SCHEMA keys validate; `accounts` TG columns + 2 CHECKs survive round-trip; `test:run` + `test:integration` + `build` green.
- **B**: scheduler against no-booked-slot state → `recordProbeRun({verdict_kind:'ok', stats:{selected_due:0, sent_email:0}})`. Against a seeded slot due-in-window → 1 row, 1 email. Master-switch off → no sends. Resend-mock failure → row finalized `skipped`/`send_failed`.
- **C**: `/admin/settings/alerts` renders the new section, reads/writes 3 keys with optimistic concurrency, recent-dispatch-summary shows last 5 probe_runs rows.
- **D (epic close)**: `/cabinet/profile` shows the read-only "Напоминания в Telegram" placeholder section (no toggle, no Server Action — REVISED post-Codex round 3 BLOCKER #3 — active flow lives in BCS-DEF-4-TG); backlog strikethrough; `/codex-paranoia wave` SIGN-OFF round N/3.

Post-merge operator activation: `scripts/activate-prod-ops.sh` picks up timer+service; first tick within 1 min; admin sets master switch + window at `/admin/settings/alerts`.

---

## 8. Migration / rollout (REVISED)

1. Sub-PRs A → B → C → D merge in order. A is schema-only (no behaviour change). B installs the scheduler (which is dormant on prod until activate-prod-ops.sh runs). C extends the admin UI. D adds the cabinet surface.
2. After A merges, operator can pre-set knobs at `/admin/settings/alerts` once C lands. Defaults are sane (`window=60`, master switch ON) so even with no operator config, the system works once C is live + B's systemd unit is activated.
3. After D, `scripts/activate-prod-ops.sh` is run on the VPS to enable the new systemd unit. Until then, the cron is dormant on prod.
4. **First-tick safety:** when the systemd unit is enabled, the §2.4 SELECT will find all booked slots due-in-window across the current 60-sec window. Worst case (60-min window default, no rate-limit pressure) — only slots starting in `(now+59:30, now+60:30]` match. This is a tight upper bound (~minutes-of-load worth of bookings, not a 48h backlog). **No "first-tick storm" risk** — a substantive improvement over the original plan's reconcile-enqueue which scanned a 48h forward window.
5. **TG path dormant until BCS-DEF-1-TG + BCS-DEF-4-TG land (REVISED post-Codex round 3 BLOCKER #3).** `learner_telegram_enabled=false` by default for every account; this wave ships ONLY the schema columns + the read-only `/cabinet/profile` placeholder section. There is no learner-facing toggle in this wave — toggle-via-handshake lands in BCS-DEF-4-TG (which depends on BCS-DEF-1-TG for the `sendTelegramMessage` helper). Even if an operator manually sets `learner_telegram_enabled=true` via SQL (and a `chat_id` to satisfy the CHECK), the scheduler still produces `skipped_reason='telegram_helper_not_shipped'` until BCS-DEF-1-TG's `scripts/lib/telegram-alerts.mjs` is on `main`. No prod-visible TG behaviour from THIS wave alone.

---

## 9. Open questions for paranoia (REVISED)

**Q1.** ~~Is `'csv-ints'` right…~~ N/A (single-window).

**Q2.** ~~Should the dedicated `resolveOperatorCsvIntsSetting()` resolver…~~ N/A (single-window).

**Q3 (REVISED post-Codex round 2 BLOCKER #2).** Dispatch table FK behaviour on `lesson_slots(id) ON DELETE`? **Settled:** use `ON DELETE RESTRICT` to mirror `lesson_slots.learner_account_id`'s own RESTRICT FK on `accounts(id)`. Neither slots nor accounts are hard-deleted in production (retention sweep anonymises in-place). The deletion-grace gate at §2.4 step 4 (`disabled_at / scheduled_purge_at / purged_at IS NULL`) is the operative protection against sending reminders to deletion-grace learners.

**Q4.** List-Unsubscribe header in the email? **Pre-answer:** no in MVP — cabinet page is the explicit opt-out. Unauthenticated unsubscribe is a separate attack surface; defer to BCS-DEF-4-UNSUB.

**Q5.** Rate limit as emails per Resend-account per hour instead of per-tick? **Pre-answer:** per-tick simpler + equally effective at instantaneous blast. Long-window quota → BCS-DEF-4-VOL-ALERT follow-up.

**Q6.** Why polling every 1 minute, not enqueue-with-delayed-NOTIFY? **Pre-answer:** NOTIFY needs a listener LevelChannel doesn't run; polling matches `lib/calendar/pull-worker` + `slot_lifecycle_intents`.

**Q7.** Learner books 5 slots in a row, all starting in the same minute? **Pre-answer:** 5 emails fire in one tick; bounded by per-tick cap; acceptable per RISK-1 sub-risk. (Paranoia hint F.)

**Q8.** Per-slot user-customised reminder window? **Pre-answer:** out of scope MVP. Defer to BCS-DEF-4-PER-SLOT.

**Q9.** Could the scheduler trigger on `lesson_slots` INSERT/UPDATE instead of polling? **Pre-answer:** no — couples booking TX to reminder feature. Polling is looser, same shape as `lib/calendar/pull-worker`.

**Q10.** Multi-tick race on the dispatch INSERT? **Pre-answer:** `INSERT ... ON CONFLICT DO NOTHING RETURNING id` — exactly one tick gets a non-empty RETURNING; the other gets empty and skips.

**Q11 (SETTLED post-Codex round 1 WARN #7).** Mid-tick cancellation: keep the dispatch row as `status='skipped', skipped_reason='slot_no_longer_booked'` (NOT delete). Audit benefit > clean-history benefit. §2.4 step 5c now reflects this; §3.4 tests pin it.

**Q12 (SETTLED post-Codex round 1 WARN #7).** Catch-up tick past +30s: pick up the slot (extended-lower-bound SELECT, see §2.4 step 7) and finalize as `status='skipped', skipped_reason='past_send_by'`. Operator-visible audit signal beats silent loss. §2.4 step 7 now reflects this.

**Q13 (NEW).** ALTER `accounts` ADD COLUMN + CHECK on a production table — operationally, when is the right time? **Pre-answer:** Postgres 11+ NOT NULL DEFAULT false ADD COLUMN is metadata-only. The two ADD CONSTRAINT calls would normally cost ACCESS EXCLUSIVE; since every existing row pre-satisfies the constraints (both columns are brand-new), the check is fast even on a populated table. **Schedule for a low-traffic window anyway.**

**Q14 (NEW).** Should `lesson_slots.zoom_url` empty-string be treated identically to null? **Pre-answer:** yes — the §2.4 SELECT pulls the column verbatim; the template applies `if (zoomUrl && zoomUrl.trim())` to pick the with-zoom variant. Empty string falls into the without-zoom branch. The DB CHECK in `migrations/0056_lesson_slots_zoom_url.sql` already disallows empty strings (validates https-only ≥ ~10 chars), so this is belt-and-suspenders.

---

## 10. Out of scope — deferred follow-ups (REVISED)

- **BCS-DEF-1-TG** — operator-side Telegram alert channel (this plan's Telegram path depends on it). Plan-doc lives at `docs/plans/bcs-def-1-tg-telegram-alerts.md` (PR #339).
- **BCS-DEF-4-TG-LINK** — bot-handshake binding flow for learner chat-id; renames / supersedes the schema portion of `docs/plans/bcs-def-4-tg-telegram-reminders.md` per §1.6 REVISED. The non-schema portion (binding UI + `/start` handshake + 403 unbind path) stays in that plan.
- **BCS-DEF-4-PER-USER-WIN** (NEW) — per-user reminder windows + multi-offset (60/30/10) editor. The `learner_reminder_preferences` table, the cabinet multi-select page, and the csv-ints SETTING_SCHEMA validator land here.
- **BCS-DEF-4-ADMIN-PAGE** (NEW) — standalone `/admin/settings/reminders` admin surface (when channel growth makes the alerts-page section bloated).
- **BCS-DEF-4-PUSH** — PWA web push. Plan-doc at `docs/plans/bcs-def-4-push-pwa-reminders.md` (PR #350).
- **BCS-DEF-5** — Teacher reminders. Sibling plan; mirrors this with `teacher_reminder_preferences` + parallel scheduler. Plan-doc at `docs/plans/bcs-def-5-teacher-reminders.md` (PR #336).
- **BCS-DEF-4-UNSUB** — List-Unsubscribe header + signed-token `/api/reminders/unsubscribe?t=...`. Unauthenticated surface; defer.
- **BCS-DEF-4-PER-SLOT** — Per-slot custom offsets (learner picks `5` for one specific lesson).
- **BCS-DEF-4-VOL-ALERT** — Daily aggregate volume alert defending Resend quota. Mirrors `auth-flow-alert`.

---

## 11. Final trailer expectations (REVISED post-Codex round 1 BLOCKER #5)

- **Sub-PR A** — touches `lib/admin/operator-settings.ts` (critical-path item #21). Per `docs/critical-path.md` "Process gate" section, MUST land with `Codex-Paranoia: SIGN-OFF round N/3 (sub-PR critical-path on lib/admin/operator-settings.ts)` + `Critical-Path-Touched: lib/admin/operator-settings.ts, scripts/lib/operator-settings.mjs` + `Skill-Used: /codex-paranoia wave`. Sub-PR-A wave is in addition to the epic-end wave at Sub-PR D.
- **Sub-PRs B/C** — `Codex-Paranoia: SUB-WAVE self-reviewed (epic bcs-def-4-learner-reminders); epic-end review pending` + `Critical-Path-Touched: lib/email/dispatch.ts` (Sub-PR B only — additive sender; epic-end wave covers it) + `Skill-Used: /codex (manual diff pass)`.
- **Sub-PR D (epic close)** — `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)` + `Skill-Used: /codex-paranoia wave`.

— END OF REVISED PLAN (2026-05-19) — Codex paranoia round 3 status: 2 BLOCKERs flagged as textual-drift on already-settled contracts (FK CASCADE vs RESTRICT lower-body wording; Sub-PR D toggle vs placeholder execution drift). Both drift instances scrubbed inline by the author. Hard cap of 3 rounds reached; further drift would surface only on a hypothetical round-4 which the skill contract forbids. See §0 closure block for final outcome. —
