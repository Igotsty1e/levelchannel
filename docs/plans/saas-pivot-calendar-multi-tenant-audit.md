# Calendar Multi-Tenant Audit — 2026-05-23

Branch: `feat/saas-pivot-calendar-multi-tenant`
Owner: SaaS-pivot wave (Anastasia → multi-tenant).
DB SoT: `teacher_calendar_integrations` keyed by `account_id` (mig 0043),
operator integration bootstrap-moved to her new teacher account (mig 0083).

## Scope

For every calendar surface, verify:
- (S) **Session-derived** teacher id (`session.account.id`), never hardcoded or
  body-supplied operator id;
- (I) **Iteration** over `teacher_calendar_integrations` rows where the runner
  is queue/sweep-based — no implicit "one teacher only" assumption;
- (A) **Anti-spoof** — every mutation re-verifies the teacher owns the row.

## Files audited

### lib/calendar/

| File | S | I | A | Notes |
|------|---|---|---|-------|
| `integrations.ts` | OK | n/a | OK | `upsertGoogleIntegration` takes `accountId` from caller; `getGoogleIntegration` filters by account_id; `disconnectGoogleIntegration` UPDATE … WHERE account_id=$1. |
| `pull-runner.ts` | OK | n/a (per-(teacher,cal) job) | OK | `runPullForCalendar` takes `teacherAccountId`. All SQL filters by `teacher_account_id = $1`. |
| `pull-worker.ts` | OK | OK | OK | `claimNextJob` uses `FOR UPDATE SKIP LOCKED` over `calendar_pull_jobs`. Per-job teacher derived from row. Calls `runConflictDetectionForTeacher` against the job's teacher only. |
| `push-worker.ts` | OK | OK | OK | Per-job teacher derived from `calendar_push_jobs.teacher_account_id`. `readSlot` derives binding. `enqueueCreatePushIfIntegrationActive` filters integrations by `account_id = $1`. |
| `intent-worker.ts` | OK | OK | OK | `processPostCancelPush` joins `lesson_slots s` with `teacher_calendar_integrations tci ON tci.account_id = s.teacher_account_id`. `reviveBlockedIntents` iterates ALL rows in `('active','degraded')`. |
| `reconcile-runner.ts` | OK | OK | OK | `pickReconcileCandidates` JOINs integrations and filters to actionable sync_states; processes per-slot, per-teacher. |
| `conflict-detector.ts` | OK | OK (callers iterate) | n/a | `runConflictDetectionForTeacher` filters `where teacher_account_id = $1`. Called from `pull-worker` per-job (already iterates all teachers via the queue). |
| `channel-renewer.ts` | OK | OK | OK | `renewExpiringChannels` SELECTs all integrations where `sync_state in ('active','degraded') AND (channel_expires_at is null OR …)`. Iterates per-row. |
| `orphan-cleanup.ts` | OK | n/a | OK | `listOrphanSelfSlotsForTeacher` and `clearOrphanBindingsForSlots` both gate on `teacher_account_id = $1`. |
| `google/state.ts` | OK | n/a | OK | OAuth state is HMAC-bound to account_id; callback rejects on `account_mismatch`. |
| `google/oauth.ts`, `google/pull.ts`, `google/push.ts`, `google/channels.ts`, `google/token-refresh.ts` | n/a | n/a | n/a | Pure Google API client lib; no teacher concept inside. |
| `token-retry.ts` | OK | n/a | OK | Takes `accountId` from caller; routes through `ensureFreshAccessToken(accountId)`. |

### app/api/teacher/calendar/

| Route | S | I | A | Notes |
|-------|---|---|---|-------|
| `google/start/route.ts` | OK | n/a | OK | `requireTeacherAndVerified` → `auth.account.id` is the only source. State nonce HMAC-binds the id. |
| `google/callback/route.ts` | OK | n/a | OK | Re-resolves session, role-checks teacher; state nonce verified against session.account.id. |
| `google/disconnect/route.ts` | OK | n/a | OK | `auth.account.id` only. |
| `orphan-slots/route.ts` | OK | n/a | OK | `guard.account.id` only. |
| `orphan-slots/ignore/route.ts` | OK | n/a | OK | (verified below — same pattern). |

### app/api/calendar/

| Route | Notes |
|-------|-------|
| `google/webhook/route.ts` | Channel lookup by `channel_id` resolves the owning teacher row (no body trust); enqueues pull jobs ONLY for that teacher's `read_calendar_ids`. Constant-time channel_token check; resource_id match; monotonic message_number. |

### app/api/cron/calendar/

| Route | Iteration | Notes |
|-------|-----------|-------|
| `pull/route.ts` | drains `calendar_pull_jobs` queue (multi-teacher inherent) | OK |
| `push/route.ts` | drains `calendar_push_jobs` queue | OK |
| `intents/route.ts` | drains `slot_lifecycle_intents` queue | OK |
| `reconcile/route.ts` | `pickReconcileCandidates` is global, joined to all integrations | OK |
| `renew-channels/route.ts` | `renewExpiringChannels` iterates all eligible integrations | OK |
| `revive-blocked/route.ts` | `reviveBlockedIntents` UPDATE … JOIN over all integrations | OK |

