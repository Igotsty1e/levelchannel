# Variant B — Editorial Storytelling — style anchor v1.0

> Source of truth for the Variant B preview route (`/saas/v2-b`) brand DNA, asset palette, motion DNA, and GPT-Image-1 system-prompt prefix. Locked artifact; bump `anchorVersion` and append a changelog row before any drift-inducing edit. Cross-references: `docs/plans/saas-landing-tier1-v2.md` §11.1, §11.2, §11.6; `docs/design-system.md` §3, §8.LANDING.6, §8.LANDING.8.

## anchorVersion

`vb-1.0` — created 2026-06-07 (Sub-1, Agent B). Used in every Codex prompt manifest entry under `docs/brand/_pending/codex-prompts-variant-b.json`. Any change to palette, lighting, composition, or system-prompt prefix MUST bump this to `vb-1.1` (and so on); all assets referencing the prior version must be re-generated or moved to `_archive/`.

## Brand DNA in 5 words

**refined · intentional · calm · magazine-grade · contemplative**

The Variant B reader is a comparison-shopper. They scroll deliberately, read paragraphs, weigh promises against evidence. The visual register is the print magazine that respects them — never the demo reel that hustles them. Photography breathes. Typography sets the pace. Accent is whisper, not shout.

## Palette lock

Variant B inherits the LevelChannel brand-dark range but downplays the rose accent: rose appears only as quote-marks and pull-quote framing, never as primary fill or as a CTA background. Editorial section breaks introduce a warm-toned surface override unique to this variant.

