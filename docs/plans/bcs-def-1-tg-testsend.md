# BCS-DEF-1-TG-TESTSEND — extend operator test-send to the Telegram channel

**Status:** DRAFT 2026-05-20 — awaiting wave-paranoia on the impl diff.
**Wave name:** `bcs-def-1-tg-testsend` (standalone one-PR epic — plan + wave both on this PR; impl already drafted on branch `feat/bcs-def-1-tg-testsend`).
**Trigger:** `POST /api/admin/settings/alerts/[probe]/test-send` historically wires only the Resend (email) channel — Telegram channel has no "Тестовое уведомление" smoke path despite shipping in PR #386 (BCS-DEF-1-TG). Backlog item `§10.7 BCS-DEF-1-TG-TESTSEND` from the parent plan tracks this gap. Operator activated Telegram on 2026-05-20 and immediately hit the gap during smoke.
**Author:** Claude (autonomous).
**Production target:** see private operator runbook.

---

## 1. Issue & fix

### 1.1 Current state

`app/api/admin/settings/alerts/[probe]/test-send/route.ts:240-296` (pre-change line ranges) sends ONE email via Resend and writes ONE `probe_runs` row keyed on the implicit `recipient_kind='email'` default. The Telegram channel is unreachable from this surface — operator must induce a synthetic alert (e.g. `CALENDAR_PATHOLOGY_HOURLY_THRESHOLD=0`) to verify the Telegram wire.

### 1.2 Fix

Inside the existing `withIdempotency` executor, AFTER the email branch:

1. Read `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID` from env.
2. Read `TELEGRAM_ALERTS_MASTER_SWITCH` + `TELEGRAM_ALERTS_RETRY_MAX` via `resolveChannelSettings('telegram')` (`lib/admin/operator-settings.ts:463`).
3. **Gate order** mirrors the live probes: master switch off → `tgError='telegram_master_switch_off'`; missing token → `'telegram_missing_token'`; missing chat-id → `'telegram_missing_chat_id'`. Each writes a `probe_runs` row with `recipient_kind='telegram'` and `verdict_kind='test_send_failed'` so the operator's "Telegram канал" card surfaces the gap.
4. If all gates open → `sendTelegramMessage({botToken, chatId, text, retryMax})` from `scripts/lib/telegram-alerts.mjs:277` with the SAME body that goes to email (line 226-236 in the route — `[LevelChannel] TEST — <probe> dry-run`).
5. On result.ok → write `recipient_kind='telegram'` + `alert_email_id=messageId` row.
6. On result.error → redact through `redactTelegramSecret(err, token)` BEFORE persisting to `probe_runs.error_message` AND BEFORE writing to JSON response. Mirrors plan §4.1 redaction contract (BCS-DEF-1-TG round-1 BLOCKER#4 closure).

Response shape extension:
- New fields: `telegramAttempted: boolean`, `telegramMessageId: string | null`, `telegramError: string | null`, `emailError: string | null`.
- Status: 200 if either channel landed; 502 if email failed AND TG either failed or wasn't attempted.

### 1.3 UI surface

`app/admin/(gated)/settings/alerts/test-send-button.tsx:63` (pre-change) showed only `email id: ...`. Updated to render both channel outcomes in one line: `email id: ... · telegram id: ...` OR `telegram: пропущен (telegram_master_switch_off)` OR `telegram: ошибка (...)`. Per-channel state visible without digging into `probe_runs`.

---

## 2. Files changed

| File | Change |
|---|---|
| `app/api/admin/settings/alerts/[probe]/test-send/route.ts` | Import Telegram helpers + `resolveChannelSettings`. Add TG branch after email INSERT. Extend response with channel-state fields. Add `recipient_kind` column to both INSERTs (the early 422 env-missing path AND the work-executor email path). |
| `app/admin/(gated)/settings/alerts/test-send-button.tsx` | Surface both channel outcomes in `result` text. |
| `tests/integration/admin/alerts-obs.test.ts` | Add 3 new TG-channel cases (master switch off; master switch on + no token; master switch on + bogus token → redacted error). Fix the cache-poison fingerprint-uniqueness assertion (now 2 rows per attempt share a fingerprint by design). |

**Files intentionally NOT changed:**
- `scripts/lib/telegram-alerts.mjs` — pure helper, reused as-is (zero deps, no globals). The TS route imports the .mjs directly; tsconfig `allowJs: true` + `moduleResolution: bundler` resolves JSDoc-typed exports without a TS twin.
- Migration 0061 already has the `recipient_kind` discriminator (`probe_runs.recipient_kind text not null default 'email' check (recipient_kind in ('email', 'telegram'))`). No new migration needed.

---

## 3. Tests

`tests/integration/admin/alerts-obs.test.ts` — describe block "Telegram channel branch" with 3 cases:

1. **master switch off** → email row + TG row (both written), TG row has `error_message='telegram_master_switch_off'`, response has `telegramAttempted=false`.
2. **master switch on + no `TELEGRAM_BOT_TOKEN`** → TG row with `error_message='telegram_missing_token'`, response same shape.
3. **master switch on + bogus syntactically-valid token** → real Telegram API returns 401 → TG row written, response has `telegramAttempted=true` + non-null `telegramError`. **CRITICAL ASSERTION:** raw token MUST NOT appear in `telegramError` (response) NOR in `probe_runs.error_message` (DB). This pins the redaction contract end-to-end.

Pre-existing cache-poison test (`AUDIT-CODE-2: 422 missing-env path does NOT poison idempotency cache`) updated: fingerprint uniqueness invariant relaxed from `fingerprints.size === rows.length` to `fingerprints.size >= 2` because a successful attempt now writes 2 rows (email + TG) sharing the same fingerprint — same pattern as the live probes (e.g. `scripts/auth-flow-alert.mjs:390-418`).

---

## 4. Acceptance criteria

- `npx vitest run tests/integration/admin/alerts-obs.test.ts` → 21/21 ✓.
- `npx tsc --noEmit` clean (pricing-section/test-send/test-send-button).
- `npm run build` clean.
- Manual smoke after deploy: operator clicks «Тестовое уведомление» → Telegram message lands, response shows both `email id` and `telegram id`.

---

## 5. Risk

- **LOW.** Additive code path inside existing route. Email branch behavior preserved bit-for-bit. TG branch only runs when env+DB gates are open. Failure modes (missing token, bogus token, Telegram 5xx) write a fail-state row but do NOT 500 the whole route.
- Redaction is the only sensitive contract; pinned by test case 3.
- One pre-existing test had to be amended for the fingerprint shape change (legitimate, not a test-weakening).

---

## 6. Codex-paranoia trailer

Standalone one-PR epic — plan + wave on the same PR. Trailer:

```
Codex-Paranoia: SIGN-OFF round N/3 (BCS-DEF-1-TG-TESTSEND; plan + wave both on this PR)
Skill-Used: /codex-paranoia plan + /codex-paranoia wave
```

Wave-paranoia runs against the full diff before commit; closures appended to §0a here.