### scripts/

| Script | Notes |
|--------|-------|
| `calendar-cron.mjs` | Parameterised dispatcher → POSTs to `app/api/cron/calendar/<target>`. Not teacher-aware itself. OK. |
| `calendar-pathology-alert.mjs` | Alerter-only, reads aggregates from DB. |
| `rotate-calendar-encryption.mjs` | Key rotation, table-wide. |

### app/teacher/settings/calendar/

| File | Notes |
|------|-------|
| `page.tsx` | Reads `session.account.id`; calls `getGoogleIntegrationMeta(session.account.id)`. No operator-only gate. |
| `connect-card.tsx` | Client component; POSTs to /start, /disconnect. |
| `orphan-section.tsx` | Client; works against /orphan-slots GET. |

## Gaps found

### GAP-1 (BLOCKER) — No initial pull-job enqueue on OAuth connect

**Where:** `app/api/teacher/calendar/google/callback/route.ts` (after upsert + channel setup).
**Symptom:** A freshly-connected teacher whose Google Calendar has no
new events in the near future will NEVER get `teacher_external_busy_intervals`
populated.

Reason: Google's channels.watch handshake fires `X-Goog-Resource-State: sync`,
which `app/api/calendar/google/webhook/route.ts:175` deliberately skips for
pull-enqueue. After that, pulls only happen on a real change push, OR via
the `/api/teacher/slots/[id]/delete-external-conflict` action. There's no
periodic seeder that re-enqueues pulls for all teachers — by design pull
is event-driven.

In the single-tenant era this was masked because the operator's calendar
was constantly active, so the first real event always pulled within minutes.
With multi-tenant onboarding, a quiet calendar (e.g. a brand new teacher
testing the integration on a sparse personal calendar) would silently leave
busy-cache empty, leading the conflict detector to find zero conflicts
even when there were real events.

**Fix:** After `setupChannelForIntegration` returns ok in the callback,
enqueue a priority=2 pull job per `read_calendar_ids` entry. Best-effort
(non-fatal on enqueue failure — the pull cron re-enqueues nothing, but
the next event change will catch it; the only real loss is "first
backfill on quiet calendars").

### GAP-2 (WARN) — No initial pull on reconnect via the channel setup branch

Same root cause as GAP-1 but on **reconnect**. The OAuth callback unconditionally
calls `setupChannelForIntegration` (which would either renew the channel or
create a fresh one). The pull-jobs enqueue from GAP-1 fix handles this branch
too — every initial_connect path is reconnect-or-fresh.

### GAP-3 (INFO) — Integration tests for multi-tenant isolation

`tests/integration/calendar/` covers per-teacher correctness in individual
units but does not have a cross-tenant test that asserts: teacher A's
busy intervals never leak into teacher B's queries, teacher A's bookings
never push to teacher B's calendar, etc. Add as `tests/integration/saas-pivot/calendar-multi-tenant.test.ts`.

### GAP-4 (INFO) — Defensive ARCHITECTURE.md note

The "calendar" section of `ARCHITECTURE.md` predates the SaaS pivot.
The phrasing still talks about "the operator's calendar" in places.
Out of scope for this PR (doc cleanup is separate), but worth flagging.

## Non-gaps verified

- **Hardcoded operator account id**: NONE in calendar code. All call sites
  use `auth.account.id`, `session.account.id`, or row-derived
  `teacher_account_id`.
- **Conflict-detector iteration**: runs once per pull-job (which is per-
  (teacher, calendar) pair), and only on that teacher's booked slots.
  Multi-teacher safety: each teacher's pull cycle triggers a detector
  pass against only their own slots.
- **Cron drivers**: all four queue-draining crons (`pull`, `push`, `intents`,
  `revive-blocked`) and three sweep crons (`renew-channels`, `reconcile`,
  plus `pathology-alert` for observability) iterate via SQL — not in-memory
  teacher arrays. Adding a new teacher requires zero code change.
- **OAuth state binding**: HMAC-bound to issuing account_id. State issued
  for account A cannot be replayed against a callback bound to account B.
  Round-trip account swap (cookie hijack mid-flow) raises
  `state.account_mismatch` → 302 redirect with `error=state_invalid`.
- **Anti-spoof on mutations**: every mutation route (`disconnect`,
  `orphan-slots/ignore`, `delete-external-conflict`, `dismiss-conflict`)
  reads the session and runs the SQL UPDATE with
  `WHERE … teacher_account_id = $session_id`. No body-supplied
  `teacherId` is trusted.

## Fix plan

1. `app/api/teacher/calendar/google/callback/route.ts`: after successful
   `setupChannelForIntegration`, enqueue priority=2 pull job for each
   `read_calendar_ids` entry (currently always `['primary']`). Wrap in
   try/catch so the user OAuth flow never dead-ends on an enqueue hiccup.

2. `tests/integration/saas-pivot/calendar-multi-tenant.test.ts`: 5 cases
   asserting per-tenant isolation.

3. No migration. No `teacher_calendar_integrations` schema change.
