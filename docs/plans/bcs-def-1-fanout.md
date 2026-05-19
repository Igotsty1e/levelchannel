# BCS-DEF-1-FANOUT — teacher fan-out follow-up to the operator-only MVP

**Status:** DRAFT 2026-05-18 (plan-doc only; paranoia plan-mode is the next step).
**Wave name:** `bcs-def-1-fanout` (one-PR epic — see §5).
**Trigger:** Backlog item BCS-DEF-1 originally scoped operator + per-teacher
notification. The operator-only MVP shipped 2026-05-19 (RFC #316, commit
`21380f9`); teacher fan-out was explicitly deferred (see
`docs/plans/conflict-unresolved-alert.md:840-849` §10.1). This plan picks up
that deferred scope.
**Author:** Claude (autonomous).
**Telegram path:** still deferred to BCS-DEF-1-TG (see §10).
**Test-send for `conflict-unresolved`:** still deferred to BCS-DEF-1-TEST-SEND
(operator-only MVP shipped a 422 short-circuit; this plan does not unblock that).

---

## 1. Goal

After the operator-only MVP, an unresolved external calendar conflict
(`lesson_slots.external_conflict_at` older than threshold) sends ONE email
to `ALERT_EMAIL_TO`. The operator must then manually contact each affected
teacher. BCS-DEF-1-FANOUT closes the second leg: each affected teacher ALSO
receives their own email (only their own conflicts; no cross-teacher
leakage) so they can self-serve. Operator email keeps firing unchanged.
Out of scope (§10): Telegram (BCS-DEF-1-TG), test-send (BCS-DEF-1-TEST-SEND),
per-teacher preferred-channel routing.

---

## 1.1 Existing surface inventory — `probe_runs` schema is single-recipient today

`migrations/0053_probe_runs.sql:19-52` defines `probe_runs` — one row per
probe tick. Load-bearing columns for the fan-out decision:

- `:21-23` — `probe_name text check (...)`; extended to include
  `'conflict-unresolved'` in `migrations/0058_probe_runs_conflict_unresolved.sql:21-26`.
- `:25-39` — `verdict_kind text check (...)` — single verdict per row;
  already enumerates `alert_sent`, `alert_send_failed`, `dedup_skip`.
