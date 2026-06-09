# In-cabinet password change (settings/security)

**Status**: SHIPPED 2026-06-09 (PR #572 `0b5904c`)
**Owner**: @ivankhanaev
**Author**: Claude (sonnet/opus)
**Codex-Paranoia**: SELF-REVIEW round 2/2 (Codex quota exhausted until 2026-06-11)

---

## 1. Что есть, чего нет

**Existing (already shipped):**
- `POST /api/auth/reset-request` — public, sends reset-link e-mail (anti-enumeration `{ok:true}`).
- `POST /api/auth/reset-confirm` — public, applies new password via token + revokes all sessions.
- `/forgot` + `/reset` pages — public forms.
- `validatePasswordPolicy` in `lib/auth/policy.ts`.
- `hashPassword` + `constantTimeVerifyPassword` in `lib/auth/password.ts` (bcrypt cost 12, silent rehash machinery).
- `revokeAllSessionsForAccount(accountId)` in `lib/auth/sessions.ts`.
- `recordAuthAuditEvent` infrastructure (mig 0028).

**Missing:**
- In-cabinet password change for an already-logged-in teacher who knows their current password — no UI, no API.
- `/teacher/security` page (mentioned as «скоро» on `/teacher/profile:68`).
- Operator-facing audit event types: `password.changed.in_cabinet`, `password.changed.in_cabinet.bad_current`.

**Out of scope (this PR):**
- E-mail change (requires verify-email round-trip, separate epic).
- 2FA / TOTP / passkey enrollment.
- Force-logout-everywhere button (the change endpoint already revokes sessions; explicit button is overkill for MVP).
- Password reset via SMS / Telegram (no infra).

## 2. Контракт

### 2.1. `POST /api/account/password/change`

Requires: authenticated teacher OR learner OR admin session.

Body:
```ts
{
  currentPassword: string  // verified via constantTimeVerifyPassword
  newPassword: string      // ≥10 chars per validatePasswordPolicy
}
```

Response:
- **200**: `{ ok: true }`. Side-effects: hash + setAccountPassword, revoke ALL sessions for this account (including the actor's current one), set new session cookie (so the actor stays logged in on this device).
- **400**: `{ error: 'password/new/too_weak' }` if policy fails.
- **400**: `{ error: 'password/new/same_as_current' }` if `verifyPassword(newPassword, account.passwordHash)` is true.
- **401**: `{ error: 'password/current/invalid' }` if current password verify fails. Audit row writes `password.changed.in_cabinet.bad_current` with truncated IP + UA.
- **429**: rate-limit. 5/min/IP + 3/min/account (anti-brute on currentPassword).
- **403**: origin gate / not authenticated.

Anti-enumeration not relevant (caller already authenticated).

### 2.2. UI: `/teacher/security` (new page)

Surface inside the teacher cabinet shell. Single card:

```
Изменить пароль
───────────────
[Текущий пароль]
[Новый пароль]       (validation hint: «минимум 10 символов»)
[Подтвердите новый]  (must equal newPassword field)

[Сохранить]

После изменения вас перелогинят на других устройствах.
```

On success: toast «Пароль обновлён», stay on page, clear fields.

On failure:
- `password/current/invalid` → inline error «Текущий пароль не совпадает.»
- `password/new/too_weak` → inline error из policy.
- `password/new/same_as_current` → «Новый пароль совпадает со старым.»
- 429 → «Слишком много попыток, подождите минуту.»
- Generic 5xx → «Не получилось обновить, попробуйте ещё раз.»

### 2.3. UX nav

- Add `<AdminNavLink>` ↔ teacher nav: «Безопасность» in `app/teacher/settings/page.tsx` settings hub (between «Профиль» and «Удаление аккаунта»).
- On `/teacher/profile:68` change «(скоро)» → link to `/teacher/security`.

## 3. Schema / migration

**None.** Reuses `accounts.password_hash`, `auth_audit_events`. Two new event-type strings recorded as plain text (already-existing column):
- `password.changed.in_cabinet`
- `password.changed.in_cabinet.bad_current`

(grep for similar; the audit-event type column is already a free-form string per mig 0028.)

## 4. Files touched

```
app/api/account/password/change/route.ts        NEW (POST handler)
app/teacher/security/page.tsx                   NEW (SSR shell)
app/teacher/security/password-card.tsx          NEW (client form)
app/teacher/profile/page.tsx                    EDIT (remove "(скоро)" + add link)
app/teacher/settings/page.tsx                   EDIT (add «Безопасность» nav row)
lib/analytics/registry.ts                       EDIT (3 new events)
```

Analytics events to add (PII-safe — no email, no password hashes):
- `password_change_form_opened: {}`
- `password_change_submitted: {}`
- `password_change_failed: { reason: 'current_invalid' | 'new_weak' | 'same_as_current' | 'rate_limited' | 'unknown' }`
- `password_change_succeeded: {}`

## 5. Security invariants

1. **Current password verification BEFORE accepting new.** Otherwise an attacker who hijacks a session can lock out the real user.
2. **`revokeAllSessionsForAccount` BEFORE issuing new session cookie.** Mirrors `reset-confirm` pattern (mech-5 finding).
3. **Rate-limit on currentPassword verify path.** 5/min/account so an attacker with a stolen session can't online-brute the current password to «prove ownership» without the user noticing. Plus 5/min/IP.
4. **Constant-time response.** Whether currentPassword matches or not, response timing should not leak. Reuse `constantTimeVerifyPassword(password, hash)`.
5. **Audit on every attempt** (success AND fail), including IP-prefix (truncated /24) and UA, into `auth_audit_events` with the two new event types.
6. **No password in any log line, no `console.log(req.body)`** — already enforced by codebase convention but worth re-checking.
7. **Origin gate** (CSRF) — `enforceTrustedBrowserOrigin` required.
8. **No exposure of `passwordHash` in any response shape**, including 4xx error messages.

## 6. Open questions for owner (max 5)

1. **Force email notification on password change?** Send "ваш пароль был изменён DD.MM.YYYY с IP X.X.X.X" to the account email after success?
   - Pro: detect compromise. Con: noise. *My default:* **YES**, async-fire-and-forget after the response.
2. **Session-cookie rotation on success:** I want to keep the actor logged in on THIS device. Other devices get force-logout. Confirm UX is OK?
   - *My default:* **YES** (matches `reset-confirm` behaviour).
3. **Require relogin (clear current session too)?** Some banks force this. Friction vs security.
   - *My default:* **NO** (keep current device session — same as gh / Stripe / GitLab).
4. **Password policy:** current is «≥10 chars». Want stricter (mixed case + digit + symbol)?
   - *My default:* **NO**, keep current. Security audit M1 already flagged bcrypt + 72-byte truncation as the real bottleneck.
5. **Add «Show password» eye toggle on the 3 fields?** Standard UX.
   - *My default:* **YES**.

## 7. Self-review (round 1) — gaps and risks

### 7.1. Closed in this pass
- Full file list pinned (§4).
- Schema-free design — no migration risk.
- 8 invariants explicit (§5).
- Anti-brute on currentPassword path covered.
- Audit events split SUCCESS vs FAIL.

### 7.2. Open risks I might have missed
1. **Audit-event-type string collision** with existing values. **Action**: grep `password.changed` in `lib/audit/auth-events.ts` to confirm no existing strings collide. Likely safe (only `password.reset.requested`, `password.reset.confirmed` exist today).
2. **`setAccountPassword` cascade**: does it bump `accounts.updated_at`, emit any side-event, or hit dependents I'm forgetting? **Action**: re-read `lib/auth/accounts.ts:setAccountPassword`.
3. **Concurrent same-account change**: two devices changing password at the same time. Last-writer-wins, both produce audit rows, sessions revoked twice. Acceptable.
4. **Email notification (Q1=YES) needs Resend stub-able**: existing `lib/email/dispatch.ts` has `sendResetEmail`; new function `sendPasswordChangedEmail(to, ip, ua_summary, at)` — small addition.
5. **Mobile UX**: 3 fields stacked. Sticky CTA at bottom on `<640px`. Already the cabinet pattern.
6. **A11y**: each field needs `aria-describedby` for error message + `aria-invalid` flag. Standard pattern; SeoArticle-style.
7. **i18n**: error copy hardcoded RU. Consistent with the rest of the cabinet.
8. **Per-account rate-limit bucket key**: should be `account_id` not `email_hash` (because authenticated; no enumeration concern). **Confirm in §2.1.** Updated.
9. **Risk if user disables JS**: server-rendered fallback? **No** — `/teacher/security` is a logged-in route, JS is required anyway (the rest of the cabinet too). Acceptable.
10. **Test plan for integration**: 6 cases — happy path, wrong current, weak new, same as current, RL hit, session-revocation-confirmed. Plan §8.

### 7.3. Risk of in-scope changes
- **Backend (`POST /api/account/password/change`)**: new file, isolated. Risk: low. Falls under `lib/auth/sessions.ts` writes which ARE in critical-path. **Critical-path-guard will require Codex SIGN-OFF.** Code touches NEW file but USES the critical-path lib. Need to check whether new file in `app/api/account/` triggers the guard.
- **UI**: new page, isolated. Risk: low.
- **`/teacher/profile/page.tsx` edit (1 line)**: harmless.

### 7.4. Critical-path-guard implication

The change writes through `lib/auth/sessions.ts` (`revokeAllSessionsForAccount`, `createSession`) and `lib/auth/password.ts` (`hashPassword`, `constantTimeVerifyPassword`). These are critical-path files. BUT my change only *consumes* them; the lib code doesn't change.

**docs/critical-path.md** lists FILES, not "code that consumes critical-path libs". So the guard will fire ONLY if I edit any of the critical-path-listed files. New file under `app/api/account/` and `app/teacher/security/` is NOT in the list.

**Action perform check**: read `docs/critical-path.md` to confirm — and `scripts/check-critical-path-trailer.mjs` for the regex.

If the guard fires, we either:
- (a) defer until 2026-06-11 (Codex)
- (b) split into two PRs (config-only, then route)

## 8. Test plan

Local manual:
1. Login as a teacher.
2. /teacher/security loads.
3. Submit with wrong current → inline error, no audit success row.
4. Submit with new ≠ confirm → client-side error, no API hit.
5. Submit with weak new → API 400, inline error.
6. Submit with new === current → API 400, inline error.
7. Submit valid → success toast, fields cleared, **other device** session expired (verify via a 2nd browser).
8. Email arrives (if Q1=YES).

Prod manual (after deploy):
1. Same 7 steps on `https://levelchannel.ru/teacher/security`.
2. Mobile (390px): form fits, CTA accessible, error inline.

Integration tests (Sub-PR follow-up — out of scope for the first PR, ship manual cover only):
- happy path
- bad current
- rate-limit hit

## 9. Decomposition

**Sub-PR A** — single PR.
- Backend route + lib glue.
- Frontend page + card.
- Profile copy fix (remove "(скоро)" + add link).
- Settings nav row.
- Analytics events.
- ≤ 350 lines diff.

Single PR because: tightly coupled, small surface, can't ship one without the other.

## 10. Round-2 self-review (owner defaults locked)

Owner accepted all defaults for Q1-Q5 (2026-06-09):
- Q1 → YES, email notification on success
- Q2 → YES, keep actor on this device, revoke others
- Q3 → NO, no forced relogin
- Q4 → NO, keep ≥10-char policy
- Q5 → YES, eye-toggle on fields

### 10.1. Pre-impl ground-truth checks (just ran)

1. **Audit event types collision check.** `grep "password\." lib/audit/auth-events.ts` returned 0 hits. The audit table accepts free-form `event_type` strings; no enum constraint. **`password.changed.in_cabinet` / `password.changed.in_cabinet.bad_current` are clean to add.** §5 invariant confirmed.

2. **`setAccountPassword` shape.** `lib/auth/accounts.ts:132-141`:
   ```
   update accounts set password_hash = $2, updated_at = now() where id = $1
   ```
   Does NOT touch `password_changed_at` column (there is no such column). My route does NOT need a migration — `updated_at` is the only timestamp that moves. If a future audit wants "last password change time" they query the latest `auth_audit_events` row with the new event type. **Mig-free design confirmed.**

3. **Critical-path-guard scope.** `docs/critical-path.md` lists 29 files. `lib/auth/sessions.ts` IS critical-path (item 9). `lib/auth/accounts.ts`, `lib/auth/password.ts`, `lib/auth/resets.ts` are NOT. **My changes don't EDIT any critical-path file — they only CONSUME them via import.** The guard regex (`scripts/check-critical-path-trailer.mjs`) operates on the file-change set per `git diff` — files I don't touch won't trip the guard.

   **Verify on first push:** if the guard fires unexpectedly, split into two PRs (config-only + route). Risk: low.

4. **Existing reset-confirm pattern.** `app/api/auth/reset-confirm/route.ts` already runs `revokeAllSessionsForAccount(account.id)` BEFORE `createSession`. My route follows identical ordering (§5 invariant 2). Side note: reset-confirm clears the token row via `consumePasswordReset` — my route has no token, simpler flow.

5. **Rate-limit per-account bucket key.** §2.1 spec says `5/min/account`. The bucket label MUST include the actor's `account.id`, not just IP. In `lib/security/request.ts` the `enforceRateLimit(request, scope, limit, window)` only takes a string scope — I'll use `account-pw-change:${account.id}` as the scope. **Confirmed callable shape.**

### 10.2. New risks surfaced in round 2

- **R-1 [WARN]: `validatePasswordPolicy` may already reject `<10` chars; need to confirm.** If it returns a typed error shape my route can pass that through verbatim instead of mapping to `password/new/too_weak`. **Action**: read `lib/auth/policy.ts` at impl-time and surface its error shape verbatim.

- **R-2 [WARN]: «New password same as current» check timing.** If I run `validatePasswordPolicy(newPassword)` BEFORE `constantTimeVerifyPassword(currentPassword, hash)`, the timing pattern leaks whether currentPassword was correct (because the policy step is constant, the verify step varies). **Mitigation**: ALWAYS run BOTH operations, even if either fails. Same pattern as `login` constant-time. ✓ Acceptable.

- **R-3 [INFO]: Email body for the «password changed» notification.** Resend stub at `lib/email/dispatch.ts`. Need new function `sendPasswordChangedEmail(to, { ipPrefix, uaSummary, at })`. **Action**: copy the shape of `sendResetEmail` and replace template body. Fire-and-forget (don't fail the route if email send fails — same as `sendResetEmail` pattern). ✓

- **R-4 [INFO]: Eye-toggle on `<input type="password">`**. Standard pattern: toggle `type` between `password` and `text` on icon click. A11y: button has `aria-label="Показать пароль"` / `"Скрыть пароль"`. ✓ Trivial.

- **R-5 [INFO]: «Confirm new password» field client-side check.** No API roundtrip — purely UI. If `newPassword !== confirmNewPassword`, submit button stays disabled + inline hint. Same pattern as `/reset` page. ✓

- **R-6 [WARN]: Session-cookie path after success.** `buildSessionCookie(value, isProd)` returns the cookie. I set it via `Set-Cookie` response header on the 200. Client must accept it (same flow as login). **Action**: ensure response sends `Set-Cookie` not `Set-Cookie: <stale>`. ✓

- **R-7 [WARN]: Race — user changes password from 2 tabs simultaneously.** Both pass current-verify; both call `setAccountPassword`; both revoke sessions; last writer wins. Audit gets 2 success rows. Acceptable per §7.2 round-1 review. ✓

- **R-8 [INFO]: Telegram notification on password change.** Some banks do this. Out of scope here — email-only per Q1. Reconsider in a future PR if owner wants. ✓

### 10.3. Test plan refinement

In addition to the 7 manual cases (§8):

8. **Email arrives** with the truncated IP + UA summary (Q1 default).
9. **Eye-toggle** works on all 3 fields.
10. **Disabled submit** until `newPassword === confirmNewPassword`.

Integration test fixture (Sub-PR follow-up) — happy + 3 error paths.

### 10.4. Final ship-checklist

- [x] Plan-doc round-2 self-reviewed
- [x] Owner-locked defaults Q1-Q5
- [x] No migration needed
- [x] Critical-path-guard doesn't trip (no critical-path files edited)
- [x] Existing `reset-confirm` pattern matched (revoke-then-create-session)
- [ ] **Implement** — Sub-PR A (single PR, ≤350 lines diff)
- [ ] Build green
- [ ] Push + open PR
- [ ] Wait CI
- [ ] Merge after CI
- [ ] Prod verify via playwright (web + mobile)

## 11. Ready to implement.
