# SAAS-5 — Cabinet "Профиль" button + dedicated /cabinet/profile page

**Status:** SHIPPED 2026-05-18 — PR #287 merged (3 rounds of `/codex-paranoia plan` completed; user accepted option (a) ship-as-is on 4 doc-prose BLOCKERs; escalation report at `/tmp/codex-paranoia-20260518T034727Z-final.md`).
**Wave name:** `cabinet-profile-button`
**Trigger:** Product-owner request 2026-05-18 — declutter the main /cabinet surface so lessons dominate. Move ProfileEditor + DangerZone behind a header button to a dedicated sub-route.
**Predecessor:** none (pure UI refactor; no DB / no API change).
**Companion:** `docs/design-system.md` (sibling agent drafting in parallel — citations below assume final section anchors).

## 1. Goal

Move two currently-inline cabinet sections — **ProfileEditor** (name + timezone) and **DangerZone** (revoke consent, delete account) — off `/cabinet` and onto a dedicated **`/cabinet/profile`** sub-route. Add a single **"Профиль"** affordance to the `/cabinet` header (top-right, next to "Выйти") that links to the new page.

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

### 3.ii Updated `/cabinet` header — add "Профиль" button

Current `/cabinet` has no header strip — `<h1>` sits flush against the top of the AuthShell column. Wave introduces a one-line flex row **above** `<h1>` containing:

- Left: empty (or breadcrumb in a future wave).
- Right: `<Link href="/cabinet/profile">Профиль</Link>` followed by `<LogoutButton />`.

Copy decision (round-1 paranoia revision 2026-05-18): **"Профиль"** as plain word, no glyph. Original draft used "Профиль" with a unicode gear; round-1 paranoia BLOCKER#4 surfaced two collisions:

1. `docs/content-style.md` bans decorative emoji in product chrome (the gear codepoint is on the unicode-emoji presentation track).
2. `docs/design-system.md` explicitly defers iconography library choice (lucide-react vs SF-Symbols-style set) to the primitives wave. Picking an inline glyph here pre-commits a contract the foundation has not ratified.

Pure word resolves both. When the design-system iconography decision lands (foundation §"Iconography" — open question A.2), a follow-up PR swaps the text node for an `<Icon name="settings"/>` primitive without changing the link itself.

**Styling — round-1 revision.** Original draft used `className="btn-secondary"`. Codex BLOCKER#3 (round 1) caught two problems: (a) `.btn-secondary` forces `width: 100%` at `<=640px` viewport (`app/globals.css:229`), which would stack the header buttons full-width on mobile — destroying the compact top-right flex row, (b) design-system.md §"Migration baseline" classes `.btn-secondary` as marketing-only; SaaS chrome must not consume it. Revised approach: use inline styles or a `style={{}}` prop with tokens drawn from design-system §"Color" + §"Spacing" + §"Radii" (e.g. `padding: 6px 14px; border-radius: 8px; background: var(--surface-2); color: var(--text-primary); font-size: 15px;`). The same inline-style approach goes on `<LogoutButton />`'s wrapper — verify by editing `logout-button.tsx:34` to drop `className="btn-secondary"` IF the link is rendered without sibling marketing chrome breaking. Either way, the SaaS header buttons in this wave do not consume `.btn-secondary`.

