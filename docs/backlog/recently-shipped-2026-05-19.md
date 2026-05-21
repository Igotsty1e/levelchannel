# Recently shipped — 2026-05-19 autonomous wave

Extracted from `ENGINEERING_BACKLOG.md` on 2026-05-21 (DOC-SPLIT).

## Recently shipped — 2026-05-19 autonomous wave

Single-day burst that closed BCS-DEF-1 end-to-end, swept the SaaS-2 copy surface, registered 11 plan-docs across BCS-DEF-1/4/5/7 + SAAS-1/6 follow-ups, and ran three code-quality sweeps. Listed by category for cross-reference; individual entries above carry the durable record.

- **BCS-DEF-1 end-to-end** (1 impl + 1 backlog strikethrough + 1 test-surface sweep): PR #316 (RFC merged with full impl — migration 0058 + probe + systemd + activator + UI + 21 tests), #329 (backlog strikethrough), #330 (test-surface inventory).
- **SAAS-2 copy sweep** (23 atomic PRs): #295 (admin menu rename), #296 (reconciliation rewrite), #297 (accounts + dashboard headers), #298 (admin h1 alignment), #299 (payments/refunds subtitles), #300 (cabinet слот), #301 (dashboard cards), #306 (account detail), #308 (Загружаем…), #309 (Мои занятия), #311 (cabinet placeholder), #312 (admin slots h1), #317 (BookConfirmModal), #318 (Оплата после занятия), #319 (Уведомления оператора tab), #320 (3DS/чекаут glossary), #321 (learner-visible слот replace), #323 (Toolbar Загружаем…), #324 (aria-labels Занятие), #325 (global-error copy), #326 (empty-states), #327 (debt-summary headers), #328 (refund kind label). SAAS-2 surface effectively exhausted at end of session.
- **SAAS-1 impl + follow-ups** (3 PRs): #313 (SAAS-1 5.F drag-math seam → pure functions + tests), #341 (SAAS-1 5.A token scoping under `.saas-chrome`), #354 (SAAS-1-FOLLOWUP-KEYBOARD impl — arrow-key cell navigation + 30 tests).
- **Test infra** (1 PR): #346 (SAAS-INFRA-1 — jsdom + RTL added to vitest unit suite; unblocks component-render coverage).
- **Plan-docs registered** (13): #331 (SAAS-1 5.A token scoping), #332 (BCS-DEF-1-FANOUT), #333 (BCS-DEF-4 learner reminders), #336 (BCS-DEF-5 teacher reminders), #337 (BCS-DEF-7 syncToken pull), #338 (SAAS-INFRA-1), #339 (BCS-DEF-1-TG), #344 (SAAS-1-FOLLOWUP-KEYBOARD), #345 (SAAS-6-A11Y-1), #347 (BCS-DEF-4-TG), #350 (BCS-DEF-4-PUSH), #353 (BCS-DEF-5-PUSH), #355 (BCS-DEF-5-TG). All catalogued in the Active follow-up roadmap + SAAS-1..6 follow-ups sections above.
- **BCS-DEF-7 Phase 1 impl** (1 PR): #352 — `next_sync_token` column added to `teacher_calendar_integrations` (migration 0060). Phase 2 (pull-runner delta path) plan-ready.
- **Code-quality sweeps** (8 PRs): #334 (align stale «Мои уроки» comments), #335 (drop unused `headers` import from gated layout), #340 (align stale BCS-DEF-1 «Phase 2 will ship» comments), #342 (drop three dead local constants), #343 (drop two unused React imports), #348 (drop unused `useRouter` import), #349 (drop unused imports from lessons-section), #351 (drop dead imports + date-name constants in cabinet/book).
- **Bug fixes + backlog hygiene** (3 PRs): #315 (BUG-2026-05-13-1 thank-you session-aware back-link + 11 tests), #314 (strikethrough 11 stale AUDIT-* items).

Aggregate: ~54 PRs catalogued above for the 2026-05-19 burst (23 SAAS-2 + 13 plan-docs + 8 code-quality + 7 impls + 3 BCS-DEF-1 + bug-fix/hygiene). BCS-DEF-1 live on prod (code path) pending operator's `scripts/activate-prod-ops.sh` run to enable the 4th systemd timer.
