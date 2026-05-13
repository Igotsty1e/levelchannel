# Booking Calendly-style + Google Calendar 2-way sync — design v1 (Codex SIGN-OFF after 7 paranoia rounds, 2026-05-13)

> **Status**: APPROVED — implementation ready. Codex paranoia loop ran 7 rounds (10→5→3→2→1→1→0 HIGH findings) before SIGN-OFF. Lock order, idempotency, push/pull contract, cancelled+200 healer all consistent.
>
> **Not yet implemented**: this is a design doc. The implementation queue is decomposed into Waves BCS-A → BCS-G below; tracking entries are added to `ENGINEERING_BACKLOG.md` § Booking Calendly + Calendar Sync.

## 1. Goals

**Task 1** — replace the learner booking UI with a Calendly-style 3-screen flow + fast-path tiles for repeat users. Auth-only; learner sees only their assigned teacher; one event type per teacher; fixed duration; agenda comment captured on screen 3.

**Task 2** — two-way Google Calendar sync for the teacher:
- External Google Calendar (busy events) → hides overlapping `open` slots from learners, surfaces them to the teacher as `conflict`.
- Every `slot.booked` → pushed as a Google event in the teacher's chosen write-calendar.
- Post-book conflicts (external event overlaps a `booked` slot) → non-dismissable red banner on `/teacher` + red outline on the slot + 4 resolution actions.

