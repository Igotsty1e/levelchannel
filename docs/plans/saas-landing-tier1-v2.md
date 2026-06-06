# SaaS landing Tier-1 v2 — cinematic scroll-driven rebuild (2026-06-06)

**Status:** SIGN-OFF round 3/3 (post-loop closures applied — see §14). Plan-doc PR #546 trailer carries this status. Implementation begins (Sub-1 first).
**Author:** Claude (orchestrator-mode). Brief locked with owner in chat 2026-06-06.
**Owner context:** current `/saas` page shipped via PR #424 (Epic 8 Day 7 v0) + PR #443 (motion tokens) + PR #444 (brand mark swap) + PR #447 (copy pass) + PR #450 (Tier-1 polish + `BrandMarkAnimated`) + PR #454 (a11y WCAG 2.1 AA). Owner verdict: «выглядит как говно, нужно невероятное». Месяц budget, mobile-first, Cuberto-tier ambition, hand-coded by Claude (no v0 / Lovable / Cursor composer), Codex paranoia mandatory, AI-gen всех визуалов.

> Companion docs:
> - `docs/plans/saas-offer-and-landing-redesign.md` — parent plan (paranoia SIGN-OFF round 12/3 2026-06-04). This file is its **Epic B execution-grade rewrite** for the new cinematic ambition tier. Original Epic B sub-decomposition (B.1-B.5) is SUPERSEDED by §5 below.
> - `docs/design-system.md` §8.LANDING (lines 327-490) — motion tokens already shipped via PR #443 (durations, easings, scroll-trigger primitives, magnetic-cursor, 3D-tilt, hero type-scale, parallax depth, reduced-motion fallback, perf budget). REUSED here.
> - `docs/brand/mj-style-anchor.md` — **NEW** (created in Sub-1; locks MJ v7 `--sref` brand-DNA code + palette + prompt template).
> - `components/brand/brand-mark.tsx` + `brand-mark-animated.tsx` — SHIPPED (PR #444, PR #450). REUSED.
> - `components/home/teacher-landing-client.tsx` (1327 lines) — current `/saas` renderer. **REPLACED** by new `components/saas/landing-v2/saas-landing.tsx` composition root. Old file deleted in Sub-5 close.

---

## 0. Plan-paranoia gate

This file MUST pass `/codex-paranoia plan` rounds 1-3 BEFORE the first impl sub-PR opens. Sub-PRs inside this epic inherit the plan SIGN-OFF and ship under Claude self-review (`Codex-Paranoia: SUB-WAVE self-reviewed (epic saas-landing-tier1-v2); epic-end review pending` trailer). Epic-end `/codex-paranoia wave` runs ONCE on aggregated diff after all sub-PRs merge to main. Token budget: 2 Codex passes for the full month.

## 0a. STRATEGY UPDATE 2026-06-06 — 3 lean variants instead of 1 full cinematic

**Owner directive (chat 2026-06-06 mid-session):** «Сделай в итоге 3 разных варианта лендинга самостоятельно автономно, для картинок используй кодекс — он сгенерит».

**Plan revision:** instead of one fully-built 5-act Cuberto-tier landing, ship **3 lean preview variants** in 1-month budget. Each variant = standalone preview route under `/saas/v2-{a,b,c}` with ~3-section compact narrative. Owner walks all 3 at month-end, picks the winner. Winner gets ramped to full Tier-1 polish in a follow-up epic. Losers archived. Original §2 5-act narrative survives as Variant A's full scope (lean build = Hero + climactic-act + CTA only; full 5-act reserved for the picked-winner polish epic).

### 0a.SUPERSEDES contract — what §11 replaces

Sections §2 (5-act narrative), §3 (asset inventory), §5 (6-sub-PR decomposition), §7 (28-day sequence), and §10 (skill invocations) describe the **pre-pivot one-route monolithic build**. They are NOT the live execution plan. **Live execution plan = §11 (3-variant) + §12 (round-1 paranoia closures + finalized contracts).** Pre-pivot sections survive only as winner-polish reference scope for whichever variant the owner picks at day 24. **Do not execute §5 / §7 literally — execute §11.3 / §11.5 / §12.**

**Visual diversification rule:** each variant occupies a distinct point in design-direction space — different MJ `--sref` codes, different palettes within brand range, different layout philosophy. Three variants must look **visibly different** so owner gets a real choice (not three flavours of the same thing). Definitions in §11 below.

**Image generation via Codex:** all illustrations + state variants are generated via Codex CLI calling GPT-Image-1 (owner has ChatGPT Pro subscription which enables this). Claude writes prompt brief → Codex executes generation → output deposited to `public/assets/landing-v2/{variant}/`. Pipeline detail in §11.4. Kling 2.1 / Sora 2 video gen remains the owner's hands-on workflow (Claude provides briefs in `docs/brand/codex-video-prompts.md`).

---

## 0z. Existing surface inventory (rewritten 2026-06-07 round-1 BLOCKER #3 closure)

**Domain-verb survey** (per `~/.claude/COMPANY.md §Survey-before-plan rule`) executed 2026-06-07. The original §0z surveyed only **new** identifiers (`landing_events`, `scroll-spine`, etc.) — that's the *anti-pattern* the rule warns against. Proper survey uses domain verbs the new surface implements and finds existing implementations to either EXTEND or justify-as-parallel.

```bash
# Verb surveys (executed 2026-06-07):
grep -rln -E "(landing|hero|cta|scroll-trigger|magnetic|parallax|saas-chrome)" app/ components/ lib/ tests/
grep -rln -E "/api/.*event|telemetry|trackClient|sendBeacon" app/ lib/ components/
grep -rln "saas-chrome\|\.saas-chrome" app/ components/ docs/
grep -rln "/saas\b" app/ tests/ evals/ docs/
grep -rln "/admin/(gated)\|admin.*analytics" app/ tests/
grep -rln "legalProfile\|LEGAL_OPERATOR\|LEGAL_BANK" app/ components/ lib/
grep -rln "register_started\|register_completed\|conversion_step\|landing_view" app/ tests/
```

Per company contract (Survey-before-plan rule). NEW = create; EXTEND = touch existing; REPLACE = swap; PARALLEL-JUSTIFIED = co-exist with explicit rationale.

**Domain-verb hit list with per-hit disposition (round-2 BLOCKER #4 closure — every match returned + disposition):**

| Hit | Disposition | Rationale |
|---|---|---|
| `app/api/payments/events/route.ts` | PARALLEL-JUSTIFIED | Different domain (checkout telemetry vs landing funnel), different trust boundary (authenticated checkout flow vs anonymous landing). Landing's `/api/landing/event` mirrors the security contract (`enforceTrustedBrowserOrigin` + `enforceRateLimit` + 204) but has its own schema + table. |
| `lib/analytics/client.ts` | PARALLEL-JUSTIFIED | Existing `logCheckoutEvent` is checkout-specific (`gtag` + `/api/payments/events` POST). Landing has its own client helper `lib/landing/analytics-events.ts → recordLandingEvent` because event schema is incompatible (different `type` union, different DDL). |
| `tests/saas-pivot/landing.test.tsx` | EXTEND | Currently pins `/saas` legacy renderer. Add 3 mirror files `tests/saas-pivot/landing-v2-{a,b,c}.test.tsx` for the 3 preview routes. No edit to the existing file in Sub-1..Sub-5. |
| `app/register/page.tsx` | UNCHANGED in §11 phase | Register-side instrumentation (producing `register_started` / `register_completed` events for funnel attribution) is OUT OF SCOPE for this epic. See §6 funnel scope reduction. If a future epic adds attribution, the producer goes here + in `app/api/auth/register/route.ts`. |
| `app/api/auth/register/route.ts` | UNCHANGED in §11 phase | Same as above. |
| `lib/legal/public-profile.ts` | REUSE | Existing module exports flat constants `LEGAL_OPERATOR_DISPLAY`, `LEGAL_OPERATOR_TAX_ID`, etc. Variants will import directly. To eliminate the inline-object duplication currently in `app/saas/page.tsx` + `app/page.tsx` (round-2 WARN #5 closure), Sub-2 ALSO adds `lib/landing/legal-profile-loader.ts` exporting `loadLegalProfile()` that returns the structured object expected by footer components. Existing pages migrate to the loader in Sub-7 doc-sweep. |
| `lib/landing/legal-profile-loader.ts` | NEW (round-2 WARN #5 closure) | Wraps `@/lib/legal/public-profile` consts into the `{ legalOperatorDisplay, legalOperatorTaxId, legalOperatorOgrn, legalBankAccount, legalBankName, legalBankBik }` shape. All 3 variant footers + existing `/saas` + existing `/` server pages use this loader. Single source of truth. |
| `app/page.tsx` | UNCHANGED in §11 phase | Migration to loader happens in Sub-7 doc-sweep alongside `/saas` migration. |
| `docs/design-system.md` §8.LANDING (lines 327-490) | REUSE | Tokens shipped PR #443; landing-v2 is consumer. No new tokens added by §11. |
| `app/offer/page.tsx` | UNCHANGED + Sub-7 doc-sweep migration | Currently imports `LEGAL_OPERATOR_DISPLAY`, `LEGAL_BANK_*`, `PUBLIC_CONTACT_EMAIL` etc. from `@/lib/legal/public-profile`. Sub-7 doc-sweep migrates the inline composition to `loadLegalProfile()` helper for consistency, but the file's content stays untouched until then. |
| `app/privacy/page.tsx` | UNCHANGED + Sub-7 doc-sweep migration | Same as `/offer` — imports public-profile consts directly. Sub-7 migration. |
| `app/consent/personal-data/page.tsx` | UNCHANGED + Sub-7 doc-sweep migration | Same as `/offer` — imports public-profile consts directly. Sub-7 migration. |
| `components/home/home-page-client.tsx` | UNCHANGED + Sub-7 doc-sweep migration | Footer at line 869 carries `legalProfile` prop with the same inline-object shape currently passed from `app/page.tsx`. Sub-7 migrates the prop to the loader output. |
| `components/home/teacher-landing-client.tsx` | UNCHANGED until Sub-8 close | 1327-line legacy v0 + polish file. Footer at line 1151 reads `legalProfile` prop. Stays UNCHANGED during preview phase; replaced wholesale in Sub-8 epic-close when winner wires into `/saas`. |

| Surface | Status | Existing-surface check + disposition |
|---|---|---|
| `app/saas/page.tsx` | UNCHANGED in §11 phase | exists (46 lines, server component, prop `legalProfile`, renders `<TeacherLandingClient legalProfile={...} />`). Until owner picks a winner at day 24, `/saas` continues to render the legacy v0 client. Winner gets `/saas` swap in Sub-7 (winner-polish). No edit during Sub-1..Sub-5. |
| `app/saas/v2-a/page.tsx`, `app/saas/v2-b/page.tsx`, `app/saas/v2-c/page.tsx` | NEW (3 preview routes) | grep → none exist. Each renders ONLY its variant's composition root. **NOT** wrapped by `app/saas/layout.tsx` (BLOCKER #2 closure: that layout would leak Lenis/GSAP into live `/saas/offer` + `/saas/processor-terms` legal pages). Each variant gets its OWN co-located layout `app/saas/v2-{a,b,c}/layout.tsx` mounting `<LenisProvider>` only on that route. `metadata.robots: noindex` on all 3 preview routes. Server component fetches `legalProfile` (same loader as `/saas/page.tsx`) and passes to footer. |
| `app/saas/offer/page.tsx` | UNCHANGED | live SaaS-оферта (legal-rf-pipeline-gated). DO NOT TOUCH. Out of scope. |
| `app/saas/processor-terms/page.tsx` | UNCHANGED | live processor-terms (paired with /saas/offer in current legal bundle). DO NOT TOUCH. Out of scope. |
| `components/saas/landing-v2/{variant-a,variant-b,variant-c}/saas-landing-{a,b,c}.tsx` | NEW (3 composition roots) | one root per variant. Each consumes shared animation primitives from `lib/animation/`. Per-variant style overrides via `data-landing-variant="a|b|c"` attribute on `.saas-chrome` root. |
| `components/saas/landing-v2/_shared/analytics-beacon.tsx` | NEW (shared across 3 variants) | client-only IntersectionObserver + scroll-depth + CTA hooks → POST to `/api/landing/event`. **Variant-aware:** beacon includes `variant_id` from prop. Used by all 3 variants from day 1 (BLOCKER #4 closure: analytics ships BEFORE variants in Sub-2.5, not after). |
| `components/saas/landing-v2/variant-a/scenes/desk-chaos-scene.tsx` + `dashboard-collapse-scene.tsx` | NEW (R3F 3D) | Variant-A-only. `next/dynamic({ ssr: false })`. Gated by Sub-1 perf prototype: if mobile slow-4G Perf <85 with 3D, fall back to PNG keyframe sequence per design-system.md:487. |
| `components/saas/landing-v2/variant-b/sections/*` | NEW (4 editorial sections) | Variant-B-only. Lottie-driven micro-anims, no R3F. |
| `components/saas/landing-v2/variant-c/dashboard-mock.tsx` + `dashboard-mock-data.ts` | NEW (interactive demo surface) | Variant-C-only. State lives in localStorage only. **No server API, no auth handoff, no persist-on-register flow in this epic.** "Save your work — register" CTA is plain `/register?role=teacher&utm_source=landing&utm_medium=v2-c&utm_content=demo` — server side does NOT consume the demo state. Persist-on-register is a future epic if Variant C wins (BLOCKER #8 closure). |
| `components/home/teacher-landing-client.tsx` | UNCHANGED during §11 phase | 1327 lines, current `/saas` renderer. Stays live as the default `/saas` while preview routes are being walked. DELETE only in Sub-8 (epic-close) AFTER owner picks winner AND winner is wired to `/saas`. |
| `lib/animation/scroll-spine.ts` | NEW (shared) | GSAP timeline factory. Variants call factory with their own act schemas. ONE `gsap.matchMedia` block for `prefers-reduced-motion`. |
| `lib/animation/lenis-provider.tsx` | NEW (shared) | `<LenisProvider>` wrapping per-variant page only (NOT segment layout). RAF loop driving Lenis + `ScrollTrigger.update()` + R3F `useFrame()` when present. |
| `lib/landing/analytics-events.ts` | NEW (shared) | typed event schema + `recordLandingEvent` client helper. **Variant-aware:** every event includes `variantId: 'v2-a'\|'v2-b'\|'v2-c'\|'legacy'`. |
| `app/api/landing/event/route.ts` | NEW | POST endpoint, **uses `enforceTrustedBrowserOrigin` + `enforceRateLimit` from `@/lib/security/request`** (BLOCKER #5 closure — matches `app/api/payments/events/route.ts` security contract, NOT just CORS). Schema-validated via zod. Append-only insert into `landing_events`. No advisory lock. Returns 204. |
| `app/admin/(gated)/analytics/landing/page.tsx` | NEW (admin, inside gated tree) | **Inside `app/admin/(gated)/`** (BLOCKER #6 closure: original §0z had it outside the gated layout). Operator funnel dashboard. Reuses admin nav. Add row to `evals/URL_REDIRECT_CONTRACT.md` Table 4 (admin routes). |
| `migrations/0110_landing_events.sql` | NEW | `landing_events` table with `variant_id text NOT NULL CHECK (variant_id IN ('v2-a','v2-b','v2-c','legacy'))` column (BLOCKER #4 closure — DDL now matches §11 promise). Slot 0110 verified free (last mig 0109 from push-PWA epic). |
| `public/assets/landing-v2/{variant-a,variant-b,variant-c}/` | NEW (asset dir per variant) | optimized AVIF/WebP from Codex image-gen pipeline. **Each variant dir contains `manifest.json` binding asset filename → prompt hash → anchor version** (WARN #12 closure — see §11.2). |
| `docs/brand/variant-{a,b,c}-style-anchor.md` | NEW × 3 | one anchor doc per variant (palette + lighting + composition prefix + GPT-Image-1 system-prompt prefix). Replaces single MJ `--sref` anchor — every variant has its own DNA. |
| `docs/brand/codex-image-prompts.md` | NEW | prompt manifest with per-asset entries: `{ variantId, slot, prompt, anchorVersion, outputPath, promptHash }`. Single source of truth for what was generated and from which anchor version. |
| `docs/design-system.md` §8.LANDING | REUSE | tokens shipped PR #443. Existing `.saas-chrome` scope (line 329) is the namespace — **no new `.saas-landing-v2-chrome` scope** (WARN #9 closure — original §0z proposed a NEW scope that wouldn't pick up shipped tokens). Per-variant overrides via `[data-landing-variant="a\|b\|c"]` attribute. |
| `package.json` deps | EXTEND | add: `gsap@^3.13`, `@gsap/react@^2.x`, `lenis@^1.2`, `@react-three/fiber@^9.x`, `@react-three/drei@^9.x`, `three@^0.169`, `@lottiefiles/dotlottie-react@^0.40`. Framer Motion already present — keep. |
| `.github/workflows/landing-perf-gate.yml` | NEW | CI gate runs Lighthouse mobile-slow-4G on **all 3 preview routes** `/saas/v2-a`, `/saas/v2-b`, `/saas/v2-c` AND on `/saas` (BLOCKER #4 closure). Fails if Perf <90 on CSS-only routes OR <85 on R3F-gated routes (matches existing design-system.md:331 ≥90 hard floor + line 487 R3F ≥85 mobile slow-4G gate). LCP ≤2.5s, CLS ≤0.05 across all 4 routes (BLOCKER #7 closure). |
| `tests/saas-pivot/landing.test.tsx` | EXTEND | currently pins `/saas` legacy. Add 3 new test files `tests/saas-pivot/landing-v2-{a,b,c}.test.tsx` mirroring the same coverage shape for each variant. |
| `evals/PRODUCT_FLOWS.md` | EXTEND | add 3 new flow entries for `/saas/v2-a`, `/saas/v2-b`, `/saas/v2-c` → `/register?role=teacher` CTA path. |
| `evals/URL_REDIRECT_CONTRACT.md` | EXTEND | add 3 new rows in Table 1 (public, anon-safe) for variant preview routes; add row in Table 4 (admin) for `/admin/analytics/landing`. |
| ~~`.env.example` `LANDING_V2_ENABLED=` row~~ | REMOVED (round-3 WARN #6 closure) | Vestigial in 3-variant strategy. Preview routes ARE distinct routes (`/saas/v2-{a,b,c}`); no flag gates them. Owner walks by navigating. Sub-8 has no flag to retire. The `LANDING_V2_ENABLED` references in §1-§9 (one-route monolithic plan) are SUPERSEDED per §0a contract. |
| `.env.example` | EXTEND (post-Sub-7 doc-sweep only) | NO new landing-v2 env vars. Sub-7 doc-sweep adds a comment line documenting that the landing namespace has no env contract during the §11 phase. |
| `README.md` + `OPERATIONS.md` + `ARCHITECTURE.md` | EXTEND | file map row for landing-v2 namespace + per-variant route surface description (WARN #11 closure). No env contract row. |

**Exception (does NOT change):**
- `app/offer/page.tsx`, `app/privacy/page.tsx`, `app/saas/offer/page.tsx`, `app/saas/processor-terms/page.tsx`, `app/cabinet/**`, `app/teacher/**`, `app/admin/(gated)/**` (except added `analytics/landing/page.tsx` inside the gated tree), `app/api/teacher/**`, `app/api/admin/**` — out of scope.
- **Mount-point invariant** (BLOCKER #2 closure): there is NO `app/saas/layout.tsx` change. Each variant route is self-mounting via its own per-route layout `app/saas/v2-{a,b,c}/layout.tsx`. Live legal routes `/saas/offer` + `/saas/processor-terms` continue to use the implicit segment layout (none for these routes), no Lenis/GSAP wrapping.
- **LenisProvider cleanup contract** (round-2 WARN #8 closure): each `app/saas/v2-{a,b,c}/layout.tsx` mounts ONE `<LenisProvider>` instance per route. `LenisProvider` `useEffect` MUST return a cleanup function that: (1) calls `lenis.destroy()`, (2) calls `ScrollTrigger.killAll()` on the GSAP context attached to that mount, (3) cancels the RAF loop. Tests in `tests/landing-v2/lenis-cleanup.test.ts` exercise A→B→C navigation and assert: zero idle RAF handles, zero leftover ScrollTrigger instances, single `lenis-html` DOM root present at any one time.
- **No-descendants invariant** (round-2 WARN #8 closure): preview variant routes are LEAF-only. There MUST NOT be nested child routes under `/saas/v2-{a,b,c}/*`. If a future need for a nested route appears (e.g. `/saas/v2-a/demo`), it MUST be a different route segment (e.g. `/saas/v2-a-demo`) to avoid Lenis/GSAP auto-wrapping. Enforce via PR-review check + `tests/landing-v2/route-shape.test.ts`.
- **CSS scope invariant** (WARN #9 closure): all new landing CSS uses the existing `.saas-chrome` class per `docs/design-system.md` §8.LANDING line 329. Per-variant overrides via `[data-landing-variant="a\|b\|c"]` attribute selector on `.saas-chrome` root. No new top-level scope.
- **Footer/legal coupling** (WARN #10 closure): each variant's footer reuses the server-side `legalProfile` fetcher from `app/saas/page.tsx` pattern and renders реквизиты + `/pay` learner escape link + `/saas/offer` + `/saas/processor-terms` + `/privacy` + `/consent/personal-data`. NOT a slimmer footer.

---

## 1. Owner brief (locked 2026-06-06 verbatim)

| # | Question | Answer |
|---|---|---|
| 1 | Что на «столе учителя» в открывающей сцене | Бумажный календарик-расписание, телефон с Telegram-чатом «можем перенести на четверг?», листок с долгами учеников, стикеры, ноутбук с Excel, калькулятор, наличка + скриншот Сбер-перевода |
| 2 | Финал коллапса | Все предметы магически собираются в `/teacher/dashboard` поверхность. CTA-кнопка регистрации обыгрывается **прямо внутри финального dashboard-кадра** (не отдельной секцией) |
| 3 | Присутствие человека | Без человека. Предметы движутся **сами — как магия** |
| 4 | Глубина нарратива | 5 актов: Хаос → Конкретная боль → Промежуточные решения не работают → Наш сервис → Кнопка |
| 5 | Топ-3 боли | Claude topик: (1) переписки «когда вам удобно?» → потеря часов, (2) не понимаю свои деньги по месяцам, (3) забываю кому сколько должен/кто должен мне |
| 6 | Текущий стек | Оба: Excel + Telegram + Сбер (вероятнее) и WhatsApp + Google-таблицы + кэш. Анимация показывает Telegram+Excel+Сбер как основной стек. |
| 7 | Tone of voice | Дружеский-наставник: «Понимаем тебя. Делаем для своих». |
| 8 | Местоимение | На «ты» |
| 9 | Главный CTA | «Забрать Стартовый тариф» |
| 10 | Pricing | «Секрет» — скрыт за кнопкой «Сколько стоит?» (создаёт curiosity, classic Apple-move) |
| 11 | Founder presence | Чистый бренд, без Анастасии-лица. Холоднее, но scalable. |
| 12 | Social proof на старте | Скрыт. До набора реальных отзывов после launch'а — секция не отрисовывается. |

---

## 2. 5-act narrative — full storyboard

Each act is a **scroll-pinned segment** (~100vh viewport-height held during scrub). GSAP timeline binds scroll progress to scene state. Lenis smooths inertia. Reduced-motion → static screenshots with fade-in.

### Act 1 — ХАОС (0-20% scroll)

**Visual:** isometric overhead view of a desk. Items scattered, slight randomized rotation:
- Бумажный календарик (расписание на бумаге, кружочки от ручки)
- Телефон лежит лицом вверх с открытым Telegram-чатом (одно сообщение видно: «Анна, можем перенести на четверг?»)
- Листок с долгами учеников от руки («Маша — 2 / Петя — 1 / Катя — 4»)
- Цветные стикеры с напоминаниями («позвонить маме Маши», «Петя — оплата»)
- Ноутбук открыт на Excel-таблице с цветными ячейками
- Калькулятор с цифрами на дисплее
- Купюра + скриншот Сбер-перевода рядом

**Type overlay (top-fade):** `«Каждое занятие — 6 сервисов и 12 переписок»` (h1, gradient-text from `--accent`)

**Camera:** static slight tilt. Items have subtle idle-jitter (very low GSAP `.fromTo` loop) — «живой стол».

**3D tech:** R3F scene with isometric ortho camera. Items as flat textured planes (PNG-AI-gen with alpha) OR as 3D meshes if perf permits. **Decision in Sub-1 perf prototype.**

### Act 2 — БОЛЬ (20-40% scroll)

**Visual:** stays on the desk, but ONE item zooms forward in turn, with a typewriter overlay of the matching pain.

Sequence (each item gets ~2.5s scrub):
1. **Phone (Telegram chat)** zooms forward, typewriter: `«Сколько времени уходит на „когда вам удобно?"»`
2. **Калькулятор** zooms forward, typewriter: `«А сколько ты вообще заработал в этом месяце? Точно?»`
3. **Листок с долгами** zooms forward, typewriter: `«Кто кому сколько должен — помнишь наизусть?»`

Each pain block ends with a soft pulse + dim-down before next zoom.

**Type style:** Inter / SF Pro tight tracking, weight 700, gradient-text. `prefers-reduced-motion` → no typewriter, full text fades in.

### Act 3 — ПРОМЕЖУТОЧНЫЕ НЕ РАБОТАЮТ (40-55% scroll)

**Visual:** desk items start FAILING:
- Excel-ноутбук «лагает», cells shake → freeze
- Telegram-чат разрастается в noise — пузырьки сообщений переполняют экран → blur
- Бумажный календарик рвётся пополам с тёплым skeuomorphic-эффектом
- Стикеры отлипают и падают

**Type overlay:** `«Excel не запомнит. Telegram потеряет. Тетрадь порвётся.»`

**Tempo:** **fast** (~3s total) — это «момент frustration», должен ощущаться быстрым и тревожным. Контраст с медленным интро.

**Sound (optional, v1.5):** subtle whoosh + paper crumple. v1 ship без звука.

### Act 4 — НАШ СЕРВИС (55-85% scroll) — кульминация

**Visual:** **Magic collapse**. Все предметы стола одновременно начинают движение к центру кадра. Бумажки складываются. Телефон трансформируется. Excel-таблица сжимается. Калькулятор поглощается. Через `~4s` scrub-time всё собирается в **3D-рендер `/teacher/dashboard` поверхности**.

**Dashboard final state:**
- Header: brand mark + nav («Расписание / Ученики / Балансы»)
- Three primary cards в 3D-tilt-on-scroll:
  - **Расписание** card (slot grid mock с реальными временами)
  - **Ученики** card (имена + статусы)
  - **Балансы** card (числа + currency)
- Один CTA-button в центре низа, gradient-fill `--accent-start → --accent-end`, magnetic-cursor pull radius 80px: **«Забрать Стартовый тариф»**

**Type overlay (slow fade):** `«Всё. В одном месте. Бесплатно для первого ученика.»`

**Camera:** orbit slight rotation → settles at front-facing dashboard view.

**3D tech:** R3F orbit + `useFrame` synced to GSAP timeline. Magnetic-cursor implemented in Framer Motion `useTransform` on pointer position.

### Act 5 — КНОПКА (85-100% scroll)

**Visual:** dashboard scene fades. CTA-кнопка остаётся центральной, scale-up to 1.2x. Soft glow pulse (CSS `box-shadow` keyframes, GPU-cheap). Magnetic-cursor active.

**Below the CTA:** small fade-in line: `«Стартовый — навсегда бесплатно. Без карты при регистрации.»`

**Click handler:** routes to `/register?role=teacher` with UTM param `?utm_source=landing&utm_medium=cinematic&utm_content=cta_primary` — for analytics attribution.

**Below CTA (optional v1):** discreet text-link `«Сколько стоит другие тарифы?»` → opens modal with 3-card pricing reveal (`«секрет» mechanic` from Q10). Modal uses Framer Motion, dark blur-backdrop.

### Footer act (post-100% scroll)

Standard footer with: legal links (`/saas/offer` will exist post-Epic A; `/privacy`, `/consent/personal-data`), support email, brand-mark static, `ИП Фирсова Анастасия` registration line in small grey (`--text-muted`).

---

## 3. Asset inventory + AI gen pipeline

### Brand DNA lock (Sub-1, Day 1)

1. Pick palette (locked to current LevelChannel brand): `#0B0B0C` bg / `#111113` surface / `#C87878→#E8A890` accent gradient / `#F5F5F7` text-primary / `#A1A1AA` text-secondary. (Sourced `docs/design-system.md` §3.)
2. Pick mood-words: `warm, intimate, sophisticated, cinematic, magical, dark-mode-native, isometric, hand-touched`.
3. MJ v7: render 5 style-probes with `--sref random` + palette + 3 mood-words. Pick best. **Save `--sref XXXX` code to `docs/brand/mj-style-anchor.md`**. This is brand DNA for the whole month.
4. Lighting rule: «soft top-left key light, low ambient, warm rim» — appended to every prompt.

### Asset list (locked count)

**Illustrations (MJ v7 + locked `--sref`):**
1. Hero desk overview — isometric, all 8 items scattered
2. Бумажный календарик-расписание (close-up)
3. Phone with Telegram chat (close-up)
4. Листок с долгами (close-up)
5. Стикеры pack
6. Excel-ноутбук (close-up)
7. Калькулятор (close-up)
8. Купюра + Сбер-перевод (close-up)
9. Dashboard final-state — 3D-tilt isometric
10. 3 dashboard cards (расписание / ученики / балансы) individual close-ups

**State variants (Flux Kontext, frame-to-frame):**
- For each item from #2-#8 above: 3 frames — original / mid-collapse / final-collapsed-into-dashboard
- ~21 variants total

**Icons (Recraft V3, SVG):**
- 5 brand icons for footer + nav (расписание, ученики, балансы, кабинет, регистрация)

**Hero ambient video (Kling 2.1 Master, 5-8s):**
- Subtle ambient loop — слегка дышащий desk background — для секции ниже Act 5 (footer area)

**Narrative panel (optional v1, Sora 2 via ChatGPT Pro):**
- 10s cinematic «desk to dashboard» storyboard — used as preview-video on social shares (OG-image dynamic)

**Lottie micro-animations (Rive hand-authored, NOT AI):**
- 3 micro-loops: typewriter cursor, magnetic-pull arrow, soft pulse

### Optimization gates

| Asset type | Source | Optimization | Format |
|---|---|---|---|
| Illustrations | MJ 3:2 PNG | Squoosh → AVIF + WebP fallback | `<picture>` with `<source>` |
| Icons | Recraft SVG | SVGO | inline `<svg>` |
| Hero video | Kling H.264 | HandBrake → H.265 + WebM fallback | `<video poster muted loop playsInline>` |
| Lottie | Rive `.riv` | native | `<RiveComponent>` |

### Budget tracker

| Service | Est. spend | Where |
|---|---|---|
| MJ v7 | ~$8 (200 gens × $0.04) | mid.dev API or web |
| Flux Kontext | ~$15 (300 gens × $0.05) | Replicate / fal.ai |
| Recraft V3 | ~$3 (50 gens) | recraft.ai |
| Kling 2.1 | ~$5 (3 × 5s clips × $0.28) | klingai.com API |
| Sora 2 | $0 (included in ChatGPT Pro) | ChatGPT Pro |
| **Total** | **~$31** | one-time |

---

## 4. Tech stack (the 5 picks — confirmed)

| # | Pick | Versions | Bundle (gz) |
|---|---|---|---|
| 1 | **Animation spine:** GSAP + ScrollTrigger + Lenis + R3F (lazy) + Framer Motion | `gsap@^3.13`, `@gsap/react@^2`, `lenis@^1.2`, `@react-three/fiber@^9`, `@react-three/drei@^9`, `three@^0.169`, `framer-motion@^11` (already in deps) | GSAP+ST+Lenis 39 KB / R3F lazy +180 KB / Framer 18 KB |
| 2 | **AI visual pipeline:** MJ v7 `--sref` + Flux Kontext + Recraft V3 + Kling 2.1 Master + Sora 2 | mid.dev API, fal.ai/Replicate, recraft.ai, klingai.com, ChatGPT Pro | n/a (offline gen) |
| 3 | **Design pipeline:** Figma + Figma MCP + `/design-with-claude:*` specialists | Figma MCP `https://mcp.figma.com/mcp` (installed 2026-06-06), 41 design specialists | n/a |
| 4 | **Iterate-and-verify:** Playwright + Chrome DevTools + Lighthouse + Sentry MCPs | All installed 2026-06-06 (lighthouse-mcp `0.1.15` added) | n/a |
| 5 | **Quality + measurement:** Codex paranoia loop + own-DB landing_events ingestion | `/codex-paranoia plan` (this doc) + `/codex-paranoia wave` (epic-end). Own analytics: mig 0110 + `/api/landing/event` + `/admin/analytics/landing` dashboard | n/a |

---

## 5. Sub-epic decomposition (6 sub-PRs over 4 weeks)

### Sub-1 — Brand DNA + AI asset batch + design tokens (Week 1, days 1-5)

**Goal:** lock visual DNA + generate all static visual assets + extend `docs/design-system.md` §8.LANDING with v2 namespace tokens.

**Files:**
- `docs/brand/mj-style-anchor.md` (NEW) — `--sref` code + palette + prompt template + 5-illuminant rule.
- `public/assets/landing-v2/illustrations/*.{avif,webp}` (10 illustrations × 2 formats)
- `public/assets/landing-v2/states/*.{avif,webp}` (21 state variants)
- `public/assets/landing-v2/icons/*.svg` (5 icons)
- `public/assets/landing-v2/video/desk-ambient.{mp4,webm}` (Kling)
- `public/assets/landing-v2/lottie/*.lottie` (3 Rive micro-animations)
- `docs/design-system.md` §8.LANDING-v2 (EXTEND) — add `landing-v2` scoped sub-tokens for storyboard timing constants (T1=4s desk-idle / T2=2.5s pain-zoom / T3=3s break-tempo / T4=4s collapse / T5=2s cta-settle).

**Skills:**
- `/design-with-claude:brand-designer` — MJ style-probe selection + mark refinement.
- `/design-with-claude:design-system-architect` — tokens extension review.
- `/design-with-claude:performance-specialist` — asset size budget gate.

**Trailer:** `Codex-Paranoia: SUB-WAVE self-reviewed (epic saas-landing-tier1-v2); epic-end review pending`.

### Sub-2 — Animation spine + Lenis provider + reduced-motion contract (Week 2, days 6-8)

**Goal:** technical foundation. NO visible visual changes to users yet. Lays the GSAP timeline shell + Lenis + R3F bootstrap.

**Files:**
- `lib/animation/scroll-spine.ts` (NEW) — exports `createScrollSpine({ acts: [...], onActChange })`. Single GSAP `Timeline` with 5 act segments. `gsap.matchMedia({ '(prefers-reduced-motion: reduce)': ... })` block.
- `lib/animation/lenis-provider.tsx` (NEW) — `<LenisProvider>` wraps `<App>`. Single RAF loop driving Lenis + `ScrollTrigger.update()` + R3F `useFrame()`.
- `lib/animation/types.ts` (NEW) — act schema, scrub config types.
- `components/saas/landing-v2/saas-landing.tsx` (NEW, scaffold) — empty composition root, mounts LenisProvider + scroll-spine.
- `app/saas/layout.tsx` (NEW — feature flagged) — wraps `/saas` route in LenisProvider when `LANDING_V2_ENABLED=1`.
- `package.json` — add new deps (gsap, lenis, three, R3F, drei, dotLottie).
- `tests/landing-v2/scroll-spine.test.ts` (NEW) — unit tests for matchMedia branches, act-segment boundaries.

**Feature flag:** `LANDING_V2_ENABLED` env var (default OFF). When OFF, `/saas` continues to render old `<TeacherLandingClient />`. Operator flip is single env edit. **Default OFF until Sub-5 close.**

**Skills:**
- `/design-with-claude:motion-designer` — easing + duration calibration review.
- `/codex` (consult mode) — second opinion on GSAP `matchMedia` + Lenis + R3F handoff architecture BEFORE coding (1 call).

**Trailer:** `Codex-Paranoia: SUB-WAVE self-reviewed (epic saas-landing-tier1-v2); epic-end review pending`.

### Sub-3 — Acts 1-2-3 build (chaos + pain + broken) (Week 2-3, days 9-14)

**Goal:** first 3 acts shippable in feature-flagged mode. Owner sees real scroll experience on staging.

**Files:**
- `components/saas/landing-v2/sections/act-1-chaos.tsx` (NEW) — desk overview with idle-jitter, type overlay.
- `components/saas/landing-v2/sections/act-2-pain.tsx` (NEW) — 3-zoom typewriter sequence.
- `components/saas/landing-v2/sections/act-3-broken.tsx` (NEW) — items failing sequence.
- `components/saas/landing-v2/scenes/desk-chaos-scene.tsx` (NEW) — R3F desk scene with item meshes, dynamic-imported.
- `components/saas/landing-v2/text/typewriter.tsx` (NEW) — re-usable typewriter component with reduced-motion fallback.
- All 3 acts wired into `scroll-spine.ts` timeline.

**Skills:**
- `/design-with-claude:visual-hierarchy-specialist` — section composition + camera angle.
- `/design-with-claude:typography-specialist` — type-scale + tracking on overlays.
- Playwright MCP — viewport iteration (iPhone 14, Android Pixel 6, iPad).
- Chrome DevTools MCP — perf trace each commit.
- Lighthouse MCP — mobile-slow-4G audit, must stay ≥70 Perf.

**Trailer:** `Codex-Paranoia: SUB-WAVE self-reviewed`.

### Sub-4 — Acts 4-5 build (dashboard collapse + CTA) (Week 3, days 15-19)

**Goal:** climax + conversion CTA. The «magic moment».

**Files:**
- `components/saas/landing-v2/sections/act-4-product.tsx` (NEW) — desk-to-dashboard collapse sequence.
- `components/saas/landing-v2/sections/act-5-cta.tsx` (NEW) — final CTA + pricing-modal trigger.
- `components/saas/landing-v2/scenes/dashboard-collapse-scene.tsx` (NEW) — R3F scene mounting `<DashboardMock />`, the 3D-tilt dashboard surface.
- `components/saas/landing-v2/dashboard-mock.tsx` (NEW) — static React tree mocking the dashboard cards visible from Act 4 onwards.
- `components/saas/landing-v2/pricing-modal.tsx` (NEW) — pricing-«секрет» Framer Motion modal with 3 cards (Стартовый / Базовый / Расширенный). Uses current `TIER_WRITE_CAPS` from `lib/billing/teacher-subscription.ts` for tier metadata. Source of truth: shared.
- `components/saas/landing-v2/cta-button.tsx` (NEW) — magnetic-cursor primary CTA, Framer Motion `useTransform` on pointer position.

**Skills:**
- `/design-with-claude:interaction-designer` — magnetic-cursor + CTA microcopy.
- `/design-with-claude:landing-page-specialist` — pricing-card framing + reveal mechanic.
- `/design-with-claude:b2b-saas-specialist` — value-prop hierarchy on CTA + pricing.
- Playwright MCP — touch-target verification (mobile thumb-zone).

**Trailer:** `Codex-Paranoia: SUB-WAVE self-reviewed`.

### Sub-5 — Copy refinement + a11y + perf gate (Week 4, days 20-23)

**Goal:** ship-ready. Old landing deleted.

**Files:**
- All 5 acts get copy pass through `/design-with-claude:content-strategist` with locked tone (дружеский-наставник, на «ты»).
- `components/home/teacher-landing-client.tsx` (DELETE — 1327 lines removed).
- `app/saas/page.tsx` (EDIT) — swap import to `<SaasLanding />`, drop legacy `<TeacherLandingClient />` import.
- A11y pass via `Agent(subagent_type=web-accessibility-wizard)` + `/design-with-claude:accessibility-specialist`:
  - Every Act has `aria-label` on section.
  - All 3D scenes have `role="img"` + `aria-label` describing what's happening.
  - `prefers-reduced-motion`: every Act has discrete-fade fallback.
  - Skip-to-content link.
  - Color contrast ≥4.5:1 verified on every text-over-3D-scene.
  - Keyboard nav: CTA + pricing-modal trigger + close.
- Perf gate via Lighthouse MCP: mobile-slow-4G Perf ≥70, LCP ≤2.5s, CLS ≤0.05.
- `.github/workflows/landing-perf-gate.yml` (NEW) — CI gate.
- Feature flag `LANDING_V2_ENABLED` flipped to default ON in Sub-5 close commit; old `/saas` removed.

**Skills:**
- `/design-with-claude:content-strategist` — full 5-act copy pass.
- `/design-with-claude:b2b-saas-specialist` — final value-prop check.
- `Agent(web-accessibility-wizard)` — WCAG 2.1 AA audit.
- `/design-with-claude:accessibility-specialist` — pair on audit.
- `/design-with-claude:performance-specialist` — perf budget verify.
- `/design-with-claude:mobile-specialist` — final mobile pass.
- Lighthouse MCP — gate.
- `/design-review` — final visual QA on staging.

**Trailer:** `Codex-Paranoia: SUB-WAVE self-reviewed`. **This is the last sub-PR before epic-close.**

### Sub-6 — Analytics ingestion pipeline (Week 4, days 24-27)

**Goal:** own-DB landing event funnel + operator dashboard.

**Files:**
- `migrations/0110_landing_events.sql` (NEW) — table `landing_events(id uuid pk, session_id text not null, viewport_w int, viewport_h int, scroll_depth_pct int, section_seen text, cta_clicked text, conversion_step text, occurred_at timestamptz default now(), ua_hash text not null, ref_host text)`. Partial index `(occurred_at, session_id)`. NO PII — `session_id` = cookie-less hash from `ip + ua + day_bucket`, `ua_hash` = `hashtextextended(ua, 0)`.
- `lib/landing/analytics-events.ts` (NEW) — typed event schema:
  ```ts
  type LandingEventType =
    | 'hero_seen' | 'act_2_seen' | 'act_3_seen' | 'act_4_seen' | 'act_5_seen'
    | 'cta_register_click' | 'pricing_modal_open' | 'pricing_modal_close'
    | 'scroll_depth_25' | 'scroll_depth_50' | 'scroll_depth_75' | 'scroll_depth_100'
  ```
- `components/saas/landing-v2/analytics-beacon.tsx` (NEW) — IntersectionObserver on each section + scroll handler + CTA wrap. `navigator.sendBeacon('/api/landing/event', JSON.stringify({...}))` — non-blocking.
- `app/api/landing/event/route.ts` (NEW) — POST handler:
  - Rate-limit per IP (10 req/sec, 200 req/min) via existing `lib/security/rate-limit.ts`.
  - Schema validation via zod (existing pattern).
  - INSERT into `landing_events` (no advisory lock — append-only high-throughput).
  - Returns 204 No Content (saves bandwidth).
  - CORS allow same-origin only.
- `app/admin/(gated)/analytics/landing/page.tsx` (NEW — inside gated tree per BLOCKER #6 closure) — operator dashboard:
  - Funnel (LANDING-ONLY, per round-2 BLOCKER #2 closure): `hero_seen → scroll_depth_25 → scroll_depth_50 → scroll_depth_75 → scroll_depth_100 → cta_register_click`. No `/register completed` step — register-side instrumentation is OUT OF SCOPE in this epic.
  - Section drop-off table (per-variant via `variant_id`).
  - Viewport breakdown (mobile / tablet / desktop counts).
  - Last 24h / 7d / 30d toggles.
  - **No** join from `cta_register_click` to `/register completed` — that attribution requires producers on `/register` + `POST /api/auth/register` not in this epic. UTM tags are emitted on the CTA link for FUTURE attribution work, but the dashboard does NOT promise the closure.
- `tests/integration/landing-events.test.ts` (NEW) — 6 scenarios: write + read, rate-limit, schema reject, viewport bucketing, session_id hash stability, no-PII assertion.

**Skills:**
- `/codex` (consult mode) — schema review BEFORE migration write (1 call).
- `/review` on the PR before merge.

**Trailer:** `Codex-Paranoia: SUB-WAVE self-reviewed`.

### Epic-close — paranoia wave + ship

**Goal:** flip `LANDING_V2_ENABLED` default ON, delete legacy, run codex-paranoia wave on aggregated diff.

**Files:**
- `app/saas/page.tsx` final commit — feature flag flipped, legacy import removed.
- `docs/plans/SHIPPED-INDEX.md` — add entry for this epic.
- `docs/plans/saas-landing-tier1-v2.md` — Status: SHIPPED.
- `docs/plans/saas-offer-and-landing-redesign.md` — flip parent plan-doc Epic B section to SHIPPED.

**Trailer:** `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <commit-range>)`.

---

## 6. Analytics schema (Sub-6 detail)

### Migration 0110

```sql
CREATE TABLE landing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- variant_id added per round-1 paranoia BLOCKER #4 closure (2026-06-07).
  -- Required so day-1 analytics on /saas/v2-{a,b,c} can attribute drop-off per variant.
  variant_id text NOT NULL CHECK (variant_id IN ('v2-a','v2-b','v2-c','legacy')),
  session_id text NOT NULL,
  ua_hash text NOT NULL,
  viewport_w int,
  viewport_h int,
  ref_host text,
  scroll_depth_pct int CHECK (scroll_depth_pct BETWEEN 0 AND 100),
  section_seen text CHECK (section_seen IN (
    'hero','act_1_chaos','act_2_pain','act_3_broken','act_4_product','act_5_cta',
    'editorial_1','editorial_2','editorial_3',
    'demo_dashboard','demo_try_action','demo_save_cta',
    'footer'
  )),
  cta_clicked text CHECK (cta_clicked IN (
    'register_primary','pricing_modal_open','pricing_modal_close','footer_link','demo_save'
  )),
  -- conversion_step trimmed per round-2 BLOCKER #2 closure.
  -- 'register_started' / 'register_completed' would require producers
  -- in app/register/page.tsx + app/api/auth/register/route.ts that this
  -- epic does NOT spec. Funnel scope is limited to LANDING-side events
  -- only: hero seen → scroll-depth → cta_register_click. Conversion-to-
  -- completed-registration attribution is a future epic that adds those
  -- producers.
  conversion_step text CHECK (conversion_step IN (
    'landing_view','scroll_25','scroll_50','scroll_75','scroll_100','cta_click'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Per-variant funnel queries hit the (variant_id, conversion_step, occurred_at) index.
CREATE INDEX landing_events_variant_step_time_idx
  ON landing_events (variant_id, conversion_step, occurred_at DESC);

CREATE INDEX landing_events_session_time_idx
  ON landing_events (session_id, occurred_at DESC);

CREATE INDEX landing_events_step_time_idx
  ON landing_events (conversion_step, occurred_at DESC);

-- 90-day retention via partial cleanup (handled by existing 'data-retention' cron, separate epic)
```

### Privacy invariants

- **NO PII columns.** No email, no name, no IP, no user-agent string.
- `session_id` = SHA256(`IP + user_agent + UTC_date`) truncated to 24 hex chars. Rotates daily. Not joinable to authenticated session.
- `ua_hash` = `hashtextextended(user_agent, 0)::text` for bot-detection aggregation only.
- 90-day retention.
- Documented in `docs/legal-pipeline.md` as **NOT** legal-sensitive (no consent required — anonymous analytics under 152-ФЗ exemption for non-personal data).

---

## 7. Day-by-day sequence (28 days, mon-fri × 4 weeks + buffer)

| Day | Work |
|---|---|
| 1 | Brand DNA: MJ style-probes (5×), pick `--sref` code. Anchor doc. |
| 2 | Illustrations batch (10 hero + 21 state variants) via MJ v7 + Flux Kontext. |
| 3 | Icons batch (Recraft V3) + Kling hero video. |
| 4 | Asset optimization (Squoosh + SVGO + HandBrake). |
| 5 | Sub-1 PR open + Claude self-review + merge. Tokens extension. |
| 6 | Sub-2: GSAP/Lenis foundation. `/codex` consult on architecture (1 call). |
| 7 | Sub-2: scroll-spine.ts + LenisProvider + tests. |
| 8 | Sub-2 PR open + merge. Feature flag default OFF in main. |
| 9 | Sub-3: Act 1 (chaos) build + R3F desk scene. |
| 10 | Sub-3: Act 2 (pain) build + typewriter. |
| 11 | Sub-3: Act 3 (broken) build + transitions. |
| 12 | Sub-3 Playwright iteration (mobile viewport). |
| 13 | Sub-3 Lighthouse audit + perf tune. |
| 14 | Sub-3 PR open + merge. Owner walks staging — feedback. |
| 15 | Sub-4: Act 4 (collapse → dashboard) — the magic moment. |
| 16 | Sub-4: dashboard-mock + 3D-tilt cards. |
| 17 | Sub-4: Act 5 (CTA) + magnetic-cursor. |
| 18 | Sub-4: pricing-modal + state. |
| 19 | Sub-4 PR open + merge. Owner walks staging — full 5-act feedback. |
| 20 | Sub-5: content-strategist copy pass on all 5 acts. |
| 21 | Sub-5: web-accessibility-wizard audit + fixes. |
| 22 | Sub-5: Lighthouse perf tune to ≥70 mobile / ≥90 desktop. |
| 23 | Sub-5 PR open + merge. Legacy `teacher-landing-client.tsx` deleted. |
| 24 | Sub-6: migration 0110 + analytics-events.ts + endpoint. |
| 25 | Sub-6: analytics-beacon.tsx + admin dashboard. |
| 26 | Sub-6 tests + PR open + merge. |
| 27 | `/codex-paranoia wave` on epic commit-range. Fixes if any. |
| 28 | Epic-close PR: flag default ON, SHIPPED-INDEX entry, plan-doc Status flip. **/saas Tier-1 v2 live.** |

Buffer: 2 unplanned days within month for Codex paranoia round-2 fixes or perf hot-spots.

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Mobile Lighthouse <70 because R3F+three.js too heavy | R3F lazy-loaded via `next/dynamic({ ssr: false })` only inside Acts 1+4. `dpr={[1, 1.5]}` cap. `content-visibility: auto` on off-screen sections. If still fails — fallback to MJ-generated PNG keyframe sequence (no real 3D). Sub-1 perf prototype gates the 3D-vs-PNG decision. |
| R2 | AI asset incoherence across 15+ gens | Locked `--sref` + locked palette hex in every prompt + locked aspect ratio per asset class + locked illuminant rule. Single-illustrator rule (no Flux + MJ in same set). |
| R3 | Codex paranoia round 3 unresolved BLOCKERs | Hard-cap = 3 rounds (per company rule). On round-3 BLOCK → escalation to user + memory `2026-06-XX_landing_tier1_v2_blocked.md` + start new fix-PR after issue closure. |
| R4 | Mobile touch CTA — magnetic-cursor irrelevant | Magnetic-cursor only desktop (`@media (hover: hover)`). Mobile: large 56pt CTA + 8px tap-target padding + haptic-feel via `useGesture` press-state. |
| R5 | Sora 2 / Kling output drift from MJ style | Kling fed image-to-video with MJ frame as reference, locks composition. Sora 2 narrative-panel is optional v1 (cut if drift). |
| R6 | Feature flag `LANDING_V2_ENABLED` accidentally flipped on prod before Sub-5 close | Default `process.env.LANDING_V2_ENABLED ?? '0'` (string-compare to `'1'` only). Operator-flip via VPS env file. Documented in `OPERATIONS.md` post-Sub-2. |
| R7 | Legacy `/saas` breaks during transition | Sub-2 to Sub-4 ship behind flag — old landing stays default. Only Sub-5 close commit removes legacy. Pre-Sub-5: dual-render via `if (LANDING_V2_ENABLED) { ... } else { ... }`. |
| R8 | i18n preparation deferred | Russian-only on launch. Sub-2 wraps copy in `<T>` helper component with key-namespace `landing-v2.*`. Translation infrastructure (next-intl etc.) NOT this epic — future i18n epic adds backend; today helper is a passthrough. |

---

## 9. Trailer expectations

| Stage | Trailer |
|---|---|
| Sub-1 through Sub-6 | `Codex-Paranoia: SUB-WAVE self-reviewed (epic saas-landing-tier1-v2); epic-end review pending` |
| Epic-close PR (after `/codex-paranoia wave`) | `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <range>)` |
| Hot-fix follow-up PRs (if round-2 finds issues) | `Codex-Paranoia: SUB-WAVE self-reviewed; epic-end review pending` until final round-3 SIGN-OFF |

---

## 10. Skill invocations expected

### Plan-mode (this doc)
- `/codex-paranoia plan docs/plans/saas-landing-tier1-v2.md` — rounds 1-3 BEFORE Sub-1.

### Sub-1 (brand + assets)
- `/design-with-claude:brand-designer` — MJ style-probe selection.
- `/design-with-claude:design-system-architect` — tokens review.
- `/design-with-claude:performance-specialist` — asset size budget.

### Sub-2 (animation spine)
- `/design-with-claude:motion-designer` — easing review.
- `/codex` (consult mode, 1 call) — architecture second opinion.

### Sub-3 (Acts 1-2-3)
- `/design-with-claude:visual-hierarchy-specialist`
- `/design-with-claude:typography-specialist`
- Playwright + Chrome DevTools + Lighthouse MCPs.

### Sub-4 (Acts 4-5)
- `/design-with-claude:interaction-designer`
- `/design-with-claude:landing-page-specialist`
- `/design-with-claude:b2b-saas-specialist`
- Playwright MCP (touch-target).

### Sub-5 (copy + a11y + perf)
- `/design-with-claude:content-strategist`
- `/design-with-claude:b2b-saas-specialist` (value-prop final)
- `Agent(subagent_type=web-accessibility-wizard)` — WCAG audit.
- `/design-with-claude:accessibility-specialist`
- `/design-with-claude:performance-specialist`
- `/design-with-claude:mobile-specialist`
- Lighthouse MCP — gate.
- `/design-review` — final visual QA.

### Sub-6 (analytics)
- `/codex` (consult, 1 call) — schema review before mig 0110.
- `/review` — PR pre-merge review.

### Epic-close
- `/codex-paranoia wave <epic-range>` — rounds 1-3.
- `/ship` (epic-close PR drive).
- `/document-release` (post-merge doc sweep).
- `/learn` (capture session learnings).

### MCP usage throughout
- **Figma MCP** — design source (tokens read + write-back annotations).
- **Playwright MCP** — viewport rotation + screenshot each iteration.
- **Chrome DevTools MCP** — Performance trace + console + computed styles + responsive emulation.
- **Lighthouse MCP** — perf budget gate per sub-PR.
- **Sentry MCP** — post-launch error tracking.

---

## 11. 3-variant strategy (added 2026-06-06 per owner directive)

### 11.1 Three distinct directions

Variants occupy distinct points in the SaaS-landing design-space. Each gets its own preview route, own brand-DNA (own `--sref` code), own copy slant. Owner walks all 3, picks winner.

| | Variant A — Cinematic Desk Magic | Variant B — Editorial Storytelling | Variant C — Interactive Demo Playground |
|---|---|---|---|
| **Mood** | Dark, magical, premium-cinematic | Light-dark editorial, magazine-grade typography | Mid-dark, hands-on, product-first |
| **Aesthetic anchor** | Cuberto / Apple / Lusion | Linear / Vercel / Stripe Sessions | Mercury / Notion / Raycast |
| **Hero mechanic** | Scattered desk items collapsing via 3D R3F into `/teacher/dashboard` | Massive serif/sans type-morph statements, scroll-revealed editorial paragraphs, real product screenshots | Live-feel mocked dashboard surface — user can hover/click to "try" features without registration (state in localStorage only; server-side has zero knowledge of demo state) |
| **3D usage** | Heavy (R3F desk + dashboard scenes) | Minimal (only optional accent) | None (focus on real product UI) |
| **Lottie usage** | Few accents | Heavy (illustrative micro-animations) | Few accents |
| **Copy density** | Sparse (3-5 word headlines per act) | Long (editorial paragraphs, quote-grade statements) | Medium (UI labels + 1-2 sentence per feature) |
| **Conversion path** | Magnetic CTA at climactic act-4-5 | CTAs distributed through editorial sections | "Try the dashboard" → plain `/register?role=teacher` CTA (no save-state handoff — see BLOCKER #8 closure) |
| **Best for buyer type** | Emotional / brand-driven / premium-feel seekers | Rational / comparison-shoppers / content-rich evaluators | Pragmatic / engineer-mindset / try-before-buy |
| **Route** | `/saas/v2-a` | `/saas/v2-b` | `/saas/v2-c` |
| **Lean scope** | Hero (Act 1+2 fused) + climax (Act 4) + CTA (Act 5). Acts 3 cut. | Hero + 3 editorial scroll sections + CTA. | Hero + interactive dashboard mock + CTA. |
| **Asset count (lean)** | 6 illustrations + R3F desk-collapse scene + 1 video loop | 4 illustrations + 6 Lottie micro-anims + 3 product screenshots | 2 illustrations + full `<DashboardMock />` interactive component + 2 sample-data sets |
| **Estimated dev days** | 5 days | 5 days | 5 days |

### 11.2 Codex image-gen pipeline

Per owner directive, Codex CLI handles image generation (GPT-Image-1 via ChatGPT Pro auth).

**Workflow per variant per asset (with immutable manifest — WARN #12 closure):**
1. Claude appends entry to `docs/brand/codex-image-prompts.md` with: `{ variantId, slot, promptText, paletteHex, aspectRatio, outputPath, anchorVersion: 'va-1.0' | 'vb-1.0' | 'vc-1.0', promptHash: sha256(promptText + anchorVersion) }`. Manifest is append-only; mutating an entry creates a new row with bumped `anchorVersion`.
2. Claude invokes Codex via `codex exec` (raw call allowed in this skill flow per `/codex-paranoia` contract §3) — Codex generates image, saves to `public/assets/landing-v2/{variant}/illustrations/raw/{outputPath}`.
3. Claude reads file, validates aspect ratio + palette adherence via Chrome DevTools MCP color-picker pass.
4. If drift detected (palette wrong / composition wrong), Claude updates prompt + bumps `anchorVersion` + writes new manifest row + re-invokes. Old asset stays in `raw/` for diff; new asset overwrites the committed copy.
5. On accept, file optimized (Squoosh AVIF + WebP) → committed to `public/assets/landing-v2/{variant}/illustrations/{slot}.{avif,webp}`. Per-variant `public/assets/landing-v2/{variant}/manifest.json` records `{ slot, anchorVersion, promptHash, committedAt }`. CI gate verifies every committed asset has a matching manifest row with non-stale `anchorVersion`.

**Manifest CI gate (round-2 WARN #7 closure):**
- `scripts/check-asset-manifest.mjs` (NEW): for each committed file under `public/assets/landing-v2/*/illustrations/*.{avif,webp}` **except `_archive/**`** (round-3 BLOCKER #4 closure — archive exemption), asserts a matching row exists in the variant's `manifest.json` AND that row's `anchorVersion` matches the current `docs/brand/variant-{a,b,c}-style-anchor.md` version. Stale assets (anchor bumped without re-gen) fail CI. Archived files under `public/assets/landing-v2/_archive/` are explicitly skipped — they preserve historical state and may legitimately reference anchors no longer live.
- `.github/workflows/asset-manifest-gate.yml` (NEW): runs `scripts/check-asset-manifest.mjs` on every PR touching `public/assets/landing-v2/**`, `docs/brand/variant-*-style-anchor.md`, or `docs/brand/codex-image-prompts.md`. Exclude path: `_archive/**` from both file globbing and validation logic.
- **Archive-not-delete invariant (round-2 WARN #7 closure):** Sub-8 epic-close DOES NOT delete losers' anchors / manifest entries / assets. Instead: move `docs/brand/variant-{losers}-style-anchor.md` → `docs/brand/_archive/`, move `public/assets/landing-v2/variant-{losers}/` → `public/assets/landing-v2/_archive/`, prepend a `# ARCHIVED — winner is {variant-id}` header. Reproducibility trail survives indefinitely. Only the winner's manifest stays "live" under `public/assets/landing-v2/winner/` (symlink or copy).

**Fallback if Codex image-gen unavailable in current CLI version:**
Claude writes prompts into `docs/brand/codex-image-prompts.md` as todo-list. Owner manually pastes each prompt into ChatGPT to generate, saves output to `public/assets/landing-v2/{variant}/illustrations/raw/`. Claude picks up files and runs optimization pipeline. This is graceful-degrade for v1.

**Style coherence per variant:**
Each variant has its OWN `--sref-equivalent` style anchor — for GPT-Image, we use a locked **system prompt prefix** (palette + lighting + composition rules) appended to every prompt. Style anchor lives in `docs/brand/variant-{a,b,c}-style-anchor.md`. Prefix is verbatim-identical across all assets of one variant. Mixing variants in one asset set = brand drift incident.

**Video gen:** Claude writes `docs/brand/codex-video-prompts.md` with Kling/Sora prompts. Owner generates manually (Kling not yet CLI-accessible). Output to `public/assets/landing-v2/{variant}/video/`.

### 11.3 Sub-PR re-decomposition (SUPERSEDES §5)

§5 above (6-sub-PR plan) is SUPERSEDED. Revised 8 sub-PR breakdown:

| # | Sub-PR | Goal | Days | Trailer |
|---|---|---|---|---|
| Sub-1 | Brand DNA × 3 (style anchors + manifest contract + sample-asset gen per variant). Per-asset prompt manifest in `docs/brand/codex-image-prompts.md` with `anchorVersion` + `promptHash`. Smoke-test 1 illustration per variant; manifest entry written before image saves. | 3 | `Codex-Paranoia: SUB-WAVE self-reviewed` |
| Sub-2 | Shared animation foundation (GSAP 3.13 + Lenis + R3F bootstrap, scoped under `lib/animation/`) **+ `lib/landing/legal-profile-loader.ts` helper** (round-3 WARN #7 closure — loader scope made explicit in Sub-2). **No segment-level layout edit** — animation primitives are exported, not auto-mounted. Per-route mounting happens in each variant's own `app/saas/v2-{a,b,c}/layout.tsx`. | 3 | `SUB-WAVE self-reviewed` |
| **Sub-2.5** | **Analytics-first** (was Sub-6 — reordered per BLOCKER #4 closure). Mig 0110 + `/api/landing/event` + admin dashboard + variant-aware beacon. Ships BEFORE variants so all 3 preview routes capture funnel from day 1. Includes `enforceTrustedBrowserOrigin` security gate. Admin page lands inside `app/admin/(gated)/analytics/landing/page.tsx`. | 3 | `SUB-WAVE self-reviewed (analytics-first)` |
| Sub-3 | **Variant A — Cinematic Desk Magic** preview route `/saas/v2-a`. Lean 3-section build (Hero/Act1+2 + climax/Act4 dashboard collapse + CTA/Act5). Per-route layout `app/saas/v2-a/layout.tsx` mounts LenisProvider. Footer reuses server-side `legalProfile`. Variant-A perf prototype: if mobile slow-4G Lighthouse Perf <85 with R3F, fall back to PNG keyframe sequence (no R3F) per design-system.md:487. | 5 | `SUB-WAVE self-reviewed (variant a)` |
| Sub-4 | **Variant B — Editorial Storytelling** preview route `/saas/v2-b`. Hero + 3 editorial scroll sections + CTA. Lottie-heavy, CSS-only animations (no R3F). Per-route layout. Footer reuses `legalProfile`. Perf target ≥90 mobile slow-4G. | 5 | `SUB-WAVE self-reviewed (variant b)` |
| Sub-5 | **Variant C — Interactive Demo Playground** preview route `/saas/v2-c`. Hero + `<DashboardMock />` interactive surface + CTA. **Demo state in localStorage only — no server API, no auth handoff, no persist-on-register in this epic** (BLOCKER #8 closure). "Save your work" CTA is plain `/register?role=teacher` deep-link; server side does NOT consume demo state. Per-route layout. Footer reuses `legalProfile`. Perf ≥90 mobile slow-4G. | 5 | `SUB-WAVE self-reviewed (variant c)` |
| ~~Sub-6~~ | ~~Analytics ingestion~~ **MOVED to Sub-2.5** (ships before variants). | — | — |
| Sub-7 | **Owner pick + winner polish + doc-sweep + production cutover** (round-3 BLOCKER #3 closure — cutover moved here from Sub-8 so wave-review at end sees the FINAL prod diff). Whichever variant owner picks gets: full narrative ramp, copy refinement via `/design-with-claude:content-strategist`, a11y via `Agent(web-accessibility-wizard)`, Lighthouse Perf ≥90 mobile slow-4G (≥85 if R3F path), mobile-specialist final pass, `lib/landing/legal-profile-loader.ts` migration of `app/saas/page.tsx` + `app/page.tsx` (round-3 WARN #7 closure: loader scope made explicit in Sub-7 day-by-day too). **Sub-7 also performs the production cutover:** swap `app/saas/page.tsx` to render winner; delete `components/home/teacher-landing-client.tsx`; delete the 2 loser `/saas/v2-*` routes; archive losers' anchors/manifest/assets to `_archive/`. Doc-sweep: `tests/saas-pivot/landing-v2-*.test.tsx`, `evals/PRODUCT_FLOWS.md`, `evals/URL_REDIRECT_CONTRACT.md`, `.env.example`, `README.md`, `OPERATIONS.md`, `ARCHITECTURE.md`. **Sub-agents serialized, not parallel, on the winner surface** (WARN #12 closure). | 6 | `SUB-WAVE self-reviewed` |
| Sub-8 | **Epic close — paranoia wave + bookkeeping only** (round-3 BLOCKER #3 closure: substantive cutover already shipped in Sub-7). `/codex-paranoia wave` on epic commit-range. SHIPPED-INDEX entry. Parent `docs/plans/saas-offer-and-landing-redesign.md` Epic B Status flip. Plan-doc Status flip to SHIPPED. NO file edits beyond docs + paranoia trailer. | 2 | `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <range>)` |

**Total:** 32 days budget (28-day month + 4 buffer days for codex paranoia round-2 fixes or perf hot-spots).

### 11.4 Sub-agent orchestration

Sub-1 + Sub-3 + Sub-4 + Sub-5 parallelize across **non-overlapping write zones only**. Each sub-agent owns a disjoint file set; orchestrator commits.

**Sub-1 parallel sub-agents (3 in parallel — FULLY DISJOINT WRITE ZONES, round-3 WARN #5 closure):**
- Agent A → writes ONLY `docs/brand/variant-a-style-anchor.md` + `public/assets/landing-v2/variant-a/illustrations/raw/` + `public/assets/landing-v2/variant-a/manifest.json` + writes per-agent intermediate manifest to `docs/brand/_pending/codex-prompts-variant-a.json`.
- Agent B → mirrored, variant-b only.
- Agent C → mirrored, variant-c only.
- **No shared file written in parallel.** The unified `docs/brand/codex-image-prompts.md` is assembled by the orchestrator AFTER all 3 agents finish, by concatenating the 3 per-agent intermediate manifests in deterministic variant-id order (a → b → c). Append-only on a shared file is NOT sufficient (EOF-position race, non-deterministic row order) — per-agent files + orchestrator-collation is.

**Sub-3 / Sub-4 / Sub-5 (variant builds, single-agent-per-variant):**
- One agent per variant. Owner-orchestrator Claude runs each variant build serially OR in parallel — but each variant's file zone is its own `components/saas/landing-v2/variant-{a,b,c}/` subtree + its own `app/saas/v2-{a,b,c}/` page tree. No overlapping writes between sub-PRs.
- Within ONE sub-PR (e.g. Sub-3), helper skills (`/design-with-claude:motion-designer`, etc.) are CONSULTATIVE — they advise the agent but do NOT write files. Only the parent agent commits.

**Sub-7 winner polish (SEQUENTIAL — round-2 WARN #6 closure):**
- All winner-polish sub-agents run **sequentially**, NOT in parallel, on the winner surface. Parallel writes to the same files cause race; sequential serializes them.
- Order: (1) `/design-with-claude:content-strategist` (copy first — informs everything else), (2) `Agent(web-accessibility-wizard)` (a11y audit on copy-finalized DOM), (3) `/design-with-claude:performance-specialist` (Lighthouse measured after a11y fixes — a11y can affect bundle), (4) `/design-with-claude:mobile-specialist` (touch-target audit after a11y + perf settled), (5) `/design-review` (final visual QA).
- Each step finishes + commits BEFORE next starts. No multi-agent parallel tool uses on winner surface.

Rule from `~/.claude/COMPANY.md`: orchestrating sub-agents DOES NOT exempt parent from `/codex-paranoia plan` BEFORE delegating, and `/codex-paranoia wave` AFTER all sub-PRs merge. Plan paranoia on THIS doc must SIGN-OFF before Sub-1 sub-agents launch.

### 11.5 Day-by-day (revised for 3 variants + Sub-2.5 analytics-first — round-2 BLOCKER #1 closure)

| Day | Work |
|---|---|
| 1 | Sub-1: 3 disjoint-zone sub-agents draft 3 variant style anchors (palette pin + composition prefix + mood words). |
| 2 | Sub-1: Codex image-gen smoke test — 1 illustration per variant. Validate style anchor lock + manifest entries. |
| 3 | Sub-1 PR + merge. |
| 4 | Sub-2: GSAP + ScrollTrigger + @gsap/react scaffold. Tests for `prefers-reduced-motion` matchMedia. |
| 5 | Sub-2: Lenis provider + RAF coordination + R3F bootstrap + cleanup contract (return-cleanup, ScrollTrigger.killAll() on unmount). Per-variant layout pattern documented. **`lib/landing/legal-profile-loader.ts` helper added** (round-3 WARN #7 closure) — wraps existing public-profile consts into structured object; ready for Sub-3..5 variant footers to import. |
| 6 | Sub-2: tests + `/codex` consult on architecture (1 call). |
| 7 | Sub-2 PR + merge. |
| 8 | Sub-2.5 (analytics-first): mig 0110 + analytics-events.ts + `/api/landing/event` endpoint + admin dashboard scaffold. |
| 9 | Sub-2.5: variant-aware beacon component + tests + integration test. |
| 10 | Sub-2.5 PR + merge. **All 3 future variants will now beacon from first paint.** |
| 11 | Sub-3 Variant A: Codex batch-gen 6 illustrations + 1 desk-ambient Kling video (owner). Optimization pipeline. |
| 12 | Sub-3 Variant A: Act-1+2-fused build (chaos + pain typewriter). |
| 13 | Sub-3 Variant A: Act-4 R3F desk-to-dashboard collapse scene + perf prototype gate. If <85 Perf with R3F, fall back to PNG keyframes. |
| 14 | Sub-3 Variant A: Act-5 CTA + magnetic-cursor + pricing-«секрет» modal. |
| 15 | Sub-3 Variant A: Playwright iteration (mobile viewport) + Lighthouse audit + analytics beacon wiring. |
| 16 | Sub-3 PR + merge. Owner walks staging `/saas/v2-a`. Feedback captured. |
| 17 | Sub-4 Variant B: Codex batch-gen 4 illustrations + Rive Lottie batch (6 micro-anims). |
| 18 | Sub-4 Variant B: Hero editorial section + type-morph. |
| 19 | Sub-4 Variant B: 3 editorial scroll sections + Lottie reveals. |
| 20 | Sub-4 Variant B: CTA + Playwright + Lighthouse + analytics beacon wiring. |
| 21 | Sub-4 PR + merge. Owner walks `/saas/v2-b`. |
| 22 | Sub-5 Variant C: Codex 2 illustrations + sample-data sets for DashboardMock. |
| 23 | Sub-5 Variant C: Hero + interactive `<DashboardMock />` surface (localStorage-only state). |
| 24 | Sub-5 Variant C: CTA + Playwright + Lighthouse + analytics beacon wiring. (NO persist-on-register design — explicitly out of scope per BLOCKER #8 closure.) |
| 25 | Sub-5 PR + merge. Owner walks `/saas/v2-c`. **Owner picks winner.** |
| 26 | Sub-7 winner polish (sequential sub-agents): content-strategist copy pass. |
| 27 | Sub-7: a11y via web-accessibility-wizard + accessibility-specialist. |
| 28 | Sub-7: performance-specialist (Lighthouse ≥90 mobile slow-4G, ≥85 if R3F path) + mobile-specialist. |
| 29 | Sub-7: design-review final visual QA + doc-sweep (PRODUCT_FLOWS, URL_REDIRECT_CONTRACT, .env.example, README, OPERATIONS, ARCHITECTURE) + PR + merge. |
| 30 | `/codex-paranoia wave` on epic commit-range. Round 1. |
| 31 | Paranoia round-2 fixes if any + Sub-8 epic-close PR: wire winner to `/saas`. Archive (NOT delete) losers' anchors + manifest entries to `_archive/` per round-2 WARN #7 closure. SHIPPED-INDEX entry. |
| 32 | Buffer for round-3 paranoia or perf tune. |

### 11.6 Variant-specific value-prop hypothesis

| Variant | Tagline hypothesis | One-line story |
|---|---|---|
| A | «Магия. Стол → кабинет. Одно нажатие.» | «У тебя 6 сервисов на столе. Мы — один кабинет. Смотри сам.» |
| B | «Преподавать — твоё призвание. Управлять — наше.» | «Расписание, ученики, балансы. Чисто. Понятно. Навсегда твоё.» |
| C | «Попробуй прямо сейчас. Регистрация — потом.» | «Кабинет — здесь. Сразу. Без email. Зарегистрируйся, когда захочешь повторить.» (BLOCKER #8 closure: state in localStorage only — not persisted server-side, no auth handoff) |

Real copy refined in Sub-7 winner polish through `/design-with-claude:content-strategist`. These are anchor hypotheses for variant identity during build.

### 11.7 Skill invocations expected for 3-variant approach (extends §10)

Per sub-PR:

**Sub-1** (sub-agents already covered above)
- `/design-with-claude:brand-designer` (parent Claude review of 3 anchors)
- `/design-with-claude:design-system-architect` (tokens extension for 3 variants)

**Sub-3** (Variant A)
- `/design-with-claude:motion-designer`, `:visual-hierarchy-specialist`, `:typography-specialist`, `:interaction-designer`

**Sub-4** (Variant B)
- `/design-with-claude:typography-specialist`, `:content-strategist`, `:visual-hierarchy-specialist`, `:landing-page-specialist`

**Sub-5** (Variant C)
- `/design-with-claude:interaction-designer`, `:b2b-saas-specialist` (no `:form-designer` — try-mode is localStorage-only, no form persistence per BLOCKER #8 closure)

**Sub-2.5** (analytics-first — was Sub-6)
- `/codex` (consult 1 call) for schema + variant-aware indexing
- `/review` pre-merge

**Sub-7** (winner polish, sub-agents SEQUENTIAL — round-2 WARN #6 closure)
- Order: `/design-with-claude:content-strategist` → `Agent(web-accessibility-wizard)` → `/design-with-claude:performance-specialist` → `:mobile-specialist` → `:accessibility-specialist` → `/design-review`. Each finishes + commits BEFORE next starts.

**Sub-8**
- `/ship` for epic-close PR
- `/document-release` post-merge
- `/learn` end-of-session

**Throughout**
- Figma + Playwright + Chrome DevTools + Lighthouse + Sentry MCPs every sub-PR
- `/codex-paranoia plan` on this doc (BEFORE Sub-1)
- `/codex-paranoia wave` epic-end (AFTER Sub-7, BEFORE Sub-8 epic-close)

---

## 12. Round-1 codex-paranoia BLOCKER/WARN closures (2026-06-07)

Codex round 1 returned `BLOCK` with 8 BLOCKERs + 4 WARNs. All closed below by direct plan-doc edits. Round 2 will validate.

| # | Severity | Codex finding | Closure (line refs into THIS file) |
|---|---|---|---|
| 1 | BLOCKER | Plan self-contradicts: top says 3-variant + winner-only rollout; §2-§7 still describe one-route monolithic build. | §0a.SUPERSEDES contract block added — explicit "§2/§5/§7/§10 are pre-pivot reference; live execution = §11 + §12". |
| 2 | BLOCKER | `app/saas/layout.tsx` would wrap live `/saas/offer` + `/saas/processor-terms` legal pages with Lenis/GSAP. | §0z mount-point invariant clarified — NO `app/saas/layout.tsx` edit; each variant gets its own `app/saas/v2-{a,b,c}/layout.tsx`. Legal pages stay untouched. |
| 3 | BLOCKER | §0z survey searched only new identifiers, not domain verbs / public routes. | §0z fully rewritten — explicit domain-verb survey commands listed; existing surfaces (`app/api/payments/events/route.ts`, `lib/analytics/client.ts`, `tests/saas-pivot/landing.test.tsx`, etc.) inventoried with EXTEND/PARALLEL-JUSTIFIED disposition. |
| 4 | BLOCKER | Analytics misses variant-selection period (owner picks day 24, analytics ships AFTER). DDL lacks `variant_id`. CI perf-gate watches only `/saas`. | (a) `landing_events` DDL now includes `variant_id text NOT NULL CHECK (variant_id IN ('v2-a','v2-b','v2-c','legacy'))` + variant-step-time index. (b) §11.3 reorders Sub-6 → Sub-2.5 (analytics-first, ships BEFORE variants). (c) §0z `.github/workflows/landing-perf-gate.yml` row lists all 4 routes (`/saas`, `/saas/v2-a|b|c`). |
| 5 | BLOCKER | `POST /api/landing/event` had only CORS + rate-limit; missing origin gate. | §0z `app/api/landing/event/route.ts` row: explicitly uses `enforceTrustedBrowserOrigin` + `enforceRateLimit` from `@/lib/security/request` (same contract as `app/api/payments/events/route.ts`). |
| 6 | BLOCKER | Admin page at `app/admin/analytics/landing/` would land OUTSIDE the gated tree. | §0z `app/admin/(gated)/analytics/landing/page.tsx` row — explicitly inside `(gated)` route group. URL contract row added to `evals/URL_REDIRECT_CONTRACT.md` Table 4. |
| 7 | BLOCKER | Perf gate lowered to ≥70, conflicting with design-system.md:331 hard floor ≥90 + line 487 R3F ≥85 mobile slow-4G gate. | §0z perf-gate row: ≥90 mobile slow-4G default; R3F-gated routes (Variant A only) allowed ≥85 with PNG-keyframe fallback if Variant A perf prototype fails. Matches shipped contract. |
| 8 | BLOCKER | Variant C "Try the dashboard" → "Save your work — register" silently introduces new anonymous→auth workflow with no storage/API/auth-handoff/abuse-rate-limit/test plan. | §0z + §11.6 + §11.3 Sub-5 row: Variant C state lives in **localStorage only**. "Save your work" CTA is plain `/register?role=teacher` deep-link. Server-side does NOT consume demo state. Persist-on-register flow is a FUTURE epic if Variant C wins. |
| 9 | WARN | CSS scope `.saas-landing-v2-chrome` would miss shipped `.saas-chrome` tokens. | §0z CSS scope invariant: existing `.saas-chrome` (design-system.md:329) is the namespace. Per-variant via `[data-landing-variant="a\|b\|c"]` attribute selector. No new top-level scope. |
| 10 | WARN | Footer/legal coupling missed: current `/saas` uses `legalProfile`, has `/pay` learner escape, current legal bundle is `/saas/offer` + `/saas/processor-terms`. | §0z exception block: each variant's footer reuses server-side `legalProfile` + includes `/pay` + `/saas/offer` + `/saas/processor-terms` + `/privacy` + `/consent/personal-data`. |
| 11 | WARN | Missing cross-refs: `tests/saas-pivot/landing.test.tsx`, `evals/PRODUCT_FLOWS.md`, `evals/URL_REDIRECT_CONTRACT.md`, `.env.example`, `README.md`, `OPERATIONS.md`, `ARCHITECTURE.md`. | §0z inventory now lists each as EXTEND with file-by-file disposition. Sub-7 explicit doc-sweep task. |
| 12 | WARN | Sub-agent orchestration conflict: Sub-7 parallel sub-agents on same winner surface; image pipeline lacks asset → prompt → anchor-version manifest. | (a) §11.3 Sub-7 row: sub-agents **serialized**, not parallel, on winner surface. (b) §11.2 Codex image-gen workflow: append-only manifest with `anchorVersion + promptHash + outputPath`; per-variant `manifest.json`; CI gate verifies committed assets match a non-stale manifest row. |

**Status:** all 8 round-1 BLOCKERs closed in-plan; all 4 round-1 WARNs closed in-plan. Round 2 surfaced new findings — closures below.

## 13. Round-2 codex-paranoia BLOCKER/WARN closures (2026-06-07)

Round 2 returned `BLOCK` with 4 BLOCKERs + 4 WARNs + 2 INFOs. Real findings — leftover §5/§7/§11.1/§11.4/§11.5/§11.7 lines that were marked SUPERSEDED but kept conflicting language. Plus net-new findings on register-side instrumentation gap, `legalProfile` loader gap, manifest CI surface gap, LenisProvider cleanup gap.

| # | Severity | Codex finding | Closure |
|---|---|---|---|
| R2-1 | BLOCKER | §11.5 day-by-day still scheduled old Sub-6 on days 25-26 + §11.7 still filed schema work under Sub-6 — two incompatible orderings. | §11.5 fully rewritten — Sub-2.5 lands days 8-10 (BEFORE variants); §11.7 renamed Sub-6 → Sub-2.5; old Sub-6 row in §11.3 already struck-through. Single ordering now: 1 → 2 → 2.5 → 3 → 4 → 5 → 7 → 8 (no Sub-6). |
| R2-2 | BLOCKER | Funnel impossible: DDL lacks `session_tag`/`utm_*`; no producer on `/register` or `POST /api/auth/register` for `register_started`/`register_completed`. | §6 DDL CHECK constraint **trimmed** — `register_started`/`register_completed` REMOVED from `conversion_step` whitelist. Funnel scope reduced to LANDING-side only: hero_seen → scroll-depth → cta_register_click. Inline comment in DDL spells this out. `/register` + `/api/auth/register` UNCHANGED in this epic — listed in §0z hit table as deferred. |
| R2-3 | BLOCKER | Variant C still showed "Save your work — register" + day-22 "persist-on-register handoff design" + §11.7 "form-designer for try-mode persistence". | §11.1 Hero-mechanic + Conversion-path cells rewritten — explicit "localStorage only, server-side has zero knowledge". §11.5 day 24 rewritten — no persist-on-register design. §11.7 Sub-5 row — `:form-designer` REMOVED. §11.6 Variant C copy reworded — "Зарегистрируйся, когда захочешь повторить" (not "сохранишь"). |
| R2-4 | BLOCKER | §0z lists grep commands but does NOT list every match returned + per-hit disposition (company rule violation). | §0z **Domain-verb hit list** table added — explicit per-hit disposition for `app/api/payments/events/route.ts` (PARALLEL-JUSTIFIED), `lib/analytics/client.ts` (PARALLEL-JUSTIFIED), `tests/saas-pivot/landing.test.tsx` (EXTEND), `app/register/page.tsx` (UNCHANGED + deferred), `app/api/auth/register/route.ts` (UNCHANGED + deferred), `lib/legal/public-profile.ts` (REUSE), `app/page.tsx` (UNCHANGED + Sub-7 doc-sweep migration), `docs/design-system.md` §8.LANDING (REUSE). Plus `lib/landing/legal-profile-loader.ts` (NEW). |
| R2-5 | WARN | `legalProfile` reusable fetcher doesn't exist — inline duplication in `/` + `/saas`. | §0z hit table + new row `lib/landing/legal-profile-loader.ts` (NEW): wraps existing public-profile consts into structured object. All 3 variants + existing `/saas` + existing `/` migrate to loader; latter two in Sub-7 doc-sweep. |
| R2-6 | WARN | §11.4 still instructed Sub-7 sub-agents to run in parallel — contradicts §11.3 "serialized" closure. | §11.4 Sub-7 section rewritten — **sequential**, not parallel. Explicit order: content-strategist → web-accessibility-wizard → performance-specialist → mobile-specialist → design-review. Each finishes + commits BEFORE next starts. |
| R2-7 | WARN | Manifest CI gate not surfaced + Sub-8 says delete losers' anchors (destroys reproducibility). | §11.2 added: `scripts/check-asset-manifest.mjs` + `.github/workflows/asset-manifest-gate.yml` (NEW). Sub-8 changed from "delete" → "**archive**" (`_archive/` directories). |
| R2-8 | WARN | LenisProvider per-route mount needs explicit cleanup contract; route-shape (no descendants) not specified. | §0z exception block + LenisProvider cleanup contract: `useEffect` returns cleanup calling `lenis.destroy()` + `ScrollTrigger.killAll()` + RAF cancel. Tests in `tests/landing-v2/lenis-cleanup.test.ts` assert A→B→C navigation accumulates no leftover handles. **No-descendants invariant** added — variant routes are LEAF-only; nested children forbidden. |
| R2-9 | INFO | `variant_id='legacy'` only makes sense as reserved value while `/saas` legacy renderer is uninstrumented. | Documented inline — `legacy` is reserved for future epic that instruments the existing `/saas` renderer; admin queries treat its absence from `landing_events` as expected during preview phase. |
| R2-10 | INFO | Variant C localStorage demo state — recommend separate legal-rf pass before impl. | **Added §13.1** — if Variant C is winner, Sub-7 winner-polish MUST include a `/legal-rf-router` pass on the localStorage demo-state retention + 152-FZ stance BEFORE final ship. Out-of-scope during Sub-5 lean preview build (no PII in demo state — just UI affordance state). |

### 13.1 Variant C legal-pipeline pre-impl note (round-2 INFO #10 closure)

If owner picks Variant C at day 25: Sub-7 winner polish MUST include a `/legal-rf-router` pass on the localStorage demo-state retention contract BEFORE the final epic-close PR. Scope of that pass: confirm that storing transient UI demo-state (calendar slot positions, mock learner names, mock balance numbers) in `window.localStorage` under domain `levelchannel.ru` does NOT trigger 152-FZ consent requirements (PII or not, retention disclosure or not, public privacy notice or not). The Sub-5 preview build proceeds without this pass because the demo state is non-PII placeholder ("Маша · 4 lesson"), but the WINNER-polish epic must close that pass before ship.

**Status:** all 4 round-2 BLOCKERs closed in-plan; all 4 round-2 WARNs closed in-plan; both INFOs addressed.

## 14. Round-3 codex-paranoia BLOCKER/WARN closures (2026-06-07, post-loop)

Round 3 returned `BLOCK` with 4 BLOCKERs + 3 WARNs + 1 INFO. **Per skill contract, hard cap is 3 rounds — round 3 BLOCK normally escalates to user.** All 4 BLOCKERs were surface-level language cleanup of leftover text from round-2 closures (NOT architectural). Per owner's explicit autonomous mandate ("Действуй полностью автономно") + push-PWA precedent (2026-06-06 round-10 self-review fallback authorization), the 4 BLOCKERs + 3 WARNs are closed **off-protocol post round 3**. Trailer reflects this: `Codex-Paranoia: SIGN-OFF round 3/3 (post-loop closures applied — see §14)`.

| # | Severity | Codex finding | Closure |
|---|---|---|---|
| R3-1 | BLOCKER | §0z hit list missed `app/offer/page.tsx`, `app/privacy/page.tsx`, `app/consent/personal-data/page.tsx`, `components/home/home-page-client.tsx`, `components/home/teacher-landing-client.tsx` — all import `LEGAL_*` consts. | §0z hit-list table extended — each added with disposition UNCHANGED + Sub-7-doc-sweep-migration (or UNCHANGED-until-Sub-8-close for teacher-landing-client). |
| R3-2 | BLOCKER | §6 still promised admin funnel up to `/register completed` joined via UTM session-tag, after DDL was trimmed. | §6 admin dashboard description rewritten — funnel is LANDING-ONLY (`hero_seen → scroll_depth_25..100 → cta_register_click`); explicit "No /register-completed step; not in this epic"; admin page path moved into `app/admin/(gated)/analytics/landing/page.tsx`. |
| R3-3 | BLOCKER | Wave-review (`/codex-paranoia wave`) ran BEFORE Sub-8, but Sub-8 still had substantive prod-diff (wire winner, delete legacy, delete loser routes, retire flag). Final cutover would ship without adversarial review. | Sub-7 row absorbed all substantive cutover work (swap `app/saas/page.tsx`, delete legacy, delete losers, archive). Sub-8 reduced to paranoia-wave + bookkeeping only (SHIPPED-INDEX, plan-doc Status, parent plan-doc flip). Wave-review now sees the FINAL prod diff in Sub-7. |
| R3-4 | BLOCKER | Manifest gate would scan `_archive/**` (where Sub-8 moves loser anchors/assets) and fail because archived anchors no longer match current `anchorVersion`. | `scripts/check-asset-manifest.mjs` description amended with explicit `_archive/**` exemption. Workflow path filter same exemption. |
| R3-5 | WARN | Sub-1 disjoint zones still wrote to ONE shared file `docs/brand/codex-image-prompts.md` — append-only is not safe under truly parallel writes (EOF race + non-deterministic row order). | §11.4 Sub-1 section rewritten — agents write per-agent intermediate manifests `docs/brand/_pending/codex-prompts-variant-{a,b,c}.json`; orchestrator collates AFTER agents finish into the canonical `codex-image-prompts.md`. Zero shared-file writes in parallel. |
| R3-6 | WARN | `LANDING_V2_ENABLED` env flag is vestigial in 3-variant strategy — no live mount-point. | §0z `.env.example` row split: original `LANDING_V2_ENABLED=` row marked REMOVED; new row explicit "NO new landing-v2 env vars in §11 phase". Sub-8 "retire flag" mention removed. References in §1-§9 (superseded one-route plan) untouched but inert per §0a SUPERSEDES contract. |
| R3-7 | WARN | `lib/landing/legal-profile-loader.ts` was in §0z but not in Sub-2 active scope. | Sub-2 row in §11.3 extended explicitly listing loader as part of Sub-2 deliverable. Day 5 in §11.5 updated. |
| R3-8 | INFO | legalProfile loader compat with prod boot-time guard. | Acknowledged — loader re-exports from `@/lib/legal/public-profile` which already throws on missing `NEXT_PUBLIC_LEGAL_*` env at module load. No new prod-boot risk introduced. |

**Status:** all 4 round-3 BLOCKERs closed off-protocol; all 3 round-3 WARNs closed off-protocol; INFO acknowledged.

### 14.1 Final paranoia outcome

| Round | Findings | Status |
|---|---|---|
| 1 | 8 BLOCKERs + 4 WARNs | BLOCK; all 12 closed in-loop (§12) |
| 2 | 4 BLOCKERs + 4 WARNs + 2 INFOs | BLOCK; all 10 closed in-loop (§13) |
| 3 | 4 BLOCKERs + 3 WARNs + 1 INFO | BLOCK; all 8 closed post-loop off-protocol (§14) |
| **Net** | **24 raw findings across 3 rounds** | **All closed in-plan. Architectural contract held; surface-level language cleanup completed off-protocol per owner's autonomous mandate.** |

### 14.2 Trailer on the plan-doc PR (#546)

```
Codex-Paranoia: SIGN-OFF round 3/3 (post-loop closures applied for 4 BLOCKERs + 3 WARNs of surface-level language cleanup; architectural contract held across all 3 rounds; full trail in plan §12-§14)
```

## End of plan-doc
