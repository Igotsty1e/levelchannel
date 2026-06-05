# Calendar onboarding cleanup — 2026-06-05 (Option A — narrow scope)

Status: PLAN — Option-A paranoia round 3 BLOCK closed (engineering-hygiene only — see round-3 BLOCKER 1+2 closures); off-protocol round 4 follows.

Owner decision 2026-06-05: drop Moscow-only trigger from mig 0043 BUT keep the existing 19-entry allowlist via mig 0069 intact. The full "any IANA timezone (мировой)" promise is **deferred** to a separate multi-tenant-timezone-runtime epic (BLOCKER 1 from prior round-3 — MSK is hardcoded in 4 runtime places: `lib/calendar/google/pull.ts`, `app/teacher/calendar/page.tsx`, `lib/scheduling/slots/validation.ts`, `lib/calendar/dates.ts`).

Scope this wave: **just remove the Moscow-only artificial gate** on calendar integration. The 19-entry allowlist (Moscow + EU + US + Asian capitals) was already the profile-editor's accepted set via mig 0069; we let those teachers connect calendar. Non-allowlisted zones stay rejected at the validator. This is consistent with current system behaviour, not an expansion.

### Owner-accepted debt (recurring round-3 / round-2 BLOCKER 1 from prior loops)

The 19-entry allowlist already includes non-MSK zones (Europe/London, America/New_York, America/Los_Angeles, etc.). After this wave, those teachers can connect Google Calendar — but their downstream UX is partially-broken because:

- `lib/calendar/google/pull.ts:80` interprets all-day events in `+03:00` (MSK).
- `app/teacher/calendar/page.tsx:181` anchors the teacher's week in `Europe/Moscow`.
- `lib/scheduling/slots/validation.ts:17` validates business band in MSK.
- `lib/calendar/dates.ts:12` keeps the date-math base in MSK.

Owner explicitly chose Option A on 2026-06-05 knowing the runtime debt. The full multi-tenant-timezone refactor is tracked as a separate epic. **Acceptance for this wave verifies ONLY**: the DB-trigger no longer rejects non-Moscow timezones (e.g. London teacher can INSERT an active integration row) — NOT that the full UX is correct for that teacher.

The owner's call: ship the trigger removal so the underlying gate is gone; non-MSK teacher UX correctness is its own epic.

Backlog items bundled into this single PR:
- #8 SSR + API + callback timezone gate on `/teacher/settings/calendar`.
- #9 (narrowed) drop Moscow-only DB triggers from mig 0043; keep mig 0069's 19-entry CHECK. App-layer gates in Sub-PR C handle the timezone invariants (require-when-activating, no-clear-while-active). Replacement DB triggers tracked as follow-up PR per round-5 BLOCKER 1.
- #10 extract `resolveCanonicalOrigin` to `lib/api/origin.ts` + migrate 2 known antipattern hits.
- #11 collapse "Как работает интеграция" `<details>` (default `open={!isConnected}`).
- Tail #5 admin@levelchannel.ru already has `Europe/Moscow` (valid) — no manual cleanup needed.

**Deploy model**: single atomic PR. The §A/B/C/D structure below is cognitive decomposition; everything ships in one merge → one autodeploy tick.

### Deploy ordering (round-2 BLOCKER 2 closure)

LevelChannel runs on a single VPS (`production_target` memory: Timeweb VPS 83.217.202.136). Autodeploy is a systemd timer (`levelchannel-autodeploy.timer`) that does `git pull` → `npm run build` → run pending migrations → `systemctl restart next-app`. **There is no rolling deploy across multiple instances** — the binary swap is atomic with sub-5s downtime.

Sequence per autodeploy tick:
1. T0: git pull (new SHA).
2. T0 + build: `npm run build`. Old binary still serving requests.
3. T0 + ~30s: migrations apply (mig 0106 adds new triggers, drops old ones). **Old binary may still be live for a few more seconds.**
4. T0 + ~30s + restart: new binary boots. Old binary terminated.

Window between step 3 and step 4: **<5 seconds**. During that window, old binary code (no try/catch, no app-layer gate) writes against new DB schema. Specifically:
- Old `PATCH /api/account/profile { timezone: null }` while integration active → trigger fires → 500 to user.
- Old callback `upsertGoogleIntegration` — **NOT affected**: the new trigger only refuses INSERT/UPDATE-into-active when timezone IS NULL; if the teacher's timezone was already non-null (which it MUST have been to pass mig 0043's now-dropped Moscow guard), the trigger passes.

The PATCH-clear path is the only at-risk vector. Impact ceiling: a teacher who explicitly clears their timezone via cabinet within the 5-second window gets 500 instead of 409. Probability of intersection: vanishingly small (5 seconds × maybe 1 prod user doing this monthly = negligible). **Accepted as low-impact narrow-window risk** per the single-VPS deploy model.

Cross-project applicability: this assumption holds for LevelChannel only. A multi-instance rolling deploy would need PR split (gates first, triggers second) — flag for future projects.

