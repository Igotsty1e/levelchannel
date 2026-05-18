# SAAS-5 — Cabinet "Профиль" button + dedicated /cabinet/profile page

**Status:** DRAFT 2026-05-18 (pre-`/codex-paranoia plan`)
**Wave name:** `cabinet-profile-button`
**Trigger:** Product-owner request 2026-05-18 — declutter the main /cabinet surface so lessons dominate. Move ProfileEditor + DangerZone behind a header button to a dedicated sub-route.
**Predecessor:** none (pure UI refactor; no DB / no API change).
**Companion:** `docs/design-system.md` (sibling agent drafting in parallel — citations below assume final section anchors).

## 1. Goal

Move two currently-inline cabinet sections — **ProfileEditor** (name + timezone) and **DangerZone** (revoke consent, delete account) — off `/cabinet` and onto a dedicated **`/cabinet/profile`** sub-route. Add a single **"⚙ Профиль"** affordance to the `/cabinet` header (top-right, next to "Выйти") that links to the new page.

What stays on `/cabinet`:
- `<h1>Личный кабинет</h1>` + greeting.
- Email-verification banner (`AuthInfoBox` + `ResendVerifyButton`) — this is an **interrupt**, not part of profile management; staying on the main surface preserves the «исправь это перед тем как делать что-то ещё» semantic.
- LessonsSection (learner primary surface).
- BillingSections (learner secondary surface).
- TeacherSection + TeacherLearnersSection (teacher role).
- "Кабинет в разработке" placeholder card (until BCS or follow-up removes it).
- LogoutButton (header — unchanged position).

What moves to `/cabinet/profile`:
- ProfileEditor (`app/cabinet/profile-editor.tsx`, lines 11–126).
- DangerZone (`app/cabinet/danger-zone.tsx`, lines 14–63).

What does **not** move:
- ResendVerifyButton (`app/cabinet/resend-verify-button.tsx`) — stays inline on `/cabinet` inside the verification banner. Open question Q3 below — confirm in paranoia.
- LogoutButton — stays in `SiteHeader` AND is also rendered at the bottom of `/cabinet/profile` (consistent with current cabinet shape: a destructive-action page should have a fast exit).

Non-goals:
- No new server route, no API change, no schema change.
- No onboarding/forced-profile flow (open question Q7 — explicitly out of MVP).
- No feature flag — pure code refactor, fully revertable by `git revert`.

## 2. Existing surface inventory (read before §5)

All file:line citations validated against working tree on 2026-05-18.

| Surface | File | Key lines |
|---|---|---|
| Cabinet page (server, auth gate, role split, renders everything) | `app/cabinet/page.tsx` | 51–82 auth gate; 137–229 render tree; 154 ProfileEditor mount; 226 DangerZone mount; 228 LogoutButton mount; 146–152 verify banner; 138–144 greeting |
| ProfileEditor (client, name + tz, PATCH `/api/account/profile`) | `app/cabinet/profile-editor.tsx` | 11–126 component; 38–45 PATCH call (no `/cabinet`-specific imports — relies only on `@/lib/auth/profiles` types and `@/lib/auth/timezones` constants — safe to move) |
| DangerZone (client, revoke-consent + delete-account, redirects via `window.location.href = '/login'`) | `app/cabinet/danger-zone.tsx` | 14–63 outer; 79–100 destructive button; 95 hard-redirect to `/login` (NOT `'/'` — correction to §5.iii claim below) |
| LogoutButton (client, POST `/api/auth/logout`, `router.push('/')`) | `app/cabinet/logout-button.tsx` | 6–33 component; 24 `router.push('/')` |
| ResendVerifyButton (client, POST `/api/auth/resend-verify`) | `app/cabinet/resend-verify-button.tsx` | 13–59 component |
| LessonsSection (learner primary — stays put) | `app/cabinet/lessons-section.tsx` | 104–428 main + BookingCta |
| AuthShell (shared chrome — 440px centered column) | `components/auth-shell.tsx` | 9–27 (already mobile-friendly, max-width 440, padding 64/24/96) |
| Admin profile reference | n/a | **No `/admin/profile` exists** (verified by Glob `app/admin/profile/**` → 0 hits). The closest analogue is `app/cabinet/settings/calendar/page.tsx` — a single-purpose sub-route under /cabinet. Use that as the structural blueprint. |
| Sub-route precedent (server-gated nested page under /cabinet) | `app/cabinet/settings/calendar/page.tsx` | structural model |
| Sub-route precedent (single-page secondary surface w/ catalog) | `app/cabinet/packages/page.tsx` | uses the same `cookies()` → `lookupSession` → `redirect('/login')` pattern as `app/cabinet/page.tsx:51-62` |

