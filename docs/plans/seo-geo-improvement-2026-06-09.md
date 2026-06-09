# SEO & GEO Improvement Plan — 2026-06-09

Status: SHIPPED Sub-PR A 2026-06-09 (PR #569 `f828581`). Sub-PR B deferred pending owner Q1-Q5 answers (§5).
Scope: `/`, `/saas/learn/*` (10 pages), `/integrations/google-calendar`, `/anastasiia`
Out of scope: cabinet, teacher, admin, checkout, legal docs (already `disallow`-ed in robots).

## §1 Goal

Tighten technical SEO + structured-data coverage on the public surface so Google indexes everything correctly and pages are eligible for AI Overviews / Gemini answers without ad-hoc "GEO" gimmicks. Google's 2026 stance (May 2026 blog + ai-features doc): no special markup for AI surfacing — just fix fundamentals, ship complete structured data, write people-first content. We have most of the bones (Organization JSON-LD, SoftwareApplication+FAQPage on learn pages, sitemap, robots, og-image route); we're missing canonicals/OG on `/`, twitter cards everywhere, BreadcrumbList, author/dateModified signals, and a Service schema on `/anastasiia`.

## §2 Research findings (15 actionable points, attributed)

1. **No special GEO markup needed.** Google explicitly: "You don't need to create new machine readable files, AI text files, or markup to appear in [AI Overviews]." (ai-features). → Do not invent custom AI-files; double down on standard schema.org + helpful content.
2. **Structured data must match visible text.** "Don't add structured data about information that is not visible to the user." (intro-structured-data). → Our SoftwareApplication offers (300/800/0 ₽) match visible pricing — keep that invariant when prices change.
3. **Prefer fewer complete schemas over many partial ones.** (intro-structured-data). → Don't add Review/AggregateRating without real reviews.
4. **Unique title + meta description per page**, 1-2 sentences, distinct from page-to-page. (seo-starter-guide). → `/` and `/anastasiia` ok; learn pages ok; but `app/layout.tsx` neutral default `'LevelChannel'` shows when a child page forgets — currently any new route under `/` without `metadata` export inherits that.
5. **OG + Twitter cards control unfurls.** (seo-starter-guide / structured-data). → We set OG but **never set `twitter.card`** anywhere. Twitter/X falls back to summary without large image.
6. **Canonical on every indexable page.** (seo-starter-guide). → `/` has it; learn pages have it; `/anastasiia` has it; `/integrations/google-calendar` has it. Good.
7. **Internal linking with descriptive anchor text.** (seo-starter-guide). → Learn pages don't cross-link to each other; each is a leaf. Adding a related-articles block at the bottom of `SeoArticle` would help.
8. **Image alt text + semantic `<h1>`/`<h2>` hierarchy.** (seo-starter-guide). → Alt text in v3 landing OK; `SeoArticle` has one `<h1>` per page + `<h2>` per section — clean.
9. **Sitemap should list only canonical, indexable URLs.** (sitemaps/overview). → Our sitemap lists `/login`, `/register`, `/saas/offer`, `/privacy`, `/consent/personal-data` which are either `disallow`-ed in robots or low-value. Mismatch confuses Search Console.
10. **`changefreq`/`priority` are largely ignored by Google now.** (sitemaps/overview — silent on them; widely known). → Keep them or drop; harmless. Real `lastmod` matters.
11. **`/integrations/google-calendar` is not in sitemap.** → Just an omission, fixes indexing.
12. **People-first content: demonstrate `who` + `how` + `why`, not just `what`.** (creating-helpful-content). → Learn pages already do this; keep the pattern.
13. **Disclose AI-generated content if used.** (creating-helpful-content). → Our content is human-authored. No action.
14. **BreadcrumbList helps both Search snippets and AI Overview context.** (intro-structured-data common patterns). → Easy add on every learn page.
15. **Service / LocalBusiness schema for personal-services pages** (intro-structured-data ecommerce/services pattern). → `/anastasiia` sells lessons by a named individual; currently inherits only Organization. Add `Service` + `Person` schema.

## §3 Current state audit

**Works:**
- `app/layout.tsx`: Organization JSON-LD global, `metadataBase`, `lang="ru"`, manifest, theme color, favicon. OG defaults set.
- `app/page.tsx`: per-page title/description/canonical/OG.
- `components/saas/landing-v4/_shared/seo-article.tsx`: SoftwareApplication + conditional FAQPage JSON-LD, one `<h1>`, semantic `<h2>` per section, descriptive CTA anchor text.
- All 10 learn pages + `/integrations/google-calendar` + `/anastasiia`: per-page metadata with canonical and OG.
- `app/sitemap.ts` + `app/robots.ts` exist via `MetadataRoute`.
- `app/saas/learn/opengraph-image.tsx`: dynamic OG image (1200×630) with brand mark.

**Doesn't work / gaps:**
- No `twitter` metadata anywhere → X/Twitter unfurls are `summary` not `summary_large_image`.
- `/anastasiia` has no `openGraph.images` → falls back to layout default (none).
- Sitemap includes `/login`, `/register`, `/saas/offer`, `/privacy`, `/consent/personal-data` — `robots.ts` disallows `/login`, `/register/confirm`, but `/register` itself is allowed; either way these don't belong in sitemap (low/no SEO value, some confusing-to-index).
- `/integrations/google-calendar` missing from sitemap.
- No `BreadcrumbList` JSON-LD on learn pages.
- No `Service` schema on `/anastasiia` despite that page being a sellable lesson service by Anastasia.
- `SoftwareApplication` schema is emitted only inside the client `<SeoArticle>` — fine for Google (it parses post-render), but `Offer` schema does not declare `priceValidUntil` or `availability`; Google rejects offers without these in Search Console "Items unparsable".
- `SeoArticle` is a client component — JSON-LD ends up in the client DOM after hydration; better to also emit server-side. Currently injected via `dangerouslySetInnerHTML` from the client, which Google can read but is slower for crawlers without JS.
- No `lastmod` in sitemap reflects actual file mtime — every page reports `new Date()` (today), which gives Search Console false freshness signals.
- No `Article` or `TechArticle` schema on learn pages despite article-type content; SoftwareApplication is the right primary but additional `Article` would help E-E-A-T.
- robots.ts `host:` field is non-standard (Yandex-only); harmless but cruft.

## §4 Concrete changes (file-by-file, prioritized)

**Priority 1 (high impact, low risk):**

1. **`app/layout.tsx`** — Add `twitter` block to default `metadata`: `{ card: 'summary_large_image', site: '@levelchannel', images: ['/og-default.png'] }`. Move Organization JSON-LD emission to a `next/script` with `strategy="beforeInteractive"` so it lands in initial HTML (currently OK; just ensure).

2. **`app/sitemap.ts`** — (a) Remove `/saas/offer`, `/privacy`, `/consent/personal-data`, `/login`, `/register` (legal/auth, not SEO targets). (b) Add `/integrations/google-calendar` at priority 0.7, `monthly`. (c) Use real `lastModified` per-route from a const table keyed to last meaningful content edit (manually maintained), not `new Date()`.

3. **`components/saas/landing-v4/_shared/seo-article.tsx`** — (a) Add `availability: 'https://schema.org/InStock'` and `priceValidUntil: '2027-12-31'` to each `Offer`. (b) Wrap softwareSchema in `aggregateRating`-free form; ensure `publisher.url` exact-match `SITE_URL`. (c) Add `BreadcrumbList` JSON-LD: Home → SEO hub (`/saas/learn`) → current page; use `usePathname()` for the slug. (d) Add `Article` schema with `headline`, `author: { '@type': 'Organization', name: 'LevelChannel' }`, `datePublished`, `dateModified` — values passed via new optional props on `SeoArticle` (`publishedAt`, `updatedAt`).

4. **All 10 `app/saas/learn/*/page.tsx`** — Add `twitter: { card: 'summary_large_image', images: ['/saas/learn/opengraph-image'] }` to `metadata`. Add `publishedAt`/`updatedAt` props to each `<SeoArticle>` call (e.g. `'2026-05-22'`, `'2026-06-09'`).

5. **`app/integrations/google-calendar/page.tsx`** — Same `twitter` addition + `publishedAt: '2026-06-06'`, `updatedAt: '2026-06-09'`.

**Priority 2 (medium):**

6. **`app/anastasiia/page.tsx`** — (a) Add `openGraph.images: ['/anastasiia/opengraph-image']` and create `app/anastasiia/opengraph-image.tsx` mirroring the learn pattern. (b) Inject `Service` JSON-LD via a server-rendered `<script type="application/ld+json">` at the top of the page: `{ '@type': 'Service', name: 'Уроки английского с Анастасией', provider: { '@type': 'Person', name: 'Анастасия', jobTitle: 'Преподаватель английского' }, areaServed: 'RU', serviceType: 'Online English tutoring', offers: { '@type': 'Offer', priceCurrency: 'RUB', availability: 'https://schema.org/InStock' } }`. (c) Add `twitter` card.

7. **`components/saas/landing-v4/_shared/seo-article.tsx`** — Add a "Related articles" block above the CTA scene with 3 hand-picked cross-links to other `/saas/learn/*` pages (descriptive anchor text in Russian). Drives internal linking from finding #7.

8. **`app/robots.ts`** — Drop `host: BASE` (Yandex-only, irrelevant for Google). Add explicit `Allow: /integrations/` (currently implicitly allowed but explicit is safer if we ever add a route there we want crawled).

**Priority 3 (polish):**

9. **`app/layout.tsx`** — Default `title` becomes a `template`: `{ default: 'LevelChannel — CRM для частного репетитора', template: '%s | LevelChannel' }` so any new untitled route gets a useful title instead of bare `'LevelChannel'`.

10. **`components/saas/landing-v4/_shared/seo-article.tsx`** — Move JSON-LD emission into a small **server** wrapper component (`SeoArticleSchema`) called from each page's server `metadata` block via `generateMetadata` is not enough — instead create `SeoArticleSchemaScripts` server component that emits scripts and renders the client `<SeoArticle>` as child. Ensures schemas are in initial HTML.

## §5 Open questions for owner (max 5)

1. **Twitter handle:** do we have `@levelchannel` on X, or should `twitter.site` be omitted?
2. **`dateModified` policy:** are we OK manually bumping a const table per learn page on each meaningful edit, or want a build-time script reading `git log -1 --format=%cI <file>`?
3. **Related-articles links per page:** want us to curate (manual) or auto-pick by slug similarity?
4. **`/anastasiia` Service offer price:** do we publish a `price` (e.g. `2500` RUB/lesson) in JSON-LD, or only `priceRange`? Public price page absent right now.
5. **Drop `/saas/offer` + `/privacy` from sitemap:** confirm — they're public+indexable but low-value; keeping them risks Search Console noise, removing them doesn't deindex (robots stays as-is).

## §6 Self-review (round 1) — gaps I might have missed

1. **`<head>`-level `<link rel="alternate" hreflang>` for ru-RU** — Google occasionally penalizes single-language sites that don't self-declare. Should add `<link rel="alternate" hreflang="ru" href="..."/>` + `x-default` even though we're RU-only. Missed in §4.
2. **`/anastasiia` schema might conflict with global Organization on `<html lang="ru">`** — two `Organization` blocks (global + per-page) confuse Knowledge Graph; better to make Anastasia's `Person` schema standalone, not duplicate Organization.
3. **Mobile-friendly + Core Web Vitals not audited** — research §1 mentions mobile, but I never ran Lighthouse against `/saas/learn/cabinet` to confirm we're not punished there. Should be a follow-up task (use chrome-devtools MCP).
4. **`SoftwareApplication` schema has no `aggregateRating`** — Google snippet won't show stars. Adding fake ratings is forbidden; we should leave blank until we have real reviews collected through a `/reviews` route (out of scope here but flag it).
5. **OG image route `/saas/learn/opengraph-image` only serves the learn-pages prefix** — `/` and `/anastasiia` and `/integrations/google-calendar` reference it cross-prefix. Next.js may not generate it at those paths; they'd need either their own opengraph-image.tsx or explicit absolute URL. Risk of broken unfurls.
6. **Sitemap `lastmod` change might cause Google to recrawl all pages at once** — if we backdate to file mtimes via git, that's fine; if we just set `new Date()` it's a constant lie. Need to commit to one approach.
7. **`Article` schema requires `image` + `headline` ≤110 chars** — current learn-page `<h1>` strings may exceed 110 chars; need to truncate the `headline` field, not the visible h1.
8. **No mention of `robots` meta tag per page** — for `/login` etc. we rely on `robots.ts` disallow, but a belt-and-suspenders `<meta name="robots" content="noindex">` on `/login`, `/register`, `/thank-you`, `/checkout/*` is safer. Should be a follow-up (out of scope for this plan as those routes aren't in §4 file list).
9. **`/anastasiia` may benefit from `EducationalOccupationalProgram` schema** instead of plain `Service` — more specific. Worth checking schema.org docs before locking in #6.
10. **Footer link to `/saas/learn` hub does not exist** — there's no index page listing all 10 learn articles, so internal-linking finding #7 has nowhere to anchor a hub. Either build `/saas/learn/page.tsx` index (small new page) or just cross-link articles directly.

## §7 Decomposition into sub-PRs

**Sub-PR A — `seo-geo-fundamentals` (Priority 1, ~30 lines diff per file × 13 files):**
- Twitter cards added on layout + 10 learn pages + integrations + anastasiia.
- Sitemap cleaned (drop legal/auth, add integrations, real lastmod via const table).
- `SeoArticle` gets `BreadcrumbList` + `Article` JSON-LD + `availability`/`priceValidUntil` on Offers + `publishedAt`/`updatedAt` props.
- Title template in `app/layout.tsx`.
- robots.ts drops `host:`, explicit allow `/integrations/`.

**Sub-PR B — `seo-geo-anastasia-and-internal-links` (Priority 2-3, isolated):**
- `/anastasiia` opengraph-image route + Service/Person JSON-LD (server-rendered) + twitter card.
- `SeoArticle` "Related articles" block (3 cross-links per page; per-page list curated in a const map).
- Optional `/saas/learn/page.tsx` hub index page if owner says yes in §5.
- `hreflang="ru"` + `x-default` self-references in layout.

Paranoia: SUB-PR A is plan-paranoia + wave-paranoia in one shot (single epic, one wave). Sub-PR B same. Could collapse into one epic if owner prefers.

---

/Users/ivankhanaev/LevelChannel/docs/plans/seo-geo-improvement-2026-06-09.md
