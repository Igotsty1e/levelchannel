# Phase 2 — Auth UI

Status: **in progress (started 2026-04-29).** Phase 1B (7 API routes) is shipped on prod. This phase puts a user-facing UI on top of those endpoints.

## Goal

Six new pages + a header so a real user can register, verify, log in, log out, request password reset, and reset password without any operator intervention.

| Path | Type | Purpose |
|---|---|---|
| `/register` | client form | email + password + ПДн consent → `POST /api/auth/register`. Success → `/verify-pending`. |
| `/verify-pending` | static info | "Письмо отправлено. Нажмите ссылку в почте." Reached after register. |
| `/login` | client form | email + password → `POST /api/auth/login`. Success → `/cabinet`. |
| `/forgot` | client form | email → `POST /api/auth/reset-request`. Always shows neutral confirmation (anti-enumeration). |
| `/reset?token=…` | client form | new password → `POST /api/auth/reset-confirm`. Replaces Phase 1B 404 placeholder. |
| `/cabinet` | server gate | Server-side auth check via cookie + `/api/auth/me`. 303 to `/login` if unauthenticated. Body: «Кабинет в разработке» + logout button. |
| `/verify-failed` | static (replace) | Replace Phase 1B inline-style placeholder with full styled UI matching landing tone. |

Plus shared:
- `components/Header.tsx` — site-wide top bar with «Войти» / «Кабинет» CTA based on `/api/auth/me` state. Mounted on auth pages and (additively) on legal pages. Landing keeps its own header — this one mounts there too as a thin top bar that does not displace the existing hero.

## Decisions (D1–D8, settled with user 2026-04-29)

| ID | Decision | Why |
|---|---|---|
| D1 | **Client `fetch`**, no server actions | API endpoints exist; matches existing guest-checkout pattern; debug + CSP simpler. |
| D2 | **Keep CloudPayments script in `app/layout.tsx`** | Cabinet will get its own payment surface in Phase 6 (per Output 2 §Phase 6). Cost of ~30KB on auth pages is acceptable for layout simplicity. |
| D3 | **Single `components/Header.tsx`** mounted on every auth page + legal pages + (additively) landing | DRY. Auth state via `fetch /api/auth/me` in `useEffect`. |
| D4 | **`/verify-pending` info page** after register | Without it, user sees the form unchanged after submit and assumes nothing happened. |
| D5 | **`/cabinet` is a Server Component** with cookie read + redirect on 401 | SSR-redirect avoids flash of unauthenticated UI. |
| D6 | **Native HTML5 + manual validation** (`required`, `type="email"`, `minLength`) | Form count is 4. Server validation already authoritative. zod/react-hook-form is overhead. |
| D7 | **Russian only** | Audience and existing surfaces are RU. No multilingual stack for 4 forms. |
| D8 | **`needsRehash` login-flow rehash** stays in backlog | Phase 1A debt; not exploitable at bcrypt cost=12; Phase 2 is frontend. Documented in `ENGINEERING_BACKLOG.md` as before. |

## Per-page contract

### `/register`

**Fields:** `email` (required, `type=email`), `password` (required, `minLength=10`), `personalDataConsentAccepted` (required checkbox).

**Submit:**
```
POST /api/auth/register
{ email, password, personalDataConsentAccepted: true }
```

**Outcomes:**
- `200 { ok: true }` → `router.push('/verify-pending?email=' + encoded)` so the info page can echo the address.
- `400 { error }` → render the `error` string under the form; preserve typed values.
- `429` (rate-limited) → "Слишком много попыток. Попробуйте через минуту."

**Anti-enumeration:** the API already produces byte-equal responses for known/unknown email. UI must NOT fork on shape — same success path always.

**Consent links:** checkbox label includes inline links to `/offer`, `/privacy`, `/consent`.

### `/verify-pending`

Static info page. Reads `?email=` from URL. Body: «На адрес `<email>` отправлено письмо. Нажмите ссылку в нём, чтобы подтвердить e-mail. Если письмо не пришло за 5 минут — проверьте спам.» CTA: «Открыть Gmail» / «Войти» (`/login`).

### `/login`

**Fields:** `email`, `password`.

**Submit:**
```
POST /api/auth/login
{ email, password }
```

**Outcomes:**
- `200 { ok: true }` → `router.push('/cabinet')`.
- `401 { error: "Неверный e-mail или пароль." }` → render under form.
- `400` → render error.

Link: «Забыли пароль?» → `/forgot`. Link: «Нет аккаунта?» → `/register`.

### `/forgot`

**Field:** `email`.

**Submit:**
```
POST /api/auth/reset-request
{ email }
```

**Outcomes:** ALWAYS show «Если такой e-mail зарегистрирован, мы отправили на него письмо со ссылкой для сброса пароля.» — even on `200` for unknown emails. UI does not branch on response.

