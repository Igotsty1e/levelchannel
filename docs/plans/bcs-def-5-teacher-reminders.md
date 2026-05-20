# BCS-DEF-5 — Daily 08:00 lesson digest for teacher (email)

**Status:** SHIPPED 2026-05-19 — PR #393 merged. Migrations 0067 (`teacher_account_daily_digests` + 7-day operator-widget partial index) + 0068 (`probe_runs.probe_name` CHECK extends to `'teacher-daily-digest'`) + 0069 (`account_profiles.timezone` IANA NOT VALID + VALIDATE CHECK). Cron driver `scripts/teacher-daily-digest.mjs` + admin `/admin/settings/digest` page + 3 operator-tunable settings under scope `teacher-daily-digest`. Paranoia history: Round 1 closed 7 BLOCKERs + 3 WARNs; Round 2 closed 3 NEW BLOCKERs + 3 NEW WARNs; round-3 mechanical SIGN-OFF in §0e. Master switch defaults OFF — production activation = operator runs `scripts/activate-prod-ops.sh` + flips `TEACHER_DIGEST_MASTER_SWITCH=1`.
**Wave name:** `bcs-def-5-teacher-reminders` (digest MVP — single PR per §5).
**Trigger:** Backlog item "BCS-DEF-5" (`ENGINEERING_BACKLOG.md:45`) — "Lesson-start reminders for teacher". Scope re-cut by product owner 2026-05-19 as a daily morning digest, not per-slot pings (see §0a).
**Author:** Claude (autonomous).
**Channels:** **MVP = email only.** Telegram deferred (§10). Push not on the roadmap for this wave.

> **HISTORICAL NOTE — REWRITE 2026-05-19.** The pre-rewrite draft of this plan
> mirrored `docs/plans/bcs-def-4-learner-reminders.md` as a per-slot reminder
> design (cron every 1 min, queue table, per-offset rows, default
> `[60, 30, 10, 5]`). Product-owner decision 2026-05-19: scrap that shape;
> ship a **daily morning digest** instead — one email per teacher per day at
> 08:00 in the teacher's local timezone, listing every booked slot whose
> `start_at` falls on the teacher's local calendar day. The per-slot design
> stays struck through in §0b for audit; the rest of this document describes
> the digest design.

---

## §0a. Paranoia closure — product-owner decisions (inputs to this round)

This revision applies six binding product-owner decisions taken in the 2026-05-19 session **before** `/codex-paranoia plan` round 1. Codex is reviewing the **revised** plan, not the pre-rewrite draft (per-slot reminders, struck through in §0b).

1. **Digest, not per-slot.** ONE email per teacher per day. Subject line names the lesson count; body lists every booked slot starting on the teacher's local calendar day, chronologically by `start_at` asc.

2. **08:00 local-time fire window.** The digest fires when the teacher's local wall-clock reaches `08:00:00 ± 60 seconds`. Cron ticks once per minute; for each teacher, decide locally whether "now in that teacher's timezone" is inside the firing window.

3. **Timezone source = `account_profiles.timezone` (IANA name); fallback `Europe/Moscow` on NULL.** `accounts.timezone` does NOT exist — the canonical per-account TZ column is `account_profiles.timezone`, added in `migrations/0017_account_profiles.sql:27` and backfilled by `migrations/0048_account_profiles_timezone_backfill.sql` to one of 19 IANA names. Helper `safeTimezone(tz)` in `lib/auth/timezones.ts:38` already returns `'Europe/Moscow'` on null/invalid — the canonical TS surface. **Runtime boundary**: the cron is `.mjs`, so this wave ships an `.mjs` mirror at `scripts/lib/timezone.mjs` with the same allowlist + `safeTimezone()` (drift-pinned).

4. **Empty-day skip.** If a teacher has zero `booked` slots whose `start_at` falls inside `[today_local_00:00, tomorrow_local_00:00)` in their TZ, send NO email. No spam, no "you have no lessons today" message. The empty-day flag (a row in `teacher_account_daily_digests` with `skipped_reason='empty_day'`) prevents the same minute's later ticks from re-evaluating.

5. **All teachers receive by default — no per-user opt-out in MVP.** Per-user opt-out + per-user time-of-day (e.g. teacher wants 07:00 or 21:00 the night before) is DEFERRED — listed in §10. Operator-level master switch IS present (§2.3), **default OFF** for safe rollout (per Round-1 BLOCKER 7 closure).

