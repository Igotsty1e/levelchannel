# Brand-mark options — `/saas` Tier-1 redesign Sub-B.1

Owner-requested 2026-05-30 per `docs/plans/saas-offer-and-landing-redesign.md` §Sub-B.1 + Q-11b: **новый логотип БЕЗ буквы L**. 4 abstract / non-L concepts below; owner picks ONE during Sub-B.1 review.

All 4 use the existing brand accent (`#C87878 → #E8A890` gradient) so palette continuity is preserved — only the mark shape changes. Wordmark stays "levelChannel" per Q-11a (keep the brand name).

## Concepts

| File | Mark | Concept | Strength | Risk |
|---|---|---|---|---|
| `option-a-dot-wordmark.svg` | Filled gradient dot | Minimal "presence" mark. Reads as a node in a channel/network. Fastest to recognise; smallest footprint. | Apple-system-icon-tier neutrality; works at any size including favicon 16×16. | Generic — many SaaS brands use a single dot. Distinctiveness depends on context. |
| `option-b-circle-pulse.svg` | Three concentric circles, filled inner + thin outer rings | "Pulse" / "broadcast" metaphor — fits "channel" name semantically. Subtle motion-friendly (rings can animate radius for hover). | On-brand for "channel", scroll-driven pulse animation strong on hero. | More detail = harder to render at favicon size; needs solid-disc fallback. |
| `option-c-infinity-ribbon.svg` | Stylised continuous ribbon (figure-8 / infinity-adjacent) | "Continuous learning" / "endless flow" metaphor. Bold sculptural mark. | Memorable shape; animates well as path-draw on first view. | Bolder/stronger personality — might feel overcomplicated for a SaaS-utility brand. |
| `option-d-chevron-forward.svg` | Three stacked chevrons climbing right | "Progress" / "level up" metaphor — fits "levelChannel" name semantically. | Forward-motion energy; ties to "level" without using the letter L. | Common pattern (many education/fitness brands use chevron stacks). |

## How to view

Open each SVG in a browser to preview against dark background. Or hot-reload them into `/saas` header for in-context evaluation (Sub-B.1 will wire one of these into `components/saas/saas-landing-tier1.tsx` after owner picks).

## Sizes

All concepts ship at `320×80` for the inline header. Favicon-scale (`16×16` / `32×32` / `192×192`) variants will be generated in the same Sub-B.1 PR once owner picks the winner — mark-only (no wordmark) for favicons.

## Animations (Sub-B.3 stage)

Per `docs/design-system.md §8.LANDING`:
- **All marks:** magnetic-cursor primitive on the wordmark (`data-magnetic`).
- **Option B (circle-pulse):** scroll-triggered concentric ring expansion on hero entrance (`data-scroll-trigger`).
- **Option C (infinity-ribbon):** path-draw animation (`stroke-dasharray` / `stroke-dashoffset`) on first viewport entry.
- **Option D (chevron-forward):** stagger reveal of the 3 chevrons (60ms step) on hero entrance.
- **Reduced motion:** all static; no entrance animation.

## Decision needed from owner (Q-B.5 in plan-doc + Sub-B.1)

1. **Pick one of A / B / C / D** for the new mark.
2. **Q-B.5 scope:** option A (single brand — replace mark on `/`, `/offer`, `/saas`, payments, header, favicon — Option A in `docs/plans/saas-offer-and-landing-redesign.md` §Sub-B.1 logo-touchpoint table) vs option B (SaaS-only — `/` and `/offer` keep current `L` mark; only `/saas/**` + shared header/payment surfaces + favicon swap to new mark).
