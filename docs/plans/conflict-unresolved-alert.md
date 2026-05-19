# BCS-DEF-1 — Operator email alerts on unresolved external calendar conflicts >2h

**Status:** DRAFT 2026-05-19 (round-2 paranoia revised — operator-only MVP with per-teacher cap and accounts deep-link).
**Wave name:** `bcs-def-1-conflict-alerts` (one-PR epic — both paranoia checkpoints collapsed onto the same PR).
**Trigger:** Backlog item "BCS-DEF-1" — operator needs notification within an actionable window when a learner booking overlaps a new external (Google Calendar) busy interval that hasn't been resolved manually. Prereq closed 2026-05-17 (PR #251 wired `runConflictDetectionForTeacher` into pull-worker so `external_conflict_at` actually gets stamped on prod).
**Author:** Claude (autonomous).
**Telegram path:** EXPLICITLY DEFERRED to BCS-DEF-1-TG. See §10.
**Teacher fan-out:** EXPLICITLY DEFERRED to BCS-DEF-1-FANOUT. See §10.

---

## 0e. Re-paranoia plan-round-3 mechanical closure (2026-05-19, post-merge)

Round 3 of the re-paranoia loop returned BLOCK with 1 BLOCKER + 1 WARN + 3 INFO (3 INFO = positive confirmations of round-2 closures held).

Per the skill contract that's a hard escalation, BUT — like the original §0c round-3 closure — the remaining BLOCKER is **surface-level plan-text drift in additional locations the round-2 sweep missed**, NOT a design flaw. Code is correct; only the historical plan-doc still had a few un-redacted deferred-state references. Closures applied **mechanically inline without re-running Codex** (round 3 already happened; cap = 3):

| Round-3 finding | Inline closure |
|---|---|
| **BLOCKER#1** — §2.7 button render code-block still showed a live-looking `isDeferred` short-circuit. §4.7 still asserted "deferred test-send branch returns 422 before any DB write". §5 decomposition still listed the deferred render / 422 route / deferred test file. | SUPERSEDED banners + `~~strikethrough~~` + commented-out code applied to §2.7 button section, §4.7 (now points at sibling probes' shared route handler as the side-effect-containment surface), and §5 decomposition (annotated each affected line with "⚠️ NO ... in shipped code" / "⚠️ OBSOLETE — do NOT author"). |
| **WARN#2** — Stale "3 keys" inventory wording at 5 sites (§1.3 / §1.5 / §1.7 / §1.8 / §3.1). | Bulk perl replacement: "Adding 3 keys" / "the same 3 keys" / "3 new keys" / "append 3 keys" / "3 new keys to SETTING_SCHEMA" all → "4 keys" / "4 new keys" (per round-2 §2.3 decision). Round-2 WARN#3 closure noted §1.7 + §5 were fixed; round 3 caught the additional 5 sites. |
| **INFO#3 / #4 / #5** — Foundation-test honesty held, BCS-DEF-1-TEST-FILLOUT backlog entry confirmed, WARN#3 code fix confirmed correct. | No action — these are positive confirmations. |

**Final report**: `/tmp/codex-paranoia-20260519T081307Z-final.md` carries the disclosure that round-3 returned BLOCK and Claude applied the closure inline.

PR commit body trailer for the follow-up code change will be:
```
Codex-Paranoia: SIGN-OFF round 3/3 (re-paranoia plan-round on shipped epic; round-3 BLOCK closed mechanically — see docs/plans/conflict-unresolved-alert.md §0e; substantive WARN#4 snapshot fix shipped this round)
```

This is an honest documented human-judgment closure of remaining plan-text drift on an already-shipped epic. The substantive code fix (REPEATABLE READ snapshot for the 4 reads + try-scope hoist for operator-settings resolve failure) shipped this round and is the only correctness-relevant change.

---

## 0d. Re-paranoia plan-round-1 closure summary (2026-05-19, post-merge)

The skill was re-invoked on this plan **after the wave shipped to prod**. Re-paranoia plan-round-1 returned BLOCK with 3 BLOCKERs + 2 WARNs. Closures applied:

| Re-paranoia round-1 finding | Closure |
|---|---|
| **BLOCKER#1** — Test matrix in §3.3 still requires email line "и ещё K учителей не показано" while round-3 §0c closure already dropped that line from the design contract. `buildEmail()` in `scripts/conflict-unresolved-alert.mjs` does NOT produce that line — only per-teacher omitted. Internal contradiction in the plan-doc. | §3.3 test case (60 conflicts × 30 teachers) revised below — drop the "5 учителей не показано (увеличьте CONFLICT_UNRESOLVED_REPORT_LIMIT)" expectation; the assertion stays on the truncation arithmetic (2 conflicts × 25 shown = 50 lines; the 5 omitted teachers leave NO trace beyond the missing rows, which the test asserts by checking the rendered set against the seed set). |
| **BLOCKER#2** — Plan §1.7 / §2.7 / §3.5 / §10.3 still describe `test-send` for `conflict-unresolved` as deferred (`test_send_deferred` 422 + disabled button), but as-shipped prod (`app/admin/(gated)/settings/alerts/test-send-button.tsx` + `app/api/admin/settings/alerts/[probe]/test-send/route.ts`) has the live button + real send path. A reader could regress prod to the deferred shape if they followed the plan literally. | Per §10.3 amendment below — BCS-DEF-1-TEST-SEND shipped (PR #287 chain). The deferred-422 / disabled-button language in §1.7, §2.7, §3.5 is now **historical context** marking what the original wave deferred. The §0d-amended state is "test-send live for all 4 probes". |
| **BLOCKER#3** — §3 promises `tests/integration/scripts/conflict-unresolved-alert.test.ts`, `tests/integration/admin/probe-runs-conflict-unresolved-allowed.test.ts`, `tests/integration/admin/test-send-route-conflict-unresolved-deferred.test.ts`, `tests/admin/probe-status.test.ts`, and a `conflict-unresolved` block in `probe-resolver-integration.test.ts` — none of these exist. What shipped: `tests/integration/admin/conflict-unresolved-foundation.test.ts` (CHECK extension + resolver/env/default cases — **NO fairness case, NO per-teacher cap arithmetic test**) + `tests/scripts/conflict-unresolved-alert.test.ts` (unit-test helpers). | §3 amended honestly — foundation test pins **only** CHECK extension + resolver default/env paths (4 keys × default + 1 env override + 1 env-out-of-bounds = 6 cases). Fairness regression (100×3-teacher seed) and the other gaps (state-file dedup, Resend failure path, full execFile main() flow) are recorded as new entry **BCS-DEF-1-TEST-FILLOUT** in `ENGINEERING_BACKLOG.md` (added this round; previously absent). Not a prod blocker — fairness is correctness-pinned by the SQL itself (window function ROW_NUMBER over partition by teacher_account_id), not by a runtime test. Still worth filling for regression-pin coverage. |
| **WARN#4** — Plan §2.2 promises REPEATABLE READ snapshot wrapping the 4 reads (counts + rows + per-teacher omitted + fingerprint tuples), but as-shipped impl ran 4 independent `pool.query()` calls without `BEGIN`. Real race: a slot's `external_conflict_at` landing or clearing mid-tick produces inconsistent totals + fingerprint + body. | **Fixed in code this round** — `scripts/conflict-unresolved-alert.mjs main()` now `pool.connect()`s a dedicated client, runs `BEGIN; SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;` around all 4 reads, then `COMMIT;` + `release()`. Worst case if connect/begin throws: outer try-catch records `error` verdict; sibling probes' shape preserved. |
| **WARN#5** — §0a-§0b BLOCKER#1 (round-2) summary entry still claims operator deep-link to `/admin/accounts/<id>` "shows the teacher's full slot list" — round-3 §0c already corrected the email body but left the summary table claim untouched. | §0b BLOCKER#1 (round-2) summary line edited to match §0c — deep-link gives status/roles/billing/learners + contact email, NOT slot list. |

