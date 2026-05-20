# lib/scheduling — slot booking + cancellation

> **Trust boundary:** booking integrity. `slots/mutations-cancel.ts` + `slots/booking.ts` are on the **critical-path inventory** (`docs/critical-path.md`). PRs touching them MUST carry `Codex-Paranoia: SIGN-OFF`.

## Purpose

Owns:
- **Slot lifecycle** — `open` → `booked` → `cancelled` / `completed` / `no_show_*`. The atomic `UPDATE-with-status='open'` re-assert prevents concurrent double-booking; the atomic `UPDATE-with-status='booked' AND <cancel-window>` prevents TOCTOU cancellation.
- **24h cancel window** — env-tunable via `LEARNER_CANCEL_WINDOW_HOURS` since POLICY-KNOBS 2026-05-17 (`policy.ts`). Default 24h, range [0..720h], strict integer-regex parser.
- **MSK business band** — 06:00–22:00 schema-level CHECK in migration 0031. The pure validator in `validation.ts` mirrors it.
- **Lifecycle marks** — operator stamps `completed` / `no_show_*` post-`start_at`. Cron sweep auto-flips `booked` → `completed` after `start_at + duration_minutes`.
- **Zoom URL on booked slot** (BCS-DEF-3, 2026-05-18) — `setSlotZoomUrl(slotId, zoomUrl, byAccountId, kind)` atomically writes `lesson_slots.zoom_url` on a booked slot. Admin path bypasses ownership; teacher path enforces it via SQL `teacher_account_id = $4` clause. URL validator (`validateZoomUrl` in `validation.ts`) gates: https-only, length ≤ 512, URL() parse. Migration 0056 adds the column + a CHECK constraint as last-line safety. Cabinet renders the "▶ Войти на занятие" link on booked slots; admin + teacher edit via `/api/{admin,teacher}/slots/[id]/zoom-url`.
- **Teacher-learners view** — `teacher-learners.ts` query for the operator's per-teacher dashboard.
- **Admin conflict-feed surface** (BCS-DEF-2, 2026-05-19) — the `/admin/slots/conflicts` 30-day dashboard reads via `lib/admin/conflict-feed.ts:listAdminConflicts` (`status='booked'` + `external_conflict_at <= since`, served by partial index `lesson_slots_external_conflict_admin_idx` from migration 0062). Cross-action audit ledger `slot_admin_actions` (migration 0062) records `dismiss-conflict` + `cancel-from-conflict` operator actions; canonical audit stays in `lesson_slots.events` jsonb (this table is a cross-action index for operator queries). 42P01 in the deploy-before-migrate window is recovered via SAVEPOINT in `app/api/admin/slots/[id]/dismiss-conflict/route.ts` + post-commit log+swallow inside `runCancelFromConflictCleanup` (called by `cancelSlot` when `fromConflict=true`).
- **External-busy integration** — see `lib/calendar/README.md` for the Google-side surface; this module owns the SLOT side of booking only.

## Files

| Folder/File | Role |
|---|---|
| `slots/types.ts` | public type surface (`SlotStatus`, `LearnerCancelDecision`, `canLearnerCancel`) |
| `slots/booking.ts` | `bookSlot` (legacy fast-path + billing-wave full path) |
| `slots/booking-queries.ts` | pre-book read helpers (eligibility, package match) |
| `slots/mutations-cancel.ts` | `cancelSlotForLearner`, `cancelSlotByTeacher`, `cancelSlot` (admin override) |
| `slots/mutations-write.ts` | createSlot / bulk / edit / move / delete (no billing) |
| `slots/lifecycle.ts` | `markSlotLifecycle`, `autoCompletePastBookedSlots` |
| `slots/queries.ts` | read-only DB ops |
| `slots/validation.ts` | pure validators (MSK band, 30-min grid) |
| `slots/internal.ts` | sibling-only DB plumbing |
| `slots/index.ts` | public facade |
| `policy.ts` | `getLearnerCancelWindowHours()` + `getLearnerCancelThresholdMs()` — env-tunable, no module-scope memoization |
| `teacher-learners.ts` | per-teacher learner-list query |

## Invariants

1. **WHERE-clause-as-security-boundary.** The cancel UPDATE atomically checks `status='booked' AND learner_account_id = $2 AND start_at - now() >= make_interval(hours => $5::int)`. Three-way TOCTOU window collapses to one UPDATE. Disambiguation (what failed) happens on the 0-rows branch via a separate SELECT — that read is UX-only, not authoritative.
2. **Concurrent-book races.** `bookSlot` updates with `WHERE status='open'`; the SECOND booker sees 0 rows and gets a 409. No locks taken on `lesson_slots` outside the UPDATE itself.
3. **`policy.ts` is memoization-free.** Per-request env read. Operator's `systemctl restart` picks up new policy on next request handler; no stale capture in long-lived workers.
4. **24h gate applies to LEARNER cancels only.** Operator/admin/teacher paths bypass via `cancelSlot` (no window check). The route handler picks the right function.
5. **MSK band CHECK constraint** is the safety net. App-layer validator can drift; DB CHECK can't.
6. **Slot start UTC-stored, IANA-tz-rendered.** Server never assumes operator TZ.
7. **Status terminal-set CHECK.** Migration 0031 + app-layer `TERMINAL_STATUSES` const both block transitions out of terminal.

## Cross-references

- `ARCHITECTURE.md §Booking + calendar sync (BCS wave)` — wave plan with full picture.
- `docs/plans/slots-split.md` — Wave 39/40 split-into-folder refactor record.
- `docs/plans/phase-5-lifecycle-24h-rule.md` — 24h rule design (amended by POLICY-KNOBS).
- `docs/plans/prepay-postpay-billing.md` — billing integration boundary.
- `docs/plans/policy-knobs.md` — env-tunable cancel window.
- `docs/plans/conflict-feed.md` — BCS-DEF-2 admin `/admin/slots/conflicts` dashboard (paranoia round-3 SIGN-OFF; migration 0062 + slot_admin_actions).
- `docs/critical-path.md §Calendar + scheduling integrity` — the 2 files in this module that are load-bearing.

## Test surface

- `tests/scheduling/*.test.ts` — unit on `canLearnerCancel`, `policy.ts`, validation helpers.
- `tests/integration/scheduling/*.test.ts` — live Postgres for booking + cancel + lifecycle + tunable-window flows.
