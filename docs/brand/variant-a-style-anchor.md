# Variant A — Cinematic Desk Magic — style anchor v1.0

> Locked DNA bible for the LevelChannel SaaS-landing tier-1 v2 **Variant A** preview route (`/saas/v2-a`). Every illustration, R3F scene, hero video loop, and Codex image-gen prompt for variant A inherits the rules in this file verbatim. Drift = brand incident.

Authority chain:
- Plan-doc: `docs/plans/saas-landing-tier1-v2.md` §11.1 + §11.2 + §11.6
- Tokens: `docs/design-system.md` §3 (palette) + §8.LANDING (scope `.saas-chrome`)
- Brand mark: `components/brand/brand-mark.tsx` (Option O ascending sine-wave; locked)
- Auto-memory: `~/.claude/projects/-Users-ivankhanaev-LevelChannel/memory/levelchannel_brand_mark_option_o.md`

## anchorVersion: va-1.0

Bump rules in §11 below. This anchorVersion is what `docs/brand/_pending/codex-prompts-variant-a.json` and `public/assets/landing-v2/variant-a/manifest.json` carry per asset. CI gate (`scripts/check-asset-manifest.mjs`, plan §11.2) refuses to ship an asset whose manifest row's `anchorVersion` does not equal the current version in this header.

## Brand DNA in 5 words

**warm, cinematic, magical, isometric, hand-touched**

Each adjective is load-bearing:
- **warm** — palette is rose/peach over a near-black canvas; never blue-shift, never cold neutral grey
- **cinematic** — slow theatrical reveals (≥420ms), low ambient + warm rim light, generous negative space, no UI chrome competing with the subject
- **magical** — physics feels purposeful: items pause, rotate a fraction, then collapse with intent. Never random jitter, never explosive
- **isometric** — overhead 3/4 view (camera ~30° pitch, ~35° yaw); flat-perspective rejected; full top-down rejected. Same camera for all 6 illustrations
- **hand-touched** — subtle imperfection: slight pencil-stroke edges on illustrated objects, soft grain at 4-8% on flat fills, hand-arranged composition (never grid-aligned)

## Palette lock

Reuses LevelChannel brand palette per `docs/design-system.md` §3. No new hex introduced for Variant A.

| Role | Hex | Source | Use in Variant A assets |
|---|---|---|---|
| Canvas bg | `#0B0B0C` | design-system §3 `--bg` (variant-a nudges from `#0B0B0D` → `#0B0B0C` per plan §11 hex lock) | Default backdrop in EVERY illustration (no white, no light-grey) |
| Surface | `#111113` | derivable from §3 `--surface-1` `#141416` (variant-a darker variant for cinematic contrast) | Desk surface, dashboard slab, ambient depth |
| Accent gradient start | `#C87878` | §3 `--accent-gradient` start | Warm rim-light highlight, CTA glow, dashboard active state |
| Accent gradient end | `#E8A890` | §3 `--accent-gradient` end | Top-left key-light highlight, hero gradient text terminus |
| Text primary | `#F5F5F7` | §3 `--text-primary` | All headlines and body copy (when overlaid on illustrations) |
| Text secondary | `#A1A1AA` | §3 `--text-secondary` | Meta/caption layers inside illustrated UI; subtitle copy |

**Forbidden in Variant A assets:**
- Pure white `#FFFFFF` as a fill (text-on-accent only; never as illustration background or surface)
- Pure black `#000000` (kills warmth; always at least `#0B0B0C`)
- Any semantic colour from §3 (success green, danger red, info blue) — confuses brand-DNA in marketing illustration
- Any blue-cold accent — Variant A is warm-only

Gradient direction lock: linear-gradient(135deg, `#C87878` 0%, `#E8A890` 100%). Used for accent strokes, CTA fill, hero gradient-text. Same direction (top-left → bottom-right) across every asset for visual continuity.

