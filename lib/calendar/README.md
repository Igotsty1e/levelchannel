# lib/calendar — Google Calendar pull/push + conflict detection

> **Trust boundary:** calendar integrity. `pull-runner.ts` + `pull-worker.ts` are on the **critical-path inventory** (`docs/critical-path.md`). PRs touching them MUST carry `Codex-Paranoia: SIGN-OFF`.

## Purpose

> **SAAS-1 update 2026-05-18:** the admin `/admin/slots` Calendar view presentation layer has shifted to an Apple-Calendar aesthetic — hour-only grid lines, dotted half-hour sub-ticks, today-column accent tint, live current-time indicator, accent-stroke event chips with `color-mix()` tints. The DATA layer (slot lifecycle, hit-test math on 30-min boundaries, drag-paint reducer) is unchanged. New pure helpers in `view-model.ts`: `hourAxisLabels()`, `currentTimeTopPx(nowMs)`, `mskYmdNow(nowMs)`. Component-render coverage for the chip styling is deferred to `SAAS-INFRA-1` backlog (`@testing-library/react` + `jsdom` not yet in `package.json`).

Owns the full Google Calendar surface:
- **OAuth** — `google/oauth.ts` + `google/state.ts` + `google/config.ts` (HMAC-signed CSRF state, scope `calendar.events` + `calendar.calendarlist.readonly`).
- **Encrypted token storage** — `integrations.ts`. Access/refresh tokens + (since AUDIT-SEC-4 2026-05-17) channel verification token are bytea-encrypted under `CALENDAR_ENCRYPTION_KEY` (separate from `AUDIT_ENCRYPTION_KEY` for blast-radius). Rotation via `pgp_sym_decrypt_either`.
- **Pull worker** — `pull-runner.ts` does ONE teacher × ONE calendar tick: fetch busy intervals, compute F8 epoch-aware self-echo, full-rewrite `teacher_external_busy_intervals` in one TX, encrypt summaries. `pull-worker.ts` drains the job queue, dispatches per-job, wires the post-pull conflict detector (BCS-F.1 wire-up gap closed PR #251).
- **Push worker** — `push-worker.ts` mirrors our slot writes/cancels into Google. Best-effort with retry envelope.
- **Channel renewer** — `channel-renewer.ts` `setupChannelForIntegration` + `renewExpiringChannels`. Both fail-closed at the top BEFORE any external Google `channels.watch` call if `CALENDAR_ENCRYPTION_KEY` is unset OR migration 0054 (`channel_token_enc` column) is missing — no orphan Google channels possible.
- **Webhook** — `app/api/calendar/google/webhook/route.ts` (route, not in this folder) reads decrypt-aware via `coalesce(pgp_sym_decrypt_either(channel_token_enc, ...), channel_token)`.
- **Conflict detector** — `conflict-detector.ts` stamps `external_conflict_at` on booked slots when an external Google event overlaps. Wired into `pull-worker` as a best-effort post-pull pass.
- **Reconcile + pathology** — `reconcile-runner.ts` daily sweep heals drift; `pathology.ts` identifies F9‴ resurrected-cancelled-slots that the alert probe pages on.
- **Orphan cleanup** — `orphan-cleanup.ts` removes leftover Google events when a slot's epoch was rotated (e.g. teacher reconnected).

## Files

| File | Role |
|---|---|
| `integrations.ts` | teacher_calendar_integrations CRUD; dual-write encrypted tokens |
| `encryption.ts` | CALENDAR_ENCRYPTION_KEY resolver (separate from AUDIT_ENCRYPTION_KEY); 4 encrypted columns |
| `pull-runner.ts` | F8 epoch-aware self-echo; full-rewrite busy intervals in one TX |
| `pull-worker.ts` | drainer; dispatches per-job; wires conflict detector |
| `push-worker.ts` | mirror our writes to Google |
| `channel-renewer.ts` | `setupChannelForIntegration`, `renewExpiringChannels`; top-of-fn key+schema preflight |
| `conflict-detector.ts` | post-pull F.3 stamp |
| `reconcile-runner.ts` | daily heal sweep |
| `pathology.ts` | F9‴ resurrected-slot predicate |
| `orphan-cleanup.ts` | epoch-rotation orphan cleanup |
| `token-retry.ts` | 401-retry-once wrap for Google API calls |
| `intent-worker.ts` | `slot_lifecycle_intents` drainer |
| `hidden-slots.ts` | reconciliation: hide rows lacking corresponding Google event |
| `view-model.ts` | DTO shape for cabinet + teacher calendar UI |
| `drag-state.ts` + `paint-synth.ts` | UI helpers |
| `dates.ts` | UTC/MSK conversions used across calendar surface |
| `types.ts` | public type surface |
| `google/` | low-level Google API client (channels, events, oauth, config, state) |

## Invariants

1. **All token I/O goes through pgcrypto in SQL.** Plaintext tokens never leave the app/DB TX boundary. `pgp_sym_encrypt($plain, $key)` on writes, `pgp_sym_decrypt_either($enc, $primary, $old)` on reads.
2. **Rotation read-window.** PRIMARY key tries first; OLD key fallback during rotation. `getCalendarEncryptionKeyOld` returns null when no rotation in progress.
3. **Channel-renewer fails-closed BEFORE Google watchChannel call** if key or migration-0054 column is missing. Otherwise we'd hold a live Google channel pointing at our webhook with no local row — webhook silent-drops on no-match.
4. **F8 self-echo guard.** `is_own_event` set when `extendedProperties.private.lc_slot_id` matches a row with the SAME `integration_epoch`. Cross-epoch matches are treated as foreign (post-disconnect re-creation by Google webhook stays foreign).
5. **Decrypt-aware webhook.** Reads `coalesce(pgp_sym_decrypt_either(channel_token_enc), channel_token)`. Phase-A legacy rows match via plaintext; Phase-B nulled rows match via encrypted. `pgp_sym_decrypt_either` returns NULL on wrong key (never throws), so the constant-time compare path is timing-oracle-safe.
6. **Pull writes are full-rewrite per (teacher, calendar) in one TX.** Partial updates would create transient gaps where booking could succeed against stale busy-cache.
7. **BCS-F.1 wire-up gap.** `runConflictDetectionForTeacher` is best-effort post-pull; failure logs + does NOT fail the pull job (the detector is observational, the pull is authoritative for busy-cache).

## Cross-references

- `ARCHITECTURE.md §Booking + calendar sync` — full BCS wave plan summary.
- `docs/plans/booking-calendly-style.md` — main design doc.
- `docs/plans/sec-4-channel-token-encryption.md` — channel_token at-rest encrypt.
- `SECURITY.md §At-rest encryption — Calendar key rotation` — 4-column rotation runbook.
- `docs/critical-path.md §Calendar + scheduling integrity` — the 2 files in this module that are load-bearing.

## Test surface

- `tests/calendar/*.test.ts` — unit (pull/push/conflict/reconcile/encryption/integrations/pathology + view-model + dates).
- `tests/integration/calendar/*.test.ts` — live Postgres (channels, channel-token-encryption, webhook, pull-worker, intent-worker, rotate-encryption).
