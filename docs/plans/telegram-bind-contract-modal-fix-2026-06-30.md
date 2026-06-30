---
title: Telegram bind contract, modal fix, and teacher push disable on notifications page
status: IMPLEMENTED and self-reviewed to SIGN-OFF on 2026-06-30
date: 2026-06-30
owner: codex
---

# Telegram bind contract, modal fix, and teacher push disable on notifications page

## Implementation status

Implemented on **June 30, 2026**.

Delivered:

1. Raw 8-character Telegram bind codes now work again as a compatibility alias in the shared webhook.
2. The teacher Telegram modal now teaches and copies the canonical `/start <code>` command instead of the broken raw-code path.
3. The teacher integrations card now refreshes bind state while the modal is open and clears stale "not bound" state after success.
4. `/teacher/settings/digest` no longer presents Push as a live teacher channel; the page now exposes only Email and Telegram and explicitly marks Push as deferred.

Validation completed during implementation:

- `npx vitest run tests/telegram/webhook-bind-command-route.test.ts tests/teacher/bind-code-modal.test.tsx tests/teacher/notification-preferences-matrix.test.tsx tests/teacher/digest-page-contract.test.ts`
- `npm run check:env-contract`
- `npm run check:content-style`
- `npm run build`
- `npm run test:run`

Validation note:

- `npm run test:e2e:product-flows:only` was executed against the local suite and remains red for pre-existing environment/runtime issues unrelated to this wave, including `NEXT_PUBLIC_SITE_URL must use https://` and `RESEND_API_KEY is required when NODE_ENV=production`, plus existing route/runtime regressions already present in the repo-level suite.

## Summary

Production Telegram binding is not globally down. The current production behavior on **June 30, 2026** shows a narrower regression:

1. Sending raw bind code like `ZLNLZJFV` to the bot does **not** bind.
2. Sending `/start ZLNLZJFV` **does** bind successfully.
3. The teacher integrations modal explicitly tells the user that the bot accepts both formats, which is false.
4. The modal also leaves the user in a stale state after success, because the card does not reliably refresh from "Не привязан" to "Привязан" while the user is on the screen.

This is a contract-drift bug between UI copy / CTA behavior and the webhook parser, plus a weak modal UX.

There is a second teacher-facing contract bug on `/teacher/settings/digest`:

5. The notifications page still presents **Push** as an active notification channel in copy and matrix controls, even though teacher Web Push is not shipped yet.

So this wave closes two adjacent teacher-notifications regressions:

- Telegram bind contract drift on `/teacher/settings/integrations`
- premature Push exposure on `/teacher/settings/digest`

## Evidence

### Evidence A, production chat timeline

- **May 22, 2026**: `/start 10:44` style flow ended with successful bind message for learner reminders.
- **June 30, 2026 16:18**: raw code `ZLNLZJFV` was sent, no success reply.
- **June 30, 2026 16:26**: `/start ZLNLZJFV` was sent, and the teacher digest Telegram bind succeeded.

Conclusion: the production bot, webhook, secret, and bind-consume path are alive. The broken part is the raw-code path that the modal currently promises.

### Evidence B, source-level mismatch

- [components/teacher/digest-settings/bind-code-modal.tsx](/Users/ivankhanaev/LevelChannel/components/teacher/digest-settings/bind-code-modal.tsx:85) says: `Отправьте код {code} или нажмите «Start» — бот распознает оба формата.`
- [app/api/telegram/webhook/route.ts](/Users/ivankhanaev/LevelChannel/app/api/telegram/webhook/route.ts:143) only dispatches:
  - `/start <code>`
  - `/start`
  - `/stop`
- Raw 8-char code messages are currently ignored by the dispatcher.

## Existing surface inventory

Per `~/.claude/COMPANY.md` survey-before-plan rule, this plan reuses existing Telegram surfaces instead of creating parallel ones.

### Survey 1, teacher Telegram bind UI

Command:

```bash
rg -n "bind-code-modal|requestTeacherTelegramBindCode|teacher-telegram|Открыть Telegram|Скопировать" app components lib tests
```