## Lighting rule (5-illuminant)

Every Variant-A illustration and R3F scene uses the same 5-light setup. This is the single biggest driver of style coherence — get the lights wrong and the asset reads as a different brand even if palette is correct.

| Light | Position | Colour | Intensity | Role |
|---|---|---|---|---|
| Key | Top-left, ~30° above subject, ~45° azimuth | `#E8A890` (accent gradient end) | Soft, large area (≈30% of frame width as virtual softbox) | Primary illumination; warm and motivated |
| Fill | Camera-side, slightly below subject | `#111113` ambient lift (very subtle) | 8-15% of key intensity | Lifts shadows from pure black without flattening |
| Rim | Back-right, behind subject | `#C87878` (accent gradient start) | Sharp, narrow | Separates subject from background; reads as "magic glow" |
| Ambient | Omnidirectional | `#0B0B0C` slightly warm-tinted | Very low (~5%) | Prevents totally crushed blacks in shadow pockets |
| Bounce | From desk surface upward | `#111113` warm | Very low (~3%) | Realistic floor reflection on lifted items |

No second key. No cool fill. No coloured rim other than accent gradient endpoints. The lighting is the DNA — it's why a "scattered desk overview" and a "magnetic CTA close-up" feel like the same world.

Shadows: soft-edged, warm-tinted (never cool blue), 18-25% opacity max, cast from key light direction (down and to the right).

## Composition rules

