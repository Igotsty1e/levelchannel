# SaaS landing Tier-1 v2 — cinematic scroll-driven rebuild (2026-06-06)

**Status:** plan draft (round 0 — to be run through `/codex-paranoia plan` BEFORE first impl PR).
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

**Visual diversification rule:** each variant occupies a distinct point in design-direction space — different MJ `--sref` codes, different palettes within brand range, different layout philosophy. Three variants must look **visibly different** so owner gets a real choice (not three flavours of the same thing). Definitions in §11 below.

**Image generation via Codex:** all illustrations + state variants are generated via Codex CLI calling GPT-Image-1 (owner has ChatGPT Pro subscription which enables this). Claude writes prompt brief → Codex executes generation → output deposited to `public/assets/landing-v2/{variant}/`. Pipeline detail in §11.4. Kling 2.1 / Sora 2 video gen remains the owner's hands-on workflow (Claude provides briefs in `docs/brand/codex-video-prompts.md`).

---

## 0z. Existing surface inventory

Surveyed via `grep -rln "landing_events\|scroll-spine\|saas-landing-tier1-v2\|analytics-beacon\|/api/landing/event" .` on 2026-06-06 → **no hits**. All-new identifiers — green for greenfield naming.

Per company contract (Survey-before-plan rule). NEW = create; EXTEND = touch existing; REPLACE = swap.

| Surface | Status | Existing-surface check |
|---|---|---|
| `app/saas/page.tsx` | EXTEND | exists (46 lines). Swap `<TeacherLandingClient />` to `<SaasLanding />` from new namespace. `metadata.robots: noindex` KEEP until launch flip (separate SEO epic). |
| `components/saas/landing-v2/saas-landing.tsx` | NEW (composition root) | grep → does not exist. New namespace `components/saas/landing-v2/` is the entire visual surface. |
| `components/saas/landing-v2/sections/{act-1-chaos,act-2-pain,act-3-broken,act-4-product,act-5-cta}.tsx` | NEW (5 acts) | each is its own client component bound to one segment of the GSAP scroll spine. |
| `components/saas/landing-v2/scenes/desk-chaos-scene.tsx` | NEW (R3F 3D) | three.js scene rendered ONLY inside Act 1 + transition into Act 4. `next/dynamic({ ssr: false })` import. |
| `components/saas/landing-v2/scenes/dashboard-collapse-scene.tsx` | NEW (R3F 3D) | the climactic Act 4 sequence — desk items magic-collapse into a 3D-rendered `/teacher/dashboard` mock surface. |
| `components/saas/landing-v2/analytics-beacon.tsx` | NEW | client-only IntersectionObserver + scroll-depth + CTA hooks → `navigator.sendBeacon()` to ingestion endpoint. |
| `components/home/teacher-landing-client.tsx` | DELETE | 1327-line legacy v0 + polish file. Removed in Sub-5 close-PR after `/saas` swap green. |
| `lib/animation/scroll-spine.ts` | NEW | single GSAP timeline-of-truth wrapping the 5-act sequence. ONE `gsap.matchMedia` block for `prefers-reduced-motion` swap. |
| `lib/animation/lenis-provider.tsx` | NEW | RAF-coordinated Lenis instance feeding `ScrollTrigger.update()` + R3F `useFrame()`. |
| `lib/landing/analytics-events.ts` | NEW | typed event schema + `recordLandingEvent` client helper. |
| `app/api/landing/event/route.ts` | NEW | POST endpoint, rate-limited per IP, schema-validated, advisory-lock-free (high-throughput append-only). |
| `app/admin/analytics/landing/page.tsx` | NEW (admin) | operator funnel dashboard: hero seen → pricing seen → register click → register completed. Heatmap section-depth. Drop-off moments. |
| `migrations/0110_landing_events.sql` | NEW | single concern: `landing_events` table + cookie-less `session_id` partial unique idx + partial index `occurred_at`. Slot 0110 verified free (last mig 0109). |
| `docs/brand/mj-style-anchor.md` | NEW | MJ v7 `--sref` code + palette + prompt template + 5-illuminant rule. Anchor doc for ALL AI gen. |
| `public/assets/landing-v2/` | NEW (asset dir) | optimized SVG/WebP/AVIF/H.265 from AI pipeline. |
| `docs/design-system.md` §8.LANDING | REUSE | tokens shipped PR #443. NO new motion tokens added — landing-v2 is the consumer. |
| `package.json` deps | EXTEND | add: `gsap@^3.13`, `@gsap/react@^2.x`, `lenis@^1.2`, `@react-three/fiber@^9.x`, `@react-three/drei@^9.x`, `three@^0.169`, `@lottiefiles/dotlottie-react@^0.40`. Framer Motion already present — keep. |
| `.github/workflows/landing-perf-gate.yml` | NEW | CI gate runs Lighthouse mobile-slow-4G on `/saas`, fails if Perf <70 or LCP >2.5s. |

