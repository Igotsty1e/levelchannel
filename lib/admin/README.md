# lib/admin — admin features (operator-side server logic)

> **Trust boundary:** audit-log integrity. `operator-settings.ts` is on the **critical-path inventory** (`docs/critical-path.md`). PRs touching it MUST carry `Codex-Paranoia: SIGN-OFF`.

## Purpose

Server-side primitives backing the `/admin/*` surface — observability readers, operator-tunable settings, account-mutation helpers used by route handlers.

- **Operator settings** (ALERTS-EDITOR 2026-05-18) — `operator-settings.ts` is the canonical TS schema + resolver chain (DB → env → default). The probe scripts read the mirror at `scripts/lib/operator-settings.mjs`. Writes are single-TX with the audit row landed inside the same transaction. Audit-log immutability enforced via `block_immutable_operator_settings_events_trg` (UPDATE always blocked; DELETE blocked for rows < 89 days).
- **Probe status** (ALERTS-OBS 2026-05-16) — `probe-status.ts` reads `probe_runs` for the `/admin/settings/alerts` page. Migration-pending tolerance via `isUndefinedTableError` from `lib/db/errors`.

## Files

| File | Role |
|---|---|
| `operator-settings.ts` | SETTING_SCHEMA whitelist + resolver chain + single-TX write/delete + listOperatorSettingsForAdmin |
| `probe-status.ts` | `getProbeStatus(probeName)` for `/admin/settings/alerts` |

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
- `SECURITY.md §ALERTS-EDITOR trust boundary` — operator-tuning suppression-surface caveat + 89-day immutability rationale.
- `docs/critical-path.md §Audit-log integrity` — the 1 file in this module that is load-bearing.

## Test surface

- `tests/admin/operator-settings.test.ts` — drift test (TS schema ↔ MJS schema) + invariant checks.
- `tests/integration/admin/operator-settings.test.ts` — write/delete lifecycle, optimistic concurrency, immutability trigger.
- `tests/integration/admin/operator-settings-route.test.ts` — POST/DELETE route layer (auth, 400/409 paths).
- `tests/integration/admin/probe-resolver-integration.test.ts` — probe scripts read operator_settings end-to-end.
- `tests/integration/admin/alerts-obs.test.ts` — probe-status reader.
