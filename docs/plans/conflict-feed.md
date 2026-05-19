# CONFLICT-FEED — `/admin/slots/conflicts` operator dashboard

**Status:** REVIVED 2026-05-19. Re-paranoia in progress (plan-mode). Was PARKED v1 (2026-05-17, post-paranoia round 1).

---

## 0a. Revival preamble (2026-05-19, pre-paranoia)

Product-owner decision 2026-05-19: revive now (was PARKED pending ≥3 teachers on prod OR operator complaint about /admin-side visibility per `ENGINEERING_BACKLOG.md:46`). Substantial work has shipped between PARK and revival; the original §0 (now §0z below) BLOCKERs need re-evaluation against current `main`.

**Code state checked on `main` 2026-05-19** (this branch: `docs/bcs-def-2-conflict-feed-revive`):

### What's now closed (was a BLOCKER, no longer applies)

- **(was) BLOCKER #1 — BCS-F.1 detector wire-up missing.** Closed by PR #251 (merged 2026-05-17). `lib/calendar/pull-worker.ts:19,191,212` — `runConflictDetectionForTeacher()` is now called inside `processOneJob()` after every successful pull tick (best-effort, doesn't fail the pull job). `external_conflict_at` is being stamped on prod. The 4 conflict columns are no longer dead-letter. Confirmed: `git grep -n runConflictDetectionForTeacher lib/calendar/` returns wire-up at `pull-worker.ts:19,212` in addition to test call-sites.

### What still applies from the original round-1 (load-bearing for this revival)

The other 4 BLOCKERs and 6 WARNs from the original §0z below need re-verification against current code, then closure in this plan revision before re-paranoia. Pre-revival audit notes:

- **BLOCKER #3 (audit-row TX) — STILL APPLIES.** `lib/scheduling/slots/mutations-cancel.ts:33-75` shows `cancelSlot()` opens its own `pool.connect() → BEGIN → ... → COMMIT/ROLLBACK` internally, returning ONLY the resulting slot row. `lib/scheduling/slots/mutations-write.ts:277-324` shows `moveOpenSlot()` uses standalone `pool.query()` with no TX. Neither accepts a caller-provided client. The plan's "wrap UPDATE + audit INSERT in one TX" (§3.4 / §4.2) is mechanically impossible without refactoring the lib signatures — and refactoring `cancelSlot` to accept an external client is non-trivial because it dynamically imports `restorePackageConsumption` mid-TX (line 59-64). **Resolution path (chosen, refined through round-1 + round-2):** for `cancel-from-conflict`, the route AWAITs `runCancelFromConflictCleanup()` after `cancelSlot()` returns — that helper owns its own cleanup TX (BEGIN → stamp-clearing UPDATE → SAVEPOINT → audit INSERT → COMMIT, with `42P01` recovery via ROLLBACK TO SAVEPOINT). Move-from-conflict is dropped (§0a — detector only stamps booked, move-route is open-only). For `dismiss-conflict`, the new endpoint owns the whole TX (FOR UPDATE → UPDATE → SAVEPOINT → audit INSERT → COMMIT). Full pseudo-code at §3.3 + §3.4. The "load-bearing for compliance" framing in original §0z BLOCKER #3 is downgraded — operator compliance is preserved by `lib/scheduling/slots/mutations-cancel.ts` already emitting an `appendEventSql('slot.cancelled', 'admin', ...)` event into the slot's `events` jsonb history (line 47, 55), which is the canonical audit. `slot_admin_actions` becomes a SECONDARY index keyed by operator action, not the only audit.

- **BLOCKER #4 (withIdempotency on cancel + move) — DOWNGRADED TO WARN.** Current `app/api/admin/slots/[id]/cancel/route.ts` does NOT wrap in `withIdempotency`. `app/api/admin/slots/[id]/move/route.ts` does NOT wrap either. Both are atomic SQL UPDATEs against deterministic WHERE clauses (`status <> 'cancelled'` / `status = 'open'`), so double-click is naturally idempotent at the SQL layer: 2nd UPDATE returns 0 rows and the route returns 404. The new `slot_admin_actions` row would be the only duplication risk. Given the audit row is post-commit best-effort (see BLOCKER #3 closure above), a duplicate `slot_admin_actions` row from a double-click is ≤1 extra ledger row, not a correctness defect. Acceptable. **Closure:** dismiss-conflict (the only NEW endpoint) wraps in `withIdempotency` mirroring sibling reconciliation routes. Cancel/move stay as-is; if duplicates show up in `slot_admin_actions` during op-validation, follow-up adds a partial unique index.

- **BLOCKER #5 (atomic UPDATE ... RETURNING) — STILL APPLIES, EASY CLOSURE.** New `POST /api/admin/slots/[id]/dismiss-conflict` must do `UPDATE ... WHERE id=$1 AND external_conflict_at IS NOT NULL RETURNING ...` (already the teacher-endpoint pattern at `app/api/teacher/slots/[id]/dismiss-conflict/route.ts:60-72`) so two operators racing to dismiss the same conflict each get an atomic UPDATE; the 2nd UPDATE returns 0 rows and the route 404s. Audit INSERT inside the same TX, only on `result.rows.length > 0`. Closure: §3.3 already promised this; spelled out explicitly in §4.4 below.

- **BLOCKER #6 (42P01 graceful degradation) — STILL APPLIES.** New table `slot_admin_actions` (migration **0062**) needs graceful-degradation pattern. Three surfaces, REVISED per round-1 re-paranoia BLOCKER#1+#2:
  - **(a) Page-level probe.** The page GET handler runs an explicit migration-pending check: `SELECT 1 FROM information_schema.tables WHERE table_name = 'slot_admin_actions'` (returns 0 or 1 rows; no error path). Renders banner if missing. Reason: `listAdminConflicts` reads only `lesson_slots`/`accounts` — it would NEVER trigger 42P01 itself, so the banner has to be driven by an explicit probe.
  - **(b) Dismiss-conflict route — TX-aware recovery via SAVEPOINT.** The dismiss endpoint runs `BEGIN → SELECT FOR UPDATE → UPDATE → SAVEPOINT before_audit → INSERT INTO slot_admin_actions → on 42P01 catch: ROLLBACK TO SAVEPOINT before_audit; RELEASE SAVEPOINT; COMMIT → return 200`. SAVEPOINT is the only correct way to recover a single statement inside a TX without aborting the whole TX (Postgres marks the TX aborted on any failed statement; only ROLLBACK TO SAVEPOINT undoes the failure while keeping the TX live). Round-1 BLOCKER#1 closure.
  - **(c) Cancel-from-conflict route — awaited post-commit cleanup TX (final shape after round-2 refinement).** After `cancelSlot()` returns truthy AND `fromConflict===true`, the route AWAITs `runCancelFromConflictCleanup()` (defined in §4.2). The helper opens a fresh client + BEGIN, runs the stamp-clearing UPDATE, SAVEPOINTs before the audit INSERT, catches 42P01 by ROLLBACK TO SAVEPOINT, then COMMITs. Any other error from the audit INSERT (re-thrown by the catch) rolls back the WHOLE cleanup TX, which leaves the conflict stamp intact on the cancelled row — but the `status='booked'` filter in the badge + list query excludes it, so the UI invariant holds. Helper swallows errors internally; the cancel-route response is still 200. See full pseudo-code at §3.4 below.

- **WARN (move dead-by-design) — STILL APPLIES, BUT DOWNGRADED TO INFO.** `lib/calendar/conflict-detector.ts:62-64` filters `status = 'booked' AND start_at > now()`. Open slots are NEVER stamped with `external_conflict_at`. So the Move button (open-only) IS dead by definition on rows reachable via the listAdminConflicts feed. **Closure:** drop the Move button entirely from the conflicts page UI. **Two inline actions: Dismiss + Cancel.** The teacher account is reachable via the teacher-email link in each row (plain `<a href="/admin/accounts/<teacher_id>">{email}</a>`), not as a button — read-only navigation, not a third action. If a future detector kind stamps OPEN slots, revisit.