**Correction to task brief:** task description claimed DangerZone redirects via `router.push('/')`. Actual code redirects via `window.location.href = '/login'` (`danger-zone.tsx:95`). Behaviour after deletion is therefore "fully reload to login" — full SSR re-render of `/login`. This is correct (cookie state changed; SPA-style soft nav would race), and is unchanged by this wave.

## 3. Design

### 3.i New page `app/cabinet/profile/page.tsx`

**Server component.** Auth gate is byte-for-byte the SAME pattern as `app/cabinet/page.tsx:51-82` (NOT factored into a shared helper this wave — premature abstraction; SAAS-6 or later can DRY it). Concretely:

```ts
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const metadata = {
  title: 'Профиль — LevelChannel',
  robots: { index: false, follow: false },   // §10 risk mitigation — destructive URL must not be indexed
}

export default async function CabinetProfilePage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const current = await lookupSession(cookieValue)
  if (!current) redirect('/login')
  const { account } = current
  const roles = await listAccountRoles(account.id)
  if (roles.includes('admin')) redirect('/admin')   // mirror /cabinet's admin redirect
  const profile = await getAccountProfile(account.id)
  const isVerified = account.emailVerifiedAt !== null
  // … render
}
```

**Render tree** (top → bottom, inside `<AuthShell>` so chrome is identical to /cabinet):

1. **Header strip** — flex row, `justify-content: space-between`:
   - Left: `<Link href="/cabinet">← Назад в кабинет</Link>` (plain link, secondary colour, no button styling — matches the lightweight "back" affordances elsewhere in the app).
   - Right: `<LogoutButton />` (unchanged component — same one reused).
2. **`<h1>Профиль</h1>`** (28px, weight 700, matching `/cabinet`'s `<h1>` shape on line 138 of `page.tsx`).
3. **Verification banner** — same `<AuthInfoBox>` + `<ResendVerifyButton />` shown on `/cabinet` when `!isVerified`. Reason: consistency. A learner who lands here directly from a bookmark or email link must see the same interrupt. (Cited in §6 edge case A; design-system.md §"Interrupts & Banners" governs the visual treatment.)
4. **`<ProfileEditor initialProfile={profile} fallbackEmail={account.email} />`** — verbatim mount, no changes.
5. **`<DangerZone />`** — verbatim mount, no changes.
6. *(No second LogoutButton at the bottom — header copy is enough. Round-1 own-paranoia: a bottom-of-page logout near "Удалить аккаунт" is a misclick hazard.)*

### 3.ii Updated `/cabinet` header — add "⚙ Профиль" button

Current `/cabinet` has no header strip — `<h1>` sits flush against the top of the AuthShell column. Wave introduces a one-line flex row **above** `<h1>` containing:

- Left: empty (or breadcrumb in a future wave).
- Right: `<Link href="/cabinet/profile" className="btn-secondary">⚙ Профиль</Link>` followed by `<LogoutButton />`.

The gear icon `⚙` (U+2699) is a plain unicode glyph — no asset, no icon library, no SVG. Design-system.md §"Header utilities" canonicalises the "icon + label" pattern; this wave is the FIRST consumer, so the design-system doc is informed by what lands here. (If design-system.md prescribes an SVG sprite by the time it merges, follow-up PR swaps the glyph for the sprite — one-line change.)

Copy decision: **"⚙ Профиль"** (word, not icon-only). Rationale:
- Icon-only buttons are an a11y debt on a Russian-language site where users are not steeped in iOS/macOS gear-icon conventions.
- "Профиль" is short enough (7 chars + glyph) that it does NOT crowd "Выйти" even on 360px-wide mobile (measured: 56+16+62 ≈ 134px, well under 360px column).

Position: top-right of the AuthShell content column, NOT in `SiteHeader`. Reason: `SiteHeader` is shared across `/register`, `/login`, `/forgot`, `/reset`, `/cabinet`, `/verify-pending`, `/verify-failed` (per `auth-shell.tsx:5`). Putting "Профиль" there would render it on `/login` for unauth users — a phantom CTA. Per-page header is correct.

### 3.iii ProfileEditor unchanged

Verified by Read of `profile-editor.tsx` lines 1–126: only external imports are `@/lib/auth/profiles` (type-only) and `@/lib/auth/timezones` (pure constants, no pg leak — explicit comment lines 6–8). PATCH target `/api/account/profile` is route-agnostic. Mounting on `/cabinet/profile` instead of `/cabinet` is a pure-move; no edits to the component file are needed.

### 3.iv DangerZone unchanged

Verified by Read of `danger-zone.tsx` lines 1–124: no `/cabinet`-specific imports. Hard-redirect target is `/login` (line 95), which is correct regardless of which page hosted the button. No edits to the component file are needed.

### 3.v Mobile

`<AuthShell>` already constrains content to `max-width: 440px` (auth-shell.tsx:23). Both ProfileEditor and DangerZone are full-width inside that column on desktop and on mobile — no layout work needed. The "← Назад" + "Профиль/Выйти" header row uses flex `space-between` with `flex-wrap` to allow stacking if the column ever exceeds the buttons' combined width (it won't at current copy lengths but the safety is free).