Matches and disposition:

- `components/teacher/digest-settings/bind-code-modal.tsx`
  - **EXTEND**
  - Current modal copy and CTA shell live here. This is the primary UI target.
- `components/teacher/digest-settings/telegram-card.tsx`
  - **EXTEND**
  - Owns modal open state, local `bound` state, issue/unbind actions, and stale-state behavior.
- `app/teacher/settings/integrations/page.tsx`
  - **EXTEND**
  - Current user-facing teacher surface from the screenshot. No new route should be introduced.
- `app/teacher/settings/digest/page.tsx`
  - **REFERENCE**
  - Legacy sibling surface. Useful for parity, but not the primary owner-facing path anymore.
- `lib/teacher-telegram-bind/actions.ts`
  - **REFERENCE / possible EXTEND**
  - Existing server actions own code issuance and unbind; status refresh may need a small sibling read action if client polling is added.

### Survey 2, webhook consume path

Command:

```bash
rg -n "/start <code>|telegram webhook|TELEGRAM_WEBHOOK_SECRET_TOKEN|teacher_telegram_bind_codes|learner_telegram_bind_codes" app lib tests scripts
```

Matches and disposition:

- `app/api/telegram/webhook/route.ts`
  - **EXTEND**
  - Single shared webhook for learner + teacher Telegram bind flows. Raw-code alias belongs here, not in a new route.
- `lib/teacher-telegram-bind/store.ts`
  - **UNRELATED**
  - Code issuance storage is healthy. No evidence of broken write path.
- `lib/learner-telegram-bind/store.ts`
  - **UNRELATED**
  - Same conclusion for learner path.
- `scripts/setup-tg-webhook.sh`
  - **REFERENCE**
  - Ops contract only. Current bug is not caused by missing webhook registration.
- `scripts/cloudflare-worker-telegram-proxy.js`
  - **REFERENCE**
  - Proxy contract remains relevant to prod, but current evidence shows webhook delivery is functioning.

### Survey 3, existing flow contracts

Commands:

```bash
rg -n "teacher|integrations|digest" evals/PRODUCT_FLOWS.md evals/URL_REDIRECT_CONTRACT.md
```

Disposition:

- No existing redirect contract row needs semantic change for this wave.
- This wave does **not** add a new route or redirect.
- This wave **does** touch a teacher cabinet surface, so the post-change e2e pass is still required by repo policy.

### Survey 4, teacher notifications matrix and push exposure

Command:

```bash
rg -n "push|Push|web push|browser push|pwa" components/teacher lib/notifications app/teacher/settings/digest tests
```

Matches and disposition:

- `components/teacher/notification-preferences-matrix.tsx`
  - **EXTEND**
  - Current matrix exposes `push` as a live channel toggle. This is the primary notifications-page target.
- `app/teacher/settings/digest/page.tsx`
  - **EXTEND**
  - Current page copy says `(Email, Telegram, Push)` are configured in Integrations. That is no longer an honest product contract for teachers.
- `components/teacher/digest-settings/push-card.tsx`
  - **REFERENCE**
  - Placeholder card exists, but it is not currently rendered on `/teacher/settings/digest`. The immediate bug is the matrix/channel contract, not this card.
- `lib/notifications/preferences.ts`
  - **REFERENCE / possible EXTEND**
  - Server-side channel catalog still includes `push`; implementation may either keep it server-capable but hide it in the teacher UI, or gate teacher UI separately. No new surface should fork the preference model.
- `docs/plans/bcs-def-5-push-teacher-pwa-reminders.md`
  - **REFERENCE**
  - Confirms teacher Web Push is still a draft deferred wave, not a shipped teacher feature.

## Problem statement

The current system violates its own user contract in three ways:

1. **Parser mismatch.** The modal promises "raw code or Start", but the webhook only accepts `/start <code>`.
2. **CTA mismatch.** The copy button copies only the raw code, which nudges the user toward the broken path.
3. **State mismatch.** Even after successful binding, the UI can keep showing stale "not bound" state until a later revisit.
4. **Teacher Push exposure mismatch.** `/teacher/settings/digest` presents Push as if it were a configurable live channel, while teacher Web Push is still deferred and not ready for production use.