**Exception (does NOT change):**
- `app/offer/page.tsx`, `app/privacy/page.tsx`, `app/cabinet/**`, `app/teacher/**`, `app/admin/**` (except added `analytics/landing`), `app/api/teacher/**`, `app/api/admin/**` — out of scope. Landing-v2 is **isolated under `components/saas/landing-v2/` + `app/saas/page.tsx` + the 3 listed API/admin additions**. Token bleed prevention: all new CSS scoped under `.saas-landing-v2-chrome` selector.

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
- `app/admin/analytics/landing/page.tsx` (NEW) — operator dashboard:
  - Funnel: `hero_seen → act_2_seen → act_3_seen → act_4_seen → act_5_seen → cta_register_click → /register completed`
  - Section drop-off table.
  - Viewport breakdown (mobile / tablet / desktop counts).
  - Last 24h / 7d / 30d toggles.
  - Conversion attribution: % cta_register_click that completed `/register` (joined via UTM param session-tag).
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
  session_id text NOT NULL,
  ua_hash text NOT NULL,
  viewport_w int,
  viewport_h int,
  ref_host text,
  scroll_depth_pct int CHECK (scroll_depth_pct BETWEEN 0 AND 100),
  section_seen text CHECK (section_seen IN (
    'hero','act_1_chaos','act_2_pain','act_3_broken','act_4_product','act_5_cta','footer'
  )),
  cta_clicked text CHECK (cta_clicked IN (
    'register_primary','pricing_modal_open','pricing_modal_close','footer_link'
  )),
  conversion_step text CHECK (conversion_step IN (
    'landing_view','scroll_25','scroll_50','scroll_75','scroll_100','cta_click','register_started','register_completed'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

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
| **Hero mechanic** | Scattered desk items collapsing via 3D R3F into `/teacher/dashboard` | Massive serif/sans type-morph statements, scroll-revealed editorial paragraphs, real product screenshots | Live-feel mocked dashboard surface — user can hover/click to "try" features without registration |
| **3D usage** | Heavy (R3F desk + dashboard scenes) | Minimal (only optional accent) | None (focus on real product UI) |
| **Lottie usage** | Few accents | Heavy (illustrative micro-animations) | Few accents |
| **Copy density** | Sparse (3-5 word headlines per act) | Long (editorial paragraphs, quote-grade statements) | Medium (UI labels + 1-2 sentence per feature) |
| **Conversion path** | Magnetic CTA at climactic act-4-5 | CTAs distributed through editorial sections | "Try the dashboard" → "Save your work — register" |
| **Best for buyer type** | Emotional / brand-driven / premium-feel seekers | Rational / comparison-shoppers / content-rich evaluators | Pragmatic / engineer-mindset / try-before-buy |
| **Route** | `/saas/v2-a` | `/saas/v2-b` | `/saas/v2-c` |
| **Lean scope** | Hero (Act 1+2 fused) + climax (Act 4) + CTA (Act 5). Acts 3 cut. | Hero + 3 editorial scroll sections + CTA. | Hero + interactive dashboard mock + CTA. |
| **Asset count (lean)** | 6 illustrations + R3F desk-collapse scene + 1 video loop | 4 illustrations + 6 Lottie micro-anims + 3 product screenshots | 2 illustrations + full `<DashboardMock />` interactive component + 2 sample-data sets |
| **Estimated dev days** | 5 days | 5 days | 5 days |

### 11.2 Codex image-gen pipeline

Per owner directive, Codex CLI handles image generation (GPT-Image-1 via ChatGPT Pro auth).

**Workflow per variant per asset:**
1. Claude writes brief into `docs/brand/codex-image-prompts.md` with: variant id, asset slot, prompt text, palette hex, aspect ratio, output filename.
2. Claude invokes Codex via `codex exec -p "$(cat docs/brand/codex-image-prompts.md | jq -r '.assets[ID].prompt')"` — Codex generates image, saves to local path.
3. Claude reads file, validates aspect ratio + palette adherence via Chrome DevTools MCP color-picker pass.
4. If drift detected (palette wrong / composition wrong), Claude updates prompt + re-invokes.
5. On accept, file optimized (Squoosh AVIF + WebP) → committed to `public/assets/landing-v2/{variant}/illustrations/`.

**Fallback if Codex image-gen unavailable in current CLI version:**
Claude writes prompts into `docs/brand/codex-image-prompts.md` as todo-list. Owner manually pastes each prompt into ChatGPT to generate, saves output to `public/assets/landing-v2/{variant}/illustrations/raw/`. Claude picks up files and runs optimization pipeline. This is graceful-degrade for v1.

**Style coherence per variant:**
Each variant has its OWN `--sref-equivalent` style anchor — for GPT-Image, we use a locked **system prompt prefix** (palette + lighting + composition rules) appended to every prompt. Style anchor lives in `docs/brand/variant-{a,b,c}-style-anchor.md`. Prefix is verbatim-identical across all assets of one variant. Mixing variants in one asset set = brand drift incident.

**Video gen:** Claude writes `docs/brand/codex-video-prompts.md` with Kling/Sora prompts. Owner generates manually (Kling not yet CLI-accessible). Output to `public/assets/landing-v2/{variant}/video/`.

### 11.3 Sub-PR re-decomposition (SUPERSEDES §5)

§5 above (6-sub-PR plan) is SUPERSEDED. Revised 8 sub-PR breakdown:

| # | Sub-PR | Goal | Days | Trailer |
|---|---|---|---|---|
| Sub-1 | Brand DNA × 3 (style anchors + sample-asset gen for each variant) | Lock 3 visual DNAs. Each variant gets 1 illustration generated as smoke-test before batch. | 3 | `Codex-Paranoia: SUB-WAVE self-reviewed` |
| Sub-2 | Shared animation foundation (GSAP 3.13 + Lenis + R3F bootstrap, scoped under `lib/animation/`). LenisProvider mounted in `app/saas/layout.tsx`. | 4 | `SUB-WAVE self-reviewed` |
| Sub-3 | **Variant A — Cinematic Desk Magic** preview route `/saas/v2-a`. Lean 3-section build (Hero/Act1+2 + climax/Act4 dashboard collapse + CTA/Act5). Assets generated via Codex pipeline. | 5 | `SUB-WAVE self-reviewed (variant a)` |
| Sub-4 | **Variant B — Editorial Storytelling** preview route `/saas/v2-b`. Hero + 3 editorial scroll sections + CTA. Lottie-heavy. | 5 | `SUB-WAVE self-reviewed (variant b)` |
| Sub-5 | **Variant C — Interactive Demo Playground** preview route `/saas/v2-c`. Hero + `<DashboardMock />` interactive surface + CTA. | 5 | `SUB-WAVE self-reviewed (variant c)` |
| Sub-6 | Shared analytics ingestion (mig 0110 + `/api/landing/event` + admin dashboard). Beacon variant-aware (`variant_id` column added to schema). | 3 | `SUB-WAVE self-reviewed` |
| Sub-7 | **Owner pick + winner polish.** Whichever variant owner picks goes through: full 5-act (or full editorial / full demo) ramp, copy refinement via `/design-with-claude:content-strategist`, a11y via `Agent(web-accessibility-wizard)`, Lighthouse Perf ≥70 mobile / ≥90 desktop, mobile-specialist final pass. | 5 | `SUB-WAVE self-reviewed` |
| Sub-8 | **Epic close.** Flip `LANDING_V2_ENABLED=1` default ON in `/saas`. Delete legacy `components/home/teacher-landing-client.tsx`. Delete 2 losing variant routes. SHIPPED-INDEX entry. Parent `docs/plans/saas-offer-and-landing-redesign.md` Epic B Status flip. | 2 | `Codex-Paranoia: SIGN-OFF round N/3 (epic-end on <range>)` |

**Total:** 32 days budget (28-day month + 4 buffer days for codex paranoia round-2 fixes or perf hot-spots).

### 11.4 Sub-agent orchestration (per owner directive — Claude orchestrator + parallel sub-agents)

Sub-1 + Sub-3 + Sub-4 + Sub-5 each parallelizable via sub-agents:

**Sub-1 parallel sub-agents (3 in parallel):**
- `Agent(subagent_type=general-purpose)` × 3, one per variant. Each generates: style anchor doc + smoke-test single illustration prompt + palette pin + composition-rules-prefix. Reports back to orchestrator. Orchestrator commits all 3 anchor docs.

**Sub-3 parallel sub-agents (Variant A build):**
- `Agent(subagent_type=general-purpose)` for the R3F desk-collapse scene (heaviest tech).
- Orchestrator Claude writes the React composition (`act-1+2-fused.tsx`, `act-4-collapse.tsx`, `act-5-cta.tsx`).
- `/design-with-claude:motion-designer` for easing review.
- `/design-with-claude:visual-hierarchy-specialist` for camera angle.

**Sub-4 parallel sub-agents (Variant B build):**
- `Agent(subagent_type=general-purpose)` for the editorial Lottie batch generation (Rive auth + export).
- `/design-with-claude:typography-specialist` for editorial type-scale.
- `/design-with-claude:content-strategist` for the editorial-grade prose.

**Sub-5 parallel sub-agents (Variant C build):**
- `Agent(subagent_type=general-purpose)` for the `<DashboardMock />` interactive surface (heaviest UI).
- `/design-with-claude:interaction-designer` for try-without-register UX.
- `/design-with-claude:b2b-saas-specialist` for value-prop framing.

**Sub-7 parallel sub-agents (winner polish):**
- `Agent(subagent_type=web-accessibility-wizard)` — WCAG 2.1 AA audit.
- `/design-with-claude:performance-specialist` — Lighthouse perf gate.
- `/design-with-claude:mobile-specialist` — touch-target + thumb-zone audit.
- `/design-with-claude:content-strategist` — final copy polish.
- All run in parallel from orchestrator Claude in a single message with multiple Agent tool uses.

Rule from `~/.claude/COMPANY.md`: orchestrating sub-agents DOES NOT exempt parent from `/codex-paranoia plan` BEFORE delegating, and `/codex-paranoia wave` AFTER all sub-PRs merge. Plan paranoia on THIS doc must SIGN-OFF before Sub-1 sub-agents launch.

### 11.5 Day-by-day SUPERSEDED (revised for 3 variants)

| Day | Work |
|---|---|
| 1 | Sub-1: 3 parallel sub-agents draft 3 variant style anchors (palette pin + composition prefix + mood words). |
| 2 | Sub-1: Codex image-gen smoke test — 1 illustration per variant. Validate style anchor lock. |
| 3 | Sub-1 PR + merge. |
| 4 | Sub-2: GSAP + ScrollTrigger + @gsap/react scaffold. Tests for `prefers-reduced-motion` matchMedia. |
| 5 | Sub-2: Lenis provider + RAF coordination + R3F bootstrap. Feature flag default OFF. |
| 6 | Sub-2: tests + `/codex` consult on architecture (1 call). |
| 7 | Sub-2 PR + merge. |
| 8 | Sub-3 Variant A: Codex batch-gen 6 illustrations + 1 desk-ambient Kling video (owner). Optimization pipeline. |
| 9 | Sub-3 Variant A: Act-1+2-fused build (chaos + pain typewriter). |
| 10 | Sub-3 Variant A: Act-4 R3F desk-to-dashboard collapse scene. |
| 11 | Sub-3 Variant A: Act-5 CTA + magnetic-cursor + pricing-«секрет» modal. |
| 12 | Sub-3 Variant A: Playwright iteration (mobile viewport) + Lighthouse audit. |
| 13 | Sub-3 PR + merge. Owner walks staging `/saas/v2-a`. Feedback captured. |
| 14 | Sub-4 Variant B: Codex batch-gen 4 illustrations + Rive Lottie batch (6 micro-anims). |
| 15 | Sub-4 Variant B: Hero editorial section + type-morph. |
| 16 | Sub-4 Variant B: 3 editorial scroll sections + Lottie reveals. |
| 17 | Sub-4 Variant B: CTA + distributed conversion points. |
| 18 | Sub-4 Variant B: Playwright + Lighthouse. |
| 19 | Sub-4 PR + merge. Owner walks `/saas/v2-b`. |
| 20 | Sub-5 Variant C: Codex 2 illustrations + sample-data sets for DashboardMock. |
| 21 | Sub-5 Variant C: Hero + interactive `<DashboardMock />` surface. |
| 22 | Sub-5 Variant C: Try-without-register flow + persist-on-register handoff design. |
| 23 | Sub-5 Variant C: CTA + Playwright + Lighthouse. |
| 24 | Sub-5 PR + merge. Owner walks `/saas/v2-c`. **Owner picks winner.** |
| 25 | Sub-6: mig 0110 + analytics-events.ts + endpoint + beacon variant-aware. |
| 26 | Sub-6: admin dashboard + tests. PR + merge. |
| 27 | Sub-7 winner polish: full ramp (5-act OR editorial-extended OR demo-extended), copy via content-strategist, a11y via web-accessibility-wizard, Lighthouse perf. |
| 28 | Sub-7 PR + merge. |
| 29 | `/codex-paranoia wave` on epic commit-range. Round 1. |
| 30 | Paranoia round-2 fixes if any. |
| 31 | Sub-8 epic-close PR. Flag default ON. Legacy delete. 2 losing variant routes deleted. SHIPPED-INDEX. |
| 32 | Buffer for round-3 paranoia or perf tune. |

### 11.6 Variant-specific value-prop hypothesis

| Variant | Tagline hypothesis | One-line story |
|---|---|---|
| A | «Магия. Стол → кабинет. Одно нажатие.» | «У тебя 6 сервисов на столе. Мы — один кабинет. Смотри сам.» |
| B | «Преподавать — твоё призвание. Управлять — наше.» | «Расписание, ученики, балансы. Чисто. Понятно. Навсегда твоё.» |
| C | «Попробуй прямо сейчас. Регистрация — потом.» | «Кабинет — здесь. Сразу. Без email. Понравится — сохранишь.» |

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
- `/design-with-claude:interaction-designer`, `:b2b-saas-specialist`, `:form-designer` (for try-mode persistence)

**Sub-6**
- `/codex` (consult 1 call) for schema + variant-aware indexing
- `/review` pre-merge

**Sub-7** (winner polish, sub-agents in parallel)
- `Agent(web-accessibility-wizard)`, `/design-with-claude:performance-specialist`, `:mobile-specialist`, `:content-strategist`, `:accessibility-specialist`, `/design-review`

**Sub-8**
- `/ship` for epic-close PR
- `/document-release` post-merge
- `/learn` end-of-session

**Throughout**
- Figma + Playwright + Chrome DevTools + Lighthouse + Sentry MCPs every sub-PR
- `/codex-paranoia plan` on this doc (BEFORE Sub-1)
- `/codex-paranoia wave` epic-end (AFTER Sub-7, BEFORE Sub-8 epic-close)

## End of plan-doc