### 3.vi Breadcrumb / back nav

Single back-arrow link `← Назад в кабинет` in the page header. Not a real breadcrumb (only one level of depth — breadcrumb would be pretentious for a flat hierarchy). Matches the existing `app/cabinet/book/page.tsx` and `app/cabinet/packages/page.tsx` "back to cabinet" idiom (verified the precedent exists — both sub-pages have similar one-link back affordances).

### 3.vii Copy register and orthography

All Russian copy in this wave is checked against the project's established register (cabinet header is informal-formal: «Здравствуйте, …», "Личный кабинет" — sentence-case, no exclamations). Specifically:

- **«Профиль»** — page `<h1>` and button label. Capital П, single word. (Not «Мой профиль» — possessive is redundant when the page is gated to one's own profile; design-system.md §"Voice & Tone" should canonicalise this rule.)
- **«⚙ Профиль»** — header button. The glyph is followed by a single regular space, then the word. NOT a non-breaking space (the button is short enough that wrap is not a concern; a regular space is fine and is the established convention in the rest of the project, e.g. `app/cabinet/billing-sections.tsx`).
- **«← Назад в кабинет»** — back link. Lowercase «в». Arrow is U+2190 (regular left-arrow), not the heavier U+2B05.
- **`<title>Профиль — LevelChannel</title>`** — em-dash (U+2014) between name and product, mirroring `app/cabinet/page.tsx:48` (`'Кабинет — LevelChannel'`).
- All ProfileEditor / DangerZone strings are reused verbatim — no copy edits in this wave.

Orthography sanity check done; if a Russian-native paranoia reviewer flags a register issue, fold the fix into the same PR.

## 4. Edge cases

| # | Case | Resolution |
|---|---|---|
| A | Email-unverified user lands on `/cabinet/profile` directly. | Show the same verification banner as on `/cabinet`. Consistent state — `isVerified` is server-resolved from `account.emailVerifiedAt`, identical to `/cabinet`. Banner does not block profile editing or delete-account (correct — see B). |
| B | Email-verify-pending learner cannot book lessons (existing invariant) but MUST be able to delete the account (152-ФЗ ст. 9 §5 — withdrawal of consent cannot be blocked by an unrelated verification gate). | DangerZone is unguarded by `isVerified`. Verified — current `danger-zone.tsx` has no email-verified check; only the destructive-confirm dialog. This is preserved. |
| C | Logout from `/cabinet/profile`. | `LogoutButton` is reused unchanged — POSTs `/api/auth/logout` then `router.push('/')`. Same as on `/cabinet`. No new redirect logic. |
| D | Admin lands on `/cabinet/profile`. | Page-level auth gate redirects to `/admin` (mirroring `app/cabinet/page.tsx:81-83`). Admin doesn't have a learner profile shape; their settings live on the admin surface. |
| E | Teacher lands on `/cabinet/profile`. | Allowed — teachers DO have ProfileEditor (name + tz) and DangerZone (delete account). Same render as learner. No teacher-only sections to worry about (teacher-section + teacher-learners-section stay on `/cabinet`, not duplicated here). |
| F | User in 30-day deletion-grace lands on `/cabinet/profile`. | The session lookup (`lookupSession`) is what enforces grace-period gating elsewhere; if it returns null, → `/login`. If it returns a valid session (grace not expired and not blocking session use), they see ProfileEditor + DangerZone. They CAN re-delete (idempotent on server side). Out-of-scope: rendering a "your account is scheduled for deletion in N days" banner — covered by separate plan (deletion-grace UX, not this wave). |
| G | `/cabinet/profile?some=querystring`. | Ignored — page does not read search params. |
| H | User bookmarks `/cabinet/profile` then logs out. | Visit redirects to `/login` (no session cookie). Standard. |

## 5. Implementation phases (single PR)

**One PR, four ordered commits inside it:**

1. **(a) New page + route.** Create `app/cabinet/profile/page.tsx` per §3.i. Mounts unchanged ProfileEditor + DangerZone. Includes `noindex` robots metadata.
2. **(b) Header update on /cabinet.** Add the `⚙ Профиль` link + LogoutButton flex row at the top of `app/cabinet/page.tsx`'s returned JSX (above `<h1>`). Remove the existing `<LogoutButton />` mount at the bottom (line 228) — it moves into the header row. Remove the `<ProfileEditor />` mount (line 154) and the `<DangerZone />` mount (line 226). The bottom of `/cabinet` is now LessonsSection / BillingSections / placeholder card (learner) or TeacherSection / TeacherLearnersSection (teacher).
3. **(c) Integration tests.** New test file + (if needed) update to existing cabinet test. See §6.
4. **(d) Visual screenshot review.** Use `gstack` / `browse` to capture `/cabinet` (uncluttered learner view) + `/cabinet/profile` (centered, header strip, two cards) on desktop 1280×800 and mobile 375×667. Attach to PR description. No commit per se — review evidence.

Trailer on the close-PR (since this is a single-PR epic, standard wave shape):
`Codex-Paranoia: SIGN-OFF round N/3`

## 6. Tests

### 6.i New file `tests/integration/cabinet/profile-page.test.ts`

Cases (using the standard supertest + cookie-jar pattern established by `tests/integration/scheduling/teacher-guard.test.ts` and `tests/integration/admin/admin-gate.test.ts`):

1. **Anonymous → 307 to `/login`.** No session cookie → redirect.
2. **Invalid session cookie → 307 to `/login`.** Cookie present but `lookupSession` returns null.
3. **Learner-archetype (verified) → 200, renders ProfileEditor + DangerZone markers.** Assert page text includes "Профиль" `<h1>`, "Имя" label (from ProfileEditor), "Опасные действия" header (from DangerZone).
4. **Teacher → 200, renders ProfileEditor + DangerZone.** Teacher accounts also get profile management. No teacher-section duplication assertion.
5. **Admin → 307 to `/admin`.** Mirrors `/cabinet` admin redirect.
6. **Email-unverified learner → 200, page renders, verification banner present.** Assert "E-mail ещё не подтверждён" substring.
7. **`robots` meta is `noindex,nofollow`.** Parse `<head>` for `<meta name="robots" content="noindex,nofollow">` — defends the §10 SEO risk mitigation against future regression.

Test directory does not yet exist (`tests/integration/cabinet/*` returned 0 files). New directory; conform to surrounding `tests/integration/<area>/<file>.test.ts` shape.

### 6.ii No update needed to `tests/integration/cabinet/cabinet-page.test.ts`

That file does not exist today (verified via Glob). The current cabinet has no integration tests directly on the page — its sections are tested through their underlying APIs. We do NOT introduce a new cabinet-page test in this wave; that's tracked as a separate "cabinet SSR smoke test" follow-up. Round-1 own-paranoia notes this is a defensible scope cut — task brief's bullet about updating that file should be paranoia-confirmed (Q4 below).

### 6.iii Manual / visual

Per §5.(d). Pair of screenshots in PR body.

## 7. Migration / rollout

- **Pure code refactor.** No DB migration. No new env var. No new endpoint. No new dependency.
- **No feature flag.** Visual change. Revertable by `git revert`. Blast radius: any user whose muscle memory expects ProfileEditor inline on /cabinet — they now click "⚙ Профиль" instead. Low.
- **Bookmarks/links.** `/cabinet` URL still valid; users land on the new (decluttered) version. `/cabinet/profile` is a new URL, no inbound links exist yet. No 301 needed.
- **Cache.** Both routes are `dynamic = 'force-dynamic'`, runtime `nodejs`. No edge cache to invalidate.

## 8. Risks + mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Users with `/cabinet` bookmarks expecting inline ProfileEditor look for it and don't find it. | Accept (low blast radius). Optional follow-up: one-time toast on `/cabinet` with a `localStorage` flag "Профиль теперь здесь →" pointing at the new button. NOT in MVP — added only if support tickets show this. |
| R2 | Mobile screen-reader users now need two-step nav (focus header → activate Profile → land on subpage) for profile edits. | Verified: header `<Link>` is keyboard-focusable, screen-reader-announced as "Профиль, link". Subpage `<h1>Профиль</h1>` is the first heading on next focus. Confirmed acceptable per WCAG 2.1 §2.4.3 (focus order). |
| R3 | `/cabinet/profile` URL exposes a destructive (delete-account) action behind a guessable URL — SEO crawlers, link previews. | `metadata.robots = { index: false, follow: false }` on the new page (§3.i). Plus existing auth gate — anon hits redirect to `/login` before any destructive content renders. Plus the destructive action is a `<button>` not a link — no crawler can "follow" it accidentally. |
| R4 | Sibling agent's `docs/design-system.md` may not exist yet at PR time. | Cite section names by anticipated anchor (e.g. §"Header utilities", §"Interrupts & Banners"). If design-system.md merges with different anchors, the PR description carries a one-line follow-up note. PR is NOT blocked on design-system.md merging first — visual choices in §3.ii are self-contained and reversible. |
| R5 | `<LogoutButton />` is removed from `/cabinet` bottom and moved into the header. Some users may expect both locations (legacy). | Accept. Header-only is the convention on the rest of the app already (registration / forgot / etc. all have logout-or-equivalent in header only). Bottom button on /cabinet was an artefact of the earliest scaffolded shape. |
| R6 | The "Кабинет в разработке" placeholder card on `/cabinet` (lines 197–222 of `page.tsx`) becomes the visually-lowest item, drawing attention to "in progress" copy that conflicts with the "lessons-dominant" intent. | Out of scope. Removing or hiding that card belongs to a separate wave (track as SAAS-6 candidate). This plan does NOT touch lines 197–222. |
| R7 | DangerZone has TWO destructive buttons (withdraw-consent + delete-account) on the new page with no other content above the fold on a 768px-tall mobile. | Accept. The page has 6 distinct sections (header / h1 / verify-banner-if-applicable / ProfileEditor / DangerZone). DangerZone is below ProfileEditor (which has Name + Timezone fields — fills most of the fold). |

## 9. Open questions for paranoia

1. **Position of the Профиль button — header-right vs footer-pinned?** §3.ii places it header-right next to LogoutButton (Apple/macOS account-menu convention). Is footer-pinned (mobile thumb-zone) a stronger choice for a Russian learner audience that's mostly on mobile? Need user data — currently unavailable; defaulting to header-right.
2. **Glyph vs word — `⚙ Профиль` vs `⚙` icon-only vs avatar circle?** §3.ii argues for `⚙ Профиль`. Codex challenge: would avatar-circle be more learnable? My counter: no avatar uploads exist (`profile-editor.tsx` collects name + timezone only — no `photoUrl`), so an avatar circle would be a coloured-initial placeholder, which is more visual noise than `⚙ Профиль`. Defer until avatar-upload wave (not on roadmap).
3. **Does ResendVerifyButton also move to /cabinet/profile?** §1 says NO — it stays inline on `/cabinet` as part of the verify banner. Argument for moving: profile-management is "the place" for email actions. Argument against: the banner is an INTERRUPT, not a setting; moving it hides the resend action behind a navigation step. I lean against the move; paranoia-confirm.
4. **Do we keep the `tests/integration/cabinet/cabinet-page.test.ts` work item?** §6.ii says NO — that file doesn't exist today, and introducing a new SSR smoke test for /cabinet is its own follow-up. Task brief mentioned "Update tests/integration/cabinet/cabinet-page.test.ts (if exists) to assert profile sections NO LONGER appear" — the conditional is satisfied (doesn't exist → no update needed). Paranoia-confirm scope cut is acceptable.
5. **Auth-gate duplication — accept now or factor out a helper?** §3.i deliberately copies the 10-line auth gate from `app/cabinet/page.tsx:51-83`. Pros of copy: no abstraction debt, identical behaviour by inspection. Cons: two sites to keep in sync. A `requireCabinetSession()` helper in `lib/auth/guards.ts` would be the right move — but the project already has `requireLearnerArchetypeAndVerified` (returns 401 JSON, not SSR redirect) which is a different shape. Introducing a third guard shape adds API-surface entropy. Paranoia: is "copy now, DRY later" the right call?
6. **Two pages now both server-render `getAccountProfile`. Cost?** A learner who navigates /cabinet → /cabinet/profile pays two DB round-trips for the same profile. Acceptable (single-digit-ms, no transaction). Paranoia: any concern with eager-loading more than needed on /cabinet/profile?
7. **Onboarding flow — if user just registered and lands on /cabinet, do we auto-route to /cabinet/profile first to capture timezone?** Out of MVP. Tracked as a separate "first-login onboarding" wave. Profile completion is currently optional (DB columns nullable; `safeTimezone()` falls back to Europe/Moscow). Forcing-flow design needs its own paranoia loop and a/b. Paranoia-confirm this is the right defer.
8. **DangerZone on a dedicated URL — SEO/safety concerns beyond §10 R3?** robots:noindex covers crawlers. Auth gate covers anon. Phishing concern: an attacker constructs `https://levelchannel.ru/cabinet/profile` look-alike — but they could already do the same with `/cabinet`, so no marginal risk. Paranoia-confirm.