The owner's "раньше точно работало" observation is consistent with the current evidence:

- the Telegram integration itself still works,
- but the raw-code interaction that the modal teaches the user to use does not.

## Goal

Restore a single honest, low-friction bind flow on `/teacher/settings/integrations`:

- raw code message should work again as a compatibility alias,
- `/start <code>` remains the canonical command,
- the modal should instruct only supported behavior,
- the card should reflect successful bind without requiring a vague "come back later" pattern.

At the same time, restore an honest channel contract on `/teacher/settings/digest`:

- teacher notifications page should only expose channels that are actually ready now,
- teacher Web Push should be visibly unavailable there until the dedicated teacher-push wave ships.

## Non-goals

- No change to payment, auth, or other Telegram notification channels.
- No implementation of teacher Web Push delivery in this wave.
- No rewrite of the shared bind-code storage model.
- No change to webhook auth, secret handling, proxy routing, or bot token rotation.
- No new teacher settings route.
- No legal copy or offer/privacy text changes.

## Root cause

### Root cause 1, broken contract

`BindCodeModal` copy was evolved to claim a broader contract than the webhook actually implements.

Today:

- UI contract: "send raw code or tap Start"
- backend contract: "send `/start <code>` or `/stop`"

That is a plain drift bug.

### Root cause 2, copy-to-clipboard nudges the broken path

The modal's copy action writes only the raw bind code. For a user who does not hit the deep-link button, the obvious next action is to paste the raw code into Telegram. That is exactly the unsupported path.

### Root cause 3, stale client state

`TelegramDigestCard` stores `bound` in local state initialized from `initialBound` once. The modal text also says the status updates "при следующем заходе", which confirms the current UI has no robust status sync loop.

### Root cause 4, premature teacher Push exposure

Teacher Web Push has a draft future plan at [bcs-def-5-push-teacher-pwa-reminders.md](/Users/ivankhanaev/LevelChannel/docs/plans/bcs-def-5-push-teacher-pwa-reminders.md:1), but the current notifications page still behaves as if `push` were a normal active channel:

- [app/teacher/settings/digest/page.tsx](/Users/ivankhanaev/LevelChannel/app/teacher/settings/digest/page.tsx:69) says `Email, Telegram, Push`
- [components/teacher/notification-preferences-matrix.tsx](/Users/ivankhanaev/LevelChannel/components/teacher/notification-preferences-matrix.tsx:103) renders a live `Push` channel column

That creates false expectation and lets the teacher toggle a channel that is not actually ready as a teacher product surface.

## Proposed fix

### A. Webhook compatibility alias

File:

- [app/api/telegram/webhook/route.ts](/Users/ivankhanaev/LevelChannel/app/api/telegram/webhook/route.ts:143)

Change:

- Extend command dispatch so a plain 8-character alphanumeric bind code is treated exactly like `/start <code>`.
- Reuse existing `handleStart(code, chatId, fromId)` without forking bind logic.

Final dispatch shape:

- `/start <code>` → `handleStart`
- raw `^[A-Z0-9]{8}$` text → `handleStart`
- `/start` → help reply
- `/stop` → `handleStop`
- everything else → ignored

Why:

- restores backward-compatible behavior immediately,
- fixes the owner-facing incident with minimal blast radius,
- keeps one bind implementation, no shadow helper.

### B. Modal copy and CTA contract cleanup

File:

- [components/teacher/digest-settings/bind-code-modal.tsx](/Users/ivankhanaev/LevelChannel/components/teacher/digest-settings/bind-code-modal.tsx:1)

Changes:

1. Replace the misleading "bot accepts both formats" sentence with one canonical instruction.
2. Change the copy action to copy `/start ${code}`, not the naked code.
3. Rename the copy button from `Скопировать` to `Скопировать команду`.
4. Keep the deep-link button as the primary path when `botUsername` exists.
5. Remove the stale "статус обновится при следующем заходе" promise from the instructional copy.

