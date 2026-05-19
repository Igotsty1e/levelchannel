# BCS-DEF-5-TG — Telegram channel for teacher lesson-start reminders

**Status:** DRAFT 2026-05-19 (plan-doc only; awaiting `/codex-paranoia plan`). Scope-adjusted 2026-05-19 — BCS-DEF-5 parent rewritten as daily 08:00 digest (was per-slot reminders); this TG plan now stacks on the digest schema/cron once the email MVP ships. See the rewritten parent `docs/plans/bcs-def-5-teacher-reminders.md` for the new email contract; this TG plan-doc itself will need its own follow-up rewrite to align its tick/scheduler references with the digest model (not done in this PR — doc-only sibling note).
**Wave name:** `bcs-def-5-tg-teacher-telegram-reminders` (independent
single-PR epic — see §5).
**Trigger:** Telegram channel deferred from BCS-DEF-5
(`docs/plans/bcs-def-5-teacher-reminders.md` §10 — Telegram deferral row).
**Author:** Claude (autonomous).

> **READ FIRST: `docs/plans/bcs-def-4-tg-telegram-reminders.md`.** This is a
> DELTA on top of that plan. Architecture contract (binding-code flow, single
> bot, webhook secret-token auth, soft-skip env semantics, 403 auto-unsubscribe,
> plain-text body, security analysis) is INHERITED VERBATIM. Only audience
> differences are captured here.

---

## 0. Cross-refs