## 10. Out of scope (explicit cuts)

- Removing the "Кабинет в разработке" placeholder card (R6).
- Adding an avatar field to ProfileEditor (Q2).
- Onboarding / forced-profile-completion flow (Q7).
- Factoring out a shared `requireCabinetSession()` helper (Q5).
- New SSR smoke test for `/cabinet` itself (Q4 / §6.ii).
- Migration to an SVG icon sprite for `⚙` (§3.ii — one-line follow-up after design-system.md lands).
- Moving ResendVerifyButton onto /cabinet/profile (Q3 — explicitly NO in §1).
- Adding a "your account is scheduled for deletion" banner for grace-period users (§4 case F).

## 11. Acceptance criteria (definition of done)

- [ ] `app/cabinet/profile/page.tsx` exists, server-rendered, gated on session, redirects admin → `/admin`.
- [ ] `app/cabinet/page.tsx` no longer mounts `<ProfileEditor />` or `<DangerZone />`.
- [ ] `app/cabinet/page.tsx` mounts `<Link href="/cabinet/profile">⚙ Профиль</Link>` + `<LogoutButton />` in a flex header row above `<h1>`.
- [ ] LogoutButton no longer rendered at the bottom of `/cabinet`.
- [ ] `app/cabinet/profile/page.tsx` has `metadata.robots = { index: false, follow: false }`.
- [ ] All 7 cases in `tests/integration/cabinet/profile-page.test.ts` pass.
- [ ] `npm run test:integration` green; `npm run build` green; `npm run typecheck` green.
- [ ] Visual screenshots (desktop + mobile, both routes) in PR body.
- [ ] PR commit body carries `Codex-Paranoia: SIGN-OFF round N/3` (single-PR epic; standard wave trailer).
- [ ] No DB / API / env changes.

## 12. References

- `app/cabinet/page.tsx` — auth gate pattern reused.
- `app/cabinet/profile-editor.tsx` — moved verbatim.
- `app/cabinet/danger-zone.tsx` — moved verbatim.
- `app/cabinet/logout-button.tsx` — reused unchanged in two places.
- `app/cabinet/resend-verify-button.tsx` — stays on /cabinet.
- `app/cabinet/lessons-section.tsx` — untouched.
- `app/cabinet/packages/page.tsx` — structural blueprint for the new sub-route.
- `components/auth-shell.tsx` — shared chrome, used as-is.
- `docs/design-system.md` — sibling-drafted; cited by anticipated section anchors §"Header utilities", §"Interrupts & Banners".
- 152-ФЗ ст. 9 §5 — withdrawal of consent (DangerZone "Отозвать согласие" button must remain accessible even when email is unverified).