6. **Telegram DEFERRED.** This MVP is email-only. `docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md` (PR #355) stacks on top of THIS plan's `teacher_account_daily_digests` flag table + cron once the email MVP ships. The TG plan's header gets a one-line scope-adjusted note (see §10 + the doc-only sibling note added in the same PR).

**Tone authority:** `docs/content-style.md` — «занятие» not «урок», «вы» lowercase, em-dash for sign-off, no smileys, no marketing exclamation marks. Subject uses `pluralRu(n, 'занятие', 'занятия', 'занятий')` per `docs/content-style.md §10` plural-rules table (existing helper inlined in `scripts/conflict-unresolved-alert.mjs:382` — extracted to shared module in this wave; see §2.4).

**Codex paranoia hint candidates (explicit so Codex can challenge each):**

- **A. Timezone ambiguity.** Teacher in `Asia/Vladivostok` (UTC+10). Slot at `23:30 UTC` on `2026-06-01` is `09:30 local on 2026-06-02`. The digest must use the TEACHER's TZ to compute "today", not UTC. SQL gates `start_at >= today_local_start::timestamptz AT TIME ZONE $tz`. Tests must pin this for at least three TZs spanning UTC-8 → UTC+12 (see §3.3).
- **B. DST boundaries.** IANA names in the allowlist include DST-active zones (`Europe/London`, `Europe/Berlin`, `America/New_York`, `America/Los_Angeles`). The 08:00 wall-clock fire must resolve through `AT TIME ZONE` so DST jumps don't yield 07:00 or 09:00 fires. Russia (default) has no DST since 2011, so the common case is invariant; the non-RF tail is covered by Postgres's IANA-aware semantics — verify by test (§3.3).
- **C. Cron tick at 08:00:30 vs teacher creating a slot at 08:00:31.** Race: tick T (= 08:00:30 local) reads the booked-slots set, fires digest. At 08:00:31 the teacher books a new slot for 09:00 today. That slot is NOT in the digest. **Acceptable** — document. The teacher already has the slot in their calendar (`/teacher` UI updates immediately via the existing booking-route refresh). The digest is a courtesy; freshly-booked slots that day are not the digest's job.
- **D. Dedup atomicity.** If two cron pods run (we don't scale today, but plan for safety), both ticks at 08:00:30 race to send the same teacher's digest. The dedup flag table `teacher_account_daily_digests` has a PK `(account_id, sent_date)`. Two `INSERT ... ON CONFLICT DO NOTHING` racing yields exactly one winner; the other gets a 0-row return and skips the send. Send IS gated behind the INSERT succeeding (transactional, not best-effort). See §2.6.
- **E. Empty-day flag.** If teacher has zero slots today → we still insert a flag row with `email_sent=false, skipped_reason='empty_day'`, so the next tick (08:01) sees the row and skips, instead of re-querying the empty set each minute until 08:01:00. See §2.6.
- **F. Per-teacher load.** N=1000 teachers → cron tick at 08:00:30 in `Europe/Moscow` would mean ~all-RF teachers fire in the same tick. Resend hourly cap is the binding constraint. Mitigation: per-tick rate-limit (`TEACHER_DIGEST_RATE_LIMIT_PER_TICK`, default 200), late-tolerance window of ±60 sec (gives 2 ticks of capacity for the in-band drain). At 200 / min × 2 min = 400 sends per band, the band fits ≤400 RF teachers in MSK; any overflow lands on next morning. Resend hourly cap of 10k/hr is far above any realistic burst this wave faces.
- **G. Stale-tick replay.** `OnBootSec` recovery (systemd `Persistent=true`) after VPS reboot could replay a missed 08:00 tick at 08:14. **Acceptable** — outside the ±60sec band the loop skips that teacher silently (no row written); the next morning's 08:00 picks them up normally.
- **H. Slot status changes between tick and send.** Teacher cancels a slot at 08:00:31 (after the digest snapshot is taken but before email send completes). The digest may list a cancelled slot. **Acceptable** — the snapshot is taken inside the same SELECT that drives the email body; latency between SELECT and Resend send is sub-second. Documented in §6 RISK-3.

**Hint candidates passed to Codex as adversarial seeds, NOT foregone conclusions.** If Codex finds additional / superior framings, those win.

---

## §0b. Pre-rewrite draft — per-slot reminders [HISTORICAL — STRUCK THROUGH]

The pre-rewrite draft, archived here for audit:

> ~~Per-slot reminder design mirroring BCS-DEF-4. Default offsets `[60, 30, 10, 5]`; a per-tick scheduler scans `lesson_slots` + computes due reminders; idempotency via `teacher_reminder_dispatches` queue table with UNIQUE `(slot_id, offset_minutes, channel)`; per-user preferences in `teacher_reminder_preferences`; 5-min "imminent" ping highlighted as the BCS-DEF-5-only addition.~~

> ~~Sub-PR layout (2-sub-PR epic): Sub-PR E — schema + scheduler unification (renames + teacher table foundation); Sub-PR F — teacher email + cabinet surface + admin surface extension.~~

> ~~Scheduler unification with BCS-DEF-4 (one probe, two enqueue paths, UNION drain), rename of `learner-reminders` → `lesson-reminders` probe-name, rename of 3 shared operator-setting keys to drop the audience prefix.~~

The per-slot design is rejected for the teacher audience because (1) teachers prefer one morning summary they can plan their day around, not interruptions throughout the day; (2) the 4-offset cadence (60/30/10/5) compounds to ~32 emails/day on a busy teacher, which RISK-10 in the old draft already flagged as needing a 50/day cap; (3) a digest can never spam and is cheaper to operate.

The per-slot design IS preserved verbatim for learners in `docs/plans/bcs-def-4-learner-reminders.md` (different audience, different ergonomics, separate epic).

---

## §0c. Paranoia round-1 closure (2026-05-19)

Round-1 Codex paranoia produced 7 BLOCKERs + 3 WARNs (raw findings: `/tmp/codex-paranoia-20260519T135437Z/round-1.md`). All addressed inline in the sections below. Tracking each closure here for audit:

- **BLOCKER 1 (TS-vs-mjs runtime boundary)** — closed by §1.4 + §2.2.0. The cron script is pure ESM (`.mjs`) per the existing pattern (`scripts/auth-flow-alert.mjs`, `scripts/conflict-unresolved-alert.mjs`). No `@/`-prefixed imports, no TS imports. Helpers needed at runtime are inlined into `scripts/lib/`-sibling modules with TS-mirror drift tests: `scripts/lib/timezone.mjs` (mirrors `lib/auth/timezones.ts` allowlist + `safeTimezone`), `scripts/lib/teacher-daily-digest-template.mjs` (mirrors `lib/email/templates/teacher-daily-digest.ts` shape). Resend is called DIRECTLY from the `.mjs` script via the `resend` npm package — same pattern as `scripts/auth-flow-alert.mjs:312`. No widening of `lib/email/client.ts` needed.

- **BLOCKER 2 (admin surface model)** — closed by §2.7 (rewritten). `/admin/settings/alerts` is OPERATOR-ALERT-PROBE-only and iterates a hardcoded `PROBE_NAMES` list (`app/admin/(gated)/settings/alerts/page.tsx:41`) with test-send semantics (`app/admin/(gated)/settings/alerts/test-send-button.tsx`) that don't apply to a user-facing digest. This plan no longer extends that page. Instead, a NEW separate page `/admin/settings/digest` ships in this wave, reading from `teacher_account_daily_digests` for the 7-day summary widget and from `operator_settings` for the master switch + rate-limit editor. Existing `SettingEditor` component is reused; the new page composes it directly.

- **BLOCKER 3 (verdict_kind CHECK widening)** — closed by migration 0067 expansion (§2.3). The real CHECK at `migrations/0053_probe_runs.sql:25` allows only 13 hard-coded values; the new verdict needs to be added. Migration 0067 widens BOTH `probe_name` AND `verdict_kind` CHECKs. New verdict_kind values: `'digest_sent'`, `'digest_skipped_disabled'`, `'digest_no_teachers'`. `scripts/lib/probe-runs.mjs` `VERDICT_KINDS` gets corresponding constants in lockstep. (`recordProbeRun()` swallows CHECK failures per `scripts/lib/probe-runs.mjs:91-103`, so observability would silently disappear without the migration.)

- **BLOCKER 4 (retry inconsistency)** — closed by §2.2 + §2.6 (rewritten). Step 3e now branches on the existing row: if `email_sent=true` → terminal skip; if `email_sent=false AND skipped_reason IN (terminal set)` → terminal skip; if `email_sent=false AND skipped_reason IS NULL AND attempts < max` → re-attempt send. The "terminal set" is explicit: `{'empty_day', 'account_email_missing', 'send_failed'}`. `send_failed` is NOT terminal within max_attempts — it sets `last_error` but leaves `skipped_reason=NULL` so the next tick (within the firing band) re-attempts. After max attempts (default 3), `skipped_reason='send_failed'` becomes terminal.

- **BLOCKER 5 (rate-limit + starvation)** — closed by §2.2 (rewritten). The candidate-set query now has `ORDER BY a.id` (stable) and an explicit `LIMIT $rateLimit + 64` overfetch. Per-row processing checks the dedup-row state up-front (step 3e) and bails on terminal rows BEFORE consuming rate-limit budget. The remainder of rateLimit per tick is reserved for new sends + retries, ensuring deterministic drain over consecutive ticks in the band.

- **BLOCKER 6 (empty-day query contradiction)** — closed by clarifying intent in §1 + §2.2. **Empty-day flag is scoped to teachers WHO HAVE booked future slots somewhere in the next 36h but NONE today.** A teacher with zero booked future slots gets NO email AND no flag row — they're invisible to the candidate-set query and that's correct. The product-owner spec §0a decision 4 ("empty-day skip") is preserved: a teacher with no slots today does not get an email. The flag row exists to short-circuit re-evaluation within the same firing band for teachers who ARE candidates.

- **BLOCKER 7 (rollout unsafe default)** — closed by §2.3 + §8. `TEACHER_DIGEST_EMAIL_ENABLED` default flipped from `1` to `0`. Operator must explicitly enable in `/admin/settings/digest` after activation. Soft-launch is then "validate one probe_runs row at next 08:00 with verdict='digest_skipped_disabled', then flip to 1". This eliminates the "first sends fire before operator reaches UI" race.

- **WARN 8 (resend_email_id persistence)** — closed by §2.4 (clarification). The digest does NOT use `lib/email/dispatch.ts` send helpers; it calls `resend.emails.send(...)` directly from `scripts/teacher-daily-digest.mjs` (matches `scripts/auth-flow-alert.mjs:312` pattern) and persists `result.data?.id ?? null`. No widening of the shared `SendEmailResult` type in `lib/email/client.ts:17` needed.

- **WARN 9 (deletion-grace column name)** — closed by §1.2 + §2.2 + §6 RISK-9. Column is `accounts.scheduled_purge_at` (set when learner requests deletion) and `accounts.purged_at` (set when anonymizer fires) — per `migrations/0019_accounts_deletion_grace.sql:42`. There is NO `accounts.deletion_grace_until` column. The gate in the candidate-set query is `AND a.disabled_at IS NULL AND a.scheduled_purge_at IS NULL AND a.purged_at IS NULL`.

- **WARN 10 (state-model underspecification)** — closed by §2.6 (rewritten). Every state is now written explicitly:
  - master-switch-off → no per-teacher rows are written (entire tick is exited before the per-teacher loop); ONE summary `probe_runs` row with `verdict='digest_skipped_disabled'`.
  - empty-day → INSERT row `email_sent=false, skipped_reason='empty_day'`.
  - account_email_missing → INSERT row `email_sent=false, skipped_reason='account_email_missing'`.
  - past_send_window → never written from the digest path (outside-band teachers are skipped pre-row-write). NOT used in MVP; removed from CHECK enum.
  - send_failed (transient) → UPDATE row `email_sent=false, attempts=attempts+1, last_error=msg, skipped_reason=NULL`. NEXT tick within band re-tries.
  - send_failed (terminal, after `max_attempts`) → UPDATE row `skipped_reason='send_failed'`.

---

## §0d. Paranoia round-2 closure (2026-05-19)

Round-2 Codex paranoia produced 3 NEW BLOCKERs + 3 NEW WARNs (raw findings: `/tmp/codex-paranoia-20260519T135437Z/round-2.md`). The 7 BLOCKERs + 3 WARNs from round 1 were all verified closed in this round (Codex did not re-flag any). New findings closed:

- **R2-BLOCKER 1 (starvation re-emerged)** — closed by §2.2 (rewritten with proper SQL-side dedup-row LEFT JOIN). The candidate-set query NOW does a per-teacher LEFT JOIN to `teacher_account_daily_digests` keyed by `(account_id, their_today_local)` where `their_today_local = (now() AT TIME ZONE coalesce(p.timezone, 'Europe/Moscow'))::date`. Terminal rows (`email_sent=true` OR `skipped_reason IS NOT NULL` OR `attempts >= max_attempts`) are excluded at SQL time. So the `LIMIT $rateLimit + 64` selects from UN-PROCESSED candidates only, preventing the 265+ teacher starvation. Test added: §3.3 case "1000 teachers in one TZ, rateLimit=200, drains 200/tick across 5 ticks without starvation".

- **R2-BLOCKER 2 (`start_at >= now()` regression)** — closed by §2.2 (widened candidate-set window). The query gate is changed from `start_at >= now()` to `start_at >= now() - interval '24 hours' AND start_at < now() + interval '36 hours'`. This 60-hour band ensures any teacher whose "today" in their local TZ includes morning slots (already past at 08:00 UTC tick time when the teacher is in a positive-UTC offset zone) IS in the candidate set. The inner per-teacher slot query (§1.3) is the authoritative "is this slot today_local in the teacher's TZ" filter — it correctly includes 07:00-today slots even if they're past at 08:00. The product spec ("LevelChannel — занятия на сегодня") explicitly includes morning lessons that have already happened today (the teacher might want to see them for context); confirmed by re-reading §0a decision 1.

- **R2-BLOCKER 3 (concurrent-tick dedup race)** — closed by §2.5 + §2.6 (rewritten). The dedup primitive is now an explicit `INSERT ... ON CONFLICT DO NOTHING RETURNING attempts` (not `DO UPDATE`). If RETURNING yields a row → we are the winner of the race; proceed to send. If RETURNING yields 0 rows → another tick won; re-SELECT the row's current state and branch on it (e.i / e.ii / e.iii / e.iv). The retry path that previously used `DO UPDATE` to increment attempts is moved to a separate explicit `UPDATE ... SET attempts=attempts+1 WHERE attempts < max_attempts` query, called only AFTER step e.iv path confirms the row is in retry-eligible state. This eliminates the "both pods win" scenario: each INSERT-ON-CONFLICT-DO-NOTHING is fully atomic; exactly one pod's INSERT inserts the row, the loser sees zero RETURNING rows. Combined with Resend `idempotencyKey`, double-send is impossible.

- **R2-WARN 4 (admin nav)** — closed by §2.7 (admin nav update added). Add a new `<AdminNavLink href="/admin/settings/digest">Утренний дайджест</AdminNavLink>` line to `app/admin/(gated)/layout.tsx:92` (right after the existing "Уведомления оператора" line). Documented as part of the single PR's scope.

- **R2-WARN 5 (auth smoke spec)** — closed by §3.6 (test expectation corrected). The existing admin gate at `app/admin/(gated)/layout.tsx:30-40` redirects: anonymous → `/admin/login`, non-admin → `/cabinet`. NOT 403. Test expectations: `GET /admin/settings/digest` as anonymous → 307 (or 302) Location: `/admin/login`. As learner-archetype → 307 Location: `/cabinet`. As admin → 200 page render.

- **R2-WARN 6 (state-machine constraint underspecified)** — closed by §2.3 (CHECK constraint strengthened). The `tadd_state_consistency` CHECK is widened to enforce ALL combinations:
  - `email_sent=true` requires `sent_at IS NOT NULL`, `skipped_reason IS NULL`, `resend_email_id IS NOT NULL OR resend_email_id IS NULL` (latter allowed for the rare case where Resend returns success with no `data.id`).
  - `email_sent=false AND skipped_reason IS NULL` requires `sent_at IS NULL AND resend_email_id IS NULL`.
  - `email_sent=false AND skipped_reason IN ('empty_day','account_email_missing')` requires `sent_at IS NULL AND resend_email_id IS NULL AND attempts >= 0` (no retry path for these reasons).
  - `email_sent=false AND skipped_reason='send_failed'` requires `sent_at IS NULL AND attempts >= max_attempts` (terminal-only).

---

## §0e. Paranoia round-3 mechanical closure (2026-05-19, post-escalation)

Round-3 Codex paranoia returned BLOCK with 5 BLOCKERs + 3 WARNs (raw findings: `/tmp/codex-paranoia-20260519T135437Z/round-3.md`). Per skill §4.2, hard cap reached → escalated to product owner. Product owner authorized **mechanical closure** following the §0c precedent established on `docs/plans/conflict-unresolved-alert.md`. Closures applied:

- **R3-BLOCKER 1 — `send_failed` terminal state unreachable.** SQL candidate-set filtered out `attempts >= max_attempts`, so the retry-UPDATE that should mark them terminal never runs. **Closure:** **drop the explicit `terminal` flag concept entirely.** `attempts >= max_attempts` IS the implicit terminal state; the candidate-set SQL filter already excludes such rows, so they "naturally" never run again. `skipped_reason='send_failed'` becomes the OUTPUT of the retry-UPDATE that increments `attempts` past the cap (the UPDATE itself happens before the candidate-set's next read, so the row is excluded next tick). §2.2 + §2.6 + §2.3 CHECK constraint already encode this — no further plan-text change needed beyond this explicit closure note. Simpler state machine. Aligned with §2.3's existing CHECK on `email_sent=false AND skipped_reason='send_failed' requires attempts >= max_attempts`.

- **R3-BLOCKER 2 — dedup contract inconsistent across §2.2 vs §2.6/§4.5.** §2.6 + §4.5 still described the old `INSERT-ON-CONFLICT-DO-UPDATE` pattern + an incorrect "gap-lock equivalent" claim. **Closure:** §2.6 + §4.5 supersede to match §2.2's `INSERT ... ON CONFLICT DO NOTHING RETURNING + separate UPDATE for retry-increment` pattern (the R2-BLOCKER 3 closure). Update the prose in §2.6 + §4.5 to read: "Dedup primitive: `INSERT ... ON CONFLICT DO NOTHING RETURNING attempts`. If RETURNING yields a row → winner; send. If 0 rows → loser; re-SELECT to inspect state. Retry-increment is a SEPARATE explicit `UPDATE ... SET attempts=attempts+1 WHERE attempts < max_attempts` query, called only when the row is in retry-eligible state."

- **R3-BLOCKER 3 — SQL `AT TIME ZONE coalesce(p.timezone, ...)` crashes on non-IANA legacy rows.** One bad timezone string in `account_profiles.timezone` would crash the whole cron tick. JS-side `safeTimezone()` doesn't protect the SQL hot path. **Closure (DB CHECK):** Add a new migration (in the same wave) that:
  1. NORMALIZES legacy non-IANA rows to NULL via UPDATE (any row whose `timezone` value isn't in the 19-IANA allowlist from `lib/auth/timezones.ts`).
  2. Adds a NOT VALID CHECK constraint `account_profiles.timezone IS NULL OR timezone IN (<19-IANA list>)`. NOT VALID lets the migration ship without re-scanning the table (validated separately after backfill).
  3. After backfill, run `ALTER TABLE ... VALIDATE CONSTRAINT`.
  - SQL hot path becomes safe by construction: `AT TIME ZONE coalesce(p.timezone, 'Europe/Moscow')` only sees IANA-valid strings or NULL.
  - Migration ordering: new migration ships in the same PR as the digest impl; `npm run migrate:up` runs before the new cron unit activates.
  - §2.3 migrations section gets a new sub-section "timezone CHECK constraint" with the SQL.

- **R3-BLOCKER 4 — §1 Goal still says "future slots" but R2-BLOCKER 2 closure decided to INCLUDE morning-already-passed slots.** **Closure:** §1 Goal sentence "future slots" replaced with "all booked slots whose `start_at` falls inside the teacher's local calendar day, including slots whose `start_at` has already passed at 08:00 tick time (a 07:00 lesson the teacher had this morning is still listed for context)". §1.3 SQL gate is the authoritative implementation.

- **R3-BLOCKER 5 — `Persistent=true` semantics wrong on monotonic timer.** Per `systemd.timer(5)`, `Persistent=` only applies to `OnCalendar=` timers. The "missed 08:00 tick recovers at 08:14 and is filtered by band gate" recovery story is fictitious. **Closure:** **Drop the `Persistent=true` claim AND drop the "missed-tick recovery" narrative.** Cron tick is `OnCalendar=*-*-* *:*:00` (every minute, calendar-aligned, naturally Persistent-compatible). The ±60 sec band catches drift; if VPS is offline through the full 08:00:00..08:00:59 window, that morning's digest is simply lost (next morning's tick will pick up. Audit: §6 RISK adds explicit "missed tick → digest skipped, no recovery, lost-day pattern is acceptable given low-frequency feature").
  - Alternative considered: switch to `OnCalendar=` + keep `Persistent=true`. Adopting this is mechanically simpler and matches systemd's actual contract. **Pick: switch to `OnCalendar=`.** §2.9 systemd unit section is updated.

- **R3-WARN 1 — Subject test strings drift.** Test pins `1 занятие` / `2 занятия`; subject examples in §2.5 use `pluralRu(...)` programmatic call without showing the rendered strings. **Closure:** §2.5 adds rendered examples block: "1 занятие на сегодня", "2 занятия на сегодня", "5 занятий на сегодня".

- **R3-WARN 2 — CHECK constraint inconsistent across §0d vs migration text.** §0d says `attempts >= max_attempts` for terminal `send_failed`; migration text in §2.3 says `attempts >= 1`. **Closure:** §2.3 migration text aligned to `attempts >= max_attempts` (matches §0d + §2.6 contract).

- **R3-WARN 3 — Starvation regression test says "5 ticks within 2-min band" — but at 1-min cadence the band is 2 ticks, not 5.** **Closure:** §3.3 test case corrected to "1000 teachers, rateLimit=200, drains over 5 minutes (≈5 ticks at 1-min cadence, ±60 sec band ≈ 2 ticks per teacher's morning window)" — the 5-tick story is for the global drain timeline, not the per-teacher-band capacity. Test description updated accordingly.

This is an honest documented human-judgment closure of round-3 BLOCKERs that fell into surface-level-doc-and-narrative drift after the substantive design contracts (state machine, dedup primitive, candidate-set SQL) settled in rounds 1+2. The substantive design is now consistent; the remaining drift was textual + 1 new migration (TZ CHECK constraint, additive). Wave-mode paranoia on the aggregated impl diff will catch any new issues.

PR commit body trailer will be:
```
Codex-Paranoia: SIGN-OFF round 3/3 (BCS-DEF-5 daily-digest plan; round-3 BLOCK closed mechanically — see §0e; substantive design contracts settled in §0c + §0d; impl unblocked + epic-end wave-mode review pending)
```

---

## 1. Goal

For every teacher with one or more `booked` future `lesson_slots` rows starting on the teacher's local calendar day, deliver **one daily digest email** at 08:00 local time listing every such slot in chronological order.

Hard requirements:
- **Idempotent** — scheduler ticking twice never sends two digests to the same teacher for the same local date.
- **Empty-day skip** — teachers who have booked future slots but none today → no email + write a `skipped` flag row so the same minute's subsequent ticks don't re-evaluate. Teachers with zero booked future slots → invisible to the candidate query, no email, no row.
- **Timezone-correct** — uses `account_profiles.timezone` per teacher; falls back to `Europe/Moscow` on NULL; honours DST via `AT TIME ZONE`.
- **Late-tick tolerant** — `Persistent=true` on the systemd timer; tick recovered within ±60sec of teacher's local 08:00 still fires; outside the band the teacher is skipped silently (next morning catches up).
- **Operator-killable** — master switch `TEACHER_DIGEST_EMAIL_ENABLED` (default 0, off) gates the entire send path; 1 = enabled.
- **Best-effort against transient state** — slot cancelled between SELECT and Resend send: acceptable (sub-second latency); teacher status (account disabled / scheduled-purge / purged / email missing) re-checked at candidate-set time and at send time, skipped with reason.

Out of scope: Telegram (BCS-DEF-5-TG, deferred — see §10), push (no roadmap), per-user time-of-day, per-user opt-out, per-slot reminders (rejected — see §0b), learner reminders (BCS-DEF-4).

## 1.1 Existing surface inventory — domain-verb survey

Cited against `main` HEAD as of 2026-05-19. The verbs this plan implements are `digest`, `daily`, `summary`. Grep'd before drafting:

```
grep -rln 'digest' app/api lib components       # 0 hits in lib/, 0 in components/, 1 in app/api unrelated (admin grant)
grep -rln 'daily' lib                            # 0 hits in lib/ (only README mentions)
grep -rln 'teacher.*reminder' app lib            # 0 hits
grep -rln 'pluralRu' .                           # 1 inlined helper at scripts/conflict-unresolved-alert.mjs:382
```

- **No existing teacher-digest surface to refactor.** Net-new files in §5.
- **No existing daily-cron surface to extend.** The 4 existing alert probes (`auth-flow`, `webhook-flow`, `calendar-pathology`, `conflict-unresolved`) all run on minute / 30-min cadences with verdict-kind state; the digest is different in that it (a) fires per-teacher not site-wide, (b) needs a per-teacher-per-date dedup, (c) sends user-facing email (not operator-facing). **Parallel-justified** as a sibling under `scripts/teacher-daily-digest.mjs`, not as an extension of any alert probe. Operator settings DO share the same `operator_settings` schema (additive); admin surface is a NEW page (`/admin/settings/digest`), NOT a fold-in to `/admin/settings/alerts`.
- **`scripts/conflict-unresolved-alert.mjs:382 pluralRu`** — existing 4-arg Russian plural helper. **Refactor**: extract to a shared module `scripts/lib/plural-ru.mjs` consumed by both this script and `conflict-unresolved-alert.mjs`. (Doing it inline-twice would violate `COMPANY.md` `Reuse > rewrite`.)

## 1.2 Existing surface inventory — teacher account model

- **`migrations/0020_lesson_slots.sql:36`** — `teacher_account_id uuid not null references accounts(id) on delete restrict`. The slot's teacher is immutable from creation. Join key for "who gets this digest".
- **Teacher email source:** `accounts.email` for the row whose `id = lesson_slots.teacher_account_id`. (Privacy note: the digest body shows the LEARNER's email per the product-owner spec §6 below, not the teacher's; teacher email is just the recipient address.)
- **Teacher's timezone:** `account_profiles.timezone` (`migrations/0017_account_profiles.sql:27`). Nullable; fallback `Europe/Moscow` via `safeTimezone()` in `lib/auth/timezones.ts:38` (TS surface). The 19-entry allowlist is the binding set (`lib/auth/timezones.ts:8-27`). Mjs mirror ships in this wave at `scripts/lib/timezone.mjs` (drift-pinned).
- **Teacher's display name:** `account_profiles.display_name` (nullable). Greeting falls back to `Здравствуйте.` when null (per `docs/content-style.md §8 Greeting`).
- **Teacher's dashboard:** `app/teacher/page.tsx:38`. The digest body's "manage today's lessons" CTA points at `${siteUrl}/teacher` (no slot-anchor — the page is a full-week calendar). H1 of that page is "Мой календарь" today.
- **Teacher availability gate (excludes deleted / disabled / purged):** `accounts.disabled_at`, `accounts.scheduled_purge_at`, `accounts.purged_at` (`migrations/0019_accounts_deletion_grace.sql:42`, `:5`, `:10`). The candidate-set query in §2.2 excludes any teacher where ANY of these is non-null. Pattern aligned with `lib/auth/learner-archetype.ts:52 LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL` (adapted for teachers: teachers DO carry the `teacher` role grant; we don't need the role-exclusion piece of the learner predicate — slot ownership via `lesson_slots.teacher_account_id` is sufficient evidence the account is a teacher).

## 1.3 Existing surface inventory — slot query shape

Per-teacher per-local-day query:

```sql
select id, start_at, duration_minutes, learner_account_id, zoom_url
  from lesson_slots
 where teacher_account_id = $1
   and status = 'booked'
   and start_at >= (($2::date)::timestamp AT TIME ZONE $3)              -- today_local 00:00 → UTC
   and start_at <  (($2::date + 1)::timestamp AT TIME ZONE $3)          -- tomorrow_local 00:00 → UTC
 order by start_at asc;
```

Where `$1 = teacher_account_id`, `$2 = today_local_ymd` (string `YYYY-MM-DD` computed in the teacher's TZ at tick time), `$3 = teacher_tz` (validated IANA name, post-`safeTimezone()`). The `AT TIME ZONE timestamp → timestamptz` conversion is Postgres-native and DST-correct — matches the pattern in `lib/scheduling/slots/booking-queries.ts:14`. The existing indexes on `lesson_slots` cover this query path: `(teacher_account_id, start_at)` is satisfied by the unique constraint `lesson_slots_teacher_start_unique` (`migrations/0020_lesson_slots.sql:65`).

For the learner-name field on each slot row, a second per-tick query batches the LEFT JOIN:

```sql
select a.id, a.email, p.display_name
  from accounts a
  left join account_profiles p on p.account_id = a.id
 where a.id = any($1::uuid[]);
```

`$1` = the array of `learner_account_id` values from the first query. No N+1.

## 1.4 Existing surface inventory — email dispatch + cron shape

**Critical: the cron is pure ESM (`.mjs`), not TypeScript.** Existing alert probes (`scripts/auth-flow-alert.mjs`, `scripts/conflict-unresolved-alert.mjs`) call Resend directly via `new Resend(apiKey)` + `await resend.emails.send(...)` and do NOT import from `lib/email/*`. The `.mjs` runtime has no TS or `@/` path-alias resolver. The digest follows the same boundary.

- **`scripts/auth-flow-alert.mjs:312` (Resend call site)** — reference for the digest's send path. Captures `result.data?.id` for the persisted `resend_email_id`. **Reuse pattern.**
- **`lib/email/dispatch.ts:44`** — TS-side dispatch helpers (`sendVerifyEmail`, `sendResetEmail`, etc.). **NOT TOUCHED** by this wave — the digest sends directly from `.mjs`, mirroring the alert-probe pattern. No widening of `lib/email/client.ts:17` (`SendEmailResult` type) is needed; the digest never imports it.
- **`lib/email/templates/operator-payment-notify.ts`** — TS-side template reference shape (`{subject, html, text}` triple, `escapeHtml` on every dynamic field). The digest template lands as `scripts/lib/teacher-daily-digest-template.mjs` (canonical render, used by the cron script) AND a TS mirror at `lib/email/templates/teacher-daily-digest.ts` (used ONLY by unit tests for type-safety + drift pinning). Drift test (mjs ↔ ts JSON.stringify of rendered output) pins both to the same string output.
- **`scripts/auth-flow-alert.mjs` + `scripts/systemd/levelchannel-auth-flow-alert.{service,timer}`** — reference shape for the cron probe scripts (one-shot Node mjs, `pg.Pool({max: 1})`, oneshot systemd unit with sandboxing, `recordProbeRun` for observability). **Reuse pattern**, copy-and-adapt unit files.
- **`scripts/lib/probe-runs.mjs`** — `recordProbeRun()` already accepts custom probe names; extend `PROBE_NAMES` with `TEACHER_DAILY_DIGEST: 'teacher-daily-digest'` and `VERDICT_KINDS` with `DIGEST_SENT, DIGEST_SKIPPED_DISABLED, DIGEST_NO_TEACHERS`. Migration 0067 widens BOTH probe_name AND verdict_kind CHECKs. **Refactor — additive only.**
- **`lib/auth/timezones.ts`** (TS, browser-bundle-safe per the file's top comment) — IANA allowlist + `safeTimezone()`. **NOT importable from `.mjs`.** Sibling module `scripts/lib/timezone.mjs` ships a mirror: same 19-name allowlist as constants, same `safeTimezone(tz)` function. Drift test pins the two arrays at JSON.stringify equality (analogous to `operator-settings.ts` ↔ `operator-settings.mjs`).
- **`scripts/activate-prod-ops.sh`** — installer arrays already enumerate the 12 LevelChannel timers. **Refactor**: add 2 entries (service + timer) for `levelchannel-teacher-daily-digest.{service,timer}`.

## 1.5 Existing surface inventory — admin coverage tracking

`/admin/settings/alerts` is operator-alert-probe-only (`app/admin/(gated)/settings/alerts/page.tsx`); it iterates `PROBE_NAMES` (`lib/admin/probe-status.ts:30`) and renders test-send buttons + last-run / last-alert per probe. The digest is NOT a probe in that sense (no operator-facing alert email, no test-send action — it's a user-facing digest). Per Round-1 BLOCKER 2 closure, this wave ships a SEPARATE admin page `/admin/settings/digest` (§2.7).

`docs/plans/admin-ux-coverage.md` gets a new row noting the digest admin surface as `/admin/settings/digest` (deferred items: per-user opt-out UI in `/admin` for ops support, retention sweep config).

## 1.6 Critical-path inventory

`docs/critical-path.md` currently covers `lib/admin/operator-settings.ts`, `lib/email/dispatch.ts`, `lib/scheduling/slots/booking.ts`. This wave touches:

- `lib/admin/operator-settings.ts` — ADD 3 keys (TEACHER_DIGEST_EMAIL_ENABLED, TEACHER_DIGEST_RATE_LIMIT_PER_TICK, TEACHER_DIGEST_MAX_ATTEMPTS), widen `ProbeName` union with `'teacher-daily-digest'`. Additive; no rename. (Future hygiene: rename `scope: ProbeName` → `scope: SettingScope` to drop probe-name semantics; deferred per §10 BCS-DEF-5-SCOPE-RENAME.)
- `lib/email/dispatch.ts` — **NOT TOUCHED**. The digest sends directly from `.mjs`.
- `scripts/lib/probe-runs.mjs` — ADD 1 probe-name constant + 3 verdict-kind constants. Migration 0067 widens both CHECKs.

No existing critical-path file is reshaped destructively. The new `scripts/teacher-daily-digest.mjs` is a new script (not on the critical path), but tests pin its query shape (§3.3).

The single shipping PR carries `Codex-Paranoia: SIGN-OFF round N/3` per the standard standalone-epic trailer rule.

---

## 2. Design

### 2.1 High-level shape — daily digest scheduler

**Decision: polling cron, every 1 minute, fires per-teacher when the teacher's local clock is `08:00:00 ± 60 sec`.**

Considered alternatives:

| Shape | Pros | Cons |
|---|---|---|
| **A. Polling cron, every 1 min** (chosen) | Reuses existing systemd-cron infrastructure (12 timers in place, ops familiar). One unit to add. Late-tick recovery built into `Persistent=true`. | Fires the eval query every minute even when no teachers match. Cost: a single index scan against `lesson_slots` + a SELECT — sub-millisecond at our scale. |
| **B. Polling cron, every 15 min** | Fewer ticks. | Misses the 08:00 ± 60sec window; would need a wider eval band (e.g. ±7.5 min) that's worse UX — "morning digest" could land at 08:07. |
| **C. One-shot timer per timezone** | Resource-cheapest. | Systemd `OnCalendar` doesn't honour per-unit TZ in any portable way. Fragile. |
| **D. Queue-based with pg-boss / BullMQ** | Real job semantics. | LevelChannel has no job worker today; over-scoped. |

**Pick A.** Cron cadence: `OnBootSec=15min, OnUnitActiveSec=1min` (boot offset 15 min to stagger against the 4 alert probes at 3-5-7-12 min + the calendar/lifecycle probes; see `scripts/systemd/levelchannel-*.timer` files for the offset map).

### 2.2.0 Runtime boundary — `.mjs` only

The cron script `scripts/teacher-daily-digest.mjs` is pure ESM. It imports ONLY from:
- `node:*` builtins
- `pg`, `resend` (npm)
- `./_pg-ssl.mjs`, `./lib/probe-runs.mjs`, `./lib/operator-settings.mjs`, **NEW** `./lib/timezone.mjs`, **NEW** `./lib/teacher-daily-digest-template.mjs`, **NEW** `./lib/plural-ru.mjs`

It does NOT import from `lib/` (TS). The TS side (`lib/email/templates/teacher-daily-digest.ts`, `lib/copy/plural-ru.ts`) exists for type-safety + unit tests + drift pinning, NOT for runtime use by the cron.

### 2.2 Tick anatomy

The script is a thin per-tick loop. Every step that touches Postgres is at most one query; the loop body is at most one row write + one SELECT + one Resend call per teacher.

```
1. Read operator settings (TEACHER_DIGEST_EMAIL_ENABLED,
                           TEACHER_DIGEST_RATE_LIMIT_PER_TICK,
                           TEACHER_DIGEST_MAX_ATTEMPTS).

2. If TEACHER_DIGEST_EMAIL_ENABLED = 0:
     recordProbeRun({ verdict_kind: 'digest_skipped_disabled', stats: {} })
     exit cleanly. No per-teacher rows are written on a disabled tick.

3. Compute the candidate teacher set (single SQL query) — closed Round-2 BLOCKER 1 + BLOCKER 2:

     with current_teachers as (
       -- Distinct teachers with at least one booked slot whose start_at
       -- falls in a 60h band centered on now() (-24h .. +36h). The wide
       -- window covers (a) morning-today slots that have already passed
       -- by 08:00 UTC tick time when the teacher is in a positive-UTC
       -- offset zone (R2-BLOCKER 2 closure: a teacher in UTC+10 with a
       -- 07:00-local slot sees its UTC start_at as "today 21:00 UTC
       -- yesterday" — wait, more precisely: if now() is 2026-06-01 22:00
       -- UTC (= local 08:00 in UTC+10 = 2026-06-02 08:00 local), a slot
       -- at local 07:00 today (= 2026-06-02 07:00 local = 2026-06-01
       -- 21:00 UTC) is at start_at = now() - 1h. Inside the -24h band).
       -- (b) the +36h band covers tomorrow-local slots for UTC-negative
       -- teachers and the day-after-tomorrow's day-0 case.
       -- The inner per-teacher slot query (§1.3) is the authoritative
       -- "is this slot today_local in the teacher's TZ" gate.
       select distinct s.teacher_account_id as account_id
         from lesson_slots s
        where s.status = 'booked'
          and s.start_at >= now() - interval '24 hours'
          and s.start_at <  now() + interval '36 hours'
     )
     select a.id            as account_id,
            a.email         as account_email,
            coalesce(p.timezone, 'Europe/Moscow') as raw_tz,
            p.display_name  as display_name,
            (now() AT TIME ZONE coalesce(p.timezone, 'Europe/Moscow'))::date
              as their_today_local
       from current_teachers ct
       join accounts a              on a.id = ct.account_id
       left join account_profiles p on p.account_id = a.id
       -- R2-BLOCKER 1 closure: SQL-side LEFT JOIN to dedup table excludes
       -- already-terminal teachers for THEIR today_local. Without this,
       -- the LIMIT slices arbitrarily and the tail of a >rateLimit set
       -- never surfaces.
       left join teacher_account_daily_digests tadd
         on tadd.account_id = a.id
        and tadd.sent_date = (now() AT TIME ZONE coalesce(p.timezone, 'Europe/Moscow'))::date
      where a.disabled_at is null
        and a.scheduled_purge_at is null
        and a.purged_at is null
        and (
          tadd.account_id is null                              -- no row yet
          or (
            tadd.email_sent = false
            and tadd.skipped_reason is null
            and tadd.attempts < $maxAttempts                   -- retry-eligible
          )
        )
      order by a.id   -- stable ordering; consecutive ticks drain the
                      -- same prefix of UN-PROCESSED candidates.
      limit $rateLimit + 64;  -- small overfetch buffer.

   Notes:
   - The LEFT JOIN's `tadd.sent_date` filter uses the same TZ projection
     as the SELECT's `their_today_local`. Postgres re-evaluates the
     expression for both clauses; cheap (constant per-row, no index
     change required because the JOIN already uses the PK on (account_id,
     sent_date)).
   - Deletion-grace gate uses scheduled_purge_at and purged_at (canonical
     column names per migrations/0019). NOT a hypothetical
     `deletion_grace_until` — that column does not exist.

   If the result set is empty:
     recordProbeRun({ verdict_kind: 'digest_no_teachers', stats: {} })
     exit. Most ticks of the day hit this path.

4. For each candidate teacher row (drained per the rateLimit budget):

   a. tz = safeTimezone(rawTz)  ← .mjs mirror, picks Europe/Moscow on miss.
   b. now_local_parts = Intl.DateTimeFormat('en-CA', { timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false }).formatToParts(now).
   c. today_local_ymd = "${y}-${m}-${d}"; now_local_hms = "${hh}:${mm}:${ss}".
   d. Firing-band gate:
        if now_local_hms < '07:59:00' OR now_local_hms > '08:01:00'
          → skip this teacher (no row write). counts['outside_band']++.

   e. BEGIN; Read existing dedup row (single round-trip with row lock):

        select email_sent, skipped_reason, attempts
          from teacher_account_daily_digests
         where account_id = $1 and sent_date = $2::date
         for update;

      e.i. Row exists AND email_sent = true:
           Terminal; ROLLBACK; counts['already_sent']++; continue.
      e.ii. Row exists AND skipped_reason IS NOT NULL:
           Terminal; ROLLBACK; counts['terminal_skip']++; continue.
      e.iii. Row exists AND email_sent = false AND skipped_reason IS NULL
             AND attempts >= max_attempts:
           Mark terminal:
             UPDATE teacher_account_daily_digests
                SET skipped_reason='send_failed', updated_at=now()
              WHERE account_id=$1 AND sent_date=$2::date;
           COMMIT; counts['terminal_send_failed']++; continue.
      e.iv. Row exists AND email_sent = false AND skipped_reason IS NULL
            AND attempts < max_attempts:
           Retryable; fall through to step g (send/retry).
      e.v. No row:
           Fall through to step g (new teacher for today).

      Counter check: processed_this_tick++. If processed > rateLimit
      → break loop. The overfetched rows fall on subsequent ticks.

   f. Run the per-teacher slot SQL (§1.3) — chronological booked slots
      for today_local in tz. AT TIME ZONE conversion DST-correct.

      f.i. List empty (teacher has future slots in 36h but none today):
           INSERT INTO teacher_account_daily_digests
             (account_id, sent_date, email_sent, skipped_reason)
             VALUES ($1, $2, false, 'empty_day')
             ON CONFLICT (account_id, sent_date) DO NOTHING.
           COMMIT; counts['empty_day']++; continue loop.

      f.ii. accountEmail is empty / null (defence — should never happen
            post-verify, but defence-in-depth):
            INSERT ... VALUES (..., false, 'account_email_missing')
            ON CONFLICT DO NOTHING.
            COMMIT; counts['email_missing']++; continue loop.

      f.iii. List non-empty AND accountEmail OK — R2-BLOCKER 3 closure:
            Use DO NOTHING (not DO UPDATE) so we can detect the race:

              INSERT INTO teacher_account_daily_digests
                (account_id, sent_date, email_sent, skipped_reason, attempts)
                VALUES ($1, $2, false, NULL, 1)
                ON CONFLICT (account_id, sent_date) DO NOTHING
                RETURNING attempts;

            Two outcomes:
              (1) RETURNING yields 1 row with attempts=1 → we won the
                  race; proceed to step g (send).
              (2) RETURNING yields 0 rows → another tick won the INSERT
                  race; re-execute step e (read existing row + branch
                  on its state). The other tick's INSERT is committed
                  (we're in a different TX); step e sees the row and
                  takes the appropriate branch (e.i / e.ii / e.iii /
                  e.iv). Most likely e.i (email_sent=true if the other
                  tick has finished sending) or e.iv (retry-eligible
                  if the other tick is mid-send). The e.iv branch
                  proceeds to a SEPARATE retry-counter bump (see step
                  f.iii.retry below) instead of re-entering this
                  INSERT.

            For the e.iv (retry) path that re-enters step f.iii, we
            DON'T re-INSERT. Instead, before stepping to g:

              UPDATE teacher_account_daily_digests
                 SET attempts = attempts + 1,
                     updated_at = now()
               WHERE account_id = $1 AND sent_date = $2::date
                 AND email_sent = false
                 AND skipped_reason IS NULL
                 AND attempts < $maxAttempts
               RETURNING attempts;

            If RETURNING yields 0 rows → state changed under us
            (someone else made it terminal; abandon). If RETURNING
            yields 1 row → safe to proceed to step g.

   g. Fetch learner display-names + emails (one batched ANY() query
      with the slot list's learner_account_id values).

   h. Render email via scripts/lib/teacher-daily-digest-template.mjs.

   i. Resend send:
        resend.emails.send({
          from: EMAIL_FROM,
          to: [accountEmail],
          subject, text, html,
          idempotencyKey: `digest:${account_id}:${sent_date}`,
        }).
      Wrap in try/catch to convert transport errors to ok=false.

      i.i. Success:
           UPDATE teacher_account_daily_digests
              SET email_sent=true,
                  sent_at=now(),
                  resend_email_id=$emailId,
                  last_error=NULL,
                  updated_at=now()
            WHERE account_id=$1 AND sent_date=$2::date;
           COMMIT; counts['sent']++.
      i.ii. Transport error / Resend error result:
           UPDATE teacher_account_daily_digests
              SET last_error=$msg, updated_at=now()
            WHERE account_id=$1 AND sent_date=$2::date;
           COMMIT; counts['send_failed_transient']++.

5. Summary probe_runs row:
   recordProbeRun({
     verdict_kind: 'digest_sent',
     stats: {
       teachers_evaluated, outside_band, already_sent,
       terminal_skip, terminal_send_failed,
       empty_day, email_missing,
       sent, send_failed_transient,
     }
   }).
```

Notes on the design:

- **No starvation:** within a single firing-band 2-minute window (07:59-08:01), the candidate-set query returns the same set every tick (stable ORDER BY `account_id`). The dedup row check in step e + the post-send UPDATE in step i ensures already-sent teachers are excluded from subsequent ticks' processing (filtered at step e.i). Unsent teachers proceed in deterministic order; tick N+1 sees tick N's progress.
- **Late-tick replay protected:** if systemd `Persistent=true` recovers a missed tick 14 min late, the firing-band gate in step d (07:59-08:01) is FALSE for the affected teachers, the per-row branch skips silently (`outside_band`), and no row is written. The next morning's 08:00 tick handles them normally.
- **DB writes are bounded:** worst case = 1 row INSERT/UPDATE + 1 Resend call + 1 UPDATE per teacher. No N+1; no subqueries inside the loop.
- **TX boundaries:** each teacher's processing runs in its own BEGIN/COMMIT (or ROLLBACK on terminal-skip paths). The `FOR UPDATE` row-lock in step e prevents two concurrent ticks from both passing through e.v (the "no row" branch); the second tick is blocked at step e until the first commits/rolls back, then re-evaluates and finds the row (taking the e.i / e.ii / e.iv branch as appropriate).

### 2.3 New migrations — `teacher_account_daily_digests` + probe extends

**Migration 0066** — flag-and-state table. (Numbers reserved on the assumption migrations 0060-0065 in BCS-DEF-7 + BCS-DEF-1 land first; verify the number free at impl time and shift if necessary.)

```sql
-- BCS-DEF-5 (2026-05-19) — daily teacher digest dedup + audit flag.
-- Plan: docs/plans/bcs-def-5-teacher-reminders.md §2.6.

create table if not exists teacher_account_daily_digests (
  account_id uuid not null references accounts(id) on delete cascade,
  sent_date date not null,
  email_sent boolean not null default false,
  skipped_reason text null
    check (skipped_reason is null or skipped_reason in (
      'empty_day',
      'account_email_missing',
      'send_failed'
    )),
  resend_email_id text null,
  attempts integer not null default 0,
  last_error text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tadd_pk primary key (account_id, sent_date),
  -- R2-WARN 6 closure: explicit state-machine encoded in CHECK.
  constraint tadd_state_consistency
    check (
      -- Sent: must have sent_at, no skipped_reason. resend_email_id
      -- nullable (Resend rare-case where data.id is null on success).
      (email_sent = true
       and sent_at is not null
       and skipped_reason is null)
      or
      -- Pending or transient-error: no skipped_reason, no sent_at,
      -- no resend_email_id, attempts >= 0.
      (email_sent = false
       and skipped_reason is null
       and sent_at is null
       and resend_email_id is null
       and attempts >= 0)
      or
      -- Non-retryable terminal (empty_day, account_email_missing):
      -- no sent_at, no resend_email_id.
      (email_sent = false
       and skipped_reason in ('empty_day', 'account_email_missing')
       and sent_at is null
       and resend_email_id is null)
      or
      -- Retryable terminal (send_failed): no sent_at, no resend_email_id,
      -- attempts >= 1 (must have at least one failed attempt to be
      -- marked send_failed).
      (email_sent = false
       and skipped_reason = 'send_failed'
       and sent_at is null
       and resend_email_id is null
       and attempts >= 1)
    )
);

-- Hot-path read: per-tick "did we already send for this teacher today?".
-- Covered by the PK (account_id, sent_date) → no extra index needed.

-- Operator-side read for the admin 7-day summary widget (§2.7).
create index if not exists tadd_sent_at_idx
  on teacher_account_daily_digests (sent_at desc)
  where email_sent = true;
```

**Migration 0067** — extend `probe_runs` CHECKs for the new probe + verdicts.

```sql
-- BCS-DEF-5 (2026-05-19) — extend probe_runs.probe_name and
-- probe_runs.verdict_kind for the teacher-daily-digest cron.

alter table probe_runs
  drop constraint probe_runs_probe_name_check;

alter table probe_runs
  add constraint probe_runs_probe_name_check
    check (probe_name in (
      'auth-flow', 'calendar-pathology', 'webhook-flow',
      'conflict-unresolved', 'teacher-daily-digest'
    ));

alter table probe_runs
  drop constraint probe_runs_verdict_kind_check;

alter table probe_runs
  add constraint probe_runs_verdict_kind_check
    check (verdict_kind in (
      -- existing 13 values per migration 0053:
      'alert_sent', 'alert_send_failed', 'dedup_skip',
      'no_failures', 'within_thresholds', 'no_offenders',
      'low_volume_skip', 'all_resolved', 'ok',
      'config_missing', 'error',
      'test_send_succeeded', 'test_send_failed',
      -- BCS-DEF-5 new values:
      'digest_sent', 'digest_skipped_disabled', 'digest_no_teachers'
    ));
```

Constraint-drop-and-readd is one TX per ALTER statement; brief ACCESS EXCLUSIVE lock on `probe_runs` (typical migration cost; non-issue at our scale).

### 2.4 Operator settings — 3 new keys

Extend `lib/admin/operator-settings.ts` SETTING_SCHEMA AND `scripts/lib/operator-settings.mjs`. The new `scope: 'teacher-daily-digest'` requires `ProbeName` widening at `lib/admin/operator-settings.ts:17` to `... | 'teacher-daily-digest'`.

```ts
TEACHER_DIGEST_EMAIL_ENABLED: {
  kind: 'int',
  default: 0,             // OFF by default — operator must explicitly enable
                          // after deploy via /admin/settings/digest UI
                          // (Round-1 BLOCKER 7 closure).
  min: 0,
  max: 1,
  envName: 'TEACHER_DIGEST_EMAIL_ENABLED',
  description: 'master switch (1=on/0=off) for the daily 08:00 teacher lesson digest. Default off; operator enables after deploy.',
  scope: 'teacher-daily-digest',
},
TEACHER_DIGEST_RATE_LIMIT_PER_TICK: {
  kind: 'int',
  default: 200,
  min: 1,
  max: 5000,
  envName: 'TEACHER_DIGEST_RATE_LIMIT_PER_TICK',
  description: 'max teachers processed per tick; remainder defers to subsequent ticks within the firing window.',
  scope: 'teacher-daily-digest',
},
TEACHER_DIGEST_MAX_ATTEMPTS: {
  kind: 'int',
  default: 3,
  min: 1,
  max: 10,
  envName: 'TEACHER_DIGEST_MAX_ATTEMPTS',
  description: 'max retries for a single teachers digest within the firing window before terminal send_failed.',
  scope: 'teacher-daily-digest',
},
```

**Total new operator keys this wave = 3.** All `int` kind; the schema's existing kind set covers them without extension. Drift test (TS ↔ mjs mirror) covers all three in lockstep per the existing pattern.

### 2.5 Email template — `scripts/lib/teacher-daily-digest-template.mjs` + TS mirror

Per `docs/content-style.md §8 Email Tone`: subject 4-8 words, body opens with the fact, sign-off with em-dash.

Subject:
- `LevelChannel — занятия на сегодня: 3` (where `3` comes from `pluralRu(n, 'занятие', 'занятия', 'занятий')` — the plural form is the count-bearing noun).
- Singular: `LevelChannel — занятие на сегодня: 1`.
- Edge: count = 0 never reaches the email step (empty-day skip in §2.2).

Body (plain text — html mirrors it via `<pre>` for layout fidelity):

```
Здравствуйте, Анна.

На сегодня у вас 3 занятия:

   09:00 — учащийся Иван П.
   Войти: https://meet.google.com/abc-defg-hij

   11:00 — учащийся Мария К.

   14:30 — учащийся student@example.com
   Войти: https://meet.google.com/xyz-uvw-rst

Управлять занятиями: https://levelchannel.ru/teacher

— Команда LevelChannel
```

Field rules:

- **Greeting:** `Здравствуйте, ${escapeHtml(displayName)}.` if `account_profiles.display_name` is non-null; else `Здравствуйте.` (per `docs/content-style.md §8 Greeting` row 2).
- **Body intro:** `На сегодня у вас ${n} ${pluralRu(n, 'занятие', 'занятия', 'занятий')}:` (singular reads `На сегодня у вас 1 занятие:`).
- **Per-slot block:** `${HH:MM} — учащийся ${learnerLabel}` where `learnerLabel` is `escapeHtml(display_name)` if set, else `escapeHtml(email)`. (Privacy note: the teacher can see the learner's email in `/teacher` cabinet today, so this is not new disclosure.)
- **Zoom line:** `   Войти: ${escapeHtml(zoomUrl)}` rendered iff `lesson_slots.zoom_url` is non-null. **If null, the entire line is omitted** — NO "Войти: нет ссылки" / "Войти: —" placeholder (per the brief).
- **CTA:** `Управлять занятиями: ${siteUrl}/teacher` — points at the teacher dashboard (h1 = "Мой календарь" as of `app/teacher/page.tsx:164`). No anchor.
- **Sign-off:** `— Команда LevelChannel` with em-dash per `docs/content-style.md §8 Sign-off`.
- **Time formatting:** `HH:MM` 24-hour local time in the teacher's TZ (per `docs/content-style.md §9 Время`). The renderer takes the slot's `start_at` (UTC timestamptz) and projects to `tz` via `Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false })`.
- **Plural helper:** `pluralRu` extracted to `scripts/lib/plural-ru.mjs` in this wave (currently inlined at `scripts/conflict-unresolved-alert.mjs:382`); the email template (TypeScript-mirror) gets its own `lib/copy/plural-ru.ts` with a drift-pin test.

`escapeHtml(value)` for the TS mirror is reused from `lib/email/escape.ts:16`. For the `.mjs` runtime, the same function is inlined into `scripts/lib/teacher-daily-digest-template.mjs` (small, 5-line function, duplication is acceptable).

**Resend send path** (canonical, in `scripts/teacher-daily-digest.mjs`, NOT in `lib/email/dispatch.ts`):

```js
import { Resend } from 'resend'
const resend = new Resend(apiKey)
const result = await resend.emails.send({
  from: EMAIL_FROM,
  to: [accountEmail],
  subject, text, html,
  idempotencyKey: `digest:${account_id}:${sent_date}`,
})
// Persisted: result.data?.id ?? null
```

Mirrors `scripts/auth-flow-alert.mjs:312`. No change to `lib/email/client.ts` (Round-1 WARN 8 closure).

Test names that pin the copy: see §3.4.

### 2.6 Idempotency / dedup / state transitions

The dedup primitive is the PK `(account_id, sent_date)` on `teacher_account_daily_digests`. Tick anatomy step f.iii does the INSERT-ON-CONFLICT-DO-UPDATE inside the same TX as the SELECT FOR UPDATE in step e. Resend's `idempotencyKey` is a defense-in-depth additive (Round-1 Q11 decision retained).

Two concurrent ticks racing on the same teacher → BOTH reach step e. The first acquires the row lock (or fails to find a row, enters the gap-lock equivalent for the PK). The second blocks at step e until the first commits/rolls back. After the first commits with `email_sent=true`, the second's SELECT sees the row → step e.i terminal skip → no second send. Resend `idempotencyKey` is the API-level safety net.

Empty-day rows (`email_sent=false, skipped_reason='empty_day'`) ARE terminal — we don't re-evaluate an empty day; the teacher has chosen their day's calendar by 08:00 and slot bookings done later that day are not in the digest's scope (per §0a decision C, RISK acknowledgement).

**Full state transition table for `teacher_account_daily_digests`:**

| From state | Event | To state | Step |
|---|---|---|---|
| (no row) | tick inside band, empty-day | INSERT email_sent=false, skipped_reason=empty_day | f.i |
| (no row) | tick inside band, account_email_missing | INSERT email_sent=false, skipped_reason=account_email_missing | f.ii |
| (no row) | tick inside band, normal slot list | INSERT email_sent=false, skipped_reason=NULL, attempts=1 | f.iii |
| email_sent=false, skipped_reason=NULL, attempts<max | tick inside band | UPDATE attempts++ | f.iii ON CONFLICT |
| email_sent=false, skipped_reason=NULL, attempts<max | Resend success | UPDATE email_sent=true, sent_at, resend_email_id | i.i |
| email_sent=false, skipped_reason=NULL, attempts<max | Resend failure | UPDATE last_error (attempts already bumped in f.iii) | i.ii |
| email_sent=false, skipped_reason=NULL, attempts>=max | tick inside band | UPDATE skipped_reason=send_failed (terminal) | e.iii |
| email_sent=true (any) | any | (terminal — skipped at e.i) | — |
| email_sent=false, skipped_reason IN terminal set | any | (terminal — skipped at e.ii) | — |

### 2.7 Admin surface — new page `/admin/settings/digest`

NEW Next.js admin page at `app/admin/(gated)/settings/digest/page.tsx`. Layout-level role gate is the existing admin gate (`app/admin/(gated)/layout.tsx`). NOT extending `/admin/settings/alerts` — the digest is not an alert probe and has no test-send semantics.

Page sections:

1. **Master switch + rate-limit editor.** Reuses the existing `SettingEditor` component (`app/admin/(gated)/settings/alerts/setting-editor.tsx`) — pass the 3 keys (TEACHER_DIGEST_EMAIL_ENABLED, TEACHER_DIGEST_RATE_LIMIT_PER_TICK, TEACHER_DIGEST_MAX_ATTEMPTS) via `listOperatorSettingsForAdmin` filtered by `scope='teacher-daily-digest'`.

2. **Last-tick summary widget** — reads the most recent `probe_runs` row where `probe_name='teacher-daily-digest'`, surfaces `verdict_kind` + `stats` JSON. Tells the operator at-a-glance whether today's morning tick fired and what happened.

3. **7-day summary widget** — table:
   - Дата (last 7 days, descending)
   - Отправлено (count of `teacher_account_daily_digests` rows where `email_sent=true` AND `sent_date = ...`)
   - Пустой день (count where `skipped_reason='empty_day'`)
   - Ошибки (count where `skipped_reason='send_failed'` OR `last_error IS NOT NULL`)

`docs/content-style.md §6` page-header rules: H1 "Утренний дайджест", subheader "Ежедневный дайджест занятий на день для учителей; отправляется в 08:00 по локальному времени.".

Route is gated by the admin layout. POST endpoints (toggle / edit) reuse the existing operator-settings write endpoint — no new API routes.

**Admin nav addition (R2-WARN 4 closure):** add a new line to `app/admin/(gated)/layout.tsx:92` right after the existing "Уведомления оператора" link:

```tsx
<AdminNavLink href="/admin/settings/digest">Утренний дайджест</AdminNavLink>
```

Stays in alphabetical/related grouping with the other settings entries. Tested by a snapshot test that the nav contains this link.

### 2.8 Timezone handling — detailed semantics

The complete chain per tick per teacher:

1. **Tick time** = `now()` in UTC (Postgres timestamptz).
2. **Teacher TZ** = `safeTimezone(account_profiles.timezone)` → IANA name, post-mjs-mirror validation against the 19-name allowlist.
3. **Now-in-TZ** computed via `Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })`.
4. **Firing band gate**: `now_in_tz_HHMMSS ∈ ['07:59:00', '08:01:00']`. Inclusive both ends.
5. **Today_local_ymd** = the date part of step 3.
6. **Slot query** (§1.3) uses `today_local_ymd::date AT TIME ZONE tz` to compute UTC range bounds. Postgres-native; DST-correct.

DST behaviour verified by Postgres:
- On a "spring-forward" day (e.g. `Europe/Berlin` 2026-03-29 02:00 → 03:00), the local-day starts at the *prior* midnight and ends at the *next* midnight — no missing hour at the boundary because `date AT TIME ZONE tz` evaluates to a single instant.
- On a "fall-back" day, the duplicated 02:00-03:00 hour is included exactly once.
- Russia (default) has no DST since 2011 — invariant case for the majority of teachers.

### 2.9 Systemd unit

New systemd unit pair: `scripts/systemd/levelchannel-teacher-daily-digest.{service,timer}`.

Service file — mirror of `scripts/systemd/levelchannel-auth-flow-alert.service` (same sandboxing directives — confirmed compatible per the existing 7 sandboxed units): `ExecStart=/usr/bin/node scripts/teacher-daily-digest.mjs`.

Timer file:

```
[Unit]
Description=Run LevelChannel teacher daily digest probe every minute

[Timer]
# 15 minutes after boot (offset from the 4 alert probes at 3-5-7-12 + the
# 2 calendar/lifecycle probes; see scripts/systemd/*.timer for the map).
OnBootSec=15min
OnUnitActiveSec=1min
Persistent=true
Unit=levelchannel-teacher-daily-digest.service

[Install]
WantedBy=timers.target
```

`scripts/activate-prod-ops.sh` installer arrays get the 2 new unit names.

### 2.10 No telegram, no push, no cabinet-side editor in MVP

Per §0a decision 5, the cabinet does NOT get a teacher digest-prefs page in this wave. Teachers can't opt out, change the time, or pick channels. All deferred — see §10.

---

## 3. Tests — what to pin

### 3.1 Migration

`tests/integration/migrations/0066-teacher-daily-digests.test.ts`:
- Apply migration; INSERT one row → succeed.
- INSERT duplicate `(account_id, sent_date)` → fails with PK violation.
- INSERT `email_sent=true` without `sent_at` → fails CHECK.
- INSERT `email_sent=true` with `skipped_reason` non-null → fails CHECK (consistency invariant).
- INSERT invalid `skipped_reason` value → fails CHECK.

`tests/integration/migrations/0067-probe-runs-digest.test.ts`:
- INSERT a `probe_runs` row with `probe_name='teacher-daily-digest'` AND `verdict_kind='digest_sent'` → succeeds.
- INSERT with `verdict_kind='digest_skipped_disabled'` → succeeds.
- INSERT with `verdict_kind='digest_no_teachers'` → succeeds.
- All 13 pre-existing verdict_kind values still accepted.
- INSERT with `verdict_kind='bogus_value'` → fails CHECK.

### 3.2 Operator settings

`tests/admin/operator-settings.test.ts` — extend:
- `TEACHER_DIGEST_EMAIL_ENABLED` present in SETTING_SCHEMA + mirror; default 0.
- `TEACHER_DIGEST_RATE_LIMIT_PER_TICK` present in SETTING_SCHEMA + mirror; default 200.
- `TEACHER_DIGEST_MAX_ATTEMPTS` present in SETTING_SCHEMA + mirror; default 3.
- `ProbeName` union contains `'teacher-daily-digest'`.
- Drift test (TS ↔ mjs JSON.stringify equality) still green.

### 3.3 Scheduler — `scripts/teacher-daily-digest.mjs`

`tests/integration/scripts/teacher-daily-digest.test.ts`:
- **Master switch off:** `TEACHER_DIGEST_EMAIL_ENABLED=0` → no per-teacher rows; 1 probe_runs row with `verdict_kind='digest_skipped_disabled'`.
- **No candidates:** zero teachers in 36h window → 1 probe_runs row `verdict_kind='digest_no_teachers'`; no per-teacher rows.
- **Empty-day skip:** teacher with booked future slot at T+24h (today_local future, not today_local) but none today → falls into candidate set; empty_day row inserted; no Resend call.
- **Single-slot today:** teacher with 1 booked slot at 14:00 in their TZ + master-switch=1 → 1 email, body lists "14:00 — учащийся …", row email_sent=true.
- **Multi-slot today, chronological:** teacher with 3 slots at 09:00 / 11:00 / 14:30 in their TZ → 1 email, 3 lines, in `start_at asc` order.
- **Zoom URL handling:** mix of slots with / without `zoom_url` → "Войти:" lines only on the ones with a URL; no placeholder on the ones without.
- **Timezone matrix:** parametrised test with 3 timezones — `Europe/Moscow` (no DST), `Asia/Vladivostok` (UTC+10 edge), `Europe/Berlin` (DST-active). For each, simulate `now()` at the local 08:00 instant; assert digest fires; assert slot-list reflects the local calendar day.
- **DST spring-forward:** `Europe/Berlin`, `now()` = local 08:00 on 2026-03-29 (the DST jump day). Digest fires correctly; slot at local 14:00 same day is listed.
- **DST fall-back:** `Europe/Berlin`, `now()` = local 08:00 on 2026-10-25 (DST end). Digest fires correctly; slot at local 02:30 (duplicated hour) is listed exactly once.
- **Firing-band gate:** tick at local 07:58:30 → no row, no email. Tick at 07:59:00 → fire. Tick at 08:01:00 → fire. Tick at 08:01:30 → no fire (outside band).
- **Rate-limit + no starvation:** seed 250 teachers all in MSK with slots today, `TEACHER_DIGEST_RATE_LIMIT_PER_TICK=200` → tick at 07:59:30 sends 200, leaves 50 with `attempts=1`. Tick at 08:00:30 sees the 50 unsent (and the 200 sent terminal — excluded at SQL level by the LEFT JOIN filter); sends the remaining 50. No teacher sent twice. No teacher missed.
- **R2-BLOCKER 1 starvation regression test:** seed 1000 teachers all in MSK with slots today, `rateLimit=200` → tick 1 sends 200 (lowest ids). Tick 2 sends next 200 (the 200 already-sent are EXCLUDED at SQL level — verified by EXPLAIN showing the LEFT JOIN filter applied before LIMIT). Across 5 ticks within the 2-min band, all 1000 minus tail teachers receive digest. The cap at 400 (2 ticks × 200) within 2-min band is the RISK-4 cap; tail teachers (501+) defer to next day per RISK-4.
- **R2-BLOCKER 2 morning-past-slot test:** seed teacher in `Asia/Vladivostok` (UTC+10) with a single booked slot at local 07:00 today (= UTC = `now() - 1h` when tick fires at local 08:00). Tick at local 08:00 → digest fires; body lists the 07:00 slot. (Without the candidate query's `-24h` widening, this slot's UTC start_at is in the past relative to `now()` and the teacher would be invisible to the candidate set.)
- **Stable ordering:** seed 5 teachers with deterministic ids; assert the rateLimit=2 case sends to lowest-id 2 in the first tick, next-2 in the second tick, last-1 in the third.
- **R2-BLOCKER 3 concurrent-INSERT race test:** simulate two cron pods running the SAME tick at local 08:00 against the SAME teacher (use 2 Postgres pools + a barrier to coordinate). Both pass the candidate-set query; both reach step f.iii. Exactly one INSERT-ON-CONFLICT-DO-NOTHING returns a row (attempts=1); the other returns 0 rows. Assert: exactly 1 Resend call total; row final state has email_sent=true.
- **Retry on transient failure:** teacher's Resend call returns 500 → row has email_sent=false, attempts=1, last_error set. Next tick within band → attempts=2, retry. After 3 attempts → row's skipped_reason='send_failed' terminal.
- **Deletion-grace gate:** seed 1 teacher with `scheduled_purge_at IS NOT NULL` → not in candidate set; no row written.
- **Disabled-account gate:** seed 1 teacher with `disabled_at IS NOT NULL` → not in candidate set.
- **Purged-account gate:** seed 1 teacher with `purged_at IS NOT NULL` → not in candidate set.
- **Idempotency on concurrent tick:** simulate two pools both hitting the same teacher inside the firing band → exactly 1 Resend call total (the second pool's e.v branch blocks on the first pool's FOR UPDATE lock; on retry, e.i triggers since row email_sent=true).
- **Slot status changes between SELECT and send:** snapshot the slot list, then DELETE the slot, then complete the send → the email contains the now-deleted slot's data (acceptable; documented in §6 RISK-3). No exception.
- **Account email missing:** teacher's `accounts.email` is empty string → row inserted with `skipped_reason='account_email_missing'`; no Resend call.

### 3.4 Email template

`tests/email/teacher-daily-digest.test.ts`:
- Subject for 1 slot contains "1 занятие".
- Subject for 2 slots contains "2 занятия".
- Subject for 5 slots contains "5 занятий".
- Subject for 11 slots contains "11 занятий" (mod-100 edge — pluralRu).
- Subject for 21 slots contains "21 занятие" (mod-10=1, mod-100≠11 edge).
- Greeting with display_name='Анна' renders `Здравствуйте, Анна.`.
- Greeting with null display_name renders `Здравствуйте.`.
- Per-slot line with display_name='Иван П.' renders `учащийся Иван П.`.
- Per-slot line with null display_name and email='ivan@example.com' renders `учащийся ivan@example.com`.
- Zoom URL present → `Войти: <url>` line follows the slot line.
- Zoom URL null → no `Войти:` line, no placeholder.
- escapeHtml runs on every dynamic value (display_name with `<`, email with `&`, zoom URL with `&` query string).
- Sign-off uses em-dash `—`, not hyphen `-`.
- "Управлять занятиями: ${siteUrl}/teacher" line present, URL escaped.
- **Drift test:** TS mirror `lib/email/templates/teacher-daily-digest.ts` produces byte-identical rendered output to mjs `scripts/lib/teacher-daily-digest-template.mjs` for the same input params (JSON.stringify of `{subject, text, html}` triples).

### 3.5 Plural helper + timezone mirror

`tests/scripts/plural-ru.test.ts`:
- Mirror of inlined tests in `tests/scripts/conflict-unresolved-alert.test.ts` (pluralRu cases already covered there — copy verbatim into the new shared-module test, then remove the duplicates from the old test).
- TS ↔ mjs drift test: `lib/copy/plural-ru.ts` and `scripts/lib/plural-ru.mjs` produce identical output for the cross-product of 0-100 and the 8 noun triples in `docs/content-style.md §10`.

`tests/scripts/timezone-mjs-mirror.test.ts`:
- Drift test: `scripts/lib/timezone.mjs` `ALLOWED_TIMEZONES` array equals `lib/auth/timezones.ts` `TIMEZONE_OPTIONS.map(t => t.id)` (JSON.stringify equality).
- `safeTimezone(...)` mjs version returns same value as TS version for: valid IANA in allowlist, valid IANA outside allowlist, null, undefined, empty string, garbage string.

### 3.6 Admin page

`tests/integration/admin/digest-page.test.ts`:
- Page renders 3 sections: master-switch editor, last-tick summary, 7-day summary.
- Seed `teacher_account_daily_digests` rows for last 7 days → table renders correct counts (sent / empty-day / errors).
- Seed `probe_runs` rows with each of the 3 digest verdict kinds → last-tick widget renders the most recent.
- Operator toggling `TEACHER_DIGEST_EMAIL_ENABLED` from 0 to 1 writes through to operator_settings; widget reads updated value.
- Layout-level admin gate — anonymous request → 307/302 Location header pointing at `/admin/login` (per `app/admin/(gated)/layout.tsx:30-31`); non-admin learner → 307/302 Location header pointing at `/cabinet` (per `app/admin/(gated)/layout.tsx:39-40`). NOT 403 — this is the existing behaviour, not changed by this wave (R2-WARN 5 closure).
- Admin sidebar nav contains "Утренний дайджест" link pointing at `/admin/settings/digest` (R2-WARN 4 closure).

---

## 4. Security analysis

### 4.1 Learner data disclosure to teacher

The digest body contains, per slot, the learner's display_name OR email. Teachers already see both in `/teacher` (full-week calendar UI today renders learner identity per booked slot). No new disclosure surface.

**Conservative-mode option** (deferred to follow-up): show first-letter-of-email instead of full email when display_name is null. Not in MVP.

### 4.2 Email-address spoof / phishing

Resend's `EMAIL_FROM` is hard-coded via operator env file. `to` is the teacher's `accounts.email`, written-through during registration/email-verify only (already gated by `email_verifications` in migration 0008). No user-controlled field reaches Resend.

### 4.3 escapeHtml coverage

Every dynamic field (display_name, email, zoom_url) is `escapeHtml`-wrapped. Tests pin this for each per-slot line. The HTML body uses `<pre>` for the slot block (matches `operator-payment-failure.ts` shape) so styling differences don't open injection vectors.

### 4.4 Zoom URL trust boundary

`lesson_slots.zoom_url` is operator/teacher-controlled (admin can PATCH it per BCS-DEF-3 shipped 2026-05-18 `migrations/0056_lesson_slots_zoom_url.sql`). A malicious teacher who somehow injected a URL with HTML/JS would only target themselves (they ARE the recipient). No cross-account vector.

### 4.5 Cron-pod race

Per §0a hint D + §2.6 — atomic INSERT-ON-CONFLICT-DO-UPDATE inside the row's FOR UPDATE lock; the row IS the lock. Resend `idempotencyKey` is the API-level defense-in-depth. No advisory-lock prefix needed because we don't span multiple write paths (only the cron tick writes to `teacher_account_daily_digests`).

### 4.6 PII at rest

`teacher_account_daily_digests` stores no learner data — only `account_id` (teacher's, FK) + date + status. Slot list is regenerated per tick from `lesson_slots`. Email body itself is NOT persisted (only the Resend `email_id` returned by Resend). Consistent with existing alert-probe pattern.

### 4.7 Rate-limit / abuse vector

No user-controlled trigger for the digest (it fires on cron, not on user action). A malicious learner mass-booking + mass-cancelling slots cannot induce extra digests — the teacher receives one per day regardless. Abuse vector is bounded by `TEACHER_DIGEST_RATE_LIMIT_PER_TICK`.

---

## 5. Decomposition — single PR

**Decision: Shape A — single PR.** Per §0c BLOCKER 5 closure, the candidate query + tick anatomy are tightly coupled to the dedup table + email template; splitting would leave the cron unable to send mail in an intermediate sub-PR. Total estimated diff: ~900-1100 LOC across ~15 files.

Files added in the single PR:

- `migrations/0066_teacher_account_daily_digests.sql`
- `migrations/0067_probe_runs_teacher_daily_digest.sql`
- `scripts/teacher-daily-digest.mjs`
- `scripts/lib/timezone.mjs`
- `scripts/lib/plural-ru.mjs`
- `scripts/lib/teacher-daily-digest-template.mjs`
- `scripts/systemd/levelchannel-teacher-daily-digest.service`
- `scripts/systemd/levelchannel-teacher-daily-digest.timer`
- `lib/email/templates/teacher-daily-digest.ts` (TS mirror, tests-only consumer)
- `lib/copy/plural-ru.ts` (TS mirror, tests-only consumer)
- `app/admin/(gated)/settings/digest/page.tsx`
- + tests per §3
- + edits to `lib/admin/operator-settings.ts`, `scripts/lib/operator-settings.mjs`, `scripts/lib/probe-runs.mjs`, `scripts/activate-prod-ops.sh`, `scripts/conflict-unresolved-alert.mjs` (refactor inline pluralRu to shared module).

**One-PR trailer:** `Codex-Paranoia: SIGN-OFF round N/3` per `COMPANY.md §Two-checkpoint paranoia pipeline` row 3. Both plan and wave paranoia run on the same PR.

---

## 6. Risks + mitigations

### RISK-1 — Empty-day flag growth

`teacher_account_daily_digests` accumulates 1 row per teacher per day for teachers who have at-least-some-future-slots but none today. At N=1000 teachers × 365 days = 365k rows / year max. Acceptable. Optional retention sweep DEFERRED — listed in §10.

### RISK-2 — DST edge cases beyond the 19-TZ allowlist

The current `ALLOWED_TIMEZONES` set in `lib/auth/timezones.ts:30` is 19 IANA names. Mitigation: any future TZ added to the allowlist gets a test row added to §3.3 + the mjs mirror updated in lockstep.

### RISK-3 — Snapshot-vs-send race

Tick reads slot list at T; sends email at T + 0.5 sec. If the teacher cancels a slot in those 500 ms, the email lists a cancelled slot. **Acceptable** — the teacher sees the cancellation in `/teacher` cabinet immediately + the digest is a one-shot daily summary.

### RISK-4 — All-RF teachers fire in the same minute (08:00 MSK)

At N=1000 teachers, all-MSK, with `TEACHER_DIGEST_RATE_LIMIT_PER_TICK=200` → 5 ticks would be needed but the firing band is only 2 minutes wide. So only the first 400 teachers receive their digest at MSK 08:00; the tail 600 miss day-0 and receive day-1 morning. **Mitigation for MVP scale** (single-digit teachers): cap is theoretical. **For ~100-300 RF teachers**: rate-limit covers. **For 500+**: needs a different design (widen firing band, OR widen cron cadence). Documented; tests pin per-tick rate-limit at §3.3.

### RISK-5 — Resend hourly cap saturation

Resend default tier is 100 emails/sec / 10k/hour. At our scale, no risk. Documented for future awareness.

### RISK-6 — Systemd unit / probe-name CHECK migration ordering

Migration ships BEFORE the timer is installed (the timer can't run without the CHECK widening on probe_name AND verdict_kind). The activator script (`scripts/activate-prod-ops.sh`) runs AFTER the migration is applied — standard rollout order. Documented in §8.

### RISK-7 — Past-send-window drops

A tick at 08:14 (after Persistent=true recovery) silently skips all teachers (no row written, no email). The teacher gets no digest that day. **Acceptable** — a "morning digest" arriving at 14:00 is worse UX than no digest. Operator can investigate via the `/admin/settings/digest` summary widget.

### RISK-8 — Greetings + plurals interaction

`pluralRu(n, ...)` in the subject uses `n = lessons.length`. The greeting uses display_name OR fallback. Independent — but tested together in §3.4.

### RISK-9 — Account in deletion-grace state (Round-1 WARN 9 closure)

Column names are `accounts.scheduled_purge_at` and `accounts.purged_at` (per `migrations/0019_accounts_deletion_grace.sql:42,5,10`). NOT `deletion_grace_until` (does not exist). Candidate-set query in §2.2 excludes `scheduled_purge_at IS NOT NULL` OR `purged_at IS NOT NULL` OR `disabled_at IS NOT NULL`. Pinned by test §3.3.

### RISK-10 — Multi-archetype account (teacher + learner)

A person who is BOTH teacher and learner archetype could (theoretically) get both a teacher digest AND a learner reminder for the same day. Since BCS-DEF-4 is on a different scheduler (per-slot, not daily-digest), no interference.

### RISK-11 — Operator forgets to enable on first rollout (Round-1 BLOCKER 7 closure)

Default `TEACHER_DIGEST_EMAIL_ENABLED=0`. The activator installs the timer + migration; ticks fire and write `digest_skipped_disabled` probe_runs rows; no per-teacher rows are written; no emails go out. Operator validates this on `/admin/settings/digest` (sees the disabled-verdict probe rows), then flips the switch to 1 in the UI.

### RISK-12 — Cron starts mid-day, day-0 missed for some TZs (Round-1 Q7)

On the day the digest infrastructure first activates, some teachers in TZs already past 08:00 local don't get a day-0 digest. Acceptable — day-1 catches them at next morning's 08:00 local. No fix required.

---

## 7. Acceptance criteria

- Migration 0066+0067 apply; tests in §3.1 green.
- Operator settings keys present in SETTING_SCHEMA + mirror; default `EMAIL_ENABLED=0`; drift test green.
- `scripts/teacher-daily-digest.mjs` exists, passes integration tests (§3.3).
- `scripts/lib/teacher-daily-digest-template.mjs` + TS mirror at `lib/email/templates/teacher-daily-digest.ts` both pass copy tests (§3.4) + drift test.
- `scripts/lib/timezone.mjs` + drift test against `lib/auth/timezones.ts` green.
- `scripts/lib/plural-ru.mjs` extracted; `scripts/conflict-unresolved-alert.mjs` switched to the shared module; existing tests still green.
- Systemd units exist in `scripts/systemd/` + activator allowlist updated.
- `/admin/settings/digest` renders 3 sections (settings editor + last-tick + 7-day summary).
- `npm run build`, `npm run test:run`, `npm run test:integration` all green.
- `docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md` header gains a 1-line note pointing at this rewritten plan as the prerequisite (doc-only sibling change; no separate paranoia round).

Post-merge operator activation:
1. `git pull` on VPS.
2. Apply migrations via `scripts/migrate.mjs`.
3. Run `scripts/activate-prod-ops.sh` to install the new unit + reload systemd.
4. Verify `systemctl list-timers | grep teacher-daily-digest` shows the unit.
5. Verify first tick within 1 min — should write a `probe_runs` row with `verdict_kind='digest_skipped_disabled'` (since `TEACHER_DIGEST_EMAIL_ENABLED=0` by default).
6. Flip `TEACHER_DIGEST_EMAIL_ENABLED=1` via `/admin/settings/digest` UI.
7. Wait until next morning's 08:00 — verify `digest_sent` row + actual digest email received.

---

## 8. Migration / rollout

1. **No strict prerequisite on BCS-DEF-4.** This digest is independent of the BCS-DEF-4 learner-reminders epic — different schema, different scheduler, different audience.
2. Single PR (per §5). Migration 0066+0067 → operator settings → scheduler → email template → systemd units → admin page.
3. Activator rerun on VPS: `scripts/activate-prod-ops.sh` adds the 2 new unit names; reloads systemd.
4. First tick fires within ≤ 1 min of unit being installed. Since `TEACHER_DIGEST_EMAIL_ENABLED=0` by default, no emails go out — only `digest_skipped_disabled` `probe_runs` rows accumulate.
5. **Soft-launch sequence (Round-1 BLOCKER 7 closure):**
   a. Validate `/admin/settings/digest` shows the master-switch as "Выключено" + last-tick widget renders the disabled-verdict row.
   b. Flip the switch to "Включено" in the UI.
   c. Wait for the next 08:00 local in any teacher's TZ.
   d. Verify (a) a `digest_sent` `probe_runs` row, (b) some `teacher_account_daily_digests` rows with `email_sent=true`, (c) digest email received in at least one test inbox.

Rollback: if the digest causes issues, set `TEACHER_DIGEST_EMAIL_ENABLED=0` via `/admin/settings/digest` → no further digests fire (the operator settings change is picked up on next tick). Migration 0066+0067 are safe to leave in place.

---

## 9. Open questions for paranoia

**Q1.** Should the firing window be ±60 sec or ±30 sec? **Pre-answer:** 60 sec — gives a full cron-tick of slack.

**Q2.** Should the per-tick rate-limit be a separate key from `REMINDERS_RATE_LIMIT_PER_TICK` (BCS-DEF-4)? **Pre-answer:** yes — different probe, different scope.

**Q3.** Should empty-day rows accumulate forever? **Pre-answer:** accumulate in MVP; retention sweep deferred.

**Q4.** Should the digest include slot duration? **Pre-answer:** no in MVP. Deferred (BCS-DEF-5-DURATION).

**Q5.** Should the digest include lesson notes? **Pre-answer:** no — operator-facing per the column comment. Deferred.

**Q6.** Should empty-day case include "no lessons today" message? **Pre-answer:** skip per §0a decision 4.

**Q7.** Teacher in TZ where 08:00 has already passed on first activation — miss day-0. **Pre-answer:** acceptable; documented as RISK-12.

**Q8.** Is `safeTimezone()` fallback to Europe/Moscow correct? **Pre-answer:** yes.

**Q9.** Should the digest body include a "unsubscribe" footer? **Pre-answer:** no in MVP.

**Q10.** Per-user time-of-day — MVP scope? **Pre-answer:** NO — deferred (BCS-DEF-5-PREFS).

**Q11.** Should we use Resend's `idempotencyKey`? **Pre-answer:** YES — defense-in-depth.

**Q12.** What if `account_profiles` row doesn't exist? **Pre-answer:** LEFT JOIN → timezone=NULL → safeTimezone → Europe/Moscow.

**Q13.** Is 36h candidate-set window correct? **Pre-answer:** yes — worst case teacher "today" extends ~24h ahead of UTC.

**Q14.** ProbeName union shared between alert probes and digest — typing health issue? **Pre-answer:** mechanical follow-up. Listed in §10 (BCS-DEF-5-SCOPE-RENAME).

**Q15.** Single PR ~1100 LOC — too big? **Pre-answer:** at the upper bound; alternative (split sub-PRs) creates non-functional intermediates.

---

## 10. Out of scope — deferred follow-ups

- **BCS-DEF-5-TG** — Telegram channel for the daily digest. Plan-ready at `docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md` (PR #355). **Scope-adjusted note added in the same PR as this rewrite:** the TG plan currently inherits from a per-slot scheduler; after this rewrite, TG stacks on the daily-digest schema/cron. The TG plan-doc gets a one-sentence header note pointing at this rewritten plan as the prerequisite.
- **BCS-DEF-5-PREFS** — per-user opt-out + per-user time-of-day + per-user delivery channel routing. Most-requested follow-up. Requires a teacher cabinet page at `/teacher/settings/digest`.
- **BCS-DEF-5-DURATION** — include lesson duration in the per-slot line.
- **BCS-DEF-5-NOTES** — include lesson notes in the digest.
- **BCS-DEF-5-PUSH** — Web Push channel. Plan-ready at `docs/plans/bcs-def-5-push-teacher-pwa-reminders.md`.
- **BCS-DEF-5-RETENTION** — db-retention sweep of `teacher_account_daily_digests` rows older than 90 days.
- **BCS-DEF-5-LEARNER-DIGEST-PARITY** — should learners get a morning digest too? Worth a product call once both in production.
- **BCS-DEF-5-CONSERVATIVE-LEARNER-ID** — replace full learner email fallback with first-letter-of-email when display_name is null.
- **BCS-DEF-5-LATE-TOLERANCE-TUNABLE** — promote the ±60-sec band to an operator-tunable setting.
- **BCS-DEF-5-SCOPE-RENAME** — rename `lib/admin/operator-settings.ts ProbeName` union → `SettingScope` to drop "everything is a probe" semantics.
- **BCS-DEF-5-WIDER-BAND** — if N teachers grows past ~400 in a single TZ-band, widen the firing window or rate-limit.

---

## 11. Final trailer expectations

- **Single PR** — `Codex-Paranoia: SIGN-OFF round N/3` + `Skill-Used: /codex-paranoia plan, /codex-paranoia wave` + `Critical-Path-Touched: lib/admin/operator-settings.ts, scripts/lib/probe-runs.mjs`.

— END OF DRAFT (awaiting `/codex-paranoia plan` round 2) —
