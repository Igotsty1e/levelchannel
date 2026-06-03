# URL / Redirect Contract

> Compact route × role × redirect table. AI agents and humans must not break this.
> Companion file: [`PRODUCT_FLOWS.md`](PRODUCT_FLOWS.md) — flow-oriented coverage registry.

**Audit cadence:** review on every plan-doc that touches `lib/auth/`, layouts,
SSR `redirect()` calls, middleware (`proxy.ts`), or route-level navigation.

## Format

`route` × `role` table. Cells encode:

- **Expected behavior** — render | redirect → `<target>`
- **Allowed redirects** — alternative targets allowed by SSR ladder
- **Forbidden redirects** — known-wrong destinations
- **Source of truth** — file:line where the gate lives

## Table 1 — public routes (anon-safe)

| Route | anon | learner | teacher (verified) | admin | Source of truth |
|---|---|---|---|---|---|
| `/` | render | render | render | render | `app/page.tsx` (no auth check; landing) |
| `/offer` | render | render | render | render | `app/offer/page.tsx` |
| `/privacy` | render | render | render | render | `app/privacy/page.tsx` |
| `/saas/offer` | render | render | render | render | `app/saas/offer/page.tsx` |
| `/login` | render | render¹ | render¹ | render¹ | `app/login/page.tsx` |
| `/register` | render | render¹ | render¹ | render¹ | `app/register/page.tsx` |
| `/forgot` | render | render | render | render | `app/forgot/page.tsx` |
| `/pay` | render | render | render | render | `app/pay/page.tsx` (external widget) |
| `/thank-you` | render | render | render | render | `app/thank-you/page.tsx` |
| `/admin/login` | render | render¹ | render¹ | render | `app/admin/login/page.tsx` — no gate; visiting while admin-authenticated does not redirect away |

¹ Authenticated user visiting `/login` / `/register` is not forcibly redirected
to their cabinet today. The page renders normally. If you change that, document
it here first.

### Forbidden redirects (public routes)

| Route | Forbidden destinations | Why |
|---|---|---|
| `/` | `/cabinet`, `/login`, `/saas`, `/teacher` | Landing must remain public (regression caught + fixed 2026-05-28 in `648868b`). |
| `/offer` | `/cabinet`, `/login` | Legal surface visible pre-registration. |
| `/privacy` | `/cabinet`, `/login` | Same. |
| `/admin/login` | `/login`, `/cabinet` | Dedicated operator login surface. |

## Table 2 — learner cabinet routes

| Route | anon | learner | teacher-only (no `student`) | admin | hybrid teacher+student |
|---|---|---|---|---|---|
| `/cabinet` | redirect → `/login` | render | redirect → `/teacher` | redirect → `/admin` | render learner UI |
| `/cabinet/book` | redirect → `/login` | render | redirect (inherited) | redirect → `/admin` | render |
| `/cabinet/packages` | redirect → `/login` | render | redirect (inherited) | redirect → `/admin` | render |
| `/cabinet/profile` | redirect → `/login` | render | redirect (inherited) | redirect → `/admin` | render |
| `/cabinet/settings/calendar` | redirect → `/login` | render | redirect → `/teacher/settings/calendar` | redirect → `/admin` | render |

**Source of truth:** `app/cabinet/page.tsx` (SSR redirect chain) +
`app/cabinet/settings/calendar/page.tsx` (per-page SSR redirect chain).

### Forbidden redirects (learner)

- `/cabinet` → `/teacher` for **learner** or **hybrid** role: forbidden (would
  hide learner-side surface from a teacher who is also a learner).
- `/cabinet` → `/admin/login`: forbidden (anon goes to `/login`, not admin
  surface).

## Table 3 — teacher cabinet routes

| Route | anon | unverified | learner | teacher (verified) | admin |
|---|---|---|---|---|---|
| `/teacher` | redirect → `/login` | redirect → `/cabinet` | redirect → `/cabinet` | render | redirect → `/admin/slots` |
| `/teacher/calendar` | redirect → `/login` | redirect → `/cabinet` | redirect → `/cabinet` | render | redirect → `/admin/slots` |
| `/teacher/learners` | redirect → `/login` | redirect → `/cabinet` | redirect → `/cabinet` | render | redirect → `/admin/slots` |
| `/teacher/packages` | redirect → `/login` | redirect → `/cabinet` | redirect → `/cabinet` | render | redirect → `/admin/slots` |
| `/teacher/settings/calendar` | redirect → `/login` | redirect → `/cabinet` | redirect → `/cabinet` | render | redirect → `/admin/slots` |
| `/teacher/subscription` | redirect → `/login` | redirect → `/cabinet` | redirect → `/cabinet` | render | redirect → `/admin/slots` |
| `/teacher/tariffs` | redirect → `/login` | redirect → `/cabinet` | redirect → `/cabinet` | render | redirect → `/admin/slots` |

