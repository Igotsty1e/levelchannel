# CONFLICT-FEED — `/admin/slots/conflicts` operator dashboard

**Status:** PARKED v1 (2026-05-17, post-paranoia round 1).

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

**Three inline resolution actions (per row):**

1. **Dismiss** — clear `external_conflict_at = null`. Optimistic: if the conflict re-emerges on next pull, the row gets re-stamped. Mirrors `POST /api/teacher/slots/[id]/dismiss-conflict` semantics.
2. **Cancel** — call the existing `POST /api/admin/slots/[id]/cancel` (reuses shared `cancelSlot()` lib function with `operatorRole='admin'`). Operator types a cancellation reason.
3. **Move** — call the existing `PATCH /api/admin/slots/[id]/move` (only for **open** slots — booked slots can't be moved; surface that constraint in the UI).

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

`lib/admin/conflict-feed.ts:listAdminConflicts(opts: { since: Date })` runs:

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
   and s.external_conflict_at > $1
   and s.status in ('open', 'booked')
 order by s.external_conflict_at desc
 limit 200
```

Uses `lesson_slots_external_conflict_idx` (migration 0042). 30-day window cap is the default; operator can pass `?since=...` for narrower windows.

### 3.2 Action audit table

`migrations/0054_slot_admin_actions.sql` (NEW):

```sql
create table if not exists slot_admin_actions (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references lesson_slots(id) on delete cascade,
  operator_account_id uuid not null references accounts(id) on delete restrict,
  action text not null check (action in (
    'dismiss-conflict',
    'cancel-from-conflict',
    'move-from-conflict'
  )),
  reason text null,
  payload jsonb null,                        -- pre-action conflict snapshot
  performed_at timestamptz not null default now()
);

create index if not exists slot_admin_actions_slot_idx
  on slot_admin_actions (slot_id, performed_at desc);
create index if not exists slot_admin_actions_operator_idx
  on slot_admin_actions (operator_account_id, performed_at desc);
```

On delete: `slot_id` CASCADE (audit follows the slot — slots are append-only-on-delete in practice today), `operator_account_id` RESTRICT (matches sibling pattern from PKG-RECON, PKG-ADMIN-GRANT).

### 3.3 NEW admin endpoint: dismiss-conflict

`POST /api/admin/slots/[id]/dismiss-conflict/route.ts`:

- Auth: `requireAdminRole` + `enforceTrustedBrowserOrigin` + rate limit (30/min/IP, matching teacher-side).
- Body: `{ reason: string }` (required, ≥3 chars).
- **withIdempotency** scope `admin:slots:dismiss-conflict:${slotId}:${operatorAccountId}` so double-click doesn't write two audit rows.
- Reads pre-state of the 4 conflict columns → stores in `slot_admin_actions.payload` (so audit retains the snapshot even after the columns are cleared).
- Updates `lesson_slots` setting all 4 conflict columns to NULL.
- Inserts one `slot_admin_actions` row with `action='dismiss-conflict'`.
- Returns `{ ok: true, slotId, clearedAt }`.

### 3.4 EXTEND existing admin endpoints for audit

`POST /api/admin/slots/[id]/cancel/route.ts` already exists and is audited via `cancelSlot()` shared lib. CONFLICT-FEED extension: when the request body carries `{ fromConflict: true }`, ALSO insert a `slot_admin_actions` row with `action='cancel-from-conflict'`. Same for move with `action='move-from-conflict'`. This is additive — no behavior change for callers that don't pass `fromConflict`.

### 3.5 NEW admin page

`app/admin/(gated)/slots/conflicts/page.tsx`:
- Server component. Lists conflicts via `listAdminConflicts` (default 30-day window).
- Per row: teacher email, learner email (if booked), tariff name, scheduled start (local time + UTC), conflict-kind, conflict-source calendar/event ids, three inline action buttons.
- Move button is DISABLED when `slot.status='booked'` with a hover tooltip explaining the constraint (matches teacher-side semantic).
- Each action button writes a fresh UUID Idempotency-Key per click (mirrors PKG-RECON actions-cell + ALERTS-OBS test-send pattern).
- Empty state: «Конфликтов за последние 30 дней нет.»

### 3.6 Nav addition

`app/admin/(gated)/slots/page.tsx` gets a "Конфликты (N)" badge link near its header. Badge count = `select count(*) from lesson_slots where external_conflict_at is not null and external_conflict_at > now() - interval '30 days'`. Cached on the page render (server-side; page is `dynamic='force-dynamic'`). This avoids cluttering the global sidebar with another tab.

## 4. Implementation

### 4.1 Migration `0054_slot_admin_actions.sql`

Schema in §3.2.

### 4.2 Lib helpers

- **`lib/admin/conflict-feed.ts:listAdminConflicts(opts)`** — the read.
- **`lib/admin/conflict-feed.ts:countAdminConflicts(opts)`** — the count for the badge.
- **`lib/admin/conflict-feed.ts:recordSlotAdminAction(client, params)`** — insert helper used by all 3 admin action paths. Best-effort isn't right here — the audit row is load-bearing. Throws on failure; the action TX rolls back.

### 4.3 Page

`app/admin/(gated)/slots/conflicts/page.tsx` — server component as described.

### 4.4 Endpoints

- `POST /api/admin/slots/[id]/dismiss-conflict/route.ts` (NEW).
- `POST /api/admin/slots/[id]/cancel/route.ts` (EXTEND: accept `fromConflict` body flag → audit row).
- `PATCH /api/admin/slots/[id]/move/route.ts` (EXTEND: accept `fromConflict` body flag → audit row).

### 4.5 Tests

`tests/integration/admin/conflict-feed.test.ts` (NEW):
- listAdminConflicts: seed 3 slots (one with stamp, two without), assert only the stamped one returns.
- listAdminConflicts: 30-day window cutoff (stamp_at > 30 days ago → excluded).
- dismiss-conflict happy path: assert columns cleared + slot_admin_actions row inserted with action='dismiss-conflict' + reason + payload snapshot.
- dismiss-conflict auth: anon → 401; learner → 403.
- dismiss-conflict idempotency: same key replay → one row, one update.
- dismiss-conflict on already-cleared slot → 404 (slot has no conflict to dismiss).
- cancel + move from-conflict flag → slot_admin_actions row written with right action.
- Schema CHECK on `action` rejects unknown values.

## 5. Rollout

1. Migration 0054 lands first (additive — no consumer until page + endpoints land in same PR).
2. Page + endpoints + lib in same PR.
3. After merge: `npm run migrate:up` on prod.
4. Validation: ssh into prod, seed a fake conflict (`update lesson_slots set external_conflict_at = now() where id = '...'`), curl admin page, verify badge + row appears.
5. Graceful degradation: admin page handles `42P01` on `slot_admin_actions` table missing → renders banner "миграция 0054 не применена" (same pattern as ALERTS-OBS).

## 6. Risks + mitigations

- **R1 — admin dismiss-conflict races with teacher dismiss.** Both clear the same 4 columns. UPDATE is idempotent; the operator just sees an empty result on the second clear. No data corruption.
- **R2 — concurrent admin dismiss + a fresh pull stamps a NEW conflict.** Pull is the source of truth; if it stamps after our dismiss, the conflict re-emerges on the page next render. Correct behavior.
- **R3 — audit row write fails after the UPDATE commits.** Wrap UPDATE + audit INSERT in one TX; the audit is load-bearing for operator compliance, so the action MUST fail if audit fails. Different shape from probe-runs (best-effort) — this is operator-driven, not probe-driven.
- **R4 — operator dismisses a real persistent conflict, masks the problem.** This is operator's call to make. Audit row records the reason; teacher banner re-stamps on next pull anyway.
- **R5 — page render with 200 rows is slow.** 200 cap + the hot-path partial index keeps the read under 50ms even at large slot tables. Pagination is deferred (operator can re-query with `?since=...`).

## 7. Open questions for paranoia

1. The 30-day window — too short for "did this teacher have recurring conflicts last quarter"? Tradeoff: longer windows make the admin page slower. Default 30 d, configurable via `?since=`.
2. Should `slot_admin_actions` carry an explicit reason for cancel + move actions (separate from the cancel reason already captured in the slot row)? Decision: NO — cancel + move have their own reasons in their existing audit; `slot_admin_actions` reason is dismiss-only.
3. `withIdempotency` scope includes `slotId + operatorAccountId` — does this leak across operators? Two operators racing to dismiss the same conflict each get their own idempotency cache row, each writes an audit row, the second sees an empty UPDATE. Acceptable.
4. The "+N other conflicts" picker (teacher-side, via `listConflictsForSlot`) — should admin see this? Decision: NO for MVP. The single deterministic conflict from the columns is enough for "this slot needs attention". Operator drills into teacher UI if they want details.
5. Conflict KINDS — should the admin page differentiate `post_book_overlap` (only one emitted today) from the reserved future kinds? Decision: render the value as-is; no taxonomy needed at UI layer yet.
6. Should this wave also add the BCS-DEF-1 ">2h unresolved → email/Telegram" alert? Decision: NO — separate wave, ties into ALERTS-EDITOR.