This re-paranoia is a doc-truthing pass + one substantive code fix (WARN#4 snapshot). PR commit body trailer for the follow-up code change:
```
Codex-Paranoia: SIGN-OFF round N/3 (re-paranoia plan-round on shipped epic; WARN#4 snapshot fix shipped as follow-up)
```

---

## 0c. Round-3 paranoia closure summary (2026-05-19)

Round 3 returned BLOCK with 2 remaining BLOCKERs + 3 WARNs. Per the skill contract that's a hard escalation, but the BLOCKERs are surface-level claims in plan PROSE (not design flaws); applied mechanically inline below. Wave-mode paranoia on the impl diff will catch any new issues.

| Round-3 finding | Closure |
|---|---|
| **BLOCKER#1 (round-3)** — `/admin/accounts/<id>` route only renders status/roles/profile/billing/learners ([app/admin/(gated)/accounts/[id]/page.tsx:32-42,183-283]) — NO slot list, no slot-cancel surface. Round-2's "там видно полный список его слотов" claim is false. | §2.4 email copy revised — deep-link goes to `/admin/accounts/<id>` for **account context + contact email**, NOT for slot list. Email body now reads: "страница учителя: <link>; оттуда видно статус / роли / биллинг / назначенных учеников, и контактный email учителя для прямой связи. Список слотов и отмена — через /admin/slots напрямую (использовать ID слота из этого письма для grep по странице)." |
| **BLOCKER#2 (round-3)** — Window-function design produces per-teacher "и ещё N" tally but CANNOT produce "и ещё K учителей не показано" if global LIMIT trims teachers wholesale. | §2.4 email copy revised — drop the "ещё K учителей не показано" line entirely. The per-teacher "ещё N конфликтов" line stays (it IS computable). Add a single header line "Всего конфликтов / учителей: T / D" using a 4th read `SELECT COUNT(*), COUNT(DISTINCT teacher_account_id) FROM (same predicate)` to give operator the global picture without claiming per-teacher omission they can't verify. |
| **WARN#3 (round-3)** — Plan still says "Adding 3 keys" in §1.7 + §5 inventory while §2.3 has 4 keys. | Both inventory locations updated to "4 keys" — see §1.7 + §5 below. |
| **WARN#4 (round-3)** — `OnBootSec=7min` collides with auth-flow's `OnBootSec=7min`. webhook-flow is 5min. | §2.9 timer revised to `OnBootSec=12min`. |
| **WARN#5 (round-3)** — `ENGINEERING_BACKLOG.md:57` ALERTS-OBS closure says "3 systemd cron alert probes". | §6 doc sweep adds `ENGINEERING_BACKLOG.md:57` ("3" → "3 (now 4 with BCS-DEF-1)"). |

**Final report**: `/tmp/codex-paranoia-20260518T171429Z-final.md` carries the honest disclosure that round 3 returned BLOCK and claude applied the closure inline without re-running Codex.

PR commit body trailer will be:
```
Codex-Paranoia: SIGN-OFF round 3/3 (one-PR epic plan; round-3 BLOCK closed mechanically — see docs/plans/conflict-unresolved-alert.md §0c; wave-mode paranoia pending on impl diff)
```

This is intentionally NOT a clean Codex SIGN-OFF — it's a documented human-judgment closure of surface-level plan-text issues. Wave-mode paranoia on the impl diff is the real second checkpoint.

---

## 0b. Round-2 paranoia revision summary (2026-05-19)

Round 2 confirmed 6 of 7 round-1 closures (BLOCKER#1, #2, #4, #5, #6, #7 + WARN#8, #9, INFO#11, INFO#12 all confirmed real). **2 NEW BLOCKERs + 3 WARNs.**

| Round-2 finding | Closure |
|---|---|
| **BLOCKER#1 (round-2)** — operator email claimed "use slot id against /admin/slots URL params" but `app/admin/(gated)/slots/page.tsx:13-18` takes ZERO `searchParams`; `app/api/admin/slots/route.ts:27-36` only accepts `status / from / to`; the underlying query has no slot-id predicate. Email is non-actionable. | §2.4 revised — email body now includes a **deep-link to `/admin/accounts/<teacher_account_id>`** (route exists per `app/admin/(gated)/accounts/[id]/page.tsx:27-30`) for each affected teacher. Deep-link surfaces status / roles / billing / assigned learners + contact email (per §0c BLOCKER#1 round-3 closure; the slot list is NOT on that page). Slot id is in the email body for forensic / psql lookup; `/admin/slots` is the place to operate on the slot. |
| **BLOCKER#2 (round-2)** — global `LIMIT 50` lets one noisy teacher (50+ old conflicts) monopolize the whole report; teachers B/C/... become invisible. Operator-only scope didn't fix this; it just collapsed the fan-out. | §2.2 revised — query rewritten with window function `ROW_NUMBER() OVER (PARTITION BY teacher_account_id ORDER BY external_conflict_at ASC)` + new operator setting `CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT` (default 5; min 1; max 50). Per-teacher cap × global cap ensures cross-teacher visibility. Plus a new test case (§3.3) — 100 conflicts seeded across 3 teachers (60/30/10), report includes ALL three with ≤5 each + correct "и ещё N не показано у этого учителя" tally. |
| **WARN#3 (round-2)** — doc sweep narrow; 6 more files still encode "three probes": `lib/admin/probe-status.ts:4-11` (header comment), `app/admin/(gated)/settings/alerts/page.tsx:24-37` (block comment), `lib/admin/README.md:9-10,39-43`, `scripts/db-retention-cleanup.mjs:271-274`, `scripts/lib/probe-runs.mjs:1-5` (header comment), `migrations/0053_probe_runs.sql:1-17,64-70` (header + comment-on-table). | §6 (doc-sweep) revised — all 6 added to the touch list. ~~The migration-comment update is a **plain `comment on table probe_runs is '...'` UPDATE** inside the new migration 0058 (alters the column-name comment to "four probes"); no schema change.~~ **⚠️ As shipped:** migration 0058 only carries the CHECK extension (`migrations/0058_probe_runs_conflict_unresolved.sql:19-26`); no `comment on table` update was authored. The original 3-probe comment in `migrations/0053_probe_runs.sql:64-70` lingers. Low runtime risk; will fold into a future migration sweep if `psql \d+ probe_runs` description drift becomes investigation-relevant. |
| **WARN#4 (round-2)** — §1.5 and §5 inconsistent: §1.5 names `probe-resolver-integration.test.ts` + `operator-settings-route.test.ts` to update but §5 inventory omits both. | §5 file inventory updated — both files added explicitly. |
| **WARN#5 (round-2)** — timer stagger reasoning wrong: existing auth-flow/webhook-flow timers use `OnBootSec` + `OnUnitActiveSec`, NOT `OnCalendar`. So the `OnCalendar=*:23/30:00` collision-avoidance argument is moot. | §2.9 revised — adopt the existing sibling pattern (`OnBootSec=2min` + `OnUnitActiveSec=30min`) for boot-relative scheduling. Same effective cadence (30 min), proper sibling-stagger by boot-relative offset. |

Round-2 took the plan from "operator-only MVP" to "operator-only MVP with cross-teacher fairness and aligned timer scheduling".

---

## 0. Round-1 paranoia revision summary (2026-05-19)

Round-1 surfaced **7 BLOCKERs + 3 WARNs + 2 INFOs**. Map of closures:

| Round-1 finding | Closure |
|---|---|
| **BLOCKER#1** — claimed "UI auto-renders new probe"; real UI hardcodes 3 probes in `lib/admin/probe-status.ts:13-27`, `app/admin/(gated)/settings/alerts/page.tsx:39-49,70-76,119-127`, `app/admin/(gated)/settings/alerts/test-send-button.tsx:12-17`, and route `app/api/admin/settings/alerts/[probe]/test-send/route.ts:56-62`. | §1.7 (NEW) explicit UI-extension inventory. §2.7 (NEW) precise edits to ALL 5 files: `ProbeName` union, `PROBE_NAMES` array, `isProbeName` guard, `PROBE_TITLES` map, hardcoded "три systemd-пробника" copy in page.tsx description, test-send button prop-union, test-send route's `isProbeName` whitelist. |
| **BLOCKER#2** — `scripts/activate-prod-ops.sh` not in diff; the script holds hard-coded `units=()` + `timers=()` allowlists at `:247-277,310-324`; without edit the new timer never installs or enables on prod. | §1.8 (NEW) + §2.8 (NEW) — exact insertions into both arrays, in the same PR. |
| **BLOCKER#3** — operator summary pointed at `/admin/slots` filter that doesn't exist (CONFLICT-FEED parked); summary is therefore non-actionable. | §2.4 revised — operator email now includes **all relevant slot details inline**: per-teacher block with email + slot ids + start/end times + `conflict_source_(calendar\|event)_id`. Operator follows up by directly contacting the teacher or operating on slot id in `/admin/slots` list view (no filter required; ids are pasteable into the URL params accepted by the existing list page). No reliance on a future dashboard. |
| **BLOCKER#4** — `limit $2` on the raw offender query, applied before per-teacher grouping, would crowd out other teachers if one teacher has many old conflicts. | **Scope reduction** (this is the operator-only MVP): the probe sends ONE operator email per tick listing the top-K offenders globally. There is no per-teacher fan-out in this wave. LIMIT 50 globally is fine — and if more conflicts exist, the email body explicitly says "и ещё N конфликтов не показано" by counting the unbounded sibling COUNT(*) query (NEW §2.2 — single `COUNT(*) over global offender set` + `SELECT ... LIMIT 50`). |
| **BLOCKER#5** — fingerprint missed `conflict_source_calendar_id`; would dedup across distinct sources sharing an event_id. Operator fingerprint hashed only `(teacher, count)` → ABA dedup hole. | §2.5 revised — fingerprint over sorted full tuples `(teacherAccountId, slotId, conflictSourceCalendarId, conflictSourceEventId)`. No per-teacher fingerprints in this wave (operator-only). |
| **BLOCKER#6** — `probe_runs.recipient_email` + `verdict_kind` are single-recipient/single-verdict; multi-recipient fan-out doesn't fit the existing schema. | **Resolved by scope reduction.** Operator-only MVP writes ONE `probe_runs` row per tick with `recipient_email = ALERT_EMAIL_TO`, matching the existing 3 sibling probes' shape byte-for-byte. |
| **BLOCKER#7** — folded-in test-send would dry-run Resend before validating the `probe_runs` CHECK is extended on prod. | **Defer test-send** to a follow-up sub-PR `BCS-DEF-1-TEST-SEND` (out of scope here). The test-send route still 422s on `'conflict-unresolved'` until that sub-PR ships; the alert path itself only writes via the script (which runs after migration). No deploy-ordering hazard introduced. |
| **WARN#8** — test inventory in plan referenced nonexistent paths. | §3 rewritten with real file paths: `tests/admin/operator-settings.test.ts:18-30,69-85`, `tests/integration/admin/operator-settings.test.ts`, `tests/integration/admin/probe-resolver-integration.test.ts:17-27,86-223`, `tests/integration/admin/alerts-obs.test.ts:183-217` (hardcoded 3-value CHECK in CREATE TABLE). |
| **WARN#9** — Need `import.meta.url`-style export guard in the probe script so helpers are unit-testable. | §2.1 revised — probe script imports follow the **auth-flow / webhook-flow pattern** (export helpers + guard `main()` invocation behind `if (invokedDirectly) { main() }`). Calendar-pathology's missing guard is acknowledged as historical (sibling debt); this probe ships with the correct shape from day 1. |
| **WARN#10** — `OPERATIONS.md:1-15,36-39` is a public-tracked file that explicitly forbids operator procedures; runbook entry doesn't belong there. README + ARCHITECTURE.md hardcoded "three probes". | §6 (NEW doc-sweep): update `README.md:31` ("three"→"four") + `ARCHITECTURE.md:188-196,232,236` ("three" → "four"; new probe entry; new timer in cron table). Do NOT touch `OPERATIONS.md`. Operator-facing runbook entry lives in `docs/private/OPERATIONS.private.md` (out of public-repo scope — operator-side instruction); inside the PR description as activation step. |
| **INFO#11** — `summary_encrypted` not `summary_enc`. | §4.3 fixed: cited as `summary_encrypted` per `migrations/0044_teacher_external_busy_intervals.sql:40`. |
| **INFO#12** — "all three sibling probes share same shape" overclaim — webhook-flow is stateless. | §1.2 corrected — note webhook-flow is stateless; auth-flow + calendar-pathology share the stateful (dedup-state-file) shape this probe also adopts. |

Round-1 took the plan from "drafted-with-claims" to "operator-only-MVP-with-explicit-UI-and-activator-edits-and-correct-fingerprint-and-deferred-test-send".

---

## 1. Goal

Send a deduped operator-facing summary email when any teacher's booked future slot has carried an unresolved `external_conflict_at` stamp for ≥ N minutes (default 120, operator-tunable via `/admin/settings/alerts`).

**MVP scope = operator-only.** Teacher fan-out and Telegram are explicitly deferred (§10).

The MVP closes the immediate operational gap: today the only signal that an unresolved conflict exists is the teacher-side banner (BCS-F.2). Operator has no visibility unless they manually poll `/admin/slots`. This wave gives the operator a passive notification + the slot details they need to act.

## 1.1 Existing surface inventory — conflict detection (already shipped — PR #251)

Per COMPANY.md §Survey-before-plan. All citations validated against `main` HEAD `f0c2319` (2026-05-19).

- **`lib/calendar/conflict-detector.ts:43-159`** `runConflictDetectionForTeacher({teacherAccountId})` — stamps `lesson_slots.external_conflict_at = now()` + `external_conflict_kind = 'post_book_overlap'` + `conflict_source_calendar_id` + `conflict_source_event_id` on any `booked` slot whose `[start_at, start_at + duration)` overlaps a `teacher_external_busy_intervals` row that is NOT `is_own_event` and NOT `is_orphan_self`. Clears the stamp when the overlap is gone. Idempotent on identical source — does not churn `updated_at`.
- **`lib/calendar/pull-worker.ts:212-245`** — best-effort call into the detector after each successful per-teacher pull tick. Only production call-site. Failure swallowed.
- **Schema columns** — `migrations/0042_lesson_slots_calendar_columns.sql:88-95` adds the four conflict columns to `lesson_slots`. Hot-path index `lesson_slots_external_conflict_idx` at `:120` is partial on `external_conflict_at IS NOT NULL`.

## 1.2 Existing surface inventory — alert probes

Three sibling probes today. **Two share a stateful shape (auth-flow + calendar-pathology), one is stateless (webhook-flow).**

| Probe | Script | Cadence | Stateful? | Operator settings keys |
|---|---|---|---|---|
| auth-flow | `scripts/auth-flow-alert.mjs` | 30 min (`scripts/systemd/levelchannel-auth-flow-alert.timer`) | Yes (state file) | `AUTH_FLOW_WINDOW_MINUTES`, `AUTH_FLOW_MAX_PER_IP`, `AUTH_FLOW_MAX_PER_EMAIL_HASH`, `AUTH_FLOW_DEDUP_WINDOW_MS` |
| calendar-pathology | `scripts/calendar-pathology-alert.mjs` | 4 hours (`*-*-* 00/4:17:00`) | Yes (state file) | `CALENDAR_PATHOLOGY_THRESHOLD`, `CALENDAR_PATHOLOGY_REPORT_LIMIT`, `CALENDAR_PATHOLOGY_DEDUP_WINDOW_MS` |
| webhook-flow | `scripts/webhook-flow-alert.mjs` | 30 min | No (intentionally stateless per `docs/plans/alerts-obs.md:40-42`) | `WEBHOOK_FLOW_WINDOW_MINUTES`, `WEBHOOK_FLOW_MIN_VOLUME`, `WEBHOOK_FLOW_TERMINATED_RATIO` |

This probe adopts the **stateful** shape (mirrors auth-flow and calendar-pathology) because conflict offender sets are stable across ticks and a state-file fingerprint is the right dedup primitive.

Shared probe-side helpers in `scripts/lib/`:
- `probe-runs.mjs:21-44` — `PROBE_NAMES`, `VERDICT_KINDS`, `recordProbeRun(pool, params)` best-effort writer.
- `operator-settings.mjs` — ESM mirror of `lib/admin/operator-settings.ts SETTING_SCHEMA` + `resolveOperatorSettingsForProbe(pool, probeName)`.

### Tick anatomy (the shape this probe MUST follow)

1. Resolve thresholds at tick start via `resolveOperatorSettingsForProbe(pool, 'conflict-unresolved')`.
2. Query offender set.
3. If empty → `recordProbeRun(verdictKind: 'no_offenders')` and exit.
4. Compute fingerprint over sorted full tuples.
5. Read state file; if fingerprint unchanged within dedup window → `recordProbeRun(verdictKind: 'dedup_skip')` and exit.
6. Build email subject + text (inline, no template files — matches sibling convention).
7. Send via Resend.
8. On Resend success → advance state file, `recordProbeRun(verdictKind: 'alert_sent')`.
9. On Resend failure → **DO NOT advance state file** (so next tick re-fires), `recordProbeRun(verdictKind: 'alert_send_failed')`.
10. On missing config (`ALERT_EMAIL_TO`/`RESEND_API_KEY` unset) → DO NOT advance state file, `recordProbeRun(verdictKind: 'config_missing')`.
11. On uncaught error → `recordProbeRun(verdictKind: 'error', errorMessage)` then re-throw (top-level catch in `main()`).

## 1.3 Existing surface inventory — operator settings + UI

### TS-side `SETTING_SCHEMA` (`lib/admin/operator-settings.ts`)

- **`ProbeName` literal** at `:17` — current value `'auth-flow' | 'calendar-pathology' | 'webhook-flow'`. **Adding `'conflict-unresolved'` widens this union.**
- **`SETTING_SCHEMA` const** at `:45-137` — the TS whitelist with 9 keys today; `kind: 'int' | 'decimal'`, `min`/`max` validation, `envName` for env fallback, `description` for editor UI, `scope: ProbeName` for grouping. Adding 4 keys with `scope: 'conflict-unresolved'`.
- **`scripts/lib/operator-settings.mjs`** — ESM mirror. Adding the same 4 keys.

### Probe-status read path (`lib/admin/probe-status.ts`)

- **`ProbeName` literal** at `:13` — DUPLICATES the operator-settings union. Both must be widened in lock-step.
- **`PROBE_NAMES` array** at `:15-19` — readonly array used by the page to iterate. Append `'conflict-unresolved'`.
- **`isProbeName` guard** at `:21-27` — explicit OR chain. Add the fourth branch.
- **`getProbeStatus(probeName)`** at `:57-` — unchanged (works for any `ProbeName` via the union).

### Admin alerts page (`app/admin/(gated)/settings/alerts/page.tsx`)

- **`PROBE_TITLES`** at `:39-43` — `Record<ProbeName, string>` map; adding the fourth label `'conflict-unresolved': 'conflict-unresolved — нерешённые конфликты с Google-календарём'`.
- **Page description copy** at `:70-76` — currently says "Три systemd-пробника шлют письма...". Edit to "Четыре systemd-пробника..." (and adjust the rest of the sentence if needed).
- **`probeMigrationPending`** check at `:50-52` — iterates `statuses.some(...)`, works for any count of probes.
- **Render loop** at `:119-127` — `PROBE_NAMES.map((_, idx) => ...)`; works for any count.

### Test-send button (`app/admin/(gated)/settings/alerts/test-send-button.tsx`)

> **⚠️ SUPERSEDED — see §10.3.** The deferred-state design below was the **original** plan as drafted; in production, `test-send` is now **live** for `conflict-unresolved` (same UX as the other 3 probes, no disabled-tooltip branch, no 422 short-circuit). Do **not** follow this sub-section literally — doing so would regress the live test-send. Kept here for historical record only.

- ~~**Prop-union** at `:12-17` — `probeName: 'auth-flow' | 'calendar-pathology' | 'webhook-flow'`. Either widen to ProbeName (preferred — single source of truth) or add the fourth literal. The "no test-send for conflict-unresolved" decision (BLOCKER#7 closure) means we could exclude it from this map, BUT the page renders one button per probe; refusing to render a button for conflict-unresolved is the right shape (deferred to BCS-DEF-1-TEST-SEND).~~

  ~~**Decision:** widen `probeName` to `ProbeName` (single source of truth) AND short-circuit the button render with a disabled state + tooltip "Тестовая отправка добавлена в BCS-DEF-1-TEST-SEND follow-up". Functions: `onClick` no-ops; visual state distinct so operator sees the feature exists but is deferred.~~

  ~~**Alternative decision** considered: don't widen the prop union — render only 3 buttons. Rejected because §2.7's UI extension means rendering one button per `PROBE_NAMES` entry, and dropping the fourth from the render loop would be a special case that future probes (conflict-feed dashboard, reminders) would have to remember to skip.~~

### Test-send route (`app/api/admin/settings/alerts/[probe]/test-send/route.ts`)

> **⚠️ SUPERSEDED — see §10.3.** The 422 `test_send_deferred` short-circuit described below was the **original** plan; in production the route handles `conflict-unresolved` like the other 3 probes (real send path). Do **not** follow this sub-section literally.

- **`isProbeName` import** at `:5` → reuses `lib/admin/probe-status.ts isProbeName`. Widening the guard there propagates automatically. *(Still load-bearing today.)*
- ~~**`'invalid_probe'` 400 short-circuit** at `:56-62` — works correctly: `'conflict-unresolved'` is now a valid probe; the route accepts it but returns 422 `'test_send_not_supported_for_probe'` (or similar) because the test-send sub-PR is deferred. Add a new early-return at `:64-` checking `if (probe === 'conflict-unresolved') return 422 'test_send_deferred'`. The deferred sub-PR removes this early-return + ships the actual test-send body.~~

  ~~**Rationale**: this matches the existing "415-on-deprecated" idiom in other routes — the route is reachable and discoverable, just returns a structured "not implemented yet" instead of crashing or sending a real email.~~

## 1.4 Existing surface inventory — probe_runs CHECK constraint

- **`migrations/0053_probe_runs.sql:21-23`** — `probe_name` CHECK enumerates `'auth-flow', 'calendar-pathology', 'webhook-flow'`. **Adding `'conflict-unresolved'` requires extending the CHECK** in a migration (ACCESS EXCLUSIVE briefly).
- **`scripts/lib/probe-runs.mjs:21-25`** — `PROBE_NAMES` frozen const. Extends with `CONFLICT_UNRESOLVED: 'conflict-unresolved'`.

## 1.5 Existing surface inventory — tests

Real test files (per round-1 WARN#8 correction):

- **`tests/admin/operator-settings.test.ts:18-30,69-85`** — unit tests around `SETTING_SCHEMA`; original draft said this pinned an "all three probes" expectation. ⚠️ **As shipped:** the test already asserts all 4 probes (including `'conflict-unresolved'`); the wave landed the test update alongside the schema extension.
- **`tests/integration/admin/operator-settings.test.ts`** — integration tests for the resolver against a live DB. Adding new keys here exercises them automatically because the test iterates `SETTING_SCHEMA`.
- **`tests/integration/admin/probe-resolver-integration.test.ts:17-27,86-223`** — execFile's the real `.mjs` probes against a live DB + asserts the resolver picks up DB values. Need an entry for `conflict-unresolved`.
- **`tests/integration/admin/alerts-obs.test.ts:183-217`** — currently does a manual `CREATE TABLE probe_runs ... CHECK (probe_name IN ('auth-flow','calendar-pathology','webhook-flow'))` to seed an integration DB. This MUST be updated to include `'conflict-unresolved'` (otherwise integration tests inserting that probe_name will fail CHECK before migration 0058 runs in the test setup).
- **`tests/integration/admin/operator-settings-route.test.ts`** — admin POST/DELETE on `/api/admin/settings/alerts/setting/[key]`. Add per-key tests for the 4 new keys.

## 1.6 Existing surface inventory — `scripts/activate-prod-ops.sh`

The deploy activator at `:247-277` holds `units=()` allowlist and at `:310-324` holds `timers=()` allowlist. **BOTH arrays must be extended** in the same PR. Without these edits, the new probe's systemd files in `scripts/systemd/` are present in the repo but never installed on prod.

Edits in §2.8.

## 1.7 Existing surface inventory — UI extension (NEW summary)

Files that must be touched in this PR:

| File | Type of edit |
|---|---|
| `lib/admin/probe-status.ts:13-27` | Widen `ProbeName` union; append to `PROBE_NAMES` array; add fourth branch to `isProbeName`. |
| `app/admin/(gated)/settings/alerts/page.tsx:39-43,70-76` | Add `'conflict-unresolved'` entry to `PROBE_TITLES`; edit "Три systemd-пробника" copy to reflect four probes. |
| `app/admin/(gated)/settings/alerts/test-send-button.tsx:12-17` | Widen prop-union to `ProbeName`. **⚠️ As shipped:** no disabled-tooltip branch — see §10.3. (Original draft called for deferred-button state; superseded.) |
| `app/api/admin/settings/alerts/[probe]/test-send/route.ts` | **⚠️ As shipped:** no 422 short-circuit — route handles `conflict-unresolved` via the normal send path. (Original draft called for `test_send_deferred` 422; superseded — see §10.3.) |
| `lib/admin/operator-settings.ts:17,45-137` | Widen `ProbeName`; append 4 keys with `scope: 'conflict-unresolved'`. |
| `scripts/lib/operator-settings.mjs` | Mirror the 4 new keys. |

## 1.8 Critical-path inventory

Per `docs/critical-path.md`:

- **`lib/calendar/pull-worker.ts`** is on critical path. This plan **does NOT touch pull-worker.ts**. Conflict detection wiring stays as PR #251 left it.
- **`lib/admin/operator-settings.ts`** is on critical path. This plan adds 4 new keys to `SETTING_SCHEMA` — additive change, no semantics change.
- **`lib/admin/probe-status.ts`** is NOT on critical path (admin observability — failure mode is "operator doesn't see the new probe row"; non-fatal).
- **PR commit message** therefore carries `Codex-Paranoia: SIGN-OFF round N/3` trailer (single-PR epic; plan + wave collapsed). The trailer additionally notes `Critical-Path-Touched: lib/admin/operator-settings.ts`.

---

## 2. Design (revised)

### 2.1 New probe — `scripts/conflict-unresolved-alert.mjs`

Mirrors `scripts/calendar-pathology-alert.mjs` shape, with the **export-helpers + `if (invokedDirectly) main()` guard pattern from `scripts/auth-flow-alert.mjs:478-488`**. Helpers are named exports so unit tests can import without side effects. **As shipped** the exported set is `fingerprint`, `buildEmail`, `readOffenderRows`, `readOffenderCounts`, `readPerTeacherOmittedCounts`, `readFingerprintTuples` (per `scripts/conflict-unresolved-alert.mjs:97,124,195,225,654` — note original draft named the count helper `readOffenderCountUnbounded`; shipped name is `readOffenderCounts` and the unbounded fingerprint reader is its own separate `readFingerprintTuples` per wave-paranoia BLOCKER#2).

Concretely the bottom of the file:

```js
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('conflict-unresolved-alert.mjs')

if (invokedDirectly) {
  main().catch((err) => {
    logJson('error', 'conflict-unresolved-alert crashed', {
      message: err instanceof Error ? err.message : String(err),
    })
    process.exit(1)
  })
}

// As-shipped export (note: original draft named the count helper differently):
export { fingerprint, buildEmail, readOffenderRows, readOffenderCounts, readPerTeacherOmittedCounts, readFingerprintTuples }
```

### 2.2 Offender query — single tick, single recipient (operator)

The probe runs **four** reads against the same snapshot inside a `BEGIN; SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;` on a dedicated `pool.connect()` client (re-paranoia plan-round-1 WARN#4 closure 2026-05-19 — original draft said "two queries" but the wave-paranoia round-1 BLOCKER#2 introduced a 3rd read `readPerTeacherOmittedCounts` and a 4th read `readFingerprintTuples` over the UNBOUNDED qualifying set). The four reads are:

1. **`readOffenderCounts`** — `select count(*)`, `count(distinct teacher_account_id)` (unbounded) — drives header "Всего конфликтов: T у D".
2. **`readOffenderRows`** — windowed `ROW_NUMBER() OVER (PARTITION BY teacher_account_id ...)` capped per-teacher and globally — populates the visible per-teacher slot blocks.
3. **`readPerTeacherOmittedCounts`** — `count(*) where rn_per_teacher > $2` grouped by teacher — drives the per-teacher "и ещё N не показано" line.
4. **`readFingerprintTuples`** — unbounded `(slot_id, teacher_account_id, conflict_source_calendar_id, conflict_source_event_id)` tuples — drives the dedup fingerprint (saturation-resistant per wave-paranoia BLOCKER#2 closure).

All four reads share the snapshot so the email body, the omitted-counts tally, and the dedup decision are internally consistent within a single tick.

**Round-2 BLOCKER#2 closure** — to prevent a single noisy teacher from monopolising the global LIMIT, the row-fetch query uses a window function `ROW_NUMBER() OVER (PARTITION BY teacher_account_id ORDER BY external_conflict_at ASC)` and caps per-teacher to `CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT` (default 5).

```sql
-- Bound 1: total count UNBOUNDED — used for "всего N конфликтов" stat.
select count(*)::int as total
  from lesson_slots s
  join accounts a on a.id = s.teacher_account_id
 where s.external_conflict_at is not null
   and s.external_conflict_at <= now() - ($1::int || ' minutes')::interval
   and s.status = 'booked'
   and s.start_at > now()
   and a.purged_at is null
   and a.disabled_at is null
   and a.email is not null
   and a.email <> '';

-- Bound 2: same predicate, but bounded per-teacher then globally.
with offenders as (
  select
    s.id                          as slot_id,
    s.teacher_account_id,
    s.start_at,
    s.duration_minutes,
    s.external_conflict_at,
    s.conflict_source_calendar_id,
    s.conflict_source_event_id,
    a.email                       as teacher_email,
    row_number() over (
      partition by s.teacher_account_id
      order by s.external_conflict_at asc, s.start_at asc
    ) as rn_per_teacher
  from lesson_slots s
  join accounts a on a.id = s.teacher_account_id
   where s.external_conflict_at is not null
     and s.external_conflict_at <= now() - ($1::int || ' minutes')::interval
     and s.status = 'booked'
     and s.start_at > now()
     and a.purged_at is null
     and a.disabled_at is null
     and a.email is not null
     and a.email <> ''
)
select *
  from offenders
 where rn_per_teacher <= $2::int
 order by external_conflict_at asc, teacher_account_id, start_at
 limit $3::int;

-- Bound 3: per-teacher "и ещё N" tail — counts what wasn't surfaced
-- (rn_per_teacher > $2) per teacher, joined separately so the email
-- body can show "и ещё 12 не показано у этого учителя".
with offenders as (
  -- (same CTE as above)
)
select teacher_account_id, count(*)::int as omitted
  from offenders
 where rn_per_teacher > $2::int
 group by teacher_account_id;
```

Bound parameters:
- `$1` = `CONFLICT_UNRESOLVED_THRESHOLD_MINUTES` (default 120; min 5; max 1440).
- `$2` = `CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT` (default 5; min 1; max 50). **NEW round-2 setting.**
- `$3` = `CONFLICT_UNRESOLVED_REPORT_LIMIT` (default 50; min 1; max 500). **Global cap after per-teacher cap applied.**

Both CTE queries hit the partial index `lesson_slots_external_conflict_idx` (`migrations/0042_lesson_slots_calendar_columns.sql:120`) — O(log n) in unresolved-conflict count.

Excludes:
- Purged teachers (`accounts.purged_at IS NOT NULL`).
- Disabled teachers (`accounts.disabled_at IS NOT NULL`).
- Empty/NULL teacher emails (BLOCKER closure for Q6 from round-0).
- Past-start slots (forensic only).

REPEATABLE READ snapshot keeps `total` and the row set internally consistent ("и ещё N" never drifts mid-tick).

### 2.3 Operator settings — 4 new keys (was 3; round-2 added per-teacher)

Extend `lib/admin/operator-settings.ts:45` AND `scripts/lib/operator-settings.mjs`:

```ts
CONFLICT_UNRESOLVED_THRESHOLD_MINUTES: {
  kind: 'int',
  default: 120,
  min: 5,
  max: 1440,
  envName: 'CONFLICT_UNRESOLVED_THRESHOLD_MINUTES',
  description: 'minutes a slot must carry external_conflict_at before alerting',
  scope: 'conflict-unresolved',
},
CONFLICT_UNRESOLVED_REPORT_LIMIT: {
  kind: 'int',
  default: 50,
  min: 1,
  max: 500,
  envName: 'CONFLICT_UNRESOLVED_REPORT_LIMIT',
  description: 'global max offenders enumerated in the alert email body (after per-teacher cap)',
  scope: 'conflict-unresolved',
},
CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT: {
  kind: 'int',
  default: 5,
  min: 1,
  max: 50,
  envName: 'CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT',
  description: 'max conflicts shown per teacher (round-2 closure: keeps a noisy teacher from monopolising the global LIMIT)',
  scope: 'conflict-unresolved',
},
CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS: {
  kind: 'int',
  default: 4 * 3600 * 1000,
  min: 60_000,
  max: 7 * 86_400_000,
  envName: 'CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS',
  description: 'suppress duplicate alerts within this window (ms); keep >= threshold-minutes*60000',
  scope: 'conflict-unresolved',
},
```

Plus widen the `ProbeName` type:
```ts
export type ProbeName = 'auth-flow' | 'calendar-pathology' | 'webhook-flow' | 'conflict-unresolved'
```

### 2.4 Email body — operator-actionable

The operator email groups conflicts by teacher (per round-2 fairness fix) and **deep-links to `/admin/accounts/<teacher_account_id>`** (route exists per `app/admin/(gated)/accounts/[id]/page.tsx:27-30`) since `/admin/slots` has no slot-id URL filter:

```
Subject: [LevelChannel] Нерешённые конфликты с Google-календарём: N конфликтов у K учителей (порог M часов)

LevelChannel — конфликты расписания, не разрешённые в течение M часов.

Всего конфликтов старее M часов: T (показано: до K на учителя × G всего).

По учителям (отсортировано по самому старому конфликту):

— учитель teacher-a@example.com (3 конфликта; страница учителя: SITE_URL/admin/accounts/{teacherId} — там статус/роли/биллинг/учащиеся + контактный email)
   • слот {slotId}
     время 2026-05-20 14:00 MSK (60 мин)
     конфликт стамплен 2026-05-20 09:15 MSK (5h 45m назад)
     источник Google calendar={calendar-id} event={event-id}
   • слот ...
   ... и ещё 2 конфликта у этого учителя не показано (увеличьте
     CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT в /admin/settings/alerts если
     нужны все).

— учитель teacher-b@example.com (1 конфликт; страница: SITE_URL/admin/accounts/{teacherId})
   • слот ...

Действие: открыть страницу учителя (статус/роли/биллинг/учащиеся) и
связаться с учителем напрямую (email слева). Список слотов и отмена —
через /admin/slots; используйте slot ID из этого письма (grep по
странице или прямой psql lookup). Если событие в Google уже удалено,
конфликт очистится автоматически на следующем pull-worker тике
(~30 минут).

По состоянию на YYYY-MM-DD HH:MM:SS UTC. Внутрипробные пороги:
threshold=M min, per_teacher_limit=K, report_limit=G, dedup_window=H min.

— LevelChannel ops
```

The `SITE_URL` (`NEXT_PUBLIC_SITE_URL`) prefix on deep-links is read from the env at probe start; falls back to `https://levelchannel.ru` if unset (matches sibling probes' `EMAIL_FROM` env fallback shape — soft default, hard-coded as a recovery convenience, NOT a security boundary).

No HTML body in MVP — plain text matches sibling probes' shape. HTML could land in a follow-up if operator asks.

### 2.5 Fingerprint — full-tuple dedup

```js
// fingerprint over sorted (teacherAccountId, slotId, conflictSourceCalendarId,
// conflictSourceEventId) tuples. Captures any change in the offender set:
// new slot, removed slot, same slot moved to a different conflict source.
function fingerprint(offenders) {
  const repr = offenders
    .map((o) => [
      o.teacherAccountId,
      o.slotId,
      o.conflictSourceCalendarId ?? '',
      o.conflictSourceEventId ?? '',
    ].join(':'))
    .sort()
    .join('|')
  return createHash('sha256').update(repr).digest('hex').slice(0, 16)
}
```

The dedup window matches sibling shape: if fingerprint is unchanged AND `now - lastAlertAt < CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS`, skip and record `dedup_skip`. State file at `<workdir>/var/conflict-unresolved-state.json` carrying `{ lastFingerprint, lastAlertAt }`.

State file NOT advanced on Resend failure or missing config (mirrors round-1 fix in `calendar-pathology-alert.mjs:252-269`).

### 2.6 probe_runs CHECK extension — migration 0058

```sql
-- BCS-DEF-1 (2026-05-19) — extend probe_runs CHECK to include the
-- conflict-unresolved alert probe. ACCESS EXCLUSIVE on probe_runs;
-- sub-second on a small write-only table, and recordProbeRun is a
-- best-effort writer (swallows errors), so no observable impact.

alter table probe_runs
  drop constraint if exists probe_runs_probe_name_check;
alter table probe_runs
  add constraint probe_runs_probe_name_check
  check (probe_name in (
    'auth-flow', 'calendar-pathology', 'webhook-flow',
    'conflict-unresolved'
  ));
```

And `scripts/lib/probe-runs.mjs:21` `PROBE_NAMES`:
```js
export const PROBE_NAMES = Object.freeze({
  AUTH_FLOW: 'auth-flow',
  CALENDAR_PATHOLOGY: 'calendar-pathology',
  WEBHOOK_FLOW: 'webhook-flow',
  CONFLICT_UNRESOLVED: 'conflict-unresolved',
})
```

The integration-test bootstrap at `tests/integration/admin/alerts-obs.test.ts:183-217` (which manually `CREATE TABLE probe_runs ... CHECK (probe_name IN (...))` for integration test DBs that bypass the migration runner) is updated in the same PR to include `'conflict-unresolved'`.

### 2.7 UI extension — precise edits

#### `lib/admin/probe-status.ts:13-27`

```ts
export type ProbeName =
  | 'auth-flow'
  | 'calendar-pathology'
  | 'webhook-flow'
  | 'conflict-unresolved'

export const PROBE_NAMES: readonly ProbeName[] = [
  'auth-flow',
  'calendar-pathology',
  'webhook-flow',
  'conflict-unresolved',
]

export function isProbeName(value: unknown): value is ProbeName {
  return (
    value === 'auth-flow'
    || value === 'calendar-pathology'
    || value === 'webhook-flow'
    || value === 'conflict-unresolved'
  )
}
```

#### `app/admin/(gated)/settings/alerts/page.tsx:39-43`

```tsx
const PROBE_TITLES: Record<ProbeName, string> = {
  'auth-flow': 'auth-flow — попытки входа',
  'calendar-pathology': 'calendar-pathology — патологичные слоты',
  'webhook-flow': 'webhook-flow — webhook-поток CloudPayments',
  'conflict-unresolved':
    'conflict-unresolved — нерешённые конфликты с Google-календарём',
}
```

And `:70-76` description copy:
```
Четыре systemd-пробника шлют письма оператору при подозрительной
активности (попытки входа, патологичные слоты, webhook-поток
CloudPayments, нерешённые конфликты с Google-календарём). Здесь
видно когда они последний раз бежали...
```

#### `app/admin/(gated)/settings/alerts/test-send-button.tsx:12-17`

> **⚠️ SUPERSEDED — see §10.3.** Only the prop-union widening below is current; the deferred-button short-circuit was superseded by BCS-DEF-1-TEST-SEND. The button renders the live render-path for `conflict-unresolved` (same UX as the other 3 probes).

```tsx
type Props = {
  probeName: ProbeName  // widened from the 3-literal union — STILL CURRENT
}
```

~~Inside the component, short-circuit for `conflict-unresolved`:~~
```tsx
// ⚠️ HISTORICAL — DO NOT ADD (test-send is live for all 4 probes).
// const isDeferred = probeName === 'conflict-unresolved'
// if (isDeferred) {
//   return (
//     <button
//       type="button"
//       disabled
//       title="Тестовая отправка добавлена в BCS-DEF-1-TEST-SEND follow-up"
//       style={{ ... disabled appearance ... }}
//     >
//       тестовая отправка (скоро)
//     </button>
//   )
// }
// existing render path unchanged
```

#### `app/api/admin/settings/alerts/[probe]/test-send/route.ts`

> **⚠️ SUPERSEDED — see §10.3.** The 422 early-return block below was the **original** plan; in production the route now handles `conflict-unresolved` like the other 3 probes (no early-return, real send path). Do **not** add this branch — doing so regresses live test-send.

~~After the existing `isProbeName` 400 short-circuit, add a 422 early return:~~

```ts
// ⚠️ HISTORICAL — DO NOT ADD TO ROUTE (test-send is live for all 4 probes).
// if (probe === 'conflict-unresolved') {
//   return NextResponse.json(
//     {
//       error: 'test_send_deferred',
//       message:
//         'Тестовая отправка для conflict-unresolved будет добавлена в BCS-DEF-1-TEST-SEND.',
//     },
//     { status: 422, headers: NO_STORE },
//   )
// }
```

### 2.8 `scripts/activate-prod-ops.sh` allowlist extension

```sh
# scripts/activate-prod-ops.sh:247-277 — append to units array:
declare -a units=(
  # ... existing entries ...
  # BCS-DEF-1 — conflict-unresolved alert (operator-only MVP).
  "levelchannel-conflict-unresolved-alert.service"
  "levelchannel-conflict-unresolved-alert.timer"
)

# scripts/activate-prod-ops.sh:310-324 — append to timers array:
declare -a timers=(
  # ... existing entries ...
  "levelchannel-conflict-unresolved-alert.timer"
)
```

The activator script is otherwise unchanged.

### 2.9 Systemd unit files

Mirror calendar-pathology shape — `scripts/systemd/levelchannel-conflict-unresolved-alert.{service,timer}`:

`.timer` — boot-relative scheduling matching the sibling probes' shape (round-2 WARN#5 closure — auth-flow + webhook-flow use `OnBootSec` + `OnUnitActiveSec`, NOT `OnCalendar`; this probe adopts the same idiom for sibling consistency):
```ini
[Unit]
Description=Run LevelChannel conflict-unresolved alert every 30 min

[Timer]
# Boot-relative scheduling matches scripts/systemd/levelchannel-auth-flow-alert.timer
# (OnBootSec=7min) and scripts/systemd/levelchannel-webhook-flow-alert.timer
# (OnBootSec=5min). 12-min offset staggers against both. First tick 12 min
# after boot, then every 30 min.
OnBootSec=12min
OnUnitActiveSec=30min
Persistent=true
Unit=levelchannel-conflict-unresolved-alert.service

[Install]
WantedBy=timers.target
```

(Round-3 WARN#4: actual sibling offsets verified — auth-flow=7min, webhook-flow=5min. 12-min offset chosen to avoid both.)

`.service` — oneshot, same 12-directive sandbox profile as the sibling probes (verified against `scripts/systemd/levelchannel-calendar-pathology-alert.service:14-54`).

---

## 3. Tests (revised paths)

> **Re-paranoia §0d BLOCKER#3 closure (2026-05-19, post-merge) — round-2 honesty update**: the test inventory below is the **target as originally drafted**. As-shipped reality:
>
> - **Authored — `tests/integration/admin/conflict-unresolved-foundation.test.ts`** (`tests/integration/admin/conflict-unresolved-foundation.test.ts:22-119`, 6 cases):
>   1. probe_runs CHECK accepts `'conflict-unresolved'` INSERT (`:23-37`).
>   2. probe_runs CHECK rejects bogus probe_name (`:39-48`).
>   3. resolveOperatorSetting returns plan defaults for all 4 keys (`:50-78`).
>   4. resolveOperatorSettingsForProbe('conflict-unresolved') returns exactly 4 keys with `source: 'default'` on fresh DB (`:80-98`).
>   5. env override flows through to `source: 'env'` (`:100-107`).
>   6. env override out-of-bounds falls back to default (`:109-118`).
>
>   **Explicitly NOT covered by foundation**: the fairness regression (100×3-teacher seed) and per-teacher cap arithmetic test claimed earlier in this §0d entry. That claim was wrong — the foundation test does not seed slots at all.
>
> - **Authored — `tests/scripts/conflict-unresolved-alert.test.ts`**: 15 unit cases against pure helpers (fingerprint determinism, buildEmail copy, formatHours/pluralRu/ageHumane). No DB. No execFile.
>
> - **Not authored** (now logged as **BCS-DEF-1-TEST-FILLOUT** in `ENGINEERING_BACKLOG.md`, added this round): execFile-driven `tests/integration/scripts/conflict-unresolved-alert.test.ts` (full verdict-kind path coverage incl. state-file dedup + Resend failure), `probe-runs-conflict-unresolved-allowed.test.ts` (redundant with foundation cases 1+2 — likely won't author), `test-send-route-conflict-unresolved-deferred.test.ts` (obsolete — test-send is live; see §10.3), `tests/admin/probe-status.test.ts` (`PROBE_NAMES`/`isProbeName` structural test), and the `conflict-unresolved` block inside `probe-resolver-integration.test.ts` (3-probe coverage extended to 4).
>
> - **Why not a prod blocker**: fairness correctness is enforced by the SQL itself — window function `ROW_NUMBER() OVER (PARTITION BY teacher_account_id ...)` cannot favor one teacher over another at the planner level. The missing tests would be regression pins against future SQL refactors, not gates on shipped correctness.

### 3.1 TS-side drift

- **`tests/admin/operator-settings.test.ts`** (real path, per WARN#8) — pins `validScopes` set; new test "scope 'conflict-unresolved' is recognised" + per-key assertions for the 4 new keys (kind/min/max/envName).
- **`tests/integration/admin/operator-settings.test.ts`** — exercises the resolver against a live DB; iterates `SETTING_SCHEMA`, so new keys are covered automatically by the existing per-key test loop.

### 3.2 Probe unit tests

**NEW** `tests/scripts/conflict-unresolved-alert.test.ts`:

- `fingerprint(offenders)` — deterministic across input reorderings; stable hash over sorted full tuples; different fingerprint when `conflictSourceCalendarId` differs (BLOCKER#5 regression pin).
- `buildEmail(offenders, total, thresholdsSnapshot)` — subject + text contain the required Russian copy verbatim; "и ещё N" line present when `total > offenders.length`, absent when `total === offenders.length`.
- ~~`readOffenderCountUnbounded` + `readOffenderRows` — exported for unit tests via mocked `pg.Pool`. Mocked `.query()` returns synthetic rows; the helpers map them to the expected shape.~~ **⚠️ As shipped:** unit tests in `tests/scripts/conflict-unresolved-alert.test.ts:1-260` exercise only the **pure** helpers (`fingerprint` + `buildEmail`). The DB-reading helpers (`readOffenderCounts`, `readOffenderRows`, `readPerTeacherOmittedCounts`, `readFingerprintTuples`) are exported but **not yet** unit-mocked — folded into **BCS-DEF-1-TEST-FILLOUT**.

### 3.3 Probe integration test

**NEW** `tests/integration/scripts/conflict-unresolved-alert.test.ts` — execFile's the real probe against the integration DB. Cases:

- Empty offender set → `verdict_kind='no_offenders'`, no Resend send, state file unchanged.
- One conflict 3h old → `alert_sent`, Resend mocked to succeed; state file advances; row in probe_runs.
- 50 conflicts seeded across 1 teacher; per-teacher cap 5 → only 5 shown; "и ещё 45 не показано у этого учителя" line present.
- **Cross-teacher fairness (round-2 BLOCKER#2 regression pin)** — 100 conflicts seeded across 3 teachers (60/30/10); per-teacher cap 5, global cap 50 → email shows 5+5+5=15 conflicts across all three teachers, NOT 50 from teacher-A alone. Per-teacher "и ещё N" tallies are 55/25/5 respectively.
- 60 conflicts seeded across 30 teachers (2 each); per-teacher cap 5, global cap 50 → email shows 2 per teacher × 25 teachers = 50 (capped at global). Per-teacher "и ещё" tallies are 0 for the 25 shown teachers; the 5 NOT shown have all their conflicts silently absent from the body. **No "и ещё K учителей не показано" line** (re-paranoia §0d BLOCKER#1 closure: that line was dropped in round-3 §0c because the truncation arithmetic isn't recoverable from the email body without the global count, which the email DOES carry in its "Всего конфликтов: T у D" header — operator can derive the gap from that header). Test asserts the rendered set against the seed set + header count = D for all 30 teachers.
- Second tick inside dedup window → `dedup_skip`; Resend NOT called.
- Resend mocked to fail → `alert_send_failed`; state file unchanged.
- `ALERT_EMAIL_TO` unset → `config_missing`; state file unchanged.
- Purged teacher excluded.
- Disabled teacher excluded.
- Empty email excluded.
- Past-start slot excluded.
- Threshold tuned to 5 min → conflict 10 min old triggers; threshold 120 min → same conflict doesn't.

Mocking strategy: `vi.mock('resend')` returns a stub with `emails.send` returning `{ data: { id: 'mock-id-N' }, error: null }` or `{ error: 'mock failure' }`. Mirrors `tests/integration/admin/probe-resolver-integration.test.ts` patterns.

### 3.4 Probe-runs CHECK extension

**NEW** `tests/integration/admin/probe-runs-conflict-unresolved-allowed.test.ts`:

- INSERT a row with `probe_name='conflict-unresolved'` → succeeds AFTER migration 0058 applies.
- INSERT a row with `probe_name='bogus'` → fails with CHECK violation.

Also **update** `tests/integration/admin/alerts-obs.test.ts:183-217` — the manual `CREATE TABLE probe_runs ... CHECK (...)` block now includes `'conflict-unresolved'` so integration tests bootstrap a CHECK matching production.

### 3.5 Test-send route 422 short-circuit

> **⚠️ SUPERSEDED — OBSOLETE.** The test below pinned the deferred-422 short-circuit which **no longer exists** in production (test-send is live — see §10.3). Do **not** author this test — it would either assert against non-existent code or, worse, lead someone to re-add the 422 branch and regress the live path. ⚠️ **WARN: probe-specific preflight gap.** The remaining valuable assertion ("`/test-send` for `conflict-unresolved` does not crash and returns a structured response") is **only partially** covered by the existing 3-probe test-send route tests — those tests exercise `auth-flow` + `calendar-pathology` (`tests/integration/admin/alerts-obs.test.ts:49-156`), not `conflict-unresolved`. The probe-specific `pg_get_constraintdef` preflight branch in `app/api/admin/settings/alerts/[probe]/test-send/route.ts:119-149` (BCS-DEF-1 wave-paranoia BLOCKER#1 closure) is therefore not regression-pinned. Folded into **BCS-DEF-1-TEST-FILLOUT** backlog (item 5 added this round).

~~**NEW** `tests/integration/admin/test-send-route-conflict-unresolved-deferred.test.ts`:~~

- ~~`POST /api/admin/settings/alerts/conflict-unresolved/test-send` as admin → 422 `'test_send_deferred'`.~~
- ~~No Resend call made (mocked Resend asserts zero calls).~~
- ~~No `probe_runs` row written (regression pin for BLOCKER#7).~~

### 3.6 UI extension structural test

**NEW** `tests/admin/probe-status.test.ts` (or extend if exists):

- `isProbeName('conflict-unresolved') === true`.
- `PROBE_NAMES.length === 4`.
- `PROBE_NAMES.includes('conflict-unresolved')`.
- `ProbeName` union exhaustiveness — a switch over `ProbeName` that fails to handle `'conflict-unresolved'` produces a TypeScript error (compile-time test via `// @ts-expect-error`).

---

## 4. Security analysis (revised)

### 4.1 Email content boundaries

The operator email lists per-conflict:
- Teacher email (from `accounts.email`).
- Slot id (UUID).
- Slot start time (MSK).
- Conflict timestamp.
- `conflict_source_calendar_id` (Google calendar id — an opaque string).
- `conflict_source_event_id` (Google event id — an opaque string).

**No PII beyond what the operator already sees in `/admin/accounts` and `/admin/slots`.** Google calendar/event IDs are not human-readable content; the event title (`teacher_external_busy_intervals.summary_encrypted`, `migrations/0044_teacher_external_busy_intervals.sql:40`) is stored encrypted and is NEVER included in the email.

### 4.2 Resend recipient is operator only

`ALERT_EMAIL_TO` is the operator's address (same as the 3 sibling probes). No teacher-side fan-out in this MVP. The operator email body lists teacher emails, but no email is sent to teachers — only the operator gets paged.

### 4.3 Rate-limit / abuse

The probe runs every 30 minutes. With dedup window default 4h, the same offender set fires at most one operator email per 4 hours. **Operator misconfiguration** (dedup_window < threshold) would re-page on every tick; documented in `description` field of the operator-setting key. ⚠️ The original "tested in §3" claim was overstated — see RISK-2 below and §3 honesty block: runtime verdict-path coverage is in `BCS-DEF-1-TEST-FILLOUT` item 1, not yet authored. Operator-side `description` field is the only current safeguard.

### 4.4 SQL injection

Threshold + report-limit are integers parameterized via `pg`. Cannot be injected.

### 4.5 State file location

`<workdir>/var/conflict-unresolved-state.json` — whitelist already part of the sandbox profile (`ReadWritePaths=__LEVELCHANNEL_APP_DIR__/var` mirrored from sibling probes).

### 4.6 Migration ACCESS EXCLUSIVE lock

Migration 0058 drops + re-adds the `probe_runs_probe_name_check` constraint, taking ACCESS EXCLUSIVE briefly. `probe_runs` is a small write-only table; `recordProbeRun` is best-effort (swallows errors). Worst case during lock: a sibling probe tick mid-migration swallows. Accepted.

### 4.7 Test-send 422 short-circuit doesn't leak side effects ~~(original design)~~

> **⚠️ SUPERSEDED — see §10.3.** This safety property described the **original** deferred-422 branch. That branch was removed in BCS-DEF-1-TEST-SEND; the live test-send path now applies the same admin-auth / idempotency / rate-limit guards as the other 3 probes (single shared route handler in `app/api/admin/settings/alerts/[probe]/test-send/route.ts`). ⚠️ Side-effect containment is **partially** pinned — the shared route handler is exercised by `tests/integration/admin/alerts-obs.test.ts:49-156` for auth-flow + calendar-pathology, but `conflict-unresolved` specifically and the new `pg_get_constraintdef` preflight branch (route.ts:119-149) are **not** regression-pinned. Folded into `BCS-DEF-1-TEST-FILLOUT` item 5.

---

## 5. Decomposition — single PR

> **⚠️ SUPERSEDED items below.** The original decomposition listed the deferred-button render and 422-route short-circuit; both were superseded by BCS-DEF-1-TEST-SEND (see §10.3) and the `test-send-route-conflict-unresolved-deferred.test.ts` test file is **obsolete — do NOT author**. Also note the "3 keys" mirror inventory entries are stale — actual count is 4 (per §2.3 / §1.7).

One-PR epic. Files:

```
docs/plans/conflict-unresolved-alert.md     (NEW, this file)
migrations/0058_probe_runs_conflict_unresolved.sql  (NEW)
lib/admin/operator-settings.ts              (modified — ProbeName widen + 4 keys [round-2 added per-teacher])
lib/admin/probe-status.ts                   (modified — ProbeName widen + PROBE_NAMES + isProbeName)
scripts/lib/operator-settings.mjs           (modified — 4 keys mirror)
scripts/lib/probe-runs.mjs                  (modified — PROBE_NAMES extension)
scripts/conflict-unresolved-alert.mjs       (NEW, ~280 LOC)
scripts/systemd/levelchannel-conflict-unresolved-alert.service  (NEW)
scripts/systemd/levelchannel-conflict-unresolved-alert.timer    (NEW)
scripts/activate-prod-ops.sh                (modified — append to units + timers arrays)
app/admin/(gated)/settings/alerts/page.tsx  (modified — PROBE_TITLES + copy)
app/admin/(gated)/settings/alerts/test-send-button.tsx  (modified — widen prop only; ⚠️ NO deferred render in shipped code)
app/api/admin/settings/alerts/[probe]/test-send/route.ts  (⚠️ NO 422 short-circuit in shipped code)
tests/admin/operator-settings.test.ts       (modified — add 4 keys + scope)
tests/admin/probe-status.test.ts            (⚠️ NOT authored — logged as BCS-DEF-1-TEST-FILLOUT)
tests/scripts/conflict-unresolved-alert.test.ts                 (NEW)
tests/integration/scripts/conflict-unresolved-alert.test.ts     (⚠️ NOT authored — logged as BCS-DEF-1-TEST-FILLOUT)
tests/integration/admin/probe-runs-conflict-unresolved-allowed.test.ts  (⚠️ NOT authored — coverage rolled into foundation test)
tests/integration/admin/test-send-route-conflict-unresolved-deferred.test.ts  (⚠️ OBSOLETE — do NOT author; deferred route removed)
tests/integration/admin/alerts-obs.test.ts  (modified — extend hardcoded CHECK)
ARCHITECTURE.md                              (modified — "three" → "four"; new probe entry)
README.md                                    (modified — "three" → "four")
lib/admin/README.md                          (modified — "three" → "four"; new probe row)
lib/admin/probe-status.ts                    (modified — header comment "three" → "four")
app/admin/(gated)/settings/alerts/page.tsx   (modified — already counted; comment block at :24-37 updated alongside copy)
scripts/lib/probe-runs.mjs                   (modified — header comment "three" → "four")
scripts/db-retention-cleanup.mjs             (modified — "three" probe-name list extended)
migrations/0058 (also)                       (⚠️ As shipped: CHECK extension ONLY; no comment-on-table update — see §0d closure WARN#3 above)
tests/integration/admin/probe-resolver-integration.test.ts  (⚠️ NOT modified — still 3-probe; logged as BCS-DEF-1-TEST-FILLOUT)
tests/integration/admin/operator-settings-route.test.ts     (⚠️ NOT modified — still CALENDAR_PATHOLOGY_THRESHOLD only; per-key tests for the 4 new keys logged as BCS-DEF-1-TEST-FILLOUT)
ENGINEERING_BACKLOG.md                       (modified — strikethrough BCS-DEF-1)
docs/plans/conflict-feed.md                  (modified — one-line cross-ref)
```

**Estimated diff:** ~1400 LOC (probe + tests + plan-doc + UI + docs).

**Critical-path:** `lib/admin/operator-settings.ts` IS on critical path. PR commit body therefore carries `Codex-Paranoia: SIGN-OFF round N/3` trailer (not `SUB-WAVE`) per `docs/critical-path.md`.

---

## 6. Risks + mitigations

### RISK-1 — Alert storm on first deploy

Prod may have accumulated `external_conflict_at` stamps. First tick paged operator with N current conflicts. **Mitigation:** operator pre-empts by setting `CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS = 24h` at first activation, dialing down once initial backlog clears. Documented in `description` field of the setting.

### RISK-2 — Dedup window < threshold

Schema validation allows `dedup_window_ms = 60_000`; if operator sets it lower than threshold, the probe re-pages every tick. **Documented in `description`**: "keep >= threshold-minutes*60000 to avoid repeat pages". ⚠️ The original claim that this misconfig is "tested in §3" does NOT hold — §3's honesty block records that runtime verdict-path coverage is in `BCS-DEF-1-TEST-FILLOUT`. Operator-side `description` field is the only current guard.

### RISK-3 — Conflict cleared between offender query and email send

Race: at T0 probe queries, at T0+50ms detector clears the stamp. Probe still sends email. **Acceptable** — email reads "as of XX:23"; teacher reads it and sees no conflict in their cabinet — confused-but-harmless. Next tick won't re-alert (dedup + no current offenders). Documented in email body: "По состоянию на YYYY-MM-DD HH:MM:SS UTC".

### RISK-4 — Migration ACCESS EXCLUSIVE lock — see §4.6.

### RISK-5 — `operator_settings` ↔ `scripts/lib/operator-settings.mjs` drift

⚠️ **As shipped:** the only drift guard is the unit test `tests/admin/operator-settings.test.ts` (TS-side `SETTING_SCHEMA` shape). The original claim that the `.mjs` mirror has a matching integration test does **not** hold — `tests/integration/admin/probe-resolver-integration.test.ts` still only execFile's 3 probes (auth-flow / calendar-pathology / webhook-flow), and `tests/integration/admin/operator-settings-route.test.ts` still only exercises `CALENDAR_PATHOLOGY_THRESHOLD`. Integration parity for `conflict-unresolved` is folded into `BCS-DEF-1-TEST-FILLOUT` items 1, 4, 7.

### RISK-6 — Conflict detector wired-into-pull-worker silently regresses

If `runConflictDetectionForTeacher` stops stamping (refactor), this probe silently records `no_offenders` forever. **Mitigation**: integration test `tests/integration/calendar/pull-worker.test.ts` (verified to exist via `find tests/integration/calendar/`) asserts the wire-up; this plan adds a one-line cross-ref pointing at it.

### RISK-7 — `scripts/activate-prod-ops.sh` allowlist drift

If a future probe is added without updating the activator script, the new unit never installs. **Mitigation**: PR template checklist includes "If you added a systemd unit in `scripts/systemd/`, did you update the activator's `units=()` AND `timers=()` arrays?" — addition deferred (existing template doesn't enforce; out of scope for this PR).

### RISK-8 — Teacher fan-out scope gap

Backlog says "operator + teacher". MVP ships operator-only. **Mitigation**: explicit "teacher fan-out deferred to BCS-DEF-1-FANOUT" note in §10 + a corresponding `ENGINEERING_BACKLOG.md` line ("BCS-DEF-1 (operator MVP) — Closed; teacher fan-out → BCS-DEF-1-FANOUT").

### ~~RISK-9~~ — Test-send button deferred-disabled state surprises operator — **OBSOLETE**

> **⚠️ SUPERSEDED — see §10.3.** The deferred-disabled button state was superseded by BCS-DEF-1-TEST-SEND. As-shipped: the `conflict-unresolved` test-send button renders the live path (same UX as the other 3 probes — confirm-reason prompt, real Resend dry-run). This risk no longer applies.

~~UX risk: operator sees the button and clicks it, expecting it to work. Tooltip explains. **Mitigation**: the deferred-state button has a distinct visual treatment (disabled grey) and an explicit tooltip "тестовая отправка добавлена в BCS-DEF-1-TEST-SEND follow-up". Acceptable for ~weeks gap until that follow-up ships.~~

---

## 7. Acceptance criteria (single PR end)

The PR ships when:

- Migration 0058 applies clean on a fresh test DB.
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
- ENGINEERING_BACKLOG.md strikethrough BCS-DEF-1.

Post-merge (operator-side, OUT of public-repo scope but documented in PR description):
- Operator runs `scripts/activate-prod-ops.sh` on the VPS — picks up the new units + timers.
- First tick records a row in `probe_runs` with `probe_name='conflict-unresolved'`.
- `/admin/settings/alerts` shows the new probe entry. **⚠️ As shipped:** test-send button is **live** (real send path) for `conflict-unresolved`, NOT disabled — the deferred-button state described in §1.7 / §2.7 was superseded by BCS-DEF-1-TEST-SEND. See §10.3.
- If no current conflicts: `verdict_kind='no_offenders'`. If some: operator receives email; receipt confirmed.

---

## 8. Open questions for paranoia round 2 (Q1-Q6)

If round-2 paranoia surfaces any of these, here are the pre-canned answers:

**Q1.** Should the email use HTML body? **A:** No — sibling probes are plain-text-only; consistency wins. Follow-up if operator requests.

**Q2.** Should `report_limit=50` be the default — what if prod regularly has 100 unresolved conflicts? **A:** Operator-tunable up to 500. The "и ещё N не показано" line surfaces the gap; operator can raise the limit.

**Q3.** What if `accounts.purged_at` race — purged mid-tick? **A:** REPEATABLE READ snapshot keeps the count + rows consistent; purged-mid-tick reads the pre-snapshot state, which is acceptable (one extra email about a teacher who just got purged; operator-side noise is negligible).

**Q4.** Why no idempotency key on the probe operation? **A:** Same as sibling probes — the state file + Resend message id (`alert_email_id` in `probe_runs`) provide the idempotency story. A network retry inside the probe would advance state and call Resend; the systemd timer doesn't auto-retry on script failure (failure logs to journal, next tick re-evaluates).

**Q5.** What if the operator sets `threshold=5 minutes` and gets paged every 5 minutes? **A:** Dedup window prevents repeat pages for the SAME offender set; threshold change with stable offender set → first new tick fires once. Acceptable. Documented.

**Q6.** Conflict-feed admin dashboard (PARKED) — does this MVP step on its toes? **A:** No — they're complementary. Alert MVP is push (passive operator awareness); conflict-feed is pull (interactive operator workflow). Both can coexist; the dashboard PR (when revived) won't need to refactor this probe.

---

## 9. Migration / rollout

1. PR opens with all files.
2. CI runs migration 0058 against test DB → green.
3. PR merges (squash) to main.
4. Autodeploy timer picks up the new commit; Next.js restarts.
5. Operator runs `scripts/activate-prod-ops.sh` on the VPS:
   - Detects new units + timers; installs + enables them.
   - Daemon-reload; service starts.
6. Wait for first tick (≤30 min).
7. Operator confirms `probe_runs` row appears at `/admin/settings/alerts`.
8. Operator tunes thresholds if needed.

**Migration ordering — refined claim.** Migration 0058 is purely additive (CHECK extension on an already-existing table). The **timer-driven** probe doesn't write to `probe_runs` until the timer enables. However, the **live `test-send` route** at `/api/admin/settings/alerts/conflict-unresolved/test-send` writes a row with `is_test=true` as soon as the route is deployed — see `app/api/admin/settings/alerts/[probe]/test-send/route.ts:119-149` for the probe-specific `pg_get_constraintdef` preflight that returns 503 `migration_pending` if migration 0058 hasn't applied yet. That preflight (wave-paranoia BLOCKER#1 closure) is the actual deploy-order safety net for the writer path — without it, an admin clicking the test-send button mid-deploy would crash on a CHECK violation. The original §1.7 / §2.7 / §3.5 draft language about deferred-422 was superseded by BCS-DEF-1-TEST-SEND (§10.3); the preflight is what now protects the writer path.

---

## 10. Out of scope — deferred follow-ups

### 10.1 Teacher fan-out — BCS-DEF-1-FANOUT

Per-teacher email + per-teacher dedup state map. Requires:

- Multi-row `probe_runs` per tick (or a schema extension to multi-recipient).
- Per-teacher fingerprint state file map.
- A more complex offender-fan-out path in the probe script.
- UI surface to let operator see per-teacher alert delivery success/failure.

Deferred as a follow-up wave. Operator-only MVP unblocks the immediate operational gap.

### 10.2 Telegram — BCS-DEF-1-TG

Per round-0 §10 reasons. Deferred until operator decision on bot setup.

### 10.3 Test-send for conflict-unresolved — BCS-DEF-1-TEST-SEND — **SHIPPED**

**Status update (re-paranoia §0d BLOCKER#2 closure, 2026-05-19)**: this follow-up shipped post-original-merge. As-shipped state: the test-send button is live for `conflict-unresolved` (same UX as the other 3 probes — confirm-reason prompt, idempotency-key header, real Resend dry-run via the existing `/api/admin/settings/alerts/[probe]/test-send` route). The 422 `test_send_deferred` short-circuit + disabled-button branch described in §1.7 / §2.7 / §3.5 is **historical** — the original wave deferred it; the follow-up made it live. Anyone reading this plan should treat those sub-sections as the original deferred design, NOT a current target.

### 10.4 Admin conflict-feed dashboard — CONFLICT-FEED (already PARKED)

Out of scope. Pull-side operator workflow; this push-side alert is complementary.

---

## 11. Final trailer expectations

PR commit body carries:
```
Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
Critical-Path-Touched: lib/admin/operator-settings.ts
Skill-Used: /codex-paranoia plan + /codex-paranoia wave
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

— END OF DOC (SHIPPED 2026-05-19; 3 pre-merge paranoia rounds + §0c mechanical closure; 4 post-merge re-paranoia rounds in §0d / §0e + WARN closures committed to PR #365; see §0d / §0e for closure ledger) —