When the `lib/ui/primitives/Button.tsx` primitive lands (SAAS-6 wave 1), follow-up PR swaps the inline-style anchor for `<Button as="a" variant="secondary" size="sm" href="/cabinet/profile">Профиль</Button>` — one-line change.

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
- **«Профиль»** — header button label, single word. (Original draft had a leading gear glyph `⚙ Профиль`; round-1 BLOCKER#4 caught the collision with `docs/content-style.md` emoji ban + design-system iconography-deferred. Round-3 cleanup: every reference to the gear glyph in this plan has been removed; the icon-vs-word decision returns when `lib/ui/primitives/Icon.tsx` ships in SAAS-6.)
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
| F | User in 30-day deletion-grace lands on `/cabinet/profile`. | Round-1 paranoia INFO#7 correction: `lookupSession()` does NOT filter on `scheduled_purge_at` / `purged_at` (it only filters revoked/expired/disabled sessions per `lib/auth/sessions.ts:66`). The actual gate is `app/api/account/delete/route.ts:85` which sets `disabled_at` AND revokes all sessions when the user requests deletion — so a grace-period user trying to use a session that pre-dates their delete-request will get `lookupSession` → null → `/login`. A grace-period user who did NOT yet delete but somehow holds a valid session WILL see ProfileEditor + DangerZone; they can re-delete (idempotent). Out-of-scope: rendering a "scheduled for deletion in N days" banner — covered by separate plan (deletion-grace UX, not this wave). |
| G | `/cabinet/profile?some=querystring`. | Ignored — page does not read search params. |
| H | User bookmarks `/cabinet/profile` then logs out. | Visit redirects to `/login` (no session cookie). Standard. |

## 5. Implementation phases (single PR)

**One PR, five ordered commits inside it (round-1 revision adds the doc-sweep step):**

1. **(a) New page + route.** Create `app/cabinet/profile/page.tsx` per §3.i. Mounts unchanged ProfileEditor + DangerZone. Includes `noindex` robots metadata.
2. **(b) Header update on /cabinet.** Add the `Профиль` link + LogoutButton flex row at the top of `app/cabinet/page.tsx`'s returned JSX (above `<h1>`). Remove the existing `<LogoutButton />` mount at the bottom (line 228) — it moves into the header row. Remove the `<ProfileEditor />` mount (line 154) and the `<DangerZone />` mount (line 226). The bottom of `/cabinet` is now LessonsSection / BillingSections / placeholder card (learner) or TeacherSection / TeacherLearnersSection (teacher).
3. **(c) Doc sweep — required.** Round-1 paranoia WARN#5: `ARCHITECTURE.md` currently lists `<ProfileEditor>` + `<DangerZone>` as `/cabinet`-rendered subtree (lines 43, 46 — verify line numbers at impl). Update those entries to point at `/cabinet/profile`. Add a one-line entry for the new `app/cabinet/profile/page.tsx` route. `DOCUMENTATION.md` §"Code and architecture" needs no change (it points at ARCHITECTURE.md by topic, not file). Cabinet-relevant section in `lib/auth/README.md` and `lib/scheduling/README.md` does not mention `/cabinet/profile`; no edit needed there.
4. **(d) Unit tests (see §6).** Two new files; both go to `tests/scheduling/` (NOT `tests/integration/cabinet/`).
5. **(e) Visual screenshot review.** Use `gstack` / `browse` to capture `/cabinet` (uncluttered learner view) + `/cabinet/profile` (centered, header strip, two cards) on desktop 1280×800 and mobile 375×667. Attach to PR description. No commit per se — review evidence.

Trailer on the close-PR (since this is a single-PR epic, standard wave shape):
`Codex-Paranoia: SIGN-OFF round N/3`

## 6. Tests

**Round-1 paranoia revision 2026-05-18:** original draft cited `tests/integration/scheduling/teacher-guard.test.ts` + `admin-gate.test.ts` as precedent for "supertest + cookie-jar against SSR pages". Codex BLOCKER#1 caught the mismatch — the integration runner calls route handlers directly via `vitest.integration.config.ts` (no Next.js HTTP server, no App Router page rendering). The cited tests probe API routes, not pages. Page-level SSR assertions need a different shape. Below is the revised test plan.

### 6.i Unit-level invocation of the page Server Component

**File:** `tests/scheduling/cabinet-profile-page.test.ts` (under the `vitest.config.ts` unit suite, NOT the integration suite — because we're calling the page as an async function, not hitting an HTTP server).

Strategy: import `CabinetProfilePage` from `app/cabinet/profile/page.tsx` as an async function, mock its three external deps (`cookies` from `next/headers`, `lookupSession` from `lib/auth/sessions`, `listAccountRoles` from `lib/auth/accounts`, `getAccountProfile` from `lib/auth/profiles`), invoke it, and assert on the returned JSX tree using `@testing-library/react`'s `render` + `screen` queries (or the lighter `react-dom/server.renderToStaticMarkup` if the page returns no client islands at the top level — verify when the file lands).

Cases:

1. **No session cookie → throws `redirect('/login')`.** Mock `cookies()` to return empty store; assert the page invocation rejects with the Next.js redirect throwable.
2. **Invalid session → throws `redirect('/login')`.** Mock `lookupSession` to return null.
3. **Admin role → throws `redirect('/admin')`.** Mock `listAccountRoles` to return `['admin']`.
4. **Learner-archetype (verified) → renders ProfileEditor + DangerZone.** Mock returns a learner; assert rendered markup contains "Имя", "Часовой пояс", "Опасные действия" substrings. (Use `renderToStaticMarkup` for a string snapshot or `render` + `screen.getByText`.)
5. **Teacher role → renders ProfileEditor + DangerZone.** Same assertions; no teacher-only sections.
6. **Email-unverified learner → renders verification banner + still renders ProfileEditor / DangerZone.** Assert substring "E-mail ещё не подтверждён".
7. **`generateMetadata` returns `robots: { index: false, follow: false }`.** Direct call to the page's metadata export.

If the testing-library import is not yet in `package.json`, add `@testing-library/react` + `@testing-library/jest-dom` (devDeps) in the same PR.

### 6.ii Negative test — `/cabinet` no longer renders profile editor / danger zone

**Round-1 paranoia BLOCKER#2:** the original plan had no automated guard against "developer adds /cabinet/profile but forgets to remove ProfileEditor from /cabinet". Adding it now.

**File:** `tests/scheduling/cabinet-main-page.test.ts` (companion to 6.i).

Strategy: import `CabinetPage` from `app/cabinet/page.tsx` as an async function, mock external deps to a learner-archetype-verified state, invoke + render. Assertions:

1. **Renders LessonsSection** — assert substring "Мои занятия" or whatever lessons-section's header text is (verify at impl).
2. **Does NOT render ProfileEditor.** Assert "Часовой пояс" substring is ABSENT (timezone label is unique to ProfileEditor and not used elsewhere in /cabinet's tree).
3. **Does NOT render DangerZone.** Assert "Опасные действия" substring is ABSENT.
4. **Renders the new header strip with "Профиль" link → `/cabinet/profile`.** Assert presence of `<a href="/cabinet/profile">` in the markup.

This is the silent-green-on-the-wrong-path defence — if a future refactor accidentally re-introduces ProfileEditor on /cabinet, this test fails.

### 6.iii Manual / visual

Per §5.(e). Pair of screenshots in PR body — `/cabinet` (uncluttered) and `/cabinet/profile` (two cards + header strip), at desktop 1280×800 and mobile 375×667.

### 6.iv Accessibility follow-up (out of scope, documented)

Round-1 paranoia WARN#6 surfaced that the project's `auth-shell.tsx` and `site-header.tsx` do NOT yet have a skip-to-content link, which `docs/design-system.md` §"Accessibility" mandates. Adding a skip-link is design-system foundation work, not part of this single-PR wave. Captured as `SAAS-6-A11Y-1: add skip-to-content link to AuthShell + SiteHeader` in `ENGINEERING_BACKLOG.md` for SAAS-6 design-system rollout. This wave does not regress a11y (the new page inherits the same shell), but it doesn't fix the pre-existing gap either.

## 7. Migration / rollout

- **Pure code refactor.** No DB migration. No new env var. No new endpoint. No new dependency.
- **No feature flag.** Visual change. Revertable by `git revert`. Blast radius: any user whose muscle memory expects ProfileEditor inline on /cabinet — they now click "Профиль" instead. Low.
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
2. **Word vs icon vs avatar circle?** §3.ii argues for plain word `Профиль`. Round-1 paranoia BLOCKER#4 resolved this: emoji glyphs are banned in product chrome by `docs/content-style.md`, and design-system iconography (lucide-react vs custom set) is deferred to `lib/ui/primitives/Icon.tsx`. Plain word is the safe choice; an `<Icon name="settings"/>` swap is a one-line follow-up after SAAS-6 primitives land. Avatar-circle is deferred until avatar-upload wave (not on roadmap).
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
- Migration from plain word `Профиль` to `<Icon name="settings"/>` after `lib/ui/primitives/Icon.tsx` ships in SAAS-6 (one-line follow-up).
- Moving ResendVerifyButton onto /cabinet/profile (Q3 — explicitly NO in §1).
- Adding a "your account is scheduled for deletion" banner for grace-period users (§4 case F).

## 11. Acceptance criteria (definition of done)

**Round-2 paranoia revision 2026-05-18:** test paths updated to the unit-suite location matching §6 pivot (round-1 BLOCKER#1). Negative test is now mandatory (round-2 BLOCKER#2).

- [ ] `app/cabinet/profile/page.tsx` exists, server-rendered, gated on session, redirects admin → `/admin`.
- [ ] `app/cabinet/page.tsx` no longer mounts `<ProfileEditor />` or `<DangerZone />`.
- [ ] `app/cabinet/page.tsx` mounts `<Link href="/cabinet/profile">Профиль</Link>` + `<LogoutButton />` in a flex header row above `<h1>`.
- [ ] LogoutButton no longer rendered at the bottom of `/cabinet`.
- [ ] `app/cabinet/profile/page.tsx` has `metadata.robots = { index: false, follow: false }`.
- [ ] All 7 cases in `tests/scheduling/cabinet-profile-page.test.ts` (unit suite, NOT integration — round-1 BLOCKER#1) pass.
- [ ] All 4 cases in `tests/scheduling/cabinet-main-page.test.ts` (round-2 BLOCKER#2 negative-assertion test) pass — including assertions that "Часовой пояс" and "Опасные действия" substrings are ABSENT from /cabinet markup.
- [ ] `ARCHITECTURE.md` cabinet section updated to point at `/cabinet/profile` for ProfileEditor + DangerZone (round-1 WARN#5).
- [ ] `ENGINEERING_BACKLOG.md` carries the `SAAS-6-A11Y-1` follow-up entry (round-1 WARN#6 — already added in scoping-wave PR #286).
- [ ] **Test-tooling deps** (`@testing-library/react` + `jsdom` if required by Server Component invocation pattern, OR `react-dom/server.renderToStaticMarkup` if string-snapshot approach is sufficient — verify at implementation) added to `package.json` devDeps as part of this PR. If RTL/jsdom path chosen, `vitest.config.ts` (NOT `vitest.integration.config.ts`) gains `environment: 'jsdom'` for cabinet test files only via vitest's per-file environment comment. Defer to `SAAS-INFRA-1` IF the lift is too large; in that case the page-component test is dropped from this wave and the negative-assertion test on /cabinet runs without Server-Component import (assert by reading source-file imports + grep-style assertions; less robust but unblocks the wave).
- [ ] `npm run test:unit` (or whatever the unit-suite script is named) green; `npm run build` green; `npm run typecheck` green. Integration suite (`npm run test:integration`) stays green but contains no NEW assertions for this wave.
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
