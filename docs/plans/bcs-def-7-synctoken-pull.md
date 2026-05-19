# BCS-DEF-7 — syncToken-based incremental Google Calendar pull

Status: PLAN (draft) · Owner: calendar contour · Last touched: 2026-05-18

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
| Integration row | `migrations/0043_teacher_calendar_integrations.sql:20-81` | Has `sync_state`, `epoch`, `last_pulled_at`, `last_reconnected_at`, `last_error`, channel fields. Does **not** have `next_sync_token`. |
| Integration record type | `lib/calendar/integrations.ts:31-100` | Mirrors the row 1:1. Adding `next_sync_token` requires updating `TeacherCalendarIntegrationRecord` + `rowToRecord`. |

## §2. Design

### §2.1. Schema (sub-PR (a))

Migration `0059_teacher_calendar_integrations_next_sync_token.sql` (next free number — last on `main` is `0058_probe_runs_conflict_unresolved.sql`):

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

Mitigation: write `next_sync_token` with an optimistic guard:

```sql
update teacher_calendar_integrations
   set next_sync_token = $new_token,
       last_pulled_at = now(),
       sync_state = 'active',
       last_error = null,
       updated_at = now()
 where account_id = $teacher
   and (next_sync_token is null
        or next_sync_token = $token_we_started_with);
```

If the WHERE doesn't match (rowcount = 0) → another worker landed a delta first, our delta is stale. Roll back the TX, skip the conflict-detector tail, mark the job `succeeded` with `intervalsAfter=0` (treat as redundant work). This is rare and harmless — both deltas merged to the same `teacher_external_busy_intervals` rows, so consistency holds.

### §2.4. Conflict detection re-run (unchanged)

`pull-worker.ts:211-245` continues to call `runConflictDetectionForTeacher` after every successful pull, regardless of mode. The conflict detector reads `teacher_external_busy_intervals` — it doesn't care whether the row arrived via delta or full-rewrite. **No code change in the detector wave.** BCS-F.1 invariant survives.

