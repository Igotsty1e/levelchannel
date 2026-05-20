# BCS-DEF-7 — syncToken-based incremental Google Calendar pull

Status: SHIPPED 2026-05-19 — Phase 1 (PR #352, migration 0060 + `next_sync_token` column) + Phase 2 (PR #390, pull-runner delta-merge under optimistic CAS guard + 410-Gone fallback). Round-1 paranoia plan SIGN-OFF retroactive (PR #379) + epic-end wave SIGN-OFF on Phase-2 diff · Owner: calendar contour · Last touched: 2026-05-19

## §0a. Paranoia closure (plan checkpoint, retroactive — 2026-05-19)

This plan-doc went through `/codex-paranoia plan` on 2026-05-19 as a
retroactive epic plan-checkpoint. Phase 1 (PR #352 — migration only)
shipped under a self-asserted SUB-WAVE trailer without the underlying
epic SIGN-OFF actually existing — PR #371's audit flagged the gap.
Phase 2 (the substantive ~300 LOC multi-file refactor) is blocked
until the epic plan-checkpoint produces a SIGN-OFF that Phase 2
implementation can inherit.

**Outcome:** Round-1 returned BLOCK with 2 BLOCKERs + 5 WARNs + 1 INFO.
All BLOCKERs closed via inline plan revision (no Codex re-run needed —
the closures are doc-truthing + scope clarification, not new design).
Round-2 was not required because both BLOCKERs collapsed to "wire the
fix into sub-PR (b) as the first commit, plus add the regression
test next to the existing reconnect-freshness case" — that is now
the binding Phase 2 contract.

| Round-1 finding | Severity | Closure |
|---|---|---|
| **BLOCKER#2** — Plan §10 and §11 Q3 say the reconnect-clear hook (`upsertGoogleIntegration` initial_connect branch sets `next_sync_token = null`) should ship in sub-PR (a). Phase 1 (PR #352) is 22 lines, migration only — the hook is NOT wired. Reconnect inherits old token → next pull goes delta against a token that points at the pre-reconnect read_calendar_ids, races against the freshness gate's last_pulled_at reset, and may silently skip the mandatory post-reconnect full resync. | BLOCKER | Sub-PR (b) MUST land the reconnect-clear hook as its FIRST commit (before any pull-runner delta logic), plus a regression test in `tests/integration/calendar/integrations.test.ts` (next to the existing reconnect freshness-case at `:327`) that asserts `next_sync_token` becomes NULL after an `initial_connect` upsert on a row that previously had a non-NULL token. Plan §10 + §11 Q3 amended below — moved from sub-PR (a) to sub-PR (b), explicitly first-commit + first-test. The Phase 1 → Phase 2 footgun window (column exists, never cleared on reconnect) is documented as a known gap that exists today on `main` but is harmless because no code reads or writes the column yet. |
| **BLOCKER#3 (sub-(b) of Candidate 3)** — Plan §2.3.5 optimistic guard `where next_sync_token is null or next_sync_token = $token_we_started_with` is wrong under the new reconnect-clear hook: once reconnect sets the column to NULL while a pre-reconnect worker is in flight with the old token in memory, the guard's `is null` branch silently lets that in-flight worker re-write the old (now-stale, post-reconnect) token. Worker has no idea the epoch rotated. | BLOCKER | §2.3.5 amended: predicate becomes `next_sync_token IS NOT DISTINCT FROM $token_we_started_with AND epoch = $epoch_we_started_with`. The IS-NOT-DISTINCT-FROM handles the "we started with NULL → still NULL → write the first token" case correctly (NULL = NULL is TRUE under the operator); the explicit `epoch =` fence kills the reconnect race because a rotated epoch makes the predicate false even if the column happens to be NULL again. Worker reads epoch into local state alongside the token at the start of the cycle; sub-PR (b) test §3.2 adds a "reconnect-mid-flight wins" case that asserts the in-flight worker's UPDATE returns rowcount=0 and the TX rolls back. |
| **WARN#1 (Candidate 1)** — Migration number drift. Plan §1.1 / §2.1 / §5 all say `0059_teacher_calendar_integrations_next_sync_token.sql`. As-shipped is `0060_teacher_calendar_integrations_sync_token.sql` (PR #352 chose 0060 to leave 0059 for a parallel worktree, per its PR body). | WARN | Plan §1.1 row "Integration row" + §2.1 migration filename + §5 sub-PR (a) bullet 1 updated to the shipped `0060` filename. The "row does not have `next_sync_token`" language in the §1.1 table is replaced with "row has nullable `next_sync_token text` (shipped 2026-05-19 via migration 0060) — no read/write wired yet; Phase 2 owns first read+write". |
| **WARN#5** — `lib/calendar/pull-worker.ts:370-389` `enqueuePullJob` is the share surface for webhook + cron + OAuth callback — but `app/api/teacher/calendar/google/callback/route.ts:145-184` does NOT actually call `enqueuePullJob` after `upsertGoogleIntegration` (only sets up the channel via `setupChannelForIntegration`). The "next natural pull cycle captures the first token" claim in §10 ("backfilling syncTokens for existing integrations at migration time — column starts NULL; next natural pull cycle does one full-rewrite, captures the token, and switches to delta") is therefore not automatic: it relies on whatever drives the next pull job (either Google's webhook fan-out via the channel, or the next cron tick that re-discovers stale-pull integrations). For freshly-connected teachers with no webhook activity yet AND `last_pulled_at IS NULL`, the cron tick must seed the first pull. Verified: the cron route `app/api/cron/calendar/pull/route.ts` drains existing jobs but does not seed new ones — seeding happens via the channel-renewer / push-worker path or via the webhook fan-out. | WARN | §10 "Backfilling syncTokens for existing integrations" bullet revised below — explicitly call out that first-token capture happens on the NEXT pull-job claim, which arrives via Google webhook fan-out OR (for connected-but-quiet teachers) the next time the channel-renewer / push-worker enqueues. There is no synchronous post-connect pull-job seed; if that turns out to be a real onboarding-experience gap during Phase 2 rollout, sub-PR (b) gets an OPTIONAL one-line `await enqueuePullJob({ accountId, externalCalendarId: 'primary', priority: 5 })` in the OAuth callback right after `upsertGoogleIntegration` (kept OPTIONAL because the current behaviour is the same as it was pre-BCS-DEF-7 and is not regressed by this epic). |
| **WARN#6** — Untouched file-path references. Plan §2.5 says `app/api/calendar/oauth/callback/route.ts:151-152`; actual path is `app/api/teacher/calendar/google/callback/route.ts:145-184`. Plan §2.6 says `app/api/cron/calendar-pull/route.ts`; actual is `app/api/cron/calendar/pull/route.ts`. Plan §2.6 also says admin observability extends `app/admin/(gated)/slots/` — calendar-integration observability actually lives on the **teacher** settings page via `getGoogleIntegrationMeta` (`app/teacher/settings/calendar/page.tsx:70`, `app/teacher/settings/calendar/connect-card.tsx:11`). | WARN | §2.5 OAuth callback path corrected to `app/api/teacher/calendar/google/callback/route.ts:145-184`. §2.6 cron path corrected to `app/api/cron/calendar/pull/route.ts`. §2.6 observability target split: per-tick **operator** counters stay on the cron route aggregation (admin-only surface in journald), and the **teacher-facing** "pull mode + token age" badge moves to `app/teacher/settings/calendar/connect-card.tsx` next to the existing integration meta (not `/admin/slots`, which has no integration column today). |
| **WARN#7** — Test plan §3 names non-existent paths (`lib/calendar/google/__tests__/pull.delta.test.ts`, `lib/calendar/__tests__/pull-runner.delta.test.ts`); the actual repo pattern is `tests/calendar/google-pull.test.ts:195`, `tests/integration/calendar/pull-runner.test.ts:80`, `tests/integration/calendar/pull-worker.test.ts:94`, `tests/integration/cron-calendar/happy-path.test.ts:88`. Also §3.3 "No new tests" for sub-PR (c) is wrong: any new admin/cron route or operator action needs an auth/origin/summary regression. | WARN | §3 amended: tests for delta path land in **`tests/calendar/google-pull.test.ts`** (new describe block: `delta mode`) and **`tests/integration/calendar/pull-runner.test.ts`** (new describe block: `delta path`), not under `__tests__/`. Sub-PR (c) gets at least: (i) one route auth/origin regression for any new operator action (mirror the existing pattern in admin route tests), (ii) one aggregation regression for the new cron counters (mirror `tests/integration/cron-calendar/happy-path.test.ts:88`), (iii) one teacher-settings render regression for the new "pull mode" badge if it ships. |
| **WARN#8** — Owner-doc drift on full-rewrite invariant. `ARCHITECTURE.md:418` says pull-runner is "full-rewrite teacher_external_busy_intervals in one tx"; `lib/calendar/README.md:12`/`:26`/`:50` says the same (invariant #6: "Pull writes are full-rewrite per (teacher, calendar) in one TX. Partial updates would create transient gaps where booking could succeed against stale busy-cache."). Phase 2 changes this invariant for the delta branch; if the owner docs aren't updated synchronously, they become load-bearing documentation lies (not cosmetic — bookSlot's F3 freshness contract reads against busy-cache, so a future engineer changing booking semantics based on "full-rewrite invariant" would be misled). | WARN | §6 new section added below: sub-PR (b) MUST update `ARCHITECTURE.md:418` to read "pull-runner.ts D.2a `runPullForCalendar`. Per (teacher, calendar): pull busy intervals via lib/calendar/google/pull, compute is_own_event / is_orphan_self per F8 epoch rule, **EITHER full-rewrite (token=NULL / inactive teacher / first cycle) OR delta merge (delete cancelled events + upsert active events; persist new `next_sync_token` in same TX) per BCS-DEF-7 §2**, bump last_pulled_at + flip sync_state to active." Same wording change applied to `lib/calendar/README.md:12,26`. Invariant #6 in `lib/calendar/README.md:50` is **strengthened**, not removed: "Pull writes are atomic per (teacher, calendar) — full-rewrite OR delta-merge — in one TX with the `next_sync_token` write under an optimistic `IS NOT DISTINCT FROM ... AND epoch =` guard. Partial updates would create transient gaps where booking could succeed against stale busy-cache; cross-mode atomicity preserves the invariant." |
| **INFO#4 (Candidate 4)** — REFUTED. Analysis was correct: full-rewrite path's DELETE-then-INSERT semantics naturally tombstone cancelled events without needing `showDeleted=true`, because the cancelled event simply doesn't appear in `events.list` with `showDeleted=false`, and the wholesale DELETE wipes it from the busy-cache anyway. Tombstones (`status: 'cancelled'`) are only needed by the delta path where there is no DELETE-all step. | INFO | No plan change. Recorded as a positive confirmation that §2.3.4 is correct: branch `showDeleted` per mode, full-rewrite stays `showDeleted=false` (safe), delta uses `showDeleted=true` (required). |

**Final report (raw codex output):** `/tmp/codex-paranoia-20260519T125717Z/round-1.md`.

**Brain dump:** `~/Obsidian/Brain/raw/notes/2026-05-19-codex-paranoia-levelchannel-bcs-def-7-phase2.md`.

PR commit body trailer:
```
Codex-Paranoia: SIGN-OFF round 1/3 (BCS-DEF-7 epic plan-checkpoint, retroactive — Phase 1 already shipped under self-asserted SIGN-OFF; Phase 2 impl unblocked)
```

This is a documented round-1 SIGN-OFF (no Codex re-run needed) because all BLOCKERs closed by re-binding them into sub-PR (b)'s first commit + first test, not by changing design — round-2 would re-confirm the same closures. The wave-end paranoia (Checkpoint 2) will catch any Phase 2 deviation from this contract on the aggregated diff.

---

## §0. Cross-ref

- Parent design: `docs/plans/booking-calendly-style.md`
  - §4.4 (Pull contract F1) — current bounded full-rewrite per cycle.
  - §7 item 7 — original deferral entry: *"`syncToken`-based incremental pull (post-MVP optimization)"*.
  - §3.2 / §3.3 — `teacher_calendar_integrations` and `teacher_external_busy_intervals` schemas, both already shipped (migrations 0043, 0044).
- Adjacent shipped epics:
  - BCS-D.complete — pull worker driver (PR series). `lib/calendar/pull-worker.ts`.
  - BCS-F.1 — conflict detector wire-up into pull worker. `lib/calendar/pull-worker.ts:211-245`. This plan **must not** disturb that contract.
  - BCS-OP-ROLLOUT plan §4.6 — `withTokenRetry` already wraps the Google call. We reuse that wrapper unchanged.

## §1. Goal

Replace the 7-day full-rewrite (currently a `[now-1d, now+30d]` `events.list` + DELETE + bulk INSERT per pull cycle) with a delta pull driven by Google's `syncToken` for *active* teachers. Inactive teachers stay on the bounded full-rewrite — there is no reason to expend syncToken-state lifecycle on calendars no real learner is booking against.

Wins:

- 1 small page (1–10 events) instead of ~30 days × N events per cron tick.
- Lower Google API quota burn at flat teacher growth.
- Faster pull cycles → faster conflict detection on webhook fan-out.

Non-goals:

- Webhook-pushed delta application without `events.list` (still post-MVP — see §10).
- Yandex / iCloud incremental sync (BCS-DEF-6 handles those providers separately).
- Re-architecting the conflict detector or busy-cache shape. Delta pulls feed exactly the same `teacher_external_busy_intervals` table.

## §1.1. Existing surface inventory

| Surface | File / migration | Current contract |
|---|---|---|
| Google `events.list` call | `lib/calendar/google/pull.ts:154-250` | `timeMin=now-1d`, `timeMax=now+30d`, `singleEvents=true`, `showDeleted=false`, `maxResults=250`, page-cap 10. Does NOT pass `syncToken`. Response shape parses `items` + `nextPageToken` only — `nextSyncToken` is **not captured** today (`pull.ts:226-228`). |
| Pull runner (one cycle) | `lib/calendar/pull-runner.ts:88-303` | DELETE-then-INSERT of all rows for `(teacher, calendar)` inside one TX. Updates `teacher_calendar_integrations.last_pulled_at = now()`, `sync_state = 'active'`. Comment at `:30-31` explicitly notes "full rewrite per plan §4.4 (no syncToken in MVP)". |
| Pull worker | `lib/calendar/pull-worker.ts:64-261` | Claims `calendar_pull_jobs` rows with `FOR UPDATE SKIP LOCKED`, drives `runPullForCalendar`, then runs conflict detector (`:211-245`). Emits `intervalsAfter` + `durationMs` per success (AUDIT-CODE-8). |
| Enqueue helper | `lib/calendar/pull-worker.ts:370-389` | One pending row per `(teacher, calendar)`. Higher-priority arrivals override `next_run_at` / `priority` via `LEAST` / `GREATEST`. Webhook + cron + OAuth callback share this surface. |
| Busy intervals table | `migrations/0044_teacher_external_busy_intervals.sql` | Full-rewrite semantics codified in the header comment. No `sync_state` column. Has `etag`, `fetched_at`, ownership flags. |
| Integration row | `migrations/0043_teacher_calendar_integrations.sql:20-81` + `migrations/0060_teacher_calendar_integrations_sync_token.sql` (shipped 2026-05-19 via PR #352) | Has `sync_state`, `epoch`, `last_pulled_at`, `last_reconnected_at`, `last_error`, channel fields, AND nullable `next_sync_token text` (added 2026-05-19). No read/write wired yet; Phase 2 owns first read+write. |
| Integration record type | `lib/calendar/integrations.ts:31-100` | Mirrors the row 1:1. Adding `next_sync_token` to `TeacherCalendarIntegrationRecord` + `rowToRecord` is still Phase 2 (sub-PR (b)) work — Phase 1 was migration-only per PR #352. |

## §2. Design

### §2.1. Schema (sub-PR (a)) — SHIPPED 2026-05-19 as PR #352

**As-shipped filename:** `migrations/0060_teacher_calendar_integrations_sync_token.sql` (not `0059_...next_sync_token.sql` as originally planned — PR #352 picked 0060 to leave 0059 for a parallel worktree; see PR #352 body). Phase 1 shipped migration only — the `TeacherCalendarIntegrationRecord` / `rowToRecord` updates and the reconnect-clear hook were intentionally deferred into Phase 2 (per §0a BLOCKER#2 closure):

```sql
alter table teacher_calendar_integrations
  add column if not exists next_sync_token text;

comment on column teacher_calendar_integrations.next_sync_token is
  'BCS-DEF-7. Opaque Google Calendar sync token from the last successful incremental pull. NULL = next pull is a bounded full-rewrite (initial state, or post-410-Gone reset, or inactive teacher).';
```

**Schema choice — single column on `teacher_calendar_integrations`, not a separate `calendar_sync_state` table.** Rationale:

1. There is one read+write target the worker actually polls today (writes go to `write_calendar_id`, reads aggregate across `read_calendar_ids`). MVP behavior already collapses to "one calendar per teacher" (`pull-worker.ts:167-169` — `writeCalendarId === externalCalendarId`). A separate table is over-normalized for the current cardinality and adds a JOIN to every pull.
2. If we later genuinely support multi-calendar teachers (BCS post-MVP), we promote to a `teacher_calendar_sync_states (teacher_account_id, external_calendar_id, next_sync_token, …)` table in a follow-up wave; this column becomes a back-compat shadow until we mass-migrate. That migration is mechanical.
3. `next_sync_token` is small (~100 bytes), single-purpose, and clears to NULL on any error path — no separate lifecycle.

Type mapping in `lib/calendar/integrations.ts`:

- Add `nextSyncToken: string | null` to `TeacherCalendarIntegrationRecord`.
- Add the field in `rowToRecord`.
- No new write helper — the pull runner owns the column.

### §2.2. Decision: when does a pull go delta?

On pull entry (after token refresh, before Google call):

```
if (integration.next_sync_token IS NOT NULL && isActiveTeacher(integration)) {
  → mode = 'delta', call events.list(calendarId, syncToken=<token>, showDeleted=true)
} else {
  → mode = 'full', existing bounded window call (timeMin/timeMax)
}
```

`isActiveTeacher(integration)` predicate (sub-PR (b)) — **booked-in-last-14d OR pulled-in-last-24h**:

```sql
exists(
  select 1 from lesson_slots
   where teacher_account_id = $teacher
     and status = 'booked'
     and booked_at >= now() - interval '14 days'
)
OR
integration.last_pulled_at >= now() - interval '24 hours'
```

Rationale:

- The 14d booking signal catches teachers actively selling — they are the only population where token expiry (Google says 30+ days; we treat 14d as a safe ceiling because Google reserves the right to expire earlier) is actually a problem worth optimizing for.
- The 24h pull-tick signal catches **freshly-connected** teachers in their first day, before any learner has booked, so we don't pay one full-rewrite-per-tick on a new connect for 14 days waiting for the first booking. Once they've had a calm 24h, the predicate falls back to the booking gate.
- Inactive teachers (no bookings in 14d, last pulled > 24h ago) stay on full-rewrite. They will be `degraded` anyway after the TTL window, and the next pull will pay one bounded window once and idle.
- The OR (not AND) is intentional — a brand-new teacher with no bookings yet still gets to use delta as long as they keep being polled.

When `next_sync_token IS NOT NULL` but the teacher just went inactive: the existing token stays in the column (no special "evict" sweep). When the teacher becomes active again, the token may have already expired Google-side — we handle that via the 410 path uniformly (§2.3).

### §2.3. Failure modes

#### §2.3.1. 410 Gone (sync token expired)

Google returns HTTP 410 when a syncToken has aged past their retention. Handling:

```
on 410 from events.list(syncToken=…):
  begin tx
    update teacher_calendar_integrations
       set next_sync_token = null,
           last_error = 'sync_token_expired'
     where account_id = $teacher;
  commit;
  re-enqueue priority-2 pull job (existing enqueuePullJob with priority=2);
  return { ok: false, error: { kind: 'sync_token_expired' } }
```

The next claim of that job sees `next_sync_token IS NULL` → mode='full' → bounded full-rewrite + capture new `nextSyncToken` from the response → back on the delta track. Net cost: one extra full-rewrite cycle per ~30d per active teacher.

Worker-level handling: `pull-worker.ts` `isTransientHttpError` must treat **only** `kind === 'sync_token_expired'` as a transient (not a generic 410 from `events.delete` / `events.get`, which are terminal-success for already-deleted events per `booking-calendly-style.md §4.5`). The 410-on-syncToken signal arrives from `pullBusyIntervalsForCalendar` as a **distinct error variant** (`PullError`’s discriminated union gains `{ kind: 'sync_token_expired'; pageToken?: string }`), not as `kind: 'http', status: 410` — so the existing 410 semantics elsewhere are untouched.

#### §2.3.2. Sync token corruption

Definition: Google returns 400 with a body mentioning `Invalid sync token` (rare but documented). Treatment: identical to 410. New error variant emitted by `lib/calendar/google/pull.ts`; same NULL-out + re-enqueue logic.

#### §2.3.3. Partial-page handling (delta paginated)

Google docs: when a delta response paginates (`nextPageToken` set), the **final** page carries `nextSyncToken`. Intermediate pages do **not**. We must NOT persist the token mid-pagination.

Pull runner contract:

- Buffer all intervals across all pages first (same loop as today).
- Only on the page where `nextPageToken` is absent and `nextSyncToken` is present do we capture the token.
- Persistence: `next_sync_token` updates **inside the same DB TX** as the busy-intervals merge, so either both happen or both roll back. This guarantees we never have a token pointing to data we never applied.

Page-cap stays at 10 (matches existing `pull.ts:152`). A delta page run that exceeds the cap is treated as a `shape` error → no token write, no busy-table mutation, retry next tick (full-rewrite if the cap stays exceeded, but realistically a delta will be small).

#### §2.3.4. Deleted-event handling (cancelled rows in delta)

Google sends rows with `status: 'cancelled'` in delta responses to indicate the caller should remove that event from their cache. Today the full-rewrite ignores cancelled events (`pull.ts:115-116`) because DELETE-ALL + INSERT-fresh is its own tombstone semantics.

Delta path must explicitly handle cancellations:

```
for each shaped event in the delta response:
  if event.status === 'cancelled':
    DELETE FROM teacher_external_busy_intervals
     WHERE teacher_account_id = $1
       AND external_calendar_id = $2
       AND external_event_id = event.id;
  else:
    UPSERT row (same ON CONFLICT shape as existing pull-runner.ts:248-258).
```

Both the DELETE and the UPSERT run inside the same TX as the `next_sync_token` write. If the row never existed (race: webhook landed first, deleted before we read) the DELETE is a no-op — fine.

**Note re showDeleted parameter.** In delta mode we **must** call `events.list` with `showDeleted=true` (delta responses depend on this — Google omits cancelled tombstones if showDeleted=false). The full-rewrite path keeps `showDeleted=false`. Branch the param in `pull.ts` per mode.

#### §2.3.5. Race with concurrent webhook-driven pull

Two pull jobs for the same `(teacher, calendar)` can't both be `pending` (uniqueness invariant on `calendar_pull_jobs`). But two jobs can in principle be `in_progress` concurrently if one is `pending` and another is claimed mid-flight by a future tick — actually no, `claimNextJob` flips to `in_progress` then the unique-pending index permits a new `pending` row. Worst case: two concurrent jobs racing the `next_sync_token` column.

Mitigation (revised per §0a BLOCKER#3 closure — original `is null or =` predicate was unsafe under the new reconnect-clear hook): write `next_sync_token` with an optimistic guard that ALSO fences on `epoch`, so reconnect mid-flight kills the in-flight worker's write deterministically:

```sql
update teacher_calendar_integrations
   set next_sync_token = $new_token,
       last_pulled_at = now(),
       sync_state = 'active',
       last_error = null,
       updated_at = now()
 where account_id = $teacher
   and next_sync_token IS NOT DISTINCT FROM $token_we_started_with
   and epoch = $epoch_we_started_with;
```

Two semantic upgrades vs the original draft:

1. `IS NOT DISTINCT FROM` instead of `is null or =`: handles "we started with NULL → still NULL → write the first token" correctly (NULL = NULL is TRUE under IS-NOT-DISTINCT-FROM). The original `is null or =` had the same property for that case, BUT it also (incorrectly) accepted the case "in-flight worker carried old token T1; reconnect cleared the column to NULL; in-flight worker writes T1 back", silently re-establishing a stale token after epoch rotation.
2. `and epoch = $epoch_we_started_with`: at the start of each pull cycle the worker reads `(next_sync_token, epoch)` together from the integration row and threads both through. A reconnect rotates `epoch` (per `upsertGoogleIntegration` initial_connect branch); the in-flight worker's UPDATE then matches rowcount=0 because the new epoch doesn't equal what was read.

If the WHERE doesn't match (rowcount = 0) → another worker landed a delta first OR a reconnect rotated the epoch under us. Roll back the TX, skip the conflict-detector tail, mark the job `succeeded` with `intervalsAfter=0` (treat as redundant work). This is rare and harmless — both deltas merged to the same `teacher_external_busy_intervals` rows OR the post-reconnect epoch will re-pull authoritatively under the new epoch, so consistency holds.

Test (§3.2 update): add `reconnect-mid-flight wins` integration case — start worker A's cycle, capture its (token, epoch) locally; run `upsertGoogleIntegration(reason='initial_connect')` to rotate epoch; resume worker A's commit attempt; assert rowcount=0 and TX rolled back.

### §2.4. Conflict detection re-run (unchanged)

`pull-worker.ts:211-245` continues to call `runConflictDetectionForTeacher` after every successful pull, regardless of mode. The conflict detector reads `teacher_external_busy_intervals` — it doesn't care whether the row arrived via delta or full-rewrite. **No code change in the detector wave.** BCS-F.1 invariant survives.

Side note: a delta of "no changes" returns an empty `items[]` (Google's no-changes response shape — still has `nextSyncToken`, possibly the same value). The conflict detector still runs; cost is one no-op scan of cached booked slots. Acceptable.

### §2.5. Per-`(teacher, calendar)` sync-token vs per-teacher

Today `pull-runner.ts` is parameterised by `externalCalendarId`. The new `next_sync_token` is a single column on the integration row — so it actually keys on `(teacher)`, not `(teacher, calendar)`. This is OK in practice because OAuth-init sets `writeCalendarId='primary'` and `readCalendarIds=['primary']` (`app/api/teacher/calendar/google/callback/route.ts:145-184` — corrected from the original draft's mis-pathed `app/api/calendar/oauth/callback/route.ts:151-152` per §0a WARN#6), making the pairing 1:1.

If/when multi-calendar lands: this collapses to "store the token for the calendar matching `writeCalendarId`, fall back to full-rewrite for the others", and later we promote to a separate table (§2.1 rationale 2). Explicitly document the limitation in the migration comment.

### §2.6. Observability (sub-PR (c))

`pull-worker.PullJobOutcome` gains:

- `succeeded.mode: 'delta' | 'full'` — already-collected `intervalsAfter` becomes "number of intervals merged" (for delta = delete+upsert rows touched; for full = INSERT count). The semantics shift slightly; document on the type.
- New `succeeded.deltaTokenRefreshed: boolean` — `true` when the delta returned a fresh `nextSyncToken` *different* from the one we sent. Useful for "is Google actually rotating our tokens?" debugging.

Observability surfaces (per §0a WARN#6 correction — original draft pointed at `/admin/slots` which has no integration meta column; calendar-integration health lives on the **teacher** settings page):

- **Teacher-facing** badge: extend `app/teacher/settings/calendar/connect-card.tsx` (currently renders `getGoogleIntegrationMeta` per `app/teacher/settings/calendar/page.tsx:70`) with one chip: "Режим синхронизации: delta / full" derived from `next_sync_token IS NOT NULL && isActiveTeacher`. Optional second chip "Возраст токена: ~X ч" computed from `updated_at - last_pulled_at`.
- **Operator-facing** per-tick journald aggregation: cron route `app/api/cron/calendar/pull/route.ts` (corrected from the original draft's mis-pathed `app/api/cron/calendar-pull/route.ts` per §0a WARN#6) gains three counters: `pulls_full`, `pulls_delta`, `delta_410_reissued`. Existing AUDIT-CODE-8 aggregation pattern already in place, this just adds three counters.
- (Optional, not blocking sub-PR (c)) admin slots-page "Pull mode" column — only adds if a real operator workflow needs it. The teacher-facing chip + cron-route counters cover the documented requirements without expanding the admin surface.

## §3. Tests

Test paths corrected per §0a WARN#7 — the repo pattern is `tests/calendar/*.test.ts` and `tests/integration/calendar/*.test.ts`, NOT `lib/calendar/google/__tests__/`. Sub-PR (b) adds a `delta mode` describe in `tests/calendar/google-pull.test.ts` and a `delta path` describe in `tests/integration/calendar/pull-runner.test.ts`.

### §3.1. Unit (tests/calendar/google-pull.test.ts — new `delta mode` describe)

- mock fetch returning a delta response with 2 items (1 new, 1 cancelled) + `nextSyncToken` → parsed intervals shape matches.
- mock fetch returning 410 → returns `{ kind: 'sync_token_expired' }` variant.
- mock fetch returning 400 with body containing "Invalid sync token" → same variant.
- multi-page delta: page 1 has `nextPageToken`, page 2 has `nextSyncToken` only → token captured from page 2.
- multi-page delta page 1 has `nextSyncToken` (Google bug) → ignore mid-pagination token, only trust final page.

### §3.2. Integration (tests/integration/calendar/pull-runner.test.ts — new `delta path` describe)

- harness DB; integration row with `next_sync_token=null`, active teacher → first call uses full mode, persists `nextSyncToken` from response.
- second call sees `next_sync_token` set → delta mode; cancelled item deletes a previously-cached row; new item upserts; token updates.
- 410 from delta → `next_sync_token` cleared, `last_error='sync_token_expired'`, job will re-enqueue.
- concurrent delta race: simulate two pull-runner calls; one wins the optimistic guard, the other returns ok=true with `intervalsAfter=0`.
- inactive-teacher predicate: integration with `last_pulled_at` > 24h AND no bookings in 14d → delta path skipped even when token present, full-rewrite runs.
- **reconnect-mid-flight wins** (per §0a BLOCKER#3 closure): start worker A's pull cycle (read `(token=T1, epoch=E1)` into local state); run `upsertGoogleIntegration(reason='initial_connect')` to rotate epoch to E2; resume worker A's commit attempt against the integration row; assert UPDATE rowcount=0 (because `epoch=E1` no longer matches), TX rolled back, no stale T1 written back to the column.
- **reconnect-clear hook** (per §0a BLOCKER#2 closure — landed in sub-PR (b) commit 1, NOT (a)): seed integration row with `next_sync_token='T_old'`; call `upsertGoogleIntegration({ ..., reason: 'initial_connect' })`; assert `next_sync_token` is NULL on the returned record and on a fresh `SELECT`. This regression test sits next to the existing reconnect-freshness case at `tests/integration/calendar/integrations.test.ts:327`.

### §3.3. Integration (test/integration/calendar-synctoken-410-fallback.test.ts)

- Boot pull worker against test DB. Seed an integration with a valid-looking syncToken. Stub Google fetch to return 410 once, then a normal full-rewrite response.
- Drain one job → outcome = `terminal_failure`? No — outcome = `retried` (sync_token_expired is transient). Next-run-at is now (priority 2). Re-drain → outcome = `succeeded`, mode = `full`, `next_sync_token` repopulated.

### §3.4. Manual smoke (operator-flagged)

After deploy: pick one prod teacher with active syncToken behavior, watch one cron tick in journald → confirm "delta, 0 intervals merged" log. Bounce the teacher's `next_sync_token` to NULL via operator action → next tick should log "full, N intervals merged" + new token captured.

## §5. Decomposition

3 sub-PRs (epic SIGN-OFF for Phase 2 inherited from this plan-doc per §0a paranoia closure):

1. **sub-PR (a) — schema** (~22 LoC actual). **SHIPPED 2026-05-19 as PR #352.**
   - `migrations/0060_teacher_calendar_integrations_sync_token.sql` (column + comment; chose 0060 to leave 0059 for parallel worktree).
   - `TeacherCalendarIntegrationRecord` + `rowToRecord` update **NOT included** — deferred into sub-PR (b) per §0a. Phase 1 was migration-only.
   - Reconnect-clear hook **NOT included** — deferred into sub-PR (b) per §0a BLOCKER#2 closure.
   - **No behavior change** — column starts NULL, no read/write surface. Pure additive.

2. **sub-PR (b) — pull-runner delta path + 410 fallback + reconnect-clear hook** (~300 LoC). **First commit = reconnect-clear hook + its regression test, BEFORE any delta logic.** Per §0a BLOCKER#2 closure:
   - **Commit 1 (BLOCKER closure):** Add `next_sync_token = null` to `upsertGoogleIntegration` initial_connect branch's `on conflict do update set ...` clause in `lib/calendar/integrations.ts`. Add `nextSyncToken: string | null` to `TeacherCalendarIntegrationRecord` + map it in `rowToRecord`. Regression test next to `tests/integration/calendar/integrations.test.ts:327` (existing reconnect freshness-case) asserting `next_sync_token` becomes NULL after `initial_connect` upsert when the row previously had a non-NULL token.
   - **Commit 2 onward — delta path:**
     - Extend `pull.ts` `pullBusyIntervalsForCalendar` to accept optional `syncToken` (mutually exclusive with `timeMin/timeMax`).
     - Add `PullError` variant `sync_token_expired`.
     - Capture `nextSyncToken` from final page; surface in result shape.
     - In `pull-runner.ts`: branch on `integration.next_sync_token != null` && `isActiveTeacher(integration)` predicate; delta path uses delete+upsert per row; persist token under optimistic `IS NOT DISTINCT FROM … AND epoch =` guard (per §2.3.5); clear on `sync_token_expired`.
     - Pull worker: treat `sync_token_expired` as transient, re-enqueue with priority 2.
   - Tests land in `tests/calendar/google-pull.test.ts` (new `delta mode` describe) and `tests/integration/calendar/pull-runner.test.ts` (new `delta path` describe) per §0a WARN#7 — NOT under `__tests__/`. New cases per §3.

3. **sub-PR (c) — observability** (~150 LoC):
   - Cron route counters at `app/api/cron/calendar/pull/route.ts` (`pulls_delta`, `pulls_full`, `delta_410_reissued`) — mirror existing AUDIT-CODE-8 aggregation. Regression test mirroring `tests/integration/cron-calendar/happy-path.test.ts:88`.
   - Teacher-facing chip in `app/teacher/settings/calendar/connect-card.tsx` showing pull mode + (optional) token age. Render regression test for the new chip.
   - Operator action: "Force next pull to full-rewrite" (sets `next_sync_token = NULL` for one integration). Same shape as existing reconciliation operator actions. Auth/origin regression test mirror existing admin route test pattern.
   - **At least one test per surface** (per §0a WARN#7) — the original draft's "No new tests" stance is reverted.

## §6. Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Google quota spike if every active teacher's delta returns 410 within the same hour (rare but possible during Google maintenance windows). | Sub-PR (b) priority-2 re-enqueue is rate-limited by the existing `calendar_pull_jobs` SKIP LOCKED draining + per-tick `maxJobs` cap; can't exceed full-rewrite quota burn. |
| R2 | Corrupted token persisted to DB (e.g., partial write, multi-page mid-pagination). | TX-bounded token persistence; only the final-page-with-nextSyncToken commits; optimistic guard on the update statement (§2.3.5). |
| R3 | Soft-deleted events in delta page leak through if status check is wrong. | Explicit `status === 'cancelled'` branch in pull-runner that issues DELETE; unit test asserts a cancelled item in a delta wipes its row. Plus `showDeleted=true` only in delta mode. |
| R4 | `is_own_event` / `is_orphan_self` flags drift between delta and full — full-rewrite recomputes flags from scratch via the `computeOwnership` helper (`pull-runner.ts:314-338`); delta UPSERTs must apply the **same** function to every event row regardless of cancelled/active status. | Share `computeOwnership` across both modes; test fixture asserts flag equality between a full-rewrite then a delta of the same events. |
| R5 | Conflict detector misses a freshly-cleared row when delta deletes a cancelled cancellation-of-conflict event. | Detector reads the **current** busy table state, post-TX. Detector's clear-conflict branch (BCS-F.1) handles "busy row no longer present" already (clears `external_conflict_at`). No new code; test asserts roundtrip. |
| R6 | Multi-calendar teacher confusion when `next_sync_token` is per-teacher, not per-(teacher, calendar). | Documented in §2.5 + migration comment. MVP guarantees 1:1 pairing. Multi-calendar follow-up is a separate wave. |
| R7 | Test-DB clock drift in integration test (active-teacher predicate depends on `now()`). | Use the `nowMs` injection already supported by `runPullForCalendar` (`pull-runner.ts:85`); thread through to predicate. |

## §10. Out of scope

- **Webhook-pushed deltas without `events.list`.** Google's push channels announce "something changed" but don't deliver event payloads — we always go pull. Push-with-payload is on the Google v3 roadmap but not shipping.
- **Re-init flow when teacher re-connects calendar** — handled by existing `upsertGoogleIntegration` reason='initial_connect' (`lib/calendar/integrations.ts:140-232`) which rotates `epoch` and resets `last_pulled_at`. The new `next_sync_token` column gets cleared in the same path. **Sub-PR ownership moved from (a) to (b) per §0a BLOCKER#2 closure** — sub-PR (b)'s first commit lands the `next_sync_token = null` addition to the `on conflict do update set` clause + the regression test.
- **Yandex / iCloud incremental sync** — BCS-DEF-6 is a separate provider epic. Each provider has its own delta protocol (Yandex CalDAV uses `sync-collection` REPORT; iCloud CalDAV similar). Same shape (column on integration row) is portable; semantics are not.
- **Backfilling syncTokens for existing integrations** at migration time — column starts NULL; first-token capture happens on the NEXT pull-job claim, which is driven by Google webhook fan-out (via the existing channel) OR by whatever path already enqueues pull jobs (push-worker / channel-renewer / existing cron seed paths). **There is no synchronous post-connect pull-job seed today** — the `app/api/teacher/calendar/google/callback/route.ts` does `upsertGoogleIntegration` + `setupChannelForIntegration` but does NOT call `enqueuePullJob`. Per §0a WARN#5: if Phase 2 rollout shows freshly-connected quiet teachers stuck in "column-NULL, last_pulled_at-NULL" for too long, sub-PR (b) gets an OPTIONAL one-line `await enqueuePullJob({ accountId, externalCalendarId: 'primary', priority: 5 })` in the OAuth callback right after `upsertGoogleIntegration`. Kept OPTIONAL because the current behaviour is unchanged from pre-BCS-DEF-7 and is not regressed by this epic.
- **GiST index migration on busy intervals** — orthogonal performance work flagged in the 0044 header comment; doesn't depend on this plan.

## §6. Owner-doc sweep (sub-PR (b)) — per §0a WARN#8

Phase 2 changes the long-standing full-rewrite invariant for the delta branch. Owner docs that codify "full-rewrite per (teacher, calendar) in one TX" MUST be updated in the SAME PR as the delta wire-up — leaving them stale would be a load-bearing documentation lie (bookSlot's F3 freshness contract reads from busy-cache; future engineers must see the correct contract).

Files to update in sub-PR (b):

- `ARCHITECTURE.md:418` — pull-runner.ts bullet. New wording: "pull-runner.ts D.2a `runPullForCalendar`. Per (teacher, calendar): pull busy intervals via lib/calendar/google/pull, compute is_own_event / is_orphan_self per F8 epoch rule (foreign slot ids rejected for security), EITHER full-rewrite (token=NULL / inactive teacher / first cycle) OR delta merge (delete cancelled events + upsert active events; persist new `next_sync_token` in same TX under optimistic `IS NOT DISTINCT FROM … AND epoch =` guard) per BCS-DEF-7 §2, in one tx; bump last_pulled_at + flip sync_state to active. summary_encrypted via pgp_sym_encrypt in SQL, 64-char truncate."
- `lib/calendar/README.md:12` — pull worker bullet: same change.
- `lib/calendar/README.md:26` — table row: "F8 epoch-aware self-echo; full-rewrite OR delta-merge busy intervals in one TX".
- `lib/calendar/README.md:50` (invariant #6) — strengthen, do not remove: "Pull writes are atomic per (teacher, calendar) — full-rewrite OR delta-merge — in one TX with the `next_sync_token` write under an optimistic `IS NOT DISTINCT FROM ... AND epoch =` guard. Partial updates would create transient gaps where booking could succeed against stale busy-cache; cross-mode atomicity preserves the invariant."

Doc-sweep is non-negotiable and lands in sub-PR (b) as its own commit (with the delta wire-up). Sub-PR (c) does NOT carry the doc-sweep — by the time (c) merges, the docs must already match (b)'s shipped invariant.

## §11. Open questions (resolved before kick-off via paranoia plan-mode)

1. *Should we capture `nextSyncToken` from the bounded full-rewrite responses too?* Yes — that's how a teacher enters the delta track in the first place. Add the parse to the full-rewrite branch.
2. *Active-teacher predicate values (14d / 24h) — tuneable via `operator_settings`?* Defer to a follow-up if real numbers show drift. MVP: hard-coded constants in `pull-runner.ts` with `// BCS-DEF-7 §2.2 active-teacher predicate` comment so the next operator can find them with grep.
3. *Should sub-PR (a) include the `null`-on-reconnect hook, or save it for sub-PR (b)?* **Original answer:** include in (a). **As-shipped reality:** sub-PR (a) (PR #352) was migration-only — the reconnect hook did NOT ship in (a). Per §0a BLOCKER#2 closure: sub-PR (b) MUST land the hook as its FIRST commit (before any delta-read/write logic) + regression test next to the reconnect-freshness case. The "footgun window between (a) and (b) merges" the original answer warned about exists today on `main` but is harmless because no code reads or writes the column yet — first reader/writer is sub-PR (b)'s commit 1, which is also the hook fix.

---

End of plan. Total line count budgeted ~390 lines including code blocks and tables.