| Token | Hex | Use | Notes |
|---|---|---|---|
| `--vb-bg` | `#0B0B0C` | Canvas. Same as brand-dark. | Identical to `--bg` in design-system §3. |
| `--vb-surface-1` | `#111113` | Default raised surface: editorial paragraph blocks, image frames. | Slightly cooler than brand `--surface-1` (#141416) to amplify editorial calm. |
| `--vb-surface-editorial` | `#1A1818` | Variant-B-specific section break surface. Warm tint signals "editorial pause" between scroll sections. | Override only inside `[data-landing-variant="b"] [data-section="editorial-break"]`. Not used elsewhere in product. |
| `--vb-text-primary` | `#F5F5F7` | Body, headings, pull-quotes. | Identical to brand `--text-primary`. |
| `--vb-text-secondary` | `#A1A1AA` | Captions, drop-cap meta, footnotes, image credits. | Identical to brand `--text-secondary`. |
| `--vb-text-editorial-muted` | `#7A7A82` | Editorial pull-quote attribution, section numerals. | Sits between brand `--text-secondary` (#A1A1AA) and `--text-tertiary` (#6E6E76); custom value for editorial register. |
| `--vb-accent` | `#C87878` | Quote-marks glyph, pull-quote left-rule, drop-cap accent. Never a CTA fill. | Same warm-rose accent as Variant A but used at 60% opacity in most slots. |
| `--vb-accent-soft` | `rgba(200,120,120,0.60)` | Quote-color: pull-quote slab background at 8% opacity, quote-mark glyph at 60% opacity, footnote underline. | Quote-color is `--vb-accent` at 60% opacity per plan §11.1 + this anchor. |
| `--vb-accent-gradient` | `linear-gradient(135deg,#C87878 0%,#E8A890 100%)` | RESERVED. Only used on the final CTA at the bottom of the page; never above the fold. | Editorial reader earns the gradient by reading to the end. |

**Surface override mechanic:** Variant B does NOT introduce a new `.saas-chrome` scope (plan §11 contract). Instead, the per-variant override applies via the `[data-landing-variant="b"]` attribute set on the route root. CSS lives under `app/saas/v2-b/landing-v2-b.css` (Sub-4 owns). Tokens above are CSS custom properties scoped to that selector.

## Lighting rule

**Soft natural light, low contrast, no dramatic shadows** — the deliberate opposite of Variant A's cinematic chiaroscuro.

- Light source: diffused window-light from a single mid-elevation direction (top-left or top-right by 30-45 degrees). Never overhead, never raking, never from below.
- Shadow density: ambient occlusion only. No cast shadows that read as silhouettes. Shadow opacity ≤ 25%.
- Highlight discipline: no specular hot-spots on glass / metal / screens. Specular bloom is forbidden. Editorial photography reads matte.
- Color temperature: ~4500K (slightly warm daylight). Cooler than tungsten, warmer than overcast. Never blue-shifted; never sodium-yellow.
- Mood: golden hour without the gold. Late-morning natural light filtered through a sheer curtain. The room has been still for an hour.

This rule is enforced in every GPT-Image-1 prompt prefix (see §"GPT-Image-1 system-prompt prefix" below). Any asset that reads as cinematic, dramatic, or theatrical fails the variant — re-generate.

## Composition rules

- **Full-bleed photography or screenshots.** Hero and section openings span 100vw on desktop, with 4-6vw side padding on mobile. No floating cards over imagery — imagery itself is the surface.
- **Rule of thirds applied strictly.** Subject anchor on a third-line intersection. The other two thirds are deliberate negative space, never "filled" with secondary props.
- **Whitespace as feature, not afterthought.** Paragraph max-width 70ch (see Typography). Section vertical padding `clamp(96px, 12vw, 192px)`. The editorial reader needs room to breathe between thoughts.
- **Pull-quote slabs over images.** A pull-quote slab is a half-opaque (`--vb-surface-1` at 88% opacity, 12px backdrop-blur) panel laid over the lower-third of a full-bleed image. Slab carries: large serif pull-quote (44-56px), `--vb-accent` quote-mark glyph (96px, 60% opacity), attribution line in `--vb-text-editorial-muted` (14px, all-caps tracking +0.08em).
- **No collage. No grids of 6 thumbnails. No stacked cards.** One subject per scroll section. Editorial pacing means commit to one image, one paragraph, one CTA per beat.
- **Drop-caps optional, never required.** When used, drop-cap spans 3 lines, serif, `--vb-accent` at 100% opacity (one of the few slots where accent goes full-saturation). Used only on the first paragraph of section 1 and section 3.
- **People are present but not prominent.** Hands on a notebook, a back turned to a window, a chair pulled from a desk. No marketing-stock-portrait faces. The room and the workflow are the subject; the human is implied.

## Typography

Cites `docs/design-system.md` §8.LANDING.6 hero type-scale verbatim — Variant B reuses the brand hero type-scale but uses a **large serif** for h1 instead of the brand sans. Body remains sans for legibility. The serif sets the editorial register.

- **Hero h1 (serif).** Font stack: `"Source Serif 4", "Charter", "Iowan Old Style", "Apple Garamond", Georgia, serif`. Sizes: `clamp(64px,7vw,96px)` desktop / `clamp(48px,6vw,64px)` tablet / `clamp(36px,9vw,48px)` mobile per §8.LANDING.6. Leading 0.95. Tracking -0.04em per §8.LANDING.6. New York Times feature-headline cadence.
- **Section h2 (serif).** Same family. Sizes: `clamp(40px,4.5vw,56px)` desktop / `clamp(32px,4vw,42px)` mobile. Leading 1.05. Tracking -0.02em.
- **Body sans.** Font stack: `"Inter", "SF Pro Text", "Segoe UI", system-ui, sans-serif`. Size: `clamp(17px,1.2vw,19px)`. Leading 1.65 (editorial generous, vs product 1.5). **Max-width 70ch** for all paragraphs (≈ 640-680px). Hard rule: never exceed 70ch even on ultra-wide screens.
- **Pull-quote (serif, italic optional).** Size `clamp(36px,3.5vw,52px)`. Leading 1.2. Tracking -0.015em. Color `--vb-text-primary` at 100%; quote-mark glyph in `--vb-accent` at 60%.
- **Caption / footnote sans.** Size 14px. Tracking +0.04em. Color `--vb-text-editorial-muted`. Used under photography and below pull-quote slabs.
- **Drop-cap (serif).** 3-line span. Same family as hero. Color `--vb-accent` at 100% (rare; the only slot that goes full-saturation accent in the editorial body). Margin-right 0.12em.
- **Editorial section numerals.** Small-caps serif at 14px, `--vb-text-editorial-muted`, tracking +0.12em. Format: `№ 01 — РАСПИСАНИЕ` style.

Sans body + serif headlines is the canonical editorial print pairing (NYT, The Atlantic, Stripe Sessions docs). No third font.

## Motion DNA

Light, restrained, scroll-triggered. The opposite of Variant A's cinematic choreography.

- **Scroll-trigger fades.** Section openings (h2 + first paragraph + hero image) fade-and-rise on intersection: opacity 0→1, transform translateY(16px)→0, duration 720ms, easing `cubic-bezier(0.16, 1, 0.3, 1)` (matches brand "generous" easing per §8.LANDING.2). One-shot; no re-trigger on scroll up.
- **Lottie micro-anims at section openings.** 6 hand-authored Lottie files (in Rive, exported as `.lottie`). See "Asset slot list" below. Each plays once on intersection-observer fire, then idles. Loop allowed only on `lottie_b_loading_dots` and `lottie_b_micro_pulse`.
- **Type-morph hero (CSS-only).** Hero h1 text content stays static — the "morph" is a 600ms cross-fade between two pre-rendered SVG text snapshots ("Преподавать — твоё призвание." → "Управлять — наше."). No JS framework cost. Triggered once on first paint (after a 1200ms hold on the first phrase).
- **NO magnetic cursor.** Magnetic CTAs belong to Variant A. Variant B uses standard link hover (`--vb-accent` underline on hover, 200ms ease).
- **NO 3D tilt cards.** Editorial register doesn't tilt.
- **NO parallax depth layers.** Whitespace replaces parallax as the perceived-depth mechanic.
- **Reduced-motion fallback (MANDATORY per §8.LANDING.8).** Under `prefers-reduced-motion: reduce`: all scroll-trigger fades become immediate paint (opacity 1 from start); all Lottie players short-circuit to their last-frame static SVG; type-morph cross-fade skips to the second phrase on mount. Implementation reuses the design-system §8.LANDING.8 CSS guard inside the `[data-landing-variant="b"]` scope plus a JS `matchMedia('(prefers-reduced-motion: reduce)').matches` check at every IntersectionObserver attach site.

**Cleanup contract.** Every IntersectionObserver, every Lottie player instance, every matchMedia listener returns a cleanup function from its React effect. Unmount kills all observers/players. No idle work after route leave.

## GPT-Image-1 system-prompt prefix

The following text is appended VERBATIM as prefix to every Codex image-gen prompt for Variant B. Locked; bump `anchorVersion` to change.

```
EDITORIAL PHOTOGRAPHY MOOD. Magazine-grade still life or environmental scene.
Soft natural daylight from a single window source, diffused through sheer fabric,
color temperature approximately 4500K. Low contrast, no dramatic shadows, no
specular highlights, no cinematic chiaroscuro. Ambient occlusion only; cast
shadows under 25% opacity. Composition follows rule of thirds with deliberate
negative space on two thirds. Subjects are real-world textured surfaces:
matte paper, brushed wood, woven textile, unpolished ceramic, brushed metal,
worn leather. No glossy plastic, no chrome, no neon, no holograms, no glass-
reflection bloom. Palette: warm grays #0B0B0C #111113 #1A1818, off-white
#F5F5F7, restrained warm-rose accent #C87878 used sparingly as a single
small detail (never as primary fill, never as background tint). People may
appear as implied presence — a hand on a notebook, a back turned to a window,
a chair pulled away from a desk — never as prominent marketing-stock portrait
faces. Style references: editorial photography in The New York Times feature
section, Kinfolk Magazine still life, Cereal Magazine interiors. Avoid: 3D
render aesthetic, illustration aesthetic, gradient backgrounds, cinematic
lighting, dramatic angles, motion blur, lens flare, depth-of-field gimmick.
Output reads as a photograph that could appear in a print magazine.
ASPECT RATIO AND SUBJECT FOLLOW THE PER-ASSET PROMPT BELOW.
```

Every asset prompt in `docs/brand/_pending/codex-prompts-variant-b.json` carries this prefix in its `promptText` field, followed by the per-asset specifics. `promptHash = sha256(promptText + anchorVersion)` ensures drift detection.

## Asset slot list

### 4 illustrations (full-bleed editorial photographs — Codex GPT-Image-1)

| Slot ID | Aspect | Use site | Subject brief |
|---|---|---|---|
| `slot_b_hero_editorial_photo` | 16:9 (3840×2160 generated, served as AVIF) | Hero section behind the type-morph h1 | A wooden desk in soft late-morning window light. Open paper notebook centered on right third, fountain pen resting at an angle, single ceramic mug of black coffee on left third. Hand of an implied person resting near the notebook (only knuckles visible). No screens, no devices in frame. Background out of focus suggests a window with sheer curtain. Matte, calm, deliberate. |
| `slot_b_section_1_workspace_scene` | 16:9 | Section 1 opening (Расписание) | A wall-mounted paper calendar with handwritten week marks in soft pencil. Strip of natural daylight crossing diagonally from upper-left. A single yellow post-it note attached. No digital screens. The calendar is the subject; surrounding wall is warm off-white. |
| `slot_b_section_2_calm_dashboard` | 16:9 | Section 2 opening (Ученики) | An open paper ledger book on a desk, half a dozen handwritten entries visible, a pair of reading glasses folded to the side, a porcelain teacup with steam (very subtle). Soft window light from upper-right. The ledger represents the analog calm that the SaaS product preserves. |
| `slot_b_section_3_quote_image` | 21:9 (3840×1645 generated, used as full-bleed pull-quote backdrop) | Section 3 pull-quote slab background | An empty wooden chair pulled slightly out from a teacher's desk, viewed from a low side angle. Soft natural backlight from a tall window. A jacket draped over the back of the chair. Subject reads as "the teacher just stepped away — their workflow is uninterrupted." Deeply negative-space-forward composition; chair occupies right third only. |

### 6 Lottie micro-animations (HAND-AUTHORED IN RIVE — NOT Codex-generated)

These are NOT included in `codex-prompts-variant-b.json` (Codex does not author Lottie). Orchestrator commissions these separately. Output target: `public/assets/landing-v2/variant-b/lottie/{slot}.lottie`.

| Slot ID | Duration | Loop | Brief |
|---|---|---|---|
| `lottie_b_scroll_indicator` | 1.8s | Yes | A thin serif chevron drawing itself downward then fading. Sits below hero. Color `--vb-text-editorial-muted`. Subtle pulse synced to scroll-hint copy "Прокрутите". |
| `lottie_b_section_underline` | 800ms | No | A thin horizontal rule (1px, `--vb-accent` at 60%) draws itself left-to-right under each section h2 on intersection. Easing: `cubic-bezier(0.16, 1, 0.3, 1)`. |
| `lottie_b_pullquote_mark` | 600ms | No | A serif left-quotation-mark glyph (`“`) fading in with a small scale-up (0.92→1.0) above each pull-quote slab. Color `--vb-accent` at 60%. |
| `lottie_b_cta_arrow` | 1.2s | Yes | A thin rightward arrow with a subtle horizontal nudge (12px translateX) on each loop iteration. Sits to the right of inline editorial CTA links. Color `--vb-accent` at 100% (one of the rare full-saturation slots). |
| `lottie_b_loading_dots` | 1.0s | Yes | Three dots cycling opacity (0.3 → 1.0 → 0.3) with 200ms stagger. Used on the type-morph hero placeholder before SVG snapshots load. Color `--vb-text-editorial-muted`. |
| `lottie_b_micro_pulse` | 2.4s | Yes | A 1-pixel `--vb-accent` dot pulsing (opacity 0.4 → 1.0 → 0.4) very slowly. Used as the only animated accent next to the final CTA. Reduced motion fallback: static dot at 0.7 opacity. |

### 3 product screenshot specs (real LevelChannel UI — mocked, Codex GPT-Image-1)

These are Codex-generated images that VISUALLY MIMIC real product screenshots (per plan §11.1 "real product screenshots"). They are not actual DOM screen-grabs — they are GPT-Image-1 renderings that read as if they were the real app. Mocked with the LevelChannel design system tokens.

| Slot ID | Aspect | Mocked surface | Spec |
|---|---|---|---|
| `slot_b_product_screenshot_dashboard` | 16:10 | `/teacher/dashboard` | Browser frame with chrome (macOS Safari style, top window controls visible at left). Inside: dark surface `#0B0B0C`, top nav with brand mark (Option O ascending sine wave) at top-left, sidebar at left with 4 nav items, main canvas with a weekly schedule grid showing 5 days × 4 time slots, 8 of the slots filled with rose-tinted (`--vb-accent` at 18% opacity) lesson cards each labeled "Иван Петров · 18:00". One card on hover state with subtle elevation. Typography uses Inter sans (matching real product). Rendered as a still photograph of a laptop screen, not a flat UI mock — slight perspective tilt to match the editorial photography mood. |
| `slot_b_product_screenshot_learners` | 16:10 | `/teacher/learners` | Same browser frame. Inside: a paginated table of 8 learners with columns "Имя · Тариф · Баланс · Следующий урок". Rows alternate `#111113` and `#0B0B0C`. One row in active state (subtle `--vb-accent-soft` background). Typography Inter sans. Rendered with the same slight perspective and soft window-light reflection on the screen surface — reads as photographed, not flat. |
| `slot_b_product_screenshot_schedule` | 16:10 | `/teacher/calendar` (week view) | Same browser frame. Inside: full week calendar view, Monday-Sunday columns, time axis 09:00-21:00 on left. 12 lesson blocks distributed across the week, each labeled with learner first name. A "+" button in upper-right corner. Subtle today-column highlight in `--vb-surface-editorial`. Rendered as photographed screen with soft natural reflection. |

All 3 product screenshots use the SAME editorial photography treatment (window-light reflection, slight perspective tilt, matte surface) so they read as "photos of the product on a desk" rather than flat marketing screens. This is the variant's signature device — product UI presented as artifact, not as advertisement.

## Anti-drift checklist

Run through this list before committing any new Variant B asset or copy. Any "no" answer = drift; re-do.

- [ ] Lighting is soft natural daylight, single window source, ~4500K. No cinematic light, no specular bloom, no chrome reflection.
- [ ] Shadows are ambient occlusion only, ≤ 25% opacity. No silhouette-cast shadows.
- [ ] Composition uses rule of thirds with two thirds of deliberate negative space. No filled background.
- [ ] Palette stays within: `#0B0B0C` canvas, `#111113` surface, `#1A1818` editorial-break surface, `#F5F5F7` text, `#A1A1AA` secondary text, `#7A7A82` editorial-muted, `#C87878` accent (used sparingly at 60% opacity except drop-caps and `lottie_b_cta_arrow`).
- [ ] Accent appears as a small detail, not a fill or backdrop. Above-the-fold accent usage is minimal.
- [ ] Typography uses serif for hero h1, section h2, pull-quote, and drop-cap; Inter sans for body, captions, footnotes, numerals. Body paragraphs are capped at 70ch.
- [ ] Subject is a real-world textured surface (paper, wood, ceramic, textile, leather). No glass/chrome/neon/holograms/3D-render aesthetic.
- [ ] If people appear, they are implied presence (hands, backs, chairs) — not marketing-portrait faces.
- [ ] Motion is restrained: scroll-trigger fades, Lottie micro-anims, type-morph hero, link-hover underline. No magnetic cursor, no 3D tilt, no parallax.
- [ ] Reduced-motion fallback present: every IntersectionObserver / Lottie / matchMedia attach site short-circuits when `prefers-reduced-motion: reduce`.
- [ ] Cleanup contract honored: every effect returns a cleanup that kills observers, players, and listeners. No idle work after route leave.
- [ ] Copy register is editorial-paragraph, magazine-cadence. NOT short-headline-marketing. NOT short-headline-cinematic.
- [ ] Anchor reference in the asset's manifest row matches `vb-1.0`. If anchor was bumped, asset is re-generated; old asset moved to `_archive/`.

## Changelog

| anchorVersion | Date | Author | Change |
|---|---|---|---|
| vb-1.0 | 2026-06-07 | Sub-1 Agent B | Initial lock. Palette, lighting rule, composition rules, typography, motion DNA, GPT-Image-1 prefix, 4 illustration slots + 6 Lottie briefs + 3 product screenshot specs, anti-drift checklist. |