**Deferred to backlog** (separate waves, NOT in this design):
- Email/Telegram alerts on unresolved conflicts > 2h
- Admin "Conflict feed" dashboard
- Optional Zoom-link on slot (nullable at create + edit on booked)
- Lesson-start reminders for learner + teacher (per-user settings)
- Yandex calendar integration
- syncToken-based incremental pull (post-MVP optimization)
- Onboarding copy + plain-language explainers (task #6 in todo list)

## 2. Product owner overrules (locked)

- Push stays in MVP (overrules Codex r1 "kill push" recommendation).
- Calendly 3-screen IA stays, BUT add fast-path tiles ("Ближайший свободный" + "Как в прошлый раз") on the cabinet entry — addresses repeat-user concern.
- 4-action conflict resolution keeps "Удалить event в Google", gated by `is_writable_in_source` check + explicit confirmation modal.
- MSK-only teachers in MVP (DST/floating-time defense punted). DB CHECK enforces.

## 3. Final schema

### 3.1. `lesson_slots` additions

| column | type | nullable | purpose |
|---|---|---|---|
| `agenda` | text | yes | learner comment captured on Calendly screen 3 |
| `external_event_id` | text | yes | id of the LC-pushed event in teacher's Google |
| `external_calendar_id` | text | yes | which calendar holds it (write_calendar_id at push time) |
| `external_event_etag` | text | yes | for optimistic concurrency on update/delete |
| `external_conflict_at` | timestamptz | yes | when post-book overlap was detected |
| `external_conflict_kind` | text | yes | `pre_book_busy / post_book_overlap / external_event_deleted / external_event_moved` |
| `conflict_source_calendar_id` | text | yes | which external calendar caused the conflict |
| `conflict_source_event_id` | text | yes | which external event caused the conflict |
| `external_sync_failed_at` | timestamptz | yes | push exhausted retries |
| `external_sync_failure_kind` | text | yes | `terminal_4xx / terminal_5xx / calendar_unwritable / token_revoked` |
| `integration_epoch` | text | yes | stamp at successful create push (binds to specific integration session) |
| `last_reconciled_at` | timestamptz | yes | drives reconciliation ordering |

Partial unique `(external_calendar_id, external_event_id) WHERE external_event_id IS NOT NULL`.

### 3.2. `teacher_calendar_integrations`

```
account_id              uuid pk
provider                text check in ('google')
access_token_enc        bytea   -- CALENDAR_ENCRYPTION_KEY (new env, mirrors AUDIT_ENCRYPTION_KEY pattern)
refresh_token_enc       bytea
scope                   text    -- stored literal for defense vs Google narrowing
token_expires_at        timestamptz
read_calendar_ids       text[]  not null default '{}'
write_calendar_id       text             -- NULL until teacher picks one in settings; enforce: write IN read at app layer
sync_state              text check in ('active','degraded','disconnected') not null default 'disconnected'
                                         -- starts disconnected; flips to active after OAuth+calendarList round-trip
epoch                   text    not null default gen_random_uuid()::text   -- rotated on connect/reconnect
last_pulled_at          timestamptz
last_push_at            timestamptz
last_reconnected_at     timestamptz   -- bumped on disconnected→active state-change-to-healthy
last_error              text
channel_id              text          -- Google push-notification subscription
channel_resource_id     text
channel_expires_at      timestamptz
channel_token           text          -- 32-byte random, per-subscription, single-purpose
last_seen_message_number bigint
created_at              timestamptz not null default now()
updated_at              timestamptz not null default now()
```

DB CHECK on related `accounts.timezone = 'Europe/Moscow'` for teacher accounts with an active integration (MSK-only MVP). Index `(sync_state, last_pulled_at) WHERE sync_state IN ('active','degraded')`.

### 3.3. `teacher_external_busy_intervals`

```
id                      uuid pk
teacher_account_id      uuid not null
external_calendar_id    text not null
external_event_id       text not null
start_at                timestamptz not null
end_at                  timestamptz not null
summary_encrypted       bytea           -- encrypted via CALENDAR_ENCRYPTION_KEY, truncated to 64 chars
                                         -- shown only to that teacher in conflict tooltip
                                         -- retention 30d via daily janitor
is_all_day              boolean not null default false
is_writable_in_source   boolean not null default false  -- gates teacher action b)
is_own_event            boolean not null default false  -- LC-stamped (lc_origin/lc_slot_id/lc_epoch all match)
is_orphan_self          boolean not null default false  -- lc_origin matches but lc_epoch is from a previous session
etag                    text
fetched_at              timestamptz not null
```

Unique `(teacher_account_id, external_calendar_id, external_event_id)`. Index `(teacher_account_id, start_at, end_at)`.

### 3.4. `calendar_push_jobs`

```
id                      uuid pk
slot_id                 uuid not null
teacher_account_id      uuid not null
kind                    text check in ('create','update','delete')
payload                 jsonb not null
attempts                int not null default 0
next_run_at             timestamptz not null
status                  text check in ('pending','in_progress','succeeded','terminal_failure','cancelled_by_dependent') not null default 'pending'
last_error              text
last_attempt_at         timestamptz
created_at              timestamptz not null default now()
updated_at              timestamptz not null default now()
```

Partial unique `(slot_id, kind) WHERE status='pending'`. Worker pull index `(status, next_run_at) WHERE status='pending'`.

### 3.5. `calendar_pull_jobs`

```
id                      uuid pk
teacher_account_id      uuid not null
external_calendar_id    text not null
priority                smallint not null default 0  -- 2=user-triggered realtime, 0=cron, -1=GC
status                  text check in ('pending','in_progress','succeeded','terminal_failure') not null default 'pending'
attempts                int not null default 0
next_run_at             timestamptz not null
last_error              text
created_at              timestamptz not null default now()
last_attempt_at         timestamptz
```

Worker pull index ordered by `(priority desc, next_run_at) WHERE status='pending'`.

### 3.6. `slot_lifecycle_intents` (post-cancel durability)

```
id                      uuid pk
slot_id                 uuid not null
kind                    text check in ('post_cancel_push','post_move_push','post_book_push')
status                  text check in ('pending','succeeded','blocked_integration','terminal_failure') not null default 'pending'
attempts                int not null default 0
next_run_at             timestamptz not null
last_run_at             timestamptz
last_error              text
created_at              timestamptz not null default now()
```

Partial unique `(slot_id, kind) WHERE status='pending'`.

## 4. Contracts

### 4.1. Lock order (single source of truth — `lib/calendar/locking.ts`)

```
1. teacher_calendar_integrations  (account_id, FOR SHARE or FOR UPDATE)
2. teacher_external_busy_intervals (set-level FOR UPDATE inside pull rewrites)
3. lesson_slots                    (row-level FOR UPDATE in bookSlot / cancel / move)
4. calendar_push_jobs + slot_lifecycle_intents (FOR UPDATE SKIP LOCKED)
5. calendar_pull_jobs              (FOR UPDATE SKIP LOCKED)
```

A worker holding lock at level N must NEVER take a lock at level <N within the same TX. Splitting into separate TXs is the standard escape (used in cancel split, in push worker sync_state flip).

### 4.2. `bookSlot` (P0 atomic overlap check)

Single TX:

1. `FOR SHARE` on `teacher_calendar_integrations` row (read `sync_state` + `last_pulled_at` + `epoch`).
2. Atomic slot UPDATE re-asserting:
   - `status='open'`
   - `start_at > now()`
   - `teacher_account_id <> $learner`
   - `agenda=$agenda`
   - **Plus** `NOT EXISTS` overlap check vs `teacher_external_busy_intervals` filtered by `is_own_event=false`, gated by `last_pulled_at >= now() - interval '10 minutes' AND sync_state='active'` (busy cache TTL: F3 freshness contract — if pull is stale or integration disconnected, busy intervals are IGNORED).
3. Existing billing-wave path (package consumption + postpaid fallback under `BILLING_WAVE_ACTIVE`).
4. Enqueue `calendar_push_jobs` `kind='create'` in same TX (atomic — F4 fix).

New failure reason on `BookSlotResult`: `external_conflict`. Cabinet UI renders "Слот занят. Обновите страницу."

### 4.3. Calendly UI

**Cabinet entry** (`app/cabinet/`):
- Existing "Мои уроки" section unchanged.
- New "Записаться" card with:
  - **«Ближайший свободный»** — primary CTA → /cabinet/book/[ymd]/[slotId] direct
  - **«Как в прошлый раз»** — appears when learner has a past booking matching a future open slot's weekday+time
  - Link "Открыть календарь" → /cabinet/book

**Calendly screens**:
- `/cabinet/book` — month grid, available days = days with ≥1 `open` slot (pre-book overlap filtered)
- `/cabinet/book/[ymd]` — list of times for picked day
- `/cabinet/book/[ymd]/[slotId]` — confirm + agenda textarea → POST `/api/slots/[id]/book`

APIs:
- `GET /api/slots/booking-days?teacherId=&month=YYYY-MM`
- `GET /api/slots/booking-times?teacherId=&ymd=YYYY-MM-DD`
- existing `POST /api/slots/[id]/book` accepts `{ agenda?: string }`

### 4.4. Pull contract (F1)

- `events.list(timeMin=now-1d, timeMax=now+30d, singleEvents=true, showDeleted=false)` per `read_calendar_ids[i]`. NO `syncToken` (Google forbids combining with time window).
- Per `(teacher, calendar)` pair: full-rewrite of `teacher_external_busy_intervals` in single TX (DELETE + bulk INSERT). Atomic snapshot.
- Triggers: (a) channel notification arrives → enqueue priority-2 pull for that calendar; (b) cron every 5 min for `active|degraded` integrations with future bookings; (c) operator/teacher "Тест синхронизации" button (priority-2).
- Per-event row write: parse extendedProperties — set `is_own_event` / `is_orphan_self` per F8′ epoch-aware rule.
- `is_writable_in_source` derived from `calendarList.accessRole` (`owner|writer` → writable).
- All-day events stored with `is_all_day=true`; overlap check treats `[start_of_day_in_teacher_tz, end_of_day_in_teacher_tz)`.

### 4.5. Push contract (F2 idempotency)

- Deterministic `event.id` = `lc{base32lower(slot_id_bytes)}` — 26-char base32 + 2-char prefix, fits Google's 5-1024 + letter-start constraint.
- `events.insert` body: `extendedProperties.shared = { lc_slot_id: slot.id, lc_origin: 'levelchannel', lc_epoch: integration.epoch }`. ALSO copy to `.private` as defense-in-depth.
- 200 → persist `external_event_id, external_calendar_id, integration_epoch=current_epoch`.
- 409 → `events.get`, verify ownership via shared props, bind.
- 5xx/429 → exp backoff (1m→2m→5m→15m→30m), 5 attempts max → `terminal_failure`.
- 401/403 → token revoked → TX2 separate flips `sync_state='disconnected'`.
- 410/404 on update/delete → terminal success.

### 4.6. Cancel split (F6′ deadlock fix, F6″ durability via intent)

**TX_cancel_1** (slot state + intent):
```
UPDATE lesson_slots SET status='cancelled', cancelled_at, ... WHERE id=$slot AND status='booked';
INSERT INTO slot_lifecycle_intents (slot_id, kind='post_cancel_push', status='pending', next_run_at=now())
  ON CONFLICT (slot_id, kind) WHERE status='pending' DO NOTHING;
COMMIT;
```

**Intent worker** (separate cron, every 30s):
- Per intent, re-read integration `sync_state`.
- If `active|degraded` (per F6‴ refined "actionable" predicate, see §5): dedup pending `create` → enqueue `delete` job (deterministic id via COALESCE) → verify a remediation row exists → status=`succeeded`. Otherwise status=`pending` + backoff (defense vs false-success).
- If `disconnected`: status=`blocked_integration`. Revival sweep every 1h flips back to `pending` when integration becomes actionable.
- Max 10 attempts under healthy integration over 7 days → `terminal_failure` + operator alert.

`delete` push job: `events.delete(write_calendar_id, COALESCE(slot.external_event_id, lcBase32(slot.id)))`. 200/204/404/410 = terminal_success.

### 4.7. Conflict detection + 4-action resolution

Detector (after every pull): for each new busy interval where `is_own_event=false`, find `booked` slots overlapping in time → `UPDATE lesson_slots SET external_conflict_at=now(), external_conflict_kind='post_book_overlap', conflict_source_calendar_id=..., conflict_source_event_id=...`.

Multi-overlap: pick first; surface "+N других" via `GET /api/teacher/slots/:id/conflicts`.

Actions:
- **a) Я разрулю сам** — `external_conflict_at=NULL`. If conflict re-emerges next pull, lights up again.
- **b) Удалить event в Google Calendar** — ENABLED only if `busy.is_writable_in_source=true`. Modal: "Удалить событие «<summary>» из календаря «<calendar name>»? Это действие отразится в Google Calendar." → synchronous `events.delete(conflict_source_calendar_id, conflict_source_event_id)` (NOT through outbox) → enqueue priority-2 pull job → optimistically clear `external_conflict_at` on ALL slots matching this `(cal_id, event_id)`.
- **c) Отменить урок** — existing `/api/teacher/slots/:id/cancel` flow with reason. Cancel split applies.
- **d) Двинуть урок** — picker for new `start_at` → existing `/api/teacher/slots/:id/move` with same atomic overlap check as `bookSlot`.