Side note: a delta of "no changes" returns an empty `items[]` (Google's no-changes response shape — still has `nextSyncToken`, possibly the same value). The conflict detector still runs; cost is one no-op scan of cached booked slots. Acceptable.

### §2.5. Per-`(teacher, calendar)` sync-token vs per-teacher

Today `pull-runner.ts` is parameterised by `externalCalendarId`. The new `next_sync_token` is a single column on the integration row — so it actually keys on `(teacher)`, not `(teacher, calendar)`. This is OK in practice because OAuth-init sets `writeCalendarId='primary'` and `readCalendarIds=['primary']` (`app/api/calendar/oauth/callback/route.ts:151-152` — same line referenced in pull-worker comment), making the pairing 1:1.

If/when multi-calendar lands: this collapses to "store the token for the calendar matching `writeCalendarId`, fall back to full-rewrite for the others", and later we promote to a separate table (§2.1 rationale 2). Explicitly document the limitation in the migration comment.

### §2.6. Observability (sub-PR (c))

`pull-worker.PullJobOutcome` gains:

- `succeeded.mode: 'delta' | 'full'` — already-collected `intervalsAfter` becomes "number of intervals merged" (for delta = delete+upsert rows touched; for full = INSERT count). The semantics shift slightly; document on the type.
- New `succeeded.deltaTokenRefreshed: boolean` — `true` when the delta returned a fresh `nextSyncToken` *different* from the one we sent. Useful for "is Google actually rotating our tokens?" debugging.

Admin observability surface — extend `app/admin/(gated)/slots/` (or wherever calendar-health lives; the operator already inspects `last_pulled_at` and `sync_state`):

- New table column "Pull mode" — derived from `next_sync_token IS NULL` (= "next pull = full") vs "delta-eligible". Per-tick mode lives in journald logs.
- Optional: small badge on the integration detail page "Token age: X hours" — computed from `updated_at - last_pulled_at` heuristic. Cheap, no new column.

Cron route `app/api/cron/calendar-pull/route.ts` aggregates per-tick: `pulls_full`, `pulls_delta`, `delta_410_reissued`. Existing AUDIT-CODE-8 aggregation pattern already in place, this just adds three counters.

## §3. Tests

### §3.1. Unit (lib/calendar/google/__tests__/pull.delta.test.ts)

- mock fetch returning a delta response with 2 items (1 new, 1 cancelled) + `nextSyncToken` → parsed intervals shape matches.
- mock fetch returning 410 → returns `{ kind: 'sync_token_expired' }` variant.
- mock fetch returning 400 with body containing "Invalid sync token" → same variant.
- multi-page delta: page 1 has `nextPageToken`, page 2 has `nextSyncToken` only → token captured from page 2.
- multi-page delta page 1 has `nextSyncToken` (Google bug) → ignore mid-pagination token, only trust final page.

### §3.2. Unit (lib/calendar/__tests__/pull-runner.delta.test.ts)

- harness DB; integration row with `next_sync_token=null`, active teacher → first call uses full mode, persists `nextSyncToken` from response.
- second call sees `next_sync_token` set → delta mode; cancelled item deletes a previously-cached row; new item upserts; token updates.
- 410 from delta → `next_sync_token` cleared, `last_error='sync_token_expired'`, job will re-enqueue.
- concurrent delta race: simulate two pull-runner calls; one wins the optimistic guard, the other returns ok=true with `intervalsAfter=0`.
- inactive-teacher predicate: integration with `last_pulled_at` > 24h AND no bookings in 14d → delta path skipped even when token present, full-rewrite runs.

### §3.3. Integration (test/integration/calendar-synctoken-410-fallback.test.ts)

- Boot pull worker against test DB. Seed an integration with a valid-looking syncToken. Stub Google fetch to return 410 once, then a normal full-rewrite response.
- Drain one job → outcome = `terminal_failure`? No — outcome = `retried` (sync_token_expired is transient). Next-run-at is now (priority 2). Re-drain → outcome = `succeeded`, mode = `full`, `next_sync_token` repopulated.

### §3.4. Manual smoke (operator-flagged)

After deploy: pick one prod teacher with active syncToken behavior, watch one cron tick in journald → confirm "delta, 0 intervals merged" log. Bounce the teacher's `next_sync_token` to NULL via operator action → next tick should log "full, N intervals merged" + new token captured.

## §5. Decomposition

3 sub-PRs (epic SIGN-OFF inherited from this plan-doc per §codex-paranoia contract):

1. **sub-PR (a) — schema** (~80 LoC):
   - `migrations/0059_teacher_calendar_integrations_next_sync_token.sql` (column + comment).
   - Update `TeacherCalendarIntegrationRecord` + `rowToRecord` in `lib/calendar/integrations.ts`.
   - **No behavior change** — pull-runner ignores the column. Pure additive.
   - Smoke test: backfill on prod-like data set; column defaults NULL on existing 0–N integrations.

2. **sub-PR (b) — pull-runner delta path + 410 fallback** (~300 LoC):
   - Extend `pull.ts` `pullBusyIntervalsForCalendar` to accept optional `syncToken` (mutually exclusive with `timeMin/timeMax`).
   - Add `PullError` variant `sync_token_expired`.
   - Capture `nextSyncToken` from final page; surface in result shape.
   - In `pull-runner.ts`: branch on `integration.next_sync_token != null` && `isActiveTeacher(integration)` predicate; delta path uses delete+upsert per row; persist token under optimistic guard; clear on `sync_token_expired`.
   - Pull worker: treat `sync_token_expired` as transient, re-enqueue with priority 2.
   - Unit + integration tests per §3.

3. **sub-PR (c) — admin observability** (~150 LoC):
   - Cron route counters (`pulls_delta`, `pulls_full`, `delta_410_reissued`).
   - Admin page column showing pull mode + token age.
   - Operator action: "Force next pull to full-rewrite" (sets `next_sync_token = NULL` for one integration). Same shape as existing reconciliation operator actions.
   - No new tests — wired to existing admin route test pattern.

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
- **Re-init flow when teacher re-connects calendar** — handled by existing `upsertGoogleIntegration` reason='initial_connect' (`lib/calendar/integrations.ts:114-118`) which rotates `epoch` and resets `last_pulled_at`. The new `next_sync_token` column gets cleared in the same path (sub-PR (a) hook — add `next_sync_token = null` to the reconnect UPDATE).
- **Yandex / iCloud incremental sync** — BCS-DEF-6 is a separate provider epic. Each provider has its own delta protocol (Yandex CalDAV uses `sync-collection` REPORT; iCloud CalDAV similar). Same shape (column on integration row) is portable; semantics are not.
- **Backfilling syncTokens for existing integrations** at migration time — column starts NULL; next natural pull cycle does one full-rewrite, captures the token, and switches to delta. No special backfill job.
- **GiST index migration on busy intervals** — orthogonal performance work flagged in the 0044 header comment; doesn't depend on this plan.

## §11. Open questions (resolved before kick-off via paranoia plan-mode)

1. *Should we capture `nextSyncToken` from the bounded full-rewrite responses too?* Yes — that's how a teacher enters the delta track in the first place. Add the parse to the full-rewrite branch.
2. *Active-teacher predicate values (14d / 24h) — tuneable via `operator_settings`?* Defer to a follow-up if real numbers show drift. MVP: hard-coded constants in `pull-runner.ts` with `// BCS-DEF-7 §2.2 active-teacher predicate` comment so the next operator can find them with grep.
3. *Should sub-PR (a) include the `null`-on-reconnect hook, or save it for sub-PR (b)?* Include in (a). It's a one-line UPDATE addition to `upsertGoogleIntegration`'s initial_connect branch, and shipping (a) alone with the column unused-but-also-uncleared-on-reconnect would leave a footgun window between (a) and (b) merges.

---

End of plan. Total line count budgeted ~390 lines including code blocks and tables.