- `:41` — `recipient_email text` — **single string column** (per the comment
  at `migrations/0053_probe_runs.sql:71-73`: "Snapshot of ALERT_EMAIL_TO at
  send time"). This is the schema constraint that drives §2.1's "N+1 rows"
  decision.
- `:42` — `alert_email_id text` — single Resend message id per row.
- `:43` — `fingerprint text` — single fingerprint per row.
- `:44` — `stats jsonb` — structured blob (the operator MVP already stuffs
  `thresholds`, `thresholds_source`, `totalConflicts`, `totalTeachers`,
  `shown` here per `scripts/conflict-unresolved-alert.mjs:444-450`).
- `:46` — `is_test boolean`.
- `:54-62` — indexes `(probe_name, ran_at desc)` (partial on
  `is_test=false`); neither index includes `recipient_email`.

## 1.2 Existing surface inventory — operator-MVP probe shape

`scripts/conflict-unresolved-alert.mjs`. Parts the fan-out reshapes:

- **State file** path at `:71-73`. **Read/write shape** at `:357-369`:
  `{ lastAlertAt: number | null, lastFingerprint: string | null }` — single
  fingerprint, single timestamp. Must extend to per-teacher map (§2.3).
- **Single email recipient** at `:75` — `ALERT_EMAIL_TO` env. Fan-out adds a
  per-teacher loop reading `teacher_email` (already projected from
  `accounts.email` in the offender CTE — `:140` and `:154`).
- **Five `recordProbeRun` call-sites** — `:419-428` no_offenders,
  `:465-471` dedup_skip, `:481-491` config_missing, `:511-519` +
  `:524-533` alert_send_failed, `:544-552` alert_sent. Each writes one
  row carrying `recipientEmail = ALERT_EMAIL_TO` (snapshot via
  `recipientEmailSnapshot` at `:411`).
- **Single email body** — `buildEmail()` at `:265-337`. Fan-out adds a
  SECOND template `buildTeacherEmail()` producing a per-teacher body.
- **Dedup fingerprint** at `:225-238` — sha256 over sorted full tuples
  `(teacherAccountId, slotId, conflictSourceCalendarId, conflictSourceEventId)`.
  Fan-out needs a per-teacher variant (same hash, group-key removed —
  §2.3).
- **Offender query** at `:124-180` already projects `teacher_account_id` +
  `teacher_email` and filters `purged_at`/`disabled_at`/empty email. Reused
  unchanged.
- **Operator-settings keys** — 4 already exist in
  `lib/admin/operator-settings.ts:151-195`. Fan-out adds 3 keys (§2.5).
- `isProbeName` / `PROBE_NAMES` / `PROBE_TITLES` already include
  `'conflict-unresolved'` (shipped with the operator MVP). No type-level
  changes here.

## 1.3 Current MVP behavior summary

Per tick: resolve thresholds → read counts → if 0 write `no_offenders`,
else read rows + omitted counts → compute SINGLE fingerprint → dedup-skip
if unchanged within window → build SINGLE operator email → send to
`ALERT_EMAIL_TO` → write ONE row + advance state file. The unit of
observability is the tick, not the teacher.

---

## 2. Design — fan-out shape

### 2.1 Top-level shape decision — `probe_runs` row layout

**Decision:** ONE operator row per tick (unchanged shape) **plus** N
additional rows per tick — one per teacher recipient. Each per-teacher row
carries `recipient_email = teacher.email`, `verdict_kind` reflecting the
per-teacher Resend outcome (`alert_sent` / `alert_send_failed` /
`dedup_skip`), `stats.fanout = { teacherAccountId, slotCount, omitted, role:'teacher' }`,
`fingerprint = perTeacherFp`.

**Why N+1 rows vs one row + `stats.fanout[]` array:**

| Option | Pros | Cons |
|---|---|---|
| **N+1 rows (chosen)** | Per-recipient `alert_email_id` lands in its native column (`:42`); per-recipient dedup observable in `/admin/settings/alerts` if extended; bounce reconciliation maps cleanly; `verdict_kind` CHECK already supports per-recipient values. | Multiplies row count by K ≤ `TEACHER_FANOUT_CAP` (default 100) — small vs the 90-day retention sweep (`scripts/db-retention-cleanup.mjs`). |
| One row + `stats.fanout[]` | Atomic tick = one row. | Loses per-recipient `alert_email_id` indexability; mismatches the `recipient_email` column's "single recipient" semantics (`migrations/0053_probe_runs.sql:71-73`); `verdict_kind` can't reflect partial success ("3 sent, 2 failed" has no enum value); future bounce parsing has to walk a JSON array. |

The existing schema columns (`recipient_email`, `alert_email_id`,
`fingerprint`) are shaped for one recipient per row. N+1 honors that
intent without a migration. The operator row remains the canonical tick
record for the "last run per probe" idx.

**Probe-status reader race.** `lib/admin/probe-status.ts getProbeStatus()`
returns the most recent row by `(probe_name, ran_at desc)`. After fan-out
there are 1+K rows for the same tick at near-microsecond `ran_at`. **Fix:**
the operator row INSERT happens LAST so it sorts as latest. Pinned by
integration test §3.2 "operator row sorts last".

**No migration** — `verdict_kind` CHECK at `migrations/0053_probe_runs.sql:25-39`
already enumerates the verdicts fan-out writes; `probe_name` already
includes `'conflict-unresolved'` via migration 0058.

### 2.2 Top-level fan-out flow

Per tick:

1. Resolve thresholds (existing 4 keys + 3 new keys per §2.5).
2. Read offender counts + offender rows + per-teacher omitted counts
   (UNCHANGED queries).
3. If `totalConflicts == 0` → write ONE operator `no_offenders` row, zero
   teacher rows, exit.
4. Group rows by `teacherAccountId`.
5. Compute per-teacher fingerprint (sha256 over sorted
   `(slotId, conflictSourceCalendarId, conflictSourceEventId)` tuples —
   teacher id is the group key, contributes nothing).
6. Read state file; per-teacher dedup vs `state.perTeacher[teacherAccountId]`.
7. For each non-deduped teacher (capped by
   `CONFLICT_UNRESOLVED_TEACHER_FANOUT_CAP`, default 100 — see §6 RISK-1):
   - Build per-teacher email via `buildTeacherEmail(group, omitted, thresholds)`.
   - Send to `group.teacherEmail` via Resend serially (NOT `Promise.all`).
   - On success → row with `verdict_kind='alert_sent'`, advance
     `state.perTeacher[id]`.
   - On Resend failure → row with `verdict_kind='alert_send_failed'`, **do
     NOT advance** state.perTeacher[id] (next tick retries).
   - For deduped teachers → write `dedup_skip` row; skip Resend.
8. Send operator email (existing path; unchanged copy + recipient + dedup
   using the GLOBAL operator fingerprint from MVP).
9. Write operator row LAST (per §2.1).
10. Advance state file: both `operator.{lastAlertAt, lastFingerprint}` AND
    `perTeacher[id]` for every teacher row that wrote `alert_sent`.

Operator-side success/failure is independent of teacher-side
success/failure — they are independent state branches.

### 2.3 State file shape — extend single fingerprint to per-teacher map

**Today** (`scripts/conflict-unresolved-alert.mjs:357-369`):

```json
{ "lastAlertAt": 1747639200000, "lastFingerprint": "abcd1234..." }
```

**After BCS-DEF-1-FANOUT:**

```json
{
  "operator": { "lastAlertAt": 1747639200000, "lastFingerprint": "abcd1234..." },
  "perTeacher": {
    "<teacher_account_id_uuid>": {
      "lastAlertAt": 1747639200000,
      "lastFingerprint": "ef567890..."
    }
  },
  "schemaVersion": 2
}
```

**Migration on read.** `readState()` accepts either v1 (legacy MVP top-level
keys) or v2 (nested). v1 is migrated in-memory to
`{operator: {...legacy}, perTeacher: {}, schemaVersion: 2}` on first tick
after fan-out deploys; first `writeState()` after that persists v2. **No
filesystem migration step; self-healing on next tick.** Test pin in §3.

**Garbage collection.** `perTeacher` entries are pruned when
`lastAlertAt < now - PER_TEACHER_STATE_TTL_MS` (default 30d, hardcoded —
state file is local probe debt, not a user-facing knob). Test pin in §3.

**Concurrent writers.** systemd timer is OneShot; one process at a time.
`mkdir + writeFile` (`:366-369`) is sufficient. No lock needed.

### 2.4 Per-teacher email template (Russian)

Audience "учитель" — `docs/content-style.md` §2 matrix row (formality
«вы», деловой; vocabulary tolerance средняя).

**Subject** (§8 — 4–8 words, fact-first, NO `[LevelChannel]` prefix
because §8 reserves it for operator-only mail):
`Конфликты в расписании: N занятий пересекаются с Google-календарём`
(plural-aware on "занятие/занятия/занятий" via existing `pluralRu` at
`scripts/conflict-unresolved-alert.mjs:339-345`).

**Greeting (§8):** `Здравствуйте.` (period; no name — probe doesn't fetch
`accounts.full_name` today; §8 allows blank-name fallback). // TODO: open
question for paranoia round 1 — wire `accounts.full_name` greeting or
accept cold-start "Здравствуйте."?

**Body skeleton** (§8 — fact → action → details → sign-off):

```
Здравствуйте.

В вашем расписании на LevelChannel есть {N} {занятие/занятия/занятий},
время которых пересекается с событиями из вашего Google-календаря.
{ageHumane} назад мы это заметили и до сих пор не видим, что вы
разрешили конфликт со стороны календаря.

Что делать:
- Откройте Google-календарь и удалите или перенесите конфликтующее
  событие, если занятие на LevelChannel остаётся в силе. Конфликт
  снимется автоматически на следующей синхронизации (~30 минут).
- Если хотите отменить занятие, откройте расписание:
  {SITE_URL}/cabinet — занятие можно отменить до начала.

Подробности:

— Занятие {slotId-short}
  Время: {18 мая, 14:30 MSK} ({60 мин})
  Конфликт замечен: {18 мая, 09:15 MSK} ({ageHumane})

... (до {PER_TEACHER_LIMIT})

{Если omitted > 0:}
... и ещё {omitted} {конфликт/конфликта/конфликтов} в вашем
расписании. Чтобы увидеть полный список, откройте кабинет.

По состоянию на {ISO timestamp}.

— Команда LevelChannel
```

Style-guide compliance (`docs/content-style.md`):

- §3.1 fact-first; §3.2 verbs over noun forms; §3.3 active voice;
  §3.6 no emoji; §3.7 no apology.
- §4 forbidden: "слот" must NOT appear in teacher-visible copy (§4 "Слот
  → занятие"). Use "Занятие" + short slot id. Operator email keeps
  "слот" (operator tolerance higher per §2). // TODO: open question for
  paranoia round 1 — full slot UUID or shortened form? Operator uses
  full UUID at `:296`; teachers have no UUID lookup in `/cabinet`.
- §8 subject 4–8 words, no `[LevelChannel]` prefix; sign-off "— Команда
  LevelChannel" with em-dash («—», not «-»).
- §9 plurals via `pluralRu`; §9 dates via existing `formatMsk` at
  `:240-249`.

Plain text only, no HTML. `teacher_email` comes from the offender CTE
at `:177` and is guaranteed non-empty (filtered at `:107-110, 151-154`).

### 2.5 New operator-settings keys (3)

Extend `lib/admin/operator-settings.ts:151-195` AND
`scripts/lib/operator-settings.mjs`:

```ts
CONFLICT_UNRESOLVED_TEACHER_FANOUT_ENABLED: {
  kind: 'int',        // 0 or 1 — no 'bool' kind exists in SETTING_SCHEMA
  default: 0,         // OFF by default — operator opts in
  min: 0, max: 1,
  envName: 'CONFLICT_UNRESOLVED_TEACHER_FANOUT_ENABLED',
  description: 'master switch for per-teacher email fan-out (0 = off, 1 = on); off-by-default to avoid surprise mailbox storm',
  scope: 'conflict-unresolved',
},
CONFLICT_UNRESOLVED_TEACHER_DEDUP_WINDOW_MS: {
  kind: 'int',
  default: 12 * 3600 * 1000,  // 12h — wider than operator 4h; teacher
                              // action is slower (mailbox, not on-call)
  min: 60_000, max: 7 * 86_400_000,
  envName: 'CONFLICT_UNRESOLVED_TEACHER_DEDUP_WINDOW_MS',
  description: 'per-teacher dedup window (ms); at most one email per window per stable fingerprint',
  scope: 'conflict-unresolved',
},
CONFLICT_UNRESOLVED_TEACHER_FANOUT_CAP: {
  kind: 'int',
  default: 100,
  min: 1, max: 1000,
  envName: 'CONFLICT_UNRESOLVED_TEACHER_FANOUT_CAP',
  description: 'max distinct teachers emailed per tick (defence vs alert-storm and Resend rate-limit)',
  scope: 'conflict-unresolved',
},
```

The drift test (`tests/admin/operator-settings.test.ts`) catches TS ↔
MJS divergence on these 3 keys automatically.

### 2.6 Edits inside `scripts/conflict-unresolved-alert.mjs`

| Region | Edit |
|---|---|
| `:60` imports | No change. |
| `:66-69` module `let` | Add `TEACHER_FANOUT_ENABLED=0`, `TEACHER_DEDUP_WINDOW_MS=12*3600*1000`, `TEACHER_FANOUT_CAP=100`. |
| `:225-238` `fingerprint` | Keep (operator path). Add `perTeacherFingerprint(group)` — same hash, `(slotId, calendarId, eventId)` tuples. |
| `:265-337` `buildEmail` | Unchanged. Add exported `buildTeacherEmail(group, omitted, thresholds)` per §2.4. |
| `:355-369` state I/O | Rewrite to v2 with v1 backward-read (§2.3). Test pin §3. |
| `:373-410` boot | After `resolveOperatorSettingsForProbe`, assign the 3 new module-scope vars. If `TEACHER_FANOUT_ENABLED===0` → fall through to legacy operator-only branch (exact MVP behaviour). |
| `:413-553` tick body | Wrap fan-out behind `if (TEACHER_FANOUT_ENABLED) {...}`. Within: group rows, per-teacher dedup, serial Resend send, write per-teacher rows. Operator rows write LAST (§2.1). |
| `:569-580` invokedDirectly | No change. |

**Estimated diff:** ~250 LOC probe + ~80 LOC settings + ~120 LOC tests +
~30 LOC backlog/plan cross-refs.

### 2.7 Activation surface — no systemd / activator-script changes

The MVP-era timer + service are reused as-is. No
`scripts/activate-prod-ops.sh` allowlist edits. The probe now reads 3
additional operator-settings keys; defaults keep fan-out OFF.

---

## 3. Tests

### 3.1 Probe unit — extend `tests/scripts/conflict-unresolved-alert.test.ts`

- `perTeacherFingerprint(group)` — deterministic across reorderings;
  different fp on `conflictSourceCalendarId` change; different fp on slot
  set change.
- `buildTeacherEmail`: Russian subject ≤8 words, NO `[LevelChannel]`
  prefix; greeting "Здравствуйте." with period; body uses "вы"/"вам"
  (never "ты", never capital "Вы") and "занятие" (NEVER "слот" — §4);
  sign-off "— Команда LevelChannel" with em-dash; "и ещё N" line only
  when `omitted > 0`, plural-correct; 1 slot → singular, 5 → "5
  занятий"; no emoji; no apology phrasing.
- `readState()`: v1 legacy → migrated in-memory to v2; v2 → loaded;
  missing → blank v2. `writeState()`: always v2 with `schemaVersion: 2`.
- GC: entry with `lastAlertAt < now - PER_TEACHER_STATE_TTL_MS` dropped
  on next write.

### 3.2 Probe integration — extend `tests/integration/scripts/conflict-unresolved-alert.test.ts`

- **Fan-out OFF (default)** — 3 teachers/1-conflict each → 1 operator
  row only; state v2 with empty `perTeacher`.
- **Fan-out ON, fresh state** — 3 teachers → 3 teacher rows + 1
  operator row; 4 distinct Resend calls; `state.perTeacher` has 3
  entries.
- **Fan-out ON, partial Resend failure** — Resend mock fails for
  teacher B → A/C `alert_sent`, B `alert_send_failed`, operator
  `alert_sent`; `state.perTeacher` advanced for A,C only.
- **Per-teacher dedup hit** — A's fp unchanged within window → A row
  `dedup_skip`, no Resend call for A; B,C unaffected.
- **`TEACHER_FANOUT_CAP` enforced** — 200 teachers, cap=50 → 50 emails +
  50 teacher rows + 1 operator row; remaining 150 NOT in
  `state.perTeacher` (so they surface next tick).
- **Operator row sorts last** — `getProbeStatus()` after fan-out tick
  returns the operator row, not a teacher row (pinning §2.1).
- **State v1 → v2 migration** — seed legacy state, run probe, verify
  in-memory migration + v2 persisted on exit.
- **Per-teacher row set matches operator block** — teacher A's per-teacher
  email body contains exactly the slot set that the operator email block
  for A contains.
- **Empty offenders** — 0 conflicts → only operator `no_offenders` row.

### 3.3 Operator-settings drift / unit / route

- `tests/admin/operator-settings.test.ts` — pin 3 new keys + scope.
  Drift test iterates schema → MJS mirror exercised automatically.
- `tests/integration/admin/operator-settings.test.ts` — resolver covers
  new keys via existing per-key loop.
- `tests/integration/admin/operator-settings-route.test.ts` — add per-key
  POST/DELETE tests for the 3 new keys.

### 3.4 No CHECK-extension regression test

`verdict_kind` CHECK already enumerates `alert_sent` / `alert_send_failed` /
`dedup_skip` (the only verdicts fan-out writes). `probe_name` already
includes `'conflict-unresolved'`. Per-teacher rows pass CHECK by
construction.

### 3.5 Build / typecheck

- `npm run typecheck`, `npm run test:run`, `npm run test:integration`,
  `npm run build` — all green.

---

## 4. Security analysis

- **Cross-teacher leakage** — grouping by `teacherAccountId` BEFORE
  `buildTeacherEmail` (§2.2 step 4). Pinned by §3.2.
- **PII boundary** — per-teacher email lists only that teacher's own
  slot ids + times + opaque Google calendar/event ids. No
  `summary_encrypted` touched.
- **Resend rate-limit / abuse** — `TEACHER_FANOUT_CAP=100` bounds
  emails/tick. Serial send (no `Promise.all`). Steady-state ≈ 2K
  emails/day for K stable teachers — inside any Resend tier at
  LevelChannel scale.
- **Alert-storm on first activation** — §6 RISK-1.
- **Mailbox bounce dedup-poison** — §6 RISK-3; existing
  `accounts.email` / `accounts.disabled_at` surface is the tool;
  query at `:107-110` excludes disabled/empty.
- **Calendar-poisoning abuse vector** — attacker would need teacher's
  calendar credentials or voluntary share (out-of-scope threat).
  Conflict-detection pipeline (PR #251) already creates this
  exposure; fan-out only changes notification recipient.
- **SQL injection** — no new SQL surface; offender query reused
  unchanged. Settings keys flow through the same validator stack
  (parameterized integers).

---

## 5. Decomposition — one-PR epic

Files:

```
docs/plans/bcs-def-1-fanout.md                                  (NEW, this file)
scripts/conflict-unresolved-alert.mjs                           (modified — fan-out branch + v2 state)
lib/admin/operator-settings.ts                                  (modified — 3 new keys)
scripts/lib/operator-settings.mjs                               (modified — 3 new keys mirror)
tests/scripts/conflict-unresolved-alert.test.ts                 (modified — fan-out + state cases)
tests/integration/scripts/conflict-unresolved-alert.test.ts     (modified — fan-out + cap + partial-fail)
tests/admin/operator-settings.test.ts                           (modified — pin 3 new keys)
tests/integration/admin/operator-settings-route.test.ts         (modified — per-key POST/DELETE)
ENGINEERING_BACKLOG.md                                          (modified — strikethrough + cross-ref)
docs/plans/conflict-unresolved-alert.md                         (modified — §10.1 closes its cross-ref)
```

**Estimated diff:** ~600 LOC.

**Critical path:**
- `lib/admin/operator-settings.ts` IS on critical path (per
  `docs/critical-path.md` referenced in MVP plan §1.8) — 3 additive
  keys, no semantics change.
- `scripts/conflict-unresolved-alert.mjs` is NOT on critical path
  (operator observability; failure mode is missing probe row —
  non-fatal).

PR commit trailer carries
`Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)`
per `docs/critical-path.md` because critical-path file is touched.

**Sub-PR split considered + rejected.** Splitting into (a) settings keys,
(b) probe fan-out, (c) tests was considered. Rejected: epic-level
wave-paranoia on the full fan-out diff outweighs the per-sub-PR isolation
benefit, and the 3 new settings keys do nothing observable without the
probe code reading them. One PR is the right unit.

---

## 6. Risks + mitigations

### RISK-1 — Alert-storm on first fan-out activation

First tick after enable: per-teacher state empty → every affected teacher
receives one email; on a prod with K teachers in unresolved conflict, K
emails in 30 min. **Mitigations:** master switch OFF by default;
`TEACHER_FANOUT_CAP=100` per tick × 30-min × 12h dedup window bounds the
storm; documented mitigation — operator pre-sets
`TEACHER_DEDUP_WINDOW_MS=604800000` (7d) at enable, dials down once
backlog clears (mirrors MVP RISK-1); operator can flip switch back to 0
anytime.

### RISK-2 — Resend rate-limit mid-fanout

Resend may rate-limit at burst. **Mitigations:** `TEACHER_FANOUT_CAP`
caps per-tick volume; serial send (`await` one-at-a-time) — clean error
attribution + natural throttling; one teacher's Resend error →
`alert_send_failed` row, loop continues. Pinned by §3.2 "partial Resend
failure".

### RISK-3 — Mailbox-bounce per-teacher dedup-poison

Permanently-bouncing mailbox → state never advances → probe retries
forever (≈1 Resend call/tick/bouncing teacher). **Mitigations:**
Resend-side bounce/complaint tracking trips sender-domain throttling;
operator fixes `accounts.email` (drops from offender query at `:108-110`)
or sets `accounts.disabled_at` (drops at `:107`). // TODO: open
question for paranoia round 1 — cap retries per (teacher, fingerprint)
pair?

### RISK-4 — Teacher receives misleading email after conflict cleared

Same race as MVP RISK-3 (T0 probe, T0+50ms detector clears, T0+200ms
email lands). Confused-but-harmless. Dedup prevents re-send. Mitigation:
body line "По состоянию на YYYY-MM-DD HH:MM:SS UTC".

### RISK-5 — State file growth

Per-teacher map grows with churn. 30d TTL (§2.3 GC); ceiling
~thousand entries × ~80 bytes ≈ 80 KB.

### RISK-6 — Probe-status reader vs fan-out write order race

`/admin/settings/alerts` reads "latest row per probe_name". Fan-out
writes 1+K rows at near-microsecond intervals. Operator row writes LAST
(§2.1). // TODO: open question for paranoia round 1 — should
`getProbeStatus()` filter by `recipient_email = ALERT_EMAIL_TO` to
deterministically prefer the operator row?

### RISK-7 — TS ↔ MJS drift on 3 new keys — caught by existing drift test.

### RISK-8 — Cross-cutting interactions — out of scope; fan-out only reads `accounts.email`; no write paths; settings keys scoped to `conflict-unresolved`.

---

## 7. Acceptance criteria

- `npm run typecheck`, `npm run test:run`, `npm run test:integration`,
  `npm run build` — all green.
- `/codex-paranoia plan` + `/codex-paranoia wave` SIGN-OFF (round N/3).
- PR trailer carries `Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic;
  plan + wave collapsed)` + `Critical-Path-Touched: lib/admin/operator-settings.ts` +
  `Skill-Used: /codex-paranoia plan + /codex-paranoia wave`.
- `ENGINEERING_BACKLOG.md` strikethrough on BCS-DEF-1-FANOUT.
- `docs/plans/conflict-unresolved-alert.md` §10.1 updated with one-line
  cross-ref to this plan.

Post-merge (operator-side, OUT of public-repo scope): operator opens
`/admin/settings/alerts`, sets `CONFLICT_UNRESOLVED_TEACHER_FANOUT_ENABLED=1`
(after pre-setting wide `TEACHER_DEDUP_WINDOW_MS` if a backlog exists —
§6 RISK-1); first tick records per-teacher rows; spot-check inbox.

---

## 8. Open questions for paranoia round 1

Inline `// TODO: open question for paranoia round 1` markers. Summary:

1. Wire `accounts.full_name` greeting in teacher email, or cold-start
   "Здравствуйте."?
2. Surface full slot UUID to teacher (operator does this) or a
   shortened/friendly form?
3. Cap per-(teacher, fingerprint) retry count to prevent indefinite
   mailbox-bounce poisoning?
4. `getProbeStatus()` filter by `recipient_email = ALERT_EMAIL_TO` to
   deterministically prefer the operator row?

All four are non-blocking; paranoia round 1 either closes them inline or
expands into a deliberate scope item.

---

## 9. Migration / rollout

PR opens → CI green → squash-merge → autodeploy lands new probe code on
VPS. **No new systemd units, no `scripts/activate-prod-ops.sh` edit.** The
existing `levelchannel-conflict-unresolved-alert.timer` keeps ticking; the
probe reads 3 additional operator-settings keys (defaults: fan-out OFF).
Operator enables `TEACHER_FANOUT_ENABLED=1` when ready (pre-set wide dedup
window on fresh activation — §6 RISK-1). Probe fans out next tick. Fully
additive — no schema change, no migration ordering hazard.

---

## 10. Out of scope — still deferred

### 10.1 Telegram path — BCS-DEF-1-TG

Still parked (per-teacher bot setup + chat-id binding). Out of scope
until operator commits to bot infrastructure.

### 10.2 Test-send for `conflict-unresolved` — BCS-DEF-1-TEST-SEND

MVP shipped a 422 short-circuit at the test-send route. Fan-out shape
would need a dry-run mode (operator-targeted vs teacher-targeted) that
is naturally a follow-up.

### 10.3 Per-teacher preferred-channel routing

Requires a `notification_preferences` table that doesn't exist today.

### 10.4 Per-teacher copy customisation

Single hardcoded template, content-style-compliant by §2.4 audit. Make
it configurable only on operator request.

### 10.5 Bounce / complaint suppression list

Existing `accounts.disabled_at` operator surface is the tool today
(§4.5 / RISK-3). Dedicated suppression-list table out of scope.

---

## 11. Final trailer expectations

PR commit body carries:
```
Codex-Paranoia: SIGN-OFF round N/3 (one-PR epic; plan + wave collapsed)
Critical-Path-Touched: lib/admin/operator-settings.ts
Skill-Used: /codex-paranoia plan + /codex-paranoia wave
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

— END OF DRAFT (plan-doc only; paranoia plan-mode is the next step) —