### 4.8. Reconciliation sweep (F9″ active healer, F9‴ gated)

Daily cron, bounded:

```sql
SELECT s.id, s.external_calendar_id, s.external_event_id, s.integration_epoch, s.status
  FROM lesson_slots s
 WHERE s.external_event_id IS NOT NULL
   AND s.status IN ('booked','cancelled')
   AND s.start_at > now() - interval '7 days'
   AND s.start_at < now() + interval '30 days'
 ORDER BY
   (CASE WHEN status='cancelled' AND external_event_id IS NOT NULL THEN 0 ELSE 1 END),
   start_at ASC,
   last_reconciled_at NULLS FIRST
 LIMIT 100;
```

Per result, `events.get`:

| status | HTTP | epoch | action |
|---|---|---|---|
| booked | 200 | match | bump `last_reconciled_at`. healthy. |
| booked | 200 | mismatch (orphan-self) | LEAVE, bump reconciled_at. Surface via F8′ UI. |
| booked | 404/410 | — | NULL out binding, set `external_sync_failed_at`. |
| **cancelled** | **200** | — | **Re-enqueue delete via gated rules (F9‴ below).** |
| cancelled | 404/410 | — | NULL out binding (drift resolved). |
| any | 5xx/429 | — | skip, retry next sweep. |