### `/reset?token=…`

**Fields:** `password`, `passwordConfirm` (UI-only, must match).

**Submit:**
```
POST /api/auth/reset-confirm
{ token, password }
```

**Outcomes:**
- `200 { ok: true }` → render success state «Пароль обновлён. Вы вошли в кабинет.» + button → `/cabinet`. (`/api/auth/reset-confirm` already creates a session per mech-5.)
- `400 { error: "Ссылка недействительна или уже использована." }` → render with link to `/forgot`.

If `?token` is missing, render «Ссылка повреждена. Запросите новое письмо.» without making any API call.

### `/cabinet`

**Server Component.** Reads the session cookie via `cookies()` from `next/headers`, fetches `/api/auth/me` server-side with that cookie, on 401 issues `redirect('/login')`. On 200 renders:

```
Здравствуйте, <email>.

Ваш кабинет в разработке. Здесь скоро появится:
— расписание занятий
— оплата уроков
— ваш прогресс

[Выйти]
```

The «Выйти» button is a tiny client island that calls `POST /api/auth/logout` then `router.push('/')`.

If `email_verified_at` is null: show a yellow-outlined banner «E-mail не подтверждён. [Запросить письмо повторно]». In Phase 2 the link goes to `/register` (re-trigger flow); a dedicated resend endpoint is Phase 3.

### `/verify-failed` (replace placeholder)

Same content as Phase 1B placeholder, restyled to match dark-theme tokens with the new Header on top.

### `components/Header.tsx`

Client component. On mount, `fetch('/api/auth/me')`:
- 200 → show `<email-fragment>` + "Кабинет" link → `/cabinet`. Hover menu / right-click reveal "Выйти" (or just two links separated by a dot).
- 401/network error → show "Войти" → `/login`.
- Pre-fetch state: render the unauthenticated variant (no flash; "Войти" is the safe default).

Mounted on: `/register`, `/verify-pending`, `/login`, `/forgot`, `/reset`, `/cabinet`, `/verify-failed`, `/offer`, `/privacy`, `/consent`. NOT mounted on `/`, `/thank-you` (landing has its own bespoke chrome — adding a second header would clutter it; landing's existing nav already covers the «Войти» CTA we add separately).

**Wait — landing «Войти» CTA.** The landing's nav gets a small "Войти" link right of the existing CTAs. That happens directly in `app/page.tsx`, not via the new Header component, to avoid touching the landing's hero composition.

## Files

New:
- `components/Header.tsx`
- `app/register/page.tsx`
- `app/verify-pending/page.tsx`
- `app/login/page.tsx`
- `app/forgot/page.tsx`
- `app/reset/page.tsx`
- `app/cabinet/page.tsx`
- `app/cabinet/logout-button.tsx` (client island)
- `lib/auth/client.ts` (tiny shared `postJson` helper for the four forms)
- `docs/plans/phase-2-auth-ui.md` (this doc)

Modified:
- `app/page.tsx` (add small «Войти» link to nav)
- `app/verify-failed/page.tsx` (restyle, mount Header)
- `app/offer/page.tsx`, `app/privacy/page.tsx`, `app/consent/personal-data/page.tsx` — header mount only (visual only, no legal-text change → Legal-Pipeline-Verified trailer required because file in scope)
- `ARCHITECTURE.md` (route table)
- `ENGINEERING_BACKLOG.md` (Phase 2 closed)

## Tests

Unit tests for the auth UI itself add little value (forms call existing API; behavior under HTTP is already covered by Phase 1B integration tests). What we DO add:

- `tests/integration/auth/cabinet-gate.test.ts` — server-side cabinet gate: no cookie → 303 to /login; valid cookie → renders email; expired/invalid cookie → 303.

Manual smoke (acceptance):
- register on dev → email arrives → click → /cabinet shows email
- logout → /cabinet 303 to /login
- login → /cabinet
- /forgot → email arrives → click → /reset → new password → /cabinet
- /reset without ?token → friendly message, no API call
- /verify-failed standalone visit → styled page

## Out of scope

- Resend-verify endpoint (`POST /api/auth/resend-verify`) — Phase 3.
- Inline cabinet content beyond placeholder — Phase 3+.
- Email change flow — post-MVP.
- Account deletion — must exist for 152-ФЗ subject access rights, but ships with admin surface in Phase 3+.
- Header on landing/`thank-you` — landing keeps bespoke chrome.

## Legal-pipeline interaction

If this PR touches `app/offer/`, `app/privacy/`, or `app/consent/` (it will, because Header mounts on them), the commit message MUST include:

```
Legal-Pipeline-Verified: trivial-fix — add <Header /> mount only, no legal text mutation
```

The hook would otherwise refuse the commit. Per `docs/legal-pipeline.md`, "trivial-fix" is the right shape because no legal copy changes — only chrome composition.
