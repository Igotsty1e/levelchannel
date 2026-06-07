# Codex image-gen prompt manifest — saas-landing-tier1-v2

Single source of truth for every Codex GPT-Image-1 prompt across all 3 variants. Assembled by the orchestrator at 2026-06-07 from the 3 per-agent intermediate manifests under `docs/brand/_pending/codex-prompts-variant-{a,b,c}.json` (round-3 WARN #5 closure — agents write to disjoint per-variant files; orchestrator collates AFTER all agents finish in deterministic a → b → c order).

## Schema (canonical row format)

Every asset row carries: `variantId`, `anchorVersion`, `slot` (stable id), `outputPath` (target file under `public/assets/landing-v2/{variant}/illustrations/`), `aspectRatio`, `paletteHex` (list), `promptText` (verbatim text to send to GPT-Image-1), `promptHash` (sha256 hex of `promptText + anchorVersion`, computed at collation; `PENDING` if not yet sent through Codex).

## Anti-drift contract

1. Append-only via per-variant intermediate files; this file is regenerated, never hand-edited.
2. Bumping any `anchorVersion` (e.g. `va-1.0` → `va-1.1`) MUST be paired with: re-generating every asset under that variant + bumping every `promptHash` + the CI gate `scripts/check-asset-manifest.mjs` runs to verify match.
3. Hand-coded deliverables (Lottie via Rive, R3F scene, DashboardMock component, sample-data JSON) are listed in the per-variant style anchor docs but NOT in this prompts manifest. They follow their own implementation contract under each sub-PR.

---

## Variant A — Cinematic Desk Magic (v2-a)

- **anchorVersion:** `va-1.0`
- **anchorDoc:** [`docs/brand/variant-a-style-anchor.md`](docs/brand/variant-a-style-anchor.md)
- **intermediateSource:** [`docs/brand/_pending/codex-prompts-variant-a.json`](docs/brand/_pending/codex-prompts-variant-a.json)
- **totalAssets (Codex-gen):** 7

| # | slot | aspect | outputPath | promptHash (16) | status |
|---|---|---|---|---|---|
| 1 | `slot_a_hero_desk_overview` | 3:2 | `public/assets/landing-v2/variant-a/illustrations/raw/hero-desk-overview.png` | `8a32ee428831d688` | DRAFT |
| 2 | `slot_a_phone_telegram` | 4:3 | `public/assets/landing-v2/variant-a/illustrations/raw/phone-telegram.png` | `1a1394d2a6199627` | DRAFT |
| 3 | `slot_a_calculator` | 4:3 | `public/assets/landing-v2/variant-a/illustrations/raw/calculator.png` | `b54fd971d3d7f8d0` | DRAFT |
| 4 | `slot_a_calendar_notebook` | 4:3 | `public/assets/landing-v2/variant-a/illustrations/raw/calendar-notebook.png` | `6d2c2577b2f2e310` | DRAFT |
| 5 | `slot_a_magnetic_pull` | 3:2 | `public/assets/landing-v2/variant-a/illustrations/raw/magnetic-pull.png` | `a53cf16df15e461f` | DRAFT |
| 6 | `slot_a_dashboard_target` | 16:9 | `public/assets/landing-v2/variant-a/illustrations/raw/dashboard-target.png` | `d57d3e1d5129cabb` | DRAFT |
| 7 | `slot_a_hero_video_loop` | 16:9 | `public/assets/landing-v2/variant-a/video/hero-desk-ambient-loop.mp4` | `e2b89b0702a216ed` | DRAFT |

Full `promptText` per asset lives in the intermediate JSON to keep this overview file scannable. CI gate verifies the markdown table rows match the JSON sources byte-for-byte at the slot+hash level.

## Variant B — Editorial Storytelling (v2-b)

- **anchorVersion:** `vb-1.0`
- **anchorDoc:** [`docs/brand/variant-b-style-anchor.md`](docs/brand/variant-b-style-anchor.md)
- **intermediateSource:** [`docs/brand/_pending/codex-prompts-variant-b.json`](docs/brand/_pending/codex-prompts-variant-b.json)
- **totalAssets (Codex-gen):** 7

| # | slot | aspect | outputPath | promptHash (16) | status |
|---|---|---|---|---|---|
| 1 | `slot_b_hero_editorial_photo` | 16:9 | `n/a` | `2f17ecd0633986ff` | DRAFT |
| 2 | `slot_b_section_1_workspace_scene` | 16:9 | `n/a` | `52ae9e403b5f4794` | DRAFT |
| 3 | `slot_b_section_2_calm_dashboard` | 16:9 | `n/a` | `cb4bfaf1216c3ad1` | DRAFT |
| 4 | `slot_b_section_3_quote_image` | 21:9 | `n/a` | `2c676d5ece3a45c7` | DRAFT |
| 5 | `slot_b_product_screenshot_dashboard` | 16:10 | `n/a` | `3dc44836ac047725` | DRAFT |
| 6 | `slot_b_product_screenshot_learners` | 16:10 | `n/a` | `541dcffa0d6f772e` | DRAFT |
| 7 | `slot_b_product_screenshot_schedule` | 16:10 | `n/a` | `daa22a13de03f950` | DRAFT |

Full `promptText` per asset lives in the intermediate JSON to keep this overview file scannable. CI gate verifies the markdown table rows match the JSON sources byte-for-byte at the slot+hash level.

## Variant C — Interactive Demo Playground (v2-c)

- **anchorVersion:** `vc-1.0`
- **anchorDoc:** [`docs/brand/variant-c-style-anchor.md`](docs/brand/variant-c-style-anchor.md)
- **intermediateSource:** [`docs/brand/_pending/codex-prompts-variant-c.json`](docs/brand/_pending/codex-prompts-variant-c.json)
- **totalAssets (Codex-gen):** 2

| # | slot | aspect | outputPath | promptHash (16) | status |
|---|---|---|---|---|---|
| 1 | `slot_c_hero_dashboard_overview` | 16:10 | `public/assets/landing-v2/variant-c/illustrations/raw/slot_c_hero_dashboard_overview.{avif,webp}` | `4dceaec36468da55` | DRAFT |
| 2 | `slot_c_secondary_callout_workspace` | 4:3 | `public/assets/landing-v2/variant-c/illustrations/raw/slot_c_secondary_callout_workspace.{avif,webp}` | `6b961b7895be63a5` | DRAFT |

Full `promptText` per asset lives in the intermediate JSON to keep this overview file scannable. CI gate verifies the markdown table rows match the JSON sources byte-for-byte at the slot+hash level.

---

## Generation status legend

- **DRAFT** — prompt written, not yet sent to GPT-Image-1.
- **PENDING** — promptText TBD (variant-c intentional, hash deferred to collation per agent C note).
- **GENERATED** — Codex returned image, saved to raw/, awaits color/aspect validation.
- **ACCEPTED** — committed to `public/assets/landing-v2/{variant}/illustrations/{slot}.{avif,webp}`; `manifest.json` row written; lives in repo.
- **STALE** — `anchorVersion` bumped without re-gen; CI gate fails this state.