**F9‴ gated re-enqueue for cancelled+200**:
- Latest delete job NOT FOUND → enqueue.
- Latest `pending|in_progress` → skip (already remediating).
- Latest `succeeded` → re-enqueue if `now() - last_attempt_at > 6h` (covers external re-creation).
- Latest `terminal_failure` → re-enqueue ONLY if `tci.last_reconnected_at > latest.last_attempt_at` (environment changed).
- Latest `cancelled_by_dependent` → fresh enqueue.

Rate: max 5 sweeps/min project-wide. Backoff on 429.

### 4.9. Google push-notification webhook security

`POST /api/calendar/google/webhook`:
1. Verify `X-Goog-Channel-Token` (constant-time) — match stored `channel_token`.
2. Verify `X-Goog-Channel-ID` and `X-Goog-Resource-ID` — match stored fields.
3. Verify `X-Goog-Message-Number > last_seen_message_number` (monotonic guard).
4. SAME TX: update `last_seen_message_number` + INSERT `calendar_pull_jobs` row (priority=2). No `setImmediate`, no post-commit handoff.
5. Resource-state `sync` → no-op. `exists/update/delete/not_exists` → trigger pull.

Channel renewal: daily cron, renew channels with `expires_at < now() + 24h`. Old channels stopped via `channels.stop`.

### 4.10. Hidden-slot surface

`GET /api/teacher/hidden-slots?from=YYYY-MM-DD` returns open slots overlapping current busy intervals.