## Existing surface inventory

### origin resolution

```bash
rg -nl --type ts 'new URL\(request\.url\)\.origin|new URL\(req\.url\)\.origin|NEXT_PUBLIC_SITE_URL' app lib
```

- `lib/payments/config.ts:11-29` — **canonical surface**. `paymentConfig.siteUrl` parses `NEXT_PUBLIC_SITE_URL` at module-load, normalizes via `new URL(value).origin`, falls back to `http://localhost:3000`, fails-fast in prod when CloudPayments enabled + URL is localhost. Used in 15+ call-sites.
- `app/api/teacher/calendar/google/callback/route.ts:60-70` — **inline copy** of env-first/request-fallback (PR #535 hotfix).
- `app/api/payments/charge-token/route.ts:292` — **unfixed antipattern**. termUrl for 3DS uses `new URL(request.url).origin`. Money-critical: behind nginx, this would send the bank to `localhost:3000` on the 3DS return.

**Disposition**: **refactor** — extract `lib/api/origin.ts::resolveCanonicalOrigin(request: Request): string` that wraps `paymentConfig.siteUrl` (env-first) + falls back to `new URL(request.url).origin` ONLY when `paymentConfig.siteUrl` looks like localhost (dev). Migrate the two known antipattern hits. Don't migrate the 15+ `paymentConfig.siteUrl` consumers — they don't have `request` and the helper is for handlers that do.

### timezone validation (TRIPLE MIRROR — NO CHANGES THIS WAVE)

Owner Option A: **do NOT widen the allowlist**. All three mirror surfaces stay as-is:

1. `lib/auth/timezones.ts` — 19-entry TS source.
2. `scripts/lib/timezone.mjs` — 19-entry .mjs mirror; drift test pins equality.
3. `migrations/0069_account_profiles_timezone_check.sql` — 19-entry DB CHECK.

Mig 0106 in this wave touches NEITHER mig 0069 nor the TS/.mjs lists. It ONLY drops the Moscow-only triggers from mig 0043 and adds the new timezone-required triggers.

### calendar OAuth start gate

- `app/api/teacher/calendar/google/start/route.ts` — POST handler. Auth gate: `requireTeacherWithCurrentSaasOfferConsent`. No timezone check.
- `app/api/teacher/calendar/google/callback/route.ts` — GET handler. No timezone check.
- `app/teacher/settings/calendar/page.tsx:85-237` — SSR settings page. No timezone read or banner.

**Disposition**: **extend** — add the timezone gate to BOTH the SSR settings page (UX) AND the start route (defense-in-depth) AND the callback route (final defense). Three-layer gate; banner only on the SSR page.

### profile writer attack-surface

```bash
rg -nl --type ts 'upsertAccountProfile|api/account/profile' app lib
```

- `app/api/account/profile/route.ts:99-127` — PATCH accepts `timezone: null` cleanly. No try/catch around `upsertAccountProfile` — DB exception → Next 500.
- `lib/auth/profiles.ts:148-228` — `upsertAccountProfile` does NOT catch DB exceptions; propagate up.

**Disposition**: **belt-and-suspenders**.
- App-layer PRIMARY: in PATCH route, before calling `upsertAccountProfile`, if `update.timezone === null`, fetch integration meta; when `sync_state in ('active','degraded')`, return 409 with localized message.
- DB-level SECONDARY: trigger refuses the UPDATE if app guard bypassed (mig 0106).
- Defense for new code writing zones outside the allowlist: not applicable this wave — we're NOT widening; validator already rejects.

### profile editor UX trap

- `app/cabinet/profile-editor.tsx:31-33` — `useState(safeTimezone(initialProfile?.timezone))` falls back to `'Europe/Moscow'` when profile.timezone IS NULL. Dropdown LIES (shows Moscow as selected, but DB row stays NULL).

**Disposition**: **scoped honesty fix** — change ONLY the surface used by `/teacher/profile`, NOT learner `/cabinet/profile`. Learner booking falls back through `safeTimezone(...)` in `app/cabinet/book/page.tsx:65-77` and doesn't break without saved timezone — no need to break the learner UX.

Implementation: add an OPTIONAL prop `enforceExplicitTimezone?: boolean` to `ProfileEditor`. When true AND `initialProfile?.timezone == null`:
- init `timezone` state to `''` (no pre-fill).
- prepend `<option value="" disabled>— Выберите часовой пояс —</option>`.
- render yellow hint above select (using design-token palette, NOT raw `#f5d76e`).

Pass `enforceExplicitTimezone={true}` from `app/teacher/profile/page.tsx`; learner `app/cabinet/profile/page.tsx` keeps default (false) — current behaviour preserved.

### onboarding setup-checklist coupling (round-1 WARN 6)

```bash
rg -nl 'profileFilled|teacherSetupChecklist|teacher-setup-checklist' app lib components
```

- `lib/onboarding/teacher-setup-checklist.ts:51-57` — `profileFilled = Boolean(profile?.displayName)`. After this wave, a teacher with displayName but null timezone shows "Заполнить профиль ✓" in the cabinet checklist but still hits the timezone gate when clicking "Подключить календарь". Misleading.
- `components/onboarding/teacher-setup-checklist.tsx:26-45` — uses `profileFilled` to render the green check.

**Disposition**: extend `profileFilled` predicate to also require `profile?.timezone != null`. Teacher must save a timezone before the profile step counts as complete. Minimal, single-line change. Update step copy: "Заполните профиль (имя, часовой пояс)".

### Existing test pins

```bash
rg -nl --type ts 'CalendarConnectCard|calendar-page-gated-intro|calendar-page-state-matrix|configReady' tests
```

- `tests/teacher-cabinet-polish/calendar-connect-card.test.tsx` — pins `configReady` / `configError` / `isConnected` / `syncState`. Adding `timezoneNotSet` prop with safe default keeps current cases green.
- `tests/teacher-cabinet-polish/calendar-page-gated-intro.test.tsx` — SSR mock pin. Needs `vi.mock('@/lib/auth/profiles')` addition for the new SSR `getAccountProfile` call.
- `tests/teacher-cabinet-polish/calendar-page-state-matrix.test.tsx` — same `vi.mock` addition required.
- `tests/integration/calendar/google-routes.test.ts:50-71` — `makeTeacher()` helper hard-codes `opts.timezone ?? 'Europe/Moscow'`. Needs to accept `timezone: string | null`; on `null` skip the `upsertAccountProfile` call.
- **`tests/integration/calendar/integrations.test.ts:308-324`** (round-3 BLOCKER 1 closure) — existing test `'MSK-only trigger blocks initial_connect for non-MSK teachers'` asserts `upsertGoogleIntegration` rejects with `/Europe\/Moscow/` for `Europe/Berlin`. After this wave, that test FLIPS to assert the opposite: `Europe/Berlin` now succeeds (proves Moscow-only trigger removed). Sub-PR B test plan extends to cover this rewrite.
- **`lib/calendar/integrations.ts:8-15`** (round-3 BLOCKER 1 carry-over) — header comment references MSK-only invariant. Update to reference Option A scope: Moscow-only triggers removed; timezone invariants enforced at app layer (DB defense-in-depth triggers deferred to follow-up PR).

### product-flow safety net (round-3 WARN 5)

- `evals/PRODUCT_FLOWS.md:223-235` FLOW-TEACHER-CALENDAR-SETTINGS-001 — currently asserts URL anchors only (state-aware copy). After this wave the timezone-gate banner becomes a new state. Add to FLOW: required UI anchor `data-testid="teacher-calendar-timezone-gate"` when `account_profiles.timezone IS NULL`.
- `tests/e2e/product-flows-authenticated.spec.ts:125-136` — currently only asserts `200 + pathname`. Add e2e assertion that `data-testid="teacher-calendar-timezone-gate"` is present **CONDITIONAL** on configReady: check the page for `data-testid="calendar-coming-soon-tile"` first; if that tile is present (CI without GOOGLE_CALENDAR_* env), assert gate banner is NOT shown; otherwise (real Google env, prod-shape) assert gate banner IS present when teacher has null timezone. Round-4 WARN 2 closure.

## Scope

### Sub-PR A — origin canonicalization

1. Create `lib/api/origin.ts` (round-2 WARN 5 closure — NO dependency on `paymentConfig` to avoid bringing CloudPayments fail-fast boot guards into the calendar codepath):
   ```ts
   // Standalone canonical-origin helper. Intentionally does NOT import
   // paymentConfig — calendar OAuth must stay independent of CloudPayments
   // env-validation fail-fast contract (lib/payments/config.ts:40-43).
   //
   // Env-first / request-fallback. Mirrors the parsing rules of
   // paymentConfig.siteUrl but without the module-load side effects.
   export function resolveCanonicalOrigin(request: Request): string {
     const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim()
     if (fromEnv) {
       try {
         const parsed = new URL(fromEnv)
         if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
           if (!parsed.origin.startsWith('http://localhost')) {
             return parsed.origin
           }
         }
       } catch {
         // malformed — fall through to request fallback
       }
     }
     try {
       return new URL(request.url).origin
     } catch {
       return 'http://localhost:3000'
     }
   }
   ```
2. `app/api/teacher/calendar/google/callback/route.ts`: delete inline helper (lines 60-70) + import.
3. `app/api/payments/charge-token/route.ts:292`: `termUrl: \`${resolveCanonicalOrigin(request)}/api/payments/3ds-callback?...\``.
4. Tests (call-site coverage with **dynamic re-import** pattern, NOT static-import + stubEnv — round-2 WARN 3 closure):
   - `tests/integration/api/origin-helper.test.ts` — isolated: 3 cases (env=prod, env=localhost, malformed env). Pure-function tests, no env-stub games needed.
   - **Call-site test (callback Location)** — NEW dedicated file `tests/integration/calendar/oauth-callback-origin.test.ts` that uses the dynamic-import pattern at `tests/integration/saas-pivot/security-high-closures.test.ts:628-655`:
     ```ts
     vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://levelchannel.ru')
     vi.resetModules()
     const { GET } = await import('@/app/api/teacher/calendar/google/callback/route')
     const res = await GET(new Request('http://localhost:3000/...'))
     expect(new URL(res.headers.get('location')!).origin).toBe('https://levelchannel.ru')
     ```
   - **Call-site test (charge-token termUrl)** — NEW dedicated file `tests/integration/payments/charge-token-termurl-origin.test.ts` using the same dynamic-re-import pattern, asserts `body.threeDs.termUrl.startsWith('https://levelchannel.ru/api/payments/3ds-callback')`.
   - **Do NOT** modify `tests/integration/calendar/google-routes.test.ts` to add env-stub cases — it uses static imports and would carry stale module-cached state, producing false-green tests.

### Sub-PR B — drop Moscow-only triggers (NARROWED — no allowlist widening)

1. **NO changes** to `lib/auth/timezones.ts`, `scripts/lib/timezone.mjs`, or mig 0069.
2. Migration `migrations/0106_calendar_drop_moscow_only_triggers.sql` — minimal trigger drop only. Replacement triggers DEFERRED to a follow-up PR (round-5 BLOCKER 1 closure: adding the new triggers in the same wave creates a rolling-deploy race where a null-timezone teacher mid-OAuth-flow hits the new trigger via OLD code and gets 500). Owner authorization 2026-06-05 (Option A): app-layer gates in Sub-PR C are the primary enforcement; DB-level defense-in-depth is acceptable to defer.
   ```sql
   -- Drop the MVP-only Moscow-only triggers from mig 0043.
   -- Owner decision 2026-06-05: relax MVP gate, but DO NOT widen the
   -- 19-entry IANA allowlist (mig 0069) — the calendar runtime (pull
   -- worker / week anchor / slot validation) is still MSK-hardcoded
   -- and a wider allowlist would silently break non-MSK teachers'
   -- schedules. Multi-tenant-timezone refactor tracked separately.
   --
   -- NOTE (round-5 BLOCKER 1): replacement triggers (require-timezone
   -- on integration activate; refuse-clear on profile while active)
   -- are DEFERRED to a follow-up PR. Adding them here would race the
   -- rolling-deploy window — OLD app binary (still serving requests
   -- for a few seconds after migration applies and before restart)
   -- can hit the new trigger via callback-from-Google for a null-
   -- timezone teacher who started OAuth before the migration. App-
   -- layer gates in `app/api/teacher/calendar/google/{start,callback}`
   -- + `app/api/account/profile` are the primary enforcement; DB
   -- defense-in-depth follows in a separate PR once this app code
   -- is fully deployed.
   drop trigger if exists teacher_calendar_integrations_msk_only_guard
     on teacher_calendar_integrations;
   drop function if exists teacher_calendar_integrations_msk_only_check();
   drop trigger if exists account_profiles_timezone_msk_guard_trg on account_profiles;
   drop function if exists account_profiles_timezone_msk_guard();
   ```
3. Update `ARCHITECTURE.md:252` — adjacent context only (mig 0069 unchanged); add new row for 0106 documenting the Moscow-only trigger drop.
3a. Update `ARCHITECTURE.md:420` — the mig 0043 line currently says "MSK-only trigger + symmetric `account_profiles.timezone` guard". Rewrite to: "Originally MSK-only trigger + symmetric guard; superseded by mig 0106 (2026-06-05) which drops both Moscow-only triggers and replaces them with timezone-required-for-activation + no-clear-while-active triggers. See `docs/plans/calendar-onboarding-cleanup-2026-06-05.md`." Round-4 WARN 3 closure.
4. Tests:
   - `tests/integration/calendar/timezone-triggers.test.ts`:
     - INSERT `teacher_calendar_integrations(sync_state='active')` with profile `timezone='Europe/London'` (non-Moscow, in existing 19-entry list) → succeeds (proves Moscow-only no longer applies).
     - INSERT with profile `timezone IS NULL` → **succeeds at DB layer** (replacement trigger deferred). The app-layer gates in Sub-PR C are tested separately and ensure this path is unreachable from real handlers.
     - UPDATE account_profiles SET timezone = NULL while active integration → succeeds at DB layer (replacement trigger deferred). App-layer enforcement tested in `account-profile-timezone-clear.test.ts`.
     - UPDATE Moscow → London while integration active → succeeds (proves second Moscow-only trigger gone).
   - **Rewrite `tests/integration/calendar/integrations.test.ts:308-324`** (round-3 BLOCKER 1):
     - Rename test from `'MSK-only trigger blocks initial_connect for non-MSK teachers'` to `'integration activates for any allowlisted IANA timezone (Moscow-only trigger removed mig 0106)'`.
     - Body: call `upsertGoogleIntegration` with `Europe/Berlin` profile, assert `r.ok === true` (was `rejects.toThrow`).
     - Note: the "refuses for NULL timezone" test does NOT need to be added here at DB layer — that invariant is enforced at app-layer (POST /start route + callback) in this wave; defer to the follow-up trigger PR.
   - Update `lib/calendar/integrations.ts:8-15` header comment to reflect new triggers (round-3 BLOCKER 1 carry-over).

### Sub-PR C — timezone gate (UX banner + 3-layer guard + profile editor honesty + error localization)

1. `app/teacher/settings/calendar/page.tsx`:
   - Import `getAccountProfile`.
   - After `lookupSession`, fetch `profile = await getAccountProfile(session.account.id)`.
   - `const timezoneNotSet = profile?.timezone == null`.
   - Render banner ABOVE `<CalendarConnectCard>` when `timezoneNotSet && !isConnected`. Use **design-system tokens** (`var(--warning-bg)` / `var(--warning-fg)`, fall back to existing `rgba(...)` literals already used elsewhere in this file if tokens not yet defined; pin in `docs/design-system.md` follow-up):
     ```tsx
     {/* Round-3 BLOCKER 2 closure: also gate on configReady. When OAuth
         env vars are missing (configReady=false), the page renders a
         "Скоро будет" tile via CalendarConnectCard and the user can NOT
         attempt connect. Surfacing the timezone-gate banner above that
         tile would be contradictory UI. */}
     {timezoneNotSet && !isConnected && configReady ? (
       <div role="alert"
            data-testid="teacher-calendar-timezone-gate"
            style={{ padding: '12px 16px',
                     background: 'var(--warning-bg)',
                     color: 'var(--text-primary)',
                     border: '1px solid var(--warning)',
                     borderRadius: 8, margin: '0 0 16px 0',
                     fontSize: 14, lineHeight: 1.6 }}>
         <p style={{ margin: '0 0 6px 0' }}>
           Укажите часовой пояс перед подключением — без него расписание
           учеников и события в Google Calendar могут уехать на чужое время.
         </p>
         <Link href="/teacher/profile" style={{ color: 'var(--warning)',
               textDecoration: 'underline' }}>
           Перейти в Профиль → выбрать пояс → нажать «Сохранить» →
         </Link>
       </div>
     ) : null}
     ```
   - Add error-code → localized message map; replace raw `<code>` rendering:
     ```tsx
     // Round-1 WARN 5 closure: copy must comply with docs/content-style.md
     // §forbidden — no "token" jargon, no OAuth-speak surfaced to the user.
     const ERROR_MESSAGES: Record<string, string> = {
       timezone_required: 'Укажите часовой пояс в профиле и нажмите «Сохранить» — без него календарь не подключается.',
       consent_denied: 'Вы отменили разрешение на стороне Google. Попробуйте подключиться ещё раз.',
       invalid_callback: 'Google вернул некорректный ответ. Попробуйте подключиться ещё раз.',
       state_invalid: 'Срок действия запроса истёк. Попробуйте подключиться ещё раз.',
       wrong_role: 'Аккаунт не имеет роли учителя.',
       email_unverified: 'Подтвердите адрес почты перед подключением календаря.',
       saas_offer_awaiting_publication: 'Подключение временно недоступно — оператор обновляет соглашение.',
       saas_offer_consent_required: 'Подтвердите соглашение перед подключением.',
       token_exchange_failed: 'Не удалось подтвердить вход в Google. Проверьте часы устройства и попробуйте ещё раз.',
       no_refresh_token: 'Google не выдал нужное разрешение. Нажмите «Подключить» ещё раз и подтвердите все запрашиваемые доступы.',
       persist_failed: 'Не удалось сохранить подключение. Попробуйте ещё раз.',
       oauth_misconfigured: 'Подключение календаря пока недоступно — напишите оператору.',
       oauth_not_configured: 'Подключение календаря пока недоступно — напишите оператору.',
       rate_limited: 'Слишком много попыток подключения. Подождите минуту.',
     }
     // …
     {error ? (
       <p role="alert" style={...}>
         ⚠ {ERROR_MESSAGES[error] ?? `Не удалось завершить подключение: ${error}`}
       </p>
     ) : null}
     ```
   - Pass `timezoneNotSet` to `<CalendarConnectCard timezoneNotSet={...}>`.
2. `app/teacher/settings/calendar/connect-card.tsx`:
   - New OPTIONAL prop `timezoneNotSet?: boolean` (default `false`).
   - When `timezoneNotSet && !isConnected && configReady`, render button as **disabled** with helper text override: "Сначала укажите часовой пояс в профиле — кнопка активируется после сохранения."
3. `app/api/teacher/calendar/google/start/route.ts`:
   - After auth gate + before config: `const profile = await getAccountProfile(auth.account.id)`.
   - If `profile?.timezone == null`: return 422 `{ error: 'timezone_required', message: '…' }`.
4. `app/api/teacher/calendar/google/callback/route.ts`:
   - After session + role + saas-offer gates: `const profile = await getAccountProfile(session.account.id)`.
   - If `profile?.timezone == null`: `return redirectToSettings(origin, { error: 'timezone_required' })`.
   - **No try/catch around `upsertGoogleIntegration`** in this wave: with replacement triggers deferred (round-5 BLOCKER 1), the gate-check above is sufficient. The follow-up trigger PR will add the try/catch+narrow-error-match.
5. `app/api/account/profile/route.ts` (app-layer guard, primary):
   - In PATCH, AFTER `validateProfileUpdate` + BEFORE `upsertAccountProfile`:
     ```ts
     if ('timezone' in update && update.timezone === null) {
       const integration = await getGoogleIntegrationMeta(auth.account.id)
       if (integration && (integration.syncState === 'active' || integration.syncState === 'degraded')) {
         return NextResponse.json(
           { error: 'timezone_required_while_calendar_connected',
             message: 'Невозможно очистить часовой пояс, пока Google Calendar подключён. Отключите интеграцию и попробуйте снова.' },
           { status: 409, headers: NO_STORE },
         )
       }
     }
     ```
   - **No try/catch around `upsertAccountProfile`** in this wave: with replacement triggers deferred (round-5 BLOCKER 1), no new `23514` source exists. The app-layer guard above is the sole enforcement. The follow-up trigger PR will add the try/catch+narrow-error-match (round-5 WARN 3: catch only the specific trigger's message, not all check_violations from unrelated CHECKs like display_name length / first_name length / 0069 IANA / 0095 columns).
6. `app/cabinet/profile-editor.tsx` (round-3 WARN 3 scoped fix):
   - Accept OPTIONAL prop `enforceExplicitTimezone?: boolean` (default `false`).
   - When `enforceExplicitTimezone && initialProfile?.timezone == null`:
     - init `timezone` state to `''` (drop `safeTimezone` mask for this branch).
     - prepend `<option value="" disabled>— Выберите часовой пояс —</option>` in the select.
     - render hint above select using design tokens (`color: 'var(--warning)'`): "Часовой пояс не сохранён — расписание и календарь используют его для корректного времени."
   - When NOT `enforceExplicitTimezone` OR `initialProfile?.timezone != null`: **no behaviour change** (learner default preserved).
7. `app/teacher/profile/page.tsx`:
   - Pass `enforceExplicitTimezone={true}` to `<ProfileEditor>`.
7a. `lib/onboarding/teacher-setup-checklist.ts` (round-1 WARN 6 closure + round-3 WARN 4 doc-drift):
   - Change `profileFilled` predicate from `Boolean(profile?.displayName)` to `Boolean(profile?.displayName && profile?.timezone)`. Add explanatory comment referencing this plan.
   - Update file header comment (`lib/onboarding/teacher-setup-checklist.ts:4-9`) which currently says `'1. Profile filled (account_profiles.display_name IS NOT NULL)'` — rewrite to `'1. Profile filled (account_profiles.display_name IS NOT NULL AND account_profiles.timezone IS NOT NULL)'`.
   - Update `docs/plans/onboarding-tooltips-spec-2026-05-31.md:44-46` SHIPPED-plan doc — add a footnote: `'Updated 2026-06-05 (calendar-onboarding-cleanup): step 1 also requires timezone; see docs/plans/calendar-onboarding-cleanup-2026-06-05.md.'`
7b. `components/onboarding/teacher-setup-checklist.tsx`:
   - Update step label "Заполнить профиль" → "Заполните профиль (имя и часовой пояс)". Keep target route `/teacher/profile`.
7c. Extend `tests/integration/onboarding/teacher-setup-checklist.test.ts` (round-2 WARN 4 closure):
   - Add explicit case: profile has displayName set + timezone IS NULL → `profileFilled === false`. Catches the silent-green regression path where someone reverts the predicate.
8. Tests (round-1 WARN 2 closure — pin tests to the correct runner):
   - `tests/teacher-cabinet-polish/calendar-page-timezone-gate.test.tsx` (jsdom unit suite — SSR/RTL pin to match existing `calendar-page-gated-intro.test.tsx`):
     - SSR page (mocked SSR-tree) with `timezone=null` → renders `data-testid="teacher-calendar-timezone-gate"`.
     - SSR page with `timezone='Europe/Moscow'` → does NOT render gate banner.
     - SSR page with `?error=timezone_required` → shows localized Russian message.
   - `tests/integration/calendar/timezone-gate.test.ts` (node integration suite — API + DB only):
     - POST `/start` with `timezone=null` → 422 `timezone_required`.
     - Callback GET with valid state but `timezone=null` → 302 to `/teacher/settings/calendar?error=timezone_required`.
     - Race-case (gate-check sees timezone set; concurrent PATCH clears it; upsertGoogleIntegration completes) — accepted residual: integration row writes successfully, profile.timezone stays null. Downstream falls back to MSK via `safeTimezone`. No 500. This race becomes a hard error after the follow-up trigger PR.
   - `tests/integration/api/account-profile-timezone-clear.test.ts`:
     - PATCH `/api/account/profile { timezone: null }` with active integration → 409 `timezone_required_while_calendar_connected` (app-layer guard).
     - PATCH with no integration → 200.
     - PATCH `{ timezone: null }` with disconnected integration → 200 (correctly allowed).
     - Note: DB-level defense (trigger refusing direct UPDATEs that bypass the app) is tracked for follow-up trigger PR — not testable this wave.
   - Update `tests/integration/calendar/google-routes.test.ts::makeTeacher()` — accept `timezone?: string | null`; on `null` skip the `upsertAccountProfile` call.
   - Update `tests/teacher-cabinet-polish/calendar-connect-card.test.tsx` — add 1 case `timezoneNotSet={true}` → disabled button + helper-text override.
   - Update `tests/teacher-cabinet-polish/calendar-page-gated-intro.test.tsx` + `calendar-page-state-matrix.test.tsx` — add `vi.mock('@/lib/auth/profiles', () => ({ getAccountProfile: vi.fn(async () => ({ timezone: 'Europe/Moscow', ... })) }))`.
   - `tests/cabinet/profile-editor-enforce-explicit-timezone.test.tsx` — new: with `enforceExplicitTimezone={true}` + null timezone → hint + disabled placeholder selected; with `enforceExplicitTimezone={false}` (or absent) → existing safeTimezone behaviour unchanged.
   - `tests/e2e/product-flows-authenticated.spec.ts` — extend FLOW-TEACHER-CALENDAR-SETTINGS-001 e2e to verify gate banner DOM. **No new fixture needed**: per `tests/e2e/seed.mjs:63-91`, the current authenticated teacher fixture does NOT create an `account_profiles` row, so `profile.timezone` is already null. Add assertion on the existing teacher login path. (Round-1 INFO 7 closure.)

### Sub-PR D — collapse integration details + tail cleanup

1. `app/teacher/settings/calendar/page.tsx`:
   - Wrap "Как работает интеграция с Google Calendar" `<section>` in `<details>` with `open={!isConnected}`. `<summary>` carries the h2 title; existing list moves inside. Update `data-testid="teacher-calendar-list-heading"` pin location (inside `<summary>`).
2. Tail: admin@levelchannel.ru already has `timezone='Europe/Moscow'` (valid in 19-entry list). **No manual SQL cleanup.** Strike backlog #5.

## Risks

- **R1 — origin helper test rigor.** Call-site tests required (not just isolated helper). Mitigated in Sub-PR A tests.
- **R2 — Sub-PR ordering window (rolling deploy).** Single atomic PR + app-layer guard wrapping `upsertAccountProfile` in try/catch + 409 mapping closes the race fully. Mitigated in Sub-PR C step 5.
- **R3 — Profile editor mask trap (cabinet shared).** Scoped fix via `enforceExplicitTimezone` prop — `/teacher/profile` only, learner UX preserved.
- **R4 — Banner colour token (round-1 WARN 4).** Closed: plan uses real existing tokens `var(--warning-bg)` + `var(--warning)` + `var(--text-primary)` per `app/globals.css:62-70` + `docs/design-system.md:89-92`. No fabricated token names.
- **R5 — e2e safety net (round-1 WARN 5 carried).** Closed: e2e + FLOW doc updated to assert gate banner presence. Existing fixture already has null timezone (round-1 INFO 7).
- **R7 — Onboarding checklist drift (round-1 WARN 6).** Closed: `profileFilled` predicate extended to require timezone too. Step copy updated.
- **R8 — Test runner mismatch (round-1 WARN 2).** Closed: SSR/RTL tests placed in `tests/teacher-cabinet-polish/**` (jsdom unit suite); API/DB tests in `tests/integration/**` (node suite).
- **R9 — Grandfathered rows (round-1 WARN 3).** N/A this wave — replacement triggers deferred, so no preflight needed in mig 0106. Tracked for follow-up trigger PR.
- **R10 — Callback DB-trigger TOCTOU (round-1 BLOCKER 1).** N/A this wave — no new DB trigger added. App-layer gate in callback is sole enforcement; if a TOCTOU race lands an active integration row with timezone NULL, downstream falls back to MSK via `safeTimezone` (no 500, just MSK-default behaviour). Tracked for follow-up trigger PR with proper rolling-deploy ordering.
- **R11 — Non-MSK runtime debt (round-2 BLOCKER 1 / recurring).** Accepted by owner explicitly on 2026-06-05. Documented in §Owner-accepted debt at top of plan. Acceptance criterion clarified: DB-trigger test only, NOT full UX.
- **R12 — Rolling-deploy window (round-2 BLOCKER 2 / round-5 BLOCKER 1).** **Closed by removing new triggers from this wave.** Mig 0106 only DROPS triggers — never ADDS new ones — so OLD app binary cannot collide with new DB constraints during the deploy window. Replacement triggers deferred to a separate follow-up PR (timed AFTER this wave's app code is fully live).
- **R13 — paymentConfig coupling (round-2 WARN 5).** Closed: `lib/api/origin.ts` standalone, no `paymentConfig` import. CloudPayments env drift doesn't cascade to calendar.
- **R14 — env-stub test pattern (round-2 WARN 3).** Closed: dedicated test files using dynamic re-import pattern from `tests/integration/saas-pivot/security-high-closures.test.ts:628-655`; static-import suites left untouched.
- **R15 — Checklist regression coverage (round-2 WARN 4).** Closed: new test case `displayName set + timezone NULL → profileFilled=false` pins the predicate.
- **R16 — Existing Moscow-only test pin (round-3 BLOCKER 1).** Closed: `tests/integration/calendar/integrations.test.ts:308-324` rewrite enumerated in Sub-PR B tests; `lib/calendar/integrations.ts:8-15` header comment updated.
- **R17 — e2e banner + configReady contradiction (round-3 BLOCKER 2).** Closed: banner condition now `timezoneNotSet && !isConnected && configReady`. Banner suppressed on feature-disabled CI builds; e2e flow doc updated to surface gate ONLY in `configReady` path.
- **R18 — Migration NOTICE swallowed (round-3 WARN 3).** N/A this wave — no preflight block in mig 0106 since replacement triggers deferred.
- **R19 — Onboarding spec doc drift (round-3 WARN 4).** Closed: explicit footnote update in `docs/plans/onboarding-tooltips-spec-2026-05-31.md:44-46` + header-comment fix in `lib/onboarding/teacher-setup-checklist.ts:4-9`.
- **R20 — Narrow 23514 error catch (round-5 WARN 3).** N/A this wave — no try/catch added since no new constraint exists. Tracked for follow-up trigger PR with narrow error-message match.
- **R21 — Replacement triggers DEFERRED.** Tracked as follow-up PR. Sequence: this PR ships → fully deploys → app-code becomes baseline → follow-up PR adds DB triggers WITHOUT race because the baseline already handles all invariants at app layer.
- **R6 — Non-MSK runtime debt.** Out of scope this wave; tracked as separate multi-tenant-timezone-runtime epic. 19-entry allowlist is unchanged so no NEW non-MSK teachers can connect — only those already in the allowlist (London, NY, LA, etc.) become eligible. The existing system already partially-supports these via mig 0069; this wave just removes one artificial gate, not the underlying limitation.

## Migration plan

```
0106_calendar_drop_moscow_only_triggers.sql
```

Reversibility: trivial — re-creating mig 0043's two Moscow-only functions + triggers verbatim is one psql script away. No data changes, no column drops.

## Out of scope

- **Multi-tenant-timezone runtime refactor** — `lib/calendar/google/pull.ts` all-day pin, `app/teacher/calendar/page.tsx` week anchor, `lib/scheduling/slots/validation.ts` business band, `lib/calendar/dates.ts` MSK constant. Separate epic.
- **DB-level defense-in-depth triggers** (`teacher_calendar_integrations_require_timezone_trg` + `account_profiles_timezone_required_when_integration_active_trg`) — deferred to follow-up PR after this wave's app code is fully deployed.
- Widening the 19-entry allowlist to full IANA — deferred (owner Option A).
- Push-PWA reminders (#5 in backlog) — separate epic.
- Onboarding Sub-PR B/C/D (#6 in backlog) — separate epic.
- OAuth publishing to Production (#12) — manual Google Cloud Console operation.

## Acceptance

- [ ] Teacher with `account_profiles.timezone IS NULL` cannot reach Google OAuth start (422 `timezone_required`). SSR page renders `data-testid="teacher-calendar-timezone-gate"` banner.
- [ ] Teacher following CTA → `/teacher/profile` sees honest editor: dropdown shows "— Выберите часовой пояс —" disabled placeholder (NOT pre-selected Moscow); yellow hint visible.
- [ ] DB-only acceptance: INSERT into `teacher_calendar_integrations(sync_state='active')` with profile `timezone='Europe/London'` (non-Moscow, existing 19-entry list) succeeds — proves Moscow-only trigger gone. **Full UX correctness for non-MSK teachers is out of scope** per §Owner-accepted debt — tracked as separate multi-tenant-timezone-runtime epic.
- [ ] Teacher who tries to clear timezone via PATCH `/api/account/profile` while integration is active gets 409 `timezone_required_while_calendar_connected` (NOT 500), via app-layer guard. DB-trigger defense-in-depth tracked for follow-up PR.
- [ ] `lib/api/origin.ts::resolveCanonicalOrigin` used by both calendar callback + charge-token termUrl. Call-site tests assert stubbed-env behaviour.
- [ ] "Как работает интеграция" wrapped in `<details open={!isConnected}>`.
- [ ] FLOW-TEACHER-CALENDAR-SETTINGS-001 e2e includes timezone-gate banner assertion when fixture teacher has `timezone=null`.
- [ ] Single PR carries `Codex-Paranoia: SIGN-OFF round N/3` trailer.