- **WARN (partial index doesn't cover cross-teacher ORDER BY) — STILL APPLIES.** `migrations/0042` has `lesson_slots_external_conflict_idx (teacher_account_id, start_at) WHERE external_conflict_at IS NOT NULL`. The admin query orders by `external_conflict_at DESC` cross-teacher (§3.1). **Closure:** add a second partial index `lesson_slots_external_conflict_admin_idx (external_conflict_at desc) WHERE external_conflict_at IS NOT NULL AND status = 'booked'` in the new migration. **The `status = 'booked'` predicate is load-bearing** — round-1 WARN#4 caught that without it, cancelled-but-still-stamped rows accrete in the partial index and degrade selectivity over time. Round-1 BLOCKER#3 also depends on this — the badge query must apply the same `status = 'booked'` filter (see new "cancel-from-conflict must clear conflict columns" closure below).

- **WARN (30-day window hides long-lived unresolved conflicts) — STILL APPLIES.** Closure: keep 30d default, but add a "show all" toggle in the UI (`?window=all` query param) for when operator is hunting a stale conflict. Documented in §3.1 and §3.5.

- **(NEW from round-1 re-paranoia BLOCKER#3) — cancel-from-conflict MUST clear the 4 conflict columns.** `cancelSlot()` in `lib/scheduling/slots/mutations-cancel.ts:41` flips status to `'cancelled'` but does NOT touch `external_conflict_at` / `external_conflict_kind` / `conflict_source_*`. The detector at `lib/calendar/conflict-detector.ts:62-64` only scans `status = 'booked'` slots, so a cancelled-but-stamped row is NEVER re-scanned — the stamp persists forever. The badge `count(*) where external_conflict_at is not null` would include those zombie rows, and "Конфликты (N)" would never decrement back to 0 after a cancel-from-conflict. **Closure** — three coordinated changes:
  - **(i) Badge query adds `status = 'booked'` filter.** `countAdminConflicts` query becomes `select count(*) from lesson_slots where external_conflict_at is not null and status = 'booked' and external_conflict_at > now() - interval '30 days'`. Matches the list query's filter exactly.
  - **(ii) cancel-from-conflict route clears the 4 conflict columns post-commit.** After `cancelSlot()` returns truthy AND `fromConflict===true`, the route runs a fresh `UPDATE lesson_slots SET external_conflict_at=null, external_conflict_kind=null, conflict_source_calendar_id=null, conflict_source_event_id=null WHERE id=$1 AND status='cancelled'` (safety: only nulls if cancel succeeded). Same TX as the audit INSERT (single fresh pool.query call running BEGIN + UPDATE + INSERT + COMMIT on one client). On `42P01` for the audit table: SAVEPOINT-recover so the UPDATE part still commits.
  - **(iii) Partial index adds `status = 'booked'` predicate.** See WARN above. Closes round-1 WARN#4 too — keeps the partial index selective by excluding cancelled rows. Per the BLOCKER #3 closure above, `lesson_slots.events` jsonb is the canonical audit for cancel/move (preserved on slot ON DELETE only if `lesson_slots` rows aren't physically deleted — and they aren't on prod today). `slot_admin_actions` is a secondary cross-action index. If a slot is ever hard-deleted, its history goes with it — acceptable for a secondary index. ON DELETE CASCADE stays.

- **WARN (implementation didn't name client island) — STILL APPLIES.** Closure: §3.5 spelled out — the actions cell is a client component (named `<ConflictsActionsCell>` colocated at `app/admin/(gated)/slots/conflicts/_components/actions-cell.tsx`), mirrors the PKG-RECON pattern.

- **WARN (test list missed "old caller without fromConflict still identical") — STILL APPLIES.** Closure: §4.5 expanded — regression test `cancel without fromConflict body → no slot_admin_actions row written` and `move without fromConflict body → no slot_admin_actions row written` both added.

### New context shipped between PARK and revival

- **BCS-DEF-1 probe shipped** — `/admin/settings/alerts` carries the `conflict-unresolved` probe (`app/admin/(gated)/settings/alerts/page.tsx:41-51`). Probe sends operator email with deep-link to `/admin/accounts/<id>` (account page — not a slot list). Once `/admin/slots/conflicts` exists, the probe's email body deep-link target SHOULD be amended to point at the new dashboard. This is a cross-PR doc-sync chore — not blocking this plan, but noted as a follow-up in §6 + §7. Tracked in BCS-DEF-1's plan-doc §10.4 anticipating this exact dashboard.
- **BCS-DEF-1-FANOUT dropped** (PR #381, 2026-05-19) — teacher banner in `/teacher` covers the operator's "tell the teacher" gap. The dashboard is now strictly operator-side observability (not "and notify the teacher"), reinforcing §1's MVP scope ("dismiss/cancel only; out of scope: email teacher").
- **`/admin/slots` slot-id column shipped** (PR #373, 2026-05-19) — slot identification on the existing admin slots table is solid. New conflicts page reuses the same slot-id column convention.
- **ALERTS-EDITOR shipped** (`alerts-editor.md` plan) — `/admin/settings/alerts` already carries the operator-chrome pattern this dashboard reuses. Card layout, `border-radius: 8`, `var(--surface)` background, `<Field label>` helper — see `app/admin/(gated)/settings/alerts/page.tsx:165-352` for the chrome template.

### Migration number correction

Original plan named migration `0054_slot_admin_actions.sql`. 0054 is now taken by `0054_calendar_channel_token_enc.sql` (SEC-4 channel-token encryption, 2026-05-17). Round-1 closure picked 0061; round-2 caught that **0061 is now also taken** by `0061_probe_runs_recipient_kind.sql` (BCS-DEF-1 follow-up, shipped between round-1 close and round 2). Next free number per `ls migrations/` as of 2026-05-19 EOD: **0062**. All references below use 0062.

### Sub-PR decomposition

This wave fits in one PR per skill §1.5 ("standalone one-PR epic — plan + wave on the same PR"). No sub-PR decomposition needed. Total estimated impl LOC ~600-700 (migration + lib helper + page + 3 routes + tests).

---

---

## 0b. Round-1 re-paranoia closure summary (2026-05-19)

Round 1 of the re-paranoia loop returned BLOCK with **3 BLOCKERs + 2 WARNs + 1 INFO** (the INFO confirmed §0a's two key claims hold). Inline closures applied in this revision before round 2:

| Round-1 finding | Closure (location in this doc) |
|---|---|
| **BLOCKER#1** — 42P01 fallback as written can't COMMIT after a failed `INSERT INTO slot_admin_actions` (Postgres aborts the TX). | SAVEPOINT-guarded audit INSERT in dismiss-conflict route (§3.3 pseudo-SQL). The audit INSERT now sits between `SAVEPOINT before_audit` and `RELEASE SAVEPOINT before_audit`; 42P01 catches re-run as `ROLLBACK TO SAVEPOINT before_audit`, which keeps the TX live so the slot UPDATE can still commit. cancel-from-conflict uses the same SAVEPOINT pattern inside its post-commit cleanup TX (§3.4). |
| **BLOCKER#2** — Page-level migration-pending banner can't fire because the page reads only `lesson_slots`/`accounts` — never touches `slot_admin_actions`. | Explicit `isAuditTablePresent()` probe via `SELECT 1 FROM information_schema.tables ...` runs at page render time (§3.5 + §4.2 helper). Result drives the banner directly; no reliance on 42P01 propagating up from an unrelated query. |
| **BLOCKER#3** — Badge count would include stale stamps on cancelled rows forever: `cancelSlot()` doesn't clear `external_conflict_*`, detector skips `status != 'booked'`. Operator cancels a conflicted slot → row disappears from the list, but the badge keeps counting it. | Three coordinated changes: (a) badge SQL adds `status = 'booked'` filter (§3.6); (b) cancel-from-conflict cleanup TX clears the 4 conflict columns post-commit (§3.4); (c) partial index from migration 0062 adds `status = 'booked'` predicate so cancelled stamped rows don't pollute the index either (§3.2). |
| **WARN#4** — New partial index `lesson_slots_external_conflict_admin_idx` lacks `status='booked'` predicate, so cancelled stamped rows accrete over time. | Added to partial index predicate in migration 0062 schema (§3.2). |
| **WARN#5** — `recordSlotAdminActionBestEffort` described as fire-and-forget — but in an async route handler a non-awaited promise might be cut off before the runtime returns the response. | Replaced fire-and-forget with `runCancelFromConflictCleanup` which is AWAITED inside the route. Errors are swallowed inside the helper (logged warn); response status driven by `cancelSlot()` outcome only. §4.2 + §3.4. |
| **INFO#6** — Two §0a claims held: detector wire-up confirmed in pull-worker, drop of move-from-conflict correct (detector filters `status='booked'`, move accepts `status='open'`, no overlap). | No action — positive confirmation. |

Round-1 final raw output: `/tmp/codex-paranoia-20260519T165616Z/round-1.md`.

---

## 0c. Round-2 re-paranoia closure summary (2026-05-19)

Round 2 returned BLOCK with **1 BLOCKER + 3 WARNs + 3 INFOs** (the 3 INFOs explicitly confirmed round-1 closures held — SAVEPOINT pattern correct, table probe + cleanup-TX coordination + partial-index/badge filter all consistent, brief window between cancelSlot commit and cleanup TX commit is invisible to dashboard reads). Inline closures applied:

| Round-2 finding | Closure |
|---|---|
| **BLOCKER#1** — Migration number 0061 also taken (by `0061_probe_runs_recipient_kind.sql`, shipped between round-1 close and round 2). | Bumped to **0062** via bulk perl replace of `0061 → 0062` across all 13 references in the plan. §0a "Migration number correction" subsection updated to call out the second collision. Verified `ls migrations/` shows 0061 occupied, 0062 free. |
| **WARN#2** — §1 Goal still listed "three inline resolution actions" including Move, contradicting §0a/§3.4/§4.4 which already dropped Move. Doc drift could mislead implementers. | §1 Goal rewritten to "Two inline resolution actions" with the Move bullet struck-through + rationale (`status='booked'` detector filter vs `status='open'` move-route filter). |
| **WARN#3** — §4.4 still referenced obsolete `recordSlotAdminActionBestEffort` helper; §4.2 said "response only fires after the cleanup is DURABLE" but §6 R3 allows the cleanup to roll back entirely and still return 200. | §4.4 cancel-route bullet updated to "AWAIT `runCancelFromConflictCleanup()` post-commit"; §4.2 wording aligned: "awaited cleanup ATTEMPT" + explicit "may fail and still return 200" line. Contract is now consistent across §3.4 + §4.2 + §4.4 + §6 R3. |
| **WARN#4** — `isAuditTablePresent()` cache scope undocumented. Process-wide memoization would survive the migration flip and leave the banner stuck visible. | §4.2 helper bullet adds "NO CACHING" — explicit ban on module-level cache / `unstable_cache` / `React.cache`. Plain `pool.query()` per page render. |
| **INFO#5** — SAVEPOINT pattern correct (BLOCKER#1 from round-1 holds). | No action. |
| **INFO#6** — BLOCKER#2 / BLOCKER#3 / WARN#4 / WARN#5 closures (round-1) hold consistently. | No action. |
| **INFO#7** — Brief window between cancelSlot commit + cleanup commit is invisible to dashboard reads (both list + badge filter `status='booked'`). | No action. |

Round-2 final raw output: `/tmp/codex-paranoia-20260519T165616Z/round-2.md`.

---

## 0d. Round-3 re-paranoia closure summary (2026-05-19) — SIGN-OFF

Round 3 returned **SIGN-OFF** with **0 BLOCKERs + 4 WARNs + 2 INFOs** (the 2 INFOs confirmed round-2 closures BLOCKER#1 + WARN#4 hold). All 4 WARNs applied inline per skill §2 contract:

| Round-3 finding | Closure |
|---|---|
| **WARN#1** — §0a "Three actions, not four: Dismiss + Cancel + Open teacher account" — but later sections describe two inline actions and no "open teacher account" button. | §0a "(move dead-by-design)" bullet revised: now says "Two inline actions: Dismiss + Cancel" + clarifies the teacher email is a plain navigation link, not a third action button. |
| **WARN#2** — §0a BLOCKER#3 closure description still says "separate post-commit INSERT / no SAVEPOINT needed / log warn + proceed" — contradicting the detailed §3.4 which uses an awaited cleanup TX with SAVEPOINT. | §0a BLOCKER#3 (a) and (c) bullets rewritten to point at §3.4's final shape (awaited cleanup TX with SAVEPOINT + non-42P01 rollback semantics). Doc-internal consistency restored. |
| **WARN#3** — `cancel-from-conflict` lacks route-level `reason required` invariant; today's cancel route allows null reason. Audit rationale (operator compliance) depends on a non-null reason. | §3.4 "Net surface delta" expanded: when `fromConflict===true`, route returns 400 `{ error: 'reason_required' }` if reason is missing / empty / <3 chars. Reason still optional for the non-fromConflict cancel path (no behavior change for old callers). |
| **WARN#4** — §6 Q7 references `comment on table` for `slot_admin_actions` documenting the fallback-to-jsonb story, but the §3.2 migration sketch has no such comment. | §3.2 migration schema extended with `comment on table slot_admin_actions is '...'` documenting the secondary-index semantics + 42P01 recovery story. Code-doc drift closed. |
| **INFO#5** — 0061 → 0062 migration number bump closed correctly; remaining `0061` mentions are contextual. | No action. |
| **INFO#6** — `isAuditTablePresent()` cache ban + `runCancelFromConflictCleanup` rename held. | No action. |

**Round-3 final outcome: SIGN-OFF.** Plan-mode re-paranoia closed. Impl-unblock: YES. Wave-mode paranoia pending on the implementation diff (separate checkpoint per skill §1.2).

Round-3 final raw output: `/tmp/codex-paranoia-20260519T165616Z/round-3.md`.

---

## 0z. Original PARK note (2026-05-17, preserved for context — NO LONGER FATAL)

Round 1 surfaced 5 BLOCKERs + 6 WARNs. The first BLOCKER is fatal to the wave's premise: the conflict detector function `runConflictDetectionForTeacher()` has tests but **NO production call-site**. The pull-worker (`lib/calendar/pull-worker.ts`) calls `runPullForCalendar()` then marks the job succeeded; it does NOT invoke the detector. `lib/calendar/pull-runner.ts` writes `teacher_external_busy_intervals` and the integration row but never touches `external_conflict_*` columns. Verified via `git grep runConflictDetectionForTeacher` on main 2026-05-17 — only test call-sites.

BCS-F.1 ("Post-pull conflict detector") was marked shipped in the booking-calendly-style.md roadmap, but the actual wiring step was missed. This means:
- The teacher banner at `/teacher` never fires on production today.
- The 4 columns (`external_conflict_at`, `external_conflict_kind`, `conflict_source_*`) are dead-letter in prod.
- Any `/admin/slots/conflicts` dashboard built on top of these columns would be empty by definition.

**Decision: park CONFLICT-FEED until the detector is wired into the pull-worker.** The wiring is a tiny separate PR (~10 lines in pull-worker.ts + a smoke test). After it lands and detector starts stamping columns on prod, this plan can be revived. The other 4 BLOCKERs + 6 WARNs from round 1 still apply when revived; documented below for the resurrection wave.

The remaining round-1 findings (load-bearing for resurrection):
- BLOCKER #3: `recordSlotAdminAction(client, ...)` "same TX as cancel/move" doesn't survive contact with `cancelSlot()` opening its own BEGIN/COMMIT and `moveOpenSlot()` using standalone `pool.query()`. Lib signatures need a client-accepting variant before audit can be load-bearing.
- BLOCKER #4: `withIdempotency` only on new dismiss route; cancel + move don't currently wrap. Double-click on `fromConflict=true` would duplicate audit rows.
- BLOCKER #5: dismiss between two operators needs atomic `UPDATE ... WHERE external_conflict_at IS NOT NULL RETURNING ...` to prevent dual audit-row writes.
- BLOCKER #6: `42P01` graceful degradation for `slot_admin_actions` not specified end-to-end.
- WARN: `move` button is dead by design (detector only stamps `status='booked'`, admin move only accepts `status='open'`).
- WARN: partial index `(teacher_account_id, start_at)` doesn't cover the admin query's `ORDER BY external_conflict_at DESC` cross-teacher.
- WARN: 30-day window hides long-lived unresolved conflicts.
- WARN: `slot_id ... ON DELETE CASCADE` weakens audit (open slots get hard-deleted).
- WARN: Implementation section didn't name the client island.
- WARN: Test list missed "old caller without fromConflict still identical" regression.

Final report: round-1 codex output saved at `/tmp/codex-paranoia-plan-20260517T...Z/round-1.md`.
**Wave name:** CONFLICT-FEED (single-PR epic per skill contract §1.5; small enough to ship in one PR).
**Trigger:** admin-ux-coverage §10.1 P3, unblocked by ALERTS-OBS landing (alert-observability shape now in place). Originally tracked as BCS-DEF-2 in `docs/plans/booking-calendly-style.md:372`.

## 1. Goal

Stand up `/admin/slots/conflicts` so the operator can see every `lesson_slot` where `external_conflict_at IS NOT NULL` in the last 30 days and take inline resolution actions. Today the operator has zero `/admin` signal that a teacher's slot was conflicted; the only feed is the teacher's red banner on `/teacher`. Operator can't see "which teacher needs help right now" without SSH + raw SQL.

**Two inline resolution actions (per row)** — round-2 doc-drift closure: §0a dropped Move entirely (detector only stamps `status='booked'`, move route only accepts `status='open'`, so the action surface is unreachable). Original §1 listed three actions; corrected here:

1. **Dismiss** — clear `external_conflict_at = null` (plus the other 3 conflict columns). Optimistic: if the conflict re-emerges on next pull, the row gets re-stamped. Mirrors `POST /api/teacher/slots/[id]/dismiss-conflict` semantics. New endpoint: `POST /api/admin/slots/[id]/dismiss-conflict` (§3.3).
2. **Cancel** — call the existing `POST /api/admin/slots/[id]/cancel` (reuses shared `cancelSlot()` lib function with `operatorRole='admin'`). Operator types a cancellation reason. EXTENDED to accept `{ fromConflict: true }` (§3.4) so the post-commit cleanup TX clears the conflict stamps + writes the secondary `slot_admin_actions` audit row.

~~3. **Move** — DROPPED per §0a.~~ Detector at `lib/calendar/conflict-detector.ts:62-64` only scans `status='booked'` slots; admin move route at `app/api/admin/slots/[id]/move/route.ts:85` only accepts `status='open'` slots. Zero overlap. If a future detector kind stamps open slots, BCS-DEF-2-FOLLOWUP restores the move action.

**Explicit non-goals for this MVP:**

- **NO admin-side delete-external-event action.** The teacher endpoint at `POST /api/teacher/slots/[id]/delete-external-conflict` uses the teacher's OAuth token to call `events.delete` on Google Calendar (`scripts/.../push.ts:332`). Admin can't act on the teacher's Google account without impersonation — out of scope for MVP. Operator's "escalate to teacher" workflow remains: email/Telegram nudge.
- **NO 'liveConflicts' (+N other conflicts) endpoint inline.** The teacher UI shows up to N alternate overlaps via `listConflictsForSlot`. Admin view shows the single deterministic conflict from `external_conflict_at` + `external_conflict_kind` columns; alternate overlaps stay teacher-side.
- **NO conflict-resolution editor / threshold editor.** Detection cadence + thresholds belong to a future `/admin/settings/conflicts` wave (BCS-DEF-1 territory).
- **NO new push to Resend/email.** Notification stack stays as-is (BCS-DEF-1 is a separate wave).

## 2. Existing surface inventory

Per the COMPANY.md Survey-before-plan rule. All citations verified 2026-05-17 against current `main` (after ALERTS-OBS PR #249 merged + doc-sync PR #250 merged).

### 2.1 Detector + DB shape

- **`lib/calendar/conflict-detector.ts:1-223`** — post-pull detector. Touches columns: `external_conflict_at`, `external_conflict_kind`, `conflict_source_calendar_id`, `conflict_source_event_id`. In practice only writes `external_conflict_kind = 'post_book_overlap'` (the other 3 enum values — `pre_book_busy`, `external_event_deleted`, `external_event_moved` — are reserved for future detectors per migration 0042 line 67-72; not currently emitted).
- **`migrations/0042_lesson_slots_calendar_columns.sql:1-177`** — column set + indexes. Hot-path index `lesson_slots_external_conflict_idx (teacher_account_id, start_at) WHERE external_conflict_at IS NOT NULL` is exactly what the new admin query needs.
- **`lib/scheduling/slots/queries.ts:200-242`** — `listSlotsForCalendarRange` already projects the 4 conflict columns. Admin query reuses the projection but filters `external_conflict_at IS NOT NULL AND start_at > now() - interval '30 days'`.
- **No conflict-events audit table exists today.** Dismiss + delete-external on the teacher side write nothing to `auth_audit_events` or `payment_audit_events`. This wave SHOULD add audit on the admin actions (operator compliance) — see §3.4 retention/audit decision.

### 2.2 Teacher-side resolution actions (existing — reused or mirrored)

- **`POST /api/teacher/slots/[id]/dismiss-conflict/route.ts:14-84`** — clears the 4 conflict columns. Auth: `requireTeacherAndVerified`. Rate limit 30/min/IP. **No audit row** today.
- **`POST /api/teacher/slots/[id]/delete-external-conflict/route.ts:17-249`** — synchronously calls `deleteEvent()` (push.ts:332) with teacher's OAuth token via `withTokenRetry`. Single-TX clears the matching `teacher_external_busy_intervals` row and all `lesson_slots` pointing at that `(cal_id, event_id)`. **Admin cannot reuse this — needs teacher's token.** Out of MVP scope.
- **`POST /api/teacher/slots/[id]/cancel/route.ts:24-125`** — generic cancel, takes reason. Calls shared `cancelSlotByTeacher()` lib function.
- **`PATCH /api/teacher/slots/[id]/move/route.ts:29-142`** — generic move; only for `status='open'` slots.

### 2.3 Admin-side surfaces (existing — reused)

- **`POST /api/admin/slots/[id]/cancel/route.ts:17-83`** — calls shared `cancelSlot()` lib with `operatorRole='admin'`. Already audited. CONFLICT-FEED reuses verbatim.
- **`PATCH /api/admin/slots/[id]/move/route.ts:34-154`** — calls shared `moveOpenSlot()` lib. Open-only. CONFLICT-FEED reuses verbatim.
- **`app/admin/(gated)/slots/page.tsx:1-51`** — generic slot list (status='all', limit=200). NOT conflict-focused. New page lives at `/admin/slots/conflicts` (sub-route, keeps calendar ops grouped).
- **No admin dismiss-conflict endpoint exists today.** This wave adds `POST /api/admin/slots/[id]/dismiss-conflict` mirroring the teacher endpoint but with `requireAdminRole` and an audit-row write.

### 2.4 Admin layout slot

`app/admin/(gated)/layout.tsx:72-84` defines 11 current tabs (after ALERTS-OBS landed "Алерты"). Placement option: **sub-route** under existing "Слоты" tab. Concretely: the `/admin/slots` page gets a "Конфликты (N)" link near its header; clicking goes to `/admin/slots/conflicts`. No new top-level nav entry (keeps the calendar/slot domain visually grouped; operator already lands on `/admin/slots` to look at slot state).

### 2.5 Audit / retention model decision

The teacher-side conflict actions today write NO audit rows. The admin actions in this wave SHOULD write audit (operator compliance — "who dismissed this conflict and why"). Three options:

- **(a) Reuse `payment_audit_events`** — wrong sink, payment-domain only, requires `invoice_id` FK.
- **(b) Reuse `auth_audit_events`** — wrong sink, auth-domain only.
- **(c) NEW `slot_admin_actions` table** — purpose-built durable log keyed by `(operator_account_id, slot_id, action, performed_at, payload jsonb)`. Same shape as `package_grant_resolutions` (sibling operator-action audit table from PKG-RECON).

Decision: **(c)**, see §4.2. Migrations + retention also added.

### 2.6 Test infrastructure

- **`tests/integration/calendar/conflict-actions.test.ts:1-80`** + **`tests/integration/calendar/conflict-detector.test.ts:1-80`** — seed teacher + slot + busy interval, run detector, assert conflict stamp. New tests REUSE the seed helpers.
- No test helper today for the `listSlotsForCalendarRange` admin filter path — write one.

## 3. Design — Option B+ (new audit table, no admin-side delete-external)

### 3.1 New page reads via a server lib helper

`lib/admin/conflict-feed.ts:listAdminConflicts(opts: { since: Date | 'all' })` runs:

```sql
select s.id, s.teacher_account_id, s.learner_account_id, s.tariff_id,
       s.status, s.start_at, s.duration_minutes,
       s.external_conflict_at, s.external_conflict_kind,
       s.conflict_source_calendar_id, s.conflict_source_event_id,
       t.email as teacher_email,
       l.email as learner_email
  from lesson_slots s
  join accounts t on t.id = s.teacher_account_id
  left join accounts l on l.id = s.learner_account_id
 where s.external_conflict_at is not null
   and ($1::timestamptz is null or s.external_conflict_at > $1::timestamptz)
   and s.status = 'booked'                     -- §0a closure: detector only stamps booked
 order by s.external_conflict_at desc
 limit 200
```

**§0a closures applied:**
- `status` filter narrowed from `in ('open', 'booked')` to `= 'booked'`. The detector at `lib/calendar/conflict-detector.ts:62-64` only scans booked slots, so OPEN slots NEVER have `external_conflict_at IS NOT NULL` in current code. Listing OPEN was always a dead path.
- 30-day window: default `$1 = now() - interval '30 days'`. Override `?window=all` passes `null` (the `is null OR ...` clause returns all-time).
- Cross-teacher ORDER BY served by NEW partial index `lesson_slots_external_conflict_admin_idx (external_conflict_at desc) WHERE external_conflict_at is not null` (added in migration 0062 §3.2 below). The existing `(teacher_account_id, start_at)` partial from migration 0042 doesn't serve cross-teacher ORDER BY DESC.

Both indices are partial (cheap; row count = active conflicts only).

### 3.2 Action audit table

`migrations/0062_slot_admin_actions.sql` (NEW — note: original plan said 0054 but that number is now taken by `0054_calendar_channel_token_enc.sql`):

```sql
create table if not exists slot_admin_actions (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references lesson_slots(id) on delete cascade,
  operator_account_id uuid not null references accounts(id) on delete restrict,
  action text not null check (action in (
    'dismiss-conflict',
    'cancel-from-conflict'
    -- §0a closure: 'move-from-conflict' dropped — detector only stamps
    -- booked slots, move is open-only, so the move-from-conflict path
    -- is unreachable. CHECK constraint excludes it. If a future detector
    -- kind stamps open slots, add this enum value + UI in a follow-up.
  )),
  reason text null,
  payload jsonb null,                        -- pre-action conflict snapshot
  performed_at timestamptz not null default now()
);

create index if not exists slot_admin_actions_slot_idx
  on slot_admin_actions (slot_id, performed_at desc);
create index if not exists slot_admin_actions_operator_idx
  on slot_admin_actions (operator_account_id, performed_at desc);

-- §0a closure: cross-teacher ORDER BY external_conflict_at DESC index.
-- The existing migration 0042 partial index serves the teacher's banner
-- query (per-teacher); admin dashboard needs cross-teacher DESC.
-- Round-1 WARN#4 closure: include `status = 'booked'` in the partial
-- predicate so cancelled-but-still-stamped rows don't pollute the index
-- (cancel-from-conflict nulls the columns in the same wave, but old
-- pre-wave cancelled rows might still carry stamps until a teacher
-- pull cycle catches them — and the detector ignores cancelled slots
-- per `lib/calendar/conflict-detector.ts:64`, so they never get
-- cleaned up by detection).
create index if not exists lesson_slots_external_conflict_admin_idx
  on lesson_slots (external_conflict_at desc)
  where external_conflict_at is not null
    and status = 'booked';

-- Round-3 WARN closure: document the secondary-index semantics inline.
-- The canonical operator-action audit lives in lesson_slots.events
-- jsonb (in-TX with the slot mutation, populated by cancelSlot() /
-- the dismiss-conflict route). slot_admin_actions is a SECONDARY
-- cross-action index — purpose-built so operators can query "all
-- dismiss-conflict / cancel-from-conflict last week" without scanning
-- every slot's jsonb history. Failure to insert into this table
-- (42P01 during deploy-before-migrate, transient DB error) is
-- recoverable via SAVEPOINT (dismiss) or post-commit log+swallow
-- (cancel) — the slot's events jsonb stays canonical regardless.
comment on table slot_admin_actions is
  'Secondary operator-action audit ledger for conflict-feed dashboard '
  '(BCS-DEF-2, migration 0062). Canonical audit lives in '
  'lesson_slots.events jsonb; this table is a cross-action index for '
  'operator queries. Failures recovered via SAVEPOINT (dismiss-conflict '
  'route) or post-commit log+swallow (cancel-from-conflict cleanup TX). '
  'See docs/plans/conflict-feed.md.';
```

On delete: `slot_id` CASCADE (audit follows the slot — slots are append-only-on-delete in practice today; canonical operator action history lives in `lesson_slots.events` jsonb so cascade is acceptable for this secondary index), `operator_account_id` RESTRICT (matches sibling pattern from PKG-RECON, PKG-ADMIN-GRANT).

### 3.3 NEW admin endpoint: dismiss-conflict

`POST /api/admin/slots/[id]/dismiss-conflict/route.ts`:

- Auth: `requireAdminRole` + `enforceTrustedBrowserOrigin` + rate limit (30/min/IP, matching teacher-side).
- Body: `{ reason: string }` (required, ≥3 chars; ≤`MAX_REASON_LEN` per sibling cancel).
- **withIdempotency** scope `admin:slots:dismiss-conflict:${slotId}:${operatorAccountId}` so sequential double-click doesn't write two audit rows. Per `lib/security/idempotency.ts:42-66` contract: this dedupes SEQUENTIAL replay only — two simultaneous in-flight requests within the executor's runtime window could both fire. For dismiss-conflict that's acceptable: the atomic UPDATE ... WHERE external_conflict_at IS NOT NULL RETURNING gates the actual mutation; the loser sees 0 rows and 404s; only one audit row gets written (because the audit INSERT is gated on `result.rows.length > 0`).
- Atomic UPDATE+audit, single TX (own client) with **SAVEPOINT-guarded audit INSERT** (round-1 BLOCKER#1 closure):
  ```sql
  BEGIN;
  -- Snapshot pre-state (also acts as the FOR UPDATE row lock to
  -- serialize with concurrent dismiss/cancel attempts inside the TX).
  SELECT external_conflict_at, external_conflict_kind,
         conflict_source_calendar_id, conflict_source_event_id
    FROM lesson_slots WHERE id = $1 FOR UPDATE;
  -- IF row missing OR external_conflict_at IS NULL → ROLLBACK; 404.
  UPDATE lesson_slots
     SET external_conflict_at = null,
         external_conflict_kind = null,
         conflict_source_calendar_id = null,
         conflict_source_event_id = null,
         updated_at = now(),
         events = $jsonb_event || events
   WHERE id = $1 AND external_conflict_at IS NOT NULL
  RETURNING id;
  -- IF result.rows.length == 0 → ROLLBACK; return 404 (race with
  -- concurrent dismiss: the FOR UPDATE re-checked and the other tx
  -- already cleared it before we got the lock; rare but possible
  -- across SERIALIZABLE retries).
  SAVEPOINT before_audit;
  -- Audit INSERT — wrapped in a savepoint so 42P01 (table missing
  -- during deploy-before-migrate window) doesn't abort the whole TX.
  INSERT INTO slot_admin_actions
    (slot_id, operator_account_id, action, reason, payload)
  VALUES ($1, $2, 'dismiss-conflict', $3, $payload);
  -- On 42P01 catch: ROLLBACK TO SAVEPOINT before_audit; RELEASE
  -- SAVEPOINT before_audit; — TX is live again, audit row skipped.
  RELEASE SAVEPOINT before_audit;
  COMMIT;
  ```
- Audit payload format: `{ pre_conflict_at, pre_conflict_kind, pre_cal_id, pre_event_id }` — captured from the pre-UPDATE row via the `SELECT FOR UPDATE` above.
- Also writes `appendEventSql('slot.conflict_dismissed', 'admin', { operatorAccountId, reason })` into the slot's `events` jsonb (mirrors `cancelSlot()`'s in-row event log) so the canonical audit lives with the slot regardless of `slot_admin_actions` state.
- **`42P01` (slot_admin_actions missing) handling — VIA SAVEPOINT.** Pseudo-code:
  ```ts
  try {
    await client.query('savepoint before_audit')
    await client.query('insert into slot_admin_actions ...')
    await client.query('release savepoint before_audit')
  } catch (err: any) {
    if (err?.code === '42P01') {
      await client.query('rollback to savepoint before_audit')
      // Audit row skipped. TX continues alive; the UPDATE commits.
      console.warn('[admin.dismiss-conflict] migration 0062 pending — audit row skipped', { slotId })
    } else {
      // Any other error: re-throw to trigger outer ROLLBACK → 500.
      throw err
    }
  }
  ```
  Why SAVEPOINT (not separate connection): keeping audit INSERT in the same TX preserves the per-slot serialization the FOR UPDATE established; a separate connection would lose the lock + introduce a TOCTOU window between UPDATE-commit and audit-INSERT.
- Returns `{ ok: true, slotId }`.

### 3.4 EXTEND existing admin endpoints for audit (post-commit, awaited best-effort)

`POST /api/admin/slots/[id]/cancel/route.ts` already calls `cancelSlot()` which owns its own BEGIN/COMMIT internally and writes `appendEventSql('slot.cancelled', 'admin', ...)` into the slot's `events` jsonb (canonical audit). CONFLICT-FEED extension: when the request body carries `{ fromConflict: true }` AND `cancelSlot()` returns a non-null slot, the route runs a SEPARATE post-commit step. **REVISED per round-1 BLOCKER#3** — the post-commit step does TWO things in a single fresh TX:

1. **Clear the 4 conflict columns** (so the cancelled row stops polluting the dashboard's badge query + partial index).
2. **Insert the `slot_admin_actions` audit row** with `action='cancel-from-conflict'`.

Both in one fresh client TX with SAVEPOINT around the audit INSERT for 42P01 recovery:

```ts
// Pseudo-code — happens AFTER cancelSlot() returns truthy AND fromConflict===true.
const cleanupClient = await pool.connect()
try {
  await cleanupClient.query('begin')
  // Clear conflict stamp on the now-cancelled row. Defensive WHERE:
  // status='cancelled' so we don't clear stamps on slots that aren't
  // actually cancelled (paranoid; cancelSlot just committed).
  await cleanupClient.query(
    `update lesson_slots
        set external_conflict_at = null,
            external_conflict_kind = null,
            conflict_source_calendar_id = null,
            conflict_source_event_id = null,
            updated_at = now()
      where id = $1 and status = 'cancelled'`,
    [slotId],
  )
  try {
    await cleanupClient.query('savepoint before_audit')
    await cleanupClient.query(
      `insert into slot_admin_actions
         (slot_id, operator_account_id, action, reason, payload)
       values ($1, $2, 'cancel-from-conflict', $3, $4)`,
      [slotId, operatorAccountId, reason, payload],
    )
    await cleanupClient.query('release savepoint before_audit')
  } catch (err: any) {
    if (err?.code === '42P01') {
      await cleanupClient.query('rollback to savepoint before_audit')
      console.warn('[admin.cancel-from-conflict] migration 0062 pending — audit row skipped', { slotId })
    } else {
      throw err
    }
  }
  await cleanupClient.query('commit')
} catch (err) {
  await cleanupClient.query('rollback').catch(() => {})
  // The cancel itself committed. Log + return 200 anyway — failing
  // the response would mislead the operator into retrying an
  // already-effective cancel.
  console.warn('[admin.cancel-from-conflict] post-commit cleanup failed', { slotId, err: String(err) })
} finally {
  cleanupClient.release()
}
```

§0a BLOCKER#3 closure rationale: the canonical operator-action audit is `lesson_slots.events` jsonb (already in place, in-TX with the mutation). `slot_admin_actions` is a SECONDARY cross-action index. Treating it as awaited-best-effort post-commit avoids forcing a `cancelSlot` lib refactor.

**Why clear the conflict columns?** Round-1 BLOCKER#3 caught: `cancelSlot()` doesn't clear them, detector ignores cancelled slots (`status = 'booked'` filter at `lib/calendar/conflict-detector.ts:64`), so without this cleanup step the cancelled slot would remain in the badge count + the cross-teacher partial index forever. The cleanup is the ONLY mechanism that removes a stamp from a cancelled slot.

Same shape for `PATCH /api/admin/slots/[id]/move/route.ts` — though §0a closure DROPPED the move-from-conflict button from the UI. The `move` route extension is **deferred** out of MVP — no `fromConflict` flag added, no audit row, no UI surface.

**Net surface delta for cancel route:** add `fromConflict?: boolean` to body parsing AND enforce **`reason` is required when `fromConflict===true`** (round-3 WARN closure). Today the cancel route treats `reason` as optional (`route.ts:46-51` parses `body.reason` and accepts `null`); for fromConflict cancellations the audit chain wants a recorded reason, so the route returns 400 `{ error: 'reason_required' }` if `fromConflict===true` and the body reason is missing / empty / under 3 chars. Reason still optional for the regular admin cancel path (no behavior change for old callers). After `cancelSlot()` returns truthy AND `fromConflict===true`, AWAIT the cleanup TX above. Errors logged + swallowed; response status driven by `cancelSlot()` outcome only.

### 3.5 NEW admin page

`app/admin/(gated)/slots/conflicts/page.tsx`:
- Server component (server-rendered, `dynamic='force-dynamic'`, `runtime='nodejs'`). Lists conflicts via `listAdminConflicts({ since: 30-days-ago })` by default; reads `?window=all` query param to switch to all-time.
- Per row: teacher email, learner email (if booked), tariff title-ru (resolve via `listActiveTariffs()` or join), slot start (UTC + MSK formatted via `Intl.DateTimeFormat`), conflict-kind code (rendered as-is — only `post_book_overlap` emitted today), conflict-source calendar/event ids (truncated to 12 chars + tooltip with full id).
- **Two inline actions per row** (Dismiss + Cancel — no Move per §0a closure):
  - Dismiss button → reveals inline reason textarea → POST `/api/admin/slots/[id]/dismiss-conflict` with `Idempotency-Key: <fresh UUID v4>` per click.
  - Cancel button → reveals inline reason textarea → POST `/api/admin/slots/[id]/cancel` with `{ reason, fromConflict: true }`.
- Each action button writes a fresh UUID Idempotency-Key per click (mirrors PKG-RECON `_components/actions-cell.tsx` pattern, which is the canonical operator-action UI template).
- Empty state: «Конфликтов за последние 30 дней нет.» When `?window=all`: «Конфликтов нет (за всё время).»
- "Все время / 30 дней" toggle link in the header (server-rendered, navigates via plain Link to `?window=all` / no-param).
- **Migration-pending banner (`42P01`) — VIA EXPLICIT PROBE** (round-1 BLOCKER#2 closure). `listAdminConflicts` reads only `lesson_slots`/`accounts` and never touches `slot_admin_actions`, so it would never raise 42P01 on its own. The page renders an EXPLICIT probe at the start: `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'slot_admin_actions'` (returns 0 or 1 rows; no error). If 0 rows, render top-of-page banner "Журнал действий оператора недоступен до миграции 0062. Сами действия (отклонить / отменить) работают; история записывается со следующей миграцией." Banner mirrors ALERTS-OBS migration-pending shape (yellow border + warm fill + body copy).
- Client island: `<ConflictsActionsCell>` colocated at `app/admin/(gated)/slots/conflicts/_components/actions-cell.tsx` ("use client"). Owns reason-state + idempotency-key state + submit-pending state. Server component renders one cell per row.
- Operator deep-link target — BCS-DEF-1 email body (currently points at `/admin/accounts/<id>`) SHOULD be amended to point at `/admin/slots/conflicts` once shipped. Cross-PR follow-up tracked in §6.

### 3.6 Nav addition

`app/admin/(gated)/slots/page.tsx` gets a "Конфликты (N)" badge link in its header. Badge count via `countAdminConflicts({ since: 30-days-ago })`:
```sql
select count(*) from lesson_slots
 where external_conflict_at is not null
   and status = 'booked'                              -- §0a / round-1 BLOCKER#3
   and external_conflict_at > now() - interval '30 days'
```
**The `status = 'booked'` predicate is load-bearing** (round-1 BLOCKER#3): `cancelSlot()` doesn't clear `external_conflict_at`, and the detector ignores cancelled slots, so without this filter cancelled-but-stamped rows would inflate the badge forever. The cancel-from-conflict path clears the stamps proactively, but cancelled rows that existed BEFORE this wave shipped (or cancelled via a non-fromConflict path) may still carry stale stamps; the filter in the badge query is the safety net.

Page is `dynamic='force-dynamic'`; badge is re-rendered server-side every request. No client-side polling. The query uses the new partial index from migration 0062 (cross-teacher DESC, predicate matches exactly).

If `lesson_slots` is unreachable for some reason (extremely rare), `countAdminConflicts` catches the error, logs, returns `null`. The link still renders without the badge: «Конфликты» (no count). Doesn't break the parent page.

**No sidebar nav entry** — the dashboard lives strictly under `/admin/slots/conflicts` and is reached via the "Конфликты (N)" badge on `/admin/slots`. The operator's discovery path is "click Занятия → see badge → click in". Adds zero clutter to the 11-item sidebar (per `app/admin/(gated)/layout.tsx:78-94`).

## 4. Implementation

### 4.1 Migration `0062_slot_admin_actions.sql`

Schema in §3.2. Adds the table + 2 indexes on the table + 1 NEW partial index on `lesson_slots(external_conflict_at desc) where ... is not null`. All additive; no DROP. Idempotent (`create table if not exists` + `create index if not exists`).

### 4.2 Lib helpers (`lib/admin/conflict-feed.ts` — NEW)

- **`listAdminConflicts(opts: { since: Date | null }): Promise<AdminConflict[]>`** — the read (§3.1 SQL). `since=null` means all-time.
- **`countAdminConflicts(opts: { since: Date | null }): Promise<number | null>`** — count for the badge (§3.6 SQL with `status = 'booked'` filter). Returns `null` on error (caller renders link without badge).
- **`isAuditTablePresent(): Promise<boolean>`** — explicit migration-pending probe used by the page (`SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'slot_admin_actions'`). Returns `false` if 0 rows OR query errors. Drives the migration-pending banner per §3.5 (round-1 BLOCKER#2 closure). **NO CACHING.** Each page render runs a fresh query. Round-2 WARN#4 closure: process-wide memoization is FORBIDDEN — a cached `false` would outlive the deploy-before-migrate window and leave the banner visible for the entire process lifetime after the migration runs. Plain pool.query() per request; no module-level cache, no `unstable_cache`, no `React.cache` wrapper.
- **`runCancelFromConflictCleanup(opts: { slotId, operatorAccountId, reason, payload })`** — the post-commit cleanup TX used by cancel-from-conflict (§3.4). Owns its own client + BEGIN/COMMIT + SAVEPOINT around audit INSERT. Awaited by the cancel route; errors swallowed inside the helper (logged warn). Returns void. **NOT fire-and-forget** — the route awaits the cleanup ATTEMPT so the response only fires after the helper resolves. **The attempt may fail and still return 200** (e.g. cleanup TX rolled back due to non-42P01 error); the helper's contract is "do this cleanup work synchronously, don't propagate failures to the route". The cancel itself has already committed in `cancelSlot()` before this helper is called. Round-1 WARN#5 closure (round-2 WARN#3 wording fix: "awaited cleanup ATTEMPT", not "awaited durable cleanup").

Note: there is no separate `recordSlotAdminAction` helper. Dismiss-conflict's audit INSERT is inline in the route (own TX with SAVEPOINT per §3.3); cancel-from-conflict goes through `runCancelFromConflictCleanup` which couples the audit INSERT to the stamp-clearing UPDATE in one TX.

### 4.3 Page

`app/admin/(gated)/slots/conflicts/page.tsx` — server component as described in §3.5.

Client island: `app/admin/(gated)/slots/conflicts/_components/actions-cell.tsx`.

### 4.4 Endpoints

- `POST /api/admin/slots/[id]/dismiss-conflict/route.ts` (NEW). Schema in §3.3.
- `POST /api/admin/slots/[id]/cancel/route.ts` (EXTEND: accept `fromConflict?: boolean` in body; on `cancelSlot()` returning a non-null slot AND `fromConflict===true`, AWAIT `runCancelFromConflictCleanup()` post-commit. Helper swallows errors internally; the cancel response status is driven by `cancelSlot()` outcome only — see §3.4 + §4.2).
- `PATCH /api/admin/slots/[id]/move/route.ts` — **NO CHANGE** (§0a closure: move-from-conflict path unreachable; deferred to follow-up).

### 4.5 Tests

`tests/integration/admin/conflict-feed.test.ts` (NEW):
- listAdminConflicts: seed 3 slots (one with stamp + status='booked', one with stamp + status='cancelled', one without stamp), assert only the booked-stamped one returns. Documents round-1 BLOCKER#3 — cancelled-with-stamp is intentionally excluded.
- listAdminConflicts: 30-day window cutoff (stamp_at > 30 days ago → excluded). With `since=null` (all-time): included.
- listAdminConflicts: status='open' slot with `external_conflict_at` manually set in test DB → excluded (filter `status = 'booked'`). Documents the detector's invariant.
- countAdminConflicts: matches listAdminConflicts row count. **Including the regression test:** seed a booked-stamped row, cancel-from-conflict it via the cancel route with `{ fromConflict: true }`, then re-query countAdminConflicts → assert it returns 0 (the stamp was cleared by the cleanup TX). This is the test that pins round-1 BLOCKER#3 closure end-to-end.
- countAdminConflicts: seed a cancelled-but-stale-stamped row directly (simulating pre-wave data), assert it's EXCLUDED by the `status='booked'` filter. Defense-in-depth.
- dismiss-conflict happy path: assert 4 conflict columns cleared + slot_admin_actions row inserted with action='dismiss-conflict' + reason + pre-conflict payload snapshot + slot's `events` jsonb got a new `slot.conflict_dismissed` event.
- dismiss-conflict auth: anon → 401; learner → 403; teacher → 403.
- dismiss-conflict idempotency: same Idempotency-Key replay → one row, one update (per `lib/security/idempotency.ts` SEQUENTIAL replay contract).
- dismiss-conflict on already-cleared slot → 404 (the `WHERE external_conflict_at IS NOT NULL` clause matches 0 rows; ROLLBACK; no audit row).
- dismiss-conflict race: two near-simultaneous requests with DIFFERENT Idempotency-Keys → one succeeds, one 404s (atomic UPDATE serializes them).
- **dismiss-conflict 42P01 via SAVEPOINT recovery** (round-1 BLOCKER#1 + #6 closure): drop `slot_admin_actions` table for this test only, call dismiss → response is 200, lesson_slots columns cleared (UPDATE committed), no audit row written. Verifies the SAVEPOINT-ROLLBACK-TO recovery actually works (without SAVEPOINT the TX would abort and the UPDATE wouldn't commit either — this test is the canary for that bug).
- cancel + fromConflict=true on a booked-stamped slot: assert (a) slot.status='cancelled', (b) slot_admin_actions row written with action='cancel-from-conflict', (c) `external_conflict_at` IS NULL after the cleanup TX, (d) `lesson_slots.events` jsonb shows both `slot.cancelled` and the operator action history.
- cancel + fromConflict=true + audit table missing (42P01): assert cancel still 200, slot cancelled, conflict stamp cleared (the UPDATE half of cleanup TX succeeds), audit INSERT skipped (SAVEPOINT recovery in cleanup TX).
- cancel + fromConflict=true + cleanup TX errors entirely (e.g. simulated by closing the pool client mid-flight): assert cancel still 200 (the outer try/catch on `runCancelFromConflictCleanup` swallows). Documents the response-decoupling contract.
- cancel WITHOUT fromConflict (default): assert NO slot_admin_actions row written, NO stamp-clearing UPDATE runs (regression — old caller behavior preserved).
- Schema CHECK on `action` rejects unknown values (e.g. `'move-from-conflict'` → DB raises; documents the §0a closure that this enum value is intentionally absent).
- `move` endpoint: no `fromConflict` accepted (schema unchanged from current main; if a future caller sends `fromConflict: true`, it's accepted-then-ignored).
- **Migration-pending probe** (round-1 BLOCKER#2 closure): drop `slot_admin_actions` table for this test, hit `/admin/slots/conflicts` GET, assert response body contains the banner copy "Журнал действий оператора недоступен до миграции 0062" (via `isAuditTablePresent()` returning false).

Adjust `tests/integration/admin/*` shared seed helpers if needed; reuse `tests/integration/calendar/conflict-detector.test.ts` seed pattern for the conflict-stamp seeding.

## 5. Rollout

1. Migration 0062 lands in the same PR (single-PR epic). Migration is additive — `create ... if not exists` for table + 3 indexes. No DROP, no behavior change for any code path that runs BEFORE the page + endpoints land (same PR means simultaneous deploy).
2. Page + endpoints + lib helper + migration ship in one PR.
3. After merge: `npm run migrate:up` on prod.
4. Validation (post-deploy): ssh into prod, seed a fake conflict (`update lesson_slots set external_conflict_at = now(), external_conflict_kind = 'post_book_overlap' where id = '<a booked slot id>'`), browse `/admin/slots`, verify the "Конфликты (1)" badge renders; click in, verify the row appears; click Dismiss with reason; verify `select * from slot_admin_actions` shows the row + the slot's `external_conflict_at` is back to null.
5. Graceful degradation: admin page handles `42P01` on `slot_admin_actions` missing → renders banner; actions still work, just no audit-row written. (Same pattern as ALERTS-OBS migration-pending banner.)
6. Cross-PR follow-up (NOT in this wave): amend BCS-DEF-1's email-body deep-link from `/admin/accounts/<id>` to `/admin/slots/conflicts`. Tracked in `docs/plans/conflict-unresolved-alert.md §10.4`. One-line copy change in `scripts/conflict-unresolved-alert.mjs`. Lands as a separate `chore(alerts):` PR once this dashboard is live.

## 6. Risks + mitigations

- **R1 — admin dismiss-conflict races with teacher dismiss.** Both clear the same 4 columns via atomic UPDATE WHERE external_conflict_at IS NOT NULL. The loser sees 0 rows + 404; only one audit row written. No data corruption.
- **R2 — concurrent admin dismiss + a fresh pull stamps a NEW conflict.** Pull is the source of truth. Sequence: (a) admin dismisses at T0, audit row written with payload=snapshot of pre-dismiss state. (b) Pull re-runs at T0+5s, finds the foreign overlap again, re-stamps `external_conflict_at = now()`. Next page render shows the conflict back. Operator can dismiss again — new audit row, new snapshot. Correct behavior; the audit trail records "operator dismissed at T0, persistent conflict re-emerged at T0+5s".
- **R3 — audit-row write fails AFTER cancel-from-conflict's `cancelSlot()` already committed.** The cleanup TX (§3.4) does TWO things: clear conflict columns + insert audit row. With SAVEPOINT around the audit INSERT, 42P01 (migration pending) leaves the stamp-clearing UPDATE committed and the audit row skipped. Any other audit-INSERT error path (e.g. constraint violation) re-throws and the WHOLE cleanup TX rolls back — but the cancel itself ALREADY committed in `cancelSlot()`, so the slot stays cancelled, just with the conflict stamp still attached (transient — will linger in the badge query because `status='booked'` filter excludes it; and the dashboard list query also excludes it; net effect: invisible in the UI). Outer try/catch on `runCancelFromConflictCleanup` swallows the error + logs warn + returns 200. The operator's action succeeded; only the cross-action ledger is missing one row. Acceptable.
- **R4 — operator dismisses a real persistent conflict, masks the problem.** Audit captures the reason. Teacher banner still re-stamps on next pull (detector is the source of truth). The dashboard surfaces the re-stamped conflict on the next render. Hidden problem CANNOT persist beyond one pull cycle — operator gets visibility back automatically.
- **R5 — page render with 200 rows is slow.** 200 cap + the cross-teacher partial index from migration 0062 keeps the read sub-50ms even at production scale. Pagination deferred to follow-up if operator reports the cap is biting.
- **R6 — operator dismisses a slot that's in mid-cancel (transactional race).** Sequence: (a) admin A clicks Cancel-from-conflict, `cancelSlot()` starts its TX (briefly), commits + flips status to `'cancelled'`. THEN the route runs the cleanup TX which clears the conflict stamps. (b) admin B clicks Dismiss between A's `cancelSlot()` commit and the cleanup TX's commit. B's SELECT FOR UPDATE blocks behind the cleanup TX's UPDATE row-lock. After cleanup commits, B sees `status='cancelled'` + `external_conflict_at IS NULL` (just cleared). B's `WHERE external_conflict_at IS NOT NULL` matches 0 rows → ROLLBACK → 404. Audit trail: ONE `cancel-from-conflict` row, ZERO `dismiss-conflict` rows. Correct ledger. Alternative timing: B's SELECT FOR UPDATE jumps the queue BEFORE the cleanup TX gets the lock (Postgres lock fairness is process-arrival order; mostly FIFO but not strictly guaranteed). Then B sees the still-stamped row, clears it + writes a `dismiss-conflict` row, then cleanup TX tries to UPDATE a now-cleared row → 0 rows affected, audit INSERT proceeds → cancelled slot ends up with BOTH `cancel-from-conflict` and `dismiss-conflict` audit rows. Slightly weird ledger but honest about race ordering. Acceptable.
- **R7 — BCS-DEF-1 email-body deep-link drift.** Per §5 step 6, the email currently deep-links to `/admin/accounts/<id>`. After this dashboard ships, that link should change to `/admin/slots/conflicts`. The cross-PR follow-up is REQUIRED for the operator workflow to feel polished, but it's not blocking — the email-link still works (just points at a different page).

## 7. Open questions for paranoia

1. The 30-day window — too short for "did this teacher have recurring conflicts last quarter"? Tradeoff: longer windows make the admin page slower. Default 30 d. `?window=all` toggle in header gives all-time view when operator wants it (§3.5).
2. Should `slot_admin_actions` carry an explicit reason for cancel + move actions (separate from the cancel reason already captured in the slot row)? Decision: NO — cancel has its own reason in `lesson_slots.cancellation_reason` + `events` jsonb; `slot_admin_actions.reason` is dismiss-only. Move is dropped entirely (§0a).
3. `withIdempotency` scope includes `slotId + operatorAccountId` — does this leak across operators? Two operators racing to dismiss the same conflict each get their own idempotency cache row, but the atomic UPDATE serializes them: only one succeeds, only one audit row. Acceptable.
4. The "+N other conflicts" picker (teacher-side, via `listConflictsForSlot`) — should admin see this? Decision: NO for MVP. The single deterministic conflict from the columns is enough for "this slot needs attention". Operator drills into teacher UI if they want details. (Listed in §1 explicit non-goals.)
5. Conflict KINDS — should the admin page differentiate `post_book_overlap` (only one emitted today) from the reserved future kinds? Decision: render the value as-is; no taxonomy needed at UI layer yet. If `pre_book_busy` / `external_event_deleted` / `external_event_moved` start emitting, the page renders the code-string and the operator learns it from context.
6. Should this wave also add the BCS-DEF-1 ">2h unresolved → email/Telegram" alert? Decision: NO — BCS-DEF-1 already shipped 2026-05-19 (`/admin/settings/alerts` with conflict-unresolved probe). The probe's email deep-link is the cross-PR follow-up in §5 step 6.
7. Awaited post-commit audit + cleanup for cancel-from-conflict (§3.4) — is the operator going to notice if `slot_admin_actions` is missing a row when they audit "show me cancellations from conflict feed last week"? Yes — but the canonical `lesson_slots.events` jsonb has the cancel event with `actor='admin'` + `cancelledByAccountId`; the operator's audit query falls back to a jsonb scan if the secondary index is incomplete. Acceptable (and documented in the migration's `comment on table` clause).
8. (NEW round-1 round-trip) — does the SAVEPOINT pattern in §3.3 + §3.4 introduce ordering issues? Postgres SAVEPOINT semantics are well-defined: ROLLBACK TO SAVEPOINT undoes statements after the savepoint while keeping the TX live. Sibling pattern: `app/api/admin/settings/alerts/[probe]/test-send/route.ts:101` uses `SELECT EXISTS(...)` preflight instead of SAVEPOINT recovery. We chose SAVEPOINT here because (a) the audit table is the only thing that might be missing, (b) preflight + INSERT introduces a TOCTOU window where the table could disappear between the check and the INSERT (extremely rare but `42P01` recovery is more honest), (c) SAVEPOINT keeps the per-slot row-lock alive throughout the TX, which preflight doesn't.

## 8. Scope estimate (impl unblock check)

**Total LOC estimate:** ~600-700 lines of impl code, ~300 lines of integration tests.

| File | Net LOC | Notes |
|---|---|---|
| `migrations/0062_slot_admin_actions.sql` | ~50 | Table + 3 indexes + comments. |
| `lib/admin/conflict-feed.ts` | ~150 | 3 functions + types. |
| `app/admin/(gated)/slots/conflicts/page.tsx` | ~180 | Server component + chrome (reuses ALERTS-OBS chrome conventions). |
| `app/admin/(gated)/slots/conflicts/_components/actions-cell.tsx` | ~100 | Client island. |
| `app/admin/(gated)/slots/page.tsx` | ~15 | Add the badge link. |
| `app/api/admin/slots/[id]/dismiss-conflict/route.ts` | ~120 | New endpoint with own TX + 42P01 handling. |
| `app/api/admin/slots/[id]/cancel/route.ts` | ~30 | EXTEND for fromConflict best-effort audit. |
| `tests/integration/admin/conflict-feed.test.ts` | ~300 | 12 test cases per §4.5. |
| **Total** | **~945** | Single-PR scope, achievable in one impl session. |

**Sub-PR decomposition:** none required. Single-PR epic per skill §1.5. Both paranoia checkpoints (plan + wave) collapse onto the same PR.

**Impl unblock:** YES upon plan-mode SIGN-OFF. The remaining round-1 / round-2 findings are inside the plan-doc; once Codex SIGN-OFF on this revision, impl can start immediately.