Teacher cabinet `/teacher` shows counter card: "<N> слотов скрыты вашим Google Calendar на этой неделе. [Посмотреть]". Drilldown route lists with colliding event summary.

### 4.11. OAuth

- Scopes: `https://www.googleapis.com/auth/calendar.events` + `https://www.googleapis.com/auth/calendar.calendarlist.readonly`. NOT `calendar.readonly`.
- `/api/teacher/calendar/google/start` — generates CSRF state nonce (HMAC bound to teacher session + 10-min TTL), rate-limited 5/min/account.
- `/api/teacher/calendar/google/callback` — validates state, exchanges code for tokens, encrypts via `CALENDAR_ENCRYPTION_KEY`, calls `calendarList.list` to populate `read_calendar_ids` choices, redirects to `/teacher/settings/calendar` for write-calendar pick.
- Token refresh: lazy at API-call time. On 401 retry once with refreshed token; on second 401 flip integration to `disconnected`.

### 4.12. Disconnect / reconnect

- Disconnect: `sync_state='disconnected'`, leave Google events as-is (no cascade-delete — F9 contract). Stop channel via `channels.stop`. Tokens cleared.
- Reconnect: OAuth grants fresh, generate new `epoch` (UUID), set `last_reconnected_at=now()`, populate new channel. Old `external_event_id`s on slots show in `/teacher/settings/calendar` orphan section: "Очистить устаревшие события" → operator bulk action (deletes from old binding's calendar OR marks as ignored).

## 5. Codex minor SIGN-OFF notes (folded in)

1. **F6‴ revival predicate**: should be "integration actionable again", not strictly `sync_state='active'`. Concrete: actionable = `sync_state IN ('active','degraded') AND last_pulled_at >= now() - interval '30 minutes'`. Documented in `lib/calendar/intent-worker.ts`.
2. **Pathology alert**: if same `slot_id` shows `(latest delete succeeded → events.get=200 → re-enqueue)` cycle ≥ 3 times → operator alert "Google event keeps coming back for slot X". Add column `lesson_slots.cancel_repush_count int default 0`, increment in F9‴ re-enqueue path, alert at 3.
3. **PII on foreign event `summary`**: encrypt with `CALENDAR_ENCRYPTION_KEY`, truncate to 64 chars, retention 30d (daily janitor deletes `summary_encrypted` on rows with `fetched_at < now() - 30d`). Document in `SECURITY.md`.

## 6. Wave decomposition — implementation queue

| Wave | PR | Subject | Tests req |
|---|---|---|---|
| **BCS-A: schema** | A1 | migration 0042 `lesson_slots_calendar_columns.sql` | migration only |
| | A2 | migration 0043 `teacher_calendar_integrations.sql` | migration only |
| | A3 | migration 0044 `teacher_external_busy_intervals.sql` | migration only |
| | A4 | migration 0045 `calendar_jobs.sql` (push + pull + intents) | migration only |
| **BCS-B: Calendly UI** | B1 | agenda column + book API accepts agenda + teacher view shows | int |
| | B2 | `GET /api/slots/booking-days` | int |
| | B3 | `GET /api/slots/booking-times` | int |
| | B4 | `/cabinet/book/[ymd]/[slotId]` confirm screen + POST integration | int + qa |
| | B5 | Fast-path tiles + entry in lessons-section.tsx | qa |
| **BCS-C: OAuth scaffolding** | C1 | `CALENDAR_ENCRYPTION_KEY` env + `lib/calendar/encryption.ts` (mirrors AUDIT_ENCRYPTION_KEY) | unit |
| | C2 | `lib/calendar/google/oauth.ts` + state nonce + rate-limit | int |
| | C3 | `/api/teacher/calendar/google/{start,callback,disconnect}` | int |
| | C4 | `/teacher/settings/calendar` UI | qa |
| | C5 | `/cabinet/settings/calendar` (learner read-only) | qa |
| | C6 | Plain-language onboarding copy + tooltips (closes todo #6) | review |
| **BCS-D: pull contract** | D1 | `lib/calendar/google/pull.ts` — bounded full-rewrite | int |
| | D2 | `calendar_pull_jobs` worker + cron | int |
| | D3 | Webhook endpoint (`POST /api/calendar/google/webhook`) + security checks | int |
| | D4 | Channel renewal cron | int |
| | D5 | **bookSlot freshness contract + atomic overlap check (P0 fix)** | int + unit |
| **BCS-E: push contract** | E1 | `calendar_push_jobs` worker (TX1) | int |
| | E2 | Deterministic event id + `extendedProperties.shared.lc_*` + idempotent create | int |
| | E3 | TX2 sync_state flip on auth failure | int |
| | E4 | `slot_lifecycle_intents` + worker + cancel split into 2 TX | int |
| | E5 | Move push (`events.patch`) | int |
| **BCS-F: conflict UX** | F1 | Post-pull conflict detector | int |
| | F2 | Non-dismissable red banner on `/teacher` | qa |
| | F3 | In-calendar conflict highlight (red outline + ⚠ tooltip) | qa |
| | F4 | 4-action conflict resolution (a/b/c/d) + endpoints | int + qa |
| **BCS-G: reconcile + hidden slots** | G1 | Reconcile sweep cron (bounded, F9‴ gated) | int |
| | G2 | Hidden-slots surface (`GET /api/teacher/hidden-slots` + card) | int + qa |
| | G3 | `blocked_integration` revival sweep + pathology alert | int |
| | G4 | Orphan-self cleanup UI (disconnect→reconnect drift) | qa |

PR-границы выбраны так, чтобы каждая PR была ≤ 500 LOC и атомарно green-able (tests + build + smoke). Wave A целиком — schema-only, shipped first без runtime impact. Затем B (UI без интеграции) и C (OAuth без pull/push). D и E ввозят реальную синхронизацию. F и G — UX + ops.

## 7. Backlog (deferred, separate waves)

Tracked entries in `ENGINEERING_BACKLOG.md` § Booking Calendly + Calendar Sync § Deferred:

1. Email + Telegram alerts on unresolved conflicts > 2h (BCS-DEF-1)
2. Admin "Conflict feed" dashboard with last-30d view (BCS-DEF-2)
3. Optional `zoomUrl` field on slot — nullable at create, editable on booked (BCS-DEF-3)
4. Lesson-start reminders for learner — per-user settings (60/30/10 min, email/telegram/push) (BCS-DEF-4)
5. Lesson-start reminders for teacher — mirror setting (BCS-DEF-5)
6. Yandex calendar integration (BCS-DEF-6)
7. `syncToken`-based incremental pull (post-MVP optimization) (BCS-DEF-7)

## 8. Invariants (must survive future changes)

1. **Lock order** is `1→2→3→4→5`. Documented in `lib/calendar/locking.ts`. Violations are P0 deadlock risk.
2. **`bookSlot` always overlap-checks** against fresh busy cache atomically. Stale cache is IGNORED (degraded mode), never blocks bookings.
3. **External `lc_origin/lc_slot_id/lc_epoch` are write-once** by LC at insert. Pull reads them as identity; never mutates.
4. **`cancel` always enqueues a `delete` intent** even if `external_event_id IS NULL` (deterministic id via COALESCE).
5. **Reconciliation is bounded and gated**: no runaway re-enqueue on `terminal_failure` without `last_reconnected_at` advance.
6. **OAuth tokens encrypted at rest** via `CALENDAR_ENCRYPTION_KEY` (separate from `AUDIT_ENCRYPTION_KEY` for blast-radius).
7. **Webhook endpoint is enqueue-only**, never mutates `teacher_external_busy_intervals` directly.
8. **Foreign event `summary` stored encrypted**, 64-char truncated, 30d retention.
9. **MSK-only teachers in MVP** — DB CHECK enforces.

## 9. Paranoia loop history

| Round | Findings | Verdict | Major fixes |
|---|---|---|---|
| R1 | 10 | REWORK | Push-vs-pull tradeoff debate (overruled by owner); external_calendar_id first-class; hidden-slots surface; webhook security primitives |
| R2 | 5 | REWORK | Pull contract (no syncToken+timeWindow); create idempotency; freshness TTL; concrete-event conflict identity; explicit lock-order doc |
| R3 | 3 HIGH | REWORK | Cancel→create race; lock-order violation in push worker; cross-calendar self-echo |
| R4 | 2 HIGH | REWORK | Cancel-path deadlock (split into 2 TX); epoch-aware ownership |
| R5 | 1 HIGH | REWORK | Active healer for cancelled+200; bounded reconcile sweep |
| R6 | 1 HIGH | REWORK | Durable intent (no false-success); gated re-enqueue (no runaway) |
| R7 | 0 | **SIGN-OFF** | Minor: actionable predicate; pathology alert; PII retention |

Total tokens: ~470k. Paranoia loop pattern reuse from billing-wave-design v9 (2026-05-09).