- **`docs/plans/bcs-def-4-tg-telegram-reminders.md`** (PR #347) — sibling
  LEARNER plan. Bot + webhook (§2.1, §2.4), bind-codes shape (§2.3),
  `learner_telegram_subscriptions` (§2.3), cabinet UI (§2.8), security (§4)
  — INHERITED.
- **`docs/plans/bcs-def-5-teacher-reminders.md`** (PR #336) — parent. §2.1
  ships unified `scripts/lesson-reminder-dispatch.mjs`. §2.4 ships teacher
  email template. §10 defers Telegram to THIS plan.
- **`docs/plans/bcs-def-1-tg-telegram-alerts.md`** (PR #339) — operator
  alert precedent. `sendTelegramMessage` + bot-token env-file controls. SAME
  bot now serves operator + learner + teacher.
- **`docs/plans/bcs-def-4-learner-reminders.md`** §2.1 — unified scheduler
  + probe-name `lesson-reminders`.

---

## 1. Goal — DELTA from BCS-DEF-4-TG

Add Telegram as a delivery channel for the TEACHER side of the unified
lesson-reminder scheduler. When a teacher has bound Telegram AND
`TEACHER_TELEGRAM_ENABLED=1`, scheduler dispatches each due teacher
reminder via **both email AND Telegram**.

**Audience deltas vs BCS-DEF-4-TG:**
- Recipient is `lesson_slots.teacher_account_id`.
- Settings UI at `/teacher/settings/reminders` (page from BCS-DEF-5
  Sub-PR F), not `/cabinet/...`.
- Rows in NEW `teacher_telegram_subscriptions`. A dual-archetype person
  (allowed per BCS-DEF-5 RISK-13) has two independent bindings.
- Default cadence `[60, 30, 10, 5]`. The 5-min "imminent" ping with
  push-style Telegram is the very payoff BCS-DEF-5 §10 named.

**Hard requirements:** identical to BCS-DEF-4-TG §1 — idempotent per
`(slot_id, offset_minutes, channel)`, soft-skip on missing binding, 403
auto-unsubscribe, plain-text body. **[INHERIT verbatim.]**

---

## 1.1 Existing surface inventory

Cited against `main` as of 2026-05-19, assuming BCS-DEF-4-TG (PR #347) +
BCS-DEF-5 Sub-PR E/F (PR #336) merged.

- **`migrations/0064_teacher_reminder_dispatches.sql`** — `channel` CHECK
  currently `'email'`; extended. Idempotency index unchanged.
- **`migrations/0063_teacher_reminder_preferences.sql`** — no
  `telegram_opt_in` column (binding existence = implicit opt-in).
- **`scripts/lesson-reminder-dispatch.mjs`** — already audience-branched;
  learner arm channel-branched post-BCS-DEF-4-TG. Adds parallel
  channel-fork in teacher arm.
- **`lib/admin/operator-settings.ts`** — `LEARNER_TELEGRAM_ENABLED` exists.
  Adds 1 key `TEACHER_TELEGRAM_ENABLED` (`scope: 'lesson-reminders'`).
- **`app/admin/(gated)/settings/reminders/page.tsx`** — Shared/Learner/
  Teacher structured; "Telegram канал" under Learner exists; parallel row
  added under Teacher.
- **`app/teacher/settings/reminders/page.tsx`** — adds Telegram section.
- **`app/api/telegram/webhook/route.ts`** — EXTENDED, not forked; §2.3
  adds role-inferred dispatch.
- **`lib/notifications/telegram-templates.ts`** — extended with teacher
  builder.
- **`scripts/lib/telegram-alerts.mjs`**, `TELEGRAM_BOT_*` env vars —
  REUSE; no new env vars; no setWebhook re-call.

**Critical-path:** `lib/admin/operator-settings.ts` (additive — 1 key).
Scheduler + webhook routes NOT critical-path.

---

## 2. Design deltas

### 2.1 Single bot, role inferred at redeem time

Same bot, three flows (operator + learner + teacher). Three options for
disambiguating learner-vs-teacher `/start <code>`:

| Option | Pros | Cons |
|---|---|---|
| **(a) Prefix code** `L-` / `T-`; webhook inspects prefix. | Trivial routing. | 10-char code instead of 8 (UX worse); extra alphabet axis to mistype; two regex flavors. |
| **(b) Single bot, role inferred at redeem time (CHOSEN).** Bind-codes row carries `kind` set at issuance time by the role-gated Server Action; webhook reads it. | Uniform 8-char UX. Single SELECT. Authority lives in the source page's role gate. `kind` frozen at issuance — no archetype-change race. | Bind-codes table gains `kind` column. Two subscription tables. |
| **(c) Separate bot for teachers.** | Hard isolation. | Doubles BotFather + env + setWebhook ops. Visible "two bots" UX confusing for dual-archetype users. |

**Decision: (b).** Uniform UX, single webhook, role-gating at source page.
Storing `kind` on the row (vs JOIN-resolving archetype at SELECT time)
costs 1 byte/row and defends against the "teacher loses archetype between
issuance and redemption" race.

### 2.2 Schema — promote bind-codes to shared table

BCS-DEF-4-TG named the table `learner_telegram_bind_codes`. This plan
renames it to `telegram_bind_codes` with a new `kind` discriminator.

**Decision: rename + add `kind`.** Two sibling tables alternative rejected
— webhook would need UNION-LOOKUP across both (or prefix-branch = option
(a) by the back door).

**Migration 0066 — `telegram_bind_codes` (rename + extend):**

```sql
create table if not exists telegram_bind_codes (
  code text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  kind text not null check (kind in ('learner', 'teacher')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  consumed_chat_id bigint null
);

create unique index if not exists tbc_one_active_per_account_kind_idx
  on telegram_bind_codes (account_id, kind)
  where consumed_at is null and expires_at > now();

-- Data-copy from BCS-DEF-4-TG learner table; no-op shape (10-min TTL).
insert into telegram_bind_codes (code, account_id, kind, created_at, expires_at, consumed_at, consumed_chat_id)
  select code, account_id, 'learner', created_at, expires_at, consumed_at, consumed_chat_id
    from learner_telegram_bind_codes
  on conflict (code) do nothing;

drop table if exists learner_telegram_bind_codes;
```

`app/cabinet/settings/reminders/telegram-actions.ts` updated in lockstep
to write to new table with hard-coded `kind='learner'`.

**Migration 0067 — `teacher_telegram_subscriptions`:** structural clone of
`learner_telegram_subscriptions` (BCS-DEF-4-TG §2.3) — same columns + same
three partial indexes. MVP: one active binding per teacher.

**Migration 0068 — `teacher_reminder_dispatches` CHECK extend:** `channel`
→ `('email', 'telegram')`; `skipped_reason` adds
`'no_telegram_binding'` + `'bot_blocked_by_user'` (parallel to
BCS-DEF-4-TG §2.5.1).

### 2.3 Webhook route — role-inferred dispatch

`app/api/telegram/webhook/route.ts` extended. `/start <code>` flow:
validate `/^[A-Z0-9]{8}$/`; `SELECT code, account_id, kind FROM
telegram_bind_codes WHERE code=$1 AND consumed_at IS NULL AND expires_at
> now() FOR UPDATE`; on miss → "Код просрочен или уже использован";
UPDATE `consumed_at`+`consumed_chat_id`; branch on `kind` — `'learner'`
→ existing `handleLearnerBind` (writes `learner_telegram_subscriptions`),
`'teacher'` → NEW `handleTeacherBind` (writes
`teacher_telegram_subscriptions`; same rebind semantics); COMMIT;
audience-keyed reply (teacher copy: "Готово. Будете получать напоминания
за 60/30/10/5 минут до начала. Изменить расписание:
levelchannel.ru/teacher/settings/reminders. Отписаться: /stop.").

**`/stop` handler — UNION across both tables.** One chat could be bound
to both tables (dual-archetype person). `/stop` UPDATEs every active row
across BOTH `learner_telegram_subscriptions` AND
`teacher_telegram_subscriptions` matching the chat_id; reply names both
audiences. Per-audience `/stop_teacher` / `/stop_learner` deferred (§10).

### 2.4 Scheduler dispatch — teacher Telegram branch

Scheduler already audience-branches (BCS-DEF-5 §2.1) + channel-branches in
learner arm (BCS-DEF-4-TG §2.5). Adds parallel channel-fork in teacher arm.

**Reconcile-enqueue:** parallel to BCS-DEF-4-TG §2.5 SQL against
`teacher_reminder_dispatches` + `teacher_telegram_subscriptions`. Two
params: `$1` = `TEACHER_REMINDERS_DEFAULT_OFFSETS_CSV`, `$2` =
`TEACHER_TELEGRAM_ENABLED`. Cross-join `CASE WHEN $2 AND EXISTS(active
teacher binding) THEN ['email','telegram'] ELSE ['email']` shape is
verbatim from BCS-DEF-4-TG.

**Per-row send branch** (step 5b, teacher arm): pop teacher row with
`channel='telegram'` → look up active subscription → build via
`buildTeacherReminderTelegram(...)` → send via `sendTelegramMessage`. 403
auto-unsubscribe + 5xx retry identical to learner branch.

**Daily-cap interaction (BCS-DEF-5 §2.11).** Current cap counts ALL `sent`
rows. **Decision: cap counts only `channel='email'`.** Telegram is the
"free" push-style add-on per BCS-DEF-5 task brief; Telegram-side has its
own 30-msg/s global cap above blast. §2.11 SELECT gains `AND channel='email'`.

### 2.5 Teacher cabinet UI — `/teacher/settings/reminders`

NEW "Telegram-напоминания" section below email section. UI states
mirror BCS-DEF-4-TG §2.8 (hidden / no-binding+"Получить код" / code-
issued+deep-link+countdown / active-binding+"Отвязать"). Copy for the
no-binding state mentions the 5-min imminent ping as the headline value
prop.

**Server Actions** (`app/teacher/settings/reminders/telegram-actions.ts`):
mirror BCS-DEF-4-TG §2.8 cabinet actions; differences:
- `requestTeacherTelegramBindCode()` hard-codes `kind='teacher'` on INSERT.
- `unbindTeacherTelegram()` UPDATEs `teacher_telegram_subscriptions`.
- Outer boundary: layout-level archetype gate
  (`app/teacher/page.tsx:38-47` precedent); hard-coded `kind` =
  defence-in-depth.

### 2.6 Admin UI — `/admin/settings/reminders`

"Teacher reminders" section gains "Telegram канал" row parallel to
BCS-DEF-4-TG's learner row: master switch `TEACHER_TELEGRAM_ENABLED`,
active subscriptions count, recent unbinds (24h). Env-presence indicators
render once at page level (shared across learner + teacher rows). Recent
dispatch summary widget surfaces 4-cell matrix:
`{learner,teacher}_{email,telegram}_sent` from `probe_runs.stats`.

### 2.7 Teacher Telegram template

`lib/notifications/telegram-templates.ts` — add
`buildTeacherReminderTelegram(...)`. Plain text, ≤1024 chars. Shape:
headline + "Когда" + "Длительность" + `Учащийся:` line + "Войти" zoom-url
+ "Изменить расписание" deep-link + `/stop` hint. Deltas vs learner
template:
- `Учащийся:` line — first-name + initial (BCS-DEF-5 §2.4 PII policy:
  email-first-letter fallback; NEVER full email).
- 5-min variant headline: `LevelChannel — занятие сейчас начнётся`.
- "Изменить расписание" → `/teacher/settings/reminders`.
- Plain text only; no `parse_mode`; no inline keyboard.

### 2.8 Operator settings — 1 new key

`TEACHER_TELEGRAM_ENABLED` — `kind: 'int'`, `default: 0`, `min: 0`,
`max: 1`, `scope: 'lesson-reminders'`. Description: "master switch for
teacher Telegram reminders; reuses TELEGRAM_BOT_TOKEN/SECRET/USERNAME from
BCS-DEF-4-TG (no setWebhook re-call)". No new env vars.

### 2.9 Migration ordering

`0066_telegram_bind_codes_rename.sql` → `0067_teacher_telegram_subscriptions.sql`
→ `0068_teacher_reminder_dispatches_telegram_channel.sql`. 0066 drops old
table after data-copy in same TX. 0067 purely additive. 0068 ACCESS
EXCLUSIVE briefly on `teacher_reminder_dispatches` (small steady-state).

---

## 3. Tests — deltas vs BCS-DEF-4-TG

BCS-DEF-4-TG §3.1-§3.9 tests have direct teacher-side mirrors. New:

- **`telegram-webhook-role-inference.test.ts`** — `kind` correctly routes
  writes to learner-only/teacher-only/both subscription tables; audience-
  keyed reply copy.
- **`telegram-webhook-stop-multi-table.test.ts`** — `/stop` UPDATEs both
  tables when chat dual-bound; touches only the bound table otherwise
  (regression pin for BCS-DEF-4-TG `/stop`).
- **`lesson-reminder-dispatch.test.ts` (extended)** — teacher with TG
  binding + master switch → 2× rows per (slot, offset); without binding →
  email-only; daily-cap counts only `channel='email'`; 403 → row marked
  + sub unsubscribed; email row for same (slot, offset) unaffected.
- **`teacher/reminder-telegram-binding.test.ts`** — section hidden when
  switch off; `requestTeacherTelegramBindCode` inserts `kind='teacher'`;
  POST as learner archetype → 403; unbind round-trips.
- **`admin/reminders-teacher-telegram-row.test.ts`** — row renders; switch
  round-trips; sub count reflects DB.
- **`notifications/teacher-reminder-telegram.test.ts`** — ≤1024 chars;
  5-min headline; `Учащийся:` escapeHtml + email-first-letter fallback;
  zoom-url omitted; deep-link to `/teacher/...`.
- **`admin/telegram-bind-codes-rename.test.ts`** — pre-migration seed in
  old table; post-0066 row migrated with `kind='learner'`; old table
  dropped; `kind='admin'` fails CHECK.
- **`tests/admin/operator-settings.test.ts` (modified)** — drift pin for
  `TEACHER_TELEGRAM_ENABLED`.

---

## 4. Security — deltas

INHERITED VERBATIM from BCS-DEF-4-TG §4.1-§4.8. Deltas:

- **PII** — Teacher body includes `Учащийся:` per BCS-DEF-5 §4.1
  (first-name + initial; email-first-letter fallback; NEVER full email).
  Teacher already sees this in `/teacher` calendar UI — no incremental
  disclosure.
- **Cross-archetype binding spoofing** — A learner cannot inject
  `kind='teacher'` because: (1) layout-level archetype gate on
  `/teacher/settings/reminders`; (2) Server Action hard-codes `kind` on
  INSERT; (3) chat-id authority is Telegram's. Webhook trusts `kind`
  because only role-gated paths write it.
- **Migration 0066 atomicity** — data-copy + DROP in same TX; concurrent
  OLD-table writes serialize against DDL; lockstep code switch (squash-merge
  atomicity).

---

## 5. Decomposition — independent epic, single PR

**Q: sub-PR inside BCS-DEF-5 epic OR independent epic?**

**Decision: INDEPENDENT EPIC, single PR.** Four reasons:

1. BCS-DEF-5 epic already SIGN-OFF'd against a 2-sub-PR decomposition.
   Adding a third sub-PR mid-flight violates the paranoia contract.
2. BCS-DEF-4-TG precedent — shipped as independent single-PR epic AFTER
   BCS-DEF-4 closed. Symmetric handling here.
3. Smaller paranoia surface — independent wave runs on ~1100 LOC of pure
   TG delta; folding into BCS-DEF-5 would cover both teacher email
   (~900 LOC) AND TG delta = lower signal-to-noise.
4. Strict prereqs: BCS-DEF-5 Sub-PR E (scheduler + teacher queue), Sub-PR
   F (`/teacher/settings/reminders` page), BCS-DEF-4-TG (webhook +
   bind-codes precursor) all SIGN-OFF on prod first.

**Single PR — epic IS the PR.** ~1100 LOC; migrations + scheduler branch
+ webhook + UI + admin row tightly coupled. Files: 3 migrations +
scheduler fork + webhook extend + teacher TG template + admin row +
teacher settings section + teacher Server Actions + cabinet Server Action
update (new table w/ `kind='learner'`) + operator-settings 1 key + mjs
mirror; 6 new tests + 2 modified; backlog strikethrough; §10 cross-refs.
**Trailer:** `Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave
collapsed)`.

---

## 6. Risks — bot conflated context + new

BCS-DEF-4-TG §6 RISK-1 through RISK-9 carry verbatim. Deltas:

### RISK-10 — Bot conflated context across teacher + learner binding flows

Same bot serves both `/start <code>` flows. Worry: wrong audience copy OR
cross-writes to wrong subscription table. **Mitigation:** webhook has NO
chat-side session memory; every `/start <code>` is a fresh SELECT against
`telegram_bind_codes`; row's `kind` (frozen at issuance by role-gated
Server Action) determines BOTH target table (§2.3 step 5) AND reply copy
(§2.3 step 7). Dual-archetype user generates one code per archetype from
its own role-gated page, redeems both from same chat → two correctly-
tailored welcome messages + two subscription rows. Pinned by §3 role-
inference test. Residual: nil — no shared mutable state across messages.

### RISK-11 — Migration 0066 race with in-flight learner code

Learner clicking "Bind" right before deploy has a code in old table;
migration data-copies; new webhook reads new table. Edge: Server Action
runs AFTER data-copy SELECT but BEFORE DROP, writing a row DROP loses.
**Mitigation:** new Server Action code in same PR writes new table; OLD
writer only on OLD process which autodeploy restart replaces before
migration runs. Worst case: ~30s restart window — learner retries.

### RISK-12 — `/stop` side-effect surprise

Teacher `/stop`s also opts out of learner reminders if dual-bound. Union-
stop is intentional (chat is the unit, not audience). Reply explicitly
names both audiences.

### RISK-13 — Bot serves 3 flows now

Bot blocked / token rotated = three flows down. Operator runbook
documents single-bot single-rotation; email contour independent. Blast =
"all Telegram", not "all reminders".

### RISK-14 — 5-min Telegram beats email on same tick

UNION ALL drain order non-deterministic. Both channels carry same
`zoom_url` + timing data; no info loss. Symmetric to BCS-DEF-4-TG RISK-7.

---

## 7. Acceptance criteria

Ships when: migrations 0066/0067/0068 apply clean; `test:run` +
`test:integration` + `build` green; `/codex-paranoia plan` +
`/codex-paranoia wave` SIGN-OFF; trailer
`Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)` +
`Critical-Path-Touched: lib/admin/operator-settings.ts` +
`Skill-Used: /codex-paranoia plan + /codex-paranoia wave`; backlog
strikethrough.

Post-merge: webhook already registered (BCS-DEF-4-TG) — no setWebhook
re-call; operator flips `TEACHER_TELEGRAM_ENABLED=1`; self-binds + test
self-slot confirms delivery on next tick.

---

## 10. Out of scope

- **Bot moderation / abuse handling** — anti-spam, ban-list. Defer until
  prod traffic shows need.
- **Learner-side Telegram** — covered by BCS-DEF-4-TG. This plan does NOT
  modify learner subscription semantics; only renames the shared
  bind-codes table + extends `/stop` to cross both tables.
- **BCS-DEF-5-TG-MULTI-CHAT** — one teacher binding multiple chats.
- **BCS-DEF-5-TG-PER-AUDIENCE-STOP** — `/stop_teacher` / `/stop_learner`.
- **BCS-DEF-5-TG-RECOVERY** — admin UI to un-revoke a sub marked
  `bot_blocked_by_user`.
- **BCS-DEF-5-TG-RICHFORMAT** — Markdown / inline keyboards.
- **BCS-DEF-5-TG-GDPR** — null chat-id on unbind.
- **BCS-DEF-5-PUSH** — PWA push channel for teachers.

— END OF DRAFT (awaiting `/codex-paranoia plan`) —