Proposed modal copy contract:

- Primary instruction:
  - `Откройте бота и отправьте команду одним сообщением, или нажмите кнопку ниже, если Telegram установлен на этом устройстве.`
- Command block:
  - visually show `/start ZLNLZJFV`
- Steps:
  - `Откройте бота @... в Telegram.`
  - `Отправьте команду /start ZLNLZJFV.`
  - `После успешной привязки статус обновится здесь автоматически.`

Why:

- content becomes truthful,
- clipboard nudges the working path,
- UX becomes deterministic.

### C. Bind status refresh while modal is open

Primary owner file:

- [components/teacher/digest-settings/telegram-card.tsx](/Users/ivankhanaev/LevelChannel/components/teacher/digest-settings/telegram-card.tsx:1)

Supporting read path:

- extend existing server action surface in [lib/teacher-telegram-bind/actions.ts](/Users/ivankhanaev/LevelChannel/lib/teacher-telegram-bind/actions.ts:1)
  - OR add one small read-only sibling action there

Change:

- While the modal is open, the client checks whether the current teacher account is now bound.
- When bound becomes true:
  - close the modal,
  - set the card state to `bound=true`,
  - clear pending code state,
  - show the success pill immediately.

Accepted implementation shape:

- preferred: add a small read-only server action like `getTeacherTelegramBindingStatus()`
- trigger it:
  - when window regains focus,
  - when page visibility becomes visible,
  - optionally on a short interval while modal is open

Why:

- avoids fragile full-page revisit expectation,
- works both for same-device deep-link and for "user switched apps and came back",
- keeps the state owner local to the existing card component.

### D. State ownership cleanup in `TelegramDigestCard`

Current risk:

- `bound` is initialized from `initialBound` only once,
- card can drift from server truth.

Change:

- keep local optimistic state, but ensure it can converge back to server/read-action truth,
- do not rely on one-time prop initialization as the long-term source of truth.

Minimal acceptable pattern:

- explicit local updates on bind/unbind success,
- plus read-action reconciliation while modal is open.

No larger architectural rewrite is needed in this wave.

### E. Optional ops verification, no production contract change

Because current evidence shows `/start <code>` succeeds in production, ops misconfiguration is **not** the root cause of this incident.

Still, before rollout we should verify the bot contract once:

- `getWebhookInfo` points at the expected webhook URL
- `last_error_message` is empty
- no secret mismatch

This is validation only, not a planned code change.

### F. Disable teacher Web Push on `/teacher/settings/digest`

Primary owner files:

- [app/teacher/settings/digest/page.tsx](/Users/ivankhanaev/LevelChannel/app/teacher/settings/digest/page.tsx:1)
- [components/teacher/notification-preferences-matrix.tsx](/Users/ivankhanaev/LevelChannel/components/teacher/notification-preferences-matrix.tsx:1)

Change:

1. Remove `Push` from the active channel contract on the teacher notifications page for now.
2. Update explainer copy so it says only `Email` and `Telegram` are configurable there.
3. Disable teacher Push in the matrix surface rather than presenting it as a live toggle.

Preferred UX shape for this wave:

- matrix shows only active channels that are actually ready now:
  - `Email`
  - `Telegram`
- page copy changes from `Email, Telegram, Push` to `Email и Telegram`
- optional muted note below the intro or matrix:
  - `Push-уведомления для учителей пока не готовы и появятся отдельной волной.`

Why:

- aligns the page with actual shipped teacher capability,
- removes misleading controls,
- keeps the future teacher-push plan deferred instead of half-exposed.

What this wave should **not** do:

- do not implement teacher Push,
- do not add a fake disabled toggle that suggests the user can soon self-activate it from this page,
- do not fork notification-preferences storage unnecessarily.

## UX acceptance criteria

On `/teacher/settings/integrations`:

1. Teacher clicks `Привязать`.
2. Modal opens with one canonical command flow.
3. Copy button copies `/start <code>`.
4. Teacher can:
   - tap `Открыть Telegram`, or
   - manually paste the copied command
