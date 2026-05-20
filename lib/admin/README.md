# lib/admin — admin features (operator-side server logic)

> **Trust boundary:** audit-log integrity. `operator-settings.ts` is on the **critical-path inventory** (`docs/critical-path.md`). PRs touching it MUST carry `Codex-Paranoia: SIGN-OFF`.

## Purpose

Server-side primitives backing the `/admin/*` surface — observability readers, operator-tunable settings, account-mutation helpers used by route handlers.

- **Operator settings** (ALERTS-EDITOR 2026-05-18; extended BCS-DEF-1-TG + BCS-DEF-5 2026-05-19) — `operator-settings.ts` is the canonical TS schema + resolver chain (DB → env → default). The probe scripts read the mirror at `scripts/lib/operator-settings.mjs`. Writes are single-TX with the audit row landed inside the same transaction. Audit-log immutability enforced via `block_immutable_operator_settings_events_trg` (UPDATE always blocked; DELETE blocked for rows < 89 days). Scopes: 4 alert probes + `telegram` (BCS-DEF-1-TG channel master switch + retry max) + `teacher-daily-digest` (BCS-DEF-5 master switch + per-tick rate-limit + max attempts).
- **Probe status** (ALERTS-OBS 2026-05-16; extended BCS-DEF-1 Phase 4 + BCS-DEF-1-TG 2026-05-19) — `probe-status.ts` reads `probe_runs` for the `/admin/settings/alerts` page. `PROBE_NAMES` iterates 4 probes — `auth-flow` + `calendar-pathology` + `webhook-flow` + `conflict-unresolved` (4th added by BCS-DEF-1; migration 0058 widened the CHECK). `getLatestTelegramRun(probeName)` (BCS-DEF-1-TG) reads the latest `recipient_kind='telegram'` row via `probe_runs_telegram_latest_idx` (migration 0061). Migration-pending tolerance via `isUndefinedTableError` from `lib/db/errors`.
- **Digest summary** (BCS-DEF-5 2026-05-19) — `digest-summary.ts` reads the daily 08:00 teacher-digest's `probe_runs` ticks (`probe_name='teacher-daily-digest'`, migration 0068) for the per-tick last-run card on `/admin/settings/digest`, and reads `teacher_account_daily_digests` (migration 0067) for the 7-day operator widget. The digest probe is a SIBLING surface — not iterated in `PROBE_NAMES` because the digest is user-facing copy on its own dedicated page, not an operator alert.
- **Conflict feed** (BCS-DEF-2 2026-05-19) — `conflict-feed.ts` backs the `/admin/slots/conflicts` 30-day operator dashboard. Four exports: `listAdminConflicts` + `countAdminConflicts` (`status='booked'` filter + 30-day window, via partial index `lesson_slots_external_conflict_admin_idx` from migration 0062), `isAuditTablePresent()` (migration-pending probe — NO caching per R2-WARN#4), `runCancelFromConflictCleanup` (post-commit cleanup TX with SAVEPOINT-wrapped `slot_admin_actions` INSERT; 42P01 swallowed inside the helper).

## Files

| File | Role |
|---|---|
| `operator-settings.ts` | SETTING_SCHEMA whitelist + resolver chain + single-TX write/delete + listOperatorSettingsForAdmin |
| `probe-status.ts` | `getProbeStatus(probeName)` for `/admin/settings/alerts`; `getLatestTelegramRun` (BCS-DEF-1-TG) |
| `digest-summary.ts` | BCS-DEF-5: `getDigestLastRun` + `getDigestSevenDaySummary` for `/admin/settings/digest` |
| `conflict-feed.ts` | BCS-DEF-2: `listAdminConflicts` + `countAdminConflicts` + `isAuditTablePresent` + `runCancelFromConflictCleanup` for `/admin/slots/conflicts` |

## Invariants

1. **Resolver chain: DB → env → default.** Canonical. Empty/malformed DB row falls through to env; empty/malformed env falls through to hardcoded default. No alternate "env wins" mode.
2. **Strict integer-regex parser.** No `.trim()` — operator must supply clean digits. Decimal kind has its own strict regex with fixed decimal places.
3. **Memoization-free resolver.** Per-call DB + env read. `systemctl restart` picks up env changes on the next request.
4. **Single-TX write+audit atomicity.** Config write + audit insert in ONE transaction on the main pool. The split-pool design (audit-writer role) was infeasible here — see ALERTS-EDITOR wave R2 BLOCKER #2 closure.
5. **Audit-table immutability via DB trigger.** UPDATE blocked unconditionally; DELETE blocked for rows < 89 days. Retention sweep (90-day window in `scripts/db-retention-cleanup.mjs`) trivially passes the predicate.
6. **Schema mirror.** `lib/admin/operator-settings.ts SETTING_SCHEMA` and `scripts/lib/operator-settings.mjs SETTING_SCHEMA` MUST stay structurally identical. The drift test (`tests/admin/operator-settings.test.ts`) pins `JSON.stringify` equality between the two.
7. **Whitelist enforcement at the POST route.** DB layer doesn't enforce. Direct psql writes by an operator with raw access can put any key in, but no app code reads unwhitelisted keys.

## Cross-references

- `ARCHITECTURE.md` — high-level mention.
- `docs/plans/alerts-editor.md` — full epic plan (3 sub-PRs, 3-round paranoia, wave-mode SIGN-OFF round 2).
- `docs/plans/alerts-obs.md` — sibling read-only surface.
- `docs/plans/conflict-unresolved-alert.md` — BCS-DEF-1 (4th probe + per-key `CONFLICT_UNRESOLVED_*` settings).
- `SECURITY.md §ALERTS-EDITOR trust boundary` — operator-tuning suppression-surface caveat + 89-day immutability rationale.
- `docs/critical-path.md §Audit-log integrity` — the 1 file in this module that is load-bearing.

## Test surface

- `tests/admin/operator-settings.test.ts` — drift test (TS schema ↔ MJS schema) + invariant checks. Pins `validScopes` set + per-key conflict-unresolved regression (BCS-DEF-1 Phase 1, 2026-05-19).
- `tests/integration/admin/operator-settings.test.ts` — write/delete lifecycle, optimistic concurrency, immutability trigger.
- `tests/integration/admin/operator-settings-route.test.ts` — POST/DELETE route layer (auth, 400/409 paths).
- `tests/integration/admin/probe-resolver-integration.test.ts` — probe scripts read operator_settings end-to-end.
- `tests/integration/admin/alerts-obs.test.ts` — probe-status reader (test-bootstrap CHECK widened to 4 probes for BCS-DEF-1, 2026-05-19).
- `tests/integration/admin/conflict-unresolved-foundation.test.ts` — BCS-DEF-1 Phase 1 foundation: probe_runs CHECK accepts/rejects, 4 CONFLICT_UNRESOLVED_* knobs default + env override + out-of-bounds fallback.
- `tests/scripts/conflict-unresolved-alert.test.ts` — BCS-DEF-1 Phase 2 probe pure helpers: fingerprint determinism + sensitivity, buildEmail body shape (15 cases).