1. **Camera angle: isometric overhead** — virtual camera at ~30° pitch (looking down) and ~35° yaw (looking right of centre). Same across all 6 illustrations. R3F scenes start at this angle even when they animate.
2. **Subject placement: rule-of-thirds** — primary subject (phone, dashboard, magnet, etc.) at the lower-left third intersection. Top-right third holds negative space + rim-light bleed.
3. **Hand-arranged jitter** — items are NOT grid-aligned. Each illustrated object rotates ±3-8° from the axis. Asymmetry is intentional; perfect alignment reads as templated and kills "magical".
4. **Depth layering** — three z-layers minimum: (a) backdrop wash, (b) subject group, (c) foreground accent (rim-light leak, subtle particle, gradient overlay). Never a flat single layer.
5. **Item count cap** — no more than 7 distinct objects per illustration (Miller's law); the hero overview can stretch to 9 but only with the same 7 silhouette families repeated.
6. **No people** — Variant A is product-magical, not lifestyle. No hands, no faces, no body parts. The story is told through objects, not characters.
7. **No literal text inside generated images** — all copy is HTML-rendered on top of illustrations. Illustration mockups of UI surfaces use placeholder geometric blocks where text would go (never lorem ipsum, never readable strings — they trigger GPT-Image label-rendering failures).
8. **Aspect ratio defaults** — hero/wide compositions 3:2 landscape; section accents 4:3; the climactic dashboard collapse target frame 16:9. R3F scenes render at viewport aspect.
9. **Centre-of-mass below 60% of frame height** — the eye rests low and looks up into the warm light; this is the cinematic feel.

## Typography

Reuses `docs/design-system.md` §8.LANDING.6 hero type-scale verbatim. Variant A applies it under `[data-landing-variant="a"]` attribute (NOT a new `.saas-chrome` scope variant; per plan §11 design system tokens contract).

| Use | Token | Notes |
|---|---|---|
| Hero h1 desktop | `--hero-h1-desktop` (clamp 64-96px) | Sparse 3-5 words per headline; line-break on rhetorical beats |
| Hero h1 tablet | `--hero-h1-tablet` (clamp 48-64px) | |
| Hero h1 mobile | `--hero-h1-mobile` (clamp 36-48px) | |
| Hero leading | `--hero-h1-leading: 0.95` | Tight; cinematic feel |
| Hero tracking | `--hero-h1-track: -0.04em` | Tight |
| Hero subtitle | `--hero-subtitle` (clamp 18-22px) | One sentence max; the one-line story per §11.6 |
| Body inside acts | `--text-15` from §4 | Default body; ≤24 words per block |
| Eyebrow micro-labels | Eyebrow primitive (§4 reserved patterns) | 12px / 700 / +0.08em / `--text-secondary` |

**Sparse-copy rule:** Variant A headlines are 3-5 words. Period. Anything longer breaks the "magic" rhythm and converts the page from cinematic into editorial (that's Variant B's job).

**Gradient text:** Hero h1 uses linear-gradient(135deg, `#C87878` 0%, `#E8A890` 100%) clipped to text. Background-clip pattern documented in §8.LANDING and Sub-3 implementation. Subtitle stays solid `#F5F5F7`.

## Motion DNA

| Pattern | Rule | Source token |
|---|---|---|
| Hero entrance | Slow theatrical reveal: scroll-triggered or autoplay at 720ms `--ease-out-expo` per §8.LANDING.1+2 | `--landing-duration-theatrical` |
| Desk-collapse climax | 1.4-1.8s sequence: items pause (300ms), rotate slightly toward dashboard centre (400ms), accelerate inward + scale into dashboard (700-1100ms). Multi-stage GSAP timeline. | Custom timeline, plan §11 |
| CTA hover | Magnetic cursor primitive per §8.LANDING.4: 96px activation radius, 12px max displacement, 320ms spring settle | `--magnetic-snap-ms` |
| Idle desk jitter | Subtle ±0.5° rotation oscillation at ~8s period per item; staggered phase offsets so items breathe independently. Visible at hero pre-scroll. | Custom CSS keyframes or R3F lerp |
| Scroll-trigger reveals on Acts | 75% viewport threshold per §8.LANDING.3; 60ms stagger between siblings | `--landing-stagger-step` |
| Reduced-motion fallback | MANDATORY per §8.LANDING.8 — every effect collapses to static. JS attach also short-circuits if `matchMedia('(prefers-reduced-motion: reduce)').matches`. | §8.LANDING.8 |
| Video hero loop | 6-12s seamless loop; first frame === last frame; no jump cut; muted autoplay with `playsInline` + `<source media="(prefers-reduced-motion: reduce)">` poster fallback | Plan §11 + design-system §8.LANDING.9 |

**Magical, not nervous:** Variant A motion is slow, intentional, with held pauses. No quick stagger flurries, no bouncy overshoot (that's Variant C). One item moves at a time during the climax — the desk-collapse is a 5-beat sequence, not a chord.

## GPT-Image-1 system-prompt prefix

The orchestrator prepends the following block VERBATIM to every Variant-A illustration prompt before sending to GPT-Image-1 (via Codex `codex exec` per plan §11.2). The block locks palette + lighting + composition + format guardrails; the per-asset prompt only adds the subject + scene-specific detail.

```text
You are generating a single illustration for the LevelChannel SaaS landing
page Variant A "Cinematic Desk Magic". Brand-DNA bible: docs/brand/variant-a-style-anchor.md
(anchorVersion va-1.0). Every output MUST follow ALL constraints below.

PALETTE — hex codes only, no other colours allowed beyond ±2% lightness drift:
  Canvas backdrop: #0B0B0C
  Secondary surface: #111113
  Accent gradient: linear-gradient(135deg, #C87878 0%, #E8A890 100%)
  Text-tone (when illustrated UI mockup geometry is shown): #F5F5F7 primary, #A1A1AA secondary
  Forbidden: pure white #FFFFFF as fill, pure black #000000, any blue/cold accent,
  any green/red/yellow semantic colour.

LIGHTING — 5-illuminant rig, identical across every asset:
  Key light: top-left, ~30° pitch, ~45° azimuth, colour #E8A890, soft large softbox
  Fill: camera-side, very subtle (~10% of key), colour #111113
  Rim: back-right behind subject, narrow, colour #C87878, the "magic glow" separator
  Ambient: omni, ~5%, colour #0B0B0C warm-tint
  Bounce: from desk surface upward, ~3%, colour #111113 warm
  Shadows: soft-edged, warm-tinted, 18-25% opacity max, cast down-and-right.

COMPOSITION:
  Camera: isometric overhead, ~30° pitch, ~35° yaw — SAME across all variant-A assets.
  Subject placement: lower-left third intersection (rule-of-thirds).
  Negative space: top-right third reserved for rim-light bleed.
  Items: hand-arranged, NOT grid-aligned; each object ±3-8° axis rotation.
  Depth: minimum 3 z-layers (backdrop wash → subject group → foreground accent).
  Item cap: ≤7 distinct objects per frame (hero overview may show 9 from 7 silhouette families).
  Centre-of-mass: below 60% of frame height; eye rests low, looks up into warm key light.

HARD GUARDRAILS:
  - NO people, NO hands, NO faces, NO body parts. Object storytelling only.
  - NO text characters rendered inside the image. UI mockup surfaces use
    geometric placeholder blocks (rectangles, dots), never letters/words/digits
    other than blob-shape stand-ins. All landing copy is overlaid in HTML.
  - NO watermarks, NO brand logos other than blank placeholder rectangles.
  - NO photoreal photography style — this is stylised illustration with
    subtle hand-touched edge imperfection (4-8% grain on flat fills,
    slight pencil-stroke object outlines).
  - Aspect ratio: as specified in the per-asset prompt. Do not deviate.

OUTPUT: PNG, transparent background NOT required (canvas is #0B0B0C), full
bleed to specified aspect ratio. No frames, no borders, no captions.
```

Per-asset prompt that the orchestrator appends to the prefix above lives in the `promptText` field of each row of `docs/brand/_pending/codex-prompts-variant-a.json`. The `promptHash` in that manifest is `sha256(promptText + anchorVersion)` — `promptText` here means the full string (prefix + per-asset detail) per plan §11.2 manifest contract.

## Asset slot list

Lean asset count per plan §11.1 Variant-A lean scope = **6 illustrations + R3F desk-collapse scene + 1 hero video loop**. Slots are stably ID'd; the build code in Sub-3 references them by slot id, never by filename.

### Illustrations (6 slots)

| Slot id | Aspect | Subject | Act / placement | Output path (raw) |
|---|---|---|---|---|
| `slot_a_hero_desk_overview` | 3:2 | Wide isometric overview of a teacher's chaotic desk: phone (Telegram glow), printed calendar page, notebook with handwriting blocks, calculator, headphones cable curled, coffee cup, sticky notes. 7 silhouette families. Rim-light leak hints at the warm "magic" beyond frame. | Act 1+2 fused hero, lower 60% | `public/assets/landing-v2/variant-a/illustrations/raw/hero-desk-overview.png` |
| `slot_a_phone_telegram` | 4:3 | Single subject: phone on desk surface, screen glowing with vague chat-bubble geometry (no text), rim-light on phone edge, key-light soft top-left. Hand-rotated 5° off-axis. | Act 1 chaos detail / parallax fg | `public/assets/landing-v2/variant-a/illustrations/raw/phone-telegram.png` |
| `slot_a_calculator` | 4:3 | Single subject: calculator with abstract block-shape display (no digits), pencil beside it 7° off-axis, partial receipt curl in foreground. Same lighting rig. | Act 2 pain detail / parallax mid | `public/assets/landing-v2/variant-a/illustrations/raw/calculator.png` |
| `slot_a_calendar_notebook` | 4:3 | Single subject: printed calendar page with X-marks (geometric strokes, not text) over notebook with handwritten block-shapes. Sticky note corner. | Act 2 pain detail | `public/assets/landing-v2/variant-a/illustrations/raw/calendar-notebook.png` |
| `slot_a_magnetic_pull` | 3:2 | Mid-transition: 3-4 desk items suspended mid-air, magnetic streak lines (warm gradient strokes) pulling them toward an off-frame attractor at top-right. Hint of dashboard glow at the right edge. | Act 4 climax preamble / between R3F and CTA | `public/assets/landing-v2/variant-a/illustrations/raw/magnetic-pull.png` |
| `slot_a_dashboard_target` | 16:9 | Final-frame freeze of the R3F desk-collapse target: dark dashboard slab `#111113` with abstract block-geometry mockup (sidebar rectangle, content rectangles, no text), warm accent strokes outlining active cells. This is the still that R3F lerps into. | Act 4 climax final frame / fallback PNG keyframe per plan §11 if R3F path fails Lighthouse | `public/assets/landing-v2/variant-a/illustrations/raw/dashboard-target.png` |

### R3F desk-collapse scene (geometry + materials, not a raster asset)

| Slot id | Format | Description |
|---|---|---|
| `slot_a_r3f_desk_scene` | R3F TSX component (built in Sub-3, not Codex-generated) | Three.js scene: 6-7 low-poly desk-item meshes laid out per `slot_a_hero_desk_overview` composition; animation timeline collapses them into the `slot_a_dashboard_target` geometry over 1.4-1.8s; materials match Variant-A palette + lighting (Three.js PointLight rig mirroring the 5-illuminant rule). Fallback: PNG keyframe sequence using `slot_a_hero_desk_overview` → `slot_a_magnetic_pull` → `slot_a_dashboard_target` if Lighthouse Perf <85 on mobile slow-4G per plan §11. |

R3F scene is NOT a Codex image-gen output; it's a Sub-3 implementation deliverable. It is listed here for asset-inventory completeness only and is NOT in the codex-prompts-variant-a.json manifest.

### Video (1 slot)

| Slot id | Aspect | Description | Output path |
|---|---|---|---|
| `slot_a_hero_video_loop` | 16:9 (cinemagraph-style) | 6-12s seamless ambient loop of the desk overview: subtle steam from coffee cup, faint screen-glow pulse on phone, gentle idle jitter of pencil. Same isometric camera as illustrations. First frame === last frame. Kling/Sora generation per plan §11 (owner manual). | `public/assets/landing-v2/variant-a/video/hero-desk-ambient-loop.mp4` |

Video prompt lives as a brief in `docs/brand/_pending/codex-prompts-variant-a.json` (7th entry; `aspectRatio: "16:9"`, `outputPath` → `.mp4`); Kling/Sora is not CLI-accessible in current Codex, so this is a manual-gen entry per plan §11.2 fallback paragraph.

## Anti-drift checklist

Bump `anchorVersion` from `va-1.0` → `va-1.1` ONLY when one of these load-bearing rules changes:

- [ ] Palette: any hex in the palette lock table changes OR new colour role is added
- [ ] Lighting: any of the 5 illuminants changes position, colour, or intensity-relative-to-key
- [ ] Composition: camera angle, rule-of-thirds anchor, depth-layer count, or item-cap changes
- [ ] Forbidden list expands or relaxes (e.g. cool accent suddenly allowed)
- [ ] GPT-Image-1 system-prompt prefix block text changes

Do NOT bump for:

- Per-asset prompt-text tuning that does not touch the prefix block
- Adding new asset slots (extend slot list, keep anchorVersion)
- Cosmetic copy-edits to non-rule sections of this doc (headings, prose around tables)
- Markdown formatting refactors

When bumping: write a new anchor row at the top of this header (`## anchorVersion: va-1.1`) with a delta-summary bullet list; do NOT delete `va-1.0` section (archived for reproducibility per plan §11.2 archive-not-delete invariant). All existing assets become stale (CI gate fails); Sub-3 re-generates or moves them under `public/assets/landing-v2/_archive/`.

---

End of Variant A style anchor v1.0.