**Source of truth:** `app/teacher/layout.tsx` (single gate for the whole tree).

### Forbidden redirects (teacher)

- `/teacher` → `/admin` (bare) for admin: forbidden, admin must land on `/admin/slots`
  (per layout).
- `/teacher` → `/teacher/calendar` for an unverified user: forbidden, must
  redirect to `/cabinet` to surface the verification banner.

## Table 4 — admin gated routes (`/admin/(gated)/*`)

| Route | anon | learner | teacher | admin |
|---|---|---|---|---|
| `/admin` | redirect → `/admin/login` | redirect → `/cabinet` | redirect → `/cabinet` | render |
| `/admin/dashboard` | redirect → `/admin/login` | redirect → `/cabinet` | redirect → `/cabinet` | render |
| `/admin/slots` | redirect → `/admin/login` | redirect → `/cabinet` | redirect → `/cabinet` | render |
| `/admin/packages` | redirect → `/admin/login` | redirect → `/cabinet` | redirect → `/cabinet` | render |
| `/admin/learners` | redirect → `/admin/login` | redirect → `/cabinet` | redirect → `/cabinet` | render |
| `/admin/teachers` | redirect → `/admin/login` | redirect → `/cabinet` | redirect → `/cabinet` | render |
| `/admin/settings/alerts` | redirect → `/admin/login` | redirect → `/cabinet` | redirect → `/cabinet` | render |
| `/admin/reconciliation` | redirect → `/admin/login` | redirect → `/cabinet` | redirect → `/cabinet` | render |
| `/admin/refunds` | redirect → `/admin/login` | redirect → `/cabinet` | redirect → `/cabinet` | render |

**Source of truth:** `app/admin/(gated)/layout.tsx`.

### Forbidden redirects (admin)

- Anon visitor lands on `/admin/login`, NEVER on `/login` (separate operator
  surface, no register / forgot links).
- Authenticated non-admin lands on `/cabinet`. Forbidden: `/login` (would log
  them out spuriously), `/admin/login` (would suggest non-admins can become
  admin).

## Ambiguity notes — resolved

### `R-AMBIG-1` — teacher-only on `/cabinet/settings/calendar` — **RESOLVED 2026-06-03**

Decision: redirect target changed from `/teacher` to `/teacher/settings/calendar`.

Rationale: the user navigated to a calendar-settings URL; routing them to the
analogous teacher-side surface (rather than the teacher dashboard root) preserves
their intent and keeps the role-scope invariant intact.

Files affected:
- `app/cabinet/settings/calendar/page.tsx` — redirect target updated.
- `evals/URL_REDIRECT_CONTRACT.md` Table 2 — row aligned.
- `evals/PRODUCT_FLOWS.md` FLOW-CABINET-CALENDAR-SETTINGS-001 — notes updated.

Not a security regression — both targets are inside the teacher's role scope.

## Source-of-truth files

When adding or changing a redirect, edit BOTH the source-of-truth file AND this
contract in the same PR:

| File | What it owns |
|---|---|
| `app/cabinet/page.tsx` | learner cabinet root redirect ladder |
| `app/cabinet/settings/calendar/page.tsx` | per-page learner calendar settings ladder |
| `app/teacher/layout.tsx` | entire `/teacher/*` tree |
| `app/admin/(gated)/layout.tsx` | entire `/admin/(gated)/*` tree |
| `app/admin/login/page.tsx` | admin login (separate surface) |
| `lib/auth/sessions.ts` + `lib/auth/guards.ts` | session lookup + role gate predicates |
| `proxy.ts` | middleware (currently CSP nonce only — no auth redirects) |

If a layout/middleware level change introduces a new redirect, write a failing
test in `tests/e2e/product-flows.spec.ts` BEFORE the fix; the test name should
reference the contract row it locks in.