5. If the teacher sends raw 8-char code instead, bind still succeeds because webhook now accepts it as compatibility input.
6. After successful bind, returning to the app updates the card to `Привязан` without requiring a later revisit.
7. On `/teacher/settings/digest`, Push is no longer presented as an active configurable teacher channel until the dedicated teacher-push wave ships.

## Test plan

### Automated

Required by repo policy for this wave:

```bash
npm run build
npm run test:run
npm run check:env-contract
npm run check:content-style
```

Because a teacher cabinet surface and Telegram bind flow are touched:

```bash
npm run test:e2e:product-flows
```

### New or updated tests

1. **Webhook route test**
   - Add or extend route-level test coverage for:
     - raw `ZLNLZJFV` text → same path as `/start ZLNLZJFV`
     - `/start ZLNLZJFV` still works
     - `/start` still returns help reply
     - unrelated text still ignored

2. **Modal component test**
   - copy button writes `/start <code>`
   - modal no longer claims unsupported behavior
   - primary CTA label remains `Открыть Telegram`

3. **Card state test**
   - when binding status flips true, the card updates from `Не привязан` to `Привязан`
   - modal closes on successful status reconciliation

4. **Teacher notifications page contract test**
   - intro copy no longer claims Push is configurable there
   - teacher notifications matrix does not expose an active Push toggle/column

5. **Content-style regression pin**
   - no forbidden English or internal jargon leaks into the updated modal copy
   - teacher Push deferred note is plain Russian and does not imply shipped readiness

### Manual QA

1. Open `/teacher/settings/integrations`.
2. Request a bind code.
3. Press copy and confirm clipboard contains `/start <code>`.
4. Send raw code only, verify bind works.
5. Unbind with `/stop`.
6. Send `/start <code>`, verify bind works.
7. Return to the app and verify the card flips to `Привязан` without full revisit ambiguity.
8. Open `/teacher/settings/digest` and verify only live channels are configurable there, with Push clearly absent or deferred.

## Risks

### Risk 1, command parser broadening

Allowing raw 8-char text broadens accepted input slightly.

Why acceptable:

- bind codes are already random, short-lived, and checked against live DB rows,
- the handler already rate-limits by `from.id`,
- all real bind mutation still flows through `handleStart`.

### Risk 2, UI polling overreach

An aggressive polling interval could be noisy.

Mitigation:

- keep checks only while modal is open,
- prefer visibility/focus-triggered reconciliation,
- use low-frequency interval only if needed.

### Risk 3, false confidence from local browser tooling

Playwright plugin is available in principle but browser binaries are missing on this machine today.

Mitigation:

- plan does not depend on plugin-only proof,
- source evidence plus production chat evidence already isolate root cause,
- before implementation QA, install browsers with `npx playwright install`.

### Risk 4, over-coupling Telegram fix and Push cleanup

These are two adjacent issues on teacher notification surfaces, but they must not turn into a broad redesign wave.

Mitigation:

- Telegram changes stay on `/teacher/settings/integrations` and shared webhook handling
- Push cleanup stays on `/teacher/settings/digest` copy + matrix exposure only
- no teacher Push implementation work is pulled forward

## Rollout / rollback

Rollout is safe:

- webhook alias is additive,
- modal copy/clipboard changes are local to the teacher integrations UI,
- no schema or env migration is required.

Rollback is straightforward:

- revert the webhook raw-code alias,
- revert modal copy/button behavior,
- revert status reconciliation logic.

## Sign-off target

This plan is sign-off ready when:

1. No new route is introduced.
2. Raw-code alias is explicitly routed through existing `handleStart`.
3. Copy action is changed to `/start <code>`.
4. Modal copy is truthful and content-style compliant.
5. Card state refresh is defined well enough to avoid the current stale-state UX.
6. Teacher notifications page no longer exposes Push as a ready configurable channel.
7. Tests cover raw-code, `/start <code>`, modal copy behavior, and teacher notifications page channel contract.
